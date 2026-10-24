// The scores, tried on documents whose answers are known: the shipped tutorials follow the wiring
// convention and the ultrasonic tutorial protects ECHO; breaking either must be noticed.
import { partDef } from '@renderer/core/defs/parts'
import { TUTORIALS } from '@renderer/core/defs/tutorials'
import { erc } from '@renderer/core/erc/erc'
import type { CircuitDoc } from '@renderer/core/model/types'
import { describe, expect, it } from 'vitest'
import { conventionProblems, pinsMatch } from './checks'
import { emptyEvalDoc, sameDoc } from './nodeContext'
import { echoProtection, maxGpioVolts, PROMPTS } from './prompts'

const tutorial = (id: string): CircuitDoc => {
  const t = TUTORIALS.find((x) => x.meta.id === id)
  if (!t) throw new Error(`No tutorial ${id}`)
  return structuredClone(t.doc)
}

describe('conventionProblems', () => {
  it.each(TUTORIALS.map((t) => [t.meta.id, t.doc] as const))(
    'finds none in the %s tutorial',
    (_, doc) => {
      expect(conventionProblems(doc, partDef)).toEqual([])
    }
  )

  it('flags a lead of the wrong kind between two holes', () => {
    const doc = tutorial('blinking-led')
    doc.wires[0]!.kind = 'dupont-mf'
    expect(conventionProblems(doc, partDef).length).toBeGreaterThan(0)
  })

  it('flags a part leg that sits in a T-board strip instead of a lead', () => {
    const doc = tutorial('blinking-led')
    doc.parts[0]!.placement.pins['1'] = { board: 'bb1', area: 'main', row: 6, col: 'a' }
    doc.wires = doc.wires.filter(
      (w) => ![w.a, w.b].some((e) => 'hole' in e && e.hole.area === 'main' && e.hole.row === 6)
    )
    expect(conventionProblems(doc, partDef).join(' ')).toMatch(/sits in T-board strip/)
  })
})

describe('the ultrasonic tutorial', () => {
  it('protects ECHO with a divider and keeps every GPIO under 3.6 V', () => {
    const doc = tutorial('ultrasonic')
    expect(echoProtection(doc, partDef)).toMatchObject({ protected: true })
    expect(maxGpioVolts(doc, partDef)).toBeLessThanOrEqual(3.6)
  })

  it('is unprotected, and over 3.6 V, with ECHO on the GPIO strip; ERC reports OVERVOLTAGE_GPIO', () => {
    const doc = tutorial('ultrasonic')
    // W3 reached the divider's top at row 30; it now reaches the GPIO18 strip (row 6, f-j).
    const w3 = doc.wires.find((w) => w.id === 'W3')!
    w3.a = { hole: { board: 'bb1', area: 'main', row: 6, col: 'i' } }
    const protection = echoProtection(doc, partDef)
    expect(protection.protected).toBe(false)
    expect(protection.detail).toMatch(/straight to GPIO18/)
    expect(maxGpioVolts(doc, partDef)).toBeGreaterThan(3.6)
    expect(erc(doc, partDef).map((i) => i.code)).toContain('OVERVOLTAGE_GPIO')
  })

  it('has the code pins wired, both ways', () => {
    const match = pinsMatch(tutorial('ultrasonic'), partDef)
    expect(match.usedNotWired).toEqual([])
    expect(match.wiredNotUsed).toEqual([])
  })
})

describe('sameDoc', () => {
  it('is strict: a changed value, or an undefined property where there was none, differs', () => {
    const a = emptyEvalDoc()
    expect(sameDoc(a, structuredClone(a))).toBe(true)
    expect(sameDoc(a, { ...a, meta: { ...a.meta, revision: 1 } })).toBe(false)
    expect(sameDoc(a, { ...a, buildStepAnnotations: undefined })).toBe(false)
  })
})

describe('the prompt list', () => {
  it('has at least 10 prompts with unique ids, and each dependency exists', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(10)
    expect(new Set(PROMPTS.map((p) => p.id)).size).toBe(PROMPTS.length)
    for (const p of PROMPTS) if (p.after) expect(PROMPTS.some((q) => q.id === p.after)).toBe(true)
  })
})
