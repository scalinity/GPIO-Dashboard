import { memo } from 'react'
import { PINS, PIN_TYPES } from '../data/pins'
import { usePinState, usePinChanged } from '../store/gpioStore'
import {
  colX,
  rowY,
  COBBLER_START_ROW,
  COBBLER_END_ROW,
  cobblerPinCoord
} from './breadboardCoords'

const CobblerPin = memo(function CobblerPin({ pin }) {
  const pinState = usePinState(pin.bcm)
  const changed = usePinChanged(pin.bcm)
  const coord = cobblerPinCoord(pin.physical)
  const color = PIN_TYPES[pin.type]?.color || '#888'

  const padW = 36
  const padH = 14
  const px = coord.x - padW / 2
  const py = coord.y - padH / 2
  const isLeft = coord.side === 'left'
  const textAnchor = isLeft ? 'end' : 'start'
  const textX = isLeft ? coord.x - padW / 2 - 3 : coord.x + padW / 2 + 3

  const isHigh = pinState?.state === 'HIGH'
  const isGpio = pin.bcm !== null && pin.type !== 'eeprom'

  const tooltipText = `${pin.name}${pin.bcm !== null ? ` (BCM ${pin.bcm})` : ''} — ${PIN_TYPES[pin.type]?.label || ''}${pinState ? ` | ${isHigh ? 'HIGH' : 'LOW'} (${pinState.direction || '?'})` : ''}`

  return (
    <g style={{ cursor: 'pointer' }}>
      {/* Native tooltip */}
      <title>{tooltipText}</title>

      {/* Pin pad */}
      <rect
        x={px}
        y={py}
        width={padW}
        height={padH}
        rx={2}
        fill={color}
        opacity={0.85}
      />

      {/* Pin label on pad */}
      <text
        x={coord.x}
        y={coord.y + 3.5}
        fontSize={7}
        fill="#FFF"
        textAnchor="middle"
        fontFamily="monospace"
        fontWeight="bold"
      >
        {pin.name.length > 6 ? pin.name.slice(0, 6) : pin.name}
      </text>

      {/* Physical pin number outside pad */}
      <text
        x={textX}
        y={coord.y + 3}
        fontSize={6}
        fill="#9CA3AF"
        textAnchor={textAnchor}
        fontFamily="monospace"
      >
        {pin.physical}
      </text>

      {/* Live state indicator for GPIO pins */}
      {isGpio && pinState && (
        <circle
          cx={isLeft ? px + padW + 6 : px - 6}
          cy={coord.y}
          r={3}
          fill={isHigh ? '#22C55E' : '#4B5563'}
          opacity={isHigh ? 1 : 0.5}
        >
          {changed && (
            <animate
              attributeName="r"
              values="3;5;3"
              dur="0.3s"
              repeatCount="1"
            />
          )}
        </circle>
      )}
    </g>
  )
})

export default function TCobbler() {
  const topY = rowY(COBBLER_START_ROW) - 12
  const bottomY = rowY(COBBLER_END_ROW) + 12
  const bodyH = bottomY - topY

  // PCB body spans from column d to column g (across center gap)
  const leftEdge = colX(3) - 24
  const rightEdge = colX(6) + 24
  const bodyW = rightEdge - leftEdge

  // Ribbon cable
  const ribbonW = bodyW * 0.6
  const ribbonX = leftEdge + (bodyW - ribbonW) / 2
  const ribbonH = 18

  return (
    <g>
      {/* Ribbon cable extending from top */}
      <rect
        x={ribbonX}
        y={topY - ribbonH}
        width={ribbonW}
        height={ribbonH + 4}
        rx={2}
        fill="#9CA3AF"
      />
      {/* Ribbon stripes */}
      {Array.from({ length: 8 }, (_, i) => (
        <line
          key={`stripe-${i}`}
          x1={ribbonX + 8 + i * (ribbonW - 16) / 7}
          y1={topY - ribbonH}
          x2={ribbonX + 8 + i * (ribbonW - 16) / 7}
          y2={topY + 2}
          stroke={i % 2 === 0 ? '#6B7280' : '#B0B0B0'}
          strokeWidth={2}
        />
      ))}

      {/* PCB body */}
      <rect
        x={leftEdge}
        y={topY}
        width={bodyW}
        height={bodyH}
        rx={4}
        fill="#1B5E20"
        stroke="#0D3B0D"
        strokeWidth={1.5}
      />

      {/* PCB label */}
      <text
        x={leftEdge + bodyW / 2}
        y={topY + 14}
        fontSize={8}
        fill="#A5D6A7"
        textAnchor="middle"
        fontFamily="monospace"
        fontWeight="bold"
      >
        T-Cobbler Plus
      </text>

      {/* Pin pads */}
      {PINS.map((pin) => (
        <CobblerPin key={pin.physical} pin={pin} />
      ))}
    </g>
  )
}
