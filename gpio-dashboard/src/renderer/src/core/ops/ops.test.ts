// Ops, inverses and the placement rules (SPEC 5, 6.5, 6.6, 18).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { CircuitDoc, Op } from '../model/types'
import { MAIN_COLUMNS } from '../model/types'
import { at, CUSTOM_RES, emptyDoc, fixtureDefs, hole, part, wire } from '../testing/fixtures'
import { applyOp, applyOps, OpError } from './apply'
import { validateDoc } from './validate'

/** Turns a stream of random numbers into ops that apply to the document as it stands. */
function opFor(doc: CircuitDoc, pick: number[]): Op {
  const n = (i: number, mod: number) => (pick[i] ?? 0) % Math.max(1, mod)
  const col = MAIN_COLUMNS[n(1, 10)]!
  const row = 24 + n(2, 40)
  const kinds = ['AddPart', 'AddWire', 'SetCode', 'SetMeta', 'SetControllerPlacement'] as const
  const hasParts = doc.parts.length > 0
  const hasWires = doc.wires.length > 0
  const choices: string[] = [...kinds, 'AddCustomPart', 'SetBuildStepAnnotations']
  if (doc.customParts?.length) choices.push('RemoveCustomPart')
  if (hasParts) choices.push('MovePart', 'RemovePart', 'SetPartProps')
  if (hasWires) choices.push('MoveWireEnd', 'SetWireProps', 'RemoveWire')
  const kind = choices[n(0, choices.length)]
  const p = doc.parts[n(3, doc.parts.length)]
  const w = doc.wires[n(3, doc.wires.length)]
  const id = `x${pick.join('')}`.slice(0, 12) + doc.meta.revision
  switch (kind) {
    case 'AddPart':
      return {
        type: 'AddPart',
        part: part(id, 'test-resistor', { 1: hole(row, col), 2: null }),
        index: n(4, 5)
      }
    case 'AddWire':
      return { type: 'AddWire', wire: wire(id, at(row, col), at(row + 1, col)), index: n(4, 5) }
    case 'SetCode':
      return {
        type: 'SetCode',
        code: { language: 'python', library: 'gpiozero', source: `# ${row}` }
      }
    case 'SetMeta':
      return {
        type: 'SetMeta',
        meta: n(4, 2) ? { name: `n${row}` } : { sourceTutorialId: undefined }
      }
    case 'SetControllerPlacement':
      return {
        type: 'SetControllerPlacement',
        controller: { ...doc.controller, ribbon: { lengthMm: 100 + row } }
      }
    case 'MovePart':
      return {
        type: 'MovePart',
        id: p!.id,
        placement: { pins: { 1: hole(row, col), 2: hole(row, 'a') } }
      }
    case 'AddCustomPart':
      return {
        type: 'AddCustomPart',
        def: { ...CUSTOM_RES, id: `custom-${id}` },
        index: n(4, 5)
      }
    case 'RemoveCustomPart':
      return { type: 'RemoveCustomPart', id: doc.customParts![n(3, doc.customParts!.length)]!.id }
    case 'SetBuildStepAnnotations':
      return {
        type: 'SetBuildStepAnnotations',
        annotations: n(4, 3) ? { [`part:R${row}`]: { why: `w${col}` } } : undefined
      }
    case 'RemovePart':
      return { type: 'RemovePart', id: p!.id }
    case 'SetPartProps':
      return { type: 'SetPartProps', id: p!.id, props: { resistance: row * 10 } }
    case 'MoveWireEnd':
      return { type: 'MoveWireEnd', id: w!.id, end: n(4, 2) ? 'a' : 'b', to: at(row, col) }
    case 'SetWireProps':
      return {
        type: 'SetWireProps',
        id: w!.id,
        props: n(4, 2) ? { color: 'black', heightMm: row } : { heightMm: undefined }
      }
    default:
      return { type: 'RemoveWire', id: w!.id }
  }
}

describe('ops and their inverses', () => {
  it.each([
    ['without customParts', emptyDoc],
    ['with an empty customParts list', () => ({ ...emptyDoc(), customParts: [] })]
  ])('undo restores a strictly equal document after any sequence of edits, %s', (_, begin) => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.nat(1000), { minLength: 5, maxLength: 5 }), { maxLength: 25 }),
        (picks) => {
          const start = begin()
          let doc = start
          const ops: Op[] = []
          for (const pick of picks) {
            const op = opFor(doc, pick)
            ops.push(op)
            doc = {
              ...applyOp(doc, op).doc,
              meta: { ...applyOp(doc, op).doc.meta, revision: doc.meta.revision + 1 }
            }
          }
          const forward = applyOps(start, ops)
          expect(applyOps(forward.doc, forward.inverse).doc).toStrictEqual(start)
        }
      ),
      { numRuns: 300 }
    )
  })

  it('never modifies the document it is given', () => {
    const doc = emptyDoc()
    doc.wires.push(wire('W1', at(30, 'a'), at(31, 'a')))
    const before = structuredClone(doc)
    applyOp(doc, { type: 'SetWireProps', id: 'W1', props: { color: 'blue' } })
    applyOp(doc, { type: 'RemoveWire', id: 'W1' })
    expect(doc).toStrictEqual(before)
  })

  it('puts a removed item back where it was', () => {
    const doc = emptyDoc()
    doc.wires.push(wire('W1', at(30, 'a'), at(31, 'a')), wire('W2', at(32, 'a'), at(33, 'a')))
    const { doc: removed, inverse } = applyOp(doc, { type: 'RemoveWire', id: 'W1' })
    expect(applyOp(removed, inverse).doc.wires.map((x) => x.id)).toEqual(['W1', 'W2'])
  })

  it('adds and removes custom parts and notes, leaving the fields out when empty', () => {
    const start = emptyDoc()
    const added = applyOp(start, { type: 'AddCustomPart', def: CUSTOM_RES })
    expect(added.doc.customParts).toEqual([CUSTOM_RES])
    const removed = applyOp(added.doc, added.inverse)
    expect(removed.doc).toStrictEqual(start)
    expect(applyOp(removed.doc, removed.inverse).doc).toStrictEqual(added.doc)
    const noted = applyOp(start, {
      type: 'SetBuildStepAnnotations',
      annotations: { tboard: { why: 'w' } }
    })
    expect(noted.doc.buildStepAnnotations).toEqual({ tboard: { why: 'w' } })
    expect(applyOp(noted.doc, noted.inverse).doc).toStrictEqual(start)
    expect(
      applyOp(noted.doc, { type: 'SetBuildStepAnnotations' }).doc.buildStepAnnotations
    ).toBeUndefined()
  })

  it('puts back an empty customParts list as it was, and no field as none', () => {
    const empty = { ...emptyDoc(), customParts: [] }
    const added = applyOp(empty, { type: 'AddCustomPart', def: CUSTOM_RES })
    expect(applyOp(added.doc, added.inverse).doc).toStrictEqual(empty)
    // Taking the last one away by hand still drops the field, and undoing that restores the part.
    const removed = applyOp(added.doc, { type: 'RemoveCustomPart', id: CUSTOM_RES.id })
    expect(removed.doc).not.toHaveProperty('customParts')
    expect(applyOp(removed.doc, removed.inverse).doc).toStrictEqual(added.doc)
  })

  it('rejects unknown and duplicate ids', () => {
    const doc = emptyDoc()
    expect(() => applyOp(doc, { type: 'RemovePart', id: 'R9' })).toThrow(OpError)
    doc.wires.push(wire('W1', at(30, 'a'), at(31, 'a')))
    expect(() =>
      applyOp(doc, { type: 'AddWire', wire: wire('W1', at(40, 'a'), at(41, 'a')) })
    ).toThrow(/already exists/)
    expect(() => applyOp(doc, { type: 'RemoveCustomPart', id: 'custom-none' })).toThrow(OpError)
    const withCustom = applyOp(doc, { type: 'AddCustomPart', def: CUSTOM_RES }).doc
    expect(() => applyOp(withCustom, { type: 'AddCustomPart', def: CUSTOM_RES })).toThrow(
      /already exists/
    )
  })
})

const problems = (doc: CircuitDoc) => validateDoc(doc, fixtureDefs).map((p) => p.code)

describe('placement rules (SPEC 6.6)', () => {
  it('accepts an empty bench project', () => {
    expect(problems(emptyDoc())).toEqual([])
  })

  it('allows one lead per hole, never in a T-board pin hole', () => {
    const doc = emptyDoc()
    doc.wires.push(wire('W1', at(30, 'a'), at(31, 'a')), wire('W2', at(30, 'a'), at(32, 'a')))
    expect(problems(doc)).toContain('HOLE_TAKEN')
    const onPin = emptyDoc()
    onPin.wires.push(wire('W1', at(6, 'd'), at(31, 'a')))
    expect(problems(onPin)).toEqual(['HOLE_TAKEN'])
  })

  it('refuses holes under the T-board body and allows the edge column beside it', () => {
    const under = emptyDoc()
    under.wires.push(wire('W1', at(6, 'e'), at(31, 'a')))
    expect(problems(under)).toEqual(['HOLE_BLOCKED'])
    const edge = emptyDoc()
    edge.wires.push(wire('W1', at(6, 'c'), at(31, 'a')))
    expect(problems(edge)).toEqual([])
    const past = emptyDoc()
    past.wires.push(wire('W1', at(22, 'f'), at(31, 'a'))) // the stem runs past pin 39 into rows 21-23
    expect(problems(past)).toEqual(['HOLE_BLOCKED'])
  })

  it('keeps a flexible part within its lead span', () => {
    const ok = emptyDoc()
    ok.parts.push(part('D1', 'test-led', { A: hole(30, 'a'), K: hole(31, 'a') }))
    expect(problems(ok)).toEqual([])
    const far = emptyDoc()
    far.parts.push(part('D1', 'test-led', { A: hole(30, 'a'), K: hole(40, 'a') }))
    expect(problems(far)).toEqual(['SPAN'])
  })

  it('places a rigid part exactly on its footprint, straddling the trench when it must', () => {
    const pins = { 1: hole(40, 'e'), 2: hole(40, 'f'), 3: hole(42, 'e'), 4: hole(42, 'f') }
    const ok = emptyDoc()
    ok.parts.push(part('SW1', 'test-button', pins))
    expect(problems(ok)).toEqual([])
    const skewed = emptyDoc()
    skewed.parts.push(part('SW1', 'test-button', { ...pins, 4: hole(43, 'f') }))
    expect(problems(skewed)).toEqual(['FOOTPRINT'])
    const sideways = emptyDoc()
    sideways.parts.push({
      ...part('SW1', 'test-button', {
        1: hole(40, 'a'),
        2: hole(37, 'a'),
        3: hole(40, 'c'),
        4: hole(37, 'c')
      }),
      placement: {
        pins: { 1: hole(40, 'a'), 2: hole(37, 'a'), 3: hole(40, 'c'), 4: hole(37, 'c') },
        rotationDeg: 90
      }
    })
    expect(problems(sideways)).toEqual(['TRENCH'])
  })

  it('keeps off-board modules out of the holes', () => {
    const doc = emptyDoc()
    doc.parts.push(part('U1', 'test-module', { VCC: hole(40, 'a'), OUT: null, GND: null }))
    expect(problems(doc)).toEqual(['OFFBOARD_IN_HOLE'])
  })
})

describe('wiring convention: lead ends mate by gender (SPEC 6.5)', () => {
  const withModule = (defId: string, kind: 'dupont-mm' | 'dupont-mf' | 'dupont-ff') => {
    const doc = emptyDoc()
    doc.parts.push(part('U1', defId, { VCC: null, OUT: null, GND: null }))
    doc.wires.push(wire('W1', at(30, 'a'), { pin: { part: 'U1', pin: 'OUT' } }, kind))
    return problems(doc)
  }

  it('uses male-male between holes, and refuses male-female there', () => {
    const doc = emptyDoc()
    doc.wires.push(wire('W1', at(6, 'a'), at(30, 'a'), 'dupont-mf'))
    expect(problems(doc)).toEqual(['GENDER'])
  })

  it('uses male-female for a module with male header pins', () => {
    expect(withModule('test-module', 'dupont-mf')).toEqual([])
    expect(withModule('test-module', 'dupont-mm')).toEqual(['GENDER'])
  })

  it('uses male-male for a module with a female socket (servo, keypad)', () => {
    expect(withModule('test-socketed', 'dupont-mm')).toEqual([])
    expect(withModule('test-socketed', 'dupont-mf')).toEqual(['GENDER'])
  })

  it('ends a lead on a pin only of an off-board module', () => {
    const doc = emptyDoc()
    doc.parts.push(part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: hole(32, 'a') }))
    doc.wires.push(wire('W1', at(40, 'a'), { pin: { part: 'R1', pin: '1' } }, 'dupont-mf'))
    expect(problems(doc)).toEqual(['BAD_ENDPOINT'])
  })
})
