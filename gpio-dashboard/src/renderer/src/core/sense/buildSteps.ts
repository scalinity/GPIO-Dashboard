// Build Mode step confirmation, headless (SPEC 11.7, 14.5): a step is confirmed when Board Sense
// measures what the circuit built up to that step predicts on the nets the step changes. A step
// that changes no observable net (an LED path, say) falls back to the user's "Done" or a checkpoint.
//
// The work is in two halves, because they cost very differently. `stepSignatures` simulates the
// board before and after the step (0.15 s to 3 s on the shipped tutorials, and the same two
// signatures serve every sweep), so a caller computes it once per step. `judgeStep` compares one
// measured sweep with them and takes microseconds, so a caller runs it on every sweep.
import type { CircuitDoc } from '../model/types'
import type { PartDefs } from '../netlist/netlist'
import { BEHAVIORS } from '../sim/behaviors'
import { Circuit } from '../sim/circuit'
import { probeSignature, type ProbeSignature } from '../sim/probe'
import { stepKey, type BuildStep } from '../steps/steps'
import { compare, type Measured } from './sense'

export type StepCheck =
  | { state: 'confirmed' }
  | { state: 'not electrically verifiable' }
  | { state: 'waiting'; pins: number[] }
  | { state: 'diverged'; pins: number[] }

/** What a step does to the board, as predicted: computed once, then judged against each sweep. */
export interface StepSignatures {
  /** The probe signature of the board with the steps before this one done. */
  before: ProbeSignature
  /** The probe signature of the board with this step done. */
  after: ProbeSignature
  /**
   * The observable pins this step changes the reading of (`changedPins`). Empty when the step
   * changes no net Board Sense can see, or when either board could not be solved.
   */
  changed: number[]
}

/**
 * The document as it stands once steps 0..index are done. A step is found by its key, so a part
 * and a lead that share an id are two steps (ADR-0092, ADR-0118).
 */
export function docUpTo(doc: CircuitDoc, steps: BuildStep[], index: number): CircuitDoc {
  const done = new Set(steps.slice(0, index + 1).map((s) => s.key))
  return {
    ...doc,
    parts: doc.parts.filter((p) => done.has(stepKey('part', p.id))),
    wires: doc.wires.filter((w) => done.has(stepKey('wire', w.id)))
  }
}

/** The probe signature of the board with steps 0..index done (−1: nothing built yet). */
export function signatureAt(
  doc: CircuitDoc,
  steps: BuildStep[],
  index: number,
  pins: number[],
  defs: PartDefs
): ProbeSignature {
  return probeSignature(new Circuit(docUpTo(doc, steps, index), defs, BEHAVIORS), pins)
}

/** The reading of `b` while `a` drives, in both polarities. */
const pairKey = (s: ProbeSignature, a: number, b: number) =>
  `${s.pairs[a]?.up[b]}/${s.pairs[a]?.down[b]}`

const biasKey = (s: ProbeSignature, p: number) => {
  const r = s.bias[p]
  return `${r?.up}/${r?.down}/${r?.class}`
}

/**
 * The observable pins whose reading a step changes: a pin counts when its own bias reading
 * changed, or its reading against another observable pin did, in either direction.
 *
 * Whole-row comparison is not enough. GPIO2 and GPIO3 are observable through the Pi's board
 * pull-ups on any board and always match, so a step that only changes how some other pin answers
 * them (an LED path to 3V3, say) would count them as changed and confirm itself on a measurement
 * that says nothing about it (ADR-0116). A board that could not be solved (`unsolved`) has no
 * readings, so a step to or from one changes nothing that can be seen (ADR-0117).
 */
export function changedPins(
  before: ProbeSignature,
  after: ProbeSignature,
  pins: number[]
): number[] {
  if (before.unsolved || after.unsolved) return []
  const seen = pins.filter((p) => after.observable[p])
  return seen.filter(
    (p) =>
      biasKey(after, p) !== biasKey(before, p) ||
      seen.some(
        (q) =>
          q !== p &&
          (pairKey(after, p, q) !== pairKey(before, p, q) ||
            pairKey(after, q, p) !== pairKey(before, q, p))
      )
  )
}

/** The two signatures of a step, and the pins it changes, from the signatures of its boards. */
export function stepSignaturesOf(
  before: ProbeSignature,
  after: ProbeSignature,
  pins: number[]
): StepSignatures {
  return { before, after, changed: changedPins(before, after, pins) }
}

/** Simulates the board before and after step `index`. Costs seconds on a big tutorial: do it once. */
export function stepSignatures(
  doc: CircuitDoc,
  steps: BuildStep[],
  index: number,
  pins: number[],
  defs: PartDefs
): StepSignatures {
  return stepSignaturesOf(
    signatureAt(doc, steps, index - 1, pins, defs),
    signatureAt(doc, steps, index, pins, defs),
    pins
  )
}

/** One measured sweep against a step's signatures: cheap, so it can run on every sweep. */
export function judgeStep(
  { before, after, changed }: StepSignatures,
  measured: Measured
): StepCheck {
  if (changed.length === 0) return { state: 'not electrically verifiable' }
  const done = changed.filter((p) => compare(p, after, measured).state === 'matched')
  if (done.length === changed.length) return { state: 'confirmed' }
  // Still as before the step: not done yet. Matching neither: done differently.
  const notYet = changed.filter((p) => compare(p, before, measured).state !== 'diverged')
  const differs = changed.filter((p) => !done.includes(p) && !notYet.includes(p))
  return differs.length ? { state: 'diverged', pins: differs } : { state: 'waiting', pins: notYet }
}

/** `stepSignatures` and `judgeStep` in one call, for a caller that judges once. */
export function checkStep(
  doc: CircuitDoc,
  steps: BuildStep[],
  index: number,
  measured: Measured,
  pins: number[],
  defs: PartDefs
): StepCheck {
  return judgeStep(stepSignatures(doc, steps, index, pins, defs), measured)
}
