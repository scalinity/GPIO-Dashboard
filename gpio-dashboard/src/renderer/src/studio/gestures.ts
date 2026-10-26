// What each Studio gesture proposes for the pointer's current place (SPEC 11.3): placing from the
// library, moving a part, a flexible part's leg, a lead end, a module, a board, the Pi or the
// T-board, a lead's route hint, and the wire tool's second click. The view checks each proposal with
// circuitStore.check() for the green/red glow and commits it on release.
import { Plane, type Ray, Vector3 } from 'three/webgpu'
import { boardDef } from '../core/defs/boards'
import { defOf, moduleLiftMm, moduleRestMm } from './coords'
import { holePosition, isValidHole } from '../core/geometry/breadboard'
import { tboardPinHoles } from '../core/geometry/tboard'
import type {
  CircuitDoc,
  Endpoint,
  HoleRef,
  Op,
  TboardPlacement,
  Transform2D,
  Vec2
} from '../core/model/types'
import { COL_PAIRS, MAIN_COLUMNS } from '../core/model/types'
import type { Selection } from '../state/studioStore'
import {
  movedPart,
  newPart,
  newWire,
  pointFrom,
  type Rotation,
  seat,
  seated,
  snapAnchor
} from './placement'

export type ModulePin = { part: string; pin: string }

export interface Pointer {
  ray: Ray
  /** The hole under the pointer, on any board. */
  hole: HoleRef | null
  /** An off-board module's connector pin under the pointer. */
  pin: ModulePin | null
}

export type Gesture =
  | { kind: 'place'; defId: string; rotation: Rotation }
  /** `grab`: from the hole first under the pointer to the part's pin 1, in mm. */
  | { kind: 'part'; id: string; grab: Vec2 }
  | { kind: 'leg'; id: string; pin: string }
  | { kind: 'end'; id: string; end: 'a' | 'b' }
  /** `from`: where the pointer met the table (or the board's top) when the drag began. */
  | { kind: 'module'; id: string; from: Vec2; pose: Transform2D }
  | { kind: 'board'; id: string; from: Vec2; transform: Transform2D }
  | { kind: 'pi'; from: Vec2; transform: Transform2D }
  | { kind: 'tboard'; from: HoleRef; placement: TboardPlacement }
  /** Route hint `index` of a lead (a new one when it has that many), across a plane in the scene. */
  | {
      kind: 'route'
      id: string
      index: number
      normal: [number, number, number]
      constant: number
    }
  | { kind: 'wire'; from: Endpoint }

export interface Proposal {
  label: string
  ops: Op[]
  /** Holes the edit puts a lead in, to glow green or red. */
  holes: HoleRef[]
  /** Module pins the edit puts a lead on. */
  pins: ModulePin[]
  /** What to select once it is committed. */
  select: Selection
  /** Set when the gesture itself cannot be completed here (a footprint off the board). */
  refused?: string
}

const plane = new Plane(new Vector3(0, 1, 0), 0)
const routePlane = new Plane()
const hit = new Vector3()

/** Where the ray meets the horizontal plane at `height` mm, in the table frame. */
export function planePoint(ray: Ray, height: number): Vec2 | null {
  plane.constant = -height
  if (!ray.intersectPlane(plane, hit)) return null
  return [hit.x, -hit.z]
}

const round = (v: number) => Math.round(v * 10) / 10

/**
 * Where the pointer lays an off-board module: `pose(at)` for the point under the pointer at a
 * height the module rests at. Each surface is tried from the highest down and the first whose pose
 * rests the module on it is taken, so the module stays under the pointer, and under a still one.
 * Where none does (a footprint across a board's edge, within the parallax), the table's is taken.
 */
function laid(
  doc: CircuitDoc,
  defId: string,
  ray: Ray,
  pose: (at: Vec2) => Transform2D
): Transform2D | null {
  const lift = moduleLiftMm(defId)
  const tops = new Set([0, ...doc.boards.map((b) => boardDef(b.defId).body.heightMm)])
  let last: Transform2D | null = null
  for (const top of [...tops].sort((a, b) => b - a)) {
    const at = planePoint(ray, top + lift)
    if (!at) continue
    last = pose(at)
    if (moduleRestMm(doc, defId, last) === top + lift) return last
  }
  return last
}
const moved = (t: Transform2D, from: Vec2, to: Vec2): Transform2D => ({
  ...t,
  position: [round(t.position[0] + to[0] - from[0]), round(t.position[1] + to[1] - from[1])]
})

/** Where a board's or the Pi's drag proposal puts it; null for any other proposal. */
export function placedAt(p: Proposal): Transform2D | null {
  const op = p.ops[0]
  if (op?.type === 'MoveBoard') return op.transform
  if (op?.type === 'SetControllerPlacement') return op.controller.pi.transform
  return null
}

/**
 * A board's or the Pi's drag proposal brought back to `t` of the way from `from` to where it puts
 * it (0 to 1), to find where it meets what it may not overlap. Any other proposal is unchanged.
 */
export function partway(from: Transform2D, p: Proposal, t: number): Proposal {
  const to = placedAt(p)
  const op = p.ops[0]
  if (!to || !op) return p
  const transform: Transform2D = {
    ...to,
    position: [
      round(from.position[0] + (to.position[0] - from.position[0]) * t),
      round(from.position[1] + (to.position[1] - from.position[1]) * t)
    ]
  }
  if (op.type === 'MoveBoard') return { ...p, ops: [{ ...op, transform }] }
  if (op.type === 'SetControllerPlacement')
    return { ...p, ops: [{ ...op, controller: { ...op.controller, pi: { transform } } }] }
  return p
}

/** The height of a board's top, where its drags are measured. */
export function boardTop(doc: CircuitDoc, id: string): number {
  const board = doc.boards.find((b) => b.id === id)
  return board ? boardDef(board.defId).body.heightMm : 0
}

export function propose(g: Gesture, p: Pointer, doc: CircuitDoc): Proposal | null {
  switch (g.kind) {
    case 'place': {
      const def = defOf(doc, g.defId)
      if (def.footprint.kind === 'offboard') {
        const pose = laid(doc, g.defId, p.ray, (at) => ({
          position: [round(at[0]), round(at[1])],
          rotationDeg: g.rotation
        }))
        if (!pose) return null
        const part = newPart(doc, g.defId, { pose })
        const pins = def.pins.map((pin) => ({ part: part.id, pin: pin.id }))
        const select = { kind: 'part', id: part.id } as const
        return {
          label: `Place ${part.id}`,
          ops: [{ type: 'AddPart', part }],
          holes: [],
          pins,
          select
        }
      }
      if (!p.hole) return null
      // A rigid part snaps to the nearest hole it fits from; a flexible one seats where it points.
      const anchor =
        (def.footprint.kind === 'rigid' &&
          snapAnchor(doc, g.defId, g.rotation, p.hole.board, pointFrom(doc, p.hole))) ||
        p.hole
      const part = newPart(doc, g.defId, { anchor, rotation: g.rotation })
      return {
        label: `Place ${part.id}`,
        ops: [{ type: 'AddPart', part }],
        holes: Object.values(part.placement.pins).filter((h): h is HoleRef => h !== null),
        pins: [],
        select: { kind: 'part', id: part.id },
        ...(seated(part.placement.pins) ? {} : { refused: `${def.name} does not fit here` })
      }
    }
    case 'part': {
      const part = doc.parts.find((x) => x.id === g.id)
      if (!part || !p.hole) return null
      const rotation = part.placement.rotationDeg ?? 0
      const anchor =
        defOf(doc, part.defId).footprint.kind === 'rigid'
          ? snapAnchor(doc, part.defId, rotation, p.hole.board, pointFrom(doc, p.hole, g.grab))
          : seat(doc, p.hole, { pin1: g.grab }).pin1
      const next = anchor ? movedPart(doc, part, anchor) : part
      return {
        label: `Move ${part.id}`,
        ops: [{ type: 'MovePart', id: part.id, placement: next.placement }],
        holes: Object.values(next.placement.pins).filter((h): h is HoleRef => h !== null),
        pins: [],
        select: { kind: 'part', id: part.id },
        ...(anchor && seated(next.placement.pins)
          ? {}
          : { refused: `${part.id} does not fit here` })
      }
    }
    case 'leg': {
      const part = doc.parts.find((x) => x.id === g.id)
      if (!part || !p.hole) return null
      const placement = { ...part.placement, pins: { ...part.placement.pins, [g.pin]: p.hole } }
      return {
        label: `Move ${part.id}'s ${defOf(doc, part.defId).pins.find((x) => x.id === g.pin)?.label}`,
        ops: [{ type: 'MovePart', id: part.id, placement }],
        holes: [p.hole],
        pins: [],
        select: { kind: 'part', id: part.id }
      }
    }
    case 'end': {
      const to: Endpoint | null = p.pin ? { pin: p.pin } : p.hole ? { hole: p.hole } : null
      if (!to) return null
      return {
        label: `Move ${g.id}'s end`,
        ops: [{ type: 'MoveWireEnd', id: g.id, end: g.end, to }],
        holes: 'hole' in to ? [to.hole] : [],
        pins: 'pin' in to ? [to.pin] : [],
        select: { kind: 'wire', id: g.id }
      }
    }
    case 'module': {
      const part = doc.parts.find((x) => x.id === g.id)
      const pose = part && laid(doc, part.defId, p.ray, (at) => moved(g.pose, g.from, at))
      if (!part || !pose) return null
      const placement = { ...part.placement, offboardPose: pose }
      return {
        label: `Move ${part.id}`,
        ops: [{ type: 'MovePart', id: part.id, placement }],
        holes: [],
        pins: [],
        select: { kind: 'part', id: part.id }
      }
    }
    case 'board': {
      const at = planePoint(p.ray, boardTop(doc, g.id))
      if (!at) return null
      return {
        label: `Move ${g.id}`,
        ops: [{ type: 'MoveBoard', id: g.id, transform: moved(g.transform, g.from, at) }],
        holes: [],
        pins: [],
        select: { kind: 'board', id: g.id }
      }
    }
    case 'pi': {
      const at = planePoint(p.ray, 0)
      if (!at) return null
      const pi = { transform: moved(g.transform, g.from, at) }
      return {
        label: 'Move the Pi',
        ops: [{ type: 'SetControllerPlacement', controller: { ...doc.controller, pi } }],
        holes: [],
        pins: [],
        select: { kind: 'pi' }
      }
    }
    case 'tboard': {
      if (!p.hole || p.hole.area !== 'main' || g.from.area !== 'main') return null
      // One column across moves the pin rows to the next pair (b/f, c/g, d/h, e/i).
      const pair =
        COL_PAIRS.indexOf(g.placement.colPair) +
        MAIN_COLUMNS.indexOf(p.hole.col) -
        MAIN_COLUMNS.indexOf(g.from.col)
      const tboard: TboardPlacement = {
        ...g.placement,
        board: p.hole.board,
        pin1Row: g.placement.pin1Row + p.hole.row - g.from.row,
        colPair: COL_PAIRS[Math.min(Math.max(pair, 0), COL_PAIRS.length - 1)]!
      }
      const board = doc.boards.find((b) => b.id === tboard.board)!
      const def = boardDef(board.defId)
      return {
        label: 'Move the T-board',
        ops: [{ type: 'SetControllerPlacement', controller: { ...doc.controller, tboard } }],
        holes: tboardPinHoles(tboard).filter((h) => isValidHole(def, h)),
        pins: [],
        select: { kind: 'tboard' },
        ...(pair >= 0 && pair < COL_PAIRS.length
          ? {}
          : { refused: 'The T-board takes columns b/f, c/g, d/h or e/i' })
      }
    }
    case 'route': {
      // The hint is stored in the table frame (core, z up), as the solver reads it.
      const wire = doc.wires.find((w) => w.id === g.id)
      routePlane.normal.set(...g.normal)
      routePlane.constant = g.constant
      if (!wire || !p.ray.intersectPlane(routePlane, hit)) return null
      const routeHints = [...(wire.routeHints ?? [])]
      routeHints[g.index] = [round(hit.x), round(-hit.z), round(hit.y)]
      return {
        label: `Route ${wire.id}`,
        ops: [{ type: 'SetWireProps', id: wire.id, props: { routeHints } }],
        holes: [],
        pins: [],
        select: { kind: 'wire', id: wire.id }
      }
    }
    case 'wire': {
      const to: Endpoint | null = p.pin ? { pin: p.pin } : p.hole ? { hole: p.hole } : null
      if (!to || JSON.stringify(to) === JSON.stringify(g.from)) return null
      const wire = newWire(doc, g.from, to)
      return {
        label: `Wire ${wire.id}`,
        ops: [{ type: 'AddWire', wire }],
        holes: [g.from, to].flatMap((e) => ('hole' in e ? [e.hole] : [])),
        pins: [g.from, to].flatMap((e) => ('pin' in e ? [e.pin] : [])),
        select: { kind: 'wire', id: wire.id }
      }
    }
  }
}

/** The mm from a hole to a placed part's pin 1, in the board's frame. */
export function grabVector(doc: CircuitDoc, from: HoleRef | null, pin1: HoleRef): Vec2 {
  if (!from || from.board !== pin1.board) return [0, 0]
  const board = doc.boards.find((b) => b.id === pin1.board)!
  const def = boardDef(board.defId)
  const [a, b] = [holePosition(def, from), holePosition(def, pin1)]
  return [b[0] - a[0], b[1] - a[1]]
}
