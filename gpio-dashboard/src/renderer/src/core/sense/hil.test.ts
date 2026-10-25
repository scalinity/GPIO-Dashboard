// HIL_CHECKLIST.md lists each bench fixture's holes and build steps, generated from the fixture
// documents (SPEC 18). UPDATE_HIL=1 rewrites them.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { partDef } from '../defs/parts'
import { auditRegion, auditTables } from '../tutorials/audit'
import { BENCH_FIXTURES } from './fixtures'

const HIL = fileURLToPath(new URL('../../../../../../docs/v2/HIL_CHECKLIST.md', import.meta.url))

describe.each(BENCH_FIXTURES.map((f) => [f.id, f] as const))('bench fixture %s', (id, f) => {
  it("matches HIL_CHECKLIST.md's generated holes and steps", () => {
    const region = auditRegion(id, auditTables(f.doc(partDef), partDef))
    const text = readFileSync(HIL, 'utf8')
    const pattern = new RegExp(`<!-- generated:${id} -->[\\s\\S]*?<!-- /generated:${id} -->`)
    if (process.env.UPDATE_HIL && pattern.test(text)) {
      writeFileSync(
        HIL,
        text.replace(pattern, () => region)
      )
      return
    }
    expect(text.match(pattern)?.[0]).toBe(region)
  })
})
