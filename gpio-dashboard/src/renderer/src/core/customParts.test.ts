// A document carries its own part definitions (SPEC 7), and every consumer that reads a document's
// parts resolves them from it. The same circuit is built twice: with the library's resistor, and
// with a copy of it under a custom id. Handed only the library, each consumer must answer alike.
import { describe, expect, it } from 'vitest'
import { partDef } from './defs/parts'
import { SAMPLES } from './defs/samples'
import { erc } from './erc/erc'
import type { CircuitDoc, PartDef } from './model/types'
import { computeState, ConnectivityEngine } from './netlist/engine'
import { netlist } from './netlist/netlist'
import { validateDoc } from './ops/validate'
import { endNeeds, planLead, placementAt } from './placer/placer'
import { leadReach } from './reach/reach'
import { candidates } from './sense/candidates'
import { BEHAVIORS } from './sim/behaviors'
import { simChecks } from './sim/checks'
import { Circuit } from './sim/circuit'
import { SimSession } from './sim/session'
import { buildSteps } from './steps/steps'
import { renderTheory } from './tutorials/theory'

const LIBRARY = SAMPLES.find((s) => s.id === 'sample-blink')!.doc

const MY_RESISTOR: PartDef = {
  ...partDef('resistor'),
  id: 'custom-my-resistor',
  name: 'My resistor',
  kitTags: ['custom'],
  provenance: { sources: [] }
}

/** The blink sample with R1 swapped for the custom copy, which the document carries. */
function custom(): CircuitDoc {
  const doc = structuredClone(LIBRARY)
  doc.customParts = [MY_RESISTOR]
  doc.parts.find((p) => p.id === 'R1')!.defId = MY_RESISTOR.id
  return doc
}

const lit = (doc: CircuitDoc) => {
  const session = new SimSession(new Circuit(doc, partDef, BEHAVIORS))
  session.setGpio(17, { mode: 'out', level: true })
  return session.snapshot()
}

describe('a document with a custom part, given only the library', () => {
  it('is valid', () => {
    expect(validateDoc(custom(), partDef)).toEqual([])
  })

  it('has the same nets', () => {
    expect(netlist(custom(), partDef)).toEqual(netlist(LIBRARY, partDef))
    expect(computeState(custom(), partDef).netlist.nets).toEqual(
      computeState(LIBRARY, partDef).netlist.nets
    )
    expect(() => new ConnectivityEngine(custom(), partDef).commit(custom())).not.toThrow()
  })

  it('has the same ERC issues, plus the note that the part has no datasheet', () => {
    const codes = (doc: CircuitDoc) => erc(doc, partDef).map((i) => i.code)
    expect(codes(custom())).toEqual([...codes(LIBRARY), 'PART_WITHOUT_DATASHEET'])
  })

  it('simulates the same, and passes the same sim checks', () => {
    expect(lit(custom())).toEqual(lit(LIBRARY))
    expect(simChecks(custom(), partDef, lit(custom()))).toEqual(
      simChecks(LIBRARY, partDef, lit(LIBRARY))
    )
  })

  it('words the same build steps and wiring table', () => {
    expect(buildSteps(custom(), partDef)).toEqual(buildSteps(LIBRARY, partDef))
  })

  it('has the same lead reach', () => {
    expect(leadReach(custom(), partDef)).toEqual(leadReach(LIBRARY, partDef))
  })

  it('lets the placer read its pins', () => {
    const doc = custom()
    expect(endNeeds(doc, partDef, { pin: { part: 'R1', pin: '1' } })).toBeNull()
    expect(
      planLead(doc, partDef, { partPin: { ref: 'R1', pin: '1' } }, { net: 'GND' })
    ).toHaveProperty('wire')
    // An off-board module's table slot counts the modules already in the document.
    const at = { board: 'bb1', area: 'main', row: 50, col: 'a' } as const
    expect(placementAt(doc, partDef, partDef('hc-sr04'), at)).toHaveProperty('placement')
  })

  it('renders theory values and ranks fault candidates', () => {
    expect(renderTheory('{{part R1}} / {{value R1}}', custom(), partDef)).toBe(
      renderTheory('{{part R1}} / {{value R1}}', LIBRARY, partDef)
    )
    expect(candidates(custom(), partDef).length).toBe(candidates(LIBRARY, partDef).length)
  })

  it('is still refused by a consumer that is not given the part', () => {
    const doc = custom()
    delete doc.customParts
    expect(() => netlist(doc, partDef)).toThrow(/Unknown part definition custom-my-resistor/)
  })
})
