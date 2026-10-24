// Every tutorial passes SPEC 13.1: placement, zero ERC errors, its sim assertions, code/netlist pin
// agreement, no LEAD_TOO_SHORT with the inventory leads, and theory whose values come from the
// doc. AUDIT.md's generated tables must match the docs (UPDATE_AUDIT=1 rewrites them).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { partDef } from '../../core/defs/parts'
import { TUTORIALS } from '../../core/defs/tutorials'
import { erc } from '../../core/erc/erc'
import { validateDoc } from '../../core/ops/validate'
import { buildSteps } from '../../core/steps/steps'
import { runAssertion } from '../../core/tutorials/assert'
import { auditRegion, auditTables } from '../../core/tutorials/audit'
import { renderTheory } from '../../core/tutorials/theory'

const KIT_DOCS = 'https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/'
const AUDIT = fileURLToPath(new URL('../../../../../../docs/v2/AUDIT.md', import.meta.url))

describe.each(TUTORIALS.map((t) => [t.meta.id, t] as const))('%s', (id, t) => {
  const { meta, doc } = t
  const issues = erc(doc, partDef)

  it('is a valid placement on the bench, tied to this tutorial', () => {
    expect(validateDoc(doc, partDef)).toEqual([])
    expect(doc.meta.sourceTutorialId).toBe(id)
  })

  it('passes ERC with zero errors, no LEAD_TOO_SHORT, and code pins that match the netlist', () => {
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(
      issues.filter((i) => i.code === 'LEAD_TOO_SHORT' || i.code === 'CODE_PIN_MISMATCH')
    ).toEqual([])
  })

  it.each(meta.assertions.map((a) => [a.name, a] as const))('sim: %s', (_name, a) => {
    expect(runAssertion(doc, partDef, a)).toEqual([])
  })

  it('renders its theory from the doc', () => {
    expect(() => renderTheory(t.theory, doc, partDef)).not.toThrow()
  })

  it('cites its kit page, or is tagged as an extra', () => {
    if (meta.kitProject) {
      expect(meta.sources.kit?.startsWith(KIT_DOCS)).toBe(true)
      expect(meta.tags).not.toContain('needs parts not in the kit')
    } else {
      expect(meta.sources.kit).toBeNull()
    }
  })

  it('hangs each checkpoint on a step of its build', () => {
    const refs = new Set(buildSteps(doc, partDef).steps.flatMap((s) => s.refs))
    for (const c of meta.checkpoints) expect(refs.has(c.afterStep), c.afterStep).toBe(true)
  })

  it("matches AUDIT.md's generated table and steps", () => {
    const region = auditRegion(id, auditTables(doc, partDef))
    const text = readFileSync(AUDIT, 'utf8')
    const pattern = new RegExp(`<!-- generated:${id} -->[\\s\\S]*?<!-- /generated:${id} -->`)
    if (process.env.UPDATE_AUDIT && pattern.test(text)) {
      writeFileSync(
        AUDIT,
        text.replace(pattern, () => region)
      )
      return
    }
    expect(text.match(pattern)?.[0]).toBe(region)
  })
})
