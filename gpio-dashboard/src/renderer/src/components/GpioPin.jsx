import { ArrowUp, ArrowDown } from 'lucide-react'
import { PIN_TYPES } from '../data/pins'
import { usePinState, usePinChanged } from '../store/gpioStore'
import useUiStore from '../store/uiStore'

export default function GpioPin({ pin }) {
  const setSelectedPin = useUiStore((s) => s.setSelectedPin)
  const liveState = usePinState(pin.bcm)
  const changed = usePinChanged(pin.bcm)

  const isGpio = pin.bcm !== null
  const typeInfo = PIN_TYPES[pin.type]

  return (
    <button
      className={`pin-cell ${changed ? 'animate-gpio-pulse' : ''}`}
      style={{ backgroundColor: typeInfo.color }}
      onClick={() => setSelectedPin(pin)}
      aria-label={`Pin ${pin.physical}: ${pin.name}${isGpio ? `, BCM ${pin.bcm}` : ''}, ${typeInfo.label}`}
    >
      {isGpio ? (
        <span className="text-xs font-bold text-white leading-none">{pin.bcm}</span>
      ) : (
        <span className="text-[9px] font-semibold text-white/80 leading-none">{pin.name}</span>
      )}

      {/* Physical number badge */}
      <span className="absolute -top-1 -right-1 text-[8px] bg-black/70 font-mono text-white rounded px-0.5 leading-tight">
        {pin.physical}
      </span>

      {/* Live state indicators */}
      {liveState && (
        <>
          <span
            className={`absolute bottom-0.5 left-0.5 w-1.5 h-1.5 rounded-full ${
              liveState.state === 'HIGH' || liveState.state === 1
                ? 'bg-green-300 shadow-[0_0_4px_rgba(134,239,172,0.6)]'
                : 'bg-gray-600'
            }`}
          />
          <span className="absolute bottom-0 right-0.5 text-white/70">
            {liveState.direction === 'OUT' || liveState.direction === 'out' ? (
              <ArrowUp className="w-2.5 h-2.5" />
            ) : (
              <ArrowDown className="w-2.5 h-2.5" />
            )}
          </span>
        </>
      )}
    </button>
  )
}
