// Placing from the library by dragging, as a user does, and the side panels around the bench: an
// off-board module dropped over the breadboard rests on its top (it sank into it), the bar graph
// lands where it is dropped and snaps across the trench from anywhere else, a part that may not go
// where it fits is drawn there in red, a board stops against the Pi, and the panels slide away for
// an immersive bench and come back, the canvas resizing once each way.
import { expect, type Page, test } from '@playwright/test'
import { hole, report, showStudio, type StudioWindow, waitUntilStill } from './helpers'

/** A bench with the Blinking LED's boards and no parts, as a new project has. */
async function emptyBench(page: Page) {
  await page.goto('/')
  await showStudio(page)
  await page.evaluate(
    `Promise.all([import('/src/core/defs/tutorials.ts'), import('/src/state/circuit.ts')]).then(([t, c]) => {
      const doc = structuredClone(t.TUTORIALS.find((x) => x.meta.id === 'blinking-led').doc)
      doc.parts = []; doc.wires = []; delete doc.meta.sourceTutorialId
      c.circuit.open(doc)
    })`
  )
  await waitUntilStill(page, 30_000)
}

/** Drags the library's row for `name` to `to`, through the pointer as a hand would. */
async function drag(page: Page, name: string, to: { x: number; y: number }) {
  await page.getByLabel('Search parts').fill(name)
  const row = page
    .getByRole('complementary', { name: 'Part library' })
    .getByRole('button', { name })
  const box = (await row.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

const pins = (page: Page) =>
  page.evaluate(
    "import('/src/state/circuit.ts').then((m) => m.circuit.getSnapshot().parts.map((p) => [p.defId, p.placement.pins['1']]))"
  )

const board = (page: Page) =>
  page.evaluate(
    "import('/src/state/circuit.ts').then((m) => m.circuit.getSnapshot().boards[0].id)"
  ) as Promise<string>

test('an off-board module dropped over the breadboard rests on its top', async ({ page }) => {
  await emptyBench(page)
  const id = await board(page)
  // One on the table beside the board, one over its middle.
  const besideBoard = await hole(page, `${id}:45a`)
  await drag(page, 'Dual-axis analog joystick', { x: besideBoard.x, y: besideBoard.y + 140 })
  await drag(page, 'Dual-axis analog joystick', await hole(page, `${id}:40e`))
  await expect.poll(async () => Object.keys((await report(page)).parts).length).toBe(2)
  await expect.poll(async () => (await report(page)).parts.J2?.top != null).toBe(true)
  const { J1, J2 } = (await report(page)).parts
  const boardTop = await page.evaluate(
    "import('/src/core/defs/boards.ts').then((m) => m.boardDef('bb-830').body.heightMm)"
  )
  expect(J1!.top![2]).toBeGreaterThan(5)
  expect(J2!.top![2] - J1!.top![2]).toBeCloseTo(boardTop as number, 1)
})

test('the bar graph lands where it is dropped', async ({ page }) => {
  await emptyBench(page)
  const id = await board(page)
  await drag(page, '10-segment LED bar graph', await hole(page, `${id}:35e`))
  const parts = await page.evaluate(
    "import('/src/state/circuit.ts').then((m) => m.circuit.getSnapshot().parts.map((p) => [p.defId, p.placement.pins['1']]))"
  )
  expect(parts).toEqual([['bar-graph-10', { board: id, area: 'main', row: 35, col: 'e' }]])
})

test('the bar graph is drawn from any column and snaps across the trench', async ({ page }) => {
  await emptyBench(page)
  const id = await board(page)
  await page.getByLabel('Search parts').fill('10-segment LED bar graph')
  const row = page
    .getByRole('complementary', { name: 'Part library' })
    .getByRole('button', { name: '10-segment LED bar graph' })
  const box = (await row.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // Over column h, past the trench, it is drawn already: snapped to where it fits.
  const h = await hole(page, `${id}:35h`)
  await page.mouse.move(h.x, h.y, { steps: 12 })
  await expect.poll(async () => (await report(page)).parts.B1 != null).toBe(true)
  const b = await hole(page, `${id}:35b`)
  await page.mouse.move(b.x, b.y, { steps: 6 })
  await page.mouse.up()
  expect(await pins(page)).toEqual([
    ['bar-graph-10', { board: id, area: 'main', row: 35, col: 'e' }]
  ])
})

test('a part over another is drawn there in red and is not placed', async ({ page }) => {
  await emptyBench(page)
  const id = await board(page)
  await drag(page, '10-segment LED bar graph', await hole(page, `${id}:35e`))
  await page.getByLabel('Search parts').fill('10-segment LED bar graph')
  const row = page
    .getByRole('complementary', { name: 'Part library' })
    .getByRole('button', { name: '10-segment LED bar graph' })
  const box = (await row.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const over = await hole(page, `${id}:38g`)
  await page.mouse.move(over.x, over.y, { steps: 12 })
  await expect.poll(async () => (await report(page)).refused).toBe('B2')
  expect((await report(page)).parts.B2).toBeDefined()
  await page.mouse.up()
  await expect.poll(async () => (await report(page)).refused).toBeNull()
  expect(await pins(page)).toHaveLength(1)
  expect((await report(page)).parts.B2).toBeUndefined()
})

test('a board dragged into the Pi stops against it', async ({ page }) => {
  await emptyBench(page)
  const id = await board(page)
  const snapshot = (read: string) =>
    page.evaluate(
      `Promise.all([import('/src/state/circuit.ts'), import('/src/core/reach/reach.ts')]).then(([c, r]) => { const doc = c.circuit.getSnapshot(); return ${read} })`
    ) as Promise<number[]>
  const [x0] = await snapshot('doc.boards[0].transform.position')
  const [px, py] = await snapshot('doc.controller.pi.transform.position')
  const from = await hole(page, `${id}:55c`)
  await page.mouse.click(from.x, from.y)
  const to = (await page.evaluate(
    (q) => (window as unknown as StudioWindow).__studio.projectPoint(q),
    [px! + 42.5, py! + 28, 0] as const
  ))!
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 20 })
  await expect(page.getByRole('status')).toHaveText(`${id} can't overlap the Pi`)
  await page.mouse.up()
  await waitUntilStill(page, 10_000)
  // It went as far as the Pi's edge, and no further.
  const [x1] = await snapshot('doc.boards[0].transform.position')
  expect(x1).toBeLessThan(x0! - 20)
  expect(await snapshot('r.standingOverlaps(doc)')).toEqual([])
})

test('the side panels fold away for an immersive bench and come back', async ({ page }) => {
  await emptyBench(page)
  const library = page.getByRole('complementary', { name: 'Part library' })
  const properties = page
    .getByRole('heading', { name: 'Properties' })
    .or(page.getByText('Properties', { exact: true }))
  const canvas = page.locator('canvas').first()
  const width = async () => (await canvas.boundingBox())!.width
  const narrow = await width()
  // Each fold resizes the canvas once, as it starts: the picture eases into the room, not the
  // canvas a frame at a time.
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="studio"] canvas')!
    const w = window as unknown as { sizes: number[] }
    w.sizes = []
    new ResizeObserver(([e]) => w.sizes.push(Math.round(e!.contentRect.width))).observe(canvas)
  })

  await page.getByRole('button', { name: 'Hide the part library' }).click()
  await expect(library).toBeHidden()
  await page.getByRole('button', { name: 'Hide the properties' }).click()
  await expect(properties).toBeHidden()
  await expect.poll(width).toBeGreaterThan(narrow + 400)
  await waitUntilStill(page, 10_000)
  const sizes = await page.evaluate(() => (window as unknown as { sizes: number[] }).sizes)
  expect(sizes).toHaveLength(3)

  // `\` shows both again; `[` and `]` each fold one.
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('\\')
  await expect(library).toBeVisible()
  await expect(properties).toBeVisible()
  await page.keyboard.press('[')
  await expect(library).toBeHidden()
  await page.keyboard.press(']')
  await expect(properties).toBeHidden()
  await page.keyboard.press('\\')
  await expect(library).toBeVisible()
  await expect(properties).toBeVisible()
  await expect.poll(width).toBeCloseTo(narrow, 0)
})
