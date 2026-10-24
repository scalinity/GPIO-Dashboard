// Every part definition parses, passes the semantic checks and cites a source (SPEC 7).
import { describe, expect, it } from 'vitest'
import { checkPartDef, loadPartDef, PART_DEFS } from '../../core/defs/parts'

const raw = import.meta.glob<unknown>('./*.part.json', { eager: true, import: 'default' })

describe('part definitions', () => {
  it.each(Object.keys(raw))('%s is valid', (file) => {
    const def = loadPartDef(file.replace('./', '../../content/parts/'), raw[file])
    expect(checkPartDef(def)).toEqual([])
    expect(def.provenance.sources.length).toBeGreaterThan(0)
  })

  it('loads every file under its own id', () => {
    expect(PART_DEFS.size).toBe(Object.keys(raw).length)
  })

  it('rejects a definition that breaks the rules', () => {
    expect(() =>
      loadPartDef('../../content/parts/bad.part.json', {
        id: 'bad',
        name: 'Bad',
        category: 'passive',
        kitTags: [],
        pins: [
          { id: '1', label: 'A', role: 'passive', electricalType: 'passive', offsetPitch: [0, 0] },
          { id: '1', label: 'B', role: 'passive', electricalType: 'passive', offsetPitch: [1, 0] }
        ],
        internalConnections: [['1', '9']],
        footprint: { kind: 'rigid' },
        sim: { model: 'none', params: {} },
        properties: {},
        bodyMm: [1, 1, 1],
        geometry: { family: 'x', params: {} },
        provenance: { sources: ['https://example.com/datasheet.pdf'] }
      })
    ).toThrow(/pin id 1 is repeated.*unknown pin 9/)
  })
})
