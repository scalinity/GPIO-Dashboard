// The Studio's two looks (ADR-0143): the View control and L switch them under the veil, a switch
// settles to no frames at all, the choice outlives a reload, and a switch compiles nothing new once
// both looks have been drawn (it changes values, so no GPU pipeline is made again).
import { expect, type Page, test } from '@playwright/test'
import { LAB } from '../src/renderer/src/studio/look'
import { frames, openTutorial, report, type StudioWindow, waitUntilStill } from './helpers'

type Counted = StudioWindow & { __pipelines: number }

test.beforeEach(async ({ page }) => {
  // Every render pipeline the GPU device makes is counted.
  await page.addInitScript(() => {
    const w = window as unknown as Counted
    w.__pipelines = 0
    const proto = GPUDevice.prototype
    const sync = proto.createRenderPipeline
    const async = proto.createRenderPipelineAsync
    proto.createRenderPipeline = function (this: GPUDevice, d: GPURenderPipelineDescriptor) {
      w.__pipelines += 1
      return sync.call(this, d)
    }
    proto.createRenderPipelineAsync = function (this: GPUDevice, d: GPURenderPipelineDescriptor) {
      w.__pipelines += 1
      return async.call(this, d)
    }
  })
  await openTutorial(page, 'blinking-led')
})

const view = (page: Page) => page.getByRole('group', { name: 'Look' })
const pipelines = (page: Page) => page.evaluate(() => (window as unknown as Counted).__pipelines)

/** Switches with L and waits until the look is drawn and the scene is still again. */
async function toggle(page: Page, to: 'lab' | 'studio') {
  await page.keyboard.press('l')
  await expect.poll(async () => (await report(page)).look).toBe(to)
  await waitUntilStill(page, 20_000)
}

test('the View control and L switch the look, which settles to no frames', async ({ page }) => {
  // Opened in the Studio look, so the View control switches into the Lab look and L back out.
  await page.evaluate(() => localStorage.setItem('gpio.studio.look', 'studio'))
  await page.reload()
  await page.getByRole('tab', { name: 'Studio' }).click()
  await page.waitForFunction(
    () => ((window as unknown as StudioWindow).__studio?.loop.frames ?? 0) > 0
  )
  const start = (await report(page)).look
  expect(start).toBe('studio')
  const other = start === 'lab' ? 'studio' : 'lab'
  await view(page)
    .getByRole('button', { name: other === 'lab' ? 'Lab' : 'Studio' })
    .click()
  await expect.poll(async () => (await report(page)).look).toBe(other)
  await expect(view(page).getByRole('button', { pressed: true })).toHaveText(
    other === 'lab' ? 'Lab' : 'Studio'
  )
  const settled = await waitUntilStill(page, 20_000)
  await page.waitForTimeout(1500)
  expect(await frames(page)).toBe(settled)
  // The veil is clear again, and the vignette shows in the Lab look only.
  const opacity = (id: string) =>
    page.getByTestId(id).evaluate((el) => Number(getComputedStyle(el).opacity))
  await expect.poll(() => opacity('studio-veil')).toBe(0)
  expect(await opacity('studio-vignette')).toBeCloseTo(LAB.vignette)
  // The look is this machine's preference: it outlives a reload.
  await page.reload()
  await page.getByRole('tab', { name: 'Studio' }).click()
  await page.waitForFunction(
    () => ((window as unknown as StudioWindow).__studio?.loop.frames ?? 0) > 0
  )
  expect((await report(page)).look).toBe(other)
  await toggle(page, start)
  expect(await opacity('studio-vignette')).toBe(0)
})

test('a second round of switches makes no new GPU pipelines', async ({ page }) => {
  const first = (await report(page)).look
  const second = first === 'lab' ? 'studio' : 'lab'
  // The first round draws each look once, compiling what it needs.
  await toggle(page, second)
  await toggle(page, first)
  await toggle(page, second)
  await toggle(page, first)
  const before = await pipelines(page)
  expect(before).toBeGreaterThan(0)
  await toggle(page, second)
  await toggle(page, first)
  expect(await pipelines(page)).toBe(before)
})
