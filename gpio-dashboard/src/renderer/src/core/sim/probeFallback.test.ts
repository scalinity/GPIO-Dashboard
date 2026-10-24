// What probe-signature mode does with a board whose solve stalls (ADR-S-2): it solves again at
// looser tolerances, and if that stalls too it reports a board whose readings are not known.
// Bench strips: 3V3 rows 1/9 a-e, GND row 5 a-e, GPIO17 row 6 a-e, GPIO27 row 7 a-e,
// GPIO18 row 6 f-j.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { partDef } from '../defs/parts'
import type { CircuitDoc } from '../model/types'
import { at, emptyDoc, hole, part, wire } from '../testing/fixtures'
import { Circuit } from './circuit'
import { probeSignature } from './probe'
import { ConvergenceError } from './solver'

const sign = (doc: CircuitDoc, pins: number[]) =>
  probeSignature(new Circuit(doc, partDef, {}), pins)

const stall = () => new ConvergenceError('No convergence: gmin stepping stalled at gmin = 1e-12')

/** A 10 kΩ pull-up on GPIO18's strip, which reads tied high. */
function pullUp() {
  const d = emptyDoc()
  d.parts.push(
    part('R1', 'resistor', { 1: hole(30, 'b'), 2: hole(34, 'b') }, { resistance: 10_000 })
  )
  d.wires.push(wire('W1', at(6, 'j'), at(30, 'a')), wire('W2', at(34, 'a'), at(9, 'a')))
  return d
}

afterEach(() => vi.restoreAllMocks())

describe('a solve that stalls at the default tolerances', () => {
  it('is solved again at looser tolerances, and reads as it would have', () => {
    const want = sign(pullUp(), [18])
    expect(want.bias[18]!.class).toBe('tied-high')
    const original = Circuit.prototype.solve
    const options: unknown[] = []
    vi.spyOn(Circuit.prototype, 'solve').mockImplementation(function (this: Circuit, ...args) {
      options.push(args[5])
      if (!args[5]) throw stall()
      return original.apply(this, args)
    })
    expect(sign(pullUp(), [18])).toEqual(want)
    expect(options.some((o) => o !== undefined)).toBe(true)
  })
})

describe('a solve that stalls at any tolerance', () => {
  it('comes out unobservable, with nothing matched or refuted', () => {
    vi.spyOn(Circuit.prototype, 'solve').mockImplementation(() => {
      throw stall()
    })
    const s = sign(pullUp(), [17, 18, 27])
    expect(s.unsolved).toMatch(/gmin stepping stalled/)
    expect(s.probed).toEqual([17, 18, 27])
    expect(Object.values(s.observable)).toEqual([false, false, false])
    for (const a of s.probed) {
      expect(s.bias[a]).toEqual({ up: 'ambiguous', down: 'ambiguous', class: 'ambiguous' })
      for (const b of s.probed) {
        expect([s.pairs[a]!.up[b], s.pairs[a]!.down[b]]).toEqual(['ambiguous', 'ambiguous'])
      }
    }
  })

  it('still lists the pins it skipped, and hides no other error', () => {
    const d = emptyDoc()
    d.parts.push(part('Q1', 'pn2222', { 1: hole(40, 'a'), 2: hole(41, 'a'), 3: hole(42, 'a') }))
    d.wires.push(wire('W1', at(6, 'b'), at(41, 'b')))
    const solve = vi.spyOn(Circuit.prototype, 'solve').mockImplementation(() => {
      throw stall()
    })
    expect(sign(d, [17, 27]).skipped.map((k) => k.bcm)).toEqual([17])
    solve.mockImplementation(() => {
      throw new Error('singular matrix')
    })
    expect(() => sign(d, [17, 27])).toThrow('singular matrix')
  })
})
