// A running simulation (SPEC 9): stimulus in, snapshots out. Digital events (GPIO writes, PWM
// edges a behaviour listens to, behaviour timers) step the behaviours; between events the analog
// circuit is solved at its operating point. A PWM output no behaviour listens to is shown at its
// average: the snapshot weights the solve of every on/off combination by its duty.
import { RP1, outputResistanceOhm } from '../constants/rp1'
import type { EnvValue } from './behavior'
import type { Circuit, GpioState } from './circuit'
import { TheveninSource } from './devices'

export interface Snapshot {
  t: number
  /** Volts on each net, by net name (time-averaged over PWM). */
  nets: Record<string, number>
  /** Each LED die's current and its brightness relative to the datasheet test current. */
  dies: Record<string, { currentA: number; brightness: number }>
  /** Each GPIO's voltage and the current flowing out of the pin into its net. */
  gpio: Record<number, { volts: number; currentA: number }>
  /** Current drawn from the Pi's supplies. */
  rails: { '3V3': number; '5V': number }
  /** Behavioural parts' views. */
  parts: Record<string, Record<string, unknown>>
  /** Set when more than MAX_EXACT_PWM unlistened PWM outputs forced an average-voltage solve. */
  approximate: boolean
  error: string | null
}

/** Up to this many averaged PWM outputs are combined exactly (2^n solves). */
const MAX_EXACT_PWM = 4
const MAX_SETTLE_ITERATIONS = 25
const SETTLE_RELTOL = 1e-6

export class SimSession {
  private t = 0
  private x: Float64Array | undefined
  private readonly gpio = new Map<number, GpioState>()
  private readonly env: Map<string, Record<string, EnvValue>>
  private error: string | null = null
  /** GPIOs whose nets reach a behavioural part's pin: their PWM is stepped edge by edge. */
  private readonly listened: Set<number>

  constructor(readonly circuit: Circuit) {
    this.env = circuit.defaultEnv()
    const behaviorNodes = new Set(circuit.behaviors.flatMap((b) => [...b.pinNode.values()]))
    this.listened = new Set(
      [...circuit.gpioNodes].filter(([, node]) => behaviorNodes.has(node)).map(([bcm]) => bcm)
    )
    this.settle()
  }

  get time(): number {
    return this.t
  }

  setGpio(bcm: number, state: GpioState) {
    this.gpio.set(bcm, state)
    this.settle()
  }

  setInput(part: string, key: string, value: EnvValue) {
    this.env.get(part)![key] = value
    this.settle()
  }

  /**
   * The level a GPIO input reads: LOW at or below VIL, HIGH at or above VIH, ambiguous between,
   * and floating when nothing holds the pin: its Thévenin resistance is high enough that the
   * datasheet's input leakage alone could move it past VIL.
   */
  read(bcm: number): 'low' | 'high' | 'ambiguous' | 'floating' {
    const node = this.circuit.gpioNodes.get(bcm)
    if (node === undefined || !this.x) return 'floating'
    const v = this.v(node)
    if (this.theveninOhms(node) * RP1.inputLeakageMaxA > RP1.vilMaxV) return 'floating'
    return v <= RP1.vilMaxV ? 'low' : v >= RP1.vihMinV ? 'high' : 'ambiguous'
  }

  /** A node's resistance to the rest of the circuit, from its response to a 1 nA test current. */
  private theveninOhms(node: number): number {
    const testA = 1e-9
    // A 1000 V source behind 1 TΩ is a 1 nA current source to within 1e-12 S.
    const probe = new TheveninSource(node, 0, testA * 1e12, 1e12)
    const envOf = (part: string) => this.env.get(part)!
    const { x } = this.circuit.solve(this.instantaneous(), envOf, this.x, this.averagedPwm(), [
      probe
    ])
    return ((node === 0 ? 0 : x[node - 1]!) - this.v(node)) / testA
  }

  /**
   * The I2C device at `address` on the Pi's bus: its SDA and SCL pins must share nets with GPIO2
   * and GPIO3, as on the board. A device off the bus, or unpowered, does not answer.
   */
  private i2cDevice(address: number) {
    const c = this.circuit
    const sda = c.gpioNodes.get(2)
    const scl = c.gpioNodes.get(3)
    for (const { part, behavior, pinNode } of c.behaviors) {
      if (!behavior.i2c || behavior.i2c.address() !== address) continue
      const pins = c.defs(c.doc.parts.find((p) => p.id === part)!.defId).pins
      const node = (label: string) => pinNode.get(pins.find((p) => p.label === label)?.id ?? '')
      if (node('SDA') === sda && node('SCL') === scl) return behavior.i2c
    }
    return null
  }

  /** A write transaction (smbus); false is a NACK. Behaviours settle at the current time after it. */
  i2cWrite(address: number, bytes: number[]): boolean {
    const ok = this.i2cDevice(address)?.write(bytes) ?? false
    this.settle()
    return ok
  }

  /** A read transaction (smbus); null is a NACK. */
  i2cRead(address: number, count: number): number[] | null {
    const bytes = this.i2cDevice(address)?.read(count) ?? null
    this.settle()
    return bytes
  }

  /** Runs behaviour timers and listened PWM edges up to t, settling at each, then at t. */
  advanceTo(t: number) {
    if (t < this.t) throw new Error(`Time runs forward: ${t} < ${this.t}`)
    for (;;) {
      const next = Math.min(this.nextBehaviorEvent(), this.nextPwmEdge())
      if (!(next <= t)) break
      this.t = next
      this.settle()
    }
    this.t = t
    this.settle()
  }

  private nextBehaviorEvent(): number {
    let next = Infinity
    for (const { behavior } of this.circuit.behaviors) {
      const e = behavior.nextEvent()
      if (e > this.t && e < next) next = e
    }
    return next
  }

  private nextPwmEdge(): number {
    let next = Infinity
    for (const bcm of this.listened) {
      const state = this.gpio.get(bcm)
      if (state?.mode !== 'out' || !state.pwm) continue
      const { frequencyHz, duty, startS } = state.pwm
      const period = 1 / frequencyHz
      const cycle = Math.floor((this.t - startS) / period)
      for (const edge of [cycle * period, (cycle + duty) * period, (cycle + 1) * period]) {
        const at = startS + edge
        if (at > this.t + 1e-12 && at < next) next = at
      }
    }
    return next
  }

  /** A PWM output's instantaneous level at the current time. */
  private pwmLevel(state: Extract<GpioState, { mode: 'out' }>): boolean {
    if (!state.pwm || this.t < state.pwm.startS) return state.level
    const { frequencyHz, duty, startS } = state.pwm
    const phase = ((this.t - startS) * frequencyHz) % 1
    return phase + 1e-9 < duty
  }

  /** The stimulus behaviours see: listened PWM pins at their instantaneous level. */
  private instantaneous(): Map<number, GpioState> {
    const out = new Map(this.gpio)
    for (const [bcm, state] of this.gpio) {
      if (state.mode === 'out' && state.pwm && this.listened.has(bcm)) {
        out.set(bcm, { ...state, level: this.pwmLevel(state), pwm: undefined })
      }
    }
    return out
  }

  /** Averaged PWM outputs (not listened, duty strictly between 0 and 1) and their duties. */
  private averagedPwm(): Map<number, number> {
    const out = new Map<number, number>()
    for (const [bcm, state] of this.gpio) {
      if (state.mode !== 'out' || !state.pwm || this.listened.has(bcm)) continue
      out.set(bcm, Math.min(Math.max(state.pwm.duty, 0), 1))
    }
    return out
  }

  private v(node: number): number {
    return node === 0 ? 0 : this.x![node - 1]!
  }

  /** Solve, update behaviours, and repeat until their drives and loads stop changing. */
  private settle() {
    const envOf = (part: string) => this.env.get(part)!
    const behaviors = this.circuit.behaviors
    const averaged = this.averagedPwm()
    try {
      let before = signature(behaviors)
      for (let i = 0; i < MAX_SETTLE_ITERATIONS; i++) {
        this.x = this.circuit.solve(this.instantaneous(), envOf, this.x, averaged).x
        for (const { part, behavior, pinNode } of behaviors) {
          behavior.update({ t: this.t, v: (pin) => this.v(pinNode.get(pin)!), env: envOf(part) })
        }
        const after = signature(behaviors)
        if (same(before, after)) {
          this.error = null
          return
        }
        before = after
      }
      this.error = `Behavioural parts did not settle within ${MAX_SETTLE_ITERATIONS} solves`
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    }
  }

  snapshot(): Snapshot {
    const c = this.circuit
    const envOf = (part: string) => this.env.get(part)!
    const pwm = [...this.averagedPwm()]
    const exact = pwm.length <= MAX_EXACT_PWM
    const combos = exact ? 2 ** pwm.length : 1
    const nets: Record<string, number> = {}
    const dies: Snapshot['dies'] = {}
    const gpio: Snapshot['gpio'] = {}
    const rails = { '3V3': 0, '5V': 0 }
    const base = this.instantaneous()
    try {
      for (let combo = 0; combo < combos; combo++) {
        const levels = new Map<number, number>()
        let weight = 1
        for (const [i, [bcm, duty]] of pwm.entries()) {
          const on = exact ? (combo >> i) & 1 : duty
          levels.set(bcm, on)
          if (exact) weight *= on ? duty : 1 - duty
        }
        if (weight === 0) continue
        const { x } = c.solve(base, envOf, this.x, levels)
        const v = (node: number) => (node === 0 ? 0 : x[node - 1]!)
        for (const [name, node] of c.nodeOfNet) nets[name] = (nets[name] ?? 0) + weight * v(node)
        for (const d of c.dies) {
          const key = `${d.part}.${d.die}`
          const i = (v(d.series.p) - v(d.series.n)) / d.series.ohms
          dies[key] = { currentA: (dies[key]?.currentA ?? 0) + weight * i, brightness: 0 }
        }
        for (const [bcm, node] of c.gpioNodes) {
          const i = pinCurrent(base.get(bcm), levels.get(bcm), v(node))
          gpio[bcm] = {
            volts: (gpio[bcm]?.volts ?? 0) + weight * v(node),
            currentA: (gpio[bcm]?.currentA ?? 0) + weight * i
          }
        }
        for (const [name, source] of c.supplies) {
          // Branch current flows into the + terminal; the supply delivers its negative.
          rails[name] -= weight * x[c.nodes - 1 + source.branchBase]!
        }
      }
    } catch (e) {
      return {
        t: this.t,
        nets: {},
        dies: {},
        gpio: {},
        rails,
        parts: this.views(),
        approximate: !exact,
        error: e instanceof Error ? e.message : String(e)
      }
    }
    for (const d of c.dies) {
      const entry = dies[`${d.part}.${d.die}`]!
      entry.brightness = Math.max(entry.currentA, 0) / d.ifTestA
    }
    return {
      t: this.t,
      nets,
      dies,
      gpio,
      rails,
      parts: this.views(),
      approximate: !exact,
      error: this.error
    }
  }

  private views(): Snapshot['parts'] {
    return Object.fromEntries(this.circuit.behaviors.map((b) => [b.part, b.behavior.view()]))
  }
}

/** Current out of a GPIO into its net, given its state and (for an averaged PWM pin) its level. */
function pinCurrent(
  state: GpioState | undefined,
  level: number | undefined,
  volts: number
): number {
  if (!state) return 0
  if (state.mode === 'out') {
    const high = level ?? (state.level ? 1 : 0)
    const ohms = outputResistanceOhm(high >= 0.5 ? 'high' : 'low', state.driveMa)
    return (RP1.vddioV * high - volts) / ohms
  }
  if (state.pull === 'up') return (RP1.vddioV - volts) / RP1.pullUpOhm.typ
  if (state.pull === 'down') return -volts / RP1.pullDownOhm.typ
  return 0
}

interface Signature {
  /** Which pins are driven and which pin pairs are loaded. */
  shape: string
  values: number[]
}

/** Every behaviour's drives and loads, to tell when they have stopped changing. */
function signature(behaviors: Circuit['behaviors']): Signature {
  const shape: string[] = []
  const values: number[] = []
  for (const { part, behavior } of behaviors) {
    for (const [pin, d] of Object.entries(behavior.drives())) {
      shape.push(`${part}.${pin}>${d.ref}`)
      values.push(d.volts, d.ohms)
    }
    for (const l of behavior.loads()) {
      shape.push(`${part}.${l.a}~${l.b}`)
      values.push(l.ohms)
    }
  }
  return { shape: shape.join(' '), values }
}

function same(a: Signature, b: Signature): boolean {
  return (
    a.shape === b.shape &&
    a.values.every((x, i) => {
      const y = b.values[i]!
      return Math.abs(x - y) <= SETTLE_RELTOL * Math.max(Math.abs(x), Math.abs(y), 1e-12)
    })
  )
}
