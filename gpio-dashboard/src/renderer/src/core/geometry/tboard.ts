// Where the T-board's 40 pins land and which holes its body covers (SPEC 6.3, 6.6).
import type { BoardDef } from '../defs/boards'
import type { Rect, TboardDef } from '../defs/controllers'
import type { ColPair, HoleRef, MainColumn, TboardPlacement, Vec2 } from '../model/types'
import { boardHoles, columnY, holeKey, holePosition, rowX } from './breadboard'

const PAIR_COLUMNS: Record<ColPair, [MainColumn, MainColumn]> = {
  'b/f': ['b', 'f'],
  'c/g': ['c', 'g'],
  'd/h': ['d', 'h'],
  'e/i': ['e', 'i']
}

const reversed = (p: TboardPlacement) => p.orientation === 'header-toward-last-row'

/** The hole pin `pin` (1–40) sits in. Odd pins take the a–e column of the pair, unless reversed. */
export function tboardPinHole(p: TboardPlacement, pin: number): HoleRef {
  if (!Number.isInteger(pin) || pin < 1 || pin > 40) throw new Error(`No T-board pin ${pin}`)
  const [low, high] = PAIR_COLUMNS[p.colPair]
  const odd = pin % 2 === 1
  const k = Math.floor((pin - 1) / 2)
  const col = odd !== reversed(p) ? low : high
  const row = reversed(p) ? p.pin1Row - k : p.pin1Row + k
  return { board: p.board, area: 'main', row, col }
}

export function tboardPinHoles(p: TboardPlacement): HoleRef[] {
  return Array.from({ length: 40 }, (_, i) => tboardPinHole(p, i + 1))
}

/** Maps the T-board's local frame (pin 1 at the origin) into the board's frame. */
export function tboardToBoard(def: BoardDef, p: TboardPlacement, [x, y]: Vec2): Vec2 {
  const [low] = PAIR_COLUMNS[p.colPair]
  const s = reversed(p) ? -1 : 1
  const pin1Col = reversed(p) ? PAIR_COLUMNS[p.colPair][1] : low
  return [rowX(def, p.pin1Row) + s * x, columnY(def, pin1Col) + s * y]
}

/** The body's outline rectangles (stem and top bar) in the board's frame. */
export function tboardOutline(def: BoardDef, tb: TboardDef, p: TboardPlacement): Rect[] {
  return [tb.outline.stem, tb.outline.topBar].map((r) => {
    const [x1, y1] = tboardToBoard(def, p, [r.xMin, r.yMin])
    const [x2, y2] = tboardToBoard(def, p, [r.xMax, r.yMax])
    return {
      xMin: Math.min(x1, x2),
      xMax: Math.max(x1, x2),
      yMin: Math.min(y1, y2),
      yMax: Math.max(y1, y2)
    }
  })
}

/** How far a square of side `size` centred at `c` sinks into `r` (0 when they don't touch). */
export function overlapDepth([cx, cy]: Vec2, size: number, r: Rect): number {
  const h = size / 2
  const dx = Math.min(cx + h, r.xMax) - Math.max(cx - h, r.xMin)
  const dy = Math.min(cy + h, r.yMax) - Math.max(cy - h, r.yMin)
  return dx > 0 && dy > 0 ? Math.min(dx, dy) : 0
}

/**
 * Holes a Dupont housing cannot use because the T-board body is in the way. A housing whose
 * centre is outside the outline but whose edge leans on it (columns c and i beside a d/h
 * placement) is allowed when `edgeColumnsUsable` is set: on the bench it seats with a slight
 * lean (SPEC 6.3). The T-board's own pin holes are not listed; they are occupied.
 */
export function tboardBlockedHoles(def: BoardDef, tb: TboardDef, p: TboardPlacement): HoleRef[] {
  const outline = tboardOutline(def, tb, p)
  const own = new Set(tboardPinHoles(p).map(holeKey))
  const allowance = tb.edgeColumnsUsable ? tb.dupontHousingMm / 2 : 0
  return boardHoles(def, p.board).filter((hole) => {
    if (own.has(holeKey(hole))) return false
    const centre = holePosition(def, hole)
    return outline.some((r) => overlapDepth(centre, tb.dupontHousingMm, r) > allowance)
  })
}

/** Placement problems that do not depend on anything else on the board. */
export function tboardPlacementProblems(def: BoardDef, p: TboardPlacement): string[] {
  const problems: string[] = []
  if (!(p.colPair in PAIR_COLUMNS))
    problems.push(`Column pair ${p.colPair} is not one of b/f, c/g, d/h, e/i`)
  const rows = tboardPinHoles(p).map((h) => (h.area === 'main' ? h.row : 0))
  if (Math.min(...rows) < 1 || Math.max(...rows) > def.rows) {
    problems.push(
      `The T-board's 40 pins need rows ${Math.min(...rows)}–${Math.max(...rows)}, but the board has rows 1–${def.rows}`
    )
  }
  return problems
}
