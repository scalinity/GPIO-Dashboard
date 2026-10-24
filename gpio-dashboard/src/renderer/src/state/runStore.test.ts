// Run on Pi is project-level and ERC-gated (SPEC 14.3; the run part of D14), against a mocked
// native layer.
import { beforeEach, describe, expect, it } from 'vitest'
import type { Issue } from '../core/erc/erc'
import { useRun } from './runStore'

const calls: unknown[][] = []
const error: Issue = {
  code: 'SHORT_SUPPLY',
  severity: 'error',
  refs: ['3V3'],
  message: 'm',
  fix: 'f'
}

beforeEach(() => {
  calls.length = 0
  useRun.setState({ status: 'idle', filename: null, output: [], blocked: null })
  ;(globalThis as { window?: unknown }).window = {
    api: {
      ssh: {
        scpBuffer: async (...args: unknown[]) => (calls.push(['scp', ...args]), { success: true }),
        runTutorialScript: async (...args: unknown[]) => (calls.push(['run', ...args]), {}),
        killProcess: async (...args: unknown[]) => (calls.push(['kill', ...args]), {})
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

  it('kills the remote process on Stop', async () => {
    await useRun.getState().run('p1', 'x', [])
    await useRun.getState().stop()
    expect(calls.at(-1)).toEqual(['kill', 'project_p1.py'])
  })

  it('refuses a project id that could escape the script directory', async () => {
    await useRun.getState().run('../etc', 'x', [])
    expect(calls).toEqual([])
    expect(useRun.getState().status).toBe('error')
  })
})
