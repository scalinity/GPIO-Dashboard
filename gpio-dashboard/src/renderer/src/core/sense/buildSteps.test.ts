// Build Mode steps confirm themselves from Board Sense (SPEC 11.7, 14.5), on fixture 3 and the
// Blinking LED; the shipped tutorials, on a full probe, are in buildStepsTutorials.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { partDef } from '../defs/parts'
import { TUTORIALS } from '../defs/tutorials'
import type { CircuitDoc } from '../model/types'
import { BEHAVIORS } from '../sim/behaviors'
import { Circuit } from '../sim/circuit'
import { probeSignature } from '../sim/probe'
import { ConvergenceError } from '../sim/solver'
import { buildSteps } from '../steps/steps'
import { at, emptyDoc, wire } from '../testing/fixtures'
import {
  changedPins,
  checkStep,
  docUpTo,
  judgeStep,
  signatureAt,
  stepSignatures,
  stepSignaturesOf
} from './buildSteps'
import { pullUpButton } from './fixtures'
import { mockSweep } from './mockAgent'
import { interpret } from './sense'

const PINS = [17, 18, 27]
const USER = Array.from({ length: 26 }, (_, i) => i + 2)
const tutorial = (id: string) => TUTORIALS.find((t) => t.meta.id === id)!.doc

afterEach(() => vi.restoreAllMocks())

describe('build step confirmation', () => {
  const doc = pullUpButton(partDef)
  const steps = buildSteps(doc, partDef).steps
  const index = (ref: string) => steps.findIndex((s) => s.refs.includes(ref))
  /** What Board Sense measures once the board is built up to step i. */
  const measuredAt = (i: number) => interpret(mockSweep(docUpTo(doc, steps, i), partDef, PINS))
  // The pull-up is complete when its last piece (a lead or the resistor) is in.
  const last = Math.max(index('W1'), index('W2'), index('R1'), index('P1'))
  // The two signatures are computed once; every sweep below is judged against them.
  const sigs = stepSignatures(doc, steps, last, PINS, partDef)

  it('confirms the step that completes the pull-up once the board shows GPIO18 tied high', () => {
    expect(judgeStep(sigs, measuredAt(last))).toEqual({ state: 'confirmed' })
  })

  it('waits while the board still looks as it did before the step', () => {
    expect(judgeStep(sigs, measuredAt(last - 1))).toEqual({ state: 'waiting', pins: [18] })
  })

  it('shows a divergence when the step was done differently', () => {
    // The board instead has GPIO18 tied to GND: neither the state before nor after the step.
    const wrong = structuredClone(docUpTo(doc, steps, last))
    wrong.wires.find((w) => w.id === 'W2')!.b = {
      hole: { board: 'bb1', area: 'rail', rail: 'bottom-', index: 25 }
    }
    const measured = interpret(mockSweep(wrong, partDef, PINS))
    expect(judgeStep(sigs, measured)).toEqual({ state: 'diverged', pins: [18] })
  })

  it('judges the way checkStep does, which computes the signatures itself', () => {
    for (const i of [last - 1, last]) {
      expect(checkStep(doc, steps, last, measuredAt(i), PINS, partDef)).toEqual(
        judgeStep(sigs, measuredAt(i))
      )
    }
  })

  it('calls a step that changes no observable net not electrically verifiable', () => {
    const blink = tutorial('blinking-led')
    const s = buildSteps(blink, partDef).steps
    const led = s.findIndex((x) => x.refs.includes('D1'))
    const measured = interpret(mockSweep(docUpTo(blink, s, led), partDef, PINS))
    expect(checkStep(blink, s, led, measured, PINS, partDef)).toEqual({
      state: 'not electrically verifiable'
    })
  })
})

describe('on a full probe, where GPIO2 and GPIO3 are observable through the board pull-ups', () => {
  // They read tied high on any board, so they match whatever a step does. A step that only
  // changes how some other pin answers them has changed nothing Board Sense can check.
  const stepOf = (id: string, key: string) => {
    const doc = tutorial(id)
    const steps = buildSteps(doc, partDef).steps
    const i = steps.findIndex((s) => s.key === key)
    return {
      i,
      sigs: stepSignatures(doc, steps, i, USER, partDef),
      built: interpret(mockSweep(docUpTo(doc, steps, i), partDef, USER))
    }
  }

  it('does not confirm the Blinking LED’s last lead, which only completes an LED path', () => {
    const { sigs, built } = stepOf('blinking-led', 'wire:W2')
    // The step does change how GPIO17 answers GPIO2 and GPIO3 in the pair table.
    expect(sigs.after.pairs[17]).not.toEqual(sigs.before.pairs[17])
    expect(sigs.changed).toEqual([])
    expect(judgeStep(sigs, built)).toEqual({ state: 'not electrically verifiable' })
  })

  it('confirms the Button’s pull-up lead, which changes what GPIO18 reads, and not its first lead', () => {
    const w3 = stepOf('button', 'wire:W3')
    expect(w3.sigs.changed).toContain(18)
    expect(judgeStep(w3.sigs, w3.built)).toEqual({ state: 'confirmed' })
    expect(judgeStep(stepOf('button', 'wire:W2').sigs, w3.built)).toEqual({
      state: 'not electrically verifiable'
    })
  })

  it('counts a pin as changed by its own reading or its reading against another observable pin', () => {
    const probe = (d: CircuitDoc) => probeSignature(new Circuit(d, partDef, BEHAVIORS), PINS)
    const empty = emptyDoc()
    // The pull-up and button tie GPIO18: its own bias reading changes.
    expect(changedPins(probe(empty), probe(pullUpButton(partDef)), PINS)).toEqual([18])
    // A lead between GPIO17 and GPIO27 changes no bias reading, only each one's reading against
    // the other.
    const joined = emptyDoc()
    joined.wires.push(wire('X1', at(6, 'a'), at(7, 'a')))
    expect(probe(joined).bias[17]).toEqual(probe(empty).bias[17])
    expect(changedPins(probe(empty), probe(joined), PINS)).toEqual([17, 27])
  })
})

describe('docUpTo', () => {
  it('finds a step by its key, so a part and a lead with one id are two steps', () => {
    const doc = pullUpButton(partDef)
    doc.wires.find((w) => w.id === 'W1')!.id = 'R1' // a lead named like the pull-up resistor
    const steps = buildSteps(doc, partDef).steps
    const lead = steps.findIndex((s) => s.key === 'wire:R1')
    const part = steps.findIndex((s) => s.key === 'part:R1')
    expect(lead).toBeGreaterThan(-1)
    expect(part).toBeGreaterThan(-1)
    const has = (d: CircuitDoc) => ({
      lead: d.wires.some((w) => w.id === 'R1'),
      part: d.parts.some((p) => p.id === 'R1')
    })
    expect(has(docUpTo(doc, steps, Math.min(lead, part)))).toEqual({
      lead: lead < part,
      part: part < lead
    })
    expect(has(docUpTo(doc, steps, Math.max(lead, part)))).toEqual({ lead: true, part: true })
    expect(has(docUpTo(doc, steps, -1))).toEqual({ lead: false, part: false })
  })
})

describe('a board the simulator cannot solve', () => {
  const doc = tutorial('button')
  const steps = buildSteps(doc, partDef).steps

  it('comes out unobservable instead of throwing, and so does the step it belongs to', () => {
    vi.spyOn(Circuit.prototype, 'solve').mockImplementation(() => {
      throw new ConvergenceError('No convergence: gmin stepping stalled at gmin = 1e-12')
    })
    const sig = signatureAt(doc, steps, 4, PINS, partDef)
    expect(sig.unsolved).toMatch(/gmin stepping stalled/)
    expect(Object.values(sig.observable).some(Boolean)).toBe(false)
    const sigs = stepSignatures(doc, steps, 4, PINS, partDef)
    expect(sigs.changed).toEqual([])
    expect(judgeStep(sigs, { bias: {}, pairs: {} })).toEqual({
      state: 'not electrically verifiable'
    })
  })

  it('leaves a step next to a solvable board unverifiable too: what it changed is not known', () => {
    const solved = signatureAt(doc, steps, steps.length - 1, USER, partDef)
    const solve = vi.spyOn(Circuit.prototype, 'solve').mockImplementation(() => {
      throw new ConvergenceError('stalled')
    })
    const unsolved = signatureAt(doc, steps, 2, USER, partDef)
    solve.mockRestore()
    expect(changedPins(unsolved, solved, USER)).toEqual([])
    expect(changedPins(solved, unsolved, USER)).toEqual([])
    expect(stepSignaturesOf(unsolved, solved, USER).changed).toEqual([])
  })

  it('does not occur in the shipped tutorials: four-digit-seven-segment’s steps 45 to 51 solve', () => {
    // Their pair-test transients stalled at gmin 1e-12 at the default tolerances (ADR-S-2). The
    // pins are the finished document's probed GPIOs, as Board Sense probes them.
    const pins = [
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25, 26
    ]
    const four = tutorial('four-digit-seven-segment')
    const list = buildSteps(four, partDef).steps
    for (const i of [44, 47]) {
      const sig = signatureAt(four, list, i, pins, partDef)
      expect(sig.unsolved).toBeUndefined()
      expect(sig.probed).toEqual(pins)
    }
  })
})
