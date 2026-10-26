// The Studio look against an earlier build (ADR-0143): three tutorials at the iso, top and front
// presets, drawn by this build in the Studio look and by a dev server on a checkout of the base
// commit, must differ by at most 0.1 of 255 on average, the capture floor (ADR-0129). That keeps
// LOOKDEV's photo checks valid. It needs that second server, so it runs only on request:
//
//   LOOKDIFF=1 LOOKDIFF_BASE=http://localhost:5871 E2E_PORT=5202 npx playwright test e2e/lookdiff.spec.ts
//
// LOOKDIFF_SCENES sets the tutorials, and LOOKDIFF_THIS the origin compared with the base (this
// build's dev server by default; the base's own origin measures the floor). Each pair of captures
// is written to the test's output folder.
import { writeFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { type StudioWindow, waitUntilStill } from './helpers'

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
async function open(page: Page, origin: string, id: string) {
  // The look is a preference of the machine; a build without looks ignores it.
  await page.addInitScript(() => localStorage.setItem('gpio.studio.look', 'studio'))
  await page.goto(`${origin}/`)
  // The dev overlay's counters sit over the canvas, as LOOKDEV's captures leave them out.
  await page.addStyleTag({ content: '[data-testid="dev-overlay"] { display: none !important }' })
  await page.getByRole('tab', { name: 'Studio' }).click()
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
}

/**
 * A still frame that does not depend on how the camera got there. TRAA weighs each new frame at
 * 0.05 and GTAO turns its noise with the frame number, so two still frames of one scene differ
 * where the jitter's or the noise's phase differs. Each settling run therefore starts at TRAA's
 * first jitter offset and at a frame number GTAO's 12-frame cycle starts on, and four runs of
 * frames leave under 4% of whatever came before.
 */
async function settle(page: Page) {
  for (let run = 0; run < 4; run++) {
    await page.evaluate(() => {
      const view = (window as unknown as StudioWindow).__studio
      const post = view.post as unknown as {
        render(): void
        renderer: { _nodes: { nodeFrame: { frameId: number } } }
        resolved: { _jitterIndex: number }
      }
      const render = post.render
      post.render = () => {
        post.render = render
        const frame = post.renderer._nodes.nodeFrame
        frame.frameId += (12 - (frame.frameId % 12)) % 12
        post.resolved._jitterIndex = 0
        render.call(post)
      }
      view.controls.dispatchEvent({ type: 'change' })
    })
    await waitUntilStill(page, 10_000)
  }
}

async function shoot(page: Page, preset: (typeof PRESETS)[number]): Promise<Buffer> {
  await page.evaluate((p) => (window as unknown as StudioWindow).__studio.preset(p), preset)
  await waitUntilStill(page, 20_000)
  await settle(page)
  return page.getByTestId('studio').locator('canvas').screenshot()
}

/** The mean and largest per-channel difference of two PNGs, decoded in the page. */
function difference(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([a, b]) => {
      const pixels = async (data: string) => {
        const blob = await (await fetch(`data:image/png;base64,${data}`)).blob()
        const image = await createImageBitmap(blob)
        const canvas = new OffscreenCanvas(image.width, image.height)
        const g = canvas.getContext('2d')!
        g.drawImage(image, 0, 0)
        return g.getImageData(0, 0, image.width, image.height)
      }
      const [x, y] = await Promise.all([pixels(a), pixels(b)])
      if (x.width !== y.width || x.height !== y.height) return null
      let sum = 0
      let max = 0
      let changed = 0
      for (let i = 0; i < x.data.length; i += 4) {
        let any = false
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(x.data[i + c]! - y.data[i + c]!)
          sum += d
          max = Math.max(max, d)
          any ||= d > 0
        }
        if (any) changed += 1
      }
      const n = x.data.length / 4
      return { mean: sum / (n * 3), max, changed: changed / n }
    },
    [a.toString('base64'), b.toString('base64')] as const
  )
}

test('the Studio look draws as the base build does', async ({ page, baseURL }, info) => {
  test.setTimeout(30 * 60_000)
  const origins = [base, mine ?? baseURL!]
  const failures: string[] = []
  for (const scene of scenes) {
    const shots: Buffer[][] = []
    for (const origin of origins) {
      const fresh = await page.context().newPage()
      try {
        await open(fresh, origin, scene)
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
