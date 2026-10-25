// What validateDoc checks beyond placement: each part's properties against its definition
// (SPEC 11.4), and a project's own part definitions (SPEC 7).
import { describe, expect, it } from 'vitest'
import type { CircuitDoc, PartDef } from '../model/types'
import { CUSTOM_RES, emptyDoc, fixtureDefs, hole, part, RES } from '../testing/fixtures'
import { validateDoc } from './validate'

const problems = (doc: CircuitDoc) => validateDoc(doc, fixtureDefs).map((p) => p.code)

describe('part properties', () => {
  const MIXED: PartDef = {
    ...RES,
    id: 'test-mixed',
    properties: {
      ohms: { type: 'number', label: 'Ohms', unit: 'Ω', min: 1, max: 1000, default: 220 },
      tone: { type: 'enum', label: 'Tone', options: ['low', 'high'], default: 'low' },
      loud: { type: 'boolean', label: 'Loud', default: false }
    }
  }
  const check = (props: Record<string, unknown>) => {
    const doc = emptyDoc()
    doc.parts.push({ ...part('R1', MIXED.id, { 1: hole(30, 'a'), 2: hole(33, 'a') }), props })
    return validateDoc(doc, (id) => (id === MIXED.id ? MIXED : fixtureDefs(id)))
  }

  it('accepts values of the right type and in range, and parts that set none', () => {
    expect(check({})).toEqual([])
    expect(check({ ohms: 1, tone: 'high', loud: true })).toEqual([])
    expect(check({ ohms: 1000 })).toEqual([])
  })

  it.each([
    ['a number below its range', { ohms: 0.5 }, /ohms must be between 1 and 1000/],
    ['a number above its range', { ohms: 1001 }, /ohms must be between 1 and 1000/],
    ['a number given as text', { ohms: '220' }, /ohms must be a number in Ω/],
    ['a number that is not finite', { ohms: Infinity }, /ohms must be a number/],
    ['an enum value that is not an option', { tone: 'medium' }, /tone must be one of low, high/],
    ['an enum given as a number', { tone: 1 }, /tone must be one of/],
    ['a boolean given as text', { loud: 'yes' }, /loud must be true or false/],
    ['a property the part does not have', { volume: 3 }, /has no property volume/]
  ])('refuses %s', (_name, props, message) => {
    const found = check(props)
    expect(found.map((p) => p.code)).toEqual(['BAD_PROP'])
    expect(found[0]!.message).toMatch(message)
    expect(found[0]!.refs).toEqual(['R1'])
  })

  it('checks a library part against its own definition', () => {
    const doc = emptyDoc()
    doc.parts.push(
      part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: hole(33, 'a') }, { resistance: 'big' })
    )
    expect(problems(doc)).toEqual(['BAD_PROP'])
  })
})

describe('custom parts', () => {
  const withCustom = (...defs: PartDef[]) => {
    const doc = emptyDoc()
    doc.customParts = defs
    return doc
  }

  it('lets a part use a definition the document carries, with no datasheet', () => {
    const doc = withCustom(CUSTOM_RES)
    doc.parts.push(part('R1', CUSTOM_RES.id, { 1: hole(30, 'a'), 2: hole(33, 'a') }))
    expect(problems(doc)).toEqual([])
  })

  it('still reports a part whose definition is nowhere', () => {
    const doc = emptyDoc()
    doc.parts.push(part('R1', CUSTOM_RES.id, { 1: hole(30, 'a'), 2: hole(33, 'a') }))
    expect(problems(doc)).toEqual(['UNKNOWN_DEF'])
  })

  it('checks a custom part’s properties against its own definition', () => {
    const doc = withCustom(CUSTOM_RES)
    doc.parts.push(
      part('R1', CUSTOM_RES.id, { 1: hole(30, 'a'), 2: hole(33, 'a') }, { resistance: 'big' })
    )
    expect(problems(doc)).toEqual(['BAD_PROP'])
  })

  it('refuses a definition that breaks the rules, before anything uses it', () => {
    expect(problems(withCustom({ ...CUSTOM_RES, id: 'test-led' }))).toEqual(['CUSTOM_PART'])
    expect(problems(withCustom(CUSTOM_RES, CUSTOM_RES))).toEqual(['DUPLICATE_ID'])
    expect(problems(withCustom({ ...CUSTOM_RES, pins: [] }))).toEqual(['CUSTOM_PART'])
    expect(problems(withCustom({ ...CUSTOM_RES, provenance: { sources: ['datasheet'] } }))).toEqual(
      ['CUSTOM_PART']
    )
    const badGroup = withCustom({ ...CUSTOM_RES, internalConnections: [['1', '9']] })
    expect(validateDoc(badGroup, fixtureDefs)[0]!.message).toMatch(/unknown pin 9/)
  })
})
