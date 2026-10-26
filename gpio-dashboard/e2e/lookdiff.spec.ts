// The Studio look against an earlier build (ADR-0143): three tutorials at the iso, top and front
// presets, drawn by this build in the Studio look and by a dev server on a checkout of the base
// commit, must differ by at most 0.1 of 255 on average. That keeps LOOKDEV's photo checks valid.
// It needs that second server, so it runs only on request:
//
//   LOOKDIFF=1 LOOKDIFF_BASE=http://localhost:5871 E2E_PORT=5202 npx playwright test e2e/lookdiff.spec.ts
//
// LOOKDIFF_SCENES sets the tutorials, and LOOKDIFF_THIS the origin compared with the base (this
// build's dev server by default; the base's own origin measures the floor). LOOKDIFF_FROM=lab opens
// this build in the Lab look and switches to the Studio look before capturing. Each pair of
// captures is written to the test's output folder.
import { writeFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { difference, settleExactly, type StudioWindow, waitUntilStill } from './helpers'

const base = process.env.LOOKDIFF_BASE ?? ''
const mine = process.env.LOOKDIFF_THIS
const scenes = (
  process.env.LOOKDIFF_SCENES ?? 'four-digit-seven-segment,led-dot-matrix,shift-register'
).split(',')
const PRESETS = ['iso', 'top', 'front'] as const
/** Mean absolute difference per channel, of 255. */
const LIMIT = 0.1

// The Tauri window's size and pixel ratio, as LOOKDEV's captures.
test.use({ viewport: { width: 1168, height: 734 }, deviceScaleFactor: 2 })

test.skip(!process.env.LOOKDIFF, 'a comparison with another build: set LOOKDIFF=1 to run it')

/** Opens a tutorial as the project in the Studio look and waits for its cables to sleep. */
async function open(page: Page, origin: string, id: string, via: string) {
  // The look is a preference of the machine; a build without looks ignores it.
  await page.addInitScript((look) => localStorage.setItem('gpio.studio.look', look), via)
  await page.goto(`${origin}/`)
  // The dev overlay's counters sit over the canvas, as LOOKDEV's captures leave them out.
  await page.addStyleTag({ content: '[data-testid="dev-overlay"] { display: none !important }' })
  await page.getByRole('tab', { name: 'Studio' }).click()
  // The panels and bars around the stage differ between builds, so in both the stage covers the
  // window and the two canvases are the same size (after the tab is clicked: it would cover it).
  await page.addStyleTag({
    content:
      '[data-testid="studio"] { position: fixed !important; inset: 0 !important; z-index: 2147483647 }'
  })
  await page.evaluate(
    `Promise.all([import('/src/core/defs/tutorials.ts'), import('/src/state/circuit.ts')]).then(([t, c]) => {
      const doc = structuredClone(t.TUTORIALS.find((x) => x.meta.id === '${id}').doc)
      delete doc.meta.sourceTutorialId
      c.circuit.open(doc)
    })`
  )
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as StudioWindow).__studio?.cablesReport() != null),
      { timeout: 60_000 }
    )
    .toBe(true)
  await waitUntilStill(page, 30_000)
  if (via !== 'studio') {
    await page.evaluate(() => (window as unknown as StudioWindow).__studio.setLook('studio'))
    await expect
      .poll(() => page.evaluate(() => (window as unknown as StudioWindow).__studio.report().look))
      .toBe('studio')
    await waitUntilStill(page, 20_000)
  }
}

async function shoot(page: Page, preset: (typeof PRESETS)[number]): Promise<Buffer> {
  await page.evaluate((p) => (window as unknown as StudioWindow).__studio.preset(p), preset)
  await waitUntilStill(page, 20_000)
  await settleExactly(page)
  return page.getByTestId('studio').locator('canvas').screenshot()
}

test('the Studio look draws as the base build does', async ({ page, baseURL }, info) => {
  test.setTimeout(30 * 60_000)
  const origins = [base, mine ?? baseURL!]
  const failures: string[] = []
  for (const scene of scenes) {
    const shots: Buffer[][] = []
    for (const [i, origin] of origins.entries()) {
      const fresh = await page.context().newPage()
      try {
        await open(
          fresh,
          origin,
          scene,
          i === 1 ? (process.env.LOOKDIFF_FROM ?? 'studio') : 'studio'
        )
        const mine: Buffer[] = []
        for (const preset of PRESETS) mine.push(await shoot(fresh, preset))
        shots.push(mine)
      } finally {
        await fresh.close()
      }
    }
    PRESETS.forEach((preset, i) => {
      writeFileSync(info.outputPath(`${scene}-${preset}-base.png`), shots[0]![i]!)
      writeFileSync(info.outputPath(`${scene}-${preset}-this.png`), shots[1]![i]!)
    })
    for (const [i, preset] of PRESETS.entries()) {
      const d = await difference(page, shots[0]![i]!, shots[1]![i]!)
      const line = d
        ? `${scene.padEnd(26)} ${preset.padEnd(6)} mean ${d.mean.toFixed(3)} of 255, ` +
          `max ${d.max}, ${(d.changed * 100).toFixed(2)}% of pixels differ`
        : `${scene} ${preset}: the captures differ in size`
      console.log(line)
      if (!d || d.mean > LIMIT) failures.push(line)
    }
  }
  expect(failures).toEqual([])
})
