// Shared fixtures for the cable solver's headless scenes (SPEC 19 "Physics tests"). Units are mm,
// g and s; z is up and the table top is z = 0. Each helper measures with code of its own, so a
// solver bug cannot hide in the measurement.
import dupont from '../content/leads/dupont.json'
import ribbonData from '../content/controllers/ribbon.json'
import { closestPointTriangle, closestSegSeg } from './shapes'
import type { BodyId, Pose, Quat, Vec3 } from './types'
import { CableWorld } from './world'

export const UP: Quat = [0, 0, 0, 1]
/** 180 degrees about x: the far socket of a ribbon looping back toward the near one. */
export const FLIP: Quat = [1, 0, 0, 0]
export const yaw = (angle: number): Quat => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)]
export const at = (x: number, y: number, z: number, rotation: Quat = UP): Pose => ({
  position: [x, y, z],
  rotation
})

export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q
  const [vx, vy, vz] = v
  const tx = 2 * (y * vz - z * vy),
    ty = 2 * (z * vx - x * vz),
    tz = 2 * (x * vy - y * vx)
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx)
  ]
}
export const place = (p: Pose, local: Vec3): Vec3 => {
  const r = rotate(p.rotation, local)
  return [p.position[0] + r[0], p.position[1] + r[1], p.position[2] + r[2]]
}
export const dist = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

export function run(world: CableWorld, frames: number) {
  for (let f = 0; f < frames; f++) world.step()
}

/** The wire particles of a rod, as points. */
export function wire(world: CableWorld, id: BodyId): Vec3[] {
  const p = world.positions(id)
  const { wireStart, wireEnd } = world.info(id)
  const out: Vec3[] = []
  for (let i = wireStart; i < wireEnd; i++) out.push([p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!])
  return out
}

export const pathLength = (pts: Vec3[]) => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]!), 0)

export interface Box {
  c: Vec3
  h: Vec3
}
export const boxShape = (b: Box) => ({ kind: 'box' as const, halfExtents: b.h })

/** Signed distance from a point to an axis-aligned box: negative inside. */
export function sdBox(p: ArrayLike<number>, b: Box): number {
  const q = [0, 1, 2].map((a) => Math.abs(p[a]! - b.c[a]!) - b.h[a]!)
  const out = Math.hypot(...q.map((v) => Math.max(v, 0)))
  return out + Math.min(Math.max(q[0]!, q[1]!, q[2]!), 0)
}

/** Deepest the cable's surface reaches into the box, sampling every 0.6 mm along the wire. */
export function depthIntoBox(pts: ArrayLike<number>[], radius: number, b: Box): number {
  let depth = -Infinity
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const n = i + 1 < pts.length ? 5 : 1
    for (let s = 0; s < n; s++) {
      const t = s / 5
      const e = pts[Math.min(i + 1, pts.length - 1)]!
      const p = [0, 1, 2].map((k) => a[k]! + (e[k]! - a[k]!) * t)
      depth = Math.max(depth, radius - sdBox(p, b))
    }
  }
  return depth
}

/**
 * Two leads lying on the board, one across the other: both start from design curves that run low
 * along the board, and the second crosses the first, so it rests on it there.
 */
export function crossingPair(world: CableWorld) {
  const top = BOARD_TOP + HOUSING
  const floor = BOARD_TOP + WIRE_R
  const a = world.addLead({
    a: at(-30, 0, BOARD_TOP),
    b: at(30, 0, BOARD_TOP),
    lengthMm: 72,
    guess: [
      [-30, 0, top],
      [-22, 0, floor],
      [22, 0, floor],
      [30, 0, top]
    ]
  })
  const b = world.addLead({
    a: at(0, -18, BOARD_TOP),
    b: at(0, 18, BOARD_TOP),
    lengthMm: 50,
    guess: [
      [0, -18, top],
      [0, -12, floor],
      [0, -1.5, floor + 2 * WIRE_R],
      [0, 1.5, floor + 2 * WIRE_R],
      [0, 12, floor],
      [0, 18, top]
    ]
  })
  return { a, b }
}

export const TABLE: Box = { c: [0, 0, -10], h: [600, 600, 10] }
export const BOARD: Box = { c: [0, 0, 4.25], h: [82.5, 27.3, 4.25] }
export const BOARD_TOP = 8.5

export function newWorld(...boxes: Box[]) {
  const world = new CableWorld()
  for (const b of boxes) world.addCollider(boxShape(b), at(...b.c))
  return world
}

export const WIRE_R = dupont.wire.outerDiameterMm / 2
export const HOUSING = dupont.housing.lengthMm

/** Deepest overlap of two cables' surfaces: how far inside each other the wires reach. */
export function cableOverlap(a: Vec3[], ra: number, b: Vec3[], rb: number): number {
  const s = new Float64Array(2)
  let worst = -Infinity
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      const p = a[i]!,
        q = a[i + 1]!,
        r = b[j]!,
        t = b[j + 1]!
      const d2 = closestSegSeg(...p, ...q, ...r, ...t, s)
      worst = Math.max(worst, ra + rb - Math.sqrt(d2))
    }
  }
  return worst
}

/** Deepest a rod reaches into the ribbon sheet (half its thickness plus the rod's radius). */
export function rodIntoRibbon(world: CableWorld, rod: BodyId, ribbon: BodyId): number {
  const pts = wire(world, rod)
  const P = world.positions(ribbon)
  const { rows, columns } = world.info(ribbon)
  const reach = WIRE_R + ribbonData.thicknessMm / 2
  const s = new Float64Array(3)
  const v = (rr: number, cc: number): Vec3 => {
    const i = (rr * columns + cc) * 3
    return [P[i]!, P[i + 1]!, P[i + 2]!]
  }
  let worst = -Infinity
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < columns; c++) {
      const tris = [
        [v(r, c), v(r + 1, c), v(r + 1, c + 1)],
        [v(r, c), v(r + 1, c + 1), v(r, c + 1)]
      ] as const
      for (const [a, b, d] of tris) {
        for (let i = 0; i + 1 < pts.length; i++) {
          for (let k = 0; k <= 4; k++) {
            const t = k / 4
            const q = [0, 1, 2].map((x) => pts[i]![x]! + (pts[i + 1]![x]! - pts[i]![x]!) * t)
            const d2 = closestPointTriangle(q[0]!, q[1]!, q[2]!, ...a, ...b, ...d, s)
            worst = Math.max(worst, reach - Math.sqrt(d2))
          }
        }
      }
    }
  }
  return worst
}
