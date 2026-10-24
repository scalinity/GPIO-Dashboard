// .gpiob round trips and format checks (SPEC 5, 18).
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../model/defaults'
import { validateDoc } from '../ops/validate'
import { at, CUSTOM_RES, emptyDoc, fixtureDefs, hole, part, wire } from '../testing/fixtures'
import { FormatError, parse, serialize } from './gpiob'

describe('.gpiob files', () => {
  it('round-trip a document exactly', () => {
    const doc = emptyDoc()
    doc.parts.push(part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: null }, { resistance: 220 }))
    doc.wires.push({ ...wire('W1', at(6, 'a'), at(30, 'b')), routeHints: [[1, 2, 3]], heightMm: 4 })
    doc.wires.push(wire('W2', at(40, 'a'), { pin: { part: 'R1', pin: '1' } }))
    doc.buildStepAnnotations = { 'part:R1': { why: 'Limits the LED current' } }
    expect(parse(serialize(doc))).toStrictEqual(doc)
  })

  it('round-trips a project with its own parts, a part that uses one included', () => {
    const doc = emptyDoc()
    doc.customParts = [
      CUSTOM_RES,
      { ...CUSTOM_RES, id: 'custom-with-sheet', provenance: { sources: ['https://example.com/a'] } }
    ]
    doc.parts.push(part('R1', CUSTOM_RES.id, { 1: hole(30, 'a'), 2: hole(33, 'a') }))
    const reopened = parse(serialize(doc))
    expect(reopened).toStrictEqual(doc)
    expect(validateDoc(reopened, fixtureDefs)).toEqual([])
  })

  it('refuses a custom part that is not a part definition', () => {
    const doc = JSON.parse(serialize({ ...emptyDoc(), customParts: [CUSTOM_RES] }))
    doc.customParts[0].pins[0].role = 'whatever'
    expect(() => parse(JSON.stringify(doc))).toThrow(/customParts\.0\.pins\.0\.role/)
  })

  it('names the current format version in every file', () => {
    expect(JSON.parse(serialize(emptyDoc())).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('upgrades format 1: build-step notes move to step keys', () => {
    const v1 = JSON.parse(serialize(emptyDoc()))
    v1.schemaVersion = 1
    v1.parts = [part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: null })]
    v1.wires = [wire('W1', at(6, 'a'), at(30, 'b')), wire('R1', at(7, 'a'), at(31, 'b'))]
    v1.buildStepAnnotations = {
      R1: { why: 'a part and a lead' },
      W1: { mistake: 'a lead' },
      tboard: { why: 'the board' },
      Z9: { why: 'names nothing' }
    }
    const upgraded = parse(JSON.stringify(v1))
    expect(upgraded.schemaVersion).toBe(SCHEMA_VERSION)
    expect(upgraded.buildStepAnnotations).toStrictEqual({
      'part:R1': { why: 'a part and a lead' },
      'wire:R1': { why: 'a part and a lead' },
      'wire:W1': { mistake: 'a lead' },
      tboard: { why: 'the board' },
      Z9: { why: 'names nothing' }
    })
    delete v1.buildStepAnnotations
    expect(parse(JSON.stringify(v1)).buildStepAnnotations).toBeUndefined()
  })

  it('refuses files from a newer app, files without a version, and non-JSON', () => {
    const newer = { ...emptyDoc(), schemaVersion: SCHEMA_VERSION + 1 }
    expect(() => parse(JSON.stringify(newer))).toThrow(/newer version/)
    const unversioned: Record<string, unknown> = { ...emptyDoc() }
    delete unversioned.schemaVersion
    expect(() => parse(JSON.stringify(unversioned))).toThrow(/missing schemaVersion/)
    expect(() => parse('not json')).toThrow(FormatError)
    expect(() => parse('[1,2]')).toThrow(/JSON object/)
  })

  it('reports a damaged file with the path of the first problem', () => {
    const doc = JSON.parse(serialize(emptyDoc()))
    doc.controller.tboard.colPair = 'e/f'
    expect(() => parse(JSON.stringify(doc))).toThrow(/controller\.tboard\.colPair/)
    const extra = JSON.parse(serialize(emptyDoc()))
    extra.surprise = true
    expect(() => parse(JSON.stringify(extra))).toThrow(FormatError)
  })
})
