// Run on Pi is project-level and ERC-gated (SPEC 14.3; the run part of D14), against a mocked
// native layer.
import { beforeEach, describe, expect, it } from 'vitest'
import type { Issue } from '../core/erc/erc'
import { useRun } from './runStore'
import { useSense } from './senseStore'

const calls: unknown[][] = []
let pauseAck = true
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
  useSense.setState({ mode: 'off' })
  useRun.setState({ status: 'idle', filename: null, output: [], blocked: null })
  ;(globalThis as { window?: unknown }).window = {
    api: {
      ssh: {
        scpBuffer: async (...args: unknown[]) => (calls.push(['scp', ...args]), { success: true }),
        runTutorialScript: async (...args: unknown[]) => (calls.push(['run', ...args]), {}),
        killProcess: async (...args: unknown[]) => (calls.push(['kill', ...args]), {}),
        gpioCleanup: async (...args: unknown[]) => (calls.push(['cleanup', ...args]), {})
      },
      sense: {
        pause: async () => (calls.push(['sense_pause']), { paused: pauseAck }),
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
