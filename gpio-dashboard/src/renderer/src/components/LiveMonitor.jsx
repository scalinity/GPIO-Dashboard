import React, { useState, useMemo } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { PINS } from '../data/pins'
import useGpioStore, { usePinState, usePinChanged } from '../store/gpioStore'

const GPIO_PINS = PINS.filter((p) => p.bcm !== null).sort((a, b) => a.bcm - b.bcm)

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active Only' },
  { key: 'inputs', label: 'Inputs' },
  { key: 'outputs', label: 'Outputs' }
]

const PinRow = React.memo(function PinRow({ pin }) {
  const state = usePinState(String(pin.bcm))
  const changed = usePinChanged(String(pin.bcm))

  const isHigh = state?.state === 'HIGH'
  const isOutput = state?.direction === 'OUT'

  return (
    <tr
      className={`border-b border-white/[0.04] transition-colors duration-200 ${
        changed ? 'bg-yellow-500/10' : 'even:bg-white/[0.015]'
      }`}
    >
      <td className="px-3 py-2 text-sm font-mono tabular-nums text-gray-300">{pin.bcm}</td>
      <td className="px-3 py-2 text-sm text-gray-500 tabular-nums">{pin.physical}</td>
      <td className="px-3 py-2 text-sm text-gray-300">{pin.name}</td>
      <td className="px-3 py-2 text-sm">
        {state ? (
          <span className={`inline-flex items-center gap-1 ${isOutput ? 'text-state-output' : 'text-state-input'}`}>
            {isOutput ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {isOutput ? 'OUT' : 'IN'}
          </span>
        ) : (
          <span className="text-gray-600">--</span>
        )}
      </td>
      <td className="px-3 py-2 text-sm">
        {state ? (
          <span className="inline-flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isHigh ? 'bg-state-high shadow-[0_0_4px_rgba(34,197,94,0.5)]' : 'bg-state-low'}`} />
            <span className={isHigh ? 'text-state-high font-medium' : 'text-gray-500'}>
              {isHigh ? 'HIGH' : 'LOW'}
            </span>
          </span>
        ) : (
          <span className="text-gray-600">--</span>
        )}
      </td>
      <td className="px-3 py-2 text-sm text-gray-500">{state?.pull || '--'}</td>
      <td className="px-3 py-2 text-sm text-gray-500">{pin.type}</td>
    </tr>
  )
})

export default function LiveMonitor() {
  const [filter, setFilter] = useState('all')
  const pins = useGpioStore((s) => s.pins)
  const lastUpdatedAt = useGpioStore((s) => s.lastUpdatedAt)

  const filteredPins = useMemo(() => {
    return GPIO_PINS.filter((pin) => {
      const state = pins[String(pin.bcm)]
      if (filter === 'active') {
        return state && state.state === 'HIGH'
      }
      if (filter === 'inputs') {
        return state && state.direction === 'IN'
      }
      if (filter === 'outputs') {
        return state && state.direction === 'OUT'
      }
      return true
    })
  }, [filter, pins])

  const hasPinData = Object.keys(pins).length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 text-xs font-medium rounded-btn transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
              filter === f.key
                ? 'bg-accent/20 text-accent-light border border-accent/30'
                : 'text-gray-400 hover:text-gray-300 bg-white/[0.04] border border-transparent'
            }`}
          >
            {f.label}
          </button>
        ))}

        {hasPinData && (
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            ~10Hz
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-card border border-white/[0.04]">
        <table className="w-full">
          <thead className="bg-surface-800 sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left section-title">BCM</th>
              <th className="px-3 py-2 text-left section-title">Pin</th>
              <th className="px-3 py-2 text-left section-title">Name</th>
              <th className="px-3 py-2 text-left section-title">Dir</th>
              <th className="px-3 py-2 text-left section-title">State</th>
              <th className="px-3 py-2 text-left section-title">Pull</th>
              <th className="px-3 py-2 text-left section-title">Function</th>
            </tr>
          </thead>
          <tbody>
            {filteredPins.map((pin) => (
              <PinRow key={pin.bcm} pin={pin} />
            ))}
            {filteredPins.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500 text-sm">
                  No pins match the current filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      {hasPinData && (
        <div className="mt-2 text-xs text-gray-600">
          Last update: {new Date(lastUpdatedAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
