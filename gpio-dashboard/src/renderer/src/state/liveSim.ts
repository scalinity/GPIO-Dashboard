// The bench lit by the Pi's real pins (SPEC 11.5 "Live Pi state"): while the Inspect toggle is on, a
// simulation of the open document runs in a worker of its own with every pin set as the Pi
// reports it (an output at its level, an input with the pull pinctrl shows), and its snapshot
// replaces the Simulate snapshot on the stage. It never writes to the Pi, and the Workbench's own
// simulation, its GPIO states and the Sim panel are untouched.
//
// Telemetry arrives at up to 10 Hz and each pin change costs a solve and an ERC pass, so changes
// queue: the sim works through the newest state, and states that were overtaken are skipped.
import type { CircuitDoc } from '../core/model/types'
import type { GpioState } from '../core/sim/circuit'
import { circuit } from './circuit'
import { type LivePin, useLive } from './liveStore'
import { simChannel } from './simClient'
import { useStudio } from './studioStore'

const channel = simChannel()

let loaded: CircuitDoc | null = null
/** The state last sent for each pin, so only a changed pin costs a request. */
let sent = new Map<number, string>()
let pumping = false
let dirty = false

/** How the simulation sets a pin that the Pi reports like this. */
export function gpioStateOf(pin: LivePin): GpioState {
  return pin.direction === 'out'
    ? { mode: 'out', level: pin.level === 'high' }
    : { mode: 'in', pull: pin.pull === 'none' ? 'off' : pin.pull }
}

async function pump(): Promise<void> {
  if (pumping) {
    dirty = true
    return
  }
  pumping = true
  try {
    do {
      dirty = false
      const { live } = useStudio.getState()
      const { online, pins } = useLive.getState()
      if (!live || !online) {
        loaded = null
        sent = new Map()
        if (useLive.getState().sim) useLive.setState({ sim: null })
        break
      }
      const doc = circuit.getSnapshot()
      let last = null
      if (doc !== loaded) {
        last = await channel({ type: 'load', doc })
        loaded = doc
        sent = new Map()
      }
      for (const pin of Object.values(pins)) {
        const state = gpioStateOf(pin)
        const key = JSON.stringify(state)
        if (sent.get(pin.bcm) === key) continue
        last = await channel({ type: 'gpio', bcm: pin.bcm, state })
        sent.set(pin.bcm, key)
      }
      if (last?.type === 'state' && useStudio.getState().live)
        useLive.setState({
          sim: { snapshot: last.snapshot, issues: last.issues, reads: last.reads }
        })
    } while (dirty)
  } finally {
    pumping = false
  }
}

useLive.subscribe((now, before) => {
  if (now.pins !== before.pins || now.online !== before.online) void pump()
})
useStudio.subscribe((now, before) => {
  if (now.live !== before.live) void pump()
})
circuit.subscribe(() => {
  if (useStudio.getState().live) void pump()
})
