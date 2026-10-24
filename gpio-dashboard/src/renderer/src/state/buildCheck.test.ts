// Build Mode's judge gives the verdict core/sense's checkStep gives, on signatures computed once.
import { describe, expect, it } from 'vitest'
import { partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import { docUpTo, checkStep } from '../core/sense/buildSteps'
import { pullUpButton } from '../core/sense/fixtures'
import { mockSweep } from '../core/sense/mockAgent'
import { interpret } from '../core/sense/sense'
import { BEHAVIORS } from '../core/sim/behaviors'
import { Circuit } from '../core/sim/circuit'
import { probeSignature } from '../core/sim/probe'
import { buildSteps } from '../core/steps/steps'
import { judge } from './buildCheck'

const PINS = [17, 18, 27]

const signature = (
  doc: Parameters<typeof docUpTo>[0],
  steps: ReturnType<typeof buildSteps>['steps'],
  i: number
) => probeSignature(new Circuit(docUpTo(doc, steps, i), partDef, BEHAVIORS), PINS)

describe('judge on the three pins the fixtures probe', () => {
  // The Blinking LED's paths are LEDs, which Board Sense cannot see: every step comes out alike.
  const cases = [
    ['the pull-up button', pullUpButton(partDef), true],
    ['the Blinking LED', TUTORIALS.find((t) => t.meta.id === 'blinking-led')!.doc, false]
  ] as const

  it.each(cases)(
    'gives checkStep’s verdict at every step of %s, built, one step short, and wrong',
    (_, doc, mixed) => {
      const steps = buildSteps(doc, partDef).steps
      const states = new Set<string>()
      for (let i = 0; i < steps.length; i++) {
        const before = signature(doc, steps, i - 1)
        const after = signature(doc, steps, i)
        // A wrong board: the step's own lead or part is missing and a stray lead is added.
        const wrong = structuredClone(docUpTo(doc, steps, i))
        wrong.wires = wrong.wires.slice(0, -1)
        for (const board of [docUpTo(doc, steps, i), docUpTo(doc, steps, i - 1), wrong]) {
          const measured = interpret(mockSweep(board, partDef, PINS))
          const want = checkStep(doc, steps, i, measured, PINS, partDef)
          expect(judge(before, after, measured, PINS)).toEqual(want)
          states.add(want.state)
        }
      }
      // On the button the comparison reached more than one kind of verdict.
      if (mixed) expect(states.size).toBeGreaterThan(1)
    }
  )
})

describe('judge on a full probe, where GPIO2 and GPIO3 are observable', () => {
  const USER = Array.from({ length: 26 }, (_, i) => i + 2)
  const stepAt = (id: string, key: string) => {
    const doc = TUTORIALS.find((t) => t.meta.id === id)!.doc
    const steps = buildSteps(doc, partDef).steps
    const pins = probeSignature(new Circuit(doc, partDef, BEHAVIORS), USER).probed
    const i = steps.findIndex((s) => s.key === key)
    const sign = (at: number) =>
      probeSignature(new Circuit(docUpTo(doc, steps, at), partDef, BEHAVIORS), pins)
    const built = interpret(mockSweep(docUpTo(doc, steps, i), partDef, pins))
    return { doc, steps, pins, i, built, before: sign(i - 1), after: sign(i) }
  }

  it('does not confirm the Blinking LED’s last lead, which only changes how GPIO17 answers GPIO2 and GPIO3', () => {
    const { doc, steps, pins, i, built, before, after } = stepAt('blinking-led', 'wire:W2')
    // The defect in core: GPIO2 and GPIO3 always match, so checkStep confirms the step on no
    // evidence about it. When core stops doing that, this test says the refinement can go.
    expect(checkStep(doc, steps, i, built, pins, partDef)).toEqual({ state: 'confirmed' })
    expect(judge(before, after, built, pins)).toEqual({ state: 'not electrically verifiable' })
  })

  it('still confirms the Button’s pull-up lead, which changes what GPIO18 reads', () => {
    const { doc, steps, pins, i, built, before, after } = stepAt('button', 'wire:W3')
    expect(judge(before, after, built, pins)).toEqual({ state: 'confirmed' })
    expect(checkStep(doc, steps, i, built, pins, partDef)).toEqual({ state: 'confirmed' })
  })
})
