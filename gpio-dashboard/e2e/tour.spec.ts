// The opening tour (ADR-0147). Test automation never starts it on its own (navigator.webdriver),
// so these play it as C does: the camera moves and the side panels step back while it plays, the
// first click only takes over and the camera eases home to the iso preset, and the scene is still
// again within 2 s. A key ends it and still acts.
import { expect, test } from '@playwright/test'
import { frames, openTutorial, report, studio, waitUntilStill } from './helpers'

test.beforeEach(async ({ page }) => {
  await openTutorial(page, 'blinking-led')
  await waitUntilStill(page, 20_000)
})

const camera = async (page: import('@playwright/test').Page) => (await report(page)).room!.camera

test('the tour plays, steps the panels back, and gives way to the first click', async ({
  page
}) => {
  expect((await report(page)).touring).toBe(false)
  await studio(page, (s) => s.playTour())
  await expect.poll(async () => (await report(page)).touring).toBe(true)
  // The camera moves on its own while it plays.
  const before = await frames(page)
  await page.waitForTimeout(600)
  expect(await frames(page)).toBeGreaterThan(before + 10)
  // The panels keep their place but step back, out of reach; one line says how to take over.
  const aside = page.locator('aside').last()
  await expect(aside).toHaveAttribute('inert', '')
  await expect.poll(() => aside.evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
  await expect(page.getByText('Drag, click or press a key to take over')).toBeVisible()

  // The first click only takes over: nothing is selected, and the camera eases to the iso preset.
  const canvas = page.getByTestId('studio').locator('canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(async () => (await report(page)).touring).toBe(false)
  const start = Date.now()
  await waitUntilStill(page, 10_000)
  expect(Date.now() - start).toBeLessThan(2000)
  expect(await page.getByText('Drag, click or press a key to take over').count()).toBe(0)
  await expect(aside).not.toHaveAttribute('inert')
  const landed = await camera(page)
  await studio(page, (s) => s.preset('iso'))
  await waitUntilStill(page, 10_000)
  const iso = await camera(page)
  expect(Math.hypot(...landed.map((v, i) => v - iso[i]!))).toBeLessThan(1)
})

test('a key ends the tour and still acts, and C plays it again', async ({ page }) => {
  await studio(page, (s) => s.playTour())
  await expect.poll(async () => (await report(page)).touring).toBe(true)
  // 3 is the top preset: the tour ends and the camera goes over the bench.
  await page.keyboard.press('3')
  await expect.poll(async () => (await report(page)).touring).toBe(false)
  await waitUntilStill(page, 10_000)
  const [x, y, z] = await camera(page)
  expect(y).toBeGreaterThan(Math.hypot(x, z))
  await page.keyboard.press('c')
  await expect.poll(async () => (await report(page)).touring).toBe(true)
})
