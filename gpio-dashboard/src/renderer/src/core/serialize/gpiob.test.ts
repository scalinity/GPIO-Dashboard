// .gpiob round trips and format checks (SPEC 5, 18).
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../model/defaults'
import { at, emptyDoc, hole, part, wire } from '../testing/fixtures'
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

  it('names the current format version in every file', () => {
    expect(JSON.parse(serialize(emptyDoc())).schemaVersion).toBe(SCHEMA_VERSION)
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
