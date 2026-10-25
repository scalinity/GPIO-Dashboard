// Live Pi state (SPEC 11.5, 14.4): the Pi's pins as telemetry last reported them, read only. The
// feed is the telemetry store (`gpio:state` events, deduplicated on the Rust side), seen through
// the connection: with no SSH session or no agent there is no state to show, so nothing stale is
// kept. The Studio paints these pins, a simulation of the open document with the pins' levels
// applied lights the bench, and `liveDivergence` compares them with what the document expects.
import { create } from 'zustand'
import type { Issue } from '../core/erc/erc'
import type { Snapshot } from '../core/sim/session'
import useConnectionStore from '../store/connectionStore'
import useGpioStore, { type PinTelemetry } from '../store/gpioStore'
import type { LiveDivergence } from './liveCheck'
import type { ReadLevel } from '../workers/simHost'

export type Level = 'high' | 'low'
/** pinctrl's function: an input, an output, an alternate function (I2C, SPI, UART…), or unset. */
export type Direction = 'in' | 'out' | 'alt' | 'none'

export interface LivePin {
  bcm: number
  level: Level
  direction: Direction
  pull: 'up' | 'down' | 'none'
  /** The alternate function's name ("SDA1"), where pinctrl reports one; else null. */
  function: string | null
  /** The process holding the line, where libgpiod reports one. */
  consumer: string | null
}

/** The simulation of the open document with the Pi's real pin states applied. */
export interface LiveSim {
  snapshot: Snapshot
  issues: Issue[]
  reads: Record<number, ReadLevel>
}

const DIRECTIONS: Record<string, Direction> = { IN: 'in', OUT: 'out', ALT: 'alt', NONE: 'none' }
const PULLS: Record<string, LivePin['pull']> = { UP: 'up', DOWN: 'down' }

/** One pin of a `gpio_state` frame, in the store's shape. */
export function livePinOf(t: PinTelemetry): LivePin {
  const direction = DIRECTIONS[String(t.direction).toUpperCase()] ?? 'none'
  return {
    bcm: Number(t.bcm),
    level: t.state === 'HIGH' ? 'high' : 'low',
    direction,
    pull: PULLS[String(t.pull).toUpperCase()] ?? 'none',
    function: direction === 'alt' && t.function ? t.function : null,
    consumer: t.consumer ?? null
  }
}

const same = (a: LivePin, b: LivePin) =>
  a.level === b.level &&
  a.direction === b.direction &&
  a.pull === b.pull &&
  a.function === b.function &&
  a.consumer === b.consumer

interface LiveState {
  /** The Pi is connected and its agent runs, so telemetry means something. */
  online: boolean
  /** Empty while offline. A pin whose state did not change keeps its object. */
  pins: Record<number, LivePin>
  /** The simulation of the open document with the real pins applied; null until it has run. */
  sim: LiveSim | null
  /** Where the real pins contradict the document, once a contradiction has held (liveDivergence). */
  divergences: LiveDivergence[]
}

export const useLive = create<LiveState>(() => ({
  online: false,
  pins: {},
  sim: null,
  divergences: []
}))

/** Brings the store onto the telemetry and the connection: changes only what differs. */
function follow(): void {
  const { status, agentStatus } = useConnectionStore.getState()
  const online = status === 'connected' && agentStatus === 'running'
  const before = useLive.getState()
  if (!online) {
    if (before.online || Object.keys(before.pins).length)
      useLive.setState({ online: false, pins: {}, sim: null, divergences: [] })
    // The telemetry store keeps its last frame; a new connection must not start from it.
    if (Object.keys(useGpioStore.getState().pins).length) useGpioStore.getState().clearPins()
    return
  }
  const pins: Record<number, LivePin> = {}
  let changed = !before.online
  for (const raw of Object.values(useGpioStore.getState().pins)) {
    const pin = livePinOf(raw)
    const old = before.pins[pin.bcm]
    pins[pin.bcm] = old && same(old, pin) ? old : pin
    if (pins[pin.bcm] !== old) changed = true
  }
  if (Object.keys(pins).length !== Object.keys(before.pins).length) changed = true
  if (changed) useLive.setState({ online: true, pins })
}

useGpioStore.subscribe((now, before) => {
  if (now.pins !== before.pins) follow()
})
useConnectionStore.subscribe((now, before) => {
  if (now.status !== before.status || now.agentStatus !== before.agentStatus) follow()
})
follow()
