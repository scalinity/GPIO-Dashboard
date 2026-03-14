import { Search, X } from 'lucide-react'
import { PIN_TYPES, ALL_PIN_TYPES } from '../data/pins'
import useUiStore from '../store/uiStore'
import GpioHeader from '../components/GpioHeader'
import PinDetail from '../components/PinDetail'

export default function PinoutPage() {
  const pinSearch = useUiStore((s) => s.pinSearch)
  const setPinSearch = useUiStore((s) => s.setPinSearch)
  const pinTypeFilters = useUiStore((s) => s.pinTypeFilters)
  const togglePinTypeFilter = useUiStore((s) => s.togglePinTypeFilter)
  const clearPinTypeFilters = useUiStore((s) => s.clearPinTypeFilters)

  return (
    <div className="flex-1 flex min-h-0">
      {/* Left panel */}
      <div className="flex-1 flex flex-col p-5 overflow-y-auto">
        {/* Search bar */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={pinSearch}
            onChange={(e) => setPinSearch(e.target.value)}
            placeholder="Search pins (name, BCM, physical)..."
            className="input-field pl-9 pr-8"
          />
          {pinSearch && (
            <button
              onClick={() => setPinSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-white/[0.06] rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5 text-gray-500" />
            </button>
          )}
        </div>

        {/* Type filter pills */}
        <div className="flex flex-wrap gap-2 mb-4">
          {pinTypeFilters.length > 0 && (
            <button
              onClick={clearPinTypeFilters}
              className="text-xs px-2.5 py-1 rounded-full bg-white/[0.06] text-gray-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              Clear
            </button>
          )}
          {ALL_PIN_TYPES.map((type) => {
            const info = PIN_TYPES[type]
            const active = pinTypeFilters.includes(type)
            return (
              <button
                key={type}
                onClick={() => togglePinTypeFilter(type)}
                className="text-xs px-2.5 py-1 rounded-full font-medium transition-[background-color,color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                style={{
                  backgroundColor: active ? info.color : 'transparent',
                  color: active ? 'white' : info.color,
                  border: `1px solid ${info.color}`,
                  opacity: active ? 1 : 0.6
                }}
              >
                {info.label}
              </button>
            )
          })}
        </div>

        {/* GPIO Header */}
        <div className="flex justify-center">
          <GpioHeader />
        </div>
      </div>

      {/* Right panel */}
      <PinDetail />
    </div>
  )
}
