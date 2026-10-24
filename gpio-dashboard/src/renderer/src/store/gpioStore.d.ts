// Types for the JavaScript telemetry store, for TypeScript callers: only what they read. The pins
// are keyed by BCM number, as the Pi agent's `gpio_state` frames are (pi-agent/gpio_monitor.py).
import type { StoreApi, UseBoundStore } from 'zustand'

export interface PinTelemetry {
  bcm: number
  state: 'HIGH' | 'LOW'
  /** pinctrl's function: IN, OUT, ALT (an alternate function, named by `function`) or NONE. */
  direction: string
  pull?: string
  /** "GPIO" for a plain input or output, else the alternate function's name, e.g. "SDA1". */
  function?: string
  info?: string
  consumer?: string
  name?: string
  used?: boolean
}

interface GpioState {
  pins: Record<string, PinTelemetry>
  lastUpdatedAt: number | null
  /** Takes a `gpio_state` frame; an unchanged one leaves the pins as they are. */
  updatePinStates(data: Record<string, PinTelemetry>): void
  clearPins(): void
}

declare const useGpioStore: UseBoundStore<StoreApi<GpioState>>
export default useGpioStore
