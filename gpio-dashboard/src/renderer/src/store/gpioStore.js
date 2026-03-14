import { create } from 'zustand'

const useGpioStore = create((set, get) => ({
  pins: {},
  changedPins: new Set(),
  systemInfo: null,
  _clearTimeout: null,

  updatePinStates: (data) => {
    const prev = get().pins
    const changed = new Set()

    for (const [bcm, pinState] of Object.entries(data)) {
      const old = prev[bcm]
      if (!old || old.state !== pinState.state || old.direction !== pinState.direction) {
        changed.add(bcm)
      }
    }

    if (changed.size === 0 && Object.keys(data).length === Object.keys(prev).length) return

    const existing = get()._clearTimeout
    if (existing) clearTimeout(existing)

    const timeout = setTimeout(() => {
      set({ changedPins: new Set() })
    }, 200)

    set({ pins: data, changedPins: changed, _clearTimeout: timeout })
  },

  setSystemInfo: (info) => set({ systemInfo: info }),

  clearPins: () => set({ pins: {}, changedPins: new Set(), systemInfo: null })
}))

// Per-pin selector for optimized re-renders
export const usePinState = (bcm) => useGpioStore((s) => s.pins[bcm])
export const usePinChanged = (bcm) => useGpioStore((s) => s.changedPins.has(String(bcm)))

export default useGpioStore
