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

/**
 * Settles to a still frame that does not depend on how the camera got there, so two captures of
 * one scene compare pixel for pixel. TRAA weighs each new frame at 0.05 and GTAO turns its noise
 * with the frame number, so two still frames differ where the jitter's or the noise's phase
 * differs, and the Lab look's grain moves with time. Each of four settling runs therefore starts
 * at TRAA's first jitter offset and on a frame GTAO's 12-frame cycle starts on, with time held at
 * 0; the four runs leave under 4% of whatever was drawn before.
 */
export async function settleExactly(page: Page) {
  for (let run = 0; run < 4; run++) {
    await page.evaluate(() => {
      const view = (window as unknown as StudioWindow).__studio
      const post = view.post as unknown as {
        render(): void
        renderer: { _nodes: { nodeFrame: { frameId: number; time: number } } }
        resolved: { _jitterIndex: number }
      }
      const render = Object.getPrototypeOf(post).render as () => void
      const frame = post.renderer._nodes.nodeFrame
      let first = true
      post.render = () => {
        if (first) {
          frame.frameId += (12 - (frame.frameId % 12)) % 12
          post.resolved._jitterIndex = 0
          first = false
        }
        frame.time = 0
        render.call(post)
      }
      view.controls.dispatchEvent({ type: 'change' })
    })
    await waitUntilStill(page, 10_000)
  }
  await page.evaluate(() => {
    const post = (window as unknown as StudioWindow).__studio.post as unknown as {
      render?: unknown
    }
    delete post.render
  })
}

/** The mean and largest per-channel difference of two PNGs (of 255), decoded in the page. */
export function difference(page: Page, a: Buffer, b: Buffer) {
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
