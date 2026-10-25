import { describe, expect, it } from 'vitest'
import { partDef } from '../defs/parts'
import { newDoc } from '../model/defaults'
import type { CircuitDoc, HoleRef, MainColumn, PartInstance } from '../model/types'
import { holeKey } from '../geometry/breadboard'
import { validateDoc } from '../ops/validate'
import { netlist } from '../netlist/netlist'
import {
  defaultSpan,
  free,
  freeInStrip,
  netHole,
  planLead,
  placeAuto,
  placementAt,
  resolvedLength,
  stripHoles
} from './placer'

const doc0 = () => newDoc('t', '2026-10-24T00:00:00.000Z')
const hole = (row: number, col: MainColumn): HoleRef => ({ board: 'bb1', area: 'main', row, col })

function withPart(
  doc: CircuitDoc,
  ref: string,
  defId: string,
  placement: PartInstance['placement']
) {
  const def = partDef(defId)
  const props = Object.fromEntries(Object.entries(def.properties).map(([k, p]) => [k, p.default]))
  return { ...doc, parts: [...doc.parts, { id: ref, defId, props, placement }] }
}

/** Places `defId` automatically and adds it, asserting the result is a valid document. */
function addAuto(doc: CircuitDoc, ref: string, defId: string): CircuitDoc {
  const placement = placeAuto(doc, partDef, partDef(defId))
  expect(placement, `${defId} fits`).not.toBeNull()
  const next = withPart(doc, ref, defId, placement!)
  expect(validateDoc(next, partDef)).toEqual([])
  return next
}

describe('free holes', () => {
  it('excludes the T-board pins and the holes under its stem', () => {
    const f = free(doc0())
    expect(f.has(hole(1, 'd'))).toBe(false) // pin 1
    expect(f.has(hole(1, 'e'))).toBe(false) // under the stem
    expect(f.has(hole(1, 'a'))).toBe(true)
    expect(f.has(hole(30, 'e'))).toBe(true)
    expect(f.has({ board: 'bb1', area: 'main', row: 99, col: 'a' })).toBe(false)
  })

  it('lists a strip in lead order and drops taken holes', () => {
    const doc = doc0()
    expect(stripHoles(doc, hole(30, 'c')).map(holeKey)).toEqual([
      'bb1:30a',
      'bb1:30b',
      'bb1:30c',
      'bb1:30d',
      'bb1:30e'
    ])
    expect(freeInStrip(doc, hole(6, 'a')).map(holeKey)).toEqual(['bb1:6a', 'bb1:6b', 'bb1:6c'])
    expect(freeInStrip(doc, hole(6, 'j')).map(holeKey)).toEqual(['bb1:6j', 'bb1:6i'])
  })
})

describe('T-board strips by net', () => {
  it('finds the strip of a GPIO and moves along it as holes fill', () => {
    let doc = doc0()
    expect(holeKey(netHole(doc, 'GPIO17')!)).toBe('bb1:6a') // pin 11 is in row 6, column d
    doc = withPart(doc, 'R1', 'resistor', {
      pins: { '1': hole(6, 'a'), '2': hole(10, 'a') }
    })
    expect(holeKey(netHole(doc, 'GPIO17')!)).toBe('bb1:6b')
  })

  it('uses the high half for even pins', () => {
    expect(holeKey(netHole(doc0(), 'GPIO18')!)).toBe('bb1:6j') // pin 12 is in row 6, column h
  })

  it('picks the GND strip nearest the other end', () => {
    const doc = doc0()
    const lowRow = holeKey(netHole(doc, 'GND', [0, 0])!)
    const highRow = holeKey(netHole(doc, 'GND', [165, 0])!)
    expect(lowRow).not.toBe(highRow)
    const row = (key: string) => Number(/:(\d+)/.exec(key)![1])
    expect(row(lowRow)).toBeLessThan(row(highRow))
  })

  it('answers null for a net the T-board does not carry', () => {
    expect(netHole(doc0(), 'GPIO99')).toBeNull()
  })
})

describe('automatic placement', () => {
  it('puts a flexible part in rows the T-board does not cover, in empty strips', () => {
    const doc = addAuto(doc0(), 'R1', 'resistor')
    const rows = Object.values(doc.parts[0]!.placement.pins).map((h) => (h as { row: number }).row)
    expect(Math.min(...rows)).toBeGreaterThanOrEqual(24)
    // The default span fits the body between the leads.
    expect(rows[1]! - rows[0]!).toBe(defaultSpan(partDef('resistor')))
  })

  it('keeps successive parts out of each others strips', () => {
    let doc = doc0()
    for (const [ref, id] of [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['D1', 'led'],
      ['Q1', 'pn2222'],
      ['U1', 'ic-74hc595'],
      ['SW1', 'tact-switch-6mm']
    ] as const)
      doc = addAuto(doc, ref, id)
    const strips = doc.parts.flatMap((p) =>
      Object.values(p.placement.pins).map((h) => stripHoles(doc, h!).map(holeKey).join())
    )
    // Only the tact switch's internally joined pairs may share a strip.
    expect(new Set(strips).size).toBeGreaterThanOrEqual(strips.length - 2)
  })

  it('straddles the trench with a DIP and a 0.6 inch display', () => {
    const doc = addAuto(addAuto(doc0(), 'U1', 'ic-74hc595'), 'DS1', 'seven-segment-cc')
    const dip = doc.parts[0]!.placement.pins
    expect(Object.values(dip).some((h) => h && 'col' in h && h.col === 'e')).toBe(true)
    expect(Object.values(dip).some((h) => h && 'col' in h && h.col === 'f')).toBe(true)
  })

  it('is deterministic', () => {
    const doc = addAuto(doc0(), 'R1', 'resistor')
    const a = placeAuto(doc, partDef, partDef('led'))
    const b = placeAuto(doc, partDef, partDef('led'))
    expect(a).toEqual(b)
  })

  it('searches outward from the related nets', () => {
    const doc = doc0()
    const near = placeAuto(doc, partDef, partDef('resistor'), { near: hole(50, 'a') })!
    const rows = Object.values(near.pins).map((h) => (h as { row: number }).row)
    expect(Math.abs(rows[0]! - 50)).toBeLessThanOrEqual(1)
  })

  it('seats an off-board module beside the board with no pins in holes', () => {
    const doc = addAuto(doc0(), 'HC1', 'hc-sr04')
    const part = doc.parts[0]!
    expect(Object.values(part.placement.pins).every((h) => h === null)).toBe(true)
    expect(part.placement.offboardPose).toBeDefined()
    const second = addAuto(doc, 'HC2', 'hc-sr04')
    expect(second.parts[1]!.placement.offboardPose).not.toEqual(part.placement.offboardPose)
  })

  it('stops with null when the boards are full', () => {
    let doc: CircuitDoc = {
      ...doc0(),
      boards: [{ id: 'bb1', defId: 'bb-400', transform: { position: [0, 0], rotationDeg: 0 } }]
    }
    let placed = 0
    for (; placed < 40; placed++) {
      const placement = placeAuto(doc, partDef, partDef('resistor'))
      if (!placement) break
      doc = withPart(doc, `R${placed + 1}`, 'resistor', placement)
      expect(validateDoc(doc, partDef)).toEqual([])
    }
    expect(placed).toBeGreaterThan(0)
    expect(placed).toBeLessThan(40)
    expect(placeAuto(doc, partDef, partDef('resistor'))).toBeNull()
  })
})

describe('placement at a named hole', () => {
  const led = partDef('led')
  const doc = doc0()

  it('runs a flexible part along rows, either way, or across columns', () => {
    const at = hole(30, 'e')
    const forward = placementAt(doc, partDef, led, at, 0, 2)
    expect(forward).toMatchObject({ placement: { pins: { A: at, K: hole(32, 'e') } } })
    const back = placementAt(doc, partDef, led, at, 180, 2)
    expect(back).toMatchObject({ placement: { pins: { K: hole(28, 'e') } } })
    // Three pitches from column e is column f, across the trench.
    const across = placementAt(doc, partDef, led, at, 90, 3)
    expect(across).toMatchObject({ placement: { pins: { K: hole(30, 'f') } } })
  })

  it('rejects a span the part cannot make and a column inside the trench', () => {
    expect(placementAt(doc, partDef, led, hole(30, 'e'), 0, 99)).toHaveProperty('error')
    expect(placementAt(doc, partDef, led, hole(30, 'e'), 90, 1)).toHaveProperty('error')
  })

  it('turns a rigid part in 90 degree steps', () => {
    const q = partDef('pn2222')
    const placed = placementAt(doc, partDef, q, hole(30, 'b'), 90)
    expect(placed).toHaveProperty('placement.rotationDeg', 90)
    const asDoc = withPart(
      doc,
      'Q1',
      'pn2222',
      (placed as { placement: PartInstance['placement'] }).placement
    )
    expect(validateDoc(asDoc, partDef)).toEqual([])
  })

  it('refuses a rail for a part that plugs into the main area', () => {
    const rail: HoleRef = { board: 'bb1', area: 'rail', rail: 'top+', index: 1 }
    expect(placementAt(doc, partDef, led, rail)).toHaveProperty('error')
  })
})

describe('leads', () => {
  const base = withPart(doc0(), 'R1', 'resistor', {
    pins: { '1': hole(30, 'b'), '2': hole(34, 'b') }
  })

  it('joins a net to a part pin with a male-male lead from the T-board strip', () => {
    const planned = planLead(base, partDef, { net: 'GPIO17' }, { partPin: { ref: 'R1', pin: '1' } })
    expect(planned).toHaveProperty('wire')
    const { wire } = planned as { wire: ReturnType<typeof Object> & { a: unknown; b: unknown } }
    expect(wire).toMatchObject({
      kind: 'dupont-mm',
      lengthMm: 200,
      a: { hole: hole(6, 'a') },
      b: { hole: hole(30, 'a') }
    })
    const doc = { ...base, wires: [{ id: 'W1', ...(wire as object) }] } as CircuitDoc
    expect(validateDoc(doc, partDef)).toEqual([])
    expect(netlist(doc, partDef).netOfPin.get('R1.1')).toBe('GPIO17')
  })

  it('colours supply leads and signal leads', () => {
    const gnd = planLead(base, partDef, { net: 'GND' }, { partPin: { ref: 'R1', pin: '2' } })
    expect(gnd).toMatchObject({ wire: { color: 'black' } })
    const v = planLead(base, partDef, { net: '3V3' }, { partPin: { ref: 'R1', pin: '2' } })
    expect(v).toMatchObject({ wire: { color: 'red' } })
    const sig = planLead(base, partDef, { net: 'GPIO4' }, { partPin: { ref: 'R1', pin: '2' } })
    expect(sig).toMatchObject({ wire: { color: 'yellow' } })
  })

  it('picks the kind from the connector genders of a module', () => {
    let doc = withPart(base, 'HC1', 'hc-sr04', {
      pins: { VCC: null, TRIG: null, ECHO: null, GND: null },
      offboardPose: { position: [60, 75], rotationDeg: 0 }
    })
    const male = planLead(doc, partDef, { net: '5V' }, { partPin: { ref: 'HC1', pin: 'VCC' } })
    expect(male).toMatchObject({
      wire: { kind: 'dupont-mf', b: { pin: { part: 'HC1', pin: 'VCC' } } }
    })
    doc = {
      ...doc,
      wires: [{ id: 'W1', ...(male as { wire: object }).wire } as CircuitDoc['wires'][number]]
    }
    expect(validateDoc(doc, partDef)).toEqual([])
    doc = withPart(doc, 'M1', 'sg90', {
      pins: Object.fromEntries(partDef('sg90').pins.map((p) => [p.id, null])),
      offboardPose: { position: [120, 75], rotationDeg: 0 }
    })
    const socket = partDef('sg90').pins[0]!
    const lead = planLead(doc, partDef, { net: 'GND' }, { partPin: { ref: 'M1', pin: socket.id } })
    // A female socket takes a male end; a male-pin module takes a female one.
    expect(lead).toMatchObject({
      wire: { kind: socket.connector === 'female-socket' ? 'dupont-mm' : 'dupont-mf' }
    })
  })

  it('reports why a lead cannot be made', () => {
    const cases: [Parameters<typeof planLead>[2], Parameters<typeof planLead>[3], RegExp][] = [
      [{ net: 'GPIO17' }, { net: 'GND' }, /short/],
      [{ net: 'BOGUS' }, { partPin: { ref: 'R1', pin: '1' } }, /not GND/],
      [{ net: 'GND' }, { partPin: { ref: 'R9', pin: '1' } }, /No part R9/],
      [{ net: 'GND' }, { partPin: { ref: 'R1', pin: 'X' } }, /no pin X/],
      [{ hole: hole(30, 'b') }, { net: 'GND' }, /taken/],
      [{ hole: hole(30, 'a') }, { hole: hole(30, 'c') }, /same strip/],
      [{ hole: { board: 'bb9', area: 'main', row: 1, col: 'a' } }, { net: 'GND' }, /not a hole/]
    ]
    for (const [from, to, message] of cases) {
      expect(planLead(base, partDef, from, to)).toMatchObject({
        error: expect.stringMatching(message)
      })
    }
  })

  it('does not hand the same hole to both ends', () => {
    const doc = withPart(base, 'R2', 'resistor', {
      pins: { '1': hole(40, 'b'), '2': hole(44, 'b') }
    })
    const planned = planLead(
      doc,
      partDef,
      { partPin: { ref: 'R1', pin: '2' } },
      { partPin: { ref: 'R2', pin: '1' } }
    )
    const { a, b } = (planned as { wire: { a: { hole: HoleRef }; b: { hole: HoleRef } } }).wire
    expect(holeKey(a.hole)).not.toBe(holeKey(b.hole))
  })

  it('resolves auto length from the inventory and keeps a given length', () => {
    const wire = {
      id: 'W1',
      a: { hole: hole(6, 'a') },
      b: { hole: hole(30, 'a') },
      color: 'yellow',
      kind: 'dupont-mm' as const,
      lengthMm: 'auto' as const
    }
    expect(resolvedLength(base, partDef, wire)).toBe(200)
    expect(resolvedLength(base, partDef, { ...wire, lengthMm: 123 })).toBe(123)
    expect(resolvedLength(base, partDef, { ...wire, kind: 'solid-flat' })).toBeGreaterThan(0)
  })
})
