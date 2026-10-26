// Placing from the library by dragging, as a user does, and the side panels around the bench: an
// off-board module dropped over the breadboard rests on its top (it sank into it), the bar graph
// lands where it is dropped, and the panels fold away for an immersive bench and come back.
import { expect, type Page, test } from '@playwright/test'
import { hole, report, showStudio, waitUntilStill } from './helpers'

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

test('the side panels fold away for an immersive bench and come back', async ({ page }) => {
  await emptyBench(page)
  const library = page.getByRole('complementary', { name: 'Part library' })
  const properties = page
    .getByRole('heading', { name: 'Properties' })
    .or(page.getByText('Properties', { exact: true }))
  const canvas = page.locator('canvas').first()
  const width = async () => (await canvas.boundingBox())!.width
  const narrow = await width()

  await page.getByRole('button', { name: 'Hide the part library' }).click()
  await expect(library).toHaveCount(0)
  await page.getByRole('button', { name: 'Hide the properties' }).click()
  await expect(properties).toHaveCount(0)
  await expect.poll(width).toBeGreaterThan(narrow + 400)

  // `\` shows both again; `[` and `]` each fold one.
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('\\')
  await expect(library).toHaveCount(1)
  await expect(properties).toHaveCount(1)
  await page.keyboard.press('[')
  await expect(library).toHaveCount(0)
  await page.keyboard.press(']')
  await expect(properties).toHaveCount(0)
  await page.keyboard.press('\\')
  await expect(library).toHaveCount(1)
  await expect(properties).toHaveCount(1)
})
