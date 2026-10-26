// At launch the app connects to the saved Pi and starts its agent when the Pi has this app's
// (ADR-0141); a first deploy or an update stays a click.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useConnectionStore from './connectionStore'

type Store = ReturnType<typeof useConnectionStore.getState> & {
  config: Record<string, unknown>
  agentNotice: string | null
  error: string | null
  connectOnLaunch: () => Promise<void>
}
const store = () => useConnectionStore.getState() as Store

/** A `window.api` with the saved settings, the connect result and the agent check given. */
function api(saved: Record<string, unknown>, connected: boolean, agent: Record<string, unknown>) {
  return {
    settings: { get: vi.fn(async (key: string) => saved[key.replace('connection.', '')] ?? null) },
    ssh: {
      connect: vi.fn(async () =>
        connected ? { success: true } : { success: false, error: 'refused' }
      )
    },
    agent: {
      check: vi.fn(async () => agent),
      start: vi.fn(async () => ({ success: true, authToken: 't' }))
    },
    gpio: { connect: vi.fn(async () => ({ success: true })) }
  }
}

const SAVED = { host: '158.205.34.18', username: 'danny', authMethod: 'key', keyPath: '/k' }
const initial = useConnectionStore.getState()

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  useConnectionStore.setState(initial, true)
})

async function launch(a: ReturnType<typeof api>) {
  vi.stubGlobal('window', { api: a })
  const done = store().connectOnLaunch()
  await vi.runAllTimersAsync()
  await done
}

describe('connectOnLaunch', () => {
  it('does nothing without a saved host', async () => {
    const a = api({}, true, { installed: true, current: true })
    await launch(a)
    expect(a.ssh.connect).not.toHaveBeenCalled()
    expect(a.agent.check).not.toHaveBeenCalled()
  })

  it('connects with the saved connection and starts an agent that is this app’s', async () => {
    const a = api(SAVED, true, { installed: true, current: true })
    await launch(a)
    expect(a.ssh.connect).toHaveBeenCalledWith(expect.objectContaining(SAVED))
    expect(a.agent.start).toHaveBeenCalledOnce()
    expect(a.gpio.connect).toHaveBeenCalledWith('158.205.34.18', 't')
    expect(store().agentStatus).toBe('running')
    expect(store().agentNotice).toBeNull()
  })

  it('leaves an agent from another version, or none, to a click and says why', async () => {
    const outdated = api(SAVED, true, { installed: true, current: false })
    await launch(outdated)
    expect(outdated.agent.start).not.toHaveBeenCalled()
    expect(store().agentNotice).toMatch(/another version.*Deploy & Start Agent updates it/)

    useConnectionStore.setState(initial, true)
    const missing = api(SAVED, true, { installed: false, current: false })
    await launch(missing)
    expect(missing.agent.start).not.toHaveBeenCalled()
    expect(store().agentNotice).toMatch(/isn't on the Pi yet/)
  })

  it('stops at a failed connection, with its error', async () => {
    const a = api(SAVED, false, { installed: true, current: true })
    await launch(a)
    expect(a.agent.check).not.toHaveBeenCalled()
    expect(store().status).toBe('error')
    expect(store().error).toBe('refused')
  })
})
