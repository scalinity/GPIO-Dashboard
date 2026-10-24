// A test double for the AssistantContext: the same document rules as the circuit store, the
// simulator's own code from core/, and recorders for everything the assistant asks the UI to do.
// The Claude panel's tests (9.3) can use it too. The store is injectable, so a test outside
// assistant/ can run the same scripts against the real CircuitStore.
import { PART_DEFS, partDef as builtInPartDef } from '../../core/defs/parts'
import { erc } from '../../core/erc/erc'
import { newDoc } from '../../core/model/defaults'
import type { CircuitDoc, PartDef } from '../../core/model/types'
import { applyOps, OpError } from '../../core/ops/apply'
import { validateDoc } from '../../core/ops/validate'
import { BEHAVIORS } from '../../core/sim/behaviors'
import { simChecks } from '../../core/sim/checks'
import { Circuit } from '../../core/sim/circuit'
import { SimSession } from '../../core/sim/session'
import type {
  AssistantContext,
  BoardSenseSnapshot,
  BuildStepAnnotation,
  CheckResult,
  DispatchResult,
  Ghost,
  PythonDiagnostic,
  SimRequest,
  SimResponse,
  SimRun,
  TransactionInput,
  ViewPreset
} from '../context'
import type { PartDefs } from '../../core/netlist/netlist'
import type { Transaction } from '../../core/model/types'

export type StoreLike = Pick<AssistantContext, 'getSnapshot' | 'dispatch' | 'check' | 'undoTurn'>

/** The circuit store's rules without its connectivity engine: validated transactions, undo. */
export class MemoryStore implements StoreLike {
  private undoStack: { tx: Transaction; metaBefore: CircuitDoc['meta'] }[] = []
  private count = 0

  constructor(
    private doc: CircuitDoc,
    private readonly defs: PartDefs = builtInPartDef
  ) {}

  getSnapshot = () => this.doc

  check(input: TransactionInput): CheckResult {
    let result
    try {
      result = applyOps(this.doc, input.ops)
    } catch (e) {
      if (e instanceof OpError)
        return { ok: false, problems: [{ code: 'OP', message: e.message, refs: [] }] }
      throw e
    }
    const problems = validateDoc(result.doc, this.defs)
    return problems.length ? { ok: false, problems } : { ok: true, doc: result.doc }
  }

  dispatch(input: TransactionInput): DispatchResult {
    let result
    try {
      result = applyOps(this.doc, input.ops)
    } catch (e) {
      if (e instanceof OpError)
        return { ok: false, problems: [{ code: 'OP', message: e.message, refs: [] }] }
      throw e
    }
    const problems = validateDoc(result.doc, this.defs)
    if (problems.length) return { ok: false, problems }
    this.count += 1
    const tx: Transaction = {
      id: `tx${this.count}`,
      author: input.author,
      label: input.label,
      ops: structuredClone(input.ops),
      inverse: result.inverse,
      ...(input.assistantTurnId ? { assistantTurnId: input.assistantTurnId } : {})
    }
    const metaBefore = this.doc.meta
    this.undoStack.push({ tx, metaBefore })
    this.doc = {
      ...result.doc,
      meta: { ...result.doc.meta, revision: metaBefore.revision + 1, updated: 'now' }
    }
    return { ok: true, tx }
  }

  undoTurn(assistantTurnId: string): number {
    let undone = 0
    while (this.undoStack.at(-1)?.tx.assistantTurnId === assistantTurnId) {
      const entry = this.undoStack.pop()!
      this.doc = { ...applyOps(this.doc, entry.tx.inverse).doc, meta: entry.metaBefore }
      undone += 1
    }
    return undone
  }
}

const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** Part ids the double counts as "My inventory". */
export const FAKE_INVENTORY = [
  'resistor',
  'led',
  'tact-switch-6mm',
  'pn2222',
  'ic-74hc595',
  'active-buzzer'
]

export class FakeContext implements AssistantContext {
  readonly store: StoreLike
  readonly custom = new Map<string, PartDef>()
  readonly inventory = new Set(FAKE_INVENTORY)
  /** Every setGhost call, in order. */
  readonly ghostLog: { id: string; ghost: Ghost | null }[] = []
  readonly focusLog: { refs: string[]; note?: string }[] = []
  readonly highlightLog: { refs: string[]; note: string }[] = []
  readonly annotations: BuildStepAnnotation[] = []
  readonly questions: { question: string; options: string[] }[] = []
  /** Answers askUser gives, first in first out. */
  answers: string[] = []
  diagnostics: PythonDiagnostic[] = []
  run: SimRun = { stdout: '', stderr: '', error: null, events: [], truncated: false }
  sense: BoardSenseSnapshot = { on: false, states: [], events: [], candidates: {} }
  views: ViewPreset[] = []
  private session: SimSession | null = null
  private loaded: CircuitDoc | null = null

  constructor(options: { doc?: CircuitDoc; store?: StoreLike } = {}) {
    this.store =
      options.store ??
      new MemoryStore(options.doc ?? newDoc('Test', '2026-10-24T00:00:00.000Z'), this.partDef)
  }

  getSnapshot: AssistantContext['getSnapshot'] = () => this.store.getSnapshot()
  dispatch = (input: TransactionInput) => this.store.dispatch(input)
  check = (input: TransactionInput) => this.store.check(input)
  undoTurn = (id: string) => this.store.undoTurn(id)

  partDef: PartDefs = (id) => this.custom.get(id) ?? builtInPartDef(id)
  partDefs = () => [
    ...[...PART_DEFS.values()].filter((d) => !this.custom.has(d.id)),
    ...this.custom.values()
  ]
  registerPartDef = (def: PartDef) => void this.custom.set(def.id, def)
  inventoryPartIds = () => this.inventory

  async sim(request: SimRequest): Promise<SimResponse> {
    try {
      if (request.type === 'load') {
        this.loaded = request.doc
        this.session = new SimSession(new Circuit(request.doc, this.partDef, BEHAVIORS))
      } else if (!this.session || !this.loaded) {
        return { type: 'error', message: 'No circuit is loaded' }
      } else if (request.type === 'gpio') this.session.setGpio(request.bcm, request.state)
      else if (request.type === 'input')
        this.session.setInput(request.part, request.key, request.value)
      else this.session.advanceTo(request.t)
      const snapshot = this.session!.snapshot()
      const issues = [
        ...erc(this.loaded!, this.partDef),
        ...simChecks(this.loaded!, this.partDef, snapshot)
      ]
      return { type: 'state', snapshot, issues, reads: {} }
    } catch (e) {
      return { type: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }

  checkPython = async () => this.diagnostics
  runCodeInSim = async () => this.run
  captureView = async (preset: ViewPreset) => {
    this.views.push(preset)
    return { mediaType: 'image/png' as const, data: PIXEL_PNG }
  }
  focus = (refs: string[], note?: string) => void this.focusLog.push({ refs, note })
  highlight = (refs: string[], note: string) => void this.highlightLog.push({ refs, note })
  setGhost: AssistantContext['setGhost'] = (id, ghost) => void this.ghostLog.push({ id, ghost })
  annotateBuildSteps = (annotations: BuildStepAnnotation[]) =>
    void this.annotations.push(...annotations)
  boardSense = () => this.sense
  askUser: AssistantContext['askUser'] = async (question, options) => {
    this.questions.push({ question, options })
    return this.answers.shift() ?? options[0] ?? ''
  }
}
