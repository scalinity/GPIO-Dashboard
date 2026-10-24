// Build Mode steps confirm themselves from Board Sense (SPEC 11.7), on fixture 3 and the Blinking LED.
import { describe, expect, it } from 'vitest'
import { partDef } from '../defs/parts'
import { TUTORIALS } from '../defs/tutorials'
import { buildSteps } from '../steps/steps'
import { checkStep, docUpTo } from './buildSteps'
import { pullUpButton } from './fixtures'
import { mockSweep } from './mockAgent'
import { interpret } from './sense'

const PINS = [17, 18, 27]

describe('build step confirmation', () => {
  const doc = pullUpButton(partDef)
  const steps = buildSteps(doc, partDef).steps
  const index = (ref: string) => steps.findIndex((s) => s.refs.includes(ref))
  /** What Board Sense measures once the board is built up to step i. */
  const measuredAt = (i: number) => interpret(mockSweep(docUpTo(doc, steps, i), partDef, PINS))

  it('confirms the step that completes the pull-up once the board shows GPIO18 tied high', () => {
    // The pull-up is complete when its last piece (a lead or the resistor) is in.
    const last = Math.max(index('W1'), index('W2'), index('R1'), index('P1'))
    expect(checkStep(doc, steps, last, measuredAt(last), PINS, partDef)).toEqual({
      state: 'confirmed'
    })
  })

  it('waits while the board still looks as it did before the step', () => {
    const last = Math.max(index('W1'), index('W2'), index('R1'), index('P1'))
    expect(checkStep(doc, steps, last, measuredAt(last - 1), PINS, partDef)).toEqual({
      state: 'waiting',
      pins: [18]
    })
  })

  it('shows a divergence when the step was done differently', () => {
    const last = Math.max(index('W1'), index('W2'), index('R1'), index('P1'))
    // The board instead has GPIO18 tied to GND: neither the state before nor after the step.
    const wrong = structuredClone(docUpTo(doc, steps, last))
    wrong.wires.find((w) => w.id === 'W2')!.b = {
      hole: { board: 'bb1', area: 'rail', rail: 'bottom-', index: 25 }
    }
    const measured = interpret(mockSweep(wrong, partDef, PINS))
    expect(checkStep(doc, steps, last, measured, PINS, partDef)).toEqual({
      state: 'diverged',
      pins: [18]
    })
  })

  it('calls a step that changes no observable net not electrically verifiable', () => {
    const blink = TUTORIALS.find((t) => t.meta.id === 'blinking-led')!.doc
    const s = buildSteps(blink, partDef).steps
    const led = s.findIndex((x) => x.refs.includes('D1'))
    const measured = interpret(mockSweep(docUpTo(blink, s, led), partDef, PINS))
    expect(checkStep(blink, s, led, measured, PINS, partDef)).toEqual({
      state: 'not electrically verifiable'
    })
  })
})
