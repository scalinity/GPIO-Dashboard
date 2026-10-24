// The Studio's sim-driven visuals in Chromium (SPEC 11.5; acceptance 8): the Blinking LED glows with
// current dashes running from 3V3 toward GPIO17 and 3.3 V on the 3V3 net, the Button's plunger follows
// a press in 3D and GPIO18's reading with it, the pin menu drives a GPIO by hand, and the Board Sense
// overlay tints nets against the simulated board.
import { expect, test } from '@playwright/test'
import {
  hole,
  motion,
  openTutorial,
  reads,
  report,
  showStudio,
  type StudioWindow,
  waitUntilStill
} from './helpers'

test.describe('the Blinking LED tutorial', () => {
  test.beforeEach(async ({ page }) => openTutorial(page, 'blinking-led'))

  test('glows while GPIO17 is low, with current dashes running from 3V3 toward GPIO17', async ({
    page
  }) => {
    await page.getByLabel('Voltages').check()
    await page.getByLabel('Current flow').check()
    await page.getByRole('button', { name: 'Simulate' }).click()

    // The program drives GPIO17 low for half a second out of each second: the LED lights, and the
    // dashes run from the 3V3 strip (end a of W1) to the resistor, and from the LED (end a of W2)
    // to GPIO17.
    await expect
      .poll(async () => {
        const r = (await report(page)).sim
        return r.lit.D1?.includes('lens') && r.flow.W1!.mmPerS > 0 && r.flow.W2!.mmPerS > 0
      })
      .toBe(true)

    // The 3V3 net reads 3.3 V.
    await expect.poll(async () => (await report(page)).sim.tags).toContain('3V3 3.30 V')

    // While the dashes run the scene renders continuously; the frame rate is recorded.
    const rate = await page.evaluate(async () => {
      const s = (window as unknown as StudioWindow).__studio
      const [f0, t0] = [s.loop.frames, performance.now()]
      await new Promise((r) => setTimeout(r, 2000))
      return ((s.loop.frames - f0) * 1000) / (performance.now() - t0)
    })
    console.log(`frames per second while the dashes run: ${rate.toFixed(1)}`)
    expect(rate).toBeGreaterThan(20)

    // Stopping ends the program: the LED goes dark, the dashes stop, and the scene settles.
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect
      .poll(async () => {
        const r = (await report(page)).sim
        return [r.lit.D1?.length ?? 0, Math.abs(r.flow.W1?.mmPerS ?? 0)]
      })
      .toEqual([0, 0])
    await waitUntilStill(page, 5000)
  })

  test('a GPIO17 pin menu on the T-board lights the LED while no program runs', async ({
    page
  }) => {
    const key = (await page.evaluate(
      "Promise.all([import('/src/core/geometry/tboard.ts'), import('/src/core/geometry/breadboard.ts'), import('/src/state/circuit.ts')]).then(([t, b, c]) => b.holeKey(t.tboardPinHole(c.circuit.getSnapshot().controller.tboard, 11)))"
    )) as string
    const at = await hole(page, key)
    await page.mouse.click(at.x, at.y, { button: 'right' })
    const menu = page.getByRole('menu', { name: 'GPIO17' })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitemradio', { name: 'Output LOW' }).click()
    await expect(menu).toBeHidden()
    // The LED sits between 3V3 and the pin: LOW lights it, HIGH puts it out.
    await expect.poll(async () => (await report(page)).sim.lit.D1).toContain('lens')
    await page.mouse.click(at.x, at.y, { button: 'right' })
    await menu.getByRole('menuitemradio', { name: 'Output HIGH' }).click()
    await expect.poll(async () => (await report(page)).sim.lit.D1).toEqual([])
    await waitUntilStill(page, 5000)
  })

  test('the Board Sense overlay tints each net by its state against the simulated board', async ({
    page
  }) => {
    await page.getByRole('tab', { name: 'Board' }).click()
    // Nothing is tinted before Board Sense runs, and the overlay never starts it.
    expect((await report(page)).sim.tints).toBe(0)
    await page.getByRole('button', { name: 'Use the simulated board' }).click()
    await expect.poll(async () => (await report(page)).sim.tints).toBeGreaterThan(0)

    // A lead one row off on the physical board: GPIO17's net diverges, and its tag lists the causes.
    await page.evaluate(
      "Promise.all([import('/src/state/senseStore.ts'), import('/src/state/workbenchStore.ts')]).then(([s, w]) => { const doc = structuredClone(w.useWorkbench.getState().doc); const w2 = doc.wires.find((x) => x.id === 'W2'); w2.b = { hole: { ...w2.b.hole, row: 7 } }; s.useSense.setState({ mockBoard: doc }) })"
    )
    const tags = async () => (await report(page)).sim.tags
    await expect
      .poll(async () => (await tags()).some((t) => t.includes('Board Sense: ')), {
        timeout: 20_000
      })
      .toBe(true)
    await expect
      .poll(async () => (await tags()).some((t) => /\n1\. /.test(t)), { timeout: 20_000 })
      .toBe(true)
    expect((await report(page)).sim.tints).toBeGreaterThan(0)

    // The Inspect toggle hides the tint without stopping Board Sense.
    await page.getByLabel('Board Sense').uncheck()
    await expect.poll(async () => (await report(page)).sim.tints).toBe(0)
    const mode = () =>
      page.evaluate("import('/src/state/senseStore.ts').then((m) => m.useSense.getState().mode)")
    expect(await mode()).toBe('mock')
    await page.getByLabel('Board Sense').check()
    await page.getByRole('button', { name: 'Stop sensing' }).click()
    await expect.poll(async () => (await report(page)).sim.tints).toBe(0)
    expect(await mode()).toBe('off')
  })
})

test.describe('the Button tutorial', () => {
  test.beforeEach(async ({ page }) => openTutorial(page, 'button'))

  test('pressing its switch in 3D moves the plunger and GPIO18 reads LOW until it is let go', async ({
    page
  }) => {
    await page.getByRole('button', { name: 'Simulate' }).click()
    // The program reads GPIO18 against R2's pull-up: HIGH while nothing presses the switch.
    await expect.poll(() => reads(page, 18)).toBe('high')
    // The drawer shrinks the canvas; holes are projected once the camera has caught up.
    await waitUntilStill(page, 5000)
    expect(await motion(page, 'SW1.plunger')).toBeCloseTo(0, 3)

    const at = await hole(page, 'bb1:38e')
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await expect.poll(() => reads(page, 18)).toBe('low')
    await expect.poll(() => motion(page, 'SW1.plunger')).toBeCloseTo(1, 2)
    // The program answers by lighting the LED on GPIO17.
    await expect.poll(async () => (await report(page)).sim.lit.D1).toContain('lens')

    await page.mouse.up()
    await expect.poll(() => reads(page, 18)).toBe('high')
    await expect.poll(() => motion(page, 'SW1.plunger')).toBeCloseTo(0, 2)
    await waitUntilStill(page, 5000)
  })
})

test.describe('the Nets list and warning halos', () => {
  test('the Nets list names the nets, and hovering a row highlights its strip and leads', async ({
    page
  }) => {
    await openTutorial(page, 'blinking-led')
    await page.getByLabel('Nets').check()
    const list = page.getByRole('list', { name: 'Nets' })
    await expect(list.getByRole('listitem')).toContainText(['3V3', 'GPIO17'])
    const markers = () =>
      page.evaluate(
        () =>
          ((window as unknown as StudioWindow).__studio.overlay.children[0] as { count?: number })
            .count
      )
    expect(await markers()).toBe(0)
    await list.getByRole('listitem').filter({ hasText: 'GPIO17' }).hover()
    // GPIO17's net runs over two strips (row 6, and the LED's row 35) and W2's two ends.
    await expect.poll(markers).toBe(5 + 5 + 2)
    await page.mouse.move(5, 5)
    await expect.poll(markers).toBe(0)
  })

  test('a part over its rating shows a halo, and its issue in Properties and the ERC tab', async ({
    page
  }) => {
    await page.goto('/')
    await showStudio(page)
    // An LED straight from 3V3 to GPIO17, with no resistor in series.
    await page.evaluate(`(async () => {
      const { circuit } = await import('/src/state/circuit.ts')
      const { newPart, newWire } = await import('/src/studio/placement.ts')
      const doc = circuit.getSnapshot()
      const led = newPart(doc, 'led', { anchor: { board: 'bb1', area: 'main', row: 30, col: 'c' }, rotation: 0 })
      const at = (row) => ({ hole: { board: 'bb1', area: 'main', row, col: 'a' } })
      const w1 = newWire(doc, at(1), at(30))
      const w2 = newWire({ ...doc, wires: [w1] }, at(31), at(6))
      const r = circuit.dispatch({ author: 'user', label: 'LED', ops: [{ type: 'AddPart', part: led }, { type: 'AddWire', wire: w1 }, { type: 'AddWire', wire: w2 }] })
      if (!r.ok) throw new Error(JSON.stringify(r.problems))
    })()`)
    await expect.poll(async () => (await report(page)).sim.halos).toEqual(['D1'])
    await expect.poll(async () => (await report(page)).sim.tags).toContain('D1: LED_NO_LIMIT')

    await page.evaluate(
      "import('/src/state/studioStore.ts').then((m) => m.useStudio.setState({ selection: { kind: 'part', id: 'D1' } }))"
    )
    await expect(page.getByRole('region', { name: 'Properties' })).toContainText('LED_NO_LIMIT')
    await page.getByRole('button', { name: 'Show in ERC' }).click()
    await expect(page.getByRole('tabpanel', { name: 'erc' })).toContainText('LED_NO_LIMIT')

    // Removing the part takes the halo away.
    await page.evaluate(
      "import('/src/state/circuit.ts').then((m) => m.circuit.dispatch({ author: 'user', label: 'x', ops: [{ type: 'RemovePart', id: 'D1' }] }))"
    )
    await expect.poll(async () => (await report(page)).sim.halos).toEqual([])
    await waitUntilStill(page, 10_000)
  })
})
