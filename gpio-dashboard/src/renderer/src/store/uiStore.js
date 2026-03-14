import { create } from 'zustand'

const useUiStore = create((set) => ({
  activeTab: 'connect',
  selectedPin: null,
  pinSearch: '',
  pinTypeFilters: new Set(),
  terminalOpen: false,
  terminalHeight: 250,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedPin: (pin) => set({ selectedPin: pin }),
  setPinSearch: (search) => set({ pinSearch: search }),

  togglePinTypeFilter: (type) =>
    set((state) => {
      const next = new Set(state.pinTypeFilters)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return { pinTypeFilters: next }
    }),

  clearPinTypeFilters: () => set({ pinTypeFilters: new Set() }),

  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
  setTerminalOpen: (open) => set({ terminalOpen: open }),
  setTerminalHeight: (height) => set({ terminalHeight: height })
}))

export default useUiStore
