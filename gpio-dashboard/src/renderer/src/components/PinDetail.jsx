import { X } from 'lucide-react'
import { PIN_TYPES } from '../data/pins'
import { usePinState } from '../store/gpioStore'
import useUiStore from '../store/uiStore'

export default function PinDetail() {
  const selectedPin = useUiStore((s) => s.selectedPin)
  const setSelectedPin = useUiStore((s) => s.setSelectedPin)
  const liveState = usePinState(selectedPin?.bcm)

  if (!selectedPin) {
    return (
      <div className="w-80 glass-bg border-l border-white/[0.04] p-6 flex items-center justify-center">
        <p className="text-gray-500 text-sm text-center">Click a pin to see details</p>
      </div>
    )
  }

  const typeInfo = PIN_TYPES[selectedPin.type]

  return (
    <div className="w-80 bg-surface-800/60 backdrop-blur-xl border-l border-white/[0.04] p-6 overflow-y-auto">
      <div className="flex items-start justify-between mb-4">
        <h3 className="text-lg font-bold text-white">{selectedPin.name}</h3>
        <button
          onClick={() => setSelectedPin(null)}
          className="p-1 hover:bg-white/[0.06] rounded transition-colors"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <span
            className="text-xs font-medium px-2 py-1 rounded-full text-white"
            style={{ backgroundColor: typeInfo.color }}
          >
            {typeInfo.label}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="section-title block mb-0.5">Physical</span>
            <span className="text-white font-mono tabular-nums">{selectedPin.physical}</span>
          </div>
          {selectedPin.bcm !== null && (
            <div>
              <span className="section-title block mb-0.5">BCM</span>
              <span className="text-white font-mono tabular-nums">{selectedPin.bcm}</span>
            </div>
          )}
          {selectedPin.wiringPi !== null && (
            <div>
              <span className="section-title block mb-0.5">WiringPi</span>
              <span className="text-white font-mono tabular-nums">{selectedPin.wiringPi}</span>
            </div>
          )}
        </div>

        <div>
          <span className="section-title block mb-1">Description</span>
          <p className="text-gray-300 text-sm">{selectedPin.description}</p>
        </div>

        {selectedPin.altFunctions.length > 0 && (
          <div>
            <span className="section-title block mb-1">Alt Functions</span>
            <div className="flex flex-wrap gap-1">
              {selectedPin.altFunctions.map((fn) => (
                <span
                  key={fn}
                  className="text-xs bg-white/[0.06] text-gray-300 px-2 py-0.5 rounded"
                >
                  {fn}
                </span>
              ))}
            </div>
          </div>
        )}

        {liveState && (
          <div className="border-t border-white/[0.06] pt-4">
            <span className="section-title block mb-2">Live State</span>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="section-title block mb-0.5">Value</span>
                <span
                  className={`font-mono font-bold ${liveState.state === 1 ? 'text-green-400' : 'text-gray-400'}`}
                >
                  {liveState.state === 1 ? 'HIGH' : 'LOW'}
                </span>
              </div>
              <div>
                <span className="section-title block mb-0.5">Direction</span>
                <span className="text-white font-mono uppercase">{liveState.direction}</span>
              </div>
              {liveState.pull && (
                <div>
                  <span className="section-title block mb-0.5">Pull</span>
                  <span className="text-white font-mono uppercase">{liveState.pull}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
