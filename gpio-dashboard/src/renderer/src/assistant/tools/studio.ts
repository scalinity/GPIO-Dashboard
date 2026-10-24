// The tools that talk to the user through the 3D stage and the chat (SPEC 12.5): looking at the
// layout, pointing at things, annotating build steps and asking a question.
import { z } from 'zod'
import type { CircuitDoc } from '../../core/model/types'
import { buildSteps } from '../../core/steps/steps'
import { NET_NAMES, holeKeyText } from './shared'
import { commit, defineTool, failure, isOutput, reply } from './types'

export const captureView = defineTool({
  name: 'capture_view',
  description:
    'Take a picture of the 3D stage, `top` or `iso`, to check the layout by eye: parts in sensible places, leads not crossing the wrong things. It waits up to 2 seconds for the physics to settle. Use it after a build, not after every edit.',
  schema: z.object({ preset: z.enum(['top', 'iso']) }).strict(),
  async run({ preset }, env) {
    const view = await env.ctx.captureView(preset)
    return {
      content: [
        { type: 'image', source: { type: 'base64', media_type: view.mediaType, data: view.data } },
        { type: 'text', text: `${preset} view of the stage` }
      ]
    }
  }
})

/** Which of `refs` name nothing in the project: parts, wires, boards, nets or holes. */
function unknownRefs(refs: string[], doc: CircuitDoc): string[] {
  const known = new Set<string>([
    ...doc.parts.map((p) => p.id),
    ...doc.wires.map((w) => w.id),
    ...doc.boards.map((b) => b.id),
    ...NET_NAMES
  ])
  return refs.filter((r) => !known.has(r) && !holeKeyText.safeParse(r).success)
}

export const focus = defineTool({
  name: 'focus',
  description:
    'Move the camera to frame parts, wires or holes, with an optional caption. Use it to show the user the piece you are about to explain.',
  schema: z
    .object({
      refs: z.array(z.string()).describe('Part refs, wire ids, board ids or holes like "bb1:23e".'),
      note: z.string().optional()
    })
    .strict(),
  run({ refs, note }, env) {
    env.ctx.focus(refs, note)
    const unknown = unknownRefs(refs, env.ctx.getSnapshot())
    return reply(unknown.length ? { ok: true, unknownRefs: unknown } : 'ok')
  }
})

export const highlight = defineTool({
  name: 'highlight',
  description:
    'Mark parts, wires or holes in the 3D view with a caption, as a teaching cue: "the longer leg is the anode", "this row is GND". The mark stays until the user dismisses it.',
  schema: z
    .object({
      refs: z.array(z.string()).describe('Part refs, wire ids, board ids or holes like "bb1:23e".'),
      note: z.string()
    })
    .strict(),
  run({ refs, note }, env) {
    env.ctx.highlight(refs, note)
    const unknown = unknownRefs(refs, env.ctx.getSnapshot())
    return reply(unknown.length ? { ok: true, unknownRefs: unknown } : 'ok')
  }
})

export const annotateBuildSteps = defineTool({
  name: 'annotate_build_steps',
  description:
    'Add a "why" and a "common mistake" note to build steps. Each annotation names the part or wire its step is about (a ref such as R1, or a wire id such as W2; if a part and a lead share an id, the step key "part:R1" or "wire:R1"); the step text itself is generated from the circuit. Give both notes, in one or two plain sentences, and an empty string where there is nothing to say. Two empty notes clear the step’s notes.',
  schema: z
    .object({
      annotations: z.array(
        z.object({ step: z.string(), why: z.string(), mistake: z.string() }).strict()
      )
    })
    .strict(),
  mutates: true,
  run({ annotations }, env) {
    const doc = env.ctx.getSnapshot()
    const steps = buildSteps(doc, env.ctx.partDef).steps
    // A name is a step key, or a ref that only one step is about.
    const keyOf = (name: string) => {
      const found = steps.filter((s) => s.key === name || s.refs.includes(name))
      return found.length === 1 ? found[0]!.key : undefined
    }
    const unknown = annotations.map((a) => a.step).filter((name) => keyOf(name) === undefined)
    if (unknown.length)
      return failure('NO_SUCH_STEP', { steps: unknown, available: steps.map((s) => s.key) })
    const notes = { ...doc.buildStepAnnotations }
    for (const { step, why, mistake } of annotations) {
      const note = { ...(why ? { why } : {}), ...(mistake ? { mistake } : {}) }
      if (why || mistake) notes[keyOf(step)!] = note
      else delete notes[keyOf(step)!]
    }
    const tx = commit(env, 'Annotate build steps', [
      {
        type: 'SetBuildStepAnnotations',
        annotations: Object.keys(notes).length ? notes : undefined
      }
    ])
    if (isOutput(tx)) return tx
    return { ...reply({ annotated: annotations.length }), committed: [tx] }
  }
})

export const askUser = defineTool({
  name: 'ask_user',
  description:
    'Ask the user a question in the chat and wait for the answer: a choice you should not make for them (a part outside their inventory, a second board, a level shifter versus a divider). Give two to four short options; they can also answer in their own words. Do not ask what you can decide from the datasheet or the rules.',
  schema: z.object({ question: z.string(), options: z.array(z.string()) }).strict(),
  async run({ question, options }, env) {
    const answer = await env.ctx.askUser(question, options, env.signal)
    return reply({ answer })
  }
})

export const studioTools = [captureView, focus, highlight, annotateBuildSteps, askUser]
