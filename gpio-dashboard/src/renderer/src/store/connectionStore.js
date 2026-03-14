import { create } from 'zustand'

let _deployLock = false

const AGENT_STARTUP_DELAY_MS = 1500

const useConnectionStore = create((set, get) => ({
  config: {
    host: '',
    port: 22,
    username: 'pi',
    password: ''
  },
  status: 'disconnected', // disconnected | connecting | connected | error
  error: null,
  agentStatus: 'unknown', // unknown | stopped | starting | running | error

  setConfig: (config) => set((state) => ({ config: { ...state.config, ...config } })),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error, status: 'error' }),
  clearError: () => set({ error: null }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),

  connect: async () => {
    const state = useConnectionStore.getState()
    set({ status: 'connecting', error: null })
    try {
      const result = await window.api.ssh.connect(state.config)
      if (result && !result.success) {
        set({ status: 'error', error: result.error || 'Connection failed' })
        return
      }
      // Status will be updated via IPC status-change event
    } catch (err) {
      set({ status: 'error', error: err.message || String(err) })
    }
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
      set({ status: 'disconnected', agentStatus: 'unknown', config: { ...get().config, password: '' } })
    }
  },

  deployAgent: async () => {
    if (_deployLock) return
    _deployLock = true
    set({ agentStatus: 'starting', error: null })
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
    set({ agentStatus: 'starting', error: null })
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
