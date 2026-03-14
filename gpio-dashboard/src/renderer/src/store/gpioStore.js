import { create } from 'zustand'

const CHANGE_HIGHLIGHT_DURATION_MS = 200

let _changedPinsClearTimer = null
let _prevPinCount = 0

const useGpioStore = create((set, get) => ({
  pins: {},
  changedPins: new Set(),
  systemInfo: null,
  lastUpdatedAt: null,

  updatePinStates: (data) => {
    const prev = get().pins
    const changed = new Set()

    const dataEntries = Object.entries(data)
    const normalized = {}
    for (let i = 0; i < dataEntries.length; i++) {
      const [bcm, pinState] = dataEntries[i]
      const state = String(pinState.state).toUpperCase() === 'HIGH' || pinState.state === 1 || pinState.state === '1' ? 'HIGH' : 'LOW'
      const direction = String(pinState.direction).toUpperCase()
      normalized[bcm] = { bcm: pinState.bcm, state, direction, pull: pinState.pull, function: pinState.function, info: pinState.info, consumer: pinState.consumer, name: pinState.name, used: pinState.used }
      const old = prev[bcm]
      if (!old || old.state !== state || old.direction !== direction) {
        changed.add(bcm)
      }
    }

    if (changed.size === 0 && dataEntries.length === _prevPinCount) return
    _prevPinCount = dataEntries.length

    if (_changedPinsClearTimer) clearTimeout(_changedPinsClearTimer)

    _changedPinsClearTimer = setTimeout(() => {
      set({ changedPins: new Set() })
    }, CHANGE_HIGHLIGHT_DURATION_MS)

    set({ pins: normalized, changedPins: changed, lastUpdatedAt: Date.now() })
  },

  setSystemInfo: (info) => set({ systemInfo: info }),

  clearPins: () => set({ pins: {}, changedPins: new Set(), systemInfo: null })
}))

// Per-pin selector for optimized re-renders
export const usePinState = (bcm) => useGpioStore((s) => s.pins[bcm])
export const usePinChanged = (bcm) => useGpioStore((s) => s.changedPins.has(String(bcm)))

export default useGpioStore
