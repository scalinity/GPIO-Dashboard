// Mixed-mode behavioural parts (SPEC 9). Digital events step these state machines and analog
// solves run between events. A behaviour sees its own pins' voltages and answers with drives
// (Thévenin outputs) and loads (resistances between its own pins); the circuit stamps both into
// the next solve. Behaviours never see the solver.
import type { PartDef } from '../model/types'

/** A pin driven to `volts` above pin `ref` through `ohms`. */
export interface Drive {
  ref: string
  volts: number
  ohms: number
}

/** A resistance between two of the part's pins: supply draw, a pull, a relay contact, a key. */
export interface Load {
  a: string
  b: string
  ohms: number
}

export type EnvValue = number | boolean | string

export interface BehaviorIo {
  /** Simulation time in seconds; it never decreases between calls. */
  t: number
  /** A pin's voltage relative to circuit ground, from the latest solve. */
  v(pin: string): number
  /** Environment and user inputs for this part, seeded from its props (temperatureC, x, ...). */
  env: Readonly<Record<string, EnvValue>>
}

export interface Behavior {
  /** Advances state to io.t. Called after every analog solve and at each time nextEvent asks for. */
  update(io: BehaviorIo): void
  /** Driven pins by pin id. Pins not listed are high-impedance inputs. */
  drives(): Record<string, Drive>
  loads(): Load[]
  /** The next time this behaviour changes by itself (a timer), or Infinity. */
  nextEvent(): number
  /** What the UI shows (display RAM, servo angle, relay state); JSON-serialisable. */
  view(): Record<string, unknown>
  /** Present when the part sits on an I2C bus; driven at transaction level (smbus). */
  i2c?: I2cDevice
}

/** A device on an I2C bus, at transaction level. Unpowered devices NACK everything. */
export interface I2cDevice {
  /** The 7-bit address the device answers to, or null while unpowered. */
  address(): number | null
  /** A write transaction; false is a NACK. */
  write(bytes: number[]): boolean
  /** A read transaction of `count` bytes; null is a NACK. */
  read(count: number): number[] | null
}

export type BehaviorFactory = (def: PartDef, props: Record<string, unknown>) => Behavior

/** Logic level with hysteresis: high at or above vih, low at or below vil, else unchanged. */
export function logicLevel(volts: number, vil: number, vih: number, previous: boolean): boolean {
  if (volts >= vih) return true
  if (volts <= vil) return false
  return previous
}

/** A number from a part's sim params, or an error naming the part and key. */
export function param(def: PartDef, key: string): number {
  const v = def.sim.params[key]
  if (typeof v !== 'number') throw new Error(`${def.id}: sim param ${key} is missing`)
  return v
}
