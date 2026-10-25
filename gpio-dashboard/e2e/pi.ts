// The Pi behind the native bridge, for the hardware-twin flows (SPEC 18): a mock that stands in for
// the Rust commands and the agent's telemetry, and an adapter for the real Pi that runs only when
// PI_HOST is set. Both give the page the same `window.api`, so one flow runs against either.
//
// The real adapter does what an automated run may do on the bench (SPEC 18): read telemetry
// (`pinctrl get`), scan the I2C bus (`i2cdetect`), and upload, run and stop a script that only
// prints. It never drives or probes a pin: it refuses a script that touches GPIO, and a cleanup
// that would set pins. It uses the `ssh` on the PATH (or PI_SSH) with key authentication, so the
// host must already be in known_hosts; PI_USER (default pi) and PI_KEY (a private key file) are
// optional. The mock records every native call, so the flows can check what the app asked for.
import { execFile, spawn } from 'node:child_process'
import type { Page } from '@playwright/test'

export interface Pin {
  bcm: number
  level?: 'HIGH' | 'LOW'
  direction?: 'IN' | 'OUT' | 'ALT' | 'NONE'
  pull?: 'UP' | 'DOWN' | 'NONE'
  /** The alternate function's name (a pin with direction ALT). */
  fn?: string
}

export interface I2cDevice {
  address: number
  claimed: boolean
}

export interface NativeCall {
  command: string
  args: unknown[]
}

/** The Pi as a flow sees it, mock or real. */
export interface PiLink {
  readonly kind: 'mock' | 'real'
  /** Marks the SSH session up and the agent running, as the connection pill and the agent would. */
  connect(): Promise<void>
  /** The native calls the app made, in order. */
  calls(): Promise<NativeCall[]>
}

export interface MockPi extends PiLink {
  kind: 'mock'
  /** Pushes a `gpio:state` frame holding these pins, as the agent's telemetry would. */
  pins(...pins: Pin[]): Promise<void>
  /** What the next `ssh_i2c_scan` finds, or an error message. */
  i2c(result: I2cDevice[] | string): Promise<void>
  /** Ends the script run in progress, as it exiting would. */
  finishRun(): Promise<void>
  /** Prints a line on the run's output, as the script's stdout would. */
  print(line: string): Promise<void>
}

/** The frame the agent sends for a pin: `PinTelemetry`, as `pi-agent/gpio_monitor.py` reports it. */
const telemetryOf = (p: Pin) => ({
  bcm: p.bcm,
  state: p.level ?? 'LOW',
  direction: p.direction ?? 'IN',
  pull: p.pull ?? 'NONE',
  function: p.direction === 'ALT' ? (p.fn ?? 'ALT0') : 'GPIO',
  info: ''
})
export const frameOf = (pins: Pin[]) =>
  Object.fromEntries(pins.map((p) => [String(p.bcm), telemetryOf(p)]))

interface PiWindow {
  __pi: {
    calls: NativeCall[]
    devices: I2cDevice[] | string
    release: (() => void) | null
    emit(event: string, payload: unknown): void
  }
  /** Set by the real adapter: runs a native command on the Pi, in Node. */
  __host?: (name: string, args: unknown[]) => Promise<unknown>
}

/** Runs in the page before the app: defines `window.api` and `window.__pi`. */
function installApi(forwarded: boolean) {
  const w = window as unknown as PiWindow & { api: unknown }
  const listeners: Record<string, ((payload: unknown) => void)[]> = {}
  const on = (event: string) => (callback: (payload: unknown) => void) => {
    ;(listeners[event] ??= []).push(callback)
    return () => {
      listeners[event] = (listeners[event] ?? []).filter((f) => f !== callback)
    }
  }
  const pi: PiWindow['__pi'] = {
    calls: [],
    devices: [],
    release: null,
    emit: (event, payload) => (listeners[event] ?? []).forEach((f) => f(payload))
  }
  w.__pi = pi
  const call = async <T>(command: string, args: unknown[], local: () => T | Promise<T>) => {
    pi.calls.push({ command, args })
    return forwarded ? ((await w.__host!(command, args)) as T) : local()
  }
  w.api = {
    ssh: {
      i2cScan: (bus: number) =>
        call('ssh_i2c_scan', [bus], () =>
          typeof pi.devices === 'string'
            ? { success: false, error: pi.devices }
            : { success: true, devices: pi.devices }
        ),
      scpBuffer: (content: string, remotePath: string) =>
        call('ssh_scp_buffer', [content, remotePath], () => ({ success: true })),
      runTutorialScript: (filename: string) =>
        call(
          'ssh_run_tutorial_script',
          [filename],
          () =>
            new Promise((resolve) => {
              pi.release = () => resolve({})
            })
        ),
      killProcess: (filename: string) =>
        call('ssh_kill_process', [filename], () => {
          pi.release?.()
          return {}
        }),
      gpioCleanup: (pins: number[]) => call('ssh_gpio_cleanup', [pins], () => ({})),
      onStatusChange: on('ssh:status-change'),
      onTutorialOutput: on('tutorial:output')
    },
    gpio: { onState: on('gpio:state'), onSystemInfo: on('gpio:system-info') },
    agent: { onStatus: on('agent:status'), onLog: on('agent:log') },
    sense: {
      pause: async () => ({ paused: true }),
      resume: async () => ({ success: true }),
      start: async () => ({ success: true }),
      stop: async () => ({ success: true }),
      onSweep: on('gpio:sense'),
      onEvent: on('gpio:sense-event')
    },
    settings: { get: async () => null, set: async () => ({ success: true }) },
    projects: { list: async () => ({ success: true, projects: [] }) },
    terminal: { create: async () => ({ success: true }), destroy: async () => ({}) }
  }
}

/** Sends a native event into the page, as the Rust side's `emit` would. */
const emitIn = (page: Page, event: string, payload: unknown) =>
  page.evaluate(
    ([e, p]) => (window as unknown as PiWindow).__pi.emit(e as string, p),
    [event, payload]
  )

async function connect(page: Page) {
  await page.evaluate(
    "import('/src/store/connectionStore.js').then((m) => m.default.setState({ status: 'connected', agentStatus: 'running' }))"
  )
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as PiWindow).__pi.calls) as Promise<NativeCall[]>

/** Installs the mock Pi: call before `page.goto`. */
export async function mockPi(page: Page): Promise<MockPi> {
  await page.addInitScript(installApi, false)
  return {
    kind: 'mock',
    connect: () => connect(page),
    calls: () => calls(page),
    pins: (...pins) => emitIn(page, 'gpio:state', frameOf(pins)),
    i2c: (result) =>
      page.evaluate((r) => void ((window as unknown as PiWindow).__pi.devices = r), result),
    finishRun: () => page.evaluate(() => (window as unknown as PiWindow).__pi.release?.()),
    print: (line) => emitIn(page, 'tutorial:output', { stream: 'stdout', data: `${line}\n` })
  }
}

// --- The real Pi (PI_HOST) ---

/** What the flows may run on a real Pi, and nothing else. */
const SCRIPT_FILE = /^project_[A-Za-z0-9_-]+\.py$/
const SCRIPT_PATH = /^\/tmp\/gpio_dashboard\/(project_[A-Za-z0-9_-]+\.py)$/
/** A script that reaches for a pin is not a print-only script. */
const TOUCHES_PINS = /GPIO|gpiozero|gpiod|lgpio|pinctrl|pigpio|spidev|smbus|i2c/i

export function parseI2cDetect(text: string): I2cDevice[] {
  const devices: I2cDevice[] = []
  for (const line of text.split('\n')) {
    const row = /^([0-7])0:(.*)$/.exec(line)
    if (!row) continue
    for (let col = 0; col < 16; col++) {
      const cell = row[2]!.slice(col * 3, col * 3 + 3).trim()
      if (cell && cell !== '--')
        devices.push({ address: Number(row[1]) * 16 + col, claimed: cell === 'UU' })
    }
  }
  return devices
}

/** `pinctrl get` as the Pi agent reads it (pi-agent/gpio_monitor.py): GPIO0 to GPIO27 only. */
export function parsePinctrl(text: string): Record<string, ReturnType<typeof telemetryOf>> {
  const out: Record<string, ReturnType<typeof telemetryOf>> = {}
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+):\s+(\S+)(?:\s+(?:dh|dl|--))?\s+(\S+)\s*\|\s*(\S+)\s*\/\/\s*(.*)$/.exec(
      line
    )
    if (!m) continue
    const bcm = Number(m[1])
    if (bcm > 27) continue
    const func = m[2]!
    const direction: NonNullable<Pin['direction']> =
      ({ ip: 'IN', op: 'OUT', no: 'NONE' } as Record<string, 'IN' | 'OUT' | 'NONE'>)[func] ?? 'ALT'
    const info = m[5]!.trim()
    out[String(bcm)] = {
      bcm,
      state: m[4] === 'hi' ? 'HIGH' : 'LOW',
      direction,
      pull: ({ pu: 'UP', pd: 'DOWN' } as const)[m[3] as 'pu'] ?? 'NONE',
      function:
        direction === 'ALT'
          ? info.includes('=')
            ? info.split('=')[1]!.trim()
            : func.toUpperCase()
          : 'GPIO',
      info
    }
  }
  return out
}

/** The ssh arguments for `host`, with the connection shared between commands. */
export function sshArgs(host: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const user = env.PI_USER ?? 'pi'
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=8',
    '-o',
    'ControlMaster=auto',
    '-o',
    `ControlPath=/tmp/gpio-hil-%C`,
    '-o',
    'ControlPersist=60',
    ...(env.PI_KEY ? ['-i', env.PI_KEY] : []),
    `${user}@${host}`
  ]
}

const POLL_MS = 250

/** Installs the real-Pi adapter: call before `page.goto`. The page's `window.api` forwards here. */
export async function realPi(page: Page, host: string): Promise<PiLink & { stop(): void }> {
  const ssh = process.env.PI_SSH ?? 'ssh'
  const base = sshArgs(host)
  const remote = (command: string, input?: string): Promise<{ code: number; out: string }> =>
    new Promise((resolve, reject) => {
      const child = execFile(
        ssh,
        [...base, command],
        { timeout: 20_000 },
        (err, stdout, stderr) => {
          if (err && typeof err.code !== 'number') reject(err)
          else resolve({ code: (err?.code as number | undefined) ?? 0, out: stdout + stderr })
        }
      )
      if (input !== undefined) child.stdin?.end(input)
    })
  let running: ReturnType<typeof spawn> | null = null
  const emit = (event: string, payload: unknown) => emitIn(page, event, payload)

  await page.exposeFunction('__host', async (name: string, args: unknown[]) => {
    switch (name) {
      case 'ssh_i2c_scan': {
        const bus = Number(args[0])
        if (!Number.isInteger(bus) || bus < 0 || bus > 31) throw new Error(`Invalid I2C bus ${bus}`)
        const { out } = await remote(`i2cdetect -y ${bus}`)
        const devices = parseI2cDetect(out)
        return /^00:/m.test(out)
          ? { success: true, devices }
          : { success: false, error: out.trim() || 'i2cdetect printed nothing' }
      }
      case 'ssh_scp_buffer': {
        const [content, path] = [String(args[0]), String(args[1])]
        const file = SCRIPT_PATH.exec(path)?.[1]
        if (!file) throw new Error(`The real-Pi flows upload only project scripts: ${path}`)
        if (TOUCHES_PINS.test(content)) throw new Error('The real-Pi flows run print-only scripts')
        const { code, out } = await remote(
          `mkdir -p /tmp/gpio_dashboard && cat > /tmp/gpio_dashboard/${file}`,
          content
        )
        return code === 0 ? { success: true } : { success: false, error: out }
      }
      case 'ssh_run_tutorial_script': {
        const file = String(args[0])
        if (!SCRIPT_FILE.test(file)) throw new Error(`Not a project script: ${file}`)
        await new Promise<void>((resolve) => {
          running = spawn(ssh, [...base, `python3 -u /tmp/gpio_dashboard/${file}`])
          running.stdout?.on(
            'data',
            (d: Buffer) => void emit('tutorial:output', { stream: 'stdout', data: d.toString() })
          )
          running.stderr?.on(
            'data',
            (d: Buffer) => void emit('tutorial:output', { stream: 'stderr', data: d.toString() })
          )
          running.on('close', () => resolve())
        })
        return {}
      }
      case 'ssh_kill_process': {
        const file = String(args[0])
        if (!SCRIPT_FILE.test(file)) throw new Error(`Not a project script: ${file}`)
        await remote(`pkill -f /tmp/gpio_dashboard/${file}`)
        running?.kill()
        return {}
      }
      case 'ssh_gpio_cleanup':
        // Cleanup sets pins (pinctrl set … ip pn); a print-only script has none to return.
        if ((args[0] as number[]).length) throw new Error('The real-Pi flows never set a pin')
        return {}
      default:
        throw new Error(`The real-Pi adapter does not run ${name}`)
    }
  })
  await page.addInitScript(installApi, true)

  // Telemetry: the same read-only pinctrl read the agent runs, resent on every poll as the agent
  // does (the page's telemetry store drops a frame that changes nothing).
  let stopped = false
  const poll = async () => {
    while (!stopped) {
      try {
        const frame = parsePinctrl((await remote('pinctrl get')).out)
        if (Object.keys(frame).length) await emit('gpio:state', frame)
      } catch {
        /* the page is not loaded yet, or the Pi did not answer: the next poll tries again */
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
  }
  void poll()
  return {
    kind: 'real',
    connect: () => connect(page),
    calls: () => calls(page),
    stop: () => {
      stopped = true
      running?.kill()
    }
  }
}
