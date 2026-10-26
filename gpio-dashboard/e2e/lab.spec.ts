// The Lab look's workroom (ADR-0144): an orbit all the way round, zoomed out as far as the look
// allows, keeps the camera inside the room and cuts away the side it stands near; and nothing on
// the set blooms, so a dark bench drawn with the bloom forced on is the frame the gate draws.
import { expect, type Page, test } from '@playwright/test'
import { Vector3 } from 'three/webgpu'
import { cutSides, MARGIN_MM, ROOM } from '../src/renderer/src/studio/lab/bounds'
import {
  difference,
  openTutorial,
  report,
  settleExactly,
  type StudioWindow,
  waitUntilStill
} from './helpers'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gpio.studio.look', 'lab'))
  await openTutorial(page, 'blinking-led')
  expect((await report(page)).look).toBe('lab')
  // The dev overlay's counters sit over the canvas.
  await page.addStyleTag({ content: '[data-testid="dev-overlay"] { display: none !important }' })
})

/** A point of the canvas with nothing on it to pick: an orbit starts there. */
async function emptySpot(page: Page) {
  const box = (await page.getByTestId('studio').boundingBox())!
  return { x: box.x + box.width * 0.06, y: box.y + box.height * 0.08, height: box.height }
}

test('an orbit all the way round stays in the room and cuts away the near side', async ({
  page
}) => {
  test.setTimeout(180_000)
  const at = await emptySpot(page)
  await page.mouse.move(at.x + 200, at.y + 200)
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600)
  await waitUntilStill(page, 20_000)
  const cut = new Set<string>()
  // A drag the canvas's height long turns the orbit a full circle; twelve steps of it.
  for (let step = 0; step < 12; step++) {
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x + at.height / 12, at.y, { steps: 4 })
    await page.mouse.up()
    await waitUntilStill(page, 20_000)
    const room = (await report(page)).room!
    const [x, y, z] = room.camera
    expect(x, `step ${step}`).toBeGreaterThanOrEqual(ROOM.west + MARGIN_MM - 1)
    expect(x).toBeLessThanOrEqual(ROOM.east - MARGIN_MM + 1)
    expect(y).toBeGreaterThanOrEqual(ROOM.floor + MARGIN_MM - 1)
    expect(y).toBeLessThanOrEqual(ROOM.ceiling - MARGIN_MM + 1)
    expect(z).toBeGreaterThanOrEqual(ROOM.north + MARGIN_MM - 1)
    expect(z).toBeLessThanOrEqual(ROOM.south)
    expect(new Set(room.cut)).toEqual(cutSides(new Vector3(x, y, z)))
    room.cut.forEach((side) => cut.add(side))
  }
  // Zoomed out, the orbit comes near the north, east and west walls, and each opens in turn.
  expect([...cut].sort()).toEqual(expect.arrayContaining(['east', 'north', 'west']))
})

test('nothing on the set blooms: the bloom forced on a dark bench changes nothing', async ({
  page
}) => {
  test.setTimeout(180_000)
  // Nothing lights: no LED, halo or current dash, so the gate leaves the bloom out.
  const sim = (await report(page)).sim
  expect([Object.values(sim.lit).flat(), sim.halos, Object.keys(sim.flow)]).toEqual([[], [], []])
  const canvas = page.getByTestId('studio').locator('canvas')
  for (const preset of ['iso', 'top', 'front'] as const) {
    await page.evaluate((p) => (window as unknown as StudioWindow).__studio.preset(p), preset)
    await waitUntilStill(page, 20_000)
    await settleExactly(page)
    const gated = await canvas.screenshot()
    await page.evaluate(() => {
      const post = (window as unknown as StudioWindow).__studio.post!
      post.setBloom = Object.getPrototypeOf(post).setBloom.bind(post, true)
    })
    await settleExactly(page)
    const forced = await canvas.screenshot()
    // What passes the bloom's threshold, from its high pass: nothing, in every channel.
    const bright = await page.evaluate(async () => {
      const post = (window as unknown as StudioWindow).__studio.post as unknown as {
        renderer: {
          readRenderTargetPixelsAsync(
            target: unknown,
            x: number,
            y: number,
            w: number,
            h: number
          ): Promise<Uint16Array>
        }
        blooms: Map<{ _renderTargetBright: { width: number; height: number } }, { look: string }>
      }
      const [node] = [...post.blooms].find(([, b]) => b.look === 'lab')!
      const target = node._renderTargetBright
      const pixels = await post.renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        target.width,
        target.height
      )
      // Half floats: any bit but the sign's is light.
      return {
        size: target.width * target.height,
        lit: pixels.filter((h) => (h & 0x7fff) !== 0).length
      }
    })
    const d = (await difference(page, gated, forced))!
    console.log(
      `${preset}: ${bright.lit} of ${bright.size * 4} high-pass values lit; ` +
        `forced against gated, mean ${d.mean.toFixed(4)} of 255, max ${d.max}`
    )
    expect(bright.size).toBeGreaterThan(1)
    expect(bright.lit, preset).toBe(0)
    // The frames differ only by what settling leaves at edges (LOOKDIFF's floor).
    expect(d.mean, preset).toBeLessThan(0.05)
    await page.evaluate(() => {
      delete (window as unknown as StudioWindow).__studio.post!.setBloom
    })
  }
})
