import { PINS } from '../data/pins'

// Layout constants - shared across Breadboard, TCobbler, and WiringOverlay
export const BOARD_PADDING = 50
export const ROW_SPACING = 24
export const COL_SPACING = 24
export const CENTER_GAP = 30
export const POWER_RAIL_HEIGHT = 30
export const NUM_ROWS = 30
const NUM_COLS = 10 // a-j
const LABEL_OFFSET = 20

// Column labels
export const COL_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']

// X position for a given column index (0=a, 9=j)
export function colX(colIndex) {
  if (colIndex < 5) {
    return BOARD_PADDING + LABEL_OFFSET + colIndex * COL_SPACING
  }
  return BOARD_PADDING + LABEL_OFFSET + colIndex * COL_SPACING + CENTER_GAP
}

// Y position for a given row (1-based)
export function rowY(row) {
  return BOARD_PADDING + POWER_RAIL_HEIGHT + 20 + (row - 1) * ROW_SPACING
}

// Power rail Y positions
export function powerRailY(position) {
  if (position === 'top') return BOARD_PADDING
  // bottom rail after all rows
  return BOARD_PADDING + POWER_RAIL_HEIGHT + 20 + NUM_ROWS * ROW_SPACING + 10
}

// T-Cobbler pin mapping:
// Odd physical pins (1,3,5,...39) -> left column (columns d,e -> indices 3,4)
// Even physical pins (2,4,6,...40) -> right column (columns f,g -> indices 5,6)
// Cobbler spans rows 1-20
export const COBBLER_START_ROW = 1
export const COBBLER_END_ROW = 20

export function cobblerPinCoord(physicalPin) {
  const isOdd = physicalPin % 2 === 1
  const pairIndex = Math.floor((physicalPin - 1) / 2) // 0-19
  const row = COBBLER_START_ROW + pairIndex
  const y = rowY(row)

  if (isOdd) {
    // Left column - between d and e
    const x = (colX(3) + colX(4)) / 2
    return { x, y, row, side: 'left' }
  } else {
    // Right column - between f and g
    const x = (colX(5) + colX(6)) / 2
    return { x, y, row, side: 'right' }
  }
}

// Build lookup: pin name -> cobbler coordinate
const _cobblerLookup = {}
for (const pin of PINS) {
  const coord = cobblerPinCoord(pin.physical)
  _cobblerLookup[pin.name] = coord
  if (pin.bcm !== null) {
    _cobblerLookup[`GPIO${pin.bcm}`] = coord
  }
}

// Resolve abstract position string to SVG {x, y}
// Formats:
//   "row:5:a"          -> row 5, column a
//   "cobbler:GPIO17"   -> cobbler pin for GPIO17
//   "power:+:top"      -> top positive rail
//   "power:-:bottom"   -> bottom negative rail
export function resolveCoord(position) {
  if (typeof position !== 'string') return { x: 0, y: 0 }

  const parts = position.split(':')

  if (parts[0] === 'row') {
    const row = parseInt(parts[1], 10)
    const col = parts[2]
    const colIndex = COL_LABELS.indexOf(col)
    if (colIndex === -1 || isNaN(row)) return { x: 0, y: 0 }
    return { x: colX(colIndex), y: rowY(row) }
  }

  if (parts[0] === 'cobbler') {
    const pinName = parts[1]
    const coord = _cobblerLookup[pinName]
    if (coord) return { x: coord.x, y: coord.y }
    return { x: 0, y: 0 }
  }

  if (parts[0] === 'power') {
    const polarity = parts[1] // '+' or '-'
    const pos = parts[2] // 'top' or 'bottom'
    const railY = powerRailY(pos)
    // + rail is on the left side, - rail is on the right
    const x = polarity === '+' ? BOARD_PADDING + 60 : BOARD_PADDING + 200
    return { x, y: railY + POWER_RAIL_HEIGHT / 2 }
  }

  return { x: 0, y: 0 }
}

// Board dimensions derived from constants
export const BOARD_WIDTH =
  BOARD_PADDING * 2 + LABEL_OFFSET + NUM_COLS * COL_SPACING + CENTER_GAP + 20
export const BOARD_HEIGHT =
  BOARD_PADDING + POWER_RAIL_HEIGHT * 2 + 40 + NUM_ROWS * ROW_SPACING + 30
