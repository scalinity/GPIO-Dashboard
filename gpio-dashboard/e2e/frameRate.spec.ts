// Frame-rate measurement for the Studio (SPEC 10.8, acceptance 9): a tutorial's board is dragged
// back and forth with every cable awake, and the frames, the main thread's time in them and the GPU
// buffers three creates are counted. It measures and asserts nothing, so it runs only on request:
//
//   FRAME_RATE=1 E2E_PORT=5871 npx playwright test e2e/frameRate.spec.ts
//
// FRAME_RATE_BASES lists dev servers to compare, as comma-separated origins (for example one on a
// checkout of an earlier commit): each round runs every scene once against each, one after the
// other, so a load that drifts hits them alike. FRAME_RATE_SCENES, FRAME_RATE_ROUNDS and
// FRAME_RATE_SECONDS set the tutorials, the repeats and the length of each drag; FRAME_RATE_PROFILE
// prints the main thread's CPU profile of each run.
import os from 'node:os'
import { type CDPSession, expect, type Page, test } from '@playwright/test'
import type { StudioView } from '../src/renderer/src/studio/view'
import { waitUntilStill } from './helpers'

type Counted = Window & {
  __studio: StudioView
  __buffers: number
}

interface Run {
  scene: string
  base: string
  load: number
  fps: number
  /** The frame loop's own reading, as the dev overlay's "last run". */
  lastRun: number | null
  /** The main thread's time in each frame (`StudioView.frame`), ms. */
  frameMs: number[]
  /** Its mean time in the render call, and per frame in the pointer handler that moves the board. */
  renderMs: number
  inputMs: number
  buffersPerFrame: number
  /** The GPU's summed pass time for a frame (timestamp queries), ms, median of ten frames. */
  gpuMs: number | null
}

const bases = (process.env.FRAME_RATE_BASES ?? '').split(',').filter(Boolean)
const scenes = (
  process.env.FRAME_RATE_SCENES ?? 'four-digit-seven-segment,led-dot-matrix,shift-register'
).split(',')
const rounds = Number(process.env.FRAME_RATE_ROUNDS ?? 3)
const seconds = Number(process.env.FRAME_RATE_SECONDS ?? 4)
// FRAME_RATE_THROTTLE slows the main thread by that factor, to stand in for a slower webview.
const throttle = Number(process.env.FRAME_RATE_THROTTLE ?? 1)

// The Tauri window is 1200 x 800 points at a pixel ratio of 2 (ADR-0082).
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const pick = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)]!

/** Opens a tutorial as the project, waits for its cables, and selects its first board. */
async function open(page: Page, base: string, id: string) {
  await page.addInitScript(() => {
    const w = window as unknown as Counted
    w.__buffers = 0
    const create = GPUDevice.prototype.createBuffer
    GPUDevice.prototype.createBuffer = function (this: GPUDevice, d: GPUBufferDescriptor) {
      w.__buffers += 1
      return create.call(this, d)
    }
  })
  await page.goto(`${base}/`)
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
      () => page.evaluate(() => (window as unknown as Counted).__studio?.cablesReport() != null),
      {
        timeout: 60_000
      }
    )
    .toBe(true)
  await waitUntilStill(page, 30_000)
}

/** Presses a hole of the first board that selects the board, and returns where. */
async function grabBoard(page: Page): Promise<{ x: number; y: number }> {
  const board = await page.evaluate(
    "import('/src/state/circuit.ts').then((m) => m.circuit.getSnapshot().boards[0].id)"
  )
  for (const row of [2, 5, 8, 12, 20, 28, 40, 50, 58, 61])
    for (const col of ['a', 'c', 'e', 'f', 'h', 'j']) {
      const at = await page.evaluate(
        (k) => (window as unknown as Counted).__studio.projectHole(k),
        `${board}:${row}${col}`
      )
      if (!at || at.x < 20 || at.x > 1180 || at.y < 20 || at.y > 780) continue
      await page.mouse.click(at.x, at.y)
      const selected = await page.evaluate(
        "import('/src/state/studioStore.ts').then((m) => m.useStudio.getState().selection)"
      )
      if ((selected as { kind?: string; id?: string } | null)?.kind === 'board') return at
    }
  throw new Error('no free spot on the board to press')
}

async function measure(page: Page, base: string, scene: string): Promise<Run> {
  await open(page, base, scene)
  const from = await grabBoard(page)
  await waitUntilStill(page, 10_000)
  const cdp =
    process.env.FRAME_RATE_PROFILE || throttle > 1 ? await page.context().newCDPSession(page) : null
  if (cdp && throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const drag = (length: number) =>
    page.evaluate(
      async ({ x0, y0, s }) => {
        const w = window as unknown as Counted
        const view = w.__studio
        const frameMs: number[] = []
        const frame = view.frame.bind(view)
        view.frame = (now: number) => {
          const t = performance.now()
          const more = frame(now)
          frameMs.push(performance.now() - t)
          return more
        }
        const render = view.post!.render.bind(view.post!)
        const renderMs: number[] = []
        view.post!.render = () => {
          const t = performance.now()
          render()
          renderMs.push(performance.now() - t)
        }
        let inputMs = 0
        const [f0, b0, t0] = [view.loop.frames, w.__buffers, performance.now()]
        await new Promise<void>((resolve) => {
          const step = () => {
            const t = (performance.now() - t0) / 1000
            if (t > s) return resolve()
            const before = performance.now()
            window.dispatchEvent(
              new PointerEvent('pointermove', {
                clientX: x0 + 40 * Math.sin(t * 2 * Math.PI * 0.8),
                clientY: y0,
                bubbles: true,
                pointerId: 1,
                buttons: 1
              })
            )
            inputMs += performance.now() - before
            requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        })
        const frames = view.loop.frames - f0
        const lastRun = view.loop.fps
        view.frame = frame
        view.post!.render = render
        return {
          frames,
          seconds: (performance.now() - t0) / 1000,
          lastRun,
          frameMs,
          renderMean: renderMs.reduce((a, b) => a + b, 0) / Math.max(1, renderMs.length),
          inputMs: inputMs / Math.max(1, frames),
          buffers: w.__buffers - b0
        }
      },
      { x0: from.x, y0: from.y, s: length }
    )
  // A second of warm-up (pipelines, buffers), then the count.
  await drag(1)
  if (cdp && process.env.FRAME_RATE_PROFILE) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
    await cdp.send('Profiler.start')
  }
  const load = os.loadavg()[0]!
  const r = await drag(seconds)
  if (cdp && process.env.FRAME_RATE_PROFILE) await profile(cdp, `${scene} @ ${base}`)
  await page.mouse.up()
  const gpuMs = await passTime(page)
  return {
    scene,
    base,
    load,
    fps: r.frames / r.seconds,
    lastRun: r.lastRun,
    frameMs: r.frameMs,
    renderMs: r.renderMean,
    inputMs: r.inputMs,
    buffersPerFrame: r.buffers / r.frames,
    gpuMs
  }
}

/**
 * The GPU's time over every pass of a frame, from the timestamp queries a dev build's renderer
 * keeps: ten frames, each resolved on its own. A pass is timed from its first stage to its last, and
 * waits on the one before it, so the sum is generous (ADR-0082); it compares builds, not frames.
 */
async function passTime(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    const view = (window as unknown as Counted).__studio
    const renderer = view.post!.renderer
    const sums: number[] = []
    for (let k = 0; k < 10; k++) {
      view.loop.changed()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await renderer.resolveTimestampsAsync('render')
      if (renderer.info.render.timestamp > 0) sums.push(renderer.info.render.timestamp)
    }
    sums.sort((a, b) => a - b)
    return sums.length ? sums[Math.floor(sums.length / 2)]! : null
  })
}

/** The CPU profile's time by function, self and with its callees, largest first. */
async function profile(cdp: CDPSession, label: string) {
  const { profile } = (await cdp.send('Profiler.stop')) as unknown as {
    profile: {
      nodes: {
        id: number
        children?: number[]
        callFrame: { functionName: string; url: string; lineNumber: number }
      }[]
      samples: number[]
      timeDeltas: number[]
    }
  }
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const nameOf = (id: number) => {
    const c = byId.get(id)!.callFrame
    const where = c.url.replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*/, '')
    return `${c.functionName || '(anonymous)'} ${where}:${c.lineNumber + 1}`
  }
  const selfMs = new Map<number, number>()
  profile.samples.forEach((id, i) =>
    selfMs.set(id, (selfMs.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000)
  )
  const self = new Map<string, number>()
  for (const [id, ms] of selfMs) self.set(nameOf(id), (self.get(nameOf(id)) ?? 0) + ms)
  // With callees: a function's time under each of its calls, counted once per call stack.
  const total = new Map<string, number>()
  const walk = (id: number, stack: Set<string>): number => {
    const name = nameOf(id)
    const nested = stack.has(name)
    stack.add(name)
    let ms = selfMs.get(id) ?? 0
    for (const child of byId.get(id)!.children ?? []) ms += walk(child, stack)
    if (!nested) {
      stack.delete(name)
      total.set(name, (total.get(name) ?? 0) + ms)
    }
    return ms
  }
  walk(profile.nodes[0]!.id, new Set())
  const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n)
  console.log(`  cpu profile, ${label} (ms over the run)`)
  console.log('  self')
  for (const [k, ms] of top(self, 30)) console.log(`    ${ms.toFixed(0).padStart(6)}  ${k}`)
  console.log('  with callees')
  for (const [k, ms] of top(total, 45)) console.log(`    ${ms.toFixed(0).padStart(6)}  ${k}`)
  console.log("  the app's own functions, with callees")
  for (const [k, ms] of top(new Map([...total].filter(([k]) => / src\//.test(k))), 60))
    console.log(`    ${ms.toFixed(0).padStart(6)}  ${k}`)
  console.log("  three's functions, with callees")
  for (const [k, ms] of top(new Map([...total].filter(([k]) => /chunk-|three_/.test(k))), 70))
    console.log(`    ${ms.toFixed(0).padStart(6)}  ${k}`)
}

test.skip(!process.env.FRAME_RATE, 'a measurement: set FRAME_RATE=1 to run it')

test('frame rate while dragging a board with the cables awake', async ({ page, baseURL }) => {
  test.setTimeout(60 * 60_000)
  const origins = bases.length ? bases : [baseURL!]
  const runs: Run[] = []
  for (let round = 1; round <= rounds; round++)
    for (const scene of scenes)
      for (const base of origins) {
        const fresh = await page.context().newPage()
        try {
          const run = await measure(fresh, base, scene)
          runs.push(run)
          console.log(
            `round ${round} ${scene.padEnd(26)} ${base.slice(-5)}  ${run.fps.toFixed(1)} fps  ` +
              `view.frame ${mean(run.frameMs).toFixed(1)} ms  render ${run.renderMs.toFixed(1)} ms  ` +
              `input ${run.inputMs.toFixed(1)} ms  buffers/frame ${run.buffersPerFrame.toFixed(1)}  ` +
              `gpu ${run.gpuMs?.toFixed(1) ?? 'n/a'} ms  load ${run.load.toFixed(1)}`
          )
        } finally {
          await fresh.close()
        }
      }
  console.log(
    `\nover ${rounds} rounds, main thread slowed ${throttle}x: fps median [each]; view.frame mean, p95; ` +
      'render mean; input mean (ms per frame); buffers a frame; gpu pass sum (ms); load'
  )
  for (const scene of scenes)
    for (const base of origins) {
      const mine = runs.filter((r) => r.scene === scene && r.base === base)
      const frameMs = mine.flatMap((r) => r.frameMs)
      console.log(
        `${scene.padEnd(26)} ${base.slice(-5)}  ${median(mine.map((r) => r.fps)).toFixed(1)} fps ` +
          `[${mine.map((r) => r.fps.toFixed(1)).join(' ')}]  ` +
          `view.frame ${mean(frameMs).toFixed(1)}, ${pick(frameMs, 0.95).toFixed(1)}  ` +
          `render ${mean(mine.map((r) => r.renderMs)).toFixed(1)}  ` +
          `input ${mean(mine.map((r) => r.inputMs)).toFixed(1)}  ` +
          `buffers ${mean(mine.map((r) => r.buffersPerFrame)).toFixed(1)}  ` +
          `gpu ${median(mine.map((r) => r.gpuMs ?? 0)).toFixed(1)}  ` +
          `load ${Math.min(...mine.map((r) => r.load)).toFixed(1)}-${Math.max(...mine.map((r) => r.load)).toFixed(1)}`
      )
    }
})
