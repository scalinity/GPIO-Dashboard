// The library's rules for a definition (SPEC 7): it cites a source, it keeps clear of the ids a
// project's own parts use, and a property value is checked against its schema.
import { describe, expect, it } from 'vitest'
import { PartDefSchema } from '../model/schema'
import type { PartDef } from '../model/types'
import { docPartDefs } from '../netlist/netlist'
import { CUSTOM_RES, emptyDoc, fixtureDefs, RES } from '../testing/fixtures'
import { loadPartDef, partDef, propProblem } from './parts'

const FILE = '../../content/parts/test-resistor.part.json'

describe('library definitions', () => {
  it('load when they cite a source', () => {
    expect(loadPartDef(FILE, RES)).toEqual(RES)
  })

  it('cite at least one, though the schema allows a part with none', () => {
    const noSource = { ...RES, provenance: { sources: [] } }
    expect(PartDefSchema.safeParse(noSource).success).toBe(true)
    expect(() => loadPartDef(FILE, noSource)).toThrow(/cites a source/)
  })

  it('never take an id a project’s own parts use', () => {
    expect(PartDefSchema.safeParse(CUSTOM_RES).success).toBe(true)
    expect(() =>
      loadPartDef('../../content/parts/custom-test-resistor.part.json', {
        ...CUSTOM_RES,
        provenance: { sources: ['https://example.com/a'] }
      })
    ).toThrow(/"custom-" are for a project/)
  })

  it('still reject a source that is not a URL', () => {
    expect(
      PartDefSchema.safeParse({ ...RES, provenance: { sources: ['datasheet'] } }).success
    ).toBe(false)
  })
})

describe('docPartDefs', () => {
  it('adds the document’s own parts to the library, and leaves the library alone', () => {
    const doc = emptyDoc()
    expect(docPartDefs(doc, fixtureDefs)).toBe(fixtureDefs)
    doc.customParts = [CUSTOM_RES]
    const defs = docPartDefs(doc, fixtureDefs)
    expect(defs(CUSTOM_RES.id)).toBe(CUSTOM_RES)
    expect(defs('test-led').id).toBe('test-led')
    expect(() => defs('custom-missing')).toThrow(/No fixture part/)
  })
})

describe('propProblem', () => {
  const def = partDef('led')

  it('is null for a value the schema allows', () => {
    expect(propProblem(def, 'color', 'red')).toBeNull()
  })

  it('names the options when the value is none of them', () => {
    expect(propProblem(def, 'color', 'ultraviolet')).toMatch(/^color must be one of /)
  })

  it('names the part’s properties when there is no such one', () => {
    expect(propProblem(def, 'wattage', 1)).toMatch(
      /^led has no property wattage; its properties are /
    )
    const none: PartDef = { ...RES, properties: {} }
    expect(propProblem(none, 'x', 1)).toBe('test-resistor has no property x; it has none')
  })
})
