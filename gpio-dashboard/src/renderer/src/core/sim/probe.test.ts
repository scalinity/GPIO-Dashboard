// Probe-signature mode against hand-worked fixtures (SPEC 9, 14.5).
// Bench strips: 3V3 rows 1/9 a-e, GND row 5 a-e, GPIO17 row 6 a-e, GPIO27 row 7 a-e,
// GPIO18 row 6 f-j.
import { describe, expect, it } from 'vitest'
import { partDef } from '../defs/parts'
import type { CircuitDoc } from '../model/types'
import { at, emptyDoc, hole, part, wire } from '../testing/fixtures'
import { Circuit } from './circuit'
import { probeSignature } from './probe'

const sign = (doc: CircuitDoc, pins: number[]) =>
  probeSignature(new Circuit(doc, partDef, {}), pins)

/**
 * SPEC 14.5's example: a lead from j6 (GPIO18) to row 30, which has a 10 kΩ pull-up to 3V3 and a
 * button to GND. `leadRow` moves the lead's far end.
 */
function specExample(leadRow = 30) {
  const d = emptyDoc()
  const pins = Object.fromEntries(
    partDef('tact-switch-6mm').pins.map((p) => {
      const [x, y] = p.offsetPitch
      return [p.id, hole(40 + x, y === 0 ? 'e' : 'f')]
    })
  )
  d.parts.push(
    part('R1', 'resistor', { 1: hole(30, 'b'), 2: hole(34, 'b') }, { resistance: 10_000 }),
    part('SW1', 'tact-switch-6mm', pins)
  )
  d.wires.push(
    wire('W1', at(6, 'j'), at(leadRow, 'a')),
    wire('W2', at(34, 'a'), at(9, 'a')),
    wire('W3', at(30, 'c'), at(40, 'a')),
    wire('W4', at(42, 'a'), at(5, 'a'))
  )
  return d
}

describe('bias test', () => {
  it('reads the SPEC example as tied-high released, and the net as observable', () => {
    // Pulled down through 35–98 kΩ against 10 kΩ to 3.3 V: 3.3·35/45 = 2.57 V ≥ VIH 2.0.
    const s = sign(specExample(), [18])
    expect(s.bias[18]).toEqual({ up: 'high', down: 'high', class: 'tied-high' })
    expect(s.observable[18]).toBe(true)
  })

  it('reads tied-low with the button pressed', () => {
    const circuit = new Circuit(specExample(), partDef, {})
    const env = circuit.defaultEnv()
    env.get('SW1')!.pressed = true
    expect(probeSignature(circuit, [18], env).bias[18]!.class).toBe('tied-low')
  })

  it('follows the bias when the lead lands one row off, as an empty net would', () => {
    const s = sign(specExample(31), [18])
    expect(s.bias[18]!.class).toBe('follows-bias')
    expect(s.observable[18]).toBe(false)
  })

  it('cannot see an LED path: microamps through an LED land in the threshold band', () => {
    // GPIO17 → 220 Ω → red LED → GND. Under a 37–86 kΩ pull-up the LED passes ~20–45 µA and
    // sits near 1.6 V, between VIL 0.8 and VIH 2.0.
    const d = emptyDoc()
    d.parts.push(
      part('R1', 'resistor', { 1: hole(30, 'b'), 2: hole(34, 'b') }, { resistance: 220 }),
      part('D1', 'led', { A: hole(34, 'c'), K: hole(35, 'c') }, { color: 'red', size: '5mm' })
    )
    d.wires.push(wire('W1', at(6, 'a'), at(30, 'a')), wire('W2', at(35, 'd'), at(5, 'b')))
    const s = sign(d, [17])
    expect(s.bias[17]!.up).toBe('ambiguous')
    expect(s.bias[17]!.down).toBe('low')
    expect(s.observable[17]).toBe(false)
  })

  it('models the board pull-ups on GPIO2/3, so an empty GPIO2 reads tied-high', () => {
    // 1.8 kΩ to 3.3 V against a 35–98 kΩ pull-down: 3.3·35/36.8 = 3.14 V.
    expect(sign(emptyDoc(), [2]).bias[2]!.class).toBe('tied-high')
  })
})

describe('pair test', () => {
  it('sees a lead joining two GPIOs: each follows the other', () => {
    const d = emptyDoc()
    d.wires.push(wire('W1', at(6, 'a'), at(7, 'a')))
    const s = sign(d, [17, 27])
    expect(s.pairs[17]!.up[27]).toBe('follows')
    expect(s.pairs[27]!.down[17]).toBe('follows')
    expect(s.bias[17]!.class).toBe('follows-bias')
    expect(s.observable).toEqual({ 17: true, 27: true })
  })

  it('lets an isolated net hold its precharge, as it does on the board', () => {
    const s = sign(emptyDoc(), [17, 27])
    expect(s.pairs[17]!.up[27]).toBe('holds')
    expect(s.pairs[17]!.down[27]).toBe('holds')
    expect(s.pairs[17]!.up[17]).toBe('follows')
    expect(s.observable).toEqual({ 17: false, 27: false })
  })

  it('sees two GPIOs joined through 10 kΩ, well below the pulls', () => {
    const d = emptyDoc()
    d.parts.push(
      part('R1', 'resistor', { 1: hole(30, 'b'), 2: hole(34, 'b') }, { resistance: 10_000 })
    )
    d.wires.push(wire('W1', at(6, 'a'), at(30, 'a')), wire('W2', at(7, 'a'), at(34, 'a')))
    // 27 is released (no bias) and only its capacitance holds it, so 10 kΩ drags it along.
    expect(sign(d, [17, 27]).pairs[17]!.up[27]).toBe('follows')
  })
})

describe('skipping', () => {
  it('never probes a net with a transistor base on it, and says why', () => {
    const d = emptyDoc()
    d.parts.push(part('Q1', 'pn2222', { 1: hole(40, 'a'), 2: hole(41, 'a'), 3: hole(42, 'a') }))
    d.wires.push(wire('W1', at(6, 'b'), at(41, 'b')))
    const s = sign(d, [17, 27])
    expect(s.probed).toEqual([27])
    expect(s.skipped).toEqual([
      { bcm: 17, reason: 'Q1.2 is a transistor base, which bias edges would switch' }
    ])
  })
})
