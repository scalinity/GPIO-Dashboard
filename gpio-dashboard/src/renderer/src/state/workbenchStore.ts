// The interim Workbench (SPEC 11.1): one open document, its simulation and probe signature. The
// document is read-only here; editing arrives with the Studio (M7).
import { create } from 'zustand'
import { partDef } from '../core/defs/parts'
import type { CircuitDoc } from '../core/model/types'
import { validateDoc, type Problem } from '../core/ops/validate'
import type { EnvValue } from '../core/sim/behavior'
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

export const useWorkbench = create<WorkbenchState>((set, get) => {
  const send = async (req: SimRequest) => {
    const res = await simRequest(req)
    if (res.type === 'state') set({ sim: res, error: null })
    else if (res.type === 'probe') set({ probe: res.signature, error: null })
    else if (res.type === 'error') set({ error: res.message })
  }
  return {
    source: null,
    code: '',
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
        doc,
        problems,
        gpio: {},
        env: {},
        sim: null,
        probe: null,
        error: null,
        code: doc.code.source,
        diagnostics: [],
        codeOutput: [],
        codeError: null
      })
      if (problems.length === 0) {
        circuit.open(doc)
        await send({ type: 'load', doc })
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
  }
})

onPython((r) => {
  const state = useWorkbench.getState()
  if (r.type === 'diagnostics') useWorkbench.setState({ diagnostics: r.diagnostics })
  else if (r.type === 'output')
    useWorkbench.setState({ codeOutput: [...state.codeOutput, r.text].slice(-500) })
  else if (r.type === 'state') {
    useWorkbench.setState({
      sim: { type: 'state', snapshot: r.snapshot, reads: r.reads, issues: state.sim?.issues ?? [] }
    })
  } else {
    useWorkbench.setState({ codeStatus: r.error ? 'error' : 'done', codeError: r.error })
  }
})
