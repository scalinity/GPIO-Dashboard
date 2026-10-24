// The real-Pi adapter (e2e/pi.ts), proved without a Pi: a stand-in `ssh` answers with canned output
// and logs every command, so this checks what the adapter would run on the bench. It may run only
// what SPEC 18 lets an automated run do: read telemetry, scan I2C, and upload, run and stop a script
// that only prints. It must refuse anything that touches a pin.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { parseI2cDetect, parsePinctrl, realPi, sshArgs } from './pi'

const I2CDETECT = `     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
00:                         -- -- -- -- -- -- -- -- --
10: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
20: -- -- -- -- -- -- -- UU -- -- -- -- -- -- -- --
30: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
40: -- -- -- -- -- -- -- -- 48 -- -- -- -- -- -- --
50: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
60: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
70: -- -- -- -- -- -- -- --
`

const PINCTRL = ` 2: a3    pu | hi // GPIO2 = SDA1
17: op dh pd | hi // GPIO17 = output
18: ip    pu | lo // GPIO18 = input
28: ip    pn | lo // GPIO28 = input
`

test('reads the grid of i2cdetect, and pinctrl as the Pi agent does', () => {
  expect(parseI2cDetect(I2CDETECT)).toEqual([
    { address: 0x27, claimed: true },
    { address: 0x48, claimed: false }
  ])
  expect(parsePinctrl(PINCTRL)).toEqual({
    '2': {
      bcm: 2,
      state: 'HIGH',
      direction: 'ALT',
      pull: 'UP',
      function: 'SDA1',
      info: 'GPIO2 = SDA1'
    },
    '17': {
      bcm: 17,
      state: 'HIGH',
      direction: 'OUT',
      pull: 'DOWN',
      function: 'GPIO',
      info: 'GPIO17 = output'
    },
    '18': {
      bcm: 18,
      state: 'LOW',
      direction: 'IN',
      pull: 'UP',
      function: 'GPIO',
      info: 'GPIO18 = input'
    }
  })
})

test('connects by key, never asking a question, to the host it was given', () => {
  const args = sshArgs('raspberrypi.local', { PI_USER: 'daniel', PI_KEY: '/keys/id' })
  expect(args).toContain('BatchMode=yes')
  expect(args.slice(-1)).toEqual(['daniel@raspberrypi.local'])
  expect(args).toContain('/keys/id')
  expect(sshArgs('pi.local', {}).slice(-1)).toEqual(['pi@pi.local'])
})

test('runs only read-only commands and a print-only script, and refuses to touch a pin', async ({
  page
}) => {
  const dir = mkdtempSync(join(tmpdir(), 'hil-stub-'))
  const [stub, log] = [join(dir, 'ssh'), join(dir, 'log')]
  writeFileSync(
    stub,
    `#!/usr/bin/env node
const fs = require('node:fs')
const command = process.argv[process.argv.length - 1]
const reply = (text) => process.stdout.write(text)
const done = (extra = {}) => { fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ command, ...extra }) + '\\n'); process.exit(0) }
if (command.startsWith('mkdir')) {
  let stdin = ''
  process.stdin.on('data', (d) => (stdin += d)).on('end', () => done({ stdin }))
} else {
  if (command === 'pinctrl get') reply(${JSON.stringify(PINCTRL)})
  else if (command.startsWith('i2cdetect')) reply(${JSON.stringify(I2CDETECT)})
  else if (command.startsWith('python3')) reply('hello\\n')
  done()
}
`
  )
  chmodSync(stub, 0o755)
  const was = process.env.PI_SSH
  process.env.PI_SSH = stub
  const link = await realPi(page, 'pi.invalid')
  try {
    await page.goto('/')
    await link.connect()

    // Telemetry arrives as the agent would send it: GPIO0 to GPIO27 only.
    await expect
      .poll(() =>
        page.evaluate(
          "import('/src/store/gpioStore.js').then((m) => Object.keys(m.default.getState().pins).sort())"
        )
      )
      .toEqual(['17', '18', '2'])

    type Api = {
      api: {
        ssh: {
          i2cScan(bus: number): Promise<unknown>
          scpBuffer(content: string, path: string): Promise<unknown>
          runTutorialScript(file: string): Promise<unknown>
          killProcess(file: string): Promise<unknown>
          gpioCleanup(pins: number[]): Promise<unknown>
        }
      }
    }
    expect(await page.evaluate(() => (window as unknown as Api).api.ssh.i2cScan(1))).toEqual({
      success: true,
      devices: [
        { address: 0x27, claimed: true },
        { address: 0x48, claimed: false }
      ]
    })
    expect(
      await page.evaluate(() =>
        (window as unknown as Api).api.ssh.scpBuffer(
          'print("hi")\n',
          '/tmp/gpio_dashboard/project_Untitled.py'
        )
      )
    ).toEqual({ success: true })
    await page.evaluate(() =>
      (window as unknown as Api).api.ssh.runTutorialScript('project_Untitled.py')
    )
    await page.evaluate(() => (window as unknown as Api).api.ssh.killProcess('project_Untitled.py'))
    await page.evaluate(() => (window as unknown as Api).api.ssh.gpioCleanup([]))

    // Everything that could reach a pin is refused, before it reaches ssh.
    const refused = (run: (w: Api) => Promise<unknown>, why: RegExp) =>
      expect(page.evaluate(`(${run.toString()})(window)`)).rejects.toThrow(why)
    await refused(
      (w) =>
        w.api.ssh.scpBuffer('import RPi.GPIO as GPIO\n', '/tmp/gpio_dashboard/project_Untitled.py'),
      /print-only/
    )
    await refused(
      (w) => w.api.ssh.scpBuffer('print(1)', '/tmp/gpio_dashboard/../../etc/passwd'),
      /only project scripts/
    )
    await refused((w) => w.api.ssh.runTutorialScript('evil.py'), /Not a project script/)
    await refused((w) => w.api.ssh.killProcess('a b; rm -rf /'), /Not a project script/)
    await refused((w) => w.api.ssh.gpioCleanup([17]), /never set a pin/)
    await refused((w) => w.api.ssh.i2cScan(99), /Invalid I2C bus/)
  } finally {
    link.stop()
    if (was === undefined) delete process.env.PI_SSH
    else process.env.PI_SSH = was
  }

  const logged = readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { command: string; stdin?: string })
  const allowed = [
    /^pinctrl get$/,
    /^i2cdetect -y \d+$/,
    /^mkdir -p \/tmp\/gpio_dashboard && cat > \/tmp\/gpio_dashboard\/project_[\w-]+\.py$/,
    /^python3 -u \/tmp\/gpio_dashboard\/project_[\w-]+\.py$/,
    /^pkill -f \/tmp\/gpio_dashboard\/project_[\w-]+\.py$/
  ]
  for (const { command } of logged)
    expect(
      allowed.some((re) => re.test(command)),
      command
    ).toBe(true)
  const commands = logged.map((l) => l.command)
  expect(commands).toContain('i2cdetect -y 1')
  expect(commands.some((c) => c.startsWith('python3 -u'))).toBe(true)
  expect(commands.some((c) => c.startsWith('pkill'))).toBe(true)
  expect(logged.find((l) => l.stdin !== undefined)?.stdin).toBe('print("hi")\n')
})
