// At launch the app connects to the saved Pi and starts its agent when the Pi has this app's
// (ADR-0141); a first deploy or an update stays a click.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useConnectionStore from './connectionStore'

type Store = ReturnType<typeof useConnectionStore.getState> & {
  config: Record<string, unknown>
  agentNotice: string | null
  error: string | null
  connectOnLaunch: () => Promise<void>
  setConfig: (config: Record<string, unknown>) => void
  connect: () => Promise<boolean>
  disconnect: () => Promise<void>
  setStatus: (status: string) => void
}
const store = () => useConnectionStore.getState() as Store

/** A `window.api` with the saved settings, the connect result and the agent check given. */
function api(saved: Record<string, unknown>, connected: boolean, agent: Record<string, unknown>) {
  return {
    settings: {
      get: vi.fn(async (key: string) => saved[key.replace('connection.', '')] ?? null),
      set: vi.fn(async () => ({ success: true })),
      setPassword: vi.fn(async () => ({ success: true }))
    },
    ssh: {
      connect: vi.fn(async () =>
        connected ? { success: true } : { success: false, error: 'refused' }
      ),
      disconnect: vi.fn(async () => ({ success: true }))
    },
    agent: {
      check: vi.fn(async () => agent),
      start: vi.fn(async () => ({ success: true, authToken: 't' }))
    },
    gpio: {
      connect: vi.fn(async () => ({ success: true })),
      disconnect: vi.fn(async () => ({ success: true }))
    }
  }
}

/** A promise and the function that settles it, to hold a call open. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
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
    // Set from the command's answer: the status event may have had no listener yet.
    expect(store().status).toBe('connected')
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

  it('stands down when the user connects while the saved connection is read', async () => {
    const a = api(SAVED, true, { installed: true, current: true })
    // The saved connection arrives only after the user has connected to another Pi.
    const gate = deferred<void>()
    a.settings.get.mockImplementation(async (key: string) => {
      await gate.promise
      return (SAVED as Record<string, unknown>)[key.replace('connection.', '')] ?? null
    })
    vi.stubGlobal('window', { api: a })
    const launched = store().connectOnLaunch()
    store().setConfig({ host: 'pi-b', username: 'b' })
    await store().connect()
    gate.resolve()
    await launched
    expect(a.ssh.connect).toHaveBeenCalledOnce()
    expect(store().config.host).toBe('pi-b')
  })

  it('ends when the user presses Connect, before the form is saved', async () => {
    const a = api(SAVED, true, { installed: true, current: true })
    const gate = deferred<void>()
    a.settings.get.mockImplementation(async (key: string) => {
      await gate.promise
      return (SAVED as Record<string, unknown>)[key.replace('connection.', '')] ?? null
    })
    const saving = deferred<{ success: boolean }>()
    a.settings.set.mockImplementation(() => saving.promise)
    vi.stubGlobal('window', { api: a })
    const launched = store().connectOnLaunch()
    // The form already holds Pi B; setConfig would end the launch itself, so set it directly.
    useConnectionStore.setState({ config: { ...store().config, host: 'pi-b' } } as never)
    const pressed = store().connect()
    gate.resolve()
    await launched
    saving.resolve({ success: true })
    await pressed
    expect(a.ssh.connect).toHaveBeenCalledOnce()
    expect(a.ssh.connect).toHaveBeenCalledWith(expect.objectContaining({ host: 'pi-b' }))
  })

  it('leaves a status event newer than the connect reply alone', async () => {
    const a = api(SAVED, true, { installed: true, current: true })
    // The session comes up, then closes before the command returns: the backend says so.
    a.ssh.connect.mockImplementation(async () => {
      store().setStatus('connected')
      store().setStatus('connecting')
      return { success: true }
    })
    await launch(a)
    expect(store().status).toBe('connecting')
    expect(a.agent.check).not.toHaveBeenCalled()
  })

  it('drops an agent check that answers after the user reconnected', async () => {
    const check = deferred<Record<string, unknown>>()
    const a = api(SAVED, true, {})
    a.agent.check.mockImplementation(() => check.promise)
    vi.stubGlobal('window', { api: a, setTimeout })
    const launched = store().connectOnLaunch()
    await vi.waitFor(() => expect(a.agent.check).toHaveBeenCalled())
    await store().disconnect()
    store().setConfig({ host: 'pi-b' })
    await store().connect()
    check.resolve({ installed: false, current: false })
    await launched
    expect(a.agent.start).not.toHaveBeenCalled()
    expect(store().agentNotice).toBeNull()
    expect(store().status).toBe('connected')
  })

  it('stops at a failed connection, with its error', async () => {
    const a = api(SAVED, false, { installed: true, current: true })
    await launch(a)
    expect(a.agent.check).not.toHaveBeenCalled()
    expect(store().status).toBe('error')
    expect(store().error).toBe('refused')
  })
})
