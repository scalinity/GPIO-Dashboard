// The edits the Studio's gestures propose (SPEC 6.5, 6.6, 11.3): ids and defaults, seating by an
// anchor hole, turns, removals, leads from the inventory default, and the green/red glow.
import { describe, expect, it } from 'vitest'
import { partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import { newDoc } from '../core/model/defaults'
import type { CircuitDoc, HoleRef, MainColumn, Op } from '../core/model/types'
import { applyOps } from '../core/ops/apply'
import { validateDoc } from '../core/ops/validate'
import {
  holeFree,
  holeLegality,
  movedPart,
  newPart,
  newWire,
  nextId,
  removePartOps,
  seated,
  turnedPart
} from './placement'

const hole = (row: number, col: MainColumn): HoleRef => ({ board: 'bb1', area: 'main', row, col })
const empty = () => newDoc('Untitled', '2026-10-24T00:00:00.000Z')

function commit(doc: CircuitDoc, ops: Op[]): CircuitDoc {
  const next = applyOps(doc, ops).doc
  expect(validateDoc(next, partDef)).toEqual([])
  return next
}

describe('nextId', () => {
  it('takes the first free number for the prefix', () => {
    expect(nextId([], 'R')).toBe('R1')
    expect(nextId(['R1', 'R3', 'D2'], 'R')).toBe('R2')
  })
})

describe('newPart', () => {
  it('seats pin 1 in the anchor and the rest by the definition, with default props', () => {
    const r = newPart(empty(), 'resistor', { anchor: hole(30, 'b'), rotation: 0 })
    expect(r).toEqual({
      id: 'R1',
      defId: 'resistor',
      props: { resistance: 220, tolerance: '5%' },
      placement: { pins: { '1': hole(30, 'b'), '2': hole(31, 'b') } }
    })
    const led = newPart(empty(), 'led', { anchor: hole(34, 'c'), rotation: 90 })
    expect(led.id).toBe('D1')
    expect(led.placement.pins).toEqual({ A: hole(34, 'c'), K: hole(34, 'd') })
  })

  it('straddles the trench for a DIP-style part and records a rigid turn', () => {
    const sw = newPart(empty(), 'tact-switch-6mm', { anchor: hole(40, 'e'), rotation: 0 })
    expect(sw.placement.pins).toEqual({
      '1': hole(40, 'e'),
      '2': hole(40, 'f'),
      '3': hole(42, 'e'),
      '4': hole(42, 'f')
    })
    commit(empty(), [{ type: 'AddPart', part: sw }])
    const turned = newPart(empty(), 'active-buzzer', { anchor: hole(40, 'a'), rotation: 90 })
    expect(turned.placement).toEqual({
      pins: { '+': hole(40, 'a'), '-': hole(40, 'd') },
      rotationDeg: 90
    })
    commit(empty(), [{ type: 'AddPart', part: turned }])
  })

  it('leaves a pin unseated where the footprint runs off the board', () => {
    const sw = newPart(empty(), 'tact-switch-6mm', { anchor: hole(40, 'j'), rotation: 0 })
    expect(seated(sw.placement.pins)).toBe(false)
  })

  it('puts an off-board module on the table with no pins in holes', () => {
    const m = newPart(empty(), 'dht11-module', { pose: { position: [0, -60], rotationDeg: 0 } })
    expect(m.id).toBe('DHT1')
    expect(m.placement).toEqual({
      pins: { DATA: null, VCC: null, GND: null },
      offboardPose: { position: [0, -60], rotationDeg: 0 }
    })
    commit(empty(), [{ type: 'AddPart', part: m }])
  })
})

describe('moving and turning', () => {
  const r = newPart(empty(), 'resistor', { anchor: hole(30, 'b'), rotation: 0 })
  const doc = commit(empty(), [
    {
      type: 'AddPart',
      part: { ...r, placement: { pins: { '1': hole(30, 'f'), '2': hole(34, 'f') } } }
    }
  ])

  it('moves a part by its pin 1, keeping its span', () => {
    expect(movedPart(doc, doc.parts[0]!, hole(40, 'i')).placement.pins).toEqual({
      '1': hole(40, 'i'),
      '2': hole(44, 'i')
    })
  })

  it('turns a flexible part about pin 1 and a rigid one with its rotation', () => {
    expect(turnedPart(doc, doc.parts[0]!, 90).placement.pins).toEqual({
      '1': hole(30, 'f'),
      '2': hole(30, 'j')
    })
    expect(turnedPart(doc, doc.parts[0]!, -90).placement.pins).toEqual({
      '1': hole(30, 'f'),
      '2': hole(30, 'd')
    })
    const buzzer = newPart(doc, 'active-buzzer', { anchor: hole(40, 'a'), rotation: 0 })
    const withBuzzer = commit(doc, [{ type: 'AddPart', part: buzzer }])
    const turned = turnedPart(withBuzzer, withBuzzer.parts[1]!, 90)
    expect(turned.placement).toEqual({
      pins: { '+': hole(40, 'a'), '-': hole(40, 'd') },
      rotationDeg: 90
    })
    commit(withBuzzer, [{ type: 'MovePart', id: buzzer.id, placement: turned.placement }])
    expect(turnedPart(withBuzzer, withBuzzer.parts[1]!, -90).placement.rotationDeg).toBe(270)
  })

  it('removes a module together with the leads on its pins', () => {
    const m = newPart(doc, 'dht11-module', { pose: { position: [0, -60], rotationDeg: 0 } })
    const withModule = commit(doc, [{ type: 'AddPart', part: m }])
    const wire = newWire(withModule, { hole: hole(50, 'a') }, { pin: { part: m.id, pin: 'DATA' } })
    const wired = commit(withModule, [{ type: 'AddWire', wire }])
    expect(removePartOps(wired, m.id)).toEqual([
      { type: 'RemoveWire', id: wire.id },
      { type: 'RemovePart', id: m.id }
    ])
    commit(wired, removePartOps(wired, m.id))
  })
})

describe('newWire', () => {
  it('is a male–male Dupont of length auto, red on a supply strip and yellow otherwise', () => {
    const doc = empty()
    // Row 1 holds T-board pin 1 (3V3) in column d; row 6 holds pin 11 (GPIO17).
    expect(newWire(doc, { hole: hole(1, 'a') }, { hole: hole(30, 'a') })).toEqual({
      id: 'W1',
      a: { hole: hole(1, 'a') },
      b: { hole: hole(30, 'a') },
      color: 'red',
      kind: 'dupont-mm',
      lengthMm: 'auto'
    })
    expect(newWire(doc, { hole: hole(35, 'a') }, { hole: hole(6, 'a') }).color).toBe('yellow')
    // Row 3 holds pin 5 (GPIO3) in d and pin 6 (GND) in h.
    expect(newWire(doc, { hole: hole(3, 'j') }, { hole: hole(30, 'j') }).color).toBe('black')
  })

  it('is male–female onto a module’s male pin', () => {
    const m = newPart(empty(), 'dht11-module', { pose: { position: [0, -60], rotationDeg: 0 } })
    const doc = commit(empty(), [{ type: 'AddPart', part: m }])
    const wire = newWire(doc, { hole: hole(40, 'a') }, { pin: { part: m.id, pin: 'VCC' } })
    expect(wire.kind).toBe('dupont-mf')
    commit(doc, [{ type: 'AddWire', wire }])
  })
})

describe('holeFree', () => {
  it('refuses a hole with a lead in it or under the T-board', () => {
    const doc = empty()
    expect(holeFree(doc, hole(1, 'a'))).toBe(true)
    expect(holeFree(doc, hole(1, 'd'))).toBe(false) // T-board pin 1
    expect(holeFree(doc, hole(5, 'f'))).toBe(false) // under the stem
    expect(holeFree(doc, hole(30, 'f'))).toBe(true)
  })
})

describe('holeLegality', () => {
  const holes = [hole(1, 'a'), hole(2, 'a')]
  it('is all green when the edit passes', () => {
    expect(holeLegality(holes, null)).toEqual([true, true])
  })
  it('reddens only the holes a problem names', () => {
    expect(holeLegality(holes, [{ code: 'HOLE_TAKEN', message: '', refs: ['bb1:2a'] }])).toEqual([
      true,
      false
    ])
  })
  it('reddens every hole when a problem concerns the whole edit', () => {
    expect(holeLegality(holes, [{ code: 'SPAN', message: '', refs: ['R1'] }])).toEqual([
      false,
      false
    ])
  })
})

describe('building the Blinking LED tutorial by hand', () => {
  it('reproduces its parts and leads with the gestures’ edits', () => {
    const tutorial = TUTORIALS.find((t) => t.meta.id === 'blinking-led')!.doc
    let doc = empty()
    const r = newPart(doc, 'resistor', { anchor: hole(30, 'b'), rotation: 0 })
    doc = commit(doc, [{ type: 'AddPart', part: r }])
    const leg = { ...r.placement, pins: { ...r.placement.pins, '2': hole(34, 'b') } }
    doc = commit(doc, [{ type: 'MovePart', id: r.id, placement: leg }])
    doc = commit(doc, [
      { type: 'AddPart', part: newPart(doc, 'led', { anchor: hole(34, 'c'), rotation: 0 }) }
    ])
    doc = commit(doc, [
      { type: 'AddWire', wire: newWire(doc, { hole: hole(1, 'a') }, { hole: hole(30, 'a') }) }
    ])
    doc = commit(doc, [
      { type: 'AddWire', wire: newWire(doc, { hole: hole(35, 'a') }, { hole: hole(6, 'a') }) }
    ])
    expect(doc.parts).toEqual(tutorial.parts)
    expect(doc.wires).toEqual(tutorial.wires)
  })
})
