import { useMemo } from 'react'
import {
  BOARD_PADDING,
  ROW_SPACING,
  COL_SPACING,
  CENTER_GAP,
  POWER_RAIL_HEIGHT,
  NUM_ROWS,
  COL_LABELS,
  BOARD_WIDTH,
  BOARD_HEIGHT,
  colX,
  rowY
} from './breadboardCoords'

// Landscape: swap width/height
const VB_W = BOARD_HEIGHT
const VB_H = BOARD_WIDTH + 40

// Landscape rail geometry — horizontal strips spanning the row axis
const RAIL_X = rowY(1) - 10
const RAIL_END = rowY(NUM_ROWS) + 10
const RAIL_LEN = RAIL_END - RAIL_X
const NUM_HOLES = 30

// Landscape Y positions: columns map to Y via (BOARD_WIDTH - colX)
const COL_J_Y = BOARD_WIDTH - colX(9) // ~94
const COL_A_Y = BOARD_WIDTH - colX(0) // ~340
const TOP_RAIL_Y = 35
const BOTTOM_RAIL_Y = COL_A_Y + 40

function LandscapePowerRail({ y, side }) {
  const holeSpacing = RAIL_LEN / (NUM_HOLES + 1)

  return (
    <g>
      {/* Positive rail */}
      <rect x={RAIL_X} y={y} width={RAIL_LEN} height={12} rx={2}
        fill="#FECACA" stroke="#EF4444" strokeWidth={1} />
      <text x={RAIL_X - 12} y={y + 10} fontSize={10} fill="#EF4444"
        fontWeight="bold" textAnchor="middle">+</text>
      {Array.from({ length: NUM_HOLES }, (_, i) => (
        <circle key={`pos-${side}-${i}`}
          cx={RAIL_X + holeSpacing * (i + 1)} cy={y + 6}
          r={2.5} fill="#F5F5DC" stroke="#EF4444" strokeWidth={0.5} />
      ))}

      {/* Negative rail */}
      <rect x={RAIL_X} y={y + 16} width={RAIL_LEN} height={12} rx={2}
        fill="#BFDBFE" stroke="#3B82F6" strokeWidth={1} />
      <text x={RAIL_X - 12} y={y + 26} fontSize={10} fill="#3B82F6"
        fontWeight="bold" textAnchor="middle">-</text>
      {Array.from({ length: NUM_HOLES }, (_, i) => (
        <circle key={`neg-${side}-${i}`}
          cx={RAIL_X + holeSpacing * (i + 1)} cy={y + 22}
          r={2.5} fill="#F5F5DC" stroke="#3B82F6" strokeWidth={0.5} />
      ))}
    </g>
  )
}

export default function Breadboard({ children, className = '' }) {
  const tiePoints = useMemo(() => {
    const points = []
    for (let row = 1; row <= NUM_ROWS; row++) {
      for (let c = 0; c < 10; c++) {
        points.push({
          key: `${row}-${COL_LABELS[c]}`,
          cx: colX(c),
          cy: rowY(row),
          row,
          col: COL_LABELS[c]
        })
      }
    }
    return points
  }, [])

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width={VB_W}
      height={VB_H}
      className={className}
      style={{ display: 'block' }}
      aria-label="Breadboard diagram with T-Cobbler and GPIO pins"
      role="img"
    >
      <defs>
        <filter id="boardShadow" x="-5%" y="-5%" width="110%" height="110%">
          <feDropShadow dx={2} dy={2} stdDeviation={4} floodColor="#00000030" />
        </filter>
      </defs>

      {/* Rotate portrait content -90deg into landscape viewport */}
      <g className="landscape-rotate" transform={`translate(0, ${BOARD_WIDTH}) rotate(-90)`}>
        {/* Board body — extra width in portrait so it covers bottom rail area in landscape */}
        <rect
          x={-30} y={10}
          width={BOARD_WIDTH + 20} height={BOARD_HEIGHT - 20}
          rx={12} fill="#F5F5DC" stroke="#D4C9A8" strokeWidth={2}
          filter="url(#boardShadow)"
        />

        {/* Center gap line */}
        <rect
          x={colX(4) + COL_SPACING / 2 + 2}
          y={BOARD_PADDING + POWER_RAIL_HEIGHT + 8}
          width={CENTER_GAP - 4}
          height={NUM_ROWS * ROW_SPACING + 4}
          rx={4} fill="#E8E0C8" stroke="#D4C9A8" strokeWidth={1}
        />

        {/* Column labels */}
        {COL_LABELS.map((label, i) => {
          const lx = colX(i)
          const ly = BOARD_PADDING + POWER_RAIL_HEIGHT + 8
          return (
            <text key={`col-${label}`} x={lx} y={ly}
              fontSize={9} fill="#888" textAnchor="middle" fontFamily="monospace"
              transform={`rotate(90 ${lx} ${ly})`}>
              {label}
            </text>
          )
        })}

        {/* Row labels */}
        {Array.from({ length: NUM_ROWS }, (_, i) => {
          const lx = BOARD_PADDING + 2
          const ly = rowY(i + 1) + 3
          return (
            <text key={`row-${i + 1}`} x={lx} y={ly}
              fontSize={8} fill="#999" textAnchor="end" fontFamily="monospace"
              transform={`rotate(90 ${lx} ${ly})`}>
              {i + 1}
            </text>
          )
        })}

        {/* Tie points */}
        {tiePoints.map((pt) => (
          <circle key={pt.key} cx={pt.cx} cy={pt.cy}
            r={5} fill="#DDD" stroke="#BBB" strokeWidth={0.8}>
            <title>Row {pt.row}, Col {pt.col}</title>
          </circle>
        ))}

        {/* Children (TCobbler, WiringOverlay, etc.) */}
        {children}
      </g>

      {/* Power rails — drawn in landscape coordinates, outside rotation */}
      <LandscapePowerRail y={TOP_RAIL_Y} side="top" />
      <LandscapePowerRail y={BOTTOM_RAIL_Y} side="bottom" />
    </svg>
  )
}
