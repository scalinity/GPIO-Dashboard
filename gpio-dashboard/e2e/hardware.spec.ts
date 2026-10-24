// The hardware twin (SPEC 11.5, 11.7, 14.4; M11) in Chromium against the mock Pi: the Pi's pins
// painted on the header and the T-board's strips, the bench lit by their levels, divergence badges
// from telemetry and from Board Sense, and the Build Mode checkpoints (I2C scan, press, LED
// toggle). Every native call is mocked and recorded; nothing here reaches a real Pi (see hil.spec.ts
// for the flows that can). A still scene must draw no frames, and only a click may start a run.
import { expect, type Page, test } from '@playwright/test'
import { hole, openTutorial, report, studio, waitUntilStill } from './helpers'
import { type MockPi, mockPi } from './pi'

// The legend's colours (studio/livepins.ts).
const OUT_HIGH = '#F97316'
const OUT_LOW = '#2563EB'
const IN_HIGH = '#FDE68A'
const IN_LOW = '#93C5FD'
const ALT = '#A78BFA'

const header = async (page: Page) => (await report(page)).live.header
const lit = async (page: Page, part: string) => (await report(page)).sim.lit[part] ?? []

/** Starts Build Mode on the open document and jumps to the step that holds `ref`. */
async function buildAt(page: Page, ref: string) {
  await page.getByRole('button', { name: 'Build', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Build Mode' })).toBeVisible()
  await page.evaluate(
    `import('/src/state/buildStore.ts').then((m) => { const b = m.useBuild.getState(); b.goTo(b.steps.findIndex((s) => s.refs.includes('${ref}'))) })`
  )
}

/** Starts Build Mode and jumps to the step the plan hangs the first `kind` checkpoint on. */
async function buildAtCheckpoint(page: Page, kind: string) {
  await page.getByRole('button', { name: 'Build', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Build Mode' })).toBeVisible()
  await page.evaluate(
    `import('/src/state/buildStore.ts').then((m) => { const b = m.useBuild.getState(); const ref = b.plan.find((c) => c.kind === '${kind}').afterStep; b.goTo(b.steps.findIndex((s) => s.refs.includes(ref))) })`
  )
}

const card = (page: Page, title: string) =>
  page.getByRole('region', { name: `Checkpoint: ${title}` })

test.describe('Live Pi state in 3D', () => {
  let pi: MockPi
  test.beforeEach(async ({ page }) => {
    pi = await mockPi(page)
    await openTutorial(page, 'blinking-led')
    await pi.connect()
  })

  test('paints nothing until the Inspect toggle is on, then the header pins and the T-board strips', async ({
    page
  }) => {
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'HIGH' })
    expect(await header(page)).toEqual({})
    await page.getByLabel('Live Pi state').check()
    await expect.poll(() => header(page)).toEqual({ 17: OUT_HIGH })
    // The five holes of GPIO17's T-board strip, beside the pin on the Pi's header.
    expect((await report(page)).live.strips).toBe(5)
    await page.getByLabel('Live Pi state').uncheck()
    await expect.poll(() => header(page)).toEqual({})
    expect((await report(page)).live.strips).toBe(0)
  })

  test('colours a pin by its level, direction and function, and follows a change', async ({
    page
  }) => {
    await page.getByLabel('Live Pi state').check()
    await pi.pins(
      { bcm: 17, direction: 'OUT', level: 'LOW' },
      { bcm: 18, direction: 'IN', level: 'HIGH', pull: 'UP' },
      { bcm: 22, direction: 'IN', level: 'LOW', pull: 'DOWN' },
      { bcm: 2, direction: 'ALT', level: 'HIGH', fn: 'SDA1' },
      { bcm: 5, direction: 'NONE' }
    )
    await expect.poll(() => header(page)).toEqual({ 17: OUT_LOW, 18: IN_HIGH, 22: IN_LOW, 2: ALT })
    // GPIO5 has no function, so it keeps the bare gold pin.
    await pi.pins(
      { bcm: 17, direction: 'OUT', level: 'HIGH' },
      { bcm: 18, direction: 'IN', level: 'HIGH', pull: 'UP' },
      { bcm: 22, direction: 'IN', level: 'LOW', pull: 'DOWN' },
      { bcm: 2, direction: 'ALT', level: 'HIGH', fn: 'SDA1' },
      { bcm: 5, direction: 'NONE' }
    )
    await expect.poll(async () => (await header(page))[17]).toBe(OUT_HIGH)
  })

  test('lists the pins that matter, with their function where pinctrl reports one', async ({
    page
  }) => {
    await page.getByLabel('Live Pi state').check()
    await pi.pins(
      { bcm: 17, direction: 'OUT', level: 'LOW' },
      { bcm: 2, direction: 'ALT', level: 'HIGH', fn: 'SDA1' },
      { bcm: 9, direction: 'IN', level: 'LOW', pull: 'DOWN' }
    )
    const rows = page.getByRole('list', { name: 'Live pins' }).getByRole('listitem')
    // In pin order; GPIO9 is an idle input with nothing wired to it, so it is left out.
    await expect(rows).toHaveText([/GPIO2\s*alternate SDA1, high/, /GPIO17\s*output, low/])
    await expect(page.getByRole('list', { name: 'Live key' }).getByRole('listitem')).toHaveCount(5)
  })

  test('lights the LED from the pin’s real level, not from Simulate', async ({ page }) => {
    await page.getByLabel('Live Pi state').check()
    // The Blinking LED sits between 3V3 and GPIO17: it lights while the pin is low.
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'HIGH' })
    await expect.poll(() => header(page)).toEqual({ 17: OUT_HIGH })
    await waitUntilStill(page, 10_000)
    expect(await lit(page, 'D1')).toEqual([])
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'LOW' })
    await expect.poll(() => lit(page, 'D1')).toContain('lens')
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'HIGH' })
    await expect.poll(() => lit(page, 'D1')).toEqual([])
    // Simulate's own state was never touched: no pin was set in the Workbench.
    expect(
      await page.evaluate(
        "import('/src/state/workbenchStore.ts').then((m) => Object.keys(m.useWorkbench.getState().gpio).length)"
      )
    ).toBe(0)
    // Back to Simulate's state when the toggle goes off.
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'LOW' })
    await expect.poll(() => lit(page, 'D1')).toContain('lens')
    await page.getByLabel('Live Pi state').uncheck()
    await expect.poll(() => lit(page, 'D1')).toEqual([])
  })

  test('draws no frame for telemetry that changes nothing, and settles after one that does', async ({
    page
  }) => {
    await page.getByLabel('Live Pi state').check()
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'HIGH' })
    await expect.poll(() => header(page)).toEqual({ 17: OUT_HIGH })
    const still = await waitUntilStill(page, 15_000)
    // The agent resends the whole state every poll; the Rust side drops repeats, and a repeat that
    // reaches the page changes nothing.
    for (let i = 0; i < 5; i++) await pi.pins({ bcm: 17, direction: 'OUT', level: 'HIGH' })
    await page.waitForTimeout(600)
    expect(await studio(page, (s) => s.loop.frames)).toBe(still)
    // A change draws, and the scene is still again afterwards.
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'LOW' })
    await expect.poll(() => studio(page, (s) => s.loop.frames)).toBeGreaterThan(still)
    await waitUntilStill(page, 15_000)
  })

  test('adds what the Pi reports to the hover text of a pin’s strip', async ({ page }) => {
    await page.getByLabel('Live Pi state').check()
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'LOW' })
    await expect.poll(() => header(page)).toEqual({ 17: OUT_LOW })
    await waitUntilStill(page, 15_000)
    const at = await hole(page, 'bb1:6a')
    await page.mouse.move(at.x, at.y)
    await expect(page.getByTestId('studio-tooltip')).toContainText('net GPIO17 · Pi: output, low')
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'HIGH' })
    await expect(page.getByTestId('studio-tooltip')).toContainText('Pi: output, high')
  })

  test('shows nothing when the Pi goes away', async ({ page }) => {
    await page.getByLabel('Live Pi state').check()
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'LOW' })
    await expect.poll(() => header(page)).toEqual({ 17: OUT_LOW })
    await page.evaluate(
      "import('/src/store/connectionStore.js').then((m) => m.default.setState({ status: 'disconnected', agentStatus: 'unknown' }))"
    )
    await expect.poll(() => header(page)).toEqual({})
    await expect(page.getByRole('status').filter({ hasText: 'No telemetry' })).toBeVisible()
  })
})

test.describe('divergence badges', () => {
  let pi: MockPi
  test.beforeEach(async ({ page }) => {
    pi = await mockPi(page)
    await openTutorial(page, 'button')
    await pi.connect()
    await page.getByLabel('Live Pi state').check()
  })

  const badges = async (page: Page) => (await report(page)).badges

  test('flags an output driven where the circuit reads a button, and explains it', async ({
    page
  }) => {
    await pi.pins({ bcm: 18, direction: 'OUT', level: 'HIGH' })
    // The contradiction must hold for a moment before it is news.
    await expect
      .poll(() => badges(page), { timeout: 5000 })
      .toEqual([{ id: 'live:drives-input:18', severity: 'error' }])
    const badge = page.getByRole('button', { name: 'GPIO18 is driven as an output' })
    await expect(badge).toBeVisible()
    // It stands over the canvas, outside the element the orbit controls listen on.
    await expect(page.getByTestId('studio').getByRole('button')).toHaveCount(0)
    const [b, canvas] = [
      (await badge.boundingBox())!,
      (await page.getByTestId('studio').boundingBox())!
    ]
    expect(b.x).toBeGreaterThan(canvas.x)
    expect(b.x).toBeLessThan(canvas.x + canvas.width)
    expect(b.y).toBeGreaterThan(canvas.y)
    expect(b.y).toBeLessThan(canvas.y + canvas.height)

    await badge.click()
    const explanation = page.getByRole('dialog', { name: 'GPIO18 is driven as an output' })
    await expect(explanation).toContainText('The Pi drives GPIO18 HIGH')
    await expect(explanation).toContainText('SW1')
    await expect(explanation).toContainText('stop the program')
    await explanation.getByRole('button', { name: 'Open the Board tab' }).click()
    await expect(page.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true')
    await expect(explanation).toBeHidden()
  })

  test('goes when the pin is back as the circuit has it, and never flashes for a passing change', async ({
    page
  }) => {
    await pi.pins({ bcm: 18, direction: 'OUT', level: 'HIGH' })
    await page.waitForTimeout(200)
    await pi.pins({ bcm: 18, direction: 'IN', level: 'HIGH', pull: 'UP' })
    await page.waitForTimeout(1000)
    expect(await badges(page)).toEqual([])
    await pi.pins({ bcm: 18, direction: 'OUT', level: 'HIGH' })
    await expect.poll(() => badges(page)).toHaveLength(1)
    await page.getByRole('button', { name: 'GPIO18 is driven as an output' }).click()
    const explanation = page.getByRole('dialog', { name: 'GPIO18 is driven as an output' })
    await expect(explanation).toBeVisible()
    await pi.pins({ bcm: 18, direction: 'IN', level: 'HIGH', pull: 'UP' })
    await expect.poll(() => badges(page)).toEqual([])
    // Its explanation goes with it, and does not come back by itself.
    await expect(explanation).toBeHidden()
    await pi.pins({ bcm: 18, direction: 'OUT', level: 'HIGH' })
    await expect.poll(() => badges(page)).toHaveLength(1)
    await expect(explanation).toBeHidden()
  })

  test('flags I2C that is off for a module wired to GPIO2 and GPIO3', async ({ page }) => {
    // Opening another tutorial reloads the page: connect and switch the toggle on again.
    await openTutorial(page, 'adjustable-fan')
    await pi.connect()
    await page.getByLabel('Live Pi state').check()
    await pi.pins(
      { bcm: 2, direction: 'IN', level: 'HIGH', pull: 'UP' },
      { bcm: 3, direction: 'IN', level: 'HIGH', pull: 'UP' }
    )
    await expect
      .poll(async () => (await badges(page)).map((b) => b.id).sort(), { timeout: 5000 })
      .toEqual(['live:wrong-function:2', 'live:wrong-function:3'])
    await pi.pins(
      { bcm: 2, direction: 'ALT', level: 'HIGH', fn: 'SDA1' },
      { bcm: 3, direction: 'ALT', level: 'HIGH', fn: 'SCL1' }
    )
    await expect.poll(() => badges(page)).toEqual([])
  })

  test('badges a net Board Sense found diverged, with its ranked causes', async ({ page }) => {
    test.setTimeout(120_000)
    await page.getByRole('tab', { name: 'Board' }).click()
    await page.getByRole('button', { name: 'Use the simulated board' }).click()
    // The simulated board has W3's 3V3 end on the ground row, as in the Build Mode divergence test.
    await page.evaluate(`Promise.all([import('/src/state/senseStore.ts'), import('/src/core/defs/tutorials.ts')]).then(([s, t]) => {
      const board = structuredClone(t.TUTORIALS.find((x) => x.meta.id === 'button').doc)
      board.wires.find((w) => w.id === 'W3').a = { hole: { board: 'bb1', area: 'main', row: 5, col: 'b' } }
      s.useSense.setState({ mockBoard: board })
    })`)
    const badge = page
      .getByRole('button', {
        name: /^GPIO\d+: (a path is missing|there is a path|it reads the wrong|two GPIOs are joined)/
      })
      .first()
    await expect(badge).toBeVisible({ timeout: 30_000 })
    expect((await badges(page)).some((b) => b.id.startsWith('sense:'))).toBe(true)
    await badge.click()
    const explanation = page.getByRole('dialog', {
      name: /^GPIO\d+: (a path|there is a path|it reads|two GPIOs)/
    })
    await expect(explanation).toContainText('GPIO')
    // Its candidate causes are ranked by a simulation, so they take a moment.
    await expect(explanation.getByRole('list', { name: 'Likely causes' })).toBeVisible({
      timeout: 60_000
    })
    await expect(explanation.getByRole('listitem').first()).toContainText(/row|lead|rail/)
  })
})

test.describe('Build Mode checkpoints', () => {
  let pi: MockPi
  test.beforeEach(async ({ page }) => {
    pi = await mockPi(page)
  })

  const callsOf = async (command: string) => (await pi.calls()).filter((c) => c.command === command)

  test('appear only on the step that completes what they check, and run nothing by themselves', async ({
    page
  }) => {
    await openTutorial(page, 'blinking-led')
    await pi.connect()
    await page.getByRole('button', { name: 'Build', exact: true }).click()
    const steps = (await page.evaluate(
      "import('/src/state/buildStore.ts').then((m) => m.useBuild.getState().steps.map((s) => s.refs[0]))"
    )) as string[]
    const last = steps.length - 1
    expect(steps[last]).toBe('W2')
    for (let i = 0; i <= last; i++) {
      await page.evaluate(
        `import('/src/state/buildStore.ts').then((m) => m.useBuild.getState().goTo(${i}))`
      )
      await expect(page.getByLabel('Build Mode')).toContainText(`Step ${i + 1} of`)
      await expect(card(page, 'Toggle the LED')).toHaveCount(i === last ? 1 : 0)
    }
    // Visiting every step ran nothing, and the card itself is outside the stage's element.
    expect(await pi.calls()).toEqual([])
    await expect(page.getByTestId('studio').getByRole('button')).toHaveCount(0)
  })

  test('toggle the LED: runs a generated program after the click, then asks what you saw', async ({
    page
  }) => {
    await openTutorial(page, 'blinking-led')
    await buildAt(page, 'W2')
    const toggle = card(page, 'Toggle the LED')
    // Not connected yet: the button waits.
    await expect(toggle.getByRole('button', { name: 'Toggle D1 on GPIO17' })).toBeDisabled()
    await expect(toggle).toContainText('Connect to the Pi first.')
    await pi.connect()
    await pi.pins({ bcm: 17, direction: 'IN', level: 'LOW', pull: 'DOWN' })
    expect(await callsOf('ssh_run_tutorial_script')).toEqual([])

    await toggle.getByRole('button', { name: 'Toggle D1 on GPIO17' }).click()
    await expect.poll(async () => (await callsOf('ssh_run_tutorial_script')).length).toBe(1)
    const [upload] = await callsOf('ssh_scp_buffer')
    const [script, path] = upload!.args as [string, string]
    expect(path).toBe('/tmp/gpio_dashboard/project_checkpoint-D1-gpio17.py')
    // The LED sits between 3V3 and the pin, so low lights it; the pin is handed back at the end.
    expect(script).toContain('PIN = 17')
    expect(script).toContain('ON = GPIO.LOW')
    expect(script).toContain('GPIO.cleanup(PIN)')
    expect((await callsOf('ssh_run_tutorial_script'))[0]!.args).toEqual([
      'project_checkpoint-D1-gpio17.py'
    ])
    await expect(toggle.getByRole('status')).toContainText('Running on the Pi')

    // The Pi's telemetry shows the pin going low and high while the program runs.
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'LOW' })
    await pi.pins({ bcm: 17, direction: 'OUT', level: 'HIGH' })
    await pi.finishRun()
    await expect(toggle.getByRole('status')).toContainText('The Pi drove GPIO17 high and low.')
    await expect(toggle.getByRole('status')).toContainText('Did the LED light')
    await toggle.getByRole('button', { name: 'Yes, it lit' }).click()
    await expect(toggle.getByRole('status')).toContainText('You saw D1 light on GPIO17.')
    // The LED path is not electrically verifiable; the checkpoint is what confirms the step.
    await expect(page.getByLabel('done, checked on the Pi')).toHaveCount(1)
    // Exactly one run, started by the one click.
    expect(await callsOf('ssh_run_tutorial_script')).toHaveLength(1)
  })

  test('toggle the LED: a "no" lists what to check', async ({ page }) => {
    await openTutorial(page, 'blinking-led')
    await pi.connect()
    await buildAt(page, 'W2')
    const toggle = card(page, 'Toggle the LED')
    await toggle.getByRole('button', { name: 'Toggle D1 on GPIO17' }).click()
    await expect.poll(async () => (await callsOf('ssh_run_tutorial_script')).length).toBe(1)
    await pi.finishRun()
    await toggle.getByRole('button', { name: 'No' }).click()
    await expect(toggle.getByRole('status')).toContainText('D1 did not light')
    await expect(toggle.getByRole('list', { name: 'What to check' })).toContainText('polarity')
  })

  test('toggle the LED: ERC errors hold the run until the override dialog is answered', async ({
    page
  }) => {
    await openTutorial(page, 'blinking-led')
    await pi.connect()
    // A lead from 3V3 to GND: SHORT_SUPPLY.
    await page.evaluate(`Promise.all([import('/src/state/workbenchStore.ts'), import('/src/core/defs/tutorials.ts')]).then(([w, t]) => {
      const doc = structuredClone(t.TUTORIALS.find((x) => x.meta.id === 'blinking-led').doc)
      doc.wires.push({ id: 'X1', a: { hole: { board: 'bb1', area: 'main', row: 1, col: 'b' } }, b: { hole: { board: 'bb1', area: 'main', row: 5, col: 'b' } }, color: 'red', kind: 'dupont-mm', lengthMm: 'auto' })
      return w.useWorkbench.getState().open('shorted', doc)
    })`)
    await buildAtCheckpoint(page, 'toggle-led')
    const toggle = card(page, 'Toggle the LED')
    await toggle.getByRole('button', { name: 'Toggle D1 on GPIO17' }).click()
    await expect(toggle.getByRole('status')).toContainText('ERC errors')
    await expect(page.getByRole('button', { name: 'Run anyway' })).toBeVisible()
    expect(await callsOf('ssh_scp_buffer')).toEqual([])
    await page.getByRole('button', { name: 'Run anyway' }).click()
    await expect.poll(async () => (await callsOf('ssh_run_tutorial_script')).length).toBe(1)
  })

  test('I2C scan: compares what answers with the module’s address', async ({ page }) => {
    await openTutorial(page, 'adjustable-fan')
    await buildAt(page, 'W4')
    const scan = card(page, 'I2C scan')
    await expect(scan).toContainText('0x48')
    await pi.connect()
    await pi.i2c([{ address: 0x48, claimed: false }])
    expect(await callsOf('ssh_i2c_scan')).toEqual([])
    await scan.getByRole('button', { name: 'Scan the I2C bus' }).click()
    await expect(scan.getByRole('status')).toContainText('Found a device at 0x48 on bus 1')
    await expect(page.getByLabel('done, checked on the Pi')).toHaveCount(1)
    expect(await callsOf('ssh_i2c_scan')).toEqual([{ command: 'ssh_i2c_scan', args: [1] }])

    await pi.i2c([{ address: 0x3c, claimed: false }])
    await scan.getByRole('button', { name: 'Scan the I2C bus again' }).click()
    await expect(scan.getByRole('status')).toContainText('Nothing answered at 0x48; 0x3c did')
    await expect(scan.getByRole('list', { name: 'What to check' })).toContainText('SDA to GPIO2')

    await pi.i2c('i2cdetect: command not found')
    await scan.getByRole('button', { name: 'Scan the I2C bus again' }).click()
    await expect(scan.getByRole('status')).toContainText('i2cdetect: command not found')
    expect(await callsOf('ssh_i2c_scan')).toHaveLength(3)
  })

  test('press the button: watches the pin go from rest to pressed', async ({ page }) => {
    await openTutorial(page, 'button')
    await buildAt(page, 'W5')
    const press = card(page, 'Press the button')
    await expect(press.getByRole('button', { name: 'Watch GPIO18' })).toBeDisabled()
    await pi.connect()
    await pi.pins({ bcm: 18, direction: 'IN', level: 'HIGH', pull: 'UP' })
    await press.getByRole('button', { name: 'Watch GPIO18' }).click()
    await expect(press.getByRole('status')).toContainText(
      'GPIO18 reads HIGH at rest. Press and hold SW1 now.'
    )
    // Only a read: no script, no scan.
    await pi.pins({ bcm: 18, direction: 'IN', level: 'LOW', pull: 'UP' })
    await expect(press.getByRole('status')).toContainText(
      'GPIO18 went HIGH to LOW when SW1 was pressed.'
    )
    expect((await pi.calls()).map((c) => c.command)).toEqual([])
  })

  test('press the button: a button that reads pressed at rest points at its orientation', async ({
    page
  }) => {
    await openTutorial(page, 'button')
    await buildAt(page, 'W5')
    await pi.connect()
    await pi.pins({ bcm: 18, direction: 'IN', level: 'LOW', pull: 'UP' })
    const press = card(page, 'Press the button')
    await press.getByRole('button', { name: 'Watch GPIO18' }).click()
    await expect(press.getByRole('status')).toContainText(
      'GPIO18 reads LOW with SW1 released; it should read HIGH.',
      { timeout: 10_000 }
    )
    await expect(press.getByRole('list', { name: 'What to check' })).toContainText(
      'pins 1–2 are always connected'
    )
  })

  test('press the button: Stop watching ends the watch', async ({ page }) => {
    await openTutorial(page, 'button')
    await buildAt(page, 'W5')
    await pi.connect()
    await pi.pins({ bcm: 18, direction: 'IN', level: 'HIGH', pull: 'UP' })
    const press = card(page, 'Press the button')
    await press.getByRole('button', { name: 'Watch GPIO18' }).click()
    await expect(press.getByRole('status')).toContainText('at rest')
    await press.getByRole('button', { name: 'Stop watching' }).click()
    await pi.pins({ bcm: 18, direction: 'IN', level: 'LOW', pull: 'UP' })
    await page.waitForTimeout(300)
    await expect(press.getByRole('status')).toHaveCount(0)
  })
})

test('everything clickable on the stage stays outside the orbit controls’ element', async ({
  page
}) => {
  const pi = await mockPi(page)
  await openTutorial(page, 'button')
  await pi.connect()
  await page.getByLabel('Live Pi state').check()
  await pi.pins({ bcm: 18, direction: 'OUT', level: 'HIGH' })
  await expect.poll(async () => (await report(page)).badges.length).toBe(1)
  const inside = await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="studio"]')!
    return [...document.querySelectorAll('[data-badge]')].filter((b) => stage.contains(b)).length
  })
  expect(inside).toBe(0)
})
