// Every part in the library has a simulation model (SPEC 9, M3 exit: "all models").
import { describe, expect, it } from 'vitest'
import { PART_DEFS, partDef } from '../defs/parts'
import { emptyDoc, part } from '../testing/fixtures'
import { BEHAVIORS } from './behaviors'
import { Circuit } from './circuit'
import { SimSession } from './session'

describe('library coverage', () => {
  it.each([...PART_DEFS.keys()])('%s builds into a circuit and solves', (id) => {
    const d = emptyDoc()
    d.parts.push(part('X1', id, Object.fromEntries(partDef(id).pins.map((p) => [p.id, null]))))
    const snap = new SimSession(new Circuit(d, partDef, BEHAVIORS)).snapshot()
    expect(snap.error).toBeNull()
  })
})
