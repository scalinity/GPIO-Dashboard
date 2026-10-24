// Hardware in the loop (SPEC 18): telemetry reaching the twin (the tunnel, D18), the I2C scan, and the
// run and stop of a script that only prints (D17). Each runs against the mock Pi always. Against the
// real Pi (PI_HOST set; PI_USER and PI_KEY optional, see e2e/pi.ts) an automated run may only do what
// neither drives nor probes a pin, so it reads telemetry and runs the print-only script; the I2C scan
// clocks probes out on SDA and SCL, so on the real Pi it is a hand check on docs/v2/HIL_CHECKLIST.md,
// with everything else that drives a pin, presses a button or senses the board.
import { expect, type Page, test } from '@playwright/test'
import { openTutorial, report } from './helpers'
import { type MockPi, mockPi, type PiLink, realPi } from './pi'

const PI_HOST = process.env.PI_HOST
const SKIPPED = `PI_HOST is not set, so this flow does not run against a real Pi. The same flow runs against the mock Pi above; set PI_HOST (and PI_USER, PI_KEY if needed) to run it on the bench.`

/** A program that only prints: it touches no pin, so a run of it may be automated. */
const PRINT_ONLY = `import time

n = 0
while True:
    n += 1
    print(f"hello {n}", flush=True)
    time.sleep(0.5)
`

type Flow = (page: Page, pi: PiLink, mock: MockPi | null) => Promise<void>

/** The flows, each written once and run on either Pi. */
const FLOWS: Record<string, Flow> = {
  'the Pi’s telemetry reaches the twin, and reading it acts on nothing': async (page, pi, mock) => {
    await openTutorial(page, 'blinking-led')
    await pi.connect()
    await page.getByLabel('Live Pi state').check()
    await mock?.pins(
      { bcm: 17, direction: 'IN', level: 'LOW', pull: 'DOWN' },
      { bcm: 18, direction: 'IN', level: 'LOW', pull: 'DOWN' }
    )
    await expect
      .poll(async () => Object.keys((await report(page)).live.header).length, { timeout: 30_000 })
      .toBeGreaterThan(0)
    expect((await report(page)).live.strips).toBeGreaterThan(0)
    // Telemetry is read through the tunnel; the app asked for no command.
    expect(await pi.calls()).toEqual([])
  },

  'the I2C checkpoint scans the header’s bus on a click and reports what it found': async (
    page,
    pi,
    mock
  ) => {
    await openTutorial(page, 'adjustable-fan')
    await pi.connect()
    await mock?.i2c([{ address: 0x48, claimed: false }])
    await page.getByRole('button', { name: 'Build', exact: true }).click()
    await page.evaluate(
      `import('/src/state/buildStore.ts').then((m) => { const b = m.useBuild.getState(); const ref = b.plan.find((c) => c.kind === 'i2c-scan').afterStep; b.goTo(b.steps.findIndex((s) => s.refs.includes(ref))) })`
    )
    const scan = page.getByRole('region', { name: 'Checkpoint: I2C scan' })
    expect(await pi.calls()).toEqual([])
    await scan.getByRole('button', { name: 'Scan the I2C bus' }).click()
    // On the bench the module may or may not be there: any answer is a result.
    await expect(scan.getByRole('status')).toContainText(
      mock ? 'Found a device at 0x48' : /Found a device|Nothing answered|i2cdetect|I2C/,
      { timeout: 30_000 }
    )
    expect((await pi.calls()).map((c) => [c.command, c.args])).toEqual([['ssh_i2c_scan', [1]]])
  },

  'a program that only prints runs, streams its output, and stops on Stop': async (
    page,
    pi,
    mock
  ) => {
    await page.goto('/')
    await pi.connect()
    await page.getByRole('tab', { name: 'Studio' }).click()
    await page.evaluate(
      `import('/src/state/workbenchStore.ts').then((m) => m.useWorkbench.getState().setCode(${JSON.stringify(PRINT_ONLY)}))`
    )
    await page.getByRole('button', { name: 'Run on Pi' }).click()
    const run = (name: string) =>
      page.evaluate(
        `import('/src/state/runStore.ts').then((m) => { const s = m.useRun.getState(); return ${name} })`
      )
    await expect.poll(() => run('s.status'), { timeout: 30_000 }).toBe('running')
    await mock?.print('hello 1')
    await expect
      .poll(
        async () => ((await run('s.output')) as { data: string }[]).map((l) => l.data).join(''),
        {
          timeout: 30_000
        }
      )
      .toContain('hello')
    await page.getByRole('button', { name: 'Stop on Pi' }).click()
    await expect.poll(() => run('s.status'), { timeout: 30_000 }).toBe('done')
    const commands = (await pi.calls()).map((c) => c.command)
    expect(commands).toEqual(['ssh_scp_buffer', 'ssh_run_tutorial_script', 'ssh_kill_process'])
    // Nothing set a pin: a print-only program has none to give back.
    expect(commands).not.toContain('ssh_gpio_cleanup')
  }
}

/** Drives the I2C bus, so it runs against the mock Pi only. */
const I2C_FLOW = Object.keys(FLOWS).find((name) => name.startsWith('the I2C checkpoint'))!

test.describe('against the mock Pi', () => {
  for (const [name, flow] of Object.entries(FLOWS))
    test(name, async ({ page }) => {
      const mock = await mockPi(page)
      await flow(page, mock, mock)
    })
})

test.describe('against the real Pi', () => {
  test.skip(!PI_HOST, SKIPPED)
  test.setTimeout(120_000)
  for (const [name, flow] of Object.entries(FLOWS).filter(([, f]) => f !== FLOWS[I2C_FLOW]))
    test(name, async ({ page }) => {
      const pi = await realPi(page, PI_HOST!)
      try {
        await flow(page, pi, null)
      } finally {
        pi.stop()
      }
    })
})

test('says whether the real-Pi flows ran', () => {
  console.log(
    PI_HOST
      ? `HIL: ran the flows against ${PI_HOST}.`
      : 'HIL: PI_HOST is not set, so the real-Pi flows were skipped; the same flows ran against the mock Pi. The rest is on docs/v2/HIL_CHECKLIST.md.'
  )
})
