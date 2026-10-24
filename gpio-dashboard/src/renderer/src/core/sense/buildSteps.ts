// Build Mode step confirmation, headless (SPEC 11.7, 14.5): a step is confirmed when Board Sense
// measures what the circuit built up to that step predicts on its observable nets. A step whose
// nets cannot be observed (an LED path) falls back to the user's "Done" or a checkpoint.
import type { CircuitDoc } from '../model/types'
import type { PartDefs } from '../netlist/netlist'
import { BEHAVIORS } from '../sim/behaviors'
import { Circuit } from '../sim/circuit'
import { probeSignature } from '../sim/probe'
import type { BuildStep } from '../steps/steps'
import { compare, type Measured } from './sense'

export type StepCheck =
  | { state: 'confirmed' }
  | { state: 'not electrically verifiable' }
  | { state: 'waiting'; pins: number[] }
  | { state: 'diverged'; pins: number[] }

/** The document as it stands once steps 0..index are done. */
export function docUpTo(doc: CircuitDoc, steps: BuildStep[], index: number): CircuitDoc {
  const done = new Set(steps.slice(0, index + 1).flatMap((s) => s.refs))
  return {
    ...doc,
    parts: doc.parts.filter((p) => done.has(p.id)),
    wires: doc.wires.filter((w) => done.has(w.id))
  }
}

export function checkStep(
  doc: CircuitDoc,
  steps: BuildStep[],
  index: number,
  measured: Measured,
  pins: number[],
  defs: PartDefs
): StepCheck {
  const before = probeSignature(new Circuit(docUpTo(doc, steps, index - 1), defs, BEHAVIORS), pins)
  const after = probeSignature(new Circuit(docUpTo(doc, steps, index), defs, BEHAVIORS), pins)
  // The nets this step changes, as Board Sense can see them.
  const changed = pins.filter(
    (p) =>
      after.observable[p] &&
      JSON.stringify([after.bias[p], after.pairs[p]]) !==
        JSON.stringify([before.bias[p], before.pairs[p]])
  )
  if (changed.length === 0) return { state: 'not electrically verifiable' }
  const done = changed.filter((p) => compare(p, after, measured).state === 'matched')
  if (done.length === changed.length) return { state: 'confirmed' }
  // Still as before the step: not done yet. Matching neither: done differently.
  const notYet = changed.filter((p) => compare(p, before, measured).state !== 'diverged')
  const differs = changed.filter((p) => !done.includes(p) && !notYet.includes(p))
  return differs.length ? { state: 'diverged', pins: differs } : { state: 'waiting', pins: notYet }
}
