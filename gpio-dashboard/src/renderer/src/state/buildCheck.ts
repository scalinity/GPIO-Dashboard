// Build Mode's step check: core/sense's `judgeStep` on signatures that a worker computed once per
// step (state/buildSense.ts). The store holds the board's signature before and after the step in
// hand and judges each sweep against them, four times a second.
import { judgeStep, stepSignaturesOf, type StepCheck } from '../core/sense/buildSteps'
import type { Measured } from '../core/sense/sense'
import type { ProbeSignature } from '../core/sim/probe'

/** The verdict `checkStep` gives, from the signatures of the board before and after the step. */
export function judge(
  before: ProbeSignature,
  after: ProbeSignature,
  measured: Measured,
  pins: number[]
): StepCheck {
  return judgeStep(stepSignaturesOf(before, after, pins), measured)
}
