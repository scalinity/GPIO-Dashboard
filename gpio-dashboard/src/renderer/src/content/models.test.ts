// Guards the committed models in public/models (SPEC 4.5, 10.8; SPEC 20 item 14): the holes
// measured in each GLB's geometry coincide with the holes core computes from the same content
// file, and every budget holds. npm run assets:check runs the same checks, and can rebuild.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASSETS, MODELS_BUDGET_BYTES, MODELS_DIR, ROOT } from '../../../../scripts/assets/assets'
import { verifyAsset } from '../../../../scripts/assets/verify'

describe('committed models', () => {
  for (const asset of ASSETS) {
    it(`${asset.name}: holes, dimensions, budgets, KTX2 textures and geometry hash`, async () => {
      const findings = await verifyAsset(asset)
      for (const f of findings) expect(f.ok, `${f.check}: ${f.detail}`).toBe(true)
      expect(findings.map((f) => f.check)).toContain('holes')
    }, 30_000)
  }

  it('fit the models budget together', () => {
    const dir = join(ROOT, MODELS_DIR)
    const total = readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0)
    expect(total).toBeLessThanOrEqual(MODELS_BUDGET_BYTES)
  })
})
