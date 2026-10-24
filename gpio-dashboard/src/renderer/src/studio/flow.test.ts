// Lead currents from a snapshot (SPEC 11.5): conventional current runs from 3V3 through the Blinking
// LED's resistor and LED to GPIO17 when the pin is low, and the leads add up.
import { describe, expect, it } from 'vitest'
import { partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import { BEHAVIORS } from '../core/sim/behaviors'
import { Circuit } from '../core/sim/circuit'
import { SimSession } from '../core/sim/session'
import { wireCurrents } from './flow'

const tutorial = (id: string) => TUTORIALS.find((t) => t.meta.id === id)!.doc

function blinking(level: boolean) {
  const doc = tutorial('blinking-led')
  const session = new SimSession(new Circuit(doc, partDef, BEHAVIORS))
  session.setGpio(17, { mode: 'out', level })
  return { doc, snapshot: session.snapshot() }
}

describe('wireCurrents', () => {
  it('runs from 3V3 toward GPIO17 while the pin is low, the LED current in both leads', () => {
    const { doc, snapshot } = blinking(false)
    const led = snapshot.dies['D1.D']!.currentA
    expect(led).toBeGreaterThan(1e-3)
    const currents = wireCurrents(doc, snapshot, partDef, {})
    // W1 runs from the 3V3 strip (a) to the resistor (b); W2 from the LED's cathode (a) to GPIO17 (b).
    expect(currents.W1).toBeCloseTo(led, 6)
    expect(currents.W2).toBeCloseTo(led, 6)
  })

  it('carries nothing while the pin is high', () => {
    const { doc, snapshot } = blinking(true)
    const currents = wireCurrents(doc, snapshot, partDef, {})
    expect(Math.abs(currents.W1!)).toBeLessThan(1e-6)
    expect(Math.abs(currents.W2!)).toBeLessThan(1e-6)
  })

  it('gives the Button tutorial a current through each lead of its LED branch when pressed', () => {
    const doc = tutorial('button')
    const session = new SimSession(new Circuit(doc, partDef, BEHAVIORS))
    session.setGpio(17, { mode: 'out', level: false })
    session.setGpio(18, { mode: 'in', pull: 'up' })
    session.setInput('SW1', 'pressed', true)
    const snapshot = session.snapshot()
    const currents = wireCurrents(doc, snapshot, partDef, { SW1: { pressed: true } })
    const led = snapshot.dies['D1.D']!.currentA
    expect(currents.W1).toBeCloseTo(led, 6)
    expect(currents.W2).toBeCloseTo(led, 6)
    // The pull-up's current goes to GND through the pressed switch, not into GPIO18.
    expect(Math.abs(currents.W3!)).toBeGreaterThan(1e-4)
  })

  it('is empty when the simulation failed', () => {
    const { doc, snapshot } = blinking(false)
    expect(wireCurrents(doc, { ...snapshot, error: 'x' }, partDef, {})).toEqual({})
  })
})
