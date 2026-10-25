// Generated wiring text and build steps (SPEC 11.7, 16.1): golden text for the samples, and the
// pieces each step is made of.
import { describe, expect, it } from 'vitest'
import { partDef } from '../defs/parts'
import { SAMPLES } from '../defs/samples'
import { TUTORIALS } from '../defs/tutorials'
import { emptyDoc, part, wire, at } from '../testing/fixtures'
import { buildSteps, faradsText, holeText, ohmsText, resistorBands } from './steps'

const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.doc
const TBOARD_STEP =
  "Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0."

describe('build steps', () => {
  it('orders and words the blink sample: T-board, passives, parts, signal, ground', () => {
    expect(buildSteps(sample('sample-blink'), partDef).steps.map((s) => [s.kind, s.text])).toEqual([
      ['tboard', TBOARD_STEP],
      [
        'passive',
        'Insert R1, the 220 Ω resistor (red, red, brown, gold), from row 30 column b to row 34 column b.'
      ],
      [
        'component',
        'Insert D1, the red 5 mm LED: anode (longer leg) in row 34 column c, cathode (shorter leg, flat side) in row 35 column c.'
      ],
      [
        'signal',
        'Use a yellow 20 cm male–male jumper (W1) from row 6 column a to row 30 column a.'
      ],
      ['ground', 'Use a black 20 cm male–male jumper (W2) from row 35 column a to row 5 column a.']
    ])
  })

  it('words a DIP-style part across the trench by its first and last pins', () => {
    const steps = buildSteps(sample('sample-button'), partDef).steps
    expect(steps.find((s) => s.refs[0] === 'SW1')!.text).toBe(
      'Insert SW1, the 6 mm tactile switch (4-pin), across the trench with pin 1 (Terminal 1) in row 40 column e and pin 4 (Terminal 4) in row 42 column f.'
    )
  })

  it('names the female end of a male–female lead first, on the module pin', () => {
    const d = emptyDoc()
    d.parts.push(part('U1', 'hc-sr04', { VCC: null, TRIG: null, ECHO: null, GND: null }))
    d.wires.push(wire('W1', at(1, 'j'), { pin: { part: 'U1', pin: 'VCC' } }, 'dupont-mf'))
    const steps = buildSteps(d, partDef).steps
    expect(steps.find((s) => s.refs[0] === 'W1')!.text).toBe(
      "Use a red 20 cm male–female jumper (W1) with its female end on U1's Vcc pin and its male end in row 1 column j."
    )
    expect(steps.find((s) => s.refs[0] === 'U1')!.text).toMatch(/^Place U1, the .*beside the board/)
  })

  it('names each step by what it is about, so a part and a lead with one id do not collide', () => {
    expect(buildSteps(sample('sample-blink'), partDef).steps.map((s) => s.key)).toEqual([
      'tboard',
      'part:R1',
      'part:D1',
      'wire:W1',
      'wire:W2'
    ])
    const d = structuredClone(sample('sample-blink'))
    d.parts[0] = { ...d.parts[0]!, id: 'W1' }
    d.buildStepAnnotations = { 'part:W1': { why: 'the part' }, 'wire:W1': { why: 'the lead' } }
    const steps = buildSteps(d, partDef).steps
    expect(steps.find((s) => s.key === 'part:W1')!.why).toBe('the part')
    expect(steps.find((s) => s.key === 'wire:W1')!.why).toBe('the lead')
  })

  it('puts every note a tutorial carries on a step of that tutorial', () => {
    for (const { meta, doc } of TUTORIALS) {
      const keys = new Set(buildSteps(doc, partDef).steps.map((s) => s.key))
      for (const key of Object.keys(doc.buildStepAnnotations ?? {}))
        expect(keys.has(key), `${meta.id}: ${key}`).toBe(true)
    }
  })

  it('carries why and common-mistake notes from the document', () => {
    const d = sample('sample-blink')
    const annotated = { ...d, buildStepAnnotations: { 'part:D1': { why: 'w', mistake: 'm' } } }
    const step = buildSteps(annotated, partDef).steps.find((s) => s.refs[0] === 'D1')!
    expect([step.why, step.mistake]).toEqual(['w', 'm'])
  })
})

describe('wiring table', () => {
  it('lists every pin and lead end with its hole and net', () => {
    expect(
      buildSteps(sample('sample-blink'), partDef).table.map((r) => [r.ref, r.pin, r.at, r.net])
    ).toEqual([
      ['R1', 'Lead 1', 'row 30 column b', 'GPIO17'],
      ['R1', 'Lead 2', 'row 34 column b', 'N1'],
      ['D1', 'Anode (+)', 'row 34 column c', 'N1'],
      ['D1', 'Cathode (−)', 'row 35 column c', 'GND'],
      ['W1', 'end a', 'row 6 column a', 'GPIO17'],
      ['W1', 'end b', 'row 30 column a', 'GPIO17'],
      ['W2', 'end a', 'row 35 column a', 'GND'],
      ['W2', 'end b', 'row 5 column a', 'GND']
    ])
  })
})

describe('values', () => {
  it.each([
    [220, '5%', ['red', 'red', 'brown', 'gold']],
    [1000, '5%', ['brown', 'black', 'red', 'gold']],
    [10_000, '5%', ['brown', 'black', 'orange', 'gold']],
    [2.2, '5%', ['red', 'red', 'gold', 'gold']],
    [4700, '1%', ['yellow', 'violet', 'black', 'brown', 'brown']],
    [220, '1%', ['red', 'red', 'black', 'black', 'brown']]
  ] as const)('%s Ω at %s has bands %j', (ohms, tolerance, bands) => {
    expect(resistorBands(ohms, tolerance)).toEqual(bands)
  })

  it('formats ohms and farads', () => {
    expect([ohmsText(220), ohmsText(4700), ohmsText(10_000), ohmsText(1e6)]).toEqual([
      '220 Ω',
      '4.7 kΩ',
      '10 kΩ',
      '1 MΩ'
    ])
    expect([faradsText(1e-7), faradsText(2.2e-4), faradsText(2.2e-11)]).toEqual([
      '100 nF',
      '220 µF',
      '22 pF'
    ])
  })

  it('names rail holes by the row they line up with', () => {
    // bb-830 rail holes run in groups of 5 from row 3, every 6 rows.
    expect(holeText(emptyDoc(), { board: 'bb1', area: 'rail', rail: 'top+', index: 0 })).toBe(
      'the top + rail at row 3'
    )
    expect(holeText(emptyDoc(), { board: 'bb1', area: 'rail', rail: 'bottom-', index: 5 })).toBe(
      'the bottom − rail at row 9'
    )
  })
})
