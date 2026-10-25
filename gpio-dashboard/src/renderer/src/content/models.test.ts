// Guards the committed models in public/models (SPEC 4.5, 10.8; SPEC 20 item 14): the holes
// measured in each GLB's geometry coincide with the holes core computes from the same content
// file, every part's pins sit where its definition puts them, and every budget holds.
// npm run assets:check runs the same checks, and can rebuild.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASSETS, MODELS_BUDGET_BYTES, MODELS_DIR, ROOT } from '../../../../scripts/assets/assets'
import { isController, verifyController } from '../../../../scripts/assets/controllers'
import { verifyAsset } from '../../../../scripts/assets/verify'
import { verifyIndex, verifyPart } from '../../../../scripts/assets/verify-parts'

/** Bytes in a folder and the folders in it. */
const folderBytes = (dir: string): number =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, f) =>
      n + (f.isDirectory() ? folderBytes(join(dir, f.name)) : statSync(join(dir, f.name)).size),
    0
  )

describe('committed models', () => {
  for (const asset of ASSETS.filter((a) => !a.part && !isController(a))) {
    it(`${asset.name}: holes, dimensions, budgets, KTX2 textures and geometry hash`, async () => {
      const findings = await verifyAsset(asset)
      for (const f of findings) expect(f.ok, `${f.check}: ${f.detail}`).toBe(true)
      expect(findings.map((f) => f.check)).toContain('holes')
    }, 30_000)
  }

  it('fit the models budget together', () => {
    expect(folderBytes(join(ROOT, MODELS_DIR))).toBeLessThanOrEqual(MODELS_BUDGET_BYTES)
  })
})

describe('committed controller models', () => {
  for (const asset of ASSETS.filter(isController)) {
    it(`${asset.name}: pins, dimensions, empties, colliders, budgets and textures`, async () => {
      const findings = await verifyController(asset)
      for (const f of findings) expect(f.ok, `${f.check}: ${f.detail}`).toBe(true)
      expect(findings.length).toBeGreaterThanOrEqual(3)
    }, 30_000)
  }
})

describe('committed part models', () => {
  for (const asset of ASSETS.filter((a) => a.part)) {
    it(`${asset.name}: pins, names, body size, budgets and geometry hash`, async () => {
      const findings = await verifyPart(asset)
      for (const f of findings) expect(f.ok, `${f.check}: ${f.detail}`).toBe(true)
      expect(findings.map((f) => f.check)).toEqual(
        expect.arrayContaining(['pins', 'lead axes', 'dimensions', 'budget'])
      )
    }, 30_000)
  }

  it('are all listed in parts/index.json, sorted', () => {
    for (const f of verifyIndex(ASSETS)) expect(f.ok, `${f.check}: ${f.detail}`).toBe(true)
  })
})
