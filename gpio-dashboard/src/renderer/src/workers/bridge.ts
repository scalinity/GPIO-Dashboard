// What the Python shims call (SPEC 13.2): GPIO, PWM, I2C and time, against a SimSession in virtual
// time (ADR-0017). Every call costs a little virtual time, so polling loops advance the clock;
// sleep advances it by the requested amount. Real time is the caller's concern (the worker waits
// sleep / timeScale between steps); this class only keeps the circuit's clock.
import type { EnvValue } from '../core/sim/behavior'
import type { GpioState } from '../core/sim/circuit'
import type { SimSession } from '../core/sim/session'

/** Virtual time one shim call takes: an RPi.GPIO call on a Pi 5 is on the order of microseconds. */
export const CALL_COST_S = 5e-6

export type Edge = 'rising' | 'falling' | 'both'

interface Watch {
  bcm: number
  edge: Edge
  /** The last level seen, to tell an edge. */
  level: boolean
  callback: ((bcm: number) => void) | null
  /** Set when an edge happened; event_detected() reads and clears it. */
  detected: boolean
}

export class Bridge {
  private readonly gpio = new Map<number, GpioState>()
  private readonly watches = new Map<number, Watch>()
  private inCallback = false

  constructor(
    readonly session: SimSession,
    /** Applies input changes made in the UI since the last call (the worker's mailbox). */
    private readonly drainInputs: () => void = () => {}
  ) {}

  now(): number {
    return this.session.time
  }

  /** The pins the program has set up as inputs. */
  inputPins(): number[] {
    return [...this.gpio].filter(([, s]) => s.mode === 'in').map(([bcm]) => bcm)
  }

  setup(bcm: number, mode: 'in' | 'out', pull: 'up' | 'down' | 'off' = 'off', initial = false) {
    const state: GpioState = mode === 'in' ? { mode, pull } : { mode, level: initial }
    this.gpio.set(bcm, state)
    this.session.setGpio(bcm, state)
    this.tick()
  }

  output(bcm: number, level: boolean) {
    const state = this.gpio.get(bcm)
    if (state?.mode !== 'out') throw new Error(`GPIO${bcm} is not set up as an output`)
    this.set(bcm, { ...state, level, pwm: undefined })
    this.tick()
  }

  /** The level an input reads; a floating or ambiguous pin reads as its last level settles it. */
  input(bcm: number): boolean {
    this.tick()
    const state = this.gpio.get(bcm)
    if (!state) throw new Error(`GPIO${bcm} is not set up`)
    if (state.mode === 'out') return state.level
    return this.session.read(bcm) === 'high'
  }

  pwm(bcm: number, frequencyHz: number, duty: number) {
    const state = this.gpio.get(bcm)
    if (state?.mode !== 'out') throw new Error(`GPIO${bcm} is not set up as an output`)
    const pwm = { frequencyHz, duty: Math.min(Math.max(duty, 0), 1), startS: this.now() }
    this.set(bcm, { ...state, level: false, pwm })
    this.tick()
  }

  pwmStop(bcm: number) {
    const state = this.gpio.get(bcm)
    if (state?.mode === 'out') this.set(bcm, { ...state, level: false, pwm: undefined })
    this.tick()
  }

  cleanup(bcm?: number) {
    for (const pin of bcm === undefined ? [...this.gpio.keys()] : [bcm]) {
      this.gpio.delete(pin)
      this.watches.delete(pin)
      this.session.setGpio(pin, { mode: 'in', pull: 'off' })
    }
  }

  /** Watches a pin for edges; the callback runs from the next shim call or sleep that sees one. */
  watch(bcm: number, edge: Edge, callback: ((bcm: number) => void) | null) {
    this.watches.set(bcm, { bcm, edge, level: this.input(bcm), callback, detected: false })
  }

  unwatch(bcm: number) {
    this.watches.delete(bcm)
  }

  eventDetected(bcm: number): boolean {
    this.tick()
    const w = this.watches.get(bcm)
    if (!w?.detected) return false
    w.detected = false
    return true
  }

  /**
   * Waits for an edge on a pin, up to timeoutS of virtual time (null waits forever), stepping
   * the clock in `stepS`. Returns whether the edge came.
   */
  waitForEdge(
    bcm: number,
    edge: Edge,
    timeoutS: number | null,
    step: (s: number) => void
  ): boolean {
    let level = this.input(bcm)
    const end = timeoutS === null ? Infinity : this.now() + timeoutS
    while (this.now() < end) {
      step(Math.min(1e-3, end - this.now()))
      const now = this.input(bcm)
      if (now !== level && (edge === 'both' || (edge === 'rising') === now)) return true
      level = now
    }
    return false
  }

  /** Runs virtual time forward by s, as time.sleep does. */
  sleep(s: number) {
    this.drainInputs()
    this.session.advanceTo(this.now() + Math.max(s, 0))
    this.checkEdges()
  }

  i2cWrite(address: number, bytes: number[]): boolean {
    this.tick()
    return this.session.i2cWrite(address, bytes)
  }

  i2cRead(address: number, count: number): number[] | null {
    this.tick()
    return this.session.i2cRead(address, count)
  }

  setInput(part: string, key: string, value: EnvValue) {
    this.session.setInput(part, key, value)
  }

  private set(bcm: number, state: GpioState) {
    this.gpio.set(bcm, state)
    this.session.setGpio(bcm, state)
  }

  /** One call's worth of virtual time, then any inputs and edges that arrived meanwhile. */
  private tick() {
    this.drainInputs()
    this.session.advanceTo(this.now() + CALL_COST_S)
    this.checkEdges()
  }

  private checkEdges() {
    if (this.inCallback) return
    for (const w of this.watches.values()) {
      const state = this.gpio.get(w.bcm)
      const level = state?.mode === 'out' ? state.level : this.session.read(w.bcm) === 'high'
      if (level === w.level) continue
      w.level = level
      if (w.edge !== 'both' && (w.edge === 'rising') !== level) continue
      w.detected = true
      if (w.callback) {
        this.inCallback = true
        try {
          w.callback(w.bcm)
        } finally {
          this.inCallback = false
        }
      }
    }
  }
}
