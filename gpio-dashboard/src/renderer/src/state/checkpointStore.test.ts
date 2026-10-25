// Hardware checkpoints (SPEC 14.4) against a mocked native layer: the I2C scan, the press watch
// and the LED toggle each run only when the card's button calls them, and report what the Pi
// showed. The document's simulation runs in-process here, in place of its worker.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TUTORIALS } from '../core/defs/tutorials'
import type { CircuitDoc } from '../core/model/types'
import type { SimRequest, SimResponse } from '../workers/simHost'
import type { Checkpoint } from './checkpoints'
import {
  checkpointKey,
  PRESS_TIMEOUT_MS,
  REST_HOLD_MS,
  toggleScript,
  useCheckpoints
} from './checkpointStore'
import { useBuild } from './buildStore'
import { circuit } from './circuit'
import { type LivePin, useLive } from './liveStore'
import { useProject } from './projectStore'
import { useRun } from './runStore'
import { useSense } from './senseStore'

vi.mock('./simClient', async () => {
  const { SimHost } = await import('../workers/simHost')
  const channel = () => {
    const host = new SimHost()
    return async (req: SimRequest): Promise<SimResponse> => host.handle(req)
  }
  return { simChannel: channel, simRequest: channel() }
})

const memory = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v)
})

type Of<K extends Checkpoint['kind']> = Extract<Checkpoint, { kind: K }>
const doc = (id: string) => TUTORIALS.find((t) => t.meta.id === id)!.doc
const pin = (bcm: number, over: Partial<LivePin> = {}): LivePin => ({
  bcm,
  level: 'low',
  direction: 'in',
  pull: 'none',
  function: null,
  consumer: null,
  ...over
})
const pins = (...p: LivePin[]) =>
  useLive.setState({ online: true, pins: Object.fromEntries(p.map((x) => [x.bcm, x])) })
const run = (key: string) => useCheckpoints.getState().runs[key]!

const calls: unknown[][] = []
let devices: { address: number; claimed: boolean }[] | string = []

beforeEach(() => {
  calls.length = 0
  devices = []
  useCheckpoints.getState().reset()
  useLive.setState({ online: false, pins: {}, sim: null, divergences: [] })
  useSense.setState({ mode: 'off' })
  useRun.setState({ status: 'idle', filename: null, output: [], blocked: null })
  useBuild.getState().stop()
  ;(globalThis as { window?: unknown }).window = {
    api: {
      ssh: {
        i2cScan: async (bus: number) => (
          calls.push(['i2c', bus]),
          typeof devices === 'string'
            ? { success: false, error: devices }
            : { success: true, devices }
        ),
        scpBuffer: async (...args: unknown[]) => (calls.push(['scp', ...args]), { success: true }),
        runTutorialScript: async (...args: unknown[]) => (calls.push(['run', ...args]), {}),
        killProcess: async (...args: unknown[]) => (calls.push(['kill', ...args]), {}),
        gpioCleanup: async (...args: unknown[]) => (calls.push(['cleanup', ...args]), {})
      },
      sense: {
        pause: async () => ({ paused: true }),
        resume: async () => ({ success: true })
      }
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the I2C scan', () => {
  const fan: Of<'i2c-scan'> = { kind: 'i2c-scan', afterStep: 'W4', addresses: [0x48] }

  it('does nothing until it is called, then scans the header’s bus', async () => {
    expect(calls).toEqual([])
    devices = [{ address: 0x48, claimed: false }]
    await useCheckpoints.getState().scan(fan)
    expect(calls).toEqual([['i2c', 1]])
    expect(run(checkpointKey(fan))).toMatchObject({ phase: 'passed' })
    expect(run(checkpointKey(fan)).message).toContain('0x48')
  })

  it('counts an address a kernel driver holds as the module answering', async () => {
    devices = [{ address: 0x48, claimed: true }]
    await useCheckpoints.getState().scan(fan)
    expect(run(checkpointKey(fan)).phase).toBe('passed')
  })

  it('accepts any of a module’s alternative addresses', async () => {
    const lcd: Of<'i2c-scan'> = { kind: 'i2c-scan', afterStep: 'W4', addresses: [0x27, 0x3f] }
    devices = [{ address: 0x3f, claimed: false }]
    await useCheckpoints.getState().scan(lcd)
    expect(run(checkpointKey(lcd)).phase).toBe('passed')
  })

  it('names what answered instead, and what to check, when the module does not', async () => {
    devices = [{ address: 0x3c, claimed: false }]
    await useCheckpoints.getState().scan(fan)
    const r = run(checkpointKey(fan))
    expect(r.phase).toBe('failed')
    expect(r.message).toContain('0x48')
    expect(r.message).toContain('0x3c')
    expect(r.causes.join(' ')).toMatch(/SDA to GPIO2/)
    expect(r.causes.join(' ')).toMatch(/raspi-config/)
  })

  it('says the bus is empty when nothing answers', async () => {
    await useCheckpoints.getState().scan(fan)
    expect(run(checkpointKey(fan)).message).toContain('the bus is empty')
  })

  it('reports why when the scan itself fails', async () => {
    devices = 'i2cdetect: command not found'
    await useCheckpoints.getState().scan(fan)
    expect(run(checkpointKey(fan))).toMatchObject({
      phase: 'error',
      message: 'i2cdetect: command not found'
    })
  })
})

describe('the press watch', () => {
  const press: Of<'press'> = { kind: 'press', afterStep: 'W5', part: 'SW1', gpio: 18 }
  const button = doc('button')
  const key = checkpointKey(press)
  /** Lets the watch's simulation finish. */
  const settle = async () => {
    for (let i = 0; i < 20 && run(key)?.phase === 'working'; i++)
      await new Promise((r) => setTimeout(r, 10))
  }

  it('needs the Pi’s telemetry', async () => {
    await useCheckpoints.getState().watchPress(press, button)
    expect(run(key)).toMatchObject({ phase: 'error' })
  })

  it('passes when the pin goes from its rest level to its pressed level', async () => {
    pins(pin(18, { level: 'high', pull: 'up' }))
    void useCheckpoints.getState().watchPress(press, button)
    await settle()
    expect(run(key).phase).toBe('waiting')
    expect(run(key).message).toContain('GPIO18 reads HIGH at rest. Press and hold SW1 now.')
    pins(pin(18, { level: 'low', pull: 'up' }))
    expect(run(key)).toMatchObject({ phase: 'passed' })
    expect(run(key).message).toBe('GPIO18 went HIGH to LOW when SW1 was pressed.')
  })

  it('reports a button that reads its pressed level at rest, with the orientation to check', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    pins(pin(18, { level: 'low', pull: 'up' }))
    void useCheckpoints.getState().watchPress(press, button)
    await vi.waitFor(() => expect(run(key).phase).toBe('waiting'))
    await vi.advanceTimersByTimeAsync(REST_HOLD_MS)
    expect(run(key).phase).toBe('failed')
    expect(run(key).message).toContain('GPIO18 reads LOW with SW1 released; it should read HIGH.')
    expect(run(key).causes[0]).toContain('pins 1–2 are always connected')
  })

  it('does not fail a button that is released in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    pins(pin(18, { level: 'low', pull: 'up' }))
    void useCheckpoints.getState().watchPress(press, button)
    await vi.waitFor(() => expect(run(key).phase).toBe('waiting'))
    await vi.advanceTimersByTimeAsync(REST_HOLD_MS - 100)
    pins(pin(18, { level: 'high', pull: 'up' }))
    await vi.advanceTimersByTimeAsync(REST_HOLD_MS)
    expect(run(key).phase).toBe('waiting')
    expect(run(key).message).toContain('Press and hold SW1 now')
  })

  it('gives up after its time, saying what to check', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    pins(pin(18, { level: 'high', pull: 'up' }))
    void useCheckpoints.getState().watchPress(press, button)
    await vi.waitFor(() => expect(run(key).phase).toBe('waiting'))
    await vi.advanceTimersByTimeAsync(PRESS_TIMEOUT_MS)
    expect(run(key).phase).toBe('failed')
    expect(run(key).message).toContain('No HIGH to LOW change on GPIO18')
  })

  it('stops reading when the step changes, and when it is cancelled', async () => {
    pins(pin(18, { level: 'high', pull: 'up' }))
    void useCheckpoints.getState().watchPress(press, button)
    await settle()
    useCheckpoints.getState().cancel(key)
    expect(run(key).phase).toBe('idle')
    pins(pin(18, { level: 'low', pull: 'up' }))
    expect(run(key).phase).toBe('idle')
  })

  it('refuses to read a pin that is an output', async () => {
    pins(pin(18, { direction: 'out', level: 'high' }))
    void useCheckpoints.getState().watchPress(press, button)
    await settle()
    expect(run(key)).toMatchObject({ phase: 'error' })
    expect(run(key).message).toContain('an output')
  })
})

describe('the LED toggle', () => {
  const toggle: Of<'toggle-led'> = { kind: 'toggle-led', afterStep: 'W2', part: 'D1', gpio: 17 }
  const blink = doc('blinking-led')
  const key = checkpointKey(toggle)

  it('writes a program that drives the level that lights the LED, and gives the pin back', () => {
    const low = toggleScript(17, false)
    expect(low).toContain('ON = GPIO.LOW')
    expect(low).toContain('OFF = GPIO.HIGH')
    expect(low).toContain('GPIO.setup(PIN, GPIO.OUT, initial=OFF)')
    expect(low).toContain('GPIO.cleanup(PIN)')
    expect(toggleScript(22, true)).toContain('ON = GPIO.HIGH')
  })

  it('runs nothing until the button is clicked', () => {
    expect(calls).toEqual([])
    expect(run(key)).toBeUndefined()
  })

  it('uploads the script through the Run on Pi path, then asks whether the LED lit', async () => {
    await useCheckpoints.getState().toggle(toggle, blink)
    await vi.waitFor(() => expect(run(key).phase).toBe('asking'))
    // The blinking LED sits between 3V3 and the pin: low lights it.
    expect(calls.map((c) => c[0])).toEqual(['scp', 'run'])
    expect(calls[0]![2]).toBe('/tmp/gpio_dashboard/project_checkpoint-D1-gpio17.py')
    expect(calls[0]![1]).toContain('ON = GPIO.LOW')
    expect(calls[1]).toEqual(['run', 'project_checkpoint-D1-gpio17.py'])
    expect(run(key).message).toContain('Did the LED light')
    useCheckpoints.getState().answer(toggle, blink, true)
    expect(run(key).phase).toBe('passed')
  })

  it('reports what the Pi showed while it ran', async () => {
    useLive.setState({ online: true, pins: { 17: pin(17) } })
    await useCheckpoints.getState().toggle(toggle, blink)
    useLive.setState({ pins: { 17: pin(17, { direction: 'out', level: 'low' }) } })
    useLive.setState({ pins: { 17: pin(17, { direction: 'out', level: 'high' }) } })
    await vi.waitFor(() => expect(run(key).phase).toBe('asking'))
    expect(run(key).message).toContain('The Pi drove GPIO17 high and low.')
  })

  it('names the likely causes when the LED did not light', async () => {
    await useCheckpoints.getState().toggle(toggle, blink)
    await vi.waitFor(() => expect(run(key).phase).toBe('asking'))
    useCheckpoints.getState().answer(toggle, blink, false)
    expect(run(key).phase).toBe('failed')
    expect(run(key).causes[0]).toContain('polarity')
    expect(run(key).causes[0]).toContain('row')
  })

  it('waits for the user’s decision when the circuit has ERC errors, and runs nothing meanwhile', async () => {
    const shorted: CircuitDoc = structuredClone(blink)
    shorted.wires.push({
      id: 'X1',
      a: { hole: { board: 'bb1', area: 'main', row: 1, col: 'b' } },
      b: { hole: { board: 'bb1', area: 'main', row: 5, col: 'b' } },
      color: 'red',
      kind: 'dupont-mm',
      lengthMm: 'auto'
    })
    await useCheckpoints.getState().toggle(toggle, shorted)
    await vi.waitFor(() => expect(run(key).phase).toBe('waiting'))
    expect(run(key).message).toContain('ERC errors')
    expect(calls).toEqual([])
    // Cancelling the dialog leaves nothing pending.
    useRun.getState().cancelBlocked()
    expect(run(key).phase).toBe('idle')
    expect(calls).toEqual([])
  })

  it('does not run on a pin that has an alternate function', async () => {
    useLive.setState({
      online: true,
      pins: { 17: pin(17, { direction: 'alt', function: 'SPI1_CE1' }) }
    })
    await useCheckpoints.getState().toggle(toggle, blink)
    expect(run(key).phase).toBe('error')
    expect(calls).toEqual([])
  })

  it('does not start while a program is running on the Pi', async () => {
    useRun.setState({ status: 'running' })
    await useCheckpoints.getState().toggle(toggle, blink)
    expect(run(key)).toMatchObject({
      phase: 'error',
      message: 'A program is already running on the Pi.'
    })
    expect(calls).toEqual([])
  })

  it('moving to another step drops a pending watch', async () => {
    const press: Of<'press'> = { kind: 'press', afterStep: 'W5', part: 'SW1', gpio: 18 }
    pins(pin(18, { level: 'high', pull: 'up' }))
    const pressKey = checkpointKey(press)
    void useCheckpoints.getState().watchPress(press, doc('button'))
    await vi.waitFor(() => expect(run(pressKey).phase).toBe('waiting'))
    useBuild.setState({ index: useBuild.getState().index + 1 })
    expect(run(pressKey).phase).toBe('idle')
  })
})

describe('a step with a checkpoint in Build Mode', () => {
  /** Opens a tutorial as a template, starts Build Mode, and goes to the step the checkpoint is on. */
  function buildAt(id: string, kind: Checkpoint['kind']) {
    circuit.open(doc(id))
    useProject.setState({ id: null })
    useBuild.getState().start()
    const { plan, steps } = useBuild.getState()
    const checkpoint = plan.find((c) => c.kind === kind)!
    const index = steps.findIndex((s) => s.refs.includes(checkpoint.afterStep))
    useBuild.getState().goTo(index)
    return { checkpoint, step: steps[index]! }
  }

  it('is ticked off, and left in hand, once its checkpoint passes', async () => {
    const { checkpoint, step } = buildAt('adjustable-fan', 'i2c-scan')
    expect(useBuild.getState().checkpoints).toEqual([checkpoint])
    devices = []
    await useCheckpoints.getState().scan(checkpoint as Of<'i2c-scan'>)
    // A scan that finds nothing confirms nothing.
    expect(useBuild.getState().done).not.toContain(step.key)
    devices = [{ address: 0x48, claimed: false }]
    await useCheckpoints.getState().scan(checkpoint as Of<'i2c-scan'>)
    const { done, checked, index, steps } = useBuild.getState()
    expect(done).toContain(step.key)
    expect(checked).toEqual([step.key])
    expect(steps[index]).toBe(step)
    useBuild.getState().restart()
    expect(useBuild.getState().checked).toEqual([])
  })

  it('needs every checkpoint on the step to pass', () => {
    const { step } = buildAt('rgb-led', 'toggle-led')
    const all = useBuild.getState().checkpoints as Of<'toggle-led'>[]
    // The RGB LED's three colours are three toggles on the same step.
    expect(all.map((c) => c.gpio)).toEqual([17, 18, 27])
    const saw = (c: Of<'toggle-led'>) =>
      useCheckpoints.getState().answer(c, circuit.getSnapshot(), true)
    saw(all[0]!)
    saw(all[1]!)
    expect(useBuild.getState().done).not.toContain(step.key)
    saw(all[2]!)
    expect(useBuild.getState().done).toContain(step.key)
    expect(useBuild.getState().checked).toEqual([step.key])
  })

  it('is not ticked off by a "no"', () => {
    const { step } = buildAt('blinking-led', 'toggle-led')
    const [c] = useBuild.getState().checkpoints as Of<'toggle-led'>[]
    useCheckpoints.getState().answer(c!, circuit.getSnapshot(), false)
    expect(useBuild.getState().done).not.toContain(step.key)
  })
})
