// Hole positions, strips and rails of a breadboard, computed from its definition (SPEC 6.1).
// Positions are in the board's local frame (mm): x from the row-1 end along the rows, y from
// the a-side edge across them. The 3D assets read the same definitions, so modelled holes and
// logical holes coincide (SPEC 4.5).
import type { BoardDef } from '../defs/boards'
import type { HoleRef, MainColumn, RailId, Vec2 } from '../model/types'
import { MAIN_COLUMNS, RAIL_IDS } from '../model/types'

/** A column's distance from column a in pitches: a–e are 0–4, f–j sit past the trench. */
export function columnPitches(def: BoardDef, col: MainColumn): number {
  const i = MAIN_COLUMNS.indexOf(col)
  return i < 5 ? i : i - 1 + def.trenchPitches
}

export function rowX(def: BoardDef, row: number): number {
  return def.layout.row1FromEndMm + (row - 1) * def.pitchMm
}

export function columnY(def: BoardDef, col: MainColumn): number {
  return def.layout.columnAFromBottomEdgeMm + columnPitches(def, col) * def.pitchMm
}

/** The y of a rail's hole line. Top rails are past column j, bottom rails before column a. */
export function railY(def: BoardDef, rail: RailId): number {
  const side = rail.startsWith('top') ? 'top' : 'bottom'
  const sign = rail.endsWith('+') ? '+' : '-'
  const offset =
    def.rails.polarity[side].inner === sign
      ? def.rails.innerOffsetPitches
      : def.rails.outerOffsetPitches
  const pitches = side === 'top' ? columnPitches(def, 'j') + offset : -offset
  return def.layout.columnAFromBottomEdgeMm + pitches * def.pitchMm
}

/** The (possibly fractional) row a rail hole lines up with. */
export function railHoleRow(def: BoardDef, index: number): number {
  const { groupSize, groupStride, firstRow, rowOffsetPitches } = def.rails
  return (
    firstRow + Math.floor(index / groupSize) * groupStride + (index % groupSize) + rowOffsetPitches
  )
}

export function isValidHole(def: BoardDef, hole: HoleRef): boolean {
  if (hole.area === 'main') {
    return (
      Number.isInteger(hole.row) &&
      hole.row >= 1 &&
      hole.row <= def.rows &&
      MAIN_COLUMNS.includes(hole.col)
    )
  }
  return (
    RAIL_IDS.includes(hole.rail) &&
    Number.isInteger(hole.index) &&
    hole.index >= 0 &&
    hole.index < def.rails.holesPerRail
  )
}

export function holePosition(def: BoardDef, hole: HoleRef): Vec2 {
  if (!isValidHole(def, hole)) throw new Error(`No such hole: ${holeKey(hole)}`)
  return hole.area === 'main'
    ? [rowX(def, hole.row), columnY(def, hole.col)]
    : [rowX(def, railHoleRow(def, hole.index)), railY(def, hole.rail)]
}

/** A stable string for a hole, e.g. "bb1:23e" or "bb1:top+.7". */
export function holeKey(hole: HoleRef): string {
  return hole.area === 'main'
    ? `${hole.board}:${hole.row}${hole.col}`
    : `${hole.board}:${hole.rail}.${hole.index}`
}

export function parseHoleKey(key: string): HoleRef | null {
  const main = /^([^:]+):(\d+)([a-j])$/.exec(key)
  if (main)
    return { board: main[1]!, area: 'main', row: Number(main[2]), col: main[3] as MainColumn }
  const rail = /^([^:]+):((?:top|bottom)[+-])\.(\d+)$/.exec(key)
  if (rail)
    return { board: rail[1]!, area: 'rail', rail: rail[2] as RailId, index: Number(rail[3]) }
  return null
}

/**
 * The strip a hole belongs to: the five holes a–e or f–j of one row, or one rail (two halves
 * when the board's rails are split).
 */
export function stripKey(def: BoardDef, hole: HoleRef, splitRails = false): string {
  if (hole.area === 'main') {
    return `${hole.board}:${hole.row}${MAIN_COLUMNS.indexOf(hole.col) < 5 ? 'a-e' : 'f-j'}`
  }
  if (!splitRails) return `${hole.board}:${hole.rail}`
  return `${hole.board}:${hole.rail}:${hole.index < def.rails.holesPerRail / 2 ? 1 : 2}`
}

/** Every hole of a board, main area first (row by row, a to j), then each rail. */
export function boardHoles(def: BoardDef, board: string): HoleRef[] {
  const holes: HoleRef[] = []
  for (let row = 1; row <= def.rows; row++) {
    for (const col of MAIN_COLUMNS) holes.push({ board, area: 'main', row, col })
  }
  for (const rail of RAIL_IDS) {
    for (let index = 0; index < def.rails.holesPerRail; index++) {
      holes.push({ board, area: 'rail', rail, index })
    }
  }
  return holes
}

/** The hole nearest a local point, if one lies within `toleranceMm`. */
export function nearestHole(
  def: BoardDef,
  board: string,
  [x, y]: Vec2,
  toleranceMm = def.pitchMm / 2
): HoleRef | null {
  const candidates: HoleRef[] = []
  const row = Math.round((x - def.layout.row1FromEndMm) / def.pitchMm) + 1
  if (row >= 1 && row <= def.rows) {
    for (const col of MAIN_COLUMNS) candidates.push({ board, area: 'main', row, col })
  }
  for (const rail of RAIL_IDS) {
    for (let index = 0; index < def.rails.holesPerRail; index++) {
      if (Math.abs(rowX(def, railHoleRow(def, index)) - x) <= toleranceMm) {
        candidates.push({ board, area: 'rail', rail, index })
      }
    }
  }
  let best: HoleRef | null = null
  let bestDistance = toleranceMm
  for (const hole of candidates) {
    const [hx, hy] = holePosition(def, hole)
    const distance = Math.hypot(hx - x, hy - y)
    if (distance <= bestDistance) {
      best = hole
      bestDistance = distance
    }
  }
  return best
}
