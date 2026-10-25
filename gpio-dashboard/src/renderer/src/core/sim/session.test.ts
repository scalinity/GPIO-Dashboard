// The simulator on whole circuits from the part library (SPEC 9, M3 exit: blink and button behave).
// Bench strips: 3V3 row 1 a-e, GND row 5 a-e and row 10 f-j, GPIO17 row 6 a-e, GPIO18 row 6 f-j.
import { describe, expect, it } from 'vitest'
import { partDef } from '../defs/parts'
import type { CircuitDoc, PartDef } from '../model/types'
import { at, CUSTOM_RES, emptyDoc, hole, part, wire } from '../testing/fixtures'
import type { BehaviorFactory } from './behavior'
import { BEHAVIORS } from './behaviors'
import { Circuit } from './circuit'
import { SimSession } from './session'

const FACTORIES = BEHAVIORS
const session = (
  doc: CircuitDoc,
  extra: Partial<Record<PartDef['sim']['model'], BehaviorFactory>> = {}
) => new SimSession(new Circuit(doc, partDef, { ...FACTORIES, ...extra }))

/** GPIO17 → 220 Ω → LED → GND. */
function blink(color = 'red') {
  const d = emptyDoc()
  d.parts.push(
    part('R1', 'resistor', { 1: hole(30, 'b'), 2: hole(34, 'b') }, { resistance: 220 }),
    part('D1', 'led', { A: hole(34, 'c'), K: hole(35, 'c') }, { color, size: '5mm' })
  )
  d.wires.push(wire('W1', at(6, 'a'), at(30, 'a')), wire('W2', at(35, 'd'), at(5, 'b')))
  return d
}

/** 3V3 → button → GPIO18, with a 10 kΩ pull-down to GND. */
function button() {
  const d = emptyDoc()
  const pins = Object.fromEntries(
    partDef('tact-switch-6mm').pins.map((p) => {
      const [x, y] = p.offsetPitch
      return [p.id, hole(40 + x, y === 0 ? 'e' : 'f')]
    })
  )
  d.parts.push(
    part('SW1', 'tact-switch-6mm', pins),
    part('R1', 'resistor', { 1: hole(42, 'h'), 2: hole(45, 'h') }, { resistance: 10_000 })
  )
  d.wires.push(
    wire('W1', at(1, 'a'), at(40, 'a')),
    wire('W2', at(6, 'j'), at(42, 'j')),
    wire('W3', at(10, 'j'), at(45, 'j'))
  )
  return d
}

describe('blink', () => {
  it('lights the LED with the current the ngspice fixture predicts, and darkens it', () => {
    const s = session(blink())
    s.setGpio(17, { mode: 'out', level: true })
    const on = s.snapshot()
    expect(on.error).toBeNull()
    // Same circuit as fixtures/ngspice.json "led-red-5mm": 5.49 mA.
    expect(on.dies['D1.D']!.currentA).toBeCloseTo(5.494e-3, 4)
    expect(on.gpio[17]!.currentA).toBeCloseTo(5.494e-3, 4)
    expect(on.dies['D1.D']!.brightness).toBeCloseTo(0.549, 2)
    s.setGpio(17, { mode: 'out', level: false })
    expect(s.snapshot().dies['D1.D']!.currentA).toBeLessThan(1e-9)
  })

  it('averages a PWM-driven LED: half duty is half the on-current', () => {
    const s = session(blink())
    s.setGpio(17, { mode: 'out', level: false, pwm: { frequencyHz: 1000, duty: 0.5, startS: 0 } })
    const snap = s.snapshot()
    expect(snap.approximate).toBe(false)
    expect(snap.dies['D1.D']!.currentA).toBeCloseTo(5.494e-3 / 2, 4)
  })

  it('draws a white LED dimmer than red from 3.3 V, as its higher Vf says', () => {
    const red = session(blink('red'))
    const white = session(blink('white'))
    red.setGpio(17, { mode: 'out', level: true })
    white.setGpio(17, { mode: 'out', level: true })
    expect(white.snapshot().dies['D1.D']!.currentA).toBeLessThan(
      red.snapshot().dies['D1.D']!.currentA / 2
    )
  })
})

describe('button with pull-down', () => {
  it('reads LOW released and HIGH pressed', () => {
    const s = session(button())
    s.setGpio(18, { mode: 'in', pull: 'off' })
    expect(s.read(18)).toBe('low')
    s.setInput('SW1', 'pressed', true)
    expect(s.read(18)).toBe('high')
    // 3.3 V across the 10 kΩ pull-down comes from the 3V3 rail.
    expect(s.snapshot().rails['3V3']).toBeCloseTo(3.3 / 10_000, 6)
    s.setInput('SW1', 'pressed', false)
    expect(s.read(18)).toBe('low')
  })

  it('reads an unpulled GPIO beside an LED as floating, without a convergence failure', () => {
    // GPIO17 is the LED's cathode net in this circuit; with nothing driving it, it floats.
    const d = blink()
    const s = session(d)
    s.setGpio(17, { mode: 'in', pull: 'off' })
    expect(s.read(17)).toBe('floating')
    expect(s.snapshot().error).toBeNull()
  })

  it('reports a released button with no pull as floating, and the internal pulls as levels', () => {
    const d = button()
    d.parts = d.parts.filter((p) => p.id !== 'R1')
    const s = session(d)
    s.setGpio(18, { mode: 'in', pull: 'off' })
    expect(s.read(18)).toBe('floating')
    s.setInput('SW1', 'pressed', true)
    expect(s.read(18)).toBe('high')
    s.setInput('SW1', 'pressed', false)
    s.setGpio(18, { mode: 'in', pull: 'up' })
    expect(s.read(18)).toBe('high')
    s.setGpio(18, { mode: 'in', pull: 'down' })
    expect(s.read(18)).toBe('low')
  })
})

describe('a part with no simulation model', () => {
  it('adds no devices, so the rest of the circuit still simulates', () => {
    const d = blink()
    // A custom part defined with simModel "none", sharing GPIO17's strip and a strip of its own.
    d.customParts = [{ ...CUSTOM_RES, id: 'custom-no-model', sim: { model: 'none', params: {} } }]
    d.parts.push(part('X1', 'custom-no-model', { 1: hole(6, 'c'), 2: hole(20, 'c') }))
    const s = session(d)
    s.setGpio(17, { mode: 'out', level: true })
    const on = s.snapshot()
    expect(on.error).toBeNull()
    expect(on.dies['D1.D']!.currentA).toBeCloseTo(5.494e-3, 4)
    expect(on.nets['GPIO17']).toBeGreaterThan(1)
  })
})

describe('parameterised resistances', () => {
  const divider = (defId: string, props: Record<string, unknown>) => {
    // 3V3 → part → node (row 40) → 10 kΩ → GND; GPIO17 reads the node.
    const d = emptyDoc()
    d.parts.push(
      part('X1', defId, { 1: hole(30, 'b'), 2: hole(40, 'b') }, props),
      part('R1', 'resistor', { 1: hole(40, 'c'), 2: hole(44, 'c') }, { resistance: 10_000 })
    )
    d.wires.push(
      wire('W1', at(1, 'a'), at(30, 'a')),
      wire('W2', at(44, 'a'), at(5, 'a')),
      wire('W3', at(40, 'a'), at(6, 'b'))
    )
    return session(d)
  }

  it('gives the NTC its R25 at 25 °C and the Beta-curve value at 0 °C', () => {
    const s = divider('ntc-10k', { temperatureC: 25 })
    s.setGpio(17, { mode: 'in', pull: 'off' })
    expect(s.snapshot().nets['GPIO17']).toBeCloseTo(1.65, 4)
    s.setInput('X1', 'temperatureC', 0)
    // Beta 3950: R(0 °C) = 10k · e^(3950 (1/273.15 − 1/298.15)) ≈ 33.6 kΩ.
    const r0 = 10_000 * Math.exp(3950 * (1 / 273.15 - 1 / 298.15))
    expect(s.snapshot().nets['GPIO17']).toBeCloseTo((3.3 * 10_000) / (r0 + 10_000), 3)
  })

  it('gives the LDR its 10-lux resistance and less in brighter light', () => {
    const s = divider('ldr', { lux: 10 })
    s.setGpio(17, { mode: 'in', pull: 'off' })
    expect(s.snapshot().nets['GPIO17']).toBeCloseTo((3.3 * 10_000) / 25_000, 3)
    s.setInput('X1', 'lux', 1000)
    expect(s.snapshot().nets['GPIO17']!).toBeGreaterThan(3)
  })
})

describe('displays', () => {
  it('lights one segment of a common-cathode 7-segment', () => {
    const d = emptyDoc()
    const def = partDef('seven-segment-cc')
    // Pin offsets [x, 0] sit in column c, [x, 6] in column i, from row 40.
    const spot = (id: string) => {
      const [x, y] = def.pins.find((p) => p.id === id)!.offsetPitch
      return { row: 40 + x, left: y === 0 }
    }
    const pins = Object.fromEntries(
      def.pins.map((p) => [p.id, hole(spot(p.id).row, spot(p.id).left ? 'c' : 'i')])
    )
    d.parts.push(part('U1', 'seven-segment-cc', pins))
    // Segment a is pin 7, COM pin 3 (and 8). Drive a from GPIO17 through 220 Ω; COM to GND.
    const a = spot('7')
    const com = spot('3')
    d.parts.push(
      part('R1', 'resistor', { 1: hole(30, 'b'), 2: hole(34, 'b') }, { resistance: 220 })
    )
    d.wires.push(
      wire('W1', at(6, 'a'), at(30, 'a')),
      wire('W2', at(34, 'a'), at(a.row, a.left ? 'a' : 'j')),
      wire('W3', at(com.row, com.left ? 'b' : 'g'), at(5, 'c'))
    )
    const s = session(d)
    s.setGpio(17, { mode: 'out', level: true })
    const snap = s.snapshot()
    expect(snap.error).toBeNull()
    expect(snap.dies['U1.a']!.currentA).toBeGreaterThan(4e-3)
    expect(snap.dies['U1.b']!.currentA).toBeLessThan(1e-9)
  })
})

describe('behavioural parts', () => {
  it('spins the DC motor from 5 V and reports its speed', () => {
    const d = emptyDoc()
    d.parts.push(part('M1', 'dc-motor', { red: null, black: null }))
    d.wires.push(
      wire('W1', at(1, 'j'), { pin: { part: 'M1', pin: 'red' } }, 'dupont-mf'),
      wire('W2', at(10, 'i'), { pin: { part: 'M1', pin: 'black' } }, 'dupont-mf')
    )
    const snap = session(d).snapshot()
    expect(snap.error).toBeNull()
    const view = snap.parts['M1'] as { spinning: boolean; rpm: number }
    expect(view.spinning).toBe(true)
    // (5 − 0.07·12) / k with k from the no-load point at 6 V: ≈ 7333 rpm.
    expect(view.rpm).toBeCloseTo((9100 * (5 - 0.84)) / (6 - 0.84), -1)
    expect(snap.rails['5V']).toBeCloseTo(0.07, 4)
  })

  it('steps a listening behaviour through PWM edges in time', () => {
    const rises: number[] = []
    const probe: BehaviorFactory = () => {
      let high = false
      return {
        update(io) {
          const now = io.v('PWM') > 1.65
          if (now && !high) rises.push(io.t)
          high = now
        },
        drives: () => ({}),
        loads: () => [],
        nextEvent: () => Infinity,
        view: () => ({})
      }
    }
    const d = emptyDoc()
    d.parts.push(part('S1', 'sg90', { GND: null, VCC: null, PWM: null }))
    d.wires.push(wire('W1', at(6, 'b'), { pin: { part: 'S1', pin: 'PWM' } }, 'dupont-mf'))
    const s = session(d, { sg90: probe })
    s.setGpio(17, { mode: 'out', level: false, pwm: { frequencyHz: 50, duty: 0.075, startS: 0 } })
    s.advanceTo(0.1)
    expect(rises.map((t) => Math.round(t * 1000))).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('switches a relay module from GPIO17 after its operate time, and the contact lights an LED', () => {
    // S from GPIO17 (row 6 a-e), + from 5V (row 1 f-j), − to GND (row 10 f-j); COM on 3V3
    // (row 9 a-e), NO → 220 Ω → LED → GND (row 5 a-e).
    const d = emptyDoc()
    const relay = Object.fromEntries(partDef('relay-module-5v').pins.map((p) => [p.id, null]))
    const pin = (id: string) => ({ pin: { part: 'K1', pin: id } })
    d.parts.push(
      part('K1', 'relay-module-5v', relay),
      part('R1', 'resistor', { 1: hole(30, 'b'), 2: hole(34, 'b') }, { resistance: 220 }),
      part('D1', 'led', { A: hole(34, 'c'), K: hole(35, 'c') }, { color: 'red', size: '5mm' })
    )
    d.wires.push(
      wire('W1', at(6, 'a'), pin('S'), 'dupont-mf'),
      wire('W2', at(1, 'j'), pin('+'), 'dupont-mf'),
      wire('W3', at(10, 'j'), pin('-'), 'dupont-mf'),
      wire('W4', at(9, 'a'), pin('COM')),
      wire('W5', at(30, 'a'), pin('NO')),
      wire('W6', at(35, 'a'), at(5, 'a'))
    )
    const s = session(d)
    s.setGpio(17, { mode: 'out', level: true })
    expect(s.snapshot().parts['K1']).toMatchObject({ coilDriven: true, energised: false })
    expect(s.snapshot().dies['D1.D']!.currentA).toBeLessThan(1e-9)
    // The Songle datasheet's operate time is at most 10 ms.
    s.advanceTo(0.011)
    const snap = s.snapshot()
    expect(snap.parts['K1']).toMatchObject({ energised: true, contact: 'NO' })
    expect(snap.dies['D1.D']!.currentA).toBeGreaterThan(5e-3)
    // The coil's 70 Ω on 5 V plus the 1 kΩ S input on GPIO17: the GPIO stays under its limit.
    expect(snap.gpio[17]!.currentA).toBeLessThan(4e-3)
  })
})
