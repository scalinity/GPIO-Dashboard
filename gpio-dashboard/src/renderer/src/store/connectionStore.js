import { create } from 'zustand'

let _deployLock = false

const AGENT_STARTUP_DELAY_MS = 1500

/** The saved connection's fields, under `connection.` in the settings. */
const SAVED_FIELDS = ['host', 'port', 'username', 'password', 'authMethod', 'keyPath']

/** Why launch connected but left the agent alone (ADR-0141). */
const AGENT_MISSING = "The agent isn't on the Pi yet. Deploy & Start Agent puts it there."
const AGENT_OUTDATED =
  'The agent on the Pi is from another version of this app. Deploy & Start Agent updates it.'

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

  setConfig: (config) => set((state) => ({ config: { ...state.config, ...config } })),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error, status: 'error' }),
  clearError: () => set({ error: null }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),

  /** Fills the form from the saved connection, and returns what was saved. */
  loadSaved: async () => {
    try {
      const values = await Promise.all(
        SAVED_FIELDS.map((field) => window.api.settings.get(`connection.${field}`))
      )
      const saved = Object.fromEntries(
        SAVED_FIELDS.map((field, i) => [field, values[i]]).filter(([, value]) => value)
      )
      if (Object.keys(saved).length > 0) get().setConfig(saved)
      return saved
    } catch {
      return {}
    }
  },

  /** Resolves true once the session is open. */
  connect: async () => {
    const state = useConnectionStore.getState()
    set({ status: 'connecting', error: null })
    try {
      const result = await window.api.ssh.connect(state.config)
      if (result && !result.success) {
        set({ status: 'error', error: result.error || 'Connection failed' })
        return false
      }
      // Status will be updated via IPC status-change event
      return true
    } catch (err) {
      set({ status: 'error', error: err.message || String(err) })
      return false
    }
  },

  /**
   * At launch (ADR-0141): connects with the saved connection, if there is one, and starts the
   * agent when the Pi already has this app's. A first deploy or an update stays a click on the
   * Connect page, which says which one is needed.
   */
  connectOnLaunch: async () => {
    const saved = await get().loadSaved()
    if (!saved.host || !(await get().connect())) return
    const agent = await window.api.agent.check()
    if (agent.success === false) set({ error: agent.error })
    else if (agent.current) await get().startAgent()
    else set({ agentNotice: agent.installed ? AGENT_OUTDATED : AGENT_MISSING })
  },

  disconnect: async () => {
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
    if (_deployLock) return
    _deployLock = true
    set({ agentStatus: 'starting', error: null, agentNotice: null })
    try {
      await window.api.agent.deploy()
      await window.api.agent.install()
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
  },

  startAgent: async () => {
    if (_deployLock) return
    _deployLock = true
    set({ agentStatus: 'starting', error: null, agentNotice: null })
    try {
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
  },

  stopAgent: async () => {
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
