// The Workbench's state (SPEC 11.1), shared by the Studio's drawer: the app's document, its
// simulation and probe signature, and the program being edited. The document follows every
// committed change to the app's CircuitStore, so the sim and ERC stay live while the Studio edits.
import { create } from 'zustand'
import { partDef } from '../core/defs/parts'
import type { CircuitDoc } from '../core/model/types'
import { erc, type Issue } from '../core/erc/erc'
import { validateDoc, type Problem } from '../core/ops/validate'
import type { EnvValue } from '../core/sim/behavior'
import { simChecks } from '../core/sim/checks'
import type { GpioState } from '../core/sim/circuit'
import type { ProbeSignature } from '../core/sim/probe'
import type { SimRequest, SimResponse } from '../workers/simHost'
import type { Diagnostic } from '../workers/python'
import { circuit } from './circuit'
import { checkCode, onPython, runCode, sendInputs, stopCode } from './pyClient'
import { simRequest } from './simClient'

/** User GPIOs on the header (GPIO0/1 are the ID EEPROM). */
export const USER_GPIOS = Array.from({ length: 26 }, (_, i) => i + 2)

type SimState = Extract<SimResponse, { type: 'state' }>

export type CodeStatus = 'idle' | 'running' | 'done' | 'error'

interface WorkbenchState {
  source: string | null
  /** The program being edited; Run in Sim and Run on Pi use it. */
  code: string
  diagnostics: Diagnostic[]
  /** Bumped whenever `code` is replaced from a document, so the editor reloads it. */
  codeRevision: number
  codeStatus: CodeStatus
  codeOutput: string[]
  codeError: string | null
  doc: CircuitDoc | null
  problems: Problem[]
  gpio: Record<number, GpioState>
  env: Record<string, Record<string, EnvValue>>
  sim: SimState | null
  probe: ProbeSignature | null
  error: string | null
  open(source: string, doc: CircuitDoc): Promise<void>
  setGpio(bcm: number, state: GpioState): Promise<void>
  setInput(part: string, key: string, value: EnvValue): Promise<void>
  advance(seconds: number): Promise<void>
  runProbe(): Promise<void>
  setCode(code: string): void
  check(): void
  runInSim(timeScale: number): void
  stopCode(): void
}

const ercOf = new WeakMap<CircuitDoc, Issue[]>()
const SEVERITY = { error: 0, warning: 1, info: 2 }

/** The document's ERC and the checks that read a snapshot, errors first (as SimHost reports). */
function issuesFor(doc: CircuitDoc, snapshot: SimState['snapshot']): Issue[] {
  let rules = ercOf.get(doc)
  if (!rules) ercOf.set(doc, (rules = erc(doc, partDef)))
  return [...rules, ...simChecks(doc, partDef, snapshot)].sort(
    (a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]
  )
}

async function send(req: SimRequest) {
  const res = await simRequest(req)
  if (res.type === 'state') useWorkbench.setState({ sim: res, error: null })
  else if (res.type === 'probe') useWorkbench.setState({ probe: res.signature, error: null })
  else if (res.type === 'error') useWorkbench.setState({ error: res.message })
}

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  source: null,
  code: '',
  codeRevision: 0,
  diagnostics: [],
  codeStatus: 'idle',
  codeOutput: [],
  codeError: null,
  doc: null,
  problems: [],
  gpio: {},
  env: {},
  sim: null,
  probe: null,
  error: null,
  async open(source, doc) {
    const problems = validateDoc(doc, partDef)
    set({
      source,
      problems,
      gpio: {},
      env: {},
      error: null,
      code: doc.code.source,
      codeRevision: get().codeRevision + 1,
      diagnostics: [],
      codeOutput: [],
      codeError: null
    })
    // A document that breaks placement rules is listed here, but never opened (ADR-0027).
    if (problems.length) set({ doc, sim: null, probe: null })
    else {
      circuit.open(doc)
      await follow()
    }
  },
  async setGpio(bcm, state) {
    set({ gpio: { ...get().gpio, [bcm]: state } })
    await send({ type: 'gpio', bcm, state })
  },
  async setInput(part, key, value) {
    const env = get().env
    const next = { ...env, [part]: { ...env[part], [key]: value } }
    set({ env: next })
    // A running program owns the circuit: its inputs reach it through shared memory.
    if (get().codeStatus === 'running') sendInputs(next)
    else await send({ type: 'input', part, key, value })
  },
  async advance(seconds) {
    const t = (get().sim?.snapshot.t ?? 0) + seconds
    await send({ type: 'advance', t })
  },
  async runProbe() {
    await send({ type: 'probe', pins: USER_GPIOS })
  },
  setCode(code) {
    set({ code, diagnostics: [] })
  },
  check() {
    checkCode(get().code)
  },
  runInSim(timeScale) {
    const { doc, code, env } = get()
    if (!doc) return
    set({ codeStatus: 'running', codeOutput: [], codeError: null, diagnostics: [] })
    runCode({ ...doc, code: { ...doc.code, source: code } }, timeScale)
    sendInputs(env)
  },
  stopCode() {
    stopCode()
  }
}))

let loading: Promise<void> = Promise.resolve()

/**
 * Brings the Workbench onto the app's current document, if it isn't there yet, and reloads the
 * sim with the GPIO states and part inputs already set. Loads run one at a time, and one whose
 * document has been replaced meanwhile is skipped. The editor's code is replaced only when the
 * document's code changed and differs from what is being edited.
 */
export function follow(): Promise<void> {
  const doc = circuit.getSnapshot()
  const state = useWorkbench.getState()
  if (doc === state.doc) return loading
  const replace =
    doc.code.source !== state.code && (!state.doc || doc.code.source !== state.doc.code.source)
  useWorkbench.setState({
    doc,
    problems: [],
    probe: null,
    ...(replace
      ? { code: doc.code.source, codeRevision: state.codeRevision + 1, diagnostics: [] }
      : {})
  })
  loading = loading.then(async () => {
    if (circuit.getSnapshot() !== doc) return
    await send({ type: 'load', doc })
    const { gpio, env } = useWorkbench.getState()
    for (const [bcm, state] of Object.entries(gpio))
      await send({ type: 'gpio', bcm: Number(bcm), state })
    for (const [part, inputs] of Object.entries(env)) {
      if (!doc.parts.some((p) => p.id === part)) continue
      for (const [key, value] of Object.entries(inputs))
        await send({ type: 'input', part, key, value })
    }
  })
  return loading
}

circuit.subscribe(() => void follow())

onPython((r) => {
  const state = useWorkbench.getState()
  if (r.type === 'diagnostics') useWorkbench.setState({ diagnostics: r.diagnostics })
  else if (r.type === 'output')
    useWorkbench.setState({ codeOutput: [...state.codeOutput, r.text].slice(-500) })
  else if (r.type === 'state') {
    // A running program moves currents, so the checks that read them run on each snapshot.
    const issues = state.doc ? issuesFor(state.doc, r.snapshot) : (state.sim?.issues ?? [])
    useWorkbench.setState({ sim: { type: 'state', snapshot: r.snapshot, reads: r.reads, issues } })
  } else {
    useWorkbench.setState({ codeStatus: r.error ? 'error' : 'done', codeError: r.error })
  }
})
