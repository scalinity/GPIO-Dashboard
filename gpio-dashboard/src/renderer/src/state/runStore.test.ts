// Run on Pi is project-level and ERC-gated (SPEC 14.3; the run part of D14), against a mocked
// native layer.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TUTORIALS } from '../core/defs/tutorials'
import type { Issue } from '../core/erc/erc'
import type { CircuitDoc } from '../core/model/types'
import { runOnPi, useRun } from './runStore'
import { useSense } from './senseStore'

const calls: unknown[][] = []
let pauseAck = true
/** While set, the upload or the Board Sense pause waits for it (a slow link, a slow agent). */
let uploadGate: Promise<void> | null
let runGate: Promise<void> | null = null
let pauseGate: Promise<void> | null
const error: Issue = {
  code: 'SHORT_SUPPLY',
  severity: 'error',
  refs: ['3V3'],
  message: 'm',
  fix: 'f'
}

beforeEach(() => {
  calls.length = 0
  pauseAck = true
  uploadGate = null
  runGate = null
  pauseGate = null
  useSense.setState({ mode: 'off' })
  useRun.setState({ status: 'idle', filename: null, pins: [], output: [], blocked: null })
  ;(globalThis as { window?: unknown }).window = {
    api: {
      ssh: {
        scpBuffer: async (...args: unknown[]) => {
          calls.push(['scp', ...args])
          await uploadGate
          return { success: true }
        },
        runTutorialScript: async (...args: unknown[]) => {
          calls.push(['run', ...args])
          await runGate
          return {}
        },
        killProcess: async (...args: unknown[]) => (calls.push(['kill', ...args]), {}),
        gpioCleanup: async (...args: unknown[]) => (calls.push(['cleanup', ...args]), {})
      },
      sense: {
        pause: async () => {
          calls.push(['sense_pause'])
          await pauseGate
          return { paused: pauseAck }
        },
        resume: async () => (calls.push(['sense_resume']), { success: true })
      }
    }
  }
})

describe('Run on Pi', () => {
  it('uploads a project to /tmp/gpio_dashboard/project_<id>.py and runs that file', async () => {
    await useRun.getState().run('my-blink_2', 'print(1)\n', [])
    expect(calls).toEqual([
      ['scp', 'print(1)\n', '/tmp/gpio_dashboard/project_my-blink_2.py'],
      ['run', 'project_my-blink_2.py']
    ])
    expect(useRun.getState().status).toBe('done')
  })

  it('is blocked by ERC errors until the user overrides them', async () => {
    await useRun.getState().run('p1', 'x', [error])
    expect(calls).toEqual([])
    expect(useRun.getState().blocked?.errors).toEqual([error])
    await useRun.getState().run('p1', 'x', [error], true)
    expect(calls.map((c) => c[0])).toEqual(['scp', 'run'])
    expect(useRun.getState().blocked).toBeNull()
  })

  it('kills the remote process on Stop, then returns the program pins to inputs', async () => {
    const code =
      'import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\nGPIO.setup([22, 27], GPIO.OUT)\n'
    await useRun.getState().run('p1', code, [])
    await useRun.getState().stop()
    expect(calls.slice(-2)).toEqual([
      ['kill', 'project_p1.py'],
      ['cleanup', [17, 22, 27]]
    ])
  })

  const program = 'import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.OUT)\n'

  it('does not start a program whose upload was still pending when Stop was pressed', async () => {
    let finishUpload!: () => void
    uploadGate = new Promise<void>((resolve) => (finishUpload = resolve))
    const running = useRun.getState().run('p1', program, [])
    await vi.waitUntil(() => calls.length === 1)
    await useRun.getState().stop()
    finishUpload()
    await running
    expect(calls.map((c) => c[0])).toEqual(['scp', 'kill', 'cleanup'])
    expect(useRun.getState().status).toBe('done')
  })

  it('does not upload or start a program when Stop was pressed during the Board Sense pause', async () => {
    useSense.setState({ mode: 'pi' })
    let finishPause!: () => void
    pauseGate = new Promise<void>((resolve) => (finishPause = resolve))
    const running = useRun.getState().run('p1', program, [])
    await vi.waitUntil(() => calls.length === 1)
    await useRun.getState().stop()
    finishPause()
    await running
    // Sensing was paused for this run, so it is resumed even though the run never started.
    expect(calls.map((c) => c[0])).toEqual(['sense_pause', 'cleanup', 'sense_resume'])
    expect(useRun.getState().status).toBe('done')
  })

  it('leaves resuming Board Sense to a newer run when a stopped one finishes its upload', async () => {
    useSense.setState({ mode: 'pi' })
    let finishUpload!: () => void
    uploadGate = new Promise<void>((resolve) => (finishUpload = resolve))
    const first = useRun.getState().run('p1', program, [])
    await vi.waitUntil(() => calls.some((c) => c[0] === 'scp'))
    await useRun.getState().stop()
    uploadGate = null
    let finishSecond!: () => void
    runGate = new Promise<void>((resolve) => (finishSecond = resolve))
    const second = useRun.getState().run('p2', 'x', [])
    await vi.waitUntil(() => calls.some((c) => c[0] === 'run'))
    finishUpload()
    await first
    // The second program is running: sensing stays paused for it.
    expect(calls.map((c) => c[0])).not.toContain('sense_resume')
    finishSecond()
    await second
    expect(calls.map((c) => c[0]).filter((c) => c === 'sense_resume')).toHaveLength(1)
  })

  it('resumes Board Sense after a stopped run when the run after it could not pause sensing', async () => {
    useSense.setState({ mode: 'pi' })
    let finishUpload!: () => void
    uploadGate = new Promise<void>((resolve) => (finishUpload = resolve))
    const first = useRun.getState().run('p1', program, [])
    await vi.waitUntil(() => calls.some((c) => c[0] === 'scp'))
    await useRun.getState().stop()
    uploadGate = null
    pauseAck = false
    await useRun.getState().run('p2', 'x', [])
    finishUpload()
    await first
    expect(calls.map((c) => c[0]).filter((c) => c === 'sense_resume')).toHaveLength(1)
  })

  it('still runs a program started after an earlier run was stopped', async () => {
    await useRun.getState().stop()
    await useRun.getState().run('p1', 'x', [])
    expect(calls.map((c) => c[0])).toEqual(['scp', 'run'])
    expect(useRun.getState().status).toBe('done')
  })

  it('refuses a project id that could escape the script directory', async () => {
    await useRun.getState().run('../etc', 'x', [])
    expect(calls).toEqual([])
    expect(useRun.getState().status).toBe('error')
  })

  it('with Board Sense on, pauses it first and resumes it after the run', async () => {
    useSense.setState({ mode: 'pi' })
    await useRun.getState().run('p1', 'x', [])
    expect(calls.map((c) => c[0])).toEqual(['sense_pause', 'scp', 'run', 'sense_resume'])
  })

  it('does not start a run when Board Sense does not confirm the pause', async () => {
    useSense.setState({ mode: 'pi' })
    pauseAck = false
    await useRun.getState().run('p1', 'x', [])
    expect(calls.map((c) => c[0])).toEqual(['sense_pause'])
    expect(useRun.getState().status).toBe('error')
  })
})

describe('Run on Pi checks the currents the program can drive', () => {
  // The cathode is on GPIO17 and the resistor on 3V3, so LOW is the loaded state.
  const blinkingLed = TUTORIALS.find((t) => t.meta.id === 'blinking-led')!.doc
  const withResistor = (ohms: number): CircuitDoc => ({
    ...blinkingLed,
    parts: blinkingLed.parts.map((p) =>
      p.id === 'R1' ? { ...p, props: { ...p.props, resistance: ohms } } : p
    )
  })

  it('blocks a 10 Ω LED on GPIO17 with the pin overcurrent, and starts nothing', async () => {
    const doc = withResistor(10)
    await runOnPi('blinking-led', doc, doc.code.source)
    expect(calls).toEqual([])
    const errors = useRun.getState().blocked?.errors ?? []
    expect(errors.map((e) => `${e.code}:${e.refs.join(',')}`)).toContain('PIN_OVERCURRENT:GPIO17')
  })

  it('runs the shipped 220 Ω Blinking LED', async () => {
    await runOnPi('blinking-led', blinkingLed, blinkingLed.code.source)
    expect(useRun.getState().blocked).toBeNull()
    expect(calls.map((c) => c[0])).toEqual(['scp', 'run'])
  })
})
