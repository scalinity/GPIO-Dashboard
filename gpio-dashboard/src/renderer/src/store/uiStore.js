import { create } from 'zustand'

const useUiStore = create((set) => ({
  activeTab: 'connect',
  selectedPin: null,
  pinSearch: '',
  pinTypeFilters: [],
  terminalOpen: false,
  terminalHeight: 250,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedPin: (pin) => set({ selectedPin: pin }),
  setPinSearch: (search) => set({ pinSearch: search }),

  togglePinTypeFilter: (type) =>
    set((state) => {
      const filters = state.pinTypeFilters
      if (filters.includes(type)) {
        return { pinTypeFilters: filters.filter((t) => t !== type) }
      }
      return { pinTypeFilters: [...filters, type] }
    }),

  clearPinTypeFilters: () => set({ pinTypeFilters: [] }),

  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
  setTerminalOpen: (open) => set({ terminalOpen: open }),
  setTerminalHeight: (height) => set({ terminalHeight: height })
}))

export default useUiStore
