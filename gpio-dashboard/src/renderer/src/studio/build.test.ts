// What the bench shows at each Build Mode step: the document as built so far, the step in hand as
// a ghost on its own holes, and the whole tutorial once the last step is passed.
import { describe, expect, it } from 'vitest'
import { partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import { holeKey } from '../core/geometry/breadboard'
import { docUpTo } from '../core/sense/buildSteps'
import { buildSteps } from '../core/steps/steps'
import { stepScene } from './build'

describe.each(TUTORIALS.map((t) => [t.meta.id, t.doc] as const))('%s', (_, doc) => {
  const { steps } = buildSteps(doc, partDef)

  it('has no part and lead sharing an id, which docUpTo’s bare refs could not tell apart', () => {
    const ids = [...doc.parts.map((p) => p.id), ...doc.wires.map((w) => w.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('grows the bench by the step before it and ghosts the step in hand on its own holes', () => {
    for (let i = 0; i < steps.length; i++) {
      const scene = stepScene(doc, steps, i)
      const step = steps[i]!
      expect(scene.shown).toEqual(docUpTo(doc, steps, i - 1))
      if (step.kind === 'tboard') {
        expect(scene.ghost).toBeNull()
        expect(scene.tboard).toBe(true)
        continue
      }
      // The ghost is the step's own part or lead, and is not yet on the bench.
      expect(scene.ghost?.kind).toBe(step.key.startsWith('part:') ? 'part' : 'wire')
      expect(
        [...scene.shown.parts, ...scene.shown.wires].some((x) => step.refs.includes(x.id))
      ).toBe(false)
      // Its marks are the holes the step names.
      const holes = scene.marks.flatMap((m) => ('hole' in m ? [holeKey(m.hole)] : []))
      expect(holes).toEqual(step.holes.map(holeKey))
    }
  })

  it('shows the whole tutorial, with nothing ghosted, once the last step is passed', () => {
    const scene = stepScene(doc, steps, steps.length)
    expect(scene.shown).toEqual(doc)
    expect(scene.ghost).toBeNull()
    expect(scene.marks).toEqual([])
  })
})
