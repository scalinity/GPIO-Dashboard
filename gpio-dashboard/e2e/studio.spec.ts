// The Studio in Chromium (SPEC 10.2, 11.2–11.9; acceptance 8 and 9): the backend shows in the dev
// overlay, a hover highlights its strip and net on the next frame, a still scene draws nothing,
// the Blinking LED circuit builds by hand with live ERC and undoes to an empty document, drags
// glow green and red, projects save and reopen, and the top bar keeps to one row.
import { expect, type Page, test } from '@playwright/test'
import type { CircuitDoc } from '../src/renderer/src/core/model/types'
import type { StudioView } from '../src/renderer/src/studio/view'
import { openTutorial } from './helpers'

type StudioWindow = Window & { __studio: StudioView }
type Point = { x: number; y: number }

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

// The app's modules, as the dev server serves them (the strings run in the page as they are).
const doc = (page: Page) =>
  page.evaluate(
    "import('/src/state/circuit.ts').then((m) => m.circuit.getSnapshot())"
  ) as Promise<CircuitDoc>

const hole = async (page: Page, key: string): Promise<Point> =>
  (await page.evaluate((k) => (window as unknown as StudioWindow).__studio.projectHole(k), key))!

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
}

/** Finds a part through the library's search; returns where to start dragging it. */
async function libraryItem(page: Page, [query, name]: [string, RegExp]): Promise<Point> {
  await page.getByLabel('Search parts').fill(query)
  const box = (await page.getByRole('button', { name }).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const RESISTOR: [string, RegExp] = ['resistor', /^Resistor, 1\/4 W axial/]
const LED: [string, RegExp] = ['led round', /^LED, round single colour/]

async function openStudio(page: Page) {
  await page.getByRole('tab', { name: 'Studio' }).click()
  await page.waitForFunction(
    () => ((window as unknown as StudioWindow).__studio?.loop.frames ?? 0) > 0
  )
  // The first frames compile pipelines, so the first settle may take a while.
  await waitUntilStill(page, 15_000)
}

const blur = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

async function menu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Project' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

test.describe('on the blink sample', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // The Workbench opens the sample into the app's document, which the Studio renders.
    await page.getByRole('tab', { name: 'Workbench' }).click()
    await page.getByLabel('Open a sample').selectOption('sample-blink')
    await page.getByRole('tab', { name: 'Studio' }).click()
    await expect(page.getByLabel('Project name')).toHaveValue('Sample: blink an LED on GPIO17')
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
    await waitUntilStill(page, 15_000)
    const at = await hole(page, 'bb1:30e')
    await page.mouse.move(at.x, at.y)

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

  test('draws the bench, its parts and every lead end in its hole', async ({ page }) => {
    await waitUntilStill(page, 15_000)
    const report = () => page.evaluate(() => (window as unknown as StudioWindow).__studio.report())
    // The models arrive one by one; each arrival draws again.
    await expect
      .poll(async () => {
        const r = await report()
        return [r.tboards, r.sockets, r.ribbons, r.housings.male, Object.keys(r.copies).length]
      })
      .toEqual([1, 2, 1, 4, 2])
    const r = await report()
    expect(r.piPins).toBe(40)
    expect(r.housings.female).toBe(0)
    expect(r.copies).toEqual({ 'resistor.glb': 1, 'led-5mm.glb': 1 })
    expect(r.parts).toMatchObject({ R1: { body: true, leads: 2 }, D1: { body: true, leads: 2 } })
    // The ribbon has its real length (ribbon.json), well over the sockets' span.
    expect(r.ribbonMm).toBeCloseTo(200, 0)
    // Part leads end down their holes; each male Dupont pin stands its exposed length in.
    expect(r.leadEnds.map((e) => e.id).sort()).toEqual(
      ['D1.A', 'D1.K', 'R1.1', 'R1.2', 'W1.a', 'W1.b', 'W2.a', 'W2.b'].sort()
    )
    for (const end of r.leadEnds) {
      expect(end.offAxisMm, end.id).toBeLessThanOrEqual(0.05)
      expect(end.depthMm, end.id).toBeCloseTo(end.id.startsWith('W') ? 5.5 : 2, 2)
    }
    test.info().annotations.push({
      type: 'lead ends',
      description: `max off-axis ${Math.max(...r.leadEnds.map((e) => e.offAxisMm)).toExponential(2)} mm`
    })
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

  test('a preset button and a key both move the camera', async ({ page }) => {
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
    // The Iso key takes it back where it started.
    await page.keyboard.press('2')
    await waitUntilStill(page, 2000)
    expect(await camera()).toEqual(iso)
  })
})

test.describe('building by hand', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await openStudio(page)
    await menu(page, 'New')
    await expect(page.getByLabel('Project name')).toHaveValue('Untitled')
  })

  test('a drag from the library glows green on free holes and red on taken ones', async ({
    page
  }) => {
    const ghost = () => page.evaluate(() => (window as unknown as StudioWindow).__studio.ghost)
    const from = await libraryItem(page, RESISTOR)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    const free = await hole(page, 'bb1:40b')
    await page.mouse.move(free.x, free.y, { steps: 6 })
    await expect.poll(ghost).toEqual({ holes: ['bb1:40b', 'bb1:41b'], legal: [true, true] })
    // Rows 1 and 2, column d, hold T-board pins 1 and 3.
    const taken = await hole(page, 'bb1:1d')
    await page.mouse.move(taken.x, taken.y, { steps: 6 })
    await expect.poll(ghost).toEqual({ holes: ['bb1:1d', 'bb1:2d'], legal: [false, false] })
    // Let go over the library: nothing is placed.
    await page.mouse.move(from.x, from.y, { steps: 6 })
    await page.mouse.up()
    expect((await doc(page)).parts).toEqual([])
  })

  test('the Blinking LED circuit, with live ERC and matching steps, then undone to empty', async ({
    page
  }) => {
    const initial = await doc(page)
    const ercTab = page.getByRole('tab', { name: /^ERC/ })
    await ercTab.click()
    await expect(ercTab).toHaveText('ERC (0 errors)')
    // The drawer shrinks the canvas; holes are projected once the camera has caught up.
    await waitUntilStill(page, 5000)

    // R1 from the library, then its second lead dragged out to row 34 (anchor plus span).
    await drag(page, await libraryItem(page, RESISTOR), await hole(page, 'bb1:30b'))
    await expect.poll(async () => (await doc(page)).parts.map((p) => p.id)).toEqual(['R1'])
    await drag(page, await hole(page, 'bb1:31b'), await hole(page, 'bb1:34b'))
    await expect
      .poll(async () => (await doc(page)).parts[0]!.placement.pins['2'])
      .toEqual({ board: 'bb1', area: 'main', row: 34, col: 'b' })
    await drag(page, await libraryItem(page, LED), await hole(page, 'bb1:34c'))
    await expect.poll(async () => (await doc(page)).parts.map((p) => p.id)).toEqual(['R1', 'D1'])

    // The wire tool: 3V3's strip to row 30, then the cathode's row to GPIO17's strip. Keys go
    // to the Studio once the search field lets go of the focus.
    await blur(page)
    await page.keyboard.press('w')
    for (const [a, b] of [
      ['bb1:1a', 'bb1:30a'],
      ['bb1:35a', 'bb1:6a']
    ]) {
      const p = await hole(page, a!)
      await page.mouse.click(p.x, p.y)
      const q = await hole(page, b!)
      await page.mouse.click(q.x, q.y)
    }
    await expect.poll(async () => (await doc(page)).wires.map((w) => w.id)).toEqual(['W1', 'W2'])

    // Properties: the resistor's E12 picker, with its bands; there and back is two edits.
    await page.keyboard.press('Escape')
    const r1 = await hole(page, 'bb1:32b')
    await page.mouse.click(r1.x, r1.y)
    const resistance = page.getByRole('combobox', { name: 'Resistance', exact: true })
    await resistance.selectOption('330')
    await expect(page.getByLabel(/^Bands:/)).toHaveAttribute(
      'aria-label',
      'Bands: orange, orange, brown, gold'
    )
    await resistance.selectOption('220')
    await expect(page.getByLabel(/^Bands:/)).toHaveAttribute(
      'aria-label',
      'Bands: red, red, brown, gold'
    )
    await blur(page)

    // ERC follows every edit: a lead from 3V3 to GND is an error, and undoing it clears it.
    await page.keyboard.press('w')
    for (const key of ['bb1:1b', 'bb1:3j']) {
      const p = await hole(page, key)
      await page.mouse.click(p.x, p.y)
    }
    await expect(ercTab).toHaveText(/^ERC \([1-9]\d* errors?\)$/)
    await expect(page.getByRole('tabpanel', { name: 'erc' })).toContainText('SHORT_SUPPLY')
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(ercTab).toHaveText('ERC (0 errors)')

    // The document is the tutorial's circuit, and its generated steps are the tutorial's.
    const built = await doc(page)
    const tutorial = (await page.evaluate(
      "import('/src/core/defs/tutorials.ts').then((m) => m.TUTORIALS.find((t) => t.meta.id === 'blinking-led').doc)"
    )) as CircuitDoc
    expect(built.parts).toEqual(tutorial.parts)
    expect(built.wires).toEqual(tutorial.wires)
    const expected = (await page.evaluate(
      "Promise.all([import('/src/core/defs/tutorials.ts'), import('/src/core/steps/steps.ts'), import('/src/core/defs/parts.ts')]).then(([t, s, p]) => s.buildSteps(t.TUTORIALS.find((x) => x.meta.id === 'blinking-led').doc, p.partDef).steps.map((x) => x.text))"
    )) as string[]
    await page.getByRole('tab', { name: 'Build Steps' }).click()
    const steps = page
      .getByRole('list', { name: 'Build steps' })
      .locator(':scope > li > p:first-child')
    await expect(steps).toHaveText(expected)

    // Undo every edit: the document is the empty one it started as.
    const undo = page.getByRole('button', { name: 'Undo' })
    while (await undo.isEnabled()) await page.keyboard.press('ControlOrMeta+z')
    expect(await doc(page)).toEqual(initial)
  })
})

test.describe('projects', () => {
  test.beforeEach(async ({ page }) => {
    // The native project commands, kept in memory: the dialogs are Rust's, outside the page.
    await page.addInitScript(() => {
      const files = new Map<string, unknown>()
      let picked: unknown = null
      const copy = <T>(x: T): T => structuredClone(x)
      const meta = (d: unknown) => (d as { meta: { name: string; updated: string } }).meta
      ;(window as unknown as { api: unknown }).api = {
        projects: {
          list: async () => ({
            success: true,
            projects: [...files].map(([id, d]) => ({ id, ...meta(d) }))
          }),
          read: async (id: string) =>
            files.has(id)
              ? { success: true, doc: copy(files.get(id)) }
              : { success: false, error: 'Project not found' },
          write: async (id: string, d: unknown) => (files.set(id, copy(d)), { success: true }),
          delete: async (id: string) => (files.delete(id), { success: true }),
          export: async (d: unknown) => ((picked = copy(d)), { success: true, path: '/x.gpiob' }),
          import: async () => (picked ? { success: true, doc: copy(picked) } : { canceled: true })
        }
      }
    })
    await page.goto('/')
    await openStudio(page)
    await menu(page, 'New')
  })

  test('saves to the gallery and reopens; saves as a file and opens it', async ({ page }) => {
    await drag(page, await libraryItem(page, LED), await hole(page, 'bb1:40b'))
    await expect.poll(async () => (await doc(page)).parts.length).toBe(1)
    const name = page.getByLabel('Project name')
    await name.fill('My blinker')
    await name.press('Enter')
    await expect.poll(async () => (await doc(page)).meta.name).toBe('My blinker')

    await menu(page, 'Save')
    const saved = await doc(page)
    await menu(page, 'New')
    await expect(name).toHaveValue('Untitled')
    await menu(page, 'Projects gallery')
    await page
      .getByRole('dialog', { name: 'Projects' })
      .getByRole('button', { name: /My blinker/ })
      .click()
    await expect(name).toHaveValue('My blinker')
    expect(await doc(page)).toEqual(saved)

    await menu(page, 'Save As…')
    await menu(page, 'New')
    await expect(name).toHaveValue('Untitled')
    await menu(page, 'Open…')
    await expect(name).toHaveValue('My blinker')
    expect(await doc(page)).toEqual(saved)
  })
})

// The top bar stays one row (SPEC 11.2) from the narrowest window up, holding the most it ever
// does: a template's badge and Fork, an error, the Pi connected with its agent running, and both a
// simulation and a Pi program to stop.
for (const width of [900, 1024, 1099, 1100, 1168])
  test(`the top bar keeps every control on one row in a ${width} px window`, async ({ page }) => {
    await page.setViewportSize({ width, height: 734 })
    await openTutorial(page, 'blinking-led')
    await page.evaluate(`Promise.all([
      import('/src/store/connectionStore.js').then((m) => m.default.setState({ status: 'connected', agentStatus: 'running' })),
      import('/src/state/projectStore.ts').then((m) => m.useProject.setState({ error: 'Could not save the project' })),
      import('/src/state/workbenchStore.ts').then((m) => m.useWorkbench.setState({ codeStatus: 'running' })),
      import('/src/state/runStore.ts').then((m) => m.useRun.setState({ status: 'running' }))
    ])`)
    const bar = page.getByTestId('studio-topbar')
    await expect(bar.getByRole('button', { name: 'Stop on Pi' })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await expect(bar.getByText('Template · read-only')).toBeVisible()
    const row = (await bar.boundingBox())!
    expect(row.height).toBeLessThanOrEqual(48)
    const buttons = await bar.getByRole('button').all()
    expect(buttons.length).toBeGreaterThanOrEqual(10)
    for (const control of [...buttons, bar.getByLabel('Project name')]) {
      const box = (await control.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(row.y)
      expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height)
      // Inside the bar's 12 px right padding: a control that eats into it is about to be clipped.
      expect(box.x + box.width).toBeLessThanOrEqual(width - 12)
    }
  })
