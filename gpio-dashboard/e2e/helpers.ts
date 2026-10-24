// Shared by the Studio's sim-driven e2e files: reads from the dev build's `window.__studio`, waits
// for the scene to go still, and opens a tutorial into the app's document.
import { expect, type Page } from '@playwright/test'
import type { StudioView } from '../src/renderer/src/studio/view'

export type StudioWindow = Window & { __studio: StudioView }
export type Point = { x: number; y: number }

/** Runs `run` in the page against the Studio view. */
export const studio = <T>(page: Page, run: (s: StudioView) => T) =>
  page.evaluate(`(${run.toString()})(window.__studio)`) as Promise<Awaited<T>>

export const frames = (page: Page) => studio(page, (s) => s.loop.frames)
export const report = (page: Page) => studio(page, (s) => s.report())

/** Waits until no frame has been drawn for 300 ms; fails if that takes longer than `limitMs`. */
export async function waitUntilStill(page: Page, limitMs: number): Promise<number> {
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

export const hole = async (page: Page, key: string): Promise<Point> =>
  (await page.evaluate((k) => (window as unknown as StudioWindow).__studio.projectHole(k), key))!

export async function showStudio(page: Page) {
  await page.getByRole('tab', { name: 'Studio' }).click()
  await page.waitForFunction(
    () => ((window as unknown as StudioWindow).__studio?.loop.frames ?? 0) > 0
  )
}

/** Opens a tutorial's document into the app and shows the Studio with its parts drawn and still. */
export async function openTutorial(page: Page, id: string) {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Workbench' }).click()
  await page.evaluate(
    `Promise.all([import('/src/core/defs/tutorials.ts'), import('/src/state/workbenchStore.ts')]).then(([t, w]) => w.useWorkbench.getState().open('${id}', t.TUTORIALS.find((x) => x.meta.id === '${id}').doc))`
  )
  await showStudio(page)
  // The models arrive one by one; the first settle also compiles pipelines.
  await expect
    .poll(async () => Object.values((await report(page)).parts).every((p) => p.body))
    .toBe(true)
  await waitUntilStill(page, 20_000)
}

/** Reads the Workbench store: `read` is an expression over its state `s`. */
export const workbench = <T>(page: Page, read: string) =>
  page.evaluate(
    `import('/src/state/workbenchStore.ts').then((m) => { const s = m.useWorkbench.getState(); return ${read} })`
  ) as Promise<T>

/** What GPIO `bcm` reads as an input in the simulation. */
export const reads = (page: Page, bcm: number) =>
  workbench<string | undefined>(page, `s.sim?.reads[${bcm}]`)

/** An animated channel's value: mm, degrees or radians, by `part.node`. */
export const motion = async (page: Page, key: string) => (await report(page)).sim.motion[key]
