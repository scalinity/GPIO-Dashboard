// Where the Pi's pins contradict the document (SPEC 14.4), from telemetry alone.
import { describe, expect, it } from 'vitest'
import { codePins } from '../core/code/pins'
import { partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import type { CircuitDoc } from '../core/model/types'
import { netlist } from '../core/netlist/netlist'
import { BENCH_FIXTURES } from '../core/sense/fixtures'
import { expectedUse, type LiveCheckInput, liveDivergences, SETUP_GRACE_MS } from './liveCheck'
import type { LivePin } from './liveStore'

const pin = (bcm: number, over: Partial<LivePin> = {}): LivePin => ({
  bcm,
  level: 'low',
  direction: 'in',
  pull: 'none',
  function: null,
  consumer: null,
  ...over
})

const tutorial = (id: string) => TUTORIALS.find((t) => t.meta.id === id)!.doc
const fixture = (id: string) => BENCH_FIXTURES.find((f) => f.id === id)!.doc(partDef)

function check(doc: CircuitDoc, pins: LivePin[], over: Partial<LiveCheckInput> = {}) {
  return liveDivergences({
    doc,
    nl: netlist(doc, partDef),
    defs: partDef,
    pins: Object.fromEntries(pins.map((p) => [p.bcm, p])),
    uses: codePins(doc.code.source).uses,
    runningMs: null,
    reads: {},
    ...over
  })
}

describe('what the document expects of a pin', () => {
  const doc = tutorial('button')
  const nl = netlist(doc, partDef)
  const expects = (bcm: number, source = '') =>
    expectedUse(doc, nl, partDef, codePins(source).uses, bcm)

  it('takes the code’s word first', () => {
    expect(expects(18, doc.code.source)).toMatchObject({ use: 'input' })
    expect(expects(17, doc.code.source)).toMatchObject({ use: 'output' })
  })

  it('reads the wiring when the code is silent: a button is read, an LED is driven', () => {
    expect(expects(18)).toMatchObject({ use: 'input', refs: expect.arrayContaining(['SW1']) })
    expect(expects(17)).toMatchObject({ use: 'output', refs: expect.arrayContaining(['D1']) })
  })

  it('expects nothing of a pin with nothing wired to it', () => {
    expect(expects(22, doc.code.source)).toBeNull()
  })
})

describe('divergences from telemetry', () => {
  const button = tutorial('button')

  it('flags an output driven where the document reads an input', () => {
    const found = check(button, [pin(18, { direction: 'out', level: 'high' })])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      id: 'drives-input:18',
      kind: 'drives-input',
      severity: 'error',
      bcm: 18
    })
    expect(found[0]!.why).toContain('GPIO18')
    expect(found[0]!.refs).toContain('SW1')
  })

  it('is quiet when the pins are as the document has them', () => {
    expect(
      check(button, [
        pin(18, { level: 'high', pull: 'up' }),
        pin(17, { direction: 'out', level: 'high' })
      ])
    ).toEqual([])
  })

  it('flags a pin the program should drive but has not, once it has had time', () => {
    const idle = [pin(17), pin(18, { pull: 'up', level: 'high' })]
    expect(check(button, idle, { runningMs: null })).toEqual([])
    expect(check(button, idle, { runningMs: SETUP_GRACE_MS - 1 })).toEqual([])
    const late = check(button, idle, { runningMs: SETUP_GRACE_MS })
    expect(late.map((d) => d.id)).toEqual(['not-driven:17'])
    expect(late[0]!.severity).toBe('warning')
  })

  it('flags I2C that is off, and accepts it once the pins have their I2C function', () => {
    const fan = tutorial('adjustable-fan')
    const off = check(fan, [pin(2, { level: 'high' }), pin(3, { level: 'high' })])
    expect(off.map((d) => d.id).sort()).toEqual(['wrong-function:2', 'wrong-function:3'])
    expect(off[0]!.cause).toContain('raspi-config')
    const on = check(fan, [
      pin(2, { direction: 'alt', function: 'SDA1', level: 'high' }),
      pin(3, { direction: 'alt', function: 'SCL1', level: 'high' })
    ])
    expect(on).toEqual([])
  })

  it('flags an alternate function on a pin the document uses as a plain GPIO', () => {
    const found = check(button, [pin(17, { direction: 'alt', function: 'TXD0' })])
    expect(found.map((d) => d.id)).toEqual(['wrong-function:17'])
    expect(found[0]!.why).toContain('TXD0')
  })

  it('flags an input that reads a level its circuit cannot produce', () => {
    // GPIO17 to GND through 10 kΩ and nothing else: the simulation reads it LOW.
    const calibration = fixture('calibration-10k')
    const reads = { 17: 'low' } as const
    expect(check(calibration, [pin(17, { level: 'low' })], { reads })).toEqual([])
    const found = check(calibration, [pin(17, { level: 'high' })], { reads })
    expect(found.map((d) => d.id)).toEqual(['impossible-level:17'])
    expect(found[0]!.title).toContain('reads HIGH')
  })

  it('does not call a level impossible where a switch can change it', () => {
    // The button's pin reads either way depending on the button.
    const found = check(button, [pin(18, { level: 'low', pull: 'up' })], { reads: { 18: 'high' } })
    expect(found).toEqual([])
  })

  it('does not judge an input the simulation cannot call', () => {
    const calibration = fixture('calibration-10k')
    for (const sim of ['ambiguous', 'floating'] as const)
      expect(check(calibration, [pin(17, { level: 'high' })], { reads: { 17: sim } })).toEqual([])
  })

  it('ignores GPIO0, GPIO1 and pins above GPIO27', () => {
    expect(check(button, [pin(0, { direction: 'out' }), pin(28, { direction: 'out' })])).toEqual([])
  })
})
