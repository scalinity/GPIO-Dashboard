import { useCallback, useMemo } from 'react'
import { PINS } from '../data/pins'
import useUiStore from '../store/uiStore'
import GpioPin from './GpioPin'

// O(1) lookup by physical pin number instead of O(n) PINS.find per row
const PIN_BY_PHYSICAL = new Map(PINS.map((p) => [p.physical, p]))

export default function GpioHeader() {
  const pinSearch = useUiStore((s) => s.pinSearch)
  const pinTypeFilters = useUiStore((s) => s.pinTypeFilters)

  const matchesFilter = useCallback((pin) => {
    if (pinTypeFilters.length > 0 && !pinTypeFilters.includes(pin.type)) return false
    if (pinSearch) {
      const q = pinSearch.toLowerCase()
      const nameMatch = pin.name.toLowerCase().includes(q)
      const bcmMatch = pin.bcm !== null && String(pin.bcm).includes(q)
      const physMatch = String(pin.physical).includes(q)
      if (!nameMatch && !bcmMatch && !physMatch) return false
    }
    return true
  }, [pinSearch, pinTypeFilters])

  // Build 20 rows x 2 columns grid - O(1) Map lookups
  const rows = useMemo(() => Array.from({ length: 20 }, (_, i) => {
    const leftPin = PIN_BY_PHYSICAL.get(i * 2 + 1)
    const rightPin = PIN_BY_PHYSICAL.get(i * 2 + 2)
    return { leftPin, rightPin, row: i }
  }), [])

  return (
    <div>
      <h3 className="section-title mb-3 text-center">
        GPIO Header (Top View)
      </h3>
      <div className="inline-grid grid-cols-[auto_1fr_8px_1fr_auto] gap-y-2 gap-x-1">
        {rows.map(({ leftPin, rightPin, row }) => {
          const leftVisible = leftPin && matchesFilter(leftPin)
          const rightVisible = rightPin && matchesFilter(rightPin)

          return (
            <div key={row} className="contents">
              {/* Left physical number */}
              <span className="text-[10px] text-gray-500 font-mono tabular-nums self-center text-right pr-1">
                {leftPin?.physical}
              </span>

              {/* Left pin */}
              <div className="flex justify-end">
                {leftPin && leftVisible ? (
                  <GpioPin pin={leftPin} />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-white/[0.02] opacity-30" />
                )}
              </div>

              {/* Center gap */}
              <div />

              {/* Right pin */}
              <div className="flex justify-start">
                {rightPin && rightVisible ? (
                  <GpioPin pin={rightPin} />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-white/[0.02] opacity-30" />
                )}
              </div>

              {/* Right physical number */}
              <span className="text-[10px] text-gray-500 font-mono tabular-nums self-center text-left pl-1">
                {rightPin?.physical}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
