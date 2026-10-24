// Shared fixtures for the cable solver's headless scenes (SPEC 19 "Physics tests"). Units are mm,
// g and s; z is up and the table top is z = 0. Each helper measures with code of its own, so a
// solver bug cannot hide in the measurement.
import dupont from '../content/leads/dupont.json'
import ribbonData from '../content/controllers/ribbon.json'
import { rng } from './math'
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
 * How high the housings of a hanging lead are, mm: they point down from there, so the lead's slack
 * hangs below them. A lead as stiff as a real one stands up out of a hole and arches over anything
 * lower than its arch (MATERIAL.leadEI), so the scenes that need a lead resting on something hang
 * it over that thing instead.
 */
export const HANG = 60

/**
 * Two hanging 200 mm leads (165 mm of wire), one across the other: the second hangs 30 mm higher at
 * first, clear of the first, and is lowered over 30 frames to where it would hang about 0.3 mm
 * lower than the first on its own, so it comes to rest on it. Between leads this stiff the contact
 * holds up to about 2 mm of bending between the two (the ADR on solving bending directly); this
 * scene stays well inside that.
 */
export function crossingPair(world: CableWorld) {
  const aEnds: [Pose, Pose] = [at(-30, 0, 110, FLIP), at(30, 0, 110, FLIP)]
  const bEnds = (z: number): [Pose, Pose] => [at(0, -18, z, FLIP), at(0, 18, z, FLIP)]
  const a = world.addLead({ a: aEnds[0], b: aEnds[1], wireMm: 165 })
  const [b0, b1] = bEnds(144)
  const b = world.addLead({ a: b0, b: b1, wireMm: 165 })
  world.settle(300)
  for (let f = 1; f <= 30; f++) {
    const [e0, e1] = bEnds(144 - f)
    world.setAnchor(b, 0, e0)
    world.setAnchor(b, 1, e1)
    world.step()
  }
  return { a, b, aEnds, bEnds: bEnds(114) }
}

/**
 * A lead of 102 mm hung from housings 60 mm apart, and a wall that rises out of the board under it
 * to its place (top 22.5 mm), lifting the lead about 10 mm above where it hangs on its own, so the
 * lead's weight rests on the wall. The wall rises over 30 frames: a lead started over it from a
 * guess falls to its own shape faster than the broad phase expects, and passes through.
 */
export function hangOver(world: CableWorld, wall: Box) {
  const lead = world.addLead({ a: at(-30, 0, HANG, FLIP), b: at(30, 0, HANG, FLIP), wireMm: 102 })
  world.settle(300)
  const rise = 2 * wall.h[2]
  const below = (t: number) => at(wall.c[0], wall.c[1], wall.c[2] - rise * (1 - t))
  const id = world.addCollider(boxShape(wall), below(0))
  for (let f = 1; f <= 30; f++) {
    world.setColliderPose(id, below(f / 30))
    world.step()
  }
  return { lead, wall: id }
}

/**
 * A ribbon between two sockets 185 mm apart at height z, facing each other, started sagging 34 mm
 * between them: a centreline about as long as its free span, which is near where a ribbon this
 * stiff comes to rest (it settles 0.2 mm lower). Started from the default arch it would stay arched
 * above whatever is under it.
 */
export function saggingRibbon(world: CableWorld, z: number, columns?: number) {
  const guess: Vec3[] = []
  for (let k = 0; k <= 16; k++) {
    guess.push([0, -87.5 + (175 * k) / 16, z - 33.6 * Math.sin((Math.PI * k) / 16) ** 2])
  }
  return world.addRibbon({ a: at(0, -92.5, z), b: at(0, 92.5, z, FLIP), guess, columns })
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

/** Deepest the ribbon's surface (its cells, sampled every ~0.5 mm) reaches into the box. */
export function sheetIntoBox(world: CableWorld, id: BodyId, box: Box): number {
  const { rows, columns } = world.info(id)
  const P = world.positions(id)
  const pt = (r: number, c: number): Vec3 => {
    const i = (r * columns + c) * 3
    return [P[i]!, P[i + 1]!, P[i + 2]!]
  }
  const N = 8
  let worst = -Infinity
  const tris = (r: number, c: number): Vec3[][] => [
    [pt(r, c), pt(r + 1, c), pt(r + 1, c + 1)],
    [pt(r, c), pt(r + 1, c + 1), pt(r, c + 1)]
  ]
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < columns; c++) {
      for (const [a, b, d] of tris(r, c)) {
        for (let i = 0; i <= N; i++) {
          for (let j = 0; i + j <= N; j++) {
            const u = i / N,
              v = j / N,
              t = 1 - u - v
            const q = [0, 1, 2].map((k) => t * a![k]! + u * b![k]! + v * d![k]!)
            worst = Math.max(worst, ribbonData.thicknessMm / 2 - sdBox(q, box))
          }
        }
      }
    }
  }
  return worst
}

/**
 * The dense pile: 40 leads across one breadboard, each between two holes of the 2.54 mm grid (no
 * two leads share a hole), whose runs cross and stack, plus the ribbon from the Pi's side. The
 * leads are 165 mm of wire (a 200 mm male-male lead) unless `wireMm` says otherwise. `seed`
 * picks the layout.
 */
export function densePile(seed: number, wireMm = 165, options: { substeps?: number } = {}) {
  const world = new CableWorld({ seed, ...options })
  for (const b of [TABLE, BOARD]) world.addCollider(boxShape(b), at(...b.c))
  const rand = rng(seed * 7919)
  const pitch = 2.54
  const used = new Set<string>()
  const hole = (x: number, y: number): [number, number] => {
    let gx = Math.round(x / pitch)
    const gy = Math.round(y / pitch)
    while (used.has(`${gx},${gy}`)) gx++
    used.add(`${gx},${gy}`)
    return [gx * pitch, gy * pitch]
  }
  const leads: BodyId[] = []
  const ends: [Pose, Pose][] = []
  for (let k = 0; k < 40; k++) {
    const row = -70 + (k % 20) * 7
    const [ax, ay] = hole(row, -20 + (k < 20 ? 0 : 40) + (rand() - 0.5) * pitch)
    const tx = row + (3 + rand() * 12) * pitch
    const ty = -20 + (k < 20 ? 8 : 28) * (1 + rand() * 0.2)
    const [bx, by] = hole(tx, ty)
    const a = at(ax, ay, BOARD_TOP)
    const b = at(bx, by, BOARD_TOP)
    ends.push([a, b])
    leads.push(world.addLead({ a, b, wireMm }))
  }
  const socket = at(-100, 0, 22, FLIP)
  const ribbon = world.addRibbon({ a: at(-150, -10, 14), b: socket })
  return { world, leads, ends, ribbon, socket, bodies: [...leads, ribbon] }
}
