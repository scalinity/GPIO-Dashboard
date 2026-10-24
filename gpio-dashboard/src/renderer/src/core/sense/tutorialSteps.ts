// The Board Sense step check on every shipped tutorial, on a full probe (SPEC 14.5, 18; ADR-0116).
// Shared by the test files that split the tutorials between workers (ADR-0119): one board per
// step, 26 candidate GPIOs, and a signature costs 0.1 s to 3 s, so the set takes minutes in one file.
import { describe, expect, it } from 'vitest'
import { partDef } from '../defs/parts'
import { TUTORIALS } from '../defs/tutorials'
import { buildSteps } from '../steps/steps'
import {
  docUpTo,
  judgeStep,
  signatureAt,
  stepSignaturesOf,
  type StepSignatures
} from './buildSteps'
import { mockSweep } from './mockAgent'
import { interpret, type Measured } from './sense'
import type { ProbeSignature } from '../sim/probe'

/** The 26 user GPIOs, as a full probe asks for them (GPIO0/1 are the ID EEPROM). */
export const USER = Array.from({ length: 26 }, (_, i) => i + 2)

/** The two tutorials whose signatures take over a minute each: FULL_PROBE=1 runs them. */
export const HEAVY = ['led-dot-matrix', 'four-digit-seven-segment']

/**
 * The steps Board Sense can see on a full probe: each makes an observable pin read differently
 * (a tie to a rail, or a lead to another GPIO). Every other step of every tutorial is "not
 * electrically verifiable": an LED path, a part with no GPIO on it, a lead to a skipped pin.
 */
export const SEEN: Record<string, string[]> = {
  'active-buzzer': ['wire:W3'],
  'passive-buzzer': ['wire:W3'],
  button: ['wire:W3'],
  'tilt-switch': ['wire:W6'],
  'morse-code': ['wire:W3'],
  ultrasonic: ['wire:W6'],
  'four-digit-seven-segment': ['wire:W30', 'wire:W31', 'wire:W32', 'wire:W33']
}

/**
 * The steps that `checkStep` confirmed on a full probe before ADR-0116, on no evidence about the
 * step: each only changed how some pin answers GPIO2 and GPIO3, which always match. Eight of the
 * LED bar graph's, eight of the flowing LEDs', the Blinking LED's last lead, among others.
 */
export const FORMERLY_CONFIRMED: Record<string, string[]> = {
  'blinking-led': ['wire:W2'],
  'rgb-led': ['wire:W4'],
  'led-bar-graph': [
    'wire:W2',
    'wire:W3',
    'wire:W4',
    'wire:W5',
    'wire:W6',
    'wire:W7',
    'wire:W8',
    'wire:W11'
  ],
  button: ['wire:W2'],
  'tilt-switch': ['wire:W1', 'wire:W3'],
  'morse-code': ['wire:W5'],
  'breathing-led': ['wire:W2'],
  'flowing-leds': [
    'wire:W2',
    'wire:W3',
    'wire:W4',
    'wire:W5',
    'wire:W6',
    'wire:W7',
    'wire:W8',
    'wire:W9'
  ],
  pir: ['wire:W5']
}

/** Tutorial ids, less the heavy ones, dealt out `of` ways: slice `index` of them. */
export const slice = (index: number, of: number) =>
  TUTORIALS.map((t) => t.meta.id)
    .filter((id) => !HEAVY.includes(id))
    .filter((_, i) => i % of === index)

/** The readings of a board that agrees with a prediction exactly. */
const agreeing = (s: ProbeSignature): Measured => ({
  bias: Object.fromEntries(s.probed.map((p) => [p, s.bias[p]!.class])),
  pairs: Object.fromEntries(
    s.probed.map((a) => [a, { up: { ...s.pairs[a]!.up }, down: { ...s.pairs[a]!.down } }])
  )
})

/** Runs each tutorial's steps through the check, one board per step, against the mock agent. */
export function checkTutorials(
  ids: string[],
  describeIt: Pick<typeof describe, 'each'> = describe
) {
  describeIt.each(ids)('%s on a full probe', (id) => {
    it('confirms the steps Board Sense can see, and no others', { timeout: 600_000 }, () => {
      const doc = TUTORIALS.find((t) => t.meta.id === id)!.doc
      const steps = buildSteps(doc, partDef).steps
      // As Board Sense probes: the GPIOs of the finished document that are not skipped.
      const finished = signatureAt(doc, steps, steps.length - 1, USER, partDef)
      const pins = finished.probed
      const boards = [-1, ...steps.keys()].map((i) =>
        i === steps.length - 1 ? finished : signatureAt(doc, steps, i, pins, partDef)
      )
      const seen = SEEN[id] ?? []
      const formerly = FORMERLY_CONFIRMED[id] ?? []
      expect(steps.length).toBeGreaterThan(0)
      // The ones named above are steps of this tutorial.
      for (const key of [...seen, ...formerly]) expect(steps.map((s) => s.key)).toContain(key)

      steps.forEach((step, i) => {
        const before = boards[i]!
        const after = boards[i + 1]!
        // Every board of every shipped tutorial solves.
        expect(before.unsolved, `before ${step.key}`).toBeUndefined()
        expect(after.unsolved, `after ${step.key}`).toBeUndefined()
        const sigs: StepSignatures = stepSignaturesOf(before, after, pins)
        // A step is never seen on GPIO2 and GPIO3 alone: they match whatever the step did.
        expect(
          sigs.changed.length === 0 || sigs.changed.some((p) => p > 3),
          `${step.key} changes ${sigs.changed.join()}`
        ).toBe(true)

        if (seen.includes(step.key)) {
          // Built, the mock agent shows what the step should leave; one step short, it does not.
          expect(
            judgeStep(sigs, interpret(mockSweep(docUpTo(doc, steps, i), partDef, pins)))
          ).toEqual({ state: 'confirmed' })
          const short = interpret(mockSweep(docUpTo(doc, steps, i - 1), partDef, pins))
          expect(judgeStep(sigs, short).state, `${step.key} one step short`).toBe('waiting')
          return
        }
        // Not seen: not confirmed, even by a board that agrees with the prediction exactly.
        expect(sigs.changed, step.key).toEqual([])
        expect(judgeStep(sigs, agreeing(after)), step.key).toEqual({
          state: 'not electrically verifiable'
        })
        // And, for the steps the old check confirmed, by the mock agent's board as built.
        if (formerly.includes(step.key)) {
          const built = interpret(mockSweep(docUpTo(doc, steps, i), partDef, pins))
          expect(judgeStep(sigs, built), step.key).toEqual({ state: 'not electrically verifiable' })
        }
      })
    })
  })
}
