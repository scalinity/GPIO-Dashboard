// Nets from strips, rails, wires, parts and the T-board (SPEC 8, D15).
import { describe, expect, it } from 'vitest'
import { at, emptyDoc, fixtureDefs, hole, part, wire } from '../testing/fixtures'
import { netlist, occupancy } from './netlist'

const nets = (doc = emptyDoc()) => netlist(doc, fixtureDefs)

describe('netlist of the bench T-board alone', () => {
  const n = nets()

  it('joins all 8 GND pins, both 3V3 pins and both 5V pins into one net each', () => {
    expect(n.byName.get('GND')!.headerPins).toEqual([6, 9, 14, 20, 25, 30, 34, 39])
    expect(n.byName.get('3V3')!.headerPins).toEqual([1, 17])
    expect(n.byName.get('5V')!.headerPins).toEqual([2, 4])
  })

  it('names each GPIO net after its BCM number, through the T-board strip it lands on', () => {
    // Pin 11 (GPIO17) is at 6d on the bench placement; pin 12 (GPIO18) at 6h.
    expect(n.netOfStrip.get('bb1:6a-e')).toBe('GPIO17')
    expect(n.netOfStrip.get('bb1:6f-j')).toBe('GPIO18')
    expect(n.netOfStrip.get('bb1:1a-e')).toBe('3V3')
    expect(n.netOfStrip.get('bb1:9a-e')).toBe('3V3')
    expect(n.byName.get('GPIO17')!.names).toEqual(['GPIO17'])
  })

  it('has 28 GPIO nets and no anonymous nets', () => {
    expect(n.nets.filter((net) => net.name.startsWith('GPIO'))).toHaveLength(28)
    expect(n.nets.some((net) => /^N\d/.test(net.name))).toBe(false)
  })
})

describe('netlist of a circuit (D15: the baseline had no connectivity model)', () => {
  // The kit's Blinking LED: 3V3 -> 220 Ω -> LED anode, cathode -> GPIO17 (active low).
  const doc = emptyDoc()
  doc.parts.push(
    part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: hole(34, 'a') }),
    part('D1', 'test-led', { A: hole(34, 'c'), K: hole(35, 'c') })
  )
  doc.wires.push(wire('W1', at(1, 'a'), at(30, 'c')), wire('W2', at(35, 'a'), at(6, 'a')))
  const n = nets(doc)

  it('carries 3V3 through the lead to the resistor, and GPIO17 back from the cathode', () => {
    expect(n.netOfPin.get('R1.1')).toBe('3V3')
    expect(n.netOfPin.get('D1.K')).toBe('GPIO17')
  })

  it('joins the resistor and the LED anode in their shared strip, as an unnamed net', () => {
    expect(n.netOfPin.get('R1.2')).toBe(n.netOfPin.get('D1.A'))
    expect(n.netOfPin.get('R1.2')).toBe('N1')
  })

  it('keeps one hole per lead', () => {
    expect(occupancy(doc).conflicts).toEqual([])
  })

  it('treats a lead one row off as a different net', () => {
    const off = structuredClone(doc)
    off.wires[1] = wire('W2', at(35, 'a'), at(7, 'a')) // row 7 a-e is pin 13, GPIO27
    expect(nets(off).netOfPin.get('D1.K')).toBe('GPIO27')
  })
})

describe('netlist edge cases', () => {
  it('joins a tact switch through its always-connected pairs', () => {
    const doc = emptyDoc()
    doc.parts.push(
      part('SW1', 'test-button', {
        1: hole(40, 'e'),
        2: hole(40, 'f'),
        3: hole(42, 'e'),
        4: hole(42, 'f')
      })
    )
    const n = nets(doc)
    expect(n.netOfPin.get('SW1.1')).toBe(n.netOfPin.get('SW1.2'))
    expect(n.netOfPin.get('SW1.3')).toBe(n.netOfPin.get('SW1.4'))
    expect(n.netOfPin.get('SW1.1')).not.toBe(n.netOfPin.get('SW1.3'))
  })

  it('carries a rail along its whole length', () => {
    const doc = emptyDoc()
    doc.wires.push(
      wire('W1', at(1, 'a'), { hole: { board: 'bb1', area: 'rail', rail: 'bottom+', index: 0 } }),
      wire('W2', { hole: { board: 'bb1', area: 'rail', rail: 'bottom+', index: 49 } }, at(50, 'a'))
    )
    expect(nets(doc).netOfStrip.get('bb1:50a-e')).toBe('3V3')
  })

  it('reports two named nets joined by a lead as one net carrying both names', () => {
    const doc = emptyDoc()
    doc.wires.push(wire('W1', at(6, 'a'), at(5, 'a'))) // GPIO17 strip to the GND strip (pin 9 at 5d)
    const short = nets(doc).byName.get('GND')!
    expect(short.names).toEqual(['GND', 'GPIO17'])
    expect(nets(doc).byName.has('GPIO17')).toBe(false)
  })

  it('reaches an off-board module pin through a lead that ends on it', () => {
    const doc = emptyDoc()
    doc.parts.push(part('U1', 'test-module', { VCC: null, OUT: null, GND: null }))
    doc.wires.push(wire('W1', at(6, 'b'), { pin: { part: 'U1', pin: 'OUT' } }, 'dupont-mf'))
    expect(nets(doc).netOfPin.get('U1.OUT')).toBe('GPIO17')
  })

  it('lists a hole claimed twice as a conflict', () => {
    const doc = emptyDoc()
    doc.wires.push(wire('W1', at(30, 'a'), at(31, 'a')), wire('W2', at(30, 'a'), at(32, 'a')))
    const { conflicts } = occupancy(doc)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.occupants.map((o) => (o.kind === 'wire' ? o.wire : ''))).toEqual([
      'W1',
      'W2'
    ])
  })

  it('counts a lead in a T-board pin hole as a conflict with the T-board', () => {
    const doc = emptyDoc()
    doc.wires.push(wire('W1', at(6, 'd'), at(30, 'a')))
    expect(occupancy(doc).conflicts[0]!.occupants[0]).toEqual({ kind: 'tboard', pin: 11 })
  })
})
