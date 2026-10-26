// Whether each lead and the ribbon can reach between their ends (SPEC 8 LEAD_TOO_SHORT, 10.5).
// Computed from geometry, not physics. Positions are in the table frame: mm, z up from the table.
import dupontJson from '../../content/leads/dupont.json'
import piBoardJson from '../../content/controllers/pi5-board.json'
import ribbonJson from '../../content/controllers/ribbon.json'
import { boardDef } from '../defs/boards'
import { TBOARD } from '../defs/controllers'
import { holePosition } from '../geometry/breadboard'
import { tboardToBoard } from '../geometry/tboard'
import type { CircuitDoc, Endpoint, Transform2D, Vec2, Vec3, Wire } from '../model/types'
import { docPartDefs, type PartDefs } from '../netlist/netlist'

/** Heights above the table that the photos and drawings don't give; used only for reach. */
export const ASSUMED_HEIGHTS_MM = {
  /** T-board header top: board top + yellow pin spacer (2.5) + PCB (1.6) + box header (11.2). */
  tboardSocketAboveBoard: 2.5 + 1.6 + 11.2,
  /** Off-board module pins rest about 10 mm above the table. */
  modulePin: 10
}

/** The Pi's header pin tips above the table, from the official STEP resting on its lowest point
 * (ADR-0020; measured when pi5.glb is built). */
export const PI_PIN_TIPS_ABOVE_TABLE_MM = 11.326

export function toTable(t: Transform2D, [x, y]: Vec2): Vec2 {
  const r = (t.rotationDeg * Math.PI) / 180
  return [
    t.position[0] + x * Math.cos(r) - y * Math.sin(r),
    t.position[1] + x * Math.sin(r) + y * Math.cos(r)
  ]
}

/**
 * Whether two convex outlines (table frame, corners in order around) share any of the table: no
 * edge of either separates them. A point, or two, is an outline too.
 */
function overlap(a: Vec2[], b: Vec2[]): boolean {
  for (const outline of [a, b])
    for (let i = 0; i < outline.length; i++) {
      const [x0, y0] = outline[i]!
      const [x1, y1] = outline[(i + 1) % outline.length]!
      const [ax, ay] = [y0 - y1, x1 - x0]
      if (!ax && !ay) continue
      const along = (o: Vec2[]) => o.map(([x, y]) => x * ax + y * ay)
      const [sa, sb] = [along(a), along(b)]
      if (Math.max(...sa) < Math.min(...sb) || Math.max(...sb) < Math.min(...sa)) return false
    }
  return true
}

/**
 * What an off-board module laid with its footprint at `points` (its corners in order, table
 * frame) rests on: the top of the highest board the footprint overlaps, else the table (0).
 */
export function restHeightMm(doc: CircuitDoc, points: Vec2[]): number {
  let top = 0
  for (const board of doc.boards) {
    const { lengthMm, widthMm, heightMm } = boardDef(board.defId).body
    const corners: Vec2[] = [
      [0, 0],
      [lengthMm, 0],
      [lengthMm, widthMm],
      [0, widthMm]
    ]
    if (
      overlap(
        points,
        corners.map((c) => toTable(board.transform, c))
      )
    )
      top = Math.max(top, heightMm)
  }
  return top
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Where the wire leaves the housing at one end, or null if the end has no position yet. */
export function exitPoint(doc: CircuitDoc, defs: PartDefs, end: Endpoint): Vec3 | null {
  const lift = dupontJson.housing.lengthMm
  if ('hole' in end) {
    const board = doc.boards.find((b) => b.id === end.hole.board)
    if (!board) return null
    const def = boardDef(board.defId)
    const [x, y] = toTable(board.transform, holePosition(def, end.hole))
    return [x, y, def.body.heightMm + lift]
  }
  const part = doc.parts.find((p) => p.id === end.pin.part)
  const pin = part && docPartDefs(doc, defs)(part.defId).pins.find((p) => p.id === end.pin.pin)
  const pose = part?.placement.offboardPose
  if (!pose || !pin) return null
  const [x, y] = toTable(pose, [pin.offsetPitch[0] * 2.54, pin.offsetPitch[1] * 2.54])
  return [x, y, restHeightMm(doc, [pose.position]) + ASSUMED_HEIGHTS_MM.modulePin + lift]
}

export interface LeadReach {
  wire: string
  /** Length needed: between the exit points, plus a minimum bend at each end. */
  requiredMm: number
  /** The lead's length, with 'auto' resolved to the shortest inventory length that reaches. */
  lengthMm: number
  /** The wire between its two housings' exits (`wireLengthMm`). */
  wireMm: number
  ok: boolean
}

/**
 * The wire between a lead's two housing exits. A Dupont lead's length is sold tip to tip
 * (photo 4's 200 mm callout spans the outermost pin tips), so each housing and each exposed
 * male pin comes off it. A solid jumper is all wire.
 */
export function wireLengthMm(lengthMm: number, kind: Wire['kind']): number {
  if (kind === 'solid-arc' || kind === 'solid-flat') return lengthMm
  const males = kind === 'dupont-mm' ? 2 : kind === 'dupont-mf' ? 1 : 0
  return lengthMm - 2 * dupontJson.housing.lengthMm - males * dupontJson.malePin.exposedMm
}

/** Shortest inventory length with at least 10% slack, else the longest available. */
export function autoLength(requiredMm: number, kind: Wire['kind']): number {
  if (kind === 'solid-arc' || kind === 'solid-flat') return Math.ceil(requiredMm)
  const lengths = [...dupontJson.inventoryLengthsMm].sort((a, b) => a - b)
  return lengths.find((l) => wireLengthMm(l, kind) >= requiredMm * 1.1) ?? lengths.at(-1)!
}

export function leadReach(doc: CircuitDoc, defs: PartDefs): LeadReach[] {
  const bend = 2 * dupontJson.minBendRadiusMm
  const out: LeadReach[] = []
  for (const wire of doc.wires) {
    const a = exitPoint(doc, defs, wire.a)
    const b = exitPoint(doc, defs, wire.b)
    if (!a || !b) continue
    const requiredMm = dist(a, b) + bend
    const lengthMm = wire.lengthMm === 'auto' ? autoLength(requiredMm, wire.kind) : wire.lengthMm
    const wireMm = wireLengthMm(lengthMm, wire.kind)
    out.push({ wire: wire.id, requiredMm, lengthMm, wireMm, ok: requiredMm <= wireMm })
  }
  return out
}

/** The two socket positions the ribbon joins, in the table frame. */
export function ribbonEnds(doc: CircuitDoc): { pi: Vec3; tboard: Vec3 } | null {
  const tb = doc.controller.tboard
  const board = doc.boards.find((b) => b.id === tb.board)
  if (!board) return null
  const def = boardDef(board.defId)
  const header = tboardToBoard(def, tb, [TBOARD.header.centerXMm, TBOARD.header.centerYMm])
  const [tx, ty] = toTable(board.transform, header)
  const [px, py] = toTable(
    doc.controller.pi.transform,
    piBoardJson.header.centerMm as unknown as Vec2
  )
  return {
    pi: [px, py, PI_PIN_TIPS_ABOVE_TABLE_MM],
    tboard: [tx, ty, def.body.heightMm + ASSUMED_HEIGHTS_MM.tboardSocketAboveBoard]
  }
}

export function ribbonReach(
  doc: CircuitDoc
): { requiredMm: number; lengthMm: number; ok: boolean } | null {
  const ends = ribbonEnds(doc)
  if (!ends) return null
  const requiredMm = dist(ends.pi, ends.tboard) + 2 * ribbonJson.clampedEndMm
  const lengthMm = doc.controller.ribbon.lengthMm
  return { requiredMm, lengthMm, ok: requiredMm <= lengthMm }
}
