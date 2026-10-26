import { create } from 'zustand'

let _deployLock = false

const AGENT_STARTUP_DELAY_MS = 1500

/** The saved connection's fields, under `connection.` in the settings. */
const SAVED_FIELDS = ['host', 'port', 'username', 'password', 'authMethod', 'keyPath']

/** Why launch connected but left the agent alone (ADR-0141). */
const AGENT_MISSING = "The agent isn't on the Pi yet. Deploy & Start Agent puts it there."
const AGENT_OUTDATED =
  'The agent on the Pi is from another version of this app. Deploy & Start Agent updates it.'

/** The launch flow in progress (ADR-0141). Anything the user does to the connection ends it. */
let launch = null

/** How many status events the backend has sent; a connect reply defers to any newer one. */
let statusEvents = 0

/** The saved connection, without filling the form. */
async function readSaved() {
  try {
    const values = await Promise.all(
      SAVED_FIELDS.map((field) => window.api.settings.get(`connection.${field}`))
    )
    return Object.fromEntries(
      SAVED_FIELDS.map((field, i) => [field, values[i]]).filter(([, value]) => value)
    )
  } catch {
    return {}
  }
}

/**
 * Opens the SSH session; resolves true once it is up. The command returns only then, so the
 * status is set here when no status event has come since (at launch the event may arrive before
 * App listens for it); an event that did come is newer, and stands. `live` says whether whoever
 * asked still wants the answer.
 */
async function openSession(set, get, config, live = () => true) {
  set({ status: 'connecting', error: null })
  const events = statusEvents
  try {
    const result = await window.api.ssh.connect(config)
    if (!live()) return false
    if (result && !result.success) {
      set({ status: 'error', error: result.error || 'Connection failed' })
      return false
    }
    if (statusEvents === events) set({ status: 'connected' })
    return get().status === 'connected'
  } catch (err) {
    if (live()) set({ status: 'error', error: err.message || String(err) })
    return false
  }
}

/** Starts the agent, deploying and installing it first when `deploy` is set. */
async function runAgent(set, get, deploy) {
  if (_deployLock) return
  _deployLock = true
  set({ agentStatus: 'starting', error: null, agentNotice: null })
  try {
    if (deploy) {
      await window.api.agent.deploy()
      await window.api.agent.install()
    }
    const startResult = await window.api.agent.start()
    const authToken = startResult?.authToken || null
    await new Promise((r) => setTimeout(r, AGENT_STARTUP_DELAY_MS))
    await window.api.gpio.connect(get().config.host, authToken)
    set({ agentStatus: 'running' })
  } catch (err) {
    set({ agentStatus: 'error', error: err.message || String(err) })
  } finally {
    _deployLock = false
  }
}

const useConnectionStore = create((set, get) => ({
  config: {
    host: '',
    port: 22,
    username: 'pi',
    password: '',
    authMethod: 'key', // 'password' | 'key'
    keyPath: ''
  },
  status: 'disconnected', // disconnected | connecting | connected | error
  error: null,
  agentStatus: 'unknown', // unknown | stopped | starting | running | error
  /** Why the agent was not started at launch, or null. */
  agentNotice: null,

  /** The form's edits; the user taking the form over ends the launch flow. */
  setConfig: (config) => {
    launch = null
    set((state) => ({ config: { ...state.config, ...config } }))
  },
  setStatus: (status) => {
    statusEvents++
    set({ status })
  },
  setError: (error) => set({ error, status: 'error' }),
  clearError: () => set({ error: null }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),

  /** The Connect button: saves the form as the saved connection, then connects with it. */
  connect: async () => {
    launch = null
    const { config } = get()
    try {
      await Promise.all([
        window.api.settings.set('connection.host', config.host),
        window.api.settings.set('connection.port', config.port),
        window.api.settings.set('connection.username', config.username),
        window.api.settings.set('connection.authMethod', config.authMethod),
        window.api.settings.set('connection.keyPath', config.keyPath),
        window.api.settings.setPassword(config.password)
      ])
    } catch {
      // ignore save error
    }
    return openSession(set, get, get().config)
  },

  /**
   * At launch (ADR-0141): connects with the saved connection, if there is one, and starts the
   * agent when the Pi already has this app's. A first deploy or an update stays a click on the
   * Connect page, which says which one is needed. It stands down as soon as the user connects,
   * disconnects, or deploys, starts or stops the agent.
   */
  connectOnLaunch: async () => {
    const token = {}
    launch = token
    const live = () => launch === token
    const saved = await readSaved()
    if (!live() || !saved.host) return
    set((state) => ({ config: { ...state.config, ...saved } }))
    if (!(await openSession(set, get, get().config, live))) return
    const agent = await window.api.agent.check()
    if (!live()) return
    launch = null
    if (agent.success === false) set({ error: agent.error })
    else if (agent.current) await runAgent(set, get, false)
    else set({ agentNotice: agent.installed ? AGENT_OUTDATED : AGENT_MISSING })
  },

  disconnect: async () => {
    launch = null
    try {
      await window.api.gpio.disconnect()
    } catch {
      // ignore gpio disconnect errors
    }
    try {
      await window.api.ssh.disconnect()
    } finally {
      set({
        status: 'disconnected',
        agentStatus: 'unknown',
        agentNotice: null,
        config: { ...get().config, password: '' }
      })
    }
  },

  deployAgent: async () => {
    launch = null
    await runAgent(set, get, true)
  },

  startAgent: async () => {
    launch = null
    await runAgent(set, get, false)
  },

  stopAgent: async () => {
    launch = null
    try {
      await window.api.gpio.disconnect()
    } catch {
      // ignore
    }
    try {
      await window.api.agent.stop()
      set({ agentStatus: 'stopped' })
    } catch {
      // ignore
    }
  }
}))

export default useConnectionStore
