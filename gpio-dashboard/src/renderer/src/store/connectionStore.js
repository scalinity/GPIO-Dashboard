import { create } from 'zustand'

const useConnectionStore = create((set) => ({
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
      await window.api.ssh.connect(state.config)
      set({ status: 'connected' })
    } catch (err) {
      set({ status: 'error', error: err.message || String(err) })
    }
  },

  disconnect: async () => {
    try {
      await window.api.ssh.disconnect()
    } finally {
      set({ status: 'disconnected', agentStatus: 'unknown' })
    }
  },

  deployAgent: async () => {
    set({ agentStatus: 'starting' })
    try {
      await window.api.agent.deploy()
      await window.api.agent.install()
      await window.api.agent.start()
      set({ agentStatus: 'running' })
    } catch (err) {
      set({ agentStatus: 'error', error: err.message || String(err) })
    }
  },

  startAgent: async () => {
    set({ agentStatus: 'starting' })
    try {
      await window.api.agent.start()
      set({ agentStatus: 'running' })
    } catch (err) {
      set({ agentStatus: 'error' })
    }
  },

  stopAgent: async () => {
    try {
      await window.api.agent.stop()
      set({ agentStatus: 'stopped' })
    } catch {
      // ignore
    }
  }
}))

export default useConnectionStore
