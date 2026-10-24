// The Studio in Chromium (SPEC 10.2, 11.3; acceptance 8 and 9): the backend shows in the dev
// overlay, a hover highlights its strip and net on the next frame, and a still scene draws nothing.
import { expect, type Page, test } from '@playwright/test'
import type { StudioView } from '../src/renderer/src/studio/view'

type StudioWindow = Window & { __studio: StudioView }

const frames = (page: Page) =>
  page.evaluate(() => (window as unknown as StudioWindow).__studio.loop.frames)

/** Waits until no frame has been drawn for 300 ms; fails if that takes longer than `limitMs`. */
async function waitUntilStill(page: Page, limitMs: number): Promise<number> {
  const start = Date.now()
  let last = await frames(page)
  let since = Date.now()
  while (Date.now() - since < 300) {
    expect(Date.now() - start, 'the scene keeps rendering').toBeLessThan(limitMs)
    await page.waitForTimeout(50)
    const now = await frames(page)
    if (now !== last) [last, since] = [now, Date.now()]
  }
  return last
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // The Workbench opens the sample into the app's document, which the Studio renders.
  await page.getByRole('tab', { name: 'Workbench' }).click()
  await page.getByLabel('Open a sample').selectOption('sample-blink')
  await page.getByRole('tab', { name: 'Studio' }).click()
  await expect(page.getByText('Sample: blink an LED on GPIO17')).toBeVisible()
  await page.waitForFunction(
    () => ((window as unknown as StudioWindow).__studio?.loop.frames ?? 0) > 0
  )
})

test('the dev overlay shows the renderer backend', async ({ page }) => {
  const overlay = page.getByTestId('dev-overlay')
  await expect(overlay).toContainText(/renderer\s*(WebGPU|WebGL2 \(fallback\))/)
  const backend = (await overlay.innerText()).match(/renderer\s*(.+)/)![1]
  test.info().annotations.push({ type: 'backend', description: backend })
  console.log(`renderer backend in Chromium: ${backend}`)
})

test('hovering a hole highlights its strip and every wire end on its net within one frame', async ({
  page
}) => {
  // The first frames compile pipelines, so the first settle may take a while.
  await waitUntilStill(page, 15_000)
  const at = await page.evaluate(() =>
    (window as unknown as StudioWindow).__studio.projectHole('bb1:30e')
  )
  await page.mouse.move(at!.x, at!.y)

  await expect(page.getByTestId('studio-tooltip')).toHaveText('Row 30 · column e · net GPIO17')
  await page.waitForFunction(
    () => (window as unknown as StudioWindow).__studio.hover.shownFrame !== null
  )
  const shown = await page.evaluate(() => {
    const { hover, overlay } = (window as unknown as StudioWindow).__studio
    const keys = hover.info!.strip.map((h) => (h.area === 'main' ? `${h.row}${h.col}` : h.rail))
    return {
      eventFrame: hover.eventFrame,
      shownFrame: hover.shownFrame,
      strip: keys,
      wireEnds: hover.info!.wireEnds,
      instances: (overlay.children[0] as { count?: number }).count
    }
  })
  // The first frame drawn after the pointer moved already carries the highlight.
  expect(shown.shownFrame).toBe(shown.eventFrame + 1)
  expect(shown.strip).toEqual(['30a', '30b', '30c', '30d', '30e'])
  // W1 joins row 30 to the T-board's GPIO17 strip (row 6).
  expect(shown.wireEnds).toEqual([
    { wire: 'W1', end: 'a' },
    { wire: 'W1', end: 'b' }
  ])
  expect(shown.instances).toBe(5 + 2)
})

test('a still scene renders no frames, after a camera move too', async ({ page }) => {
  const settled = await waitUntilStill(page, 15_000)
  await page.waitForTimeout(1000)
  expect(await frames(page)).toBe(settled)

  // A preset move animates, then settles and stops within 2 s (acceptance 13).
  await page.keyboard.press('3')
  await expect.poll(() => frames(page)).toBeGreaterThan(settled)
  const after = await waitUntilStill(page, 2000)
  await page.waitForTimeout(1000)
  expect(await frames(page)).toBe(after)
})

test('the camera preset buttons move the camera', async ({ page }) => {
  await waitUntilStill(page, 15_000)
  const camera = () =>
    page.evaluate(() =>
      (window as unknown as StudioWindow).__studio.camera.position.toArray().map(Math.round)
    )
  const iso = await camera()
  await page.getByRole('button', { name: 'Top (3)' }).click()
  await waitUntilStill(page, 2000)
  const top = await camera()
  expect(top).not.toEqual(iso)
  // Seen from straight above, the camera is over the target.
  const target = await page.evaluate(() =>
    (window as unknown as StudioWindow).__studio.controls.target.toArray().map(Math.round)
  )
  expect([top[0], top[2]]).toEqual([target[0], target[2]])
})
