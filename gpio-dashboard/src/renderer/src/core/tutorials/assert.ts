// Runs a tutorial's sim assertions (SPEC 13.1), each on a fresh session of the tutorial's circuit.
import type { CircuitDoc } from '../model/types'
import type { PartDefs } from '../netlist/netlist'
import { BEHAVIORS } from '../sim/behaviors'
import { Circuit, type GpioState } from '../sim/circuit'
import { SimSession } from '../sim/session'
import type { Assertion } from './tutorial'

const inRange = (v: number, r: { min?: number; max?: number }) =>
  (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max)

const rangeText = (r: { min?: number; max?: number }) =>
  [r.min !== undefined ? `≥ ${r.min}` : '', r.max !== undefined ? `≤ ${r.max}` : '']
    .filter(Boolean)
    .join(' and ')

/** An assertion's GPIO setting as simulator stimulus; PWM starts when it is set. */
function gpioState(s: Assertion['gpio'][string], now: number): GpioState {
  if (s.mode === 'in') return s
  return s.pwm
    ? { mode: 'out', level: s.level, pwm: { ...s.pwm, startS: now } }
    : { mode: 'out', level: s.level }
}

/** View values match exactly, except numbers, which match to a part in a billion. */
const sameValue = (got: unknown, want: unknown) =>
  typeof got === 'number' && typeof want === 'number'
    ? Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want))
    : JSON.stringify(got) === JSON.stringify(want)

const hex = (address: number) => `0x${address.toString(16)}`

/** The failures of one assertion; an empty list means it holds. */
export function runAssertion(doc: CircuitDoc, defs: PartDefs, a: Assertion): string[] {
  const session = new SimSession(new Circuit(doc, defs, BEHAVIORS))
  const failures: string[] = []
  let t = 0
  for (const step of [{ ...a, i2c: [] }, ...a.sequence]) {
    for (const [bcm, state] of Object.entries(step.gpio)) {
      session.setGpio(Number(bcm), gpioState(state, t))
    }
    for (const [part, values] of Object.entries(step.inputs)) {
      for (const [key, value] of Object.entries(values)) session.setInput(part, key, value)
    }
    for (const op of step.i2c) {
      if (!session.i2cWrite(op.address, op.write)) {
        failures.push(`I2C write to ${hex(op.address)} was not acknowledged`)
      }
    }
    if (step.advanceS > 0) session.advanceTo((t += step.advanceS))
  }
  return [...failures, ...expectationFailures(session, a.expect)]
}

/** Which of `expect` do not hold on the session now; an empty list means all hold. */
export function expectationFailures(session: SimSession, expect: Assertion['expect']): string[] {
  const snap = session.snapshot()
  if (snap.error) return [`simulation error: ${snap.error}`]
  const failures: string[] = []
  for (const e of expect) {
    if ('die' in e) {
      const die = snap.dies[e.die]
      if (!die) failures.push(`no LED die ${e.die}`)
      else if (!inRange(die.currentA, e.currentA))
        failures.push(`${e.die} carries ${die.currentA} A, want ${rangeText(e.currentA)}`)
    } else if ('read' in e) {
      const got = session.read(e.read)
      if (got !== e.is) failures.push(`GPIO${e.read} reads ${got}, want ${e.is}`)
    } else if ('pin' in e) {
      const [part, pin] = e.pin.split('.') as [string, string]
      const node = session.circuit.pinNode(part, pin)
      const net = [...session.circuit.nodeOfNet].find(([, n]) => n === node)?.[0]
      const v = net === undefined ? NaN : snap.nets[net]!
      if (!inRange(v, e.volts)) failures.push(`${e.pin} is at ${v} V, want ${rangeText(e.volts)}`)
    } else if ('gpio' in e) {
      const i = snap.gpio[e.gpio]?.currentA ?? 0
      if (!inRange(i, e.currentA))
        failures.push(`GPIO${e.gpio} sources ${i} A, want ${rangeText(e.currentA)}`)
    } else if ('i2cRead' in e) {
      const bytes = session.i2cRead(e.i2cRead, e.bytes.length)
      if (!bytes) failures.push(`I2C read from ${hex(e.i2cRead)} was not acknowledged`)
      else {
        e.bytes.forEach((r, i) => {
          if (!inRange(bytes[i]!, r)) {
            failures.push(
              `I2C byte ${i} from ${hex(e.i2cRead)} is ${bytes[i]}, want ${rangeText(r)}`
            )
          }
        })
      }
    } else {
      const view = snap.parts[e.part]
      for (const [key, want] of Object.entries(e.view)) {
        if (!sameValue(view?.[key], want)) {
          failures.push(
            `${e.part}.${key} is ${JSON.stringify(view?.[key])}, want ${JSON.stringify(want)}`
          )
        }
      }
    }
  }
  return failures
}
