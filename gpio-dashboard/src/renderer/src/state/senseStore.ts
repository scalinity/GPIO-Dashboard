// Board Sense in the app (SPEC 14.5): switched on and off only from the Board tab, fed by the Pi's
// sweeps or by the mock agent (a simulated board), and reconciled against the open document.
import { create } from 'zustand'
import type { Ranked } from '../core/sense/candidates'
import {
  Reconciler,
  interpret,
  type NetState,
  type SenseEvent,
  type Sweep
} from '../core/sense/sense'
import type { CircuitDoc } from '../core/model/types'
import {
  onSenseEvent,
  onSweep,
  pauseSensing,
  resumeSensing,
  SENSE_TIMING,
  startSensing,
  stopSensing
} from '../native/sense'
import { simRequest } from './simClient'
import { useWorkbench } from './workbenchStore'

export type SenseMode = 'off' | 'pi' | 'mock'

interface SenseState {
  mode: SenseMode
  states: [number, NetState][]
  events: SenseEvent[]
  errors: string[]
  candidates: Record<number, Ranked[] | 'working'>
  /** The mock's physical board; the open document unless a test or the walkthrough changes it. */
  mockBoard: CircuitDoc | null
  start(mode: 'pi' | 'mock'): Promise<void>
  stop(): Promise<void>
  findCauses(pin: number): Promise<void>
  /** Before a run on the Pi: true once the agent has confirmed it released every line. */
  pauseForRun(): Promise<boolean>
  resumeAfterRun(): Promise<void>
}

let reconciler: Reconciler | null = null
let lastSweep: Sweep | null = null
let unsubscribe: (() => void)[] = []
let timer: ReturnType<typeof setInterval> | null = null

const publish = () =>
  useSense.setState({
    states: reconciler ? [...reconciler.netStates] : [],
    events: reconciler ? [...reconciler.events] : []
  })

const take = (sweep: Sweep) => {
  lastSweep = sweep
  reconciler?.onSweep(sweep)
  publish()
}

/** The open document's predicted signature, from the sim worker. */
async function expected() {
  await useWorkbench.getState().runProbe()
  return useWorkbench.getState().probe
}

export const useSense = create<SenseState>((set, get) => ({
  mode: 'off',
  states: [],
  events: [],
  errors: [],
  candidates: {},
  mockBoard: null,
  async start(mode) {
    await get().stop()
    const signature = await expected()
    if (!signature) return
    reconciler = new Reconciler(signature)
    set({ mode, errors: [], candidates: {} })
    publish()
    if (mode === 'pi') {
      unsubscribe = [
        onSweep(take),
        onSenseEvent((e) => set({ errors: [...get().errors, e.message].slice(-20) }))
      ]
      await startSensing(signature.probed)
    } else {
      let t = 0
      timer = setInterval(async () => {
        const board = get().mockBoard ?? useWorkbench.getState().doc
        if (!board) return
        const res = await simRequest({
          type: 'mockSweep',
          board,
          pins: signature.probed,
          t: (t += 0.25)
        })
        if (res.type === 'sweep' && get().mode === 'mock') take(res.sweep)
      }, SENSE_TIMING.periodMs)
    }
  },
  async stop() {
    const mode = get().mode
    if (timer) clearInterval(timer)
    timer = null
    for (const u of unsubscribe) u()
    unsubscribe = []
    if (mode === 'pi') await stopSensing()
    reconciler = null
    lastSweep = null
    set({ mode: 'off', states: [], events: [], candidates: {} })
  },
  async findCauses(pin) {
    if (!lastSweep || !reconciler) return
    set({ candidates: { ...get().candidates, [pin]: 'working' } })
    const res = await simRequest({
      type: 'candidates',
      measured: interpret(lastSweep),
      pins: lastSweep.pins
    })
    if (res.type === 'candidates') set({ candidates: { ...get().candidates, [pin]: res.ranked } })
  },
  async pauseForRun() {
    if (get().mode !== 'pi') return true
    reconciler?.reset()
    publish()
    return pauseSensing()
  },
  async resumeAfterRun() {
    if (get().mode === 'pi') await resumeSensing()
  }
}))

// A different document is a different prediction: re-compare what was measured.
useWorkbench.subscribe((now, before) => {
  if (now.doc === before.doc || !reconciler) return
  void expected().then((signature) => {
    if (signature && reconciler) {
      reconciler.setExpected(signature)
      publish()
    }
  })
})
