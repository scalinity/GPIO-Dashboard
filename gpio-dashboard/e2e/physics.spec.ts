// The cables in real time (SPEC 10.5, 11.3; acceptance 13): opening settles the cables offscreen,
// and dragging the Pi, a board, the T-board, a module or a lead end moves them while the drag goes
// on; they settle once it ends, the scene stops drawing within 2 s, and nothing ends up more than
// 0.5 mm inside a collider or another cable, measured here from the worker's own positions. A
// lead dragged mid-span keeps one route hint, and reopening the project shows it the same.
import { expect, type Page, test } from '@playwright/test'
import type { CircuitDoc } from '../src/renderer/src/core/model/types'
import type { CablesReport } from '../src/renderer/src/studio/cables'
import { hole, type Point, studio, waitUntilStill } from './helpers'

type Vec3 = [number, number, number]
type Quat = [number, number, number, number]

const doc = (page: Page) =>
  page.evaluate(
    "import('/src/state/circuit.ts').then((m) => m.circuit.getSnapshot())"
  ) as Promise<CircuitDoc>

const cables = (page: Page) => studio(page, (s) => s.cablesReport())

const screen = async (page: Page, p: readonly number[]): Promise<Point> =>
  (await page.evaluate(
    (q) =>
      (
        window as unknown as { __studio: { projectPoint(p: number[]): Point } }
      ).__studio.projectPoint(q),
    [...p]
  ))!

/**
 * Opens a tutorial's circuit as a project of my own (so edits commit), or a new project on the
 * bench layout, and waits for its cables.
 */
async function openProject(page: Page, id: string | 'new') {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Studio' }).click()
  await page.evaluate(
    `Promise.all([import('/src/core/defs/tutorials.ts'), import('/src/core/model/defaults.ts'), import('/src/state/circuit.ts')]).then(([t, d, c]) => {
      const doc = '${id}' === 'new' ? d.newDoc('Bench', new Date().toISOString()) : structuredClone(t.TUTORIALS.find((x) => x.meta.id === '${id}').doc)
      delete doc.meta.sourceTutorialId
      c.circuit.open(doc)
    })`
  )
  await expect.poll(() => cables(page), { timeout: 30_000 }).not.toBeNull()
  await waitUntilStill(page, 20_000)
}

// ---- Measuring from the worker's positions -------------------------------------------------------

const WIRE_R = 0.5
const RIBBON_R = 0.95 / 2

/** v rotated by the inverse of unit quaternion q. */
function unrotate([x, y, z, w]: Quat, [vx, vy, vz]: Vec3): Vec3 {
  const q: Quat = [-x, -y, -z, w]
  const tx = 2 * (q[1] * vz - q[2] * vy),
    ty = 2 * (q[2] * vx - q[0] * vz),
    tz = 2 * (q[0] * vy - q[1] * vx)
  return [
    vx + q[3] * tx + (q[1] * tz - q[2] * ty),
    vy + q[3] * ty + (q[2] * tx - q[0] * tz),
    vz + q[3] * tz + (q[0] * ty - q[1] * tx)
  ]
}

/** Signed distance from a point to a collider: negative inside. */
function signedDistance(p: Vec3, c: CablesReport['colliders'][number]): number {
  const d: Vec3 = [p[0] - c.pose.position[0], p[1] - c.pose.position[1], p[2] - c.pose.position[2]]
  const [x, y, z] = unrotate(c.pose.rotation as Quat, d)
  if (c.shape.kind === 'capsule') {
    const t = Math.max(-c.shape.halfLength, Math.min(c.shape.halfLength, z))
    return Math.hypot(x, y, z - t) - c.shape.radius
  }
  const q = [Math.abs(x), Math.abs(y), Math.abs(z)].map((v, a) => v - c.shape.halfExtents![a]!)
  return Math.hypot(...q.map((v) => Math.max(v, 0))) + Math.min(Math.max(...q), 0)
}

/** Points along a cable's surface to test: every 0.5 mm along a lead, each free ribbon particle. */
function samples(c: CablesReport['cables'][number]): Vec3[] {
  const p = (i: number): Vec3 => [c.points[3 * i]!, c.points[3 * i + 1]!, c.points[3 * i + 2]!]
  const n = c.points.length / 3
  const out: Vec3[] = []
  if (c.kind === 'ribbon') {
    // The first and last two rows are clamped in the sockets (ADR-0061).
    for (let r = 2; r < c.rows - 2; r++)
      for (let k = 0; k < c.columns; k++) out.push(p(r * c.columns + k))
    return out
  }
  for (let i = 0; i + 1 < n; i++) {
    const [a, b] = [p(i), p(i + 1)]
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.5))
    for (let s = 0; s < steps; s++)
      out.push([0, 1, 2].map((k) => a[k]! + ((b[k]! - a[k]!) * s) / steps) as Vec3)
  }
  out.push(p(n - 1))
  return out
}

/** The deepest any cable reaches into a collider or into another cable, mm, and where. */
function penetration(r: CablesReport): { depth: number; where: string } {
  let worst = { depth: -Infinity, where: '' }
  const cut = (depth: number, where: string) => {
    if (depth > worst.depth) worst = { depth, where }
  }
  const sampled = r.cables.map((c) => ({
    c,
    radius: c.kind === 'ribbon' ? RIBBON_R : WIRE_R,
    pts: samples(c)
  }))
  for (const { c, radius, pts } of sampled)
    for (const col of r.colliders)
      for (const p of pts) cut(radius - signedDistance(p, col), `${c.key} in ${col.key}`)
  // Lead against lead: sample against sample, which a 0.5 mm spacing makes good to about 0.03 mm.
  const leads = sampled.filter((s) => s.c.kind !== 'ribbon')
  for (let i = 0; i < leads.length; i++)
    for (let j = i + 1; j < leads.length; j++)
      for (const p of leads[i]!.pts)
        for (const q of leads[j]!.pts) {
          const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
          if (d < 2 * WIRE_R) cut(2 * WIRE_R - d - 0.03, `${leads[i]!.c.key} in ${leads[j]!.c.key}`)
        }
  return worst
}

/** How far a cable's particles have moved between two reports, at most, mm. */
function moved(before: CablesReport, after: CablesReport, key: string): number {
  const [a, b] = [before, after].map((r) => r.cables.find((c) => c.key === key)!.points)
  let most = 0
  for (let i = 0; i + 2 < a!.length; i += 3)
    most = Math.max(
      most,
      Math.hypot(b![i]! - a![i]!, b![i + 1]! - a![i + 1]!, b![i + 2]! - a![i + 2]!)
    )
  return most
}

/**
 * Presses at `from` and moves to `to` in steps, then: the cables named in `follow` have moved
 * while the button is still down; after release the document changed, the scene stops drawing
 * within 2 s, every cable sleeps and nothing penetrates more than 0.5 mm.
 */
async function dragAndSettle(
  page: Page,
  from: Point,
  to: Point,
  follow: string[],
  committed: (before: CircuitDoc, after: CircuitDoc) => boolean
) {
  const before = (await cables(page))!
  const docBefore = await doc(page)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let k = 1; k <= 12; k++) {
    await page.mouse.move(from.x + ((to.x - from.x) * k) / 12, from.y + ((to.y - from.y) * k) / 12)
    await page.waitForTimeout(30)
  }
  // The cables follow during the drag, before anything is committed.
  await page.waitForTimeout(300)
  const during = (await cables(page))!
  expect(await doc(page)).toEqual(docBefore)
  for (const key of follow)
    expect(moved(before, during, key), `${key} follows the drag`).toBeGreaterThan(1)
  const released = await page.evaluate(() => performance.now())
  await page.mouse.up()
  await expect.poll(async () => committed(docBefore, await doc(page))).toBe(true)
  await waitUntilStill(page, 10_000)
  const lastFrame = await studio(page, (s) => s.loop.lastAt)
  const after = (await cables(page))!
  const deepest = penetration(after)
  const stopMs = lastFrame - released
  test.info().annotations.push({
    type: 'settle',
    description: `last frame ${stopMs.toFixed(0)} ms after release; deepest ${deepest.depth.toFixed(3)} mm (${deepest.where})`
  })
  console.log(
    `  last frame ${stopMs.toFixed(0)} ms after release; deepest ${deepest.depth.toFixed(3)} mm (${deepest.where})`
  )
  expect(stopMs, 'the scene stops drawing within 2 s of the last input').toBeLessThanOrEqual(2000)
  expect(after.cables.every((c) => c.asleep)).toBe(true)
  expect(deepest.depth, deepest.where).toBeLessThanOrEqual(0.5)
}

test.describe('cables on the DHT11 circuit', () => {
  test.beforeEach(async ({ page }) => {
    await openProject(page, 'dht11')
  })

  test('opening settles the cables offscreen and shows them at rest, clear of everything', async ({
    page
  }) => {
    const r = (await cables(page))!
    expect(r.cables.map((c) => c.key).sort()).toEqual(['W1', 'W2', 'W3', 'W4', 'W5', 'ribbon'])
    expect(r.cables.every((c) => c.asleep)).toBe(true)
    const deepest = penetration(r)
    expect(deepest.depth, deepest.where).toBeLessThanOrEqual(0.5)
    // Every lead ends where its housings are drawn.
    const report = await studio(page, (s) => s.report())
    expect(report.housings).toEqual({ male: 7, female: 3 })
  })

  test('dragging the Pi re-drapes the ribbon', async ({ page }) => {
    const pi = (await doc(page)).controller.pi.transform.position
    const from = await screen(page, [pi[0] + 42, pi[1] + 20, 3])
    const to = await screen(page, [pi[0] + 12, pi[1] - 15, 3])
    await dragAndSettle(
      page,
      from,
      to,
      ['ribbon'],
      (a, b) => JSON.stringify(a.controller.pi) !== JSON.stringify(b.controller.pi)
    )
  })

  test('dragging the board carries its leads and the ribbon', async ({ page }) => {
    const from = await hole(page, 'bb1:55e')
    await page.mouse.click(from.x, from.y)
    const to = await hole(page, 'bb1:58e')
    await dragAndSettle(
      page,
      from,
      to,
      ['W1', 'W3', 'ribbon'],
      (a, b) => JSON.stringify(a.boards) !== JSON.stringify(b.boards)
    )
  })

  test('dragging the module drags its leads', async ({ page }) => {
    const pose = (await doc(page)).parts.find((p) => p.id === 'DHT1')!.placement.offboardPose!
    const from = await screen(page, [pose.position[0] + 8, pose.position[1] + 8, 8])
    const to = await screen(page, [pose.position[0] + 28, pose.position[1] + 18, 8])
    await dragAndSettle(
      page,
      from,
      to,
      ['W3', 'W4', 'W5'],
      (a, b) => JSON.stringify(a.parts) !== JSON.stringify(b.parts)
    )
  })

  test("dragging a lead's end moves the lead", async ({ page }) => {
    const from = await hole(page, 'bb1:30a')
    const to = await hole(page, 'bb1:45a')
    await dragAndSettle(
      page,
      from,
      to,
      ['W1'],
      (_, b) =>
        JSON.stringify(b.wires.find((w) => w.id === 'W1')!.b) ===
        JSON.stringify({ hole: { board: 'bb1', area: 'main', row: 45, col: 'a' } })
    )
  })
})

test.describe('cables on the bench layout', () => {
  test.beforeEach(async ({ page }) => {
    await openProject(page, 'new')
  })

  // Leads in the T-board's strips would be left behind, so the T-board moves on its own here.
  test('dragging the T-board moves the ribbon', async ({ page }) => {
    const from = await hole(page, 'bb1:10f')
    const to = await hole(page, 'bb1:13f')
    await dragAndSettle(
      page,
      from,
      to,
      ['ribbon'],
      (a, b) => b.controller.tboard.pin1Row === a.controller.tboard.pin1Row + 3
    )
  })
})

test.describe('route hints', () => {
  test.beforeEach(async ({ page }) => {
    // The native project commands, kept in memory: the dialogs are Rust's, outside the page.
    await page.addInitScript(() => {
      const files = new Map<string, unknown>()
      const meta = (d: unknown) => (d as { meta: { name: string; updated: string } }).meta
      ;(window as unknown as { api: unknown }).api = {
        projects: {
          list: async () => ({
            success: true,
            projects: [...files].map(([id, d]) => ({ id, ...meta(d) }))
          }),
          read: async (id: string) => ({ success: true, doc: structuredClone(files.get(id)) }),
          write: async (id: string, d: unknown) => (
            files.set(id, structuredClone(d)),
            { success: true }
          )
        }
      }
    })
    await openProject(page, 'blinking-led')
  })

  test('a lead dragged mid-span keeps one route hint, and reopens looking the same', async ({
    page
  }) => {
    const lead = () => cables(page).then((r) => r!.cables.find((c) => c.key === 'W1')!.points)
    const before = await lead()
    const mid = 3 * Math.floor(before.length / 6)
    const from = await screen(page, before.slice(mid, mid + 3))
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let k = 1; k <= 12; k++) {
      await page.mouse.move(from.x, from.y - 5 * k)
      await page.waitForTimeout(30)
    }
    await page.mouse.up()
    await expect.poll(async () => (await doc(page)).wires[0]!.routeHints?.length).toBe(1)
    const hint = (await doc(page)).wires[0]!.routeHints![0]!
    await waitUntilStill(page, 10_000)
    const pulled = await lead()
    const nearest = (points: number[]) =>
      Math.min(
        ...Array.from({ length: points.length / 3 }, (_, i) =>
          Math.hypot(...[0, 1, 2].map((k) => points[3 * i + k]! - hint[k]!))
        )
      )
    // The lead now runs through its hint, within the hint's give.
    expect(nearest(before)).toBeGreaterThan(10)
    expect(nearest(pulled)).toBeLessThan(2)

    // Saved, replaced by a new project and reopened from the gallery: settled afresh, the lead
    // takes the same shape.
    const menu = async (item: string) => {
      await page.getByRole('button', { name: 'Project' }).click()
      await page.getByRole('menuitem', { name: item, exact: true }).click()
    }
    await menu('Save')
    await menu('New')
    await expect.poll(async () => (await doc(page)).wires.length).toBe(0)
    await menu('Projects gallery')
    await page
      .getByRole('dialog', { name: 'Projects' })
      .getByRole('button', { name: /Blinking LED/ })
      .click()
    await expect.poll(async () => (await doc(page)).wires[0]?.routeHints).toEqual([hint])
    await expect.poll(async () => (await cables(page))?.cables.length).toBe(3)
    await waitUntilStill(page, 10_000)
    const reopened = await lead()
    let apart = 0
    for (let i = 0; i < pulled.length; i += 3)
      apart = Math.max(
        apart,
        Math.hypot(...[0, 1, 2].map((k) => reopened[i + k]! - pulled[i + k]!))
      )
    console.log(`  reopened: every particle within ${apart.toFixed(2)} mm of where it was`)
    expect(nearest(reopened)).toBeLessThan(2)
    expect(apart).toBeLessThan(3)
  })
})
