// The AssistantContext for the evals, in Node (SPEC 18): the app's own CircuitStore (with its
// ConnectivityEngine), ERC, SimSession and Pyodide shims, and recorders for what the assistant asks
// the UI to do. Only the 3D stage is missing: capture_view reports that it is not available.
import { isDeepStrictEqual } from 'node:util'
import type {
  AssistantContext,
  BoardSenseSnapshot,
  Ghost,
  PythonDiagnostic,
  SimRequest,
  SimResponse,
  SimRun,
  TransactionInput,
  ViewPreset
} from '@renderer/assistant/context'
import inventoryFile from '@renderer/content/inventory.json'
import { PART_DEFS, partDef as builtInPartDef } from '@renderer/core/defs/parts'
import { erc } from '@renderer/core/erc/erc'
import { newDoc } from '@renderer/core/model/defaults'
import type { CircuitDoc } from '@renderer/core/model/types'
import type { PartDefs } from '@renderer/core/netlist/netlist'
import type { EnvValue } from '@renderer/core/sim/behavior'
import { BEHAVIORS } from '@renderer/core/sim/behaviors'
import { simChecks } from '@renderer/core/sim/checks'
import { Circuit } from '@renderer/core/sim/circuit'
import { SimSession } from '@renderer/core/sim/session'
import { CircuitStore } from '@renderer/state/circuitStore'
import { Bridge } from '@renderer/workers/bridge'
import { compileCheck, createPython, runProgram } from '@renderer/workers/python'
import type { PyodideInterface } from 'pyodide'

/** Every timestamp in an eval document, so two runs of the same script give equal documents. */
export const FIXED_TIME = '2026-10-24T00:00:00.000Z'

export const emptyEvalDoc = (): CircuitDoc => newDoc('Eval', FIXED_TIME)

/** The part ids in "My inventory": both kits in content/inventory.json. */
export const INVENTORY_PART_IDS: ReadonlySet<string> = new Set(
  [...inventoryFile.kit.items, ...inventoryFile.tboardKit.items].flatMap((i) =>
    i.partId ? [i.partId] : []
  )
)

/** The lead kinds the kits hold (inventory.json leadKind, plus the T-board kit's male-male). */
export const INVENTORY_LEAD_KINDS: ReadonlySet<string> = new Set(
  [...inventoryFile.kit.items, ...inventoryFile.tboardKit.items].flatMap((i) =>
    'leadKind' in i && typeof i.leadKind === 'string' ? [i.leadKind] : []
  )
)

export const CAPTURE_UNAVAILABLE =
  'capture_view is not available in this session: there is no 3D stage here (headless evaluation). Check the layout from the hole positions and nets that get_circuit_state returns.'

export interface RunOptions {
  inputs?: [part: string, key: string, value: EnvValue][]
  schedule?: { t: number; part: string; key: string; value: EnvValue }[]
}

/** Virtual seconds a program has after its time is up to run its finally blocks. */
const CLEANUP_S = 0.25
const TIME_UP = 'simulated time is up'

/** Pyodide with the simulator's shims, loaded once and shared by every prompt. */
export class PythonRuntime {
  private constructor(
    private readonly py: PyodideInterface,
    private readonly out: string[],
    private readonly err: string[]
  ) {}

  static async load(indexURL: string): Promise<PythonRuntime> {
    const out: string[] = []
    const err: string[] = []
    const py = await createPython({
      indexURL,
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t)
    })
    return new PythonRuntime(py, out, err)
  }

  check(source: string): PythonDiagnostic[] {
    return compileCheck(this.py, source)
  }

  /**
   * Runs `doc.code` for `seconds` of virtual time against the document's circuit. `inputs` are set
   * before it starts; `schedule` entries are applied as the program's clock reaches them.
   */
  run(
    doc: CircuitDoc,
    defs: PartDefs,
    seconds: number,
    options: RunOptions = {}
  ): SimRun & { endedAt: number } {
    this.out.length = 0
    this.err.length = 0
    const bridge = new EventBridge(new SimSession(new Circuit(doc, defs, BEHAVIORS)))
    for (const [part, key, value] of options.inputs ?? []) bridge.setInput(part, key, value)
    const due = [...(options.schedule ?? [])].sort((a, b) => a.t - b.t)
    const interrupt = new Int32Array(new SharedArrayBuffer(4))
    // Pyodide delivers an interrupt some way into the program (seconds of virtual time later, and
    // not the same each run), so the run is ended where the program is in the simulator's code:
    // the first shim call at or after `seconds` raises, which runs the program's finally blocks
    // and ends it, as Ctrl+C does. Cleanup then gets a short grace period; after it, every call
    // raises, and the interrupt is set for a program that makes none.
    let stopped = false
    let graceUntil = Infinity
    const stopIfDone = () => {
      while (due.length && bridge.now() >= due[0]!.t) {
        const { part, key, value } = due.shift()!
        bridge.setInput(part, key, value)
      }
      if (bridge.now() < seconds) return
      if (!stopped) {
        stopped = true
        graceUntil = bridge.now() + CLEANUP_S
        throw new Error(TIME_UP)
      }
      if (bridge.now() >= graceUntil) {
        interrupt[0] = 2
        throw new Error(TIME_UP)
      }
    }
    bridge.onCall = stopIfDone
    let error: string | null = null
    try {
      runProgram(
        this.py,
        bridge,
        doc.code.source,
        (s) => {
          bridge.sleep(s)
          stopIfDone()
        },
        interrupt
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      error = /KeyboardInterrupt|simulated time is up/.test(message) ? null : message
    }
    return {
      stdout: this.out.join('\n'),
      stderr: this.err.join('\n'),
      error,
      events: bridge.events,
      truncated: bridge.truncated,
      endedAt: bridge.now()
    }
  }
}

const MAX_RUN_EVENTS = 5000

/** The simulator's bridge, remembering what the program did to its output pins. */
class EventBridge extends Bridge {
  readonly events: SimRun['events'] = []
  truncated = false

  private log(bcm: number, event: string) {
    if (this.events.length >= MAX_RUN_EVENTS) this.truncated = true
    else this.events.push({ t: this.now(), bcm, event })
  }

  override output(bcm: number, level: boolean) {
    super.output(bcm, level)
    this.log(bcm, level ? 'high' : 'low')
  }

  override pwm(bcm: number, frequencyHz: number, duty: number) {
    super.pwm(bcm, frequencyHz, duty)
    this.log(bcm, `pwm ${frequencyHz} Hz ${Math.round(duty * 100)}%`)
  }

  override pwmStop(bcm: number) {
    super.pwmStop(bcm)
    this.log(bcm, 'pwm stop')
  }
}

export interface NodeContextOptions {
  doc?: CircuitDoc
  python: PythonRuntime
  sense?: BoardSenseSnapshot
  /** Chooses the answer to ask_user. The default takes the first option. */
  answer?: (question: string, options: string[]) => string
}

export class NodeContext implements AssistantContext {
  readonly store: CircuitStore
  readonly initial: CircuitDoc
  readonly ghostLog: { id: string; ghost: Ghost | null }[] = []
  readonly focusLog: { refs: string[]; note?: string }[] = []
  readonly highlightLog: { refs: string[]; note: string }[] = []
  readonly questions: { question: string; options: string[]; answer: string }[] = []
  readonly captures: ViewPreset[] = []
  /** The part inputs `simulate` set, in order: a switch pressed, a distance, a wiper position. */
  readonly inputLog: { part: string; key: string; value: EnvValue }[] = []
  /** What each run_code_in_sim asked for and the virtual time the program reached. */
  readonly runLog: { seconds: number; endedAt: number; events: number; error: string | null }[] = []
  sense: BoardSenseSnapshot

  private session: SimSession | null = null
  private loaded: CircuitDoc | null = null
  private readonly inputPins = new Set<number>()
  readonly python: PythonRuntime
  private readonly chooseAnswer: NonNullable<NodeContextOptions['answer']>

  constructor(options: NodeContextOptions) {
    this.initial = options.doc ?? emptyEvalDoc()
    this.python = options.python
    this.sense = options.sense ?? { on: false, states: [], events: [], candidates: {} }
    this.chooseAnswer = options.answer ?? ((_, choices) => choices[0] ?? '')
    this.store = new CircuitStore(structuredClone(this.initial), this.partDef, () => FIXED_TIME)
  }

  getSnapshot: AssistantContext['getSnapshot'] = () => this.store.getSnapshot()
  dispatch = (input: TransactionInput) => this.store.dispatch(input)
  check = (input: TransactionInput) => this.store.check(input)
  undoTurn = (id: string) => this.store.undoTurn(id)

  /** The built-in library; a project's own parts are in its document (`customParts`). */
  partDef: PartDefs = builtInPartDef
  partDefs = () => [...PART_DEFS.values()]
  inventoryPartIds = () => INVENTORY_PART_IDS

  /** The simulator as sim.worker runs it (workers/simHost), over this context's part library. */
  async sim(request: SimRequest): Promise<SimResponse> {
    try {
      if (request.type === 'load') {
        this.loaded = request.doc
        this.session = new SimSession(new Circuit(request.doc, this.partDef, BEHAVIORS))
        this.inputPins.clear()
      } else if (!this.session || !this.loaded) {
        return { type: 'error', message: 'No circuit is loaded' }
      } else if (request.type === 'gpio') {
        this.session.setGpio(request.bcm, request.state)
        if (request.state.mode === 'in') this.inputPins.add(request.bcm)
        else this.inputPins.delete(request.bcm)
      } else if (request.type === 'input') {
        this.session.setInput(request.part, request.key, request.value)
        this.inputLog.push({ part: request.part, key: request.key, value: request.value })
      } else {
        this.session.advanceTo(request.t)
      }
      const session = this.session!
      const snapshot = session.snapshot()
      const order = { error: 0, warning: 1, info: 2 }
      const issues = [
        ...erc(this.loaded!, this.partDef),
        ...simChecks(this.loaded!, this.partDef, snapshot)
      ].sort((a, b) => order[a.severity] - order[b.severity])
      const reads = Object.fromEntries([...this.inputPins].map((bcm) => [bcm, session.read(bcm)]))
      return { type: 'state', snapshot, issues, reads }
    } catch (e) {
      return { type: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }

  checkPython = async (source: string) => this.python.check(source)
  runCodeInSim = async (doc: CircuitDoc, seconds: number): Promise<SimRun> => {
    const { endedAt, ...run } = this.python.run(doc, this.partDef, seconds)
    this.runLog.push({ seconds, endedAt, events: run.events.length, error: run.error })
    return run
  }

  captureView: AssistantContext['captureView'] = async (preset) => {
    this.captures.push(preset)
    throw new Error(CAPTURE_UNAVAILABLE)
  }
  focus = (refs: string[], note?: string) => void this.focusLog.push({ refs, note })
  highlight = (refs: string[], note: string) => void this.highlightLog.push({ refs, note })
  setGhost: AssistantContext['setGhost'] = (id, ghost) => void this.ghostLog.push({ id, ghost })
  boardSense = () => this.sense
  askUser: AssistantContext['askUser'] = async (question, options) => {
    const answer = this.chooseAnswer(question, options)
    this.questions.push({ question, options, answer })
    return answer
  }

  /** Ghosts still showing: every one a streamed call set must be cleared by the end of a turn. */
  openGhosts(): string[] {
    const open = new Set<string>()
    for (const { id, ghost } of this.ghostLog) {
      if (ghost) open.add(id)
      else open.delete(id)
    }
    return [...open]
  }
}

/**
 * Strict deep equality of two documents, as undo has to restore them: a property that is
 * undefined is not the same as one that is absent.
 */
export const sameDoc = (a: CircuitDoc, b: CircuitDoc): boolean => isDeepStrictEqual(a, b)
