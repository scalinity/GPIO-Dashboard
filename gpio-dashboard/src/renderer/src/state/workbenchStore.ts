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
import { simRequest } from './simClient'

/** User GPIOs on the header (GPIO0/1 are the ID EEPROM). */
export const USER_GPIOS = Array.from({ length: 26 }, (_, i) => i + 2)

type SimState = Extract<SimResponse, { type: 'state' }>

interface WorkbenchState {
  source: string | null
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
}

export const useWorkbench = create<WorkbenchState>((set, get) => {
  const send = async (req: SimRequest) => {
    const res = await simRequest(req)
    if (res.type === 'state') set({ sim: res, error: null })
    else if (res.type === 'probe') set({ probe: res.signature, error: null })
    else set({ error: res.message })
  }
  return {
    source: null,
    doc: null,
    problems: [],
    gpio: {},
    env: {},
    sim: null,
    probe: null,
    error: null,
    async open(source, doc) {
      const problems = validateDoc(doc, partDef)
      set({ source, doc, problems, gpio: {}, env: {}, sim: null, probe: null, error: null })
      if (problems.length === 0) await send({ type: 'load', doc })
    },
    async setGpio(bcm, state) {
      set({ gpio: { ...get().gpio, [bcm]: state } })
      await send({ type: 'gpio', bcm, state })
    },
    async setInput(part, key, value) {
      const env = get().env
      set({ env: { ...env, [part]: { ...env[part], [key]: value } } })
      await send({ type: 'input', part, key, value })
    },
    async advance(seconds) {
      const t = (get().sim?.snapshot.t ?? 0) + seconds
      await send({ type: 'advance', t })
    },
    async runProbe() {
      await send({ type: 'probe', pins: USER_GPIOS })
    }
  }
})
