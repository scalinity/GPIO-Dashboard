// Build Steps (SPEC 11.7): the steps core/steps generates from the document, in build order, with
// their "why" notes and common mistakes.
import { partDef } from '../core/defs/parts'
import type { CircuitDoc } from '../core/model/types'
import { buildSteps } from '../core/steps/steps'

export default function StepsPanel({ doc }: { doc: CircuitDoc }) {
  const { steps } = buildSteps(doc, partDef)
  return (
    <ol aria-label="Build steps" className="space-y-2 list-decimal pl-5 text-sm text-gray-200">
      {steps.map((step) => (
        <li key={step.refs.join()}>
          <p>{step.text}</p>
          {step.why && <p className="text-xs text-gray-400">Why: {step.why}</p>}
          {step.mistake && <p className="text-xs text-amber-300/90">Watch out: {step.mistake}</p>}
        </li>
      ))}
    </ol>
  )
}
