// Build Mode's step check, split so the expensive half is done once per step. core/sense's
// `checkStep` simulates the board before and after the step on every call, which took 0.15 to
// 6.8 s per call on the shipped tutorials (led-dot-matrix: 6.8 s); here the two signatures are
// computed once, in a worker, and each sweep is judged against them in microseconds.
//
// `judge` is `checkStep`'s verdict on the same signatures, with one difference. checkStep counts a
// pin as changed when its whole row of the pair table differs, so on a full probe (all 26 GPIOs)
// GPIO2 and GPIO3, which are observable through their board pull-ups and read tied high whatever
// the bench holds, count as changed by any step that alters how some other pin answers them, an
// LED path included. They always match, so 18 steps in the shipped tutorials (the Blinking LED's
// last lead among them) came out "confirmed" on no evidence about the step, where SPEC 14.5 says
// an LED path is never shown as verified. A pin counts here only when its own reading changed, or
// its reading against another observable pin did. When core's `checkStep` has the same rule, this
// file can go back to calling it.
import { compare, type Measured } from '../core/sense/sense'
import type { StepCheck } from '../core/sense/buildSteps'
import type { ProbeSignature } from '../core/sim/probe'

const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b)

/** The reading of `b` while `a` drives, in both polarities. */
const pair = (s: ProbeSignature, a: number, b: number) => [s.pairs[a]?.up[b], s.pairs[a]?.down[b]]

/** The observable pins whose reading the step changes. */
export function changedPins(before: ProbeSignature, after: ProbeSignature, pins: number[]) {
  const seen = pins.filter((p) => after.observable[p])
  return seen.filter(
    (p) =>
      differs(after.bias[p], before.bias[p]) ||
      seen.some(
        (q) =>
          q !== p &&
          (differs(pair(after, p, q), pair(before, p, q)) ||
            differs(pair(after, q, p), pair(before, q, p)))
      )
  )
}

/** The verdict `checkStep` gives, from the signatures of the board before and after the step. */
export function judge(
  before: ProbeSignature,
  after: ProbeSignature,
  measured: Measured,
  pins: number[]
): StepCheck {
  const changed = changedPins(before, after, pins)
  if (changed.length === 0) return { state: 'not electrically verifiable' }
  const done = changed.filter((p) => compare(p, after, measured).state === 'matched')
  if (done.length === changed.length) return { state: 'confirmed' }
  // Still as before the step: not done yet. Matching neither: done differently.
  const notYet = changed.filter((p) => compare(p, before, measured).state !== 'diverged')
  const differing = changed.filter((p) => !done.includes(p) && !notYet.includes(p))
  return differing.length
    ? { state: 'diverged', pins: differing }
    : { state: 'waiting', pins: notYet }
}
