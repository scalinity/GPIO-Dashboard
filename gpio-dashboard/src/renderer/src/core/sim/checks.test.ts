// Sim-based ERC rules fire on simulated currents above documented limits, and stay quiet below.
// Bench strips: GND row 5 a-e, GPIO17 row 6 a-e.
import { describe, expect, it } from 'vitest'
import { partDef } from '../defs/parts'
import { TUTORIALS } from '../defs/tutorials'
import type { CircuitDoc } from '../model/types'
import { at, emptyDoc, hole, part, wire } from '../testing/fixtures'
import { driveChecks, simChecks } from './checks'
import { Circuit } from './circuit'
import { SimSession } from './session'

/** GPIO17 → resistor → red LED → GND, driven high. */
function ledOn(ohms: number) {
  const d = emptyDoc()
  d.parts.push(
    part('R1', 'resistor', { 1: hole(30, 'b'), 2: hole(34, 'b') }, { resistance: ohms }),
    part('D1', 'led', { A: hole(34, 'c'), K: hole(35, 'c') }, { color: 'red', size: '5mm' })
  )
  d.wires.push(wire('W1', at(6, 'a'), at(30, 'a')), wire('W2', at(35, 'd'), at(5, 'b')))
  const s = new SimSession(new Circuit(d, partDef, {}))
  s.setGpio(17, { mode: 'out', level: true })
  return simChecks(d, partDef, s.snapshot()).map((i) => `${i.code}:${i.refs.join(',')}`)
}

describe('sim checks', () => {
  it('are quiet for an LED behind 220 Ω (about 5.5 mA)', () => {
    expect(ledOn(220)).toEqual([])
  })

  it('flag a pin and an LED driven through 10 Ω: the pin output resistance alone limits it', () => {
    // (3.3 − ~2.0 V) / (42 Ω + 10 Ω) ≈ 25 mA: over 16 mA per pin, under the 30 mA LED rating.
    expect(ledOn(10)).toEqual(['PIN_OVERCURRENT:GPIO17'])
  })

  it('flag the LED once its own rating is passed', () => {
    const d = emptyDoc()
    // 5V → 47 Ω → LED → GND: ≈ (5 − 2.1) / 49 ≈ 59 mA, twice the 30 mA rating.
    d.parts.push(
      part('R1', 'resistor', { 1: hole(30, 'g'), 2: hole(34, 'g') }, { resistance: 47 }),
      part('D1', 'led', { A: hole(34, 'h'), K: hole(35, 'h') }, { color: 'red', size: '5mm' })
    )
    d.wires.push(wire('W1', at(1, 'j'), at(30, 'j')), wire('W2', at(35, 'j'), at(10, 'j')))
    const s = new SimSession(new Circuit(d, partDef, {}))
    expect(simChecks(d, partDef, s.snapshot()).map((i) => i.code)).toEqual(['LED_NO_LIMIT'])
  })

  it('flag the 50 mA combined budget when several pins each stay under 16 mA', () => {
    const d = emptyDoc()
    // Four GPIOs each straight to GND through 220 Ω, driven high: ~12.5 mA each, ~50+ mA total.
    // GPIO17/27/22 are header pins 11/13/15 (rows 6/7/8 a-e); GPIO23 is pin 16 (row 8 f-j).
    const legs: [number, 'a' | 'j'][] = [
      [6, 'a'],
      [7, 'a'],
      [8, 'a'],
      [8, 'j']
    ]
    legs.forEach(([row, col], i) => {
      const r = 30 + i * 6
      const side = col === 'a' ? 'b' : 'i'
      d.parts.push(
        part(`R${i}`, 'resistor', { 1: hole(r, side), 2: hole(r + 4, side) }, { resistance: 220 })
      )
      d.wires.push(
        wire(`W${i}`, at(row, col), at(r, col)),
        wire(`G${i}`, at(r + 4, col), at(col === 'a' ? 5 : 10, col))
      )
    })
    const s = new SimSession(new Circuit(d, partDef, {}))
    for (const bcm of [17, 27, 22, 23]) s.setGpio(bcm, { mode: 'out', level: true })
    const issues = simChecks(d, partDef, s.snapshot())
    expect(issues.map((i) => i.code)).toEqual(['RAIL_BUDGET'])
    expect(issues[0]!.refs).toEqual(['GPIO17', 'GPIO22', 'GPIO23', 'GPIO27'])
  })
})

describe('driveChecks', () => {
  // 3V3 → resistor → LED → GPIO17: the cathode is on the pin, so LOW is the loaded state.
  const blink = TUTORIALS.find((t) => t.meta.id === 'blinking-led')!.doc
  const sink = (ohms: number): CircuitDoc => ({
    ...blink,
    parts: blink.parts.map((p) =>
      p.id === 'R1' ? { ...p, props: { ...p.props, resistance: ohms } } : p
    )
  })
  const keys = (doc: CircuitDoc, pins: number[]) =>
    driveChecks(doc, partDef, pins).map((i) => `${i.code}:${i.refs.join(',')}`)

  it('finds the overcurrent that only a LOW drive produces', () => {
    const s = new SimSession(new Circuit(sink(10), partDef, {}))
    s.setGpio(17, { mode: 'out', level: true })
    expect(simChecks(sink(10), partDef, s.snapshot())).toEqual([])
    expect(keys(sink(10), [17])).toEqual(['PIN_OVERCURRENT:GPIO17', 'LED_NO_LIMIT:D1'])
  })

  it('is quiet for 220 Ω, and for a pin the program does not drive', () => {
    expect(keys(sink(220), [17])).toEqual([])
    expect(keys(sink(10), [])).toEqual([])
  })

  it('keeps one issue per code and refs when HIGH and LOW both produce it', () => {
    // A second 10 Ω from GPIO17 (row 6) to GND (row 5) over-drives the pin when HIGH as well.
    const both = sink(10)
    both.parts.push(
      part('R2', 'resistor', { 1: hole(6, 'b'), 2: hole(5, 'b') }, { resistance: 10 })
    )
    const found = keys(both, [17])
    expect(found.filter((k) => k === 'PIN_OVERCURRENT:GPIO17')).toHaveLength(1)
    expect(found).toContain('LED_NO_LIMIT:D1')
  })
})
