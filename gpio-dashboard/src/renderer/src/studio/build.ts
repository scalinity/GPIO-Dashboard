// What the bench shows at one Build Mode step (SPEC 11.7): the document as built so far, the step's
// part or lead as a ghost (drawn the way the assistant's ghosts are, never simulated), and the
// places the pulsing marks stand on. Pure, so the same scene can be drawn, framed and tested.
import type { Ghost } from '../assistant/context'
import { partDef } from '../core/defs/parts'
import { tboardPinHole } from '../core/geometry/tboard'
import type { CircuitDoc, Endpoint } from '../core/model/types'
import { docPartDefs } from '../core/netlist/netlist'
import { docUpTo } from '../core/sense/buildSteps'
import type { BuildStep } from '../core/steps/steps'

/** The key the step's ghost goes under among the ghosts (the assistant's are keyed by tool call). */
export const BUILD_GHOST = 'build-step'

export interface StepScene {
  /** The document with steps 0 to index − 1 done: what the bench holds. */
  shown: CircuitDoc
  /** The step's part or lead, not yet on the bench. None for the T-board step and once all are done. */
  ghost: Ghost | null
  /** Where the step puts something: its holes, or its module's pins. The marks pulse there. */
  marks: Endpoint[]
  /** The step's part, whose body is framed with its marks. */
  part: string | null
  /** The T-board step frames the T-board and the Pi, and marks the board's end pins. */
  tboard: boolean
}

/** The scene at `index`, the step in hand; `steps.length` is the finished build. */
export function stepScene(doc: CircuitDoc, steps: BuildStep[], index: number): StepScene {
  const shown = docUpTo(doc, steps, index - 1)
  const step = steps[index]
  const none = { shown, ghost: null, marks: [], part: null, tboard: false }
  if (!step) return none
  if (step.kind === 'tboard') {
    const tb = doc.controller.tboard
    // Pin 1 and pin 40 are the T-board's two ends; its pin rows run between them.
    return {
      ...none,
      marks: [{ hole: tboardPinHole(tb, 1) }, { hole: tboardPinHole(tb, 40) }],
      tboard: true
    }
  }
  if (step.key.startsWith('part:')) {
    const part = doc.parts.find((p) => p.id === step.refs[0])
    if (!part) return none
    const def = docPartDefs(doc, partDef)(part.defId)
    const marks = def.pins.map((pin): Endpoint => {
      const hole = part.placement.pins[pin.id]
      return hole ? { hole } : { pin: { part: part.id, pin: pin.id } }
    })
    return {
      ...none,
      ghost: {
        kind: 'part',
        ref: part.id,
        defId: part.defId,
        props: part.props,
        placement: part.placement
      },
      marks,
      part: part.id
    }
  }
  const wire = doc.wires.find((w) => w.id === step.refs[0])
  if (!wire) return none
  return {
    ...none,
    ghost: { kind: 'wire', a: wire.a, b: wire.b, wireKind: wire.kind, color: wire.color },
    marks: [wire.a, wire.b]
  }
}
