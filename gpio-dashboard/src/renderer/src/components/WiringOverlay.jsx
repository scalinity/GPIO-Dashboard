import { resolveCoord, colX, rowY } from './breadboardCoords'

function JumperWire({ wire, index }) {
  const from = resolveCoord(wire.from)
  const to = resolveCoord(wire.to)

  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  const curveHeight = Math.min(dist * 0.3, 40)

  const midX = (from.x + to.x) / 2
  const midY = Math.min(from.y, to.y) - curveHeight

  const d = `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`
  const totalLength = dist * 1.3
  const delay = index * 0.15

  return (
    <g>
      {/* Wire endpoint dots */}
      <circle cx={from.x} cy={from.y} r={3.5} fill={wire.color || '#EF4444'} stroke="#FFF" strokeWidth={0.8} />
      <circle cx={to.x} cy={to.y} r={3.5} fill={wire.color || '#EF4444'} stroke="#FFF" strokeWidth={0.8} />
      <path
        d={d}
        fill="none"
        stroke={wire.color || '#EF4444'}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={totalLength}
        strokeDashoffset={totalLength}
        opacity={0.9}
      >
        <animate
          attributeName="stroke-dashoffset"
          from={totalLength}
          to={0}
          dur="0.5s"
          begin={`${delay}s`}
          fill="freeze"
        />
      </path>
    </g>
  )
}

// Components span from row to row+1 (or endRow) with visible legs and connection dots
function LEDSymbol({ component }) {
  const pos = component.position || component
  const startRow = pos.row
  const endRow = pos.endRow || startRow + 1
  const top = resolveCoord(`row:${startRow}:${pos.col}`)
  const bot = resolveCoord(`row:${endRow}:${pos.col}`)
  const color = component.color || '#EF4444'
  const cx = top.x
  const midY = (top.y + bot.y) / 2

  return (
    <g>
      {/* Anode connection dot */}
      <circle cx={cx} cy={top.y} r={3.5} fill={color} stroke="#FFF" strokeWidth={1} />
      {/* Cathode connection dot */}
      <circle cx={cx} cy={bot.y} r={3.5} fill="#666" stroke="#FFF" strokeWidth={1} />
      {/* Anode leg */}
      <line x1={cx} y1={top.y} x2={cx} y2={midY - 6} stroke="#999" strokeWidth={1.5} />
      {/* Cathode leg */}
      <line x1={cx} y1={midY + 6} x2={cx} y2={bot.y} stroke="#999" strokeWidth={1.5} />
      {/* Triangle (anode side) */}
      <polygon
        points={`${cx - 6},${midY - 6} ${cx + 6},${midY - 6} ${cx},${midY + 4}`}
        fill={color}
        opacity={0.85}
        stroke="#333"
        strokeWidth={0.5}
      />
      {/* Cathode bar */}
      <line x1={cx - 6} y1={midY + 4} x2={cx + 6} y2={midY + 4} stroke="#333" strokeWidth={1.5} />
      {/* Glow */}
      <circle cx={cx} cy={midY - 2} r={4} fill={color} opacity={0.3}>
        <animate attributeName="opacity" values="0.15;0.5;0.15" dur="1.5s" repeatCount="indefinite" />
      </circle>
      {/* Label */}
      {component.label && (
        <text x={cx + 12} y={midY + 3} fontSize={7} fill="#888" textAnchor="start" fontFamily="monospace">
          {component.label}
        </text>
      )}
    </g>
  )
}

function ResistorSymbol({ component }) {
  const pos = component.position || component
  const startRow = pos.row
  const endRow = pos.endRow || startRow + 1
  const top = resolveCoord(`row:${startRow}:${pos.col}`)
  const bot = resolveCoord(`row:${endRow}:${pos.col}`)
  const cx = top.x
  const midY = (top.y + bot.y) / 2
  const bodyH = 10

  // Vertical zigzag
  const zx = cx
  const zy = midY - bodyH / 2
  const zigzag = `M ${zx} ${zy} l -4 ${bodyH * 0.17} l 8 ${bodyH * 0.17} l -8 ${bodyH * 0.17} l 8 ${bodyH * 0.17} l -8 ${bodyH * 0.17} l 4 ${bodyH * 0.17}`

  return (
    <g>
      {/* Connection dots at tie-point holes */}
      <circle cx={cx} cy={top.y} r={3.5} fill="#8B5E3C" stroke="#FFF" strokeWidth={1} />
      <circle cx={cx} cy={bot.y} r={3.5} fill="#8B5E3C" stroke="#FFF" strokeWidth={1} />
      {/* Top leg */}
      <line x1={cx} y1={top.y} x2={cx} y2={midY - bodyH / 2} stroke="#999" strokeWidth={1.5} />
      {/* Bottom leg */}
      <line x1={cx} y1={midY + bodyH / 2} x2={cx} y2={bot.y} stroke="#999" strokeWidth={1.5} />
      {/* Resistor body */}
      <path d={zigzag} fill="none" stroke="#8B5E3C" strokeWidth={1.8} strokeLinecap="round" />
      {/* Value label */}
      <text x={cx + 10} y={midY + 3} fontSize={7} fill="#888" textAnchor="start" fontFamily="monospace">
        {component.value || component.label || ''}
      </text>
    </g>
  )
}

function ButtonSymbol({ component }) {
  const pos = component.position || component
  const coord = resolveCoord(`row:${pos.row}:${pos.col}`)
  const w = 16
  const h = 12

  return (
    <g>
      <rect
        x={coord.x - w / 2}
        y={coord.y - h / 2}
        width={w}
        height={h}
        rx={2}
        fill="#4B5563"
        stroke="#333"
        strokeWidth={1}
      />
      {/* Connection dots */}
      <circle cx={coord.x - w / 2 - 3} cy={coord.y} r={3} fill="#999" stroke="#FFF" strokeWidth={0.8} />
      <circle cx={coord.x + w / 2 + 3} cy={coord.y} r={3} fill="#999" stroke="#FFF" strokeWidth={0.8} />
      {component.label && (
        <text x={coord.x} y={coord.y + h / 2 + 10} fontSize={7} fill="#888" textAnchor="middle" fontFamily="monospace">
          {component.label}
        </text>
      )}
    </g>
  )
}

function BuzzerSymbol({ component }) {
  const pos = component.position || component
  const coord = resolveCoord(`row:${pos.row}:${pos.col}`)

  return (
    <g>
      <circle cx={coord.x} cy={coord.y} r={10} fill="#374151" stroke="#555" strokeWidth={1} />
      <circle cx={coord.x} cy={coord.y} r={3} fill="#999" stroke="#FFF" strokeWidth={0.8} />
      {component.label && (
        <text x={coord.x} y={coord.y + 20} fontSize={7} fill="#888" textAnchor="middle" fontFamily="monospace">
          {component.label}
        </text>
      )}
    </g>
  )
}

const COMPONENT_MAP = {
  led: LEDSymbol,
  resistor: ResistorSymbol,
  button: ButtonSymbol,
  switch: ButtonSymbol,
  buzzer: BuzzerSymbol
}

export default function WiringOverlay({ diagram }) {
  if (!diagram) return null

  const { wires = [], components = [], highlightPins = [], highlightRows = [] } = diagram

  return (
    <g className="wiring-overlay">
      {/* Row highlights */}
      {highlightRows.map((hr) => {
        const row = typeof hr === 'number' ? hr : hr.row
        const color = typeof hr === 'number' ? '#3B82F6' : (hr.color || '#3B82F6')
        const y = rowY(row) - 10
        return (
          <rect
            key={`hr-${row}`}
            x={colX(0) - 10}
            y={y}
            width={colX(9) - colX(0) + 20}
            height={20}
            rx={4}
            fill={color}
            opacity={0.12}
          />
        )
      })}

      {/* Pin highlights (pulsing outlines on cobbler pins) */}
      {highlightPins.map((pinName) => {
        const coord = resolveCoord(`cobbler:${pinName}`)
        if (coord.x === 0 && coord.y === 0) return null
        return (
          <circle
            key={`hl-${pinName}`}
            cx={coord.x}
            cy={coord.y}
            r={10}
            fill="none"
            stroke="#FBBF24"
            strokeWidth={2}
            opacity={0.8}
          >
            <animate attributeName="r" values="10;14;10" dur="1.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.2s" repeatCount="indefinite" />
          </circle>
        )
      })}

      {/* Component symbols */}
      {components.map((comp, i) => {
        const Comp = COMPONENT_MAP[comp.type]
        if (!Comp) return null
        return <Comp key={`comp-${i}`} component={comp} />
      })}

      {/* Jumper wires */}
      {wires.map((wire, i) => (
        <JumperWire key={`wire-${i}`} wire={wire} index={i} />
      ))}
    </g>
  )
}
