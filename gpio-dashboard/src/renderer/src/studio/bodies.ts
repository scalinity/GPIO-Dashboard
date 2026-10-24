// Selection boxes and picking volumes (SPEC 10.7): a part's box from its definition's bodyMm and
// its pins, a board's body, the T-board's outline and the Pi's. Each is a transform of the unit
// cube centred at the origin, so the same matrix draws the accent box and picks by bounding volume.
import piBoardJson from '../content/controllers/pi5-board.json'
import { Box3, Matrix4, Quaternion, type Ray, Vector3 } from 'three/webgpu'
import { boardDef } from '../core/defs/boards'
import { TBOARD, type Rect } from '../core/defs/controllers'
import { partDef } from '../core/defs/parts'
import { holePosition } from '../core/geometry/breadboard'
import { tboardOutline } from '../core/geometry/tboard'
import type { CircuitDoc, PartInstance, Transform2D, Vec2 } from '../core/model/types'
import { ASSUMED_HEIGHTS_MM, toTable } from '../core/reach/reach'
import type { Selection } from '../state/studioStore'
import { PI_HEIGHT_MM } from './camera'
import { toThree } from './coords'

const PITCH_MM = 2.54
const up = new Vector3(0, 1, 0)
const unit = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5))

/** A rectangle of a local frame on the table, from height z0 to z1, as a box. */
function box(t: Transform2D, r: Rect, z0: number, z1: number): Matrix4 {
  const centre = toTable(t, [(r.xMin + r.xMax) / 2, (r.yMin + r.yMax) / 2])
  return new Matrix4().compose(
    toThree(centre, (z0 + z1) / 2),
    new Quaternion().setFromAxisAngle(up, (t.rotationDeg * Math.PI) / 180),
    new Vector3(r.xMax - r.xMin, z1 - z0, r.yMax - r.yMin)
  )
}

/**
 * A part's box: its body (bodyMm, along its leads or its rows) centred on its pins, grown to take
 * in every pin. On a board it stands on the board; an off-board module stands on the table.
 */
function partBox(doc: CircuitDoc, part: PartInstance): Matrix4 | null {
  const def = partDef(part.defId)
  const pose = part.placement.offboardPose
  let frame: Transform2D
  let points: Vec2[]
  let z0: number
  let u: Vec2 = [1, 0]
  if (pose) {
    frame = pose
    points = def.pins.map((p) => [p.offsetPitch[0] * PITCH_MM, p.offsetPitch[1] * PITCH_MM])
    z0 = 0
  } else {
    const holes = def.pins.map((p) => part.placement.pins[p.id])
    const board = doc.boards.find((b) => b.id === holes[0]?.board)
    if (!board || holes.some((h) => !h || h.board !== board.id)) return null
    const bb = boardDef(board.defId)
    frame = board.transform
    points = holes.map((h) => holePosition(bb, h!))
    z0 = bb.body.heightMm
    if (def.footprint.kind === 'flex-2lead') {
      const [a, b] = points as [Vec2, Vec2]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
    } else if (part.placement.rotationDeg === 90 || part.placement.rotationDeg === 270) u = [0, 1]
  }
  const along = points.map(([x, y]) => x * u[0] + y * u[1])
  const across = points.map(([x, y]) => -x * u[1] + y * u[0])
  const mid = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2
  const size = (v: number[], body: number) =>
    Math.max(body, Math.max(...v) - Math.min(...v) + PITCH_MM)
  const [ca, cb] = [mid(along), mid(across)]
  const centre: Vec2 = [ca * u[0] - cb * u[1], ca * u[1] + cb * u[0]]
  const [l, w] = [size(along, def.bodyMm[0]), size(across, def.bodyMm[1])]
  const turnDeg = (Math.atan2(u[1], u[0]) * 180) / Math.PI
  const local: Transform2D = {
    position: toTable(frame, centre),
    rotationDeg: frame.rotationDeg + turnDeg
  }
  const height = pose ? Math.max(def.bodyMm[2], ASSUMED_HEIGHTS_MM.modulePin) : def.bodyMm[2]
  return box(local, { xMin: -l / 2, xMax: l / 2, yMin: -w / 2, yMax: w / 2 }, z0, z0 + height)
}

/** The box of whatever is selected, or null when it has none (a lead's comes from its curve). */
export function bodyBox(doc: CircuitDoc, sel: Selection): Matrix4 | null {
  switch (sel.kind) {
    case 'part': {
      const part = doc.parts.find((p) => p.id === sel.id)
      return part ? partBox(doc, part) : null
    }
    case 'board': {
      const board = doc.boards.find((b) => b.id === sel.id)
      if (!board) return null
      const { lengthMm, widthMm, heightMm } = boardDef(board.defId).body
      return box(board.transform, { xMin: 0, xMax: lengthMm, yMin: 0, yMax: widthMm }, 0, heightMm)
    }
    case 'tboard': {
      const tb = doc.controller.tboard
      const board = doc.boards.find((b) => b.id === tb.board)
      if (!board) return null
      const def = boardDef(board.defId)
      const rects = tboardOutline(def, TBOARD, tb)
      const r = {
        xMin: Math.min(...rects.map((q) => q.xMin)),
        xMax: Math.max(...rects.map((q) => q.xMax)),
        yMin: Math.min(...rects.map((q) => q.yMin)),
        yMax: Math.max(...rects.map((q) => q.yMax))
      }
      const top = def.body.heightMm
      return box(board.transform, r, top, top + ASSUMED_HEIGHTS_MM.tboardSocketAboveBoard)
    }
    case 'pi': {
      const { widthMm, depthMm } = piBoardJson.outline
      const r = { xMin: 0, xMax: widthMm, yMin: 0, yMax: depthMm }
      return box(doc.controller.pi.transform, r, 0, PI_HEIGHT_MM)
    }
    case 'wire':
      return null
  }
}

/** The box around a polyline. */
export function pointsBox(points: Vector3[]): Matrix4 {
  const b = new Box3().setFromPoints(points)
  const size = b.getSize(new Vector3()).addScalar(2)
  return new Matrix4().compose(b.getCenter(new Vector3()), new Quaternion(), size)
}

/** Everything a ray can pick by its box: parts and modules, the T-board, the Pi and boards. */
function bodies(doc: CircuitDoc): Selection[] {
  return [
    ...doc.parts.map((p): Selection => ({ kind: 'part', id: p.id })),
    { kind: 'tboard' },
    { kind: 'pi' },
    ...doc.boards.map((b): Selection => ({ kind: 'board', id: b.id }))
  ]
}

/** The nearest box the ray enters, with the distance to it. */
export function pickBody(doc: CircuitDoc, ray: Ray): { sel: Selection; distance: number } | null {
  let best: { sel: Selection; distance: number } | null = null
  const local = ray.clone()
  const hit = new Vector3()
  for (const sel of bodies(doc)) {
    const m = bodyBox(doc, sel)
    if (!m) continue
    local.copy(ray).applyMatrix4(m.clone().invert())
    if (!local.intersectBox(unit, hit)) continue
    const distance = hit.applyMatrix4(m).distanceTo(ray.origin)
    if (!best || distance < best.distance) best = { sel, distance }
  }
  return best
}
