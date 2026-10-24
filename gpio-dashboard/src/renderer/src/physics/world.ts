// The cable world (SPEC 10.5): an XPBD solver with small steps (Macklin et al., SCA 2019). A
// frame is split into substeps; each substep predicts positions, projects every constraint and
// contact once, and recovers velocities from the position change. Everything runs in a fixed
// order from seeded inputs, so the same calls in the same runtime give the same positions.
import type { Body, Spec } from './body'
import { buildJumper, buildLead, buildRibbon } from './builders'
import {
  factorBending,
  solveBending,
  solveChain,
  solveGoals,
  solveLongRange,
  straighten
} from './constraints'
import {
  gapParticleCollider,
  gapPointTriangle,
  gapSegmentCollider,
  solveRibbonPairs,
  solveRodPairs,
  solveSurfaces
} from './contacts'
import type { Collider, Pool } from './contacts'
import { SpatialHash } from './hash'
import { solveStrips } from './strips'
import { closestSegSeg } from './shapes'
import { gatherRows, layRows } from './ribbon'
import { normalizeQuat, posedAt, quatToMat, rng, samePose, toWorld } from './math'
import type {
  BodyId,
  BodyInfo,
  ColliderId,
  ColliderShape,
  JumperDef,
  LeadDef,
  Pose,
  RibbonDef,
  Vec3,
  WorldOptions
} from './types'

/** Frame length, s, and gravity along -z, mm/s^2 (SPEC 10.5). */
export const FRAME_DT = 1 / 60
export const GRAVITY = 9810
export const DEFAULT_SUBSTEPS = 12
/** How far a particle at rest falls in one frame, mm. */
const FALL = 0.5 * GRAVITY * FRAME_DT * FRAME_DT

/** Broad-phase padding beyond the contact reach, mm. */
const SKIN = 0.75
const HASH_CELL = 8
/**
 * Two cables are kept this far (mm) apart beyond their radii. A pile's last contacts are solved
 * against a board, not each other, and leave the wires on top overlapping by a few tenths of a mm;
 * this takes that off the overlap measured against the true radii, and is too little to see.
 */
const CABLE_GAP = 0.06
/** Linear velocity damping, 1/s: cable internal friction and air drag. */
const DAMPING = 2
/** A body that has slowed below SLOW_SPEED (mm/s) is damped harder, so it comes to rest. */
const SLOW_DAMPING = 60
const SLOW_SPEED = 40
const MAX_SPEED = 3000
/** Longest a particle's broad-phase box is stretched along its motion in one frame, mm. */
const MAX_SWEEP = 30
/** An island sleeps when every particle stays below this speed (mm/s) for this many frames. */
const SLEEP_SPEED = 0.5
const SLEEP_FRAMES = 30
/** An awake body that is expected to travel less than this in a frame does not wake sleepers, mm. */
const WAKE_MOVE = SLEEP_SPEED * FRAME_DT
/**
 * Speed is measured over this many frames: a particle's net travel across the window divided by
 * the window's length. A settled pile of cables can ring by a few microns in a cycle of two to
 * five frames (a contact engaging and releasing); frame to frame that reads as a few mm/s and
 * keeps the island awake for ever, over a window it cancels and reads as no motion at all, while
 * a real creep (a drift) still shows at the same 0.5 mm/s.
 */
const SLEEP_WINDOW = 10
/**
 * Route hints pull softly: 0.1 mm of give under a whole lead's weight, and about 0.6 mm where a
 * hint bends a lead well out of its own shape (cables.test, route hints).
 */
const HINT_ALPHA = 3e-5
const MAX_HINTS = 3
/**
 * A particle a collider pushed in the last substep weighs this many times its mass in the next
 * substep's bending and stretch solves (a power of two, so the weight comes back exactly). See
 * `weighPressed`.
 */
const PRESS_MASS = 16
/** Where along a rod segment it is tested against ribbon triangles (spacing 1.5 mm at 3 mm). */
const SAMPLES = [0.25, 0.75]
const DEFAULT_MAX_PARTICLES = 8192
/** Allowance on the motion bound that skips distant contact pairs, mm. */
const BOUND_MARGIN = 0.1

/** The phases `WorldOptions.profile` times, in the order a frame runs them. */
export const PHASES = [
  'prepare',
  'colliders',
  'pairs',
  'predict',
  'chains',
  'cables',
  'surfaces',
  'velocity',
  'finish'
] as const
const PREPARE = 0,
  COLLIDERS = 1,
  PAIRS = 2,
  PREDICT = 3,
  CHAINS = 4,
  CABLES = 5,
  SURFACES = 6,
  VELOCITY = 7,
  FINISH = 8

/** A growable table of fixed-width records: `si` integers and `sf` floats each. */
class Table {
  d = new Int32Array(1024)
  f = new Float64Array(1024)
  n = 0
  constructor(
    readonly si: number,
    readonly sf: number
  ) {}
  /** Reserves the next record and returns its number. */
  next(): number {
    const s = this.n
    if ((s + 1) * this.si > this.d.length) {
      const d = new Int32Array(this.d.length * 2)
      d.set(this.d)
      this.d = d
    }
    if ((s + 1) * this.sf > this.f.length) {
      const f = new Float64Array(this.f.length * 2)
      f.set(this.f)
      this.f = f
    }
    this.n++
    return s
  }
}

const overlap = (a: Float64Array, ao: number, b: Float64Array, bo: number) =>
  a[ao]! <= b[bo + 3]! &&
  a[ao + 3]! >= b[bo]! &&
  a[ao + 1]! <= b[bo + 4]! &&
  a[ao + 4]! >= b[bo + 1]! &&
  a[ao + 2]! <= b[bo + 5]! &&
  a[ao + 5]! >= b[bo + 2]!

/** Math.hypot is several times slower than this in the hot loops. */
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z)
const scratch = new Float64Array(2)
const tmpA = new Float64Array(3)
const tmpB = new Float64Array(3)
const tmpPos = new Float64Array(3)
const tmpMat = new Float64Array(9)
const tmpBounds = new Float64Array(6)

function colliderBounds(c: Collider, pos: Float64Array, mat: Float64Array, out: Float64Array) {
  for (let a = 0; a < 3; a++) {
    const ext = c.isBox
      ? Math.abs(mat[3 * a]!) * c.hx +
        Math.abs(mat[3 * a + 1]!) * c.hy +
        Math.abs(mat[3 * a + 2]!) * c.hz
      : Math.abs(mat[3 * a + 2]!) * c.halfLength + c.radius
    out[a] = pos[a]! - ext
    out[3 + a] = pos[a]! + ext
  }
}

const normalized = (p: Pose): Pose => ({
  position: p.position,
  rotation: normalizeQuat(p.rotation)
})

export class CableWorld {
  private readonly substeps: number
  private readonly cap: number
  private readonly rand: () => number
  private count = 0
  private readonly x: Float64Array
  private readonly xp: Float64Array
  private readonly v: Float64Array
  /** Positions the frame is expected to end at, and where it started; for the broad phase. */
  private readonly xe: Float64Array
  private readonly xf: Float64Array
  private readonly w: Float64Array
  private readonly pressed: Uint8Array
  private readonly render: Float32Array
  private readonly pool: Pool
  private bodies: Body[] = []
  private colliders: Collider[] = []
  private nextId = 1
  private nextGroup = 1
  /** Frames stepped, and each particle's position in the last SLEEP_WINDOW frames (a ring). */
  private tick = 0
  private settling = false
  private readonly ring: Float64Array
  /** Per-phase milliseconds of the last frame, when `profile` is on. */
  private readonly frameMs: Float64Array | null
  private clock = 0

  // Collision primitives: rod segments, then ribbon triangles, in one id space.
  private primDirty = true
  private segCount = 0
  private primBody = new Int32Array(0)
  private box = new Float64Array(0)
  private readonly hash = new SpatialHash(HASH_CELL)
  // This frame's candidate contacts.
  // Ints and floats of each record: [seg i, j (or particle i, -1), collider, slot] + [slack, radius];
  // [i, j, k, l, slot, slot] + [slack, reach]; [i, j, a, b, c, slot, slot] + [slack, reach]; and
  // the pairs of body slots that touch.
  private readonly cand = new Table(4, 2)
  private readonly rod = new Table(6, 2)
  private readonly rib = new Table(7, 2)
  private readonly strips = new Table(6, 1)
  private readonly links = new Table(2, 0)
  /** Per awake body: how far its primitives may have moved toward a neighbour's by now, mm. */
  private bound = new Float64Array(64)

  constructor(options: WorldOptions = {}) {
    this.substeps = Math.max(1, Math.round(options.substeps ?? DEFAULT_SUBSTEPS))
    this.cap = options.maxParticles ?? DEFAULT_MAX_PARTICLES
    this.rand = rng(options.seed ?? 1)
    this.x = new Float64Array(3 * this.cap)
    this.xp = new Float64Array(3 * this.cap)
    this.v = new Float64Array(3 * this.cap)
    this.xe = new Float64Array(3 * this.cap)
    this.xf = new Float64Array(3 * this.cap)
    this.w = new Float64Array(this.cap)
    this.render = new Float32Array(3 * this.cap)
    this.ring = new Float64Array(SLEEP_WINDOW * 3 * this.cap)
    this.pressed = new Uint8Array(this.cap)
    this.pool = { x: this.x, xp: this.xp, w: this.w, pressed: this.pressed }
    this.frameMs = options.profile ? new Float64Array(PHASES.length) : null
  }

  /** Milliseconds each phase took in the last `step()`, in `PHASES` order; null unless profiling. */
  phaseTimes(): Float64Array | null {
    return this.frameMs
  }

  /** Charges the time since the last lap to a phase. A no-op unless profiling. */
  private lap(phase: number) {
    const ms = this.frameMs
    if (ms === null) return
    const now = performance.now()
    ms[phase]! += now - this.clock
    this.clock = now
  }

  // ---- Colliders -----------------------------------------------------------------------------

  addCollider(shape: ColliderShape, pose: Pose): ColliderId {
    const f = normalized(pose)
    const c: Collider = {
      id: this.nextId++,
      isBox: shape.kind === 'box',
      hx: shape.kind === 'box' ? shape.halfExtents[0] : 0,
      hy: shape.kind === 'box' ? shape.halfExtents[1] : 0,
      hz: shape.kind === 'box' ? shape.halfExtents[2] : 0,
      radius: shape.kind === 'capsule' ? shape.radius : 0,
      halfLength: shape.kind === 'capsule' ? shape.halfLength : 0,
      f0: f,
      f1: f,
      moving: false,
      p: Float64Array.from(f.position),
      R: new Float64Array(9),
      p0: Float64Array.from(f.position),
      R0: new Float64Array(9),
      lo: new Float64Array(3),
      hi: new Float64Array(3)
    }
    quatToMat(f.rotation, c.R)
    c.R0.set(c.R)
    const b = new Float64Array(6)
    colliderBounds(c, c.p, c.R, b)
    c.lo.set(b.subarray(0, 3))
    c.hi.set(b.subarray(3))
    this.colliders.push(c)
    this.wakeInside(b)
    return c.id
  }

  /** Moves a kinematic collider; it travels there over the next step. */
  setColliderPose(id: ColliderId, pose: Pose): void {
    const c = this.collider(id)
    const f = normalized(pose)
    if (samePose(c.f1, f)) return
    c.f1 = f
    c.moving = !samePose(c.f0, f)
    const from = new Float64Array(6)
    const to = new Float64Array(6)
    colliderBounds(c, Float64Array.from(c.f0.position), matrixOf(c.f0), from)
    colliderBounds(c, Float64Array.from(f.position), matrixOf(f), to)
    const sweep = new Float64Array(6)
    for (let a = 0; a < 3; a++) {
      sweep[a] = Math.min(from[a]!, to[a]!)
      sweep[3 + a] = Math.max(from[3 + a]!, to[3 + a]!)
    }
    c.lo.set(sweep.subarray(0, 3))
    c.hi.set(sweep.subarray(3))
    this.wakeInside(sweep)
  }

  removeCollider(id: ColliderId): void {
    const i = this.colliders.findIndex((c) => c.id === id)
    if (i < 0) throw new RangeError(`unknown collider ${id}`)
    const c = this.colliders[i]!
    const b = new Float64Array(6)
    b.set(c.lo)
    b.set(c.hi, 3)
    this.colliders.splice(i, 1)
    this.wakeInside(b)
  }

  private collider(id: ColliderId): Collider {
    const c = this.colliders.find((c) => c.id === id)
    if (!c) throw new RangeError(`unknown collider ${id}`)
    return c
  }

  /** Wakes every body whose bounds come within a few mm of the box lo..hi (6 numbers). */
  private wakeInside(bounds: Float64Array) {
    const m = 5
    for (const b of this.bodies) {
      if (
        b.lo[0]! <= bounds[3]! + m &&
        b.hi[0]! >= bounds[0]! - m &&
        b.lo[1]! <= bounds[4]! + m &&
        b.hi[1]! >= bounds[1]! - m &&
        b.lo[2]! <= bounds[5]! + m &&
        b.hi[2]! >= bounds[2]! - m
      ) {
        this.wake(b)
      }
    }
  }

  // ---- Bodies --------------------------------------------------------------------------------

  addRibbon(def: RibbonDef): BodyId {
    return this.addBody(buildRibbon(def, this.rand), def.a, def.b).id
  }

  addLead(def: LeadDef): BodyId {
    return this.addBody(buildLead(def, this.rand), def.a, def.b).id
  }

  addJumper(def: JumperDef): BodyId {
    return this.addBody(buildJumper(def), def.a, def.b).id
  }

  private addBody(spec: Spec, a: Pose, b: Pose): Body {
    if (this.count + spec.n > this.cap) {
      throw new RangeError(`particle pool full: ${this.count} + ${spec.n} > ${this.cap}`)
    }
    const first = this.count
    const c = spec.constraints
    for (const arr of [c.dI, c.dJ, c.cA, c.cB, c.cC, c.lI, c.lA, c.kI, c.gI]) shift(arr, first)
    for (const arr of [spec.segI, spec.segJ, spec.triA, spec.triB, spec.triC]) shift(arr, first)
    this.x.set(spec.x0, 3 * first)
    this.xp.set(spec.x0, 3 * first)
    this.w.set(spec.w, first)
    const pa = normalized(a)
    const pb = normalized(b)
    const dRest = new Float64Array(c.dI.length)
    for (let k = 0; k < dRest.length; k++) {
      dRest[k] = Math.sqrt(c.dLat2[k]! + c.dAlong[k]! * c.dAlong[k]!)
    }
    const m = c.cA.length
    const body: Body = {
      ...c,
      bL1: new Float64Array(m),
      bL2: new Float64Array(m),
      bD: new Float64Array(m),
      dRest,
      gTarget: new Float64Array(3 * c.gI.length),
      id: this.nextId++,
      kind: spec.kind,
      first,
      n: spec.n,
      gridCount: spec.gridCount,
      rig: spec.rig && { ...spec.rig, qStart: first + spec.gridCount },
      rows: spec.rows,
      columns: spec.columns,
      wireStart: spec.wireStart,
      wireEnd: spec.wireEnd,
      radius: spec.radius,
      segI: spec.segI,
      segJ: spec.segJ,
      triA: spec.triA,
      triB: spec.triB,
      triC: spec.triC,
      segStart: 0,
      triStart: 0,
      hintI: new Int32Array(MAX_HINTS),
      hintTarget: new Float64Array(3 * MAX_HINTS),
      hintGoal: new Float64Array(3 * MAX_HINTS),
      hintW: new Float64Array(MAX_HINTS),
      pressFactor: false,
      hintCount: 0,
      exitA: spec.exitA + first,
      exitB: spec.exitB + first,
      freeLength: spec.freeLength,
      flagLocalA: spec.flagLocalA,
      flagLocalB: spec.flagLocalB,
      lengthMm: spec.lengthMm,
      allowanceMm: spec.allowanceMm,
      pose0: [pa, pb],
      pose1: [pa, pb],
      asleep: false,
      quiet: 0,
      age: 0,
      group: 0,
      island: 0,
      taut: false,
      scale: 1,
      index: this.bodies.length,
      slot: 0,
      pad: spec.radius + SKIN / 2,
      speed: Infinity,
      move: 0,
      damp: 1,
      apos: [new Float64Array(3), new Float64Array(3)],
      amat: [new Float64Array(9), new Float64Array(9)],
      endMoving: [false, false],
      lo: new Float64Array(3),
      hi: new Float64Array(3)
    }
    body.island = body.id
    factorBending(this.w, body, (this.substeps / FRAME_DT) ** 2)
    this.count += spec.n
    this.bodies.push(body)
    this.primDirty = true
    this.syncRender(body)
    this.refreshEndFrames(body)
    this.updateTaut(body)
    return body
  }

  removeBody(id: BodyId): void {
    const i = this.bodies.findIndex((b) => b.id === id)
    if (i < 0) throw new RangeError(`unknown body ${id}`)
    const gone = this.bodies[i]!
    const bounds = new Float64Array(6)
    bounds.set(gone.lo)
    bounds.set(gone.hi, 3)
    this.bodies.splice(i, 1)
    const { first, n } = gone
    for (const arr of [this.x, this.xp, this.v, this.xe, this.xf, this.render]) {
      arr.copyWithin(3 * first, 3 * (first + n), 3 * this.count)
    }
    this.w.copyWithin(first, first + n, this.count)
    this.pressed.copyWithin(first, first + n, this.count)
    this.count -= n
    for (let k = i; k < this.bodies.length; k++) {
      const b = this.bodies[k]!
      shiftBody(b, -n)
      b.index = k
    }
    for (const b of this.bodies) b.age = 0
    this.primDirty = true
    this.wakeInside(bounds)
  }

  private body(id: BodyId): Body {
    const b = this.bodies.find((b) => b.id === id)
    if (!b) throw new RangeError(`unknown body ${id}`)
    return b
  }

  /** Sets where end 0 or 1 of a body is clamped; the body wakes if that is a change. */
  setAnchor(id: BodyId, end: 0 | 1, pose: Pose): void {
    const b = this.body(id)
    const p = normalized(pose)
    if (samePose(b.pose1[end], p)) return
    b.pose1[end] = p
    this.wake(b)
  }

  /**
   * Soft target points for a lead's span (at most 3, in the table frame). Each pulls the particle
   * whose wire either side best reaches it: s along the wire from the first exit with
   * s - |t - a| = (L - s) - |t - b|, the same to spare both ways. A lead standing up from its
   * housings does not follow the chord between them, so the particle nearest a target's
   * projection onto the chord could be the wrong side of the arch for it.
   */
  setRouteHints(id: BodyId, points: readonly Vec3[]): void {
    const b = this.body(id)
    if (b.kind !== 'lead') return
    const pts = points.slice(0, MAX_HINTS)
    this.endPoint(b, 0, tmpA)
    this.endPoint(b, 1, tmpB)
    const free0 = b.first + b.wireStart + 1
    const free1 = b.first + b.wireEnd - 2
    const seg = b.freeLength / (b.exitB - b.exitA)
    let changed = pts.length !== b.hintCount
    pts.forEach((p, k) => {
      const da = Math.hypot(p[0] - tmpA[0]!, p[1] - tmpA[1]!, p[2] - tmpA[2]!)
      const db = Math.hypot(p[0] - tmpB[0]!, p[1] - tmpB[1]!, p[2] - tmpB[2]!)
      const along = (b.freeLength + da - db) / 2
      const i = Math.min(free1, Math.max(free0, b.exitA + Math.round(along / seg)))
      for (let a = 0; a < 3; a++) {
        if (b.hintTarget[3 * k + a] !== p[a]) changed = true
        b.hintTarget[3 * k + a] = p[a]!
      }
      if (b.hintI[k] !== i) changed = true
      b.hintI[k] = i
    })
    b.hintCount = pts.length
    if (!changed) return
    this.weighHints(b, true)
    factorBending(this.w, b, (this.substeps / FRAME_DT) ** 2)
    this.weighHints(b, false)
    this.wake(b)
  }

  /**
   * Mass scaling for contact (Macklin et al., "Unified Particle Physics for Real-Time
   * Applications", SIGGRAPH 2014, section 5.2, after the shock propagation of Guendelman et al.
   * 2003). Bending is solved over the whole chain at once and contacts after it, so a stiff lead
   * pressed against a part was bent back into it by nearly the whole of what the contact had just
   * pushed out, every substep: a wall rising under a hung lead went through it once the lift passed
   * 4 mm, and a 2.4 mm wall at 2 mm. Made heavier in the next substep's rod solves, the particles a
   * collider pushed stay where it put them and the rest of the rod bends around them. At rest it
   * changes nothing: a particle's weight scales its share of the corrections, not their balance.
   * Contacts between cables are left out: marked the same way, a settled pile of leads never slept.
   * `on` scales the weights and reports whether any was pressed; `off` restores them.
   */
  private weighPressed(b: Body, on: boolean): boolean {
    const { w, pressed } = this
    const end = b.first + b.n
    let any = false
    // A ribbon's rod solves move its row centres only, which nothing touches.
    for (let i = b.rig ? b.rig.qStart : b.first; i < end; i++) {
      if (pressed[i] === 0) continue
      any = true
      w[i] = on ? w[i]! / PRESS_MASS : w[i]! * PRESS_MASS
    }
    return any
  }

  /**
   * Where each route hint pulls this frame: its target, brought within what the wire either side of
   * its particle can reach from each exit (the lens between two balls, by alternating projection),
   * measured from where the exits end the frame. A target 160 mm above a 165 mm lead's housings
   * pulled it taut against them, and bending, stretch and the hint never agreed: it was still
   * moving at 150 mm/s after 15 s. Brought within reach, the lead rests as near the target as it
   * can and sleeps.
   */
  private reachHints(b: Body) {
    const { xe } = this
    const seg = b.dRest[0]!
    const a3 = 3 * b.exitA,
      c3 = 3 * b.exitB
    for (let k = 0; k < b.hintCount; k++) {
      const i = b.hintI[k]!
      const ra = (i - b.exitA) * seg
      const rb = (b.exitB - i) * seg
      let tx = b.hintTarget[3 * k]!,
        ty = b.hintTarget[3 * k + 1]!,
        tz = b.hintTarget[3 * k + 2]!
      for (let it = 0; it < 8; it++) {
        for (const [o, r] of [
          [a3, ra],
          [c3, rb]
        ] as const) {
          const dx = tx - xe[o]!,
            dy = ty - xe[o + 1]!,
            dz = tz - xe[o + 2]!
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
          if (d <= r) continue
          const f = r / d
          tx = xe[o]! + dx * f
          ty = xe[o + 1]! + dy * f
          tz = xe[o + 2]! + dz * f
        }
      }
      b.hintGoal[3 * k] = tx
      b.hintGoal[3 * k + 1] = ty
      b.hintGoal[3 * k + 2] = tz
    }
  }

  /**
   * A route hint is the energy (h^2 / 2 alpha) |x - target|^2 on one particle, so in the substep's
   * implicit solve it is the same as that particle weighing h^2 / alpha more, at the target-weighted
   * prediction `solveGoals` moves it to. The bending and stretch solves that follow take it at that
   * weight (`on`), so a hint holds against a stiff lead instead of being undone by them; `off` puts
   * the weights back.
   */
  private weighHints(b: Body, on: boolean) {
    const { w } = this
    const extra = (FRAME_DT / this.substeps) ** 2 / HINT_ALPHA
    if (on) {
      for (let k = 0; k < b.hintCount; k++) {
        const i = b.hintI[k]!
        b.hintW[k] = w[i]!
        w[i] = 1 / (1 / w[i]! + extra)
      }
    } else {
      for (let k = b.hintCount - 1; k >= 0; k--) w[b.hintI[k]!] = b.hintW[k]!
    }
  }

  /** Where end `e` of the body measures its span from, in the table frame (target pose). */
  private endPoint(b: Body, e: 0 | 1, out: Float64Array) {
    posedAt(b.pose1[e], b.pose1[e], 1, tmpPos, tmpMat)
    const l = e === 0 ? b.flagLocalA : b.flagLocalB
    toWorld(tmpPos, tmpMat, l[0], l[1], l[2], out, 0)
  }

  /** Wakes the body and every body that sleeps with it. */
  private wake(b: Body) {
    b.quiet = 0
    if (!b.asleep) return
    b.speed = Infinity
    b.age = 0
    const group = b.group
    for (const o of this.bodies) {
      if (o.asleep && o.group === group) {
        o.asleep = false
        o.quiet = 0
        o.age = 0
        o.speed = Infinity
      }
    }
  }

  // ---- Reading state -------------------------------------------------------------------------

  /** Particle positions, three floats each, valid until a body is removed. */
  positions(id: BodyId): Float32Array {
    const b = this.body(id)
    return this.render.subarray(3 * b.first, 3 * (b.first + b.gridCount))
  }

  info(id: BodyId): BodyInfo {
    const b = this.body(id)
    return {
      kind: b.kind,
      particles: b.gridCount,
      rows: b.rows,
      columns: b.columns,
      wireStart: b.wireStart,
      wireEnd: b.wireEnd
    }
  }

  /** The sleep flag of the body's island. */
  isAsleep(id: BodyId): boolean {
    return this.body(id).asleep
  }

  allAsleep(): boolean {
    return this.bodies.every((b) => b.asleep)
  }

  /** True while the lead or ribbon is over-span: too short to reach (the LEAD_TOO_SHORT rule). */
  isTaut(id: BodyId): boolean {
    return this.body(id).taut
  }

  /** The island label: bodies touching each other share it. */
  islandOf(id: BodyId): number {
    return this.body(id).island
  }

  // ---- Stepping ------------------------------------------------------------------------------

  /** Advances one 1/60 s frame. */
  step(): void {
    const n = this.substeps
    const h = FRAME_DT / n
    if (this.primDirty) this.rebuildPrimitives()
    if (this.frameMs !== null) {
      this.frameMs.fill(0)
      this.clock = performance.now()
    }
    const awake = this.bodies.filter((b) => !b.asleep)
    const moving = this.colliders.filter((c) => c.moving)
    if (awake.length > 0) {
      this.prepare(awake)
      this.lap(PREPARE)
      this.collectColliderContacts(awake)
      this.lap(COLLIDERS)
      this.collectPairs(awake)
      this.lap(PAIRS)
      for (const b of awake) {
        const c = this.settling || b.speed < SLOW_SPEED ? SLOW_DAMPING : DAMPING
        b.damp = 1 / (1 + c * h)
      }
      for (let k = 1; k <= n; k++) this.substep(awake, moving, k / n, h)
    }
    this.finish(awake, moving)
    this.lap(FINISH)
  }

  /**
   * Steps until every island sleeps or `maxFrames` have run, so a project opened from a
   * design-curve guess is shown at rest. Returns the frames run. Bodies are damped as the slow
   * ones are throughout, so a lead creeps to its resting shape the way it does when a hand lets
   * it down: dropped freely it can fall to the other side of a ridge and rest in a different, equally
   * valid shape, and a reopened project would not look the way it was saved.
   */
  settle(maxFrames = 240): number {
    this.settling = true
    let frames = 0
    while (frames < maxFrames && !this.allAsleep()) {
      this.step()
      frames++
    }
    this.settling = false
    return frames
  }

  private rebuildPrimitives() {
    let s = 0
    let t = 0
    for (const b of this.bodies) {
      b.segStart = s
      s += b.segI.length
      b.triStart = t
      t += b.triA.length
    }
    this.segCount = s
    this.primBody = new Int32Array(s + t)
    this.box = new Float64Array(6 * (s + t))
    this.bodies.forEach((b, bi) => {
      for (let k = 0; k < b.segI.length; k++) this.primBody[b.segStart + k] = bi
      for (let k = 0; k < b.triA.length; k++) this.primBody[s + b.triStart + k] = bi
      this.fillBoxes(b, b.radius + SKIN / 2, false)
    })
    this.primDirty = false
  }

  /** Padded bounds of a body's primitives, from current positions and (swept) the frame's end. */
  private fillBoxes(b: Body, pad: number, swept: boolean) {
    const { x, xe, box } = this
    const blo = b.lo
    const bhi = b.hi
    blo.fill(Infinity)
    bhi.fill(-Infinity)
    // Rod segments: the box of two particles (and, swept, of where they are expected to be).
    for (let k = 0; k < b.segI.length; k++) {
      const i3 = 3 * b.segI[k]!,
        j3 = 3 * b.segJ[k]!
      const o = 6 * (b.segStart + k)
      for (let a = 0; a < 3; a++) {
        let lo = x[i3 + a]!
        let hi = lo
        const q = x[j3 + a]!
        if (q < lo) lo = q
        else if (q > hi) hi = q
        if (swept) {
          const pe = xe[i3 + a]!,
            qe = xe[j3 + a]!
          if (pe < lo) lo = pe
          else if (pe > hi) hi = pe
          if (qe < lo) lo = qe
          else if (qe > hi) hi = qe
        }
        lo -= pad
        hi += pad
        box[o + a] = lo
        box[o + 3 + a] = hi
        if (lo < blo[a]!) blo[a] = lo
        if (hi > bhi[a]!) bhi[a] = hi
      }
    }
    // Ribbon triangles: three particles.
    for (let k = 0; k < b.triA.length; k++) {
      const i3 = 3 * b.triA[k]!,
        j3 = 3 * b.triB[k]!,
        l3 = 3 * b.triC[k]!
      const o = 6 * (this.segCount + b.triStart + k)
      for (let a = 0; a < 3; a++) {
        const p = x[i3 + a]!,
          q = x[j3 + a]!,
          r = x[l3 + a]!
        let lo = Math.min(p, q, r)
        let hi = Math.max(p, q, r)
        if (swept) {
          lo = Math.min(lo, xe[i3 + a]!, xe[j3 + a]!, xe[l3 + a]!)
          hi = Math.max(hi, xe[i3 + a]!, xe[j3 + a]!, xe[l3 + a]!)
        }
        lo -= pad
        hi += pad
        box[o + a] = lo
        box[o + 3 + a] = hi
        if (lo < blo[a]!) blo[a] = lo
        if (hi > bhi[a]!) bhi[a] = hi
      }
    }
  }

  /** Sets each end frame's pose for the frame, and the clamped particles' end positions. */
  private refreshEndFrames(b: Body) {
    for (let e = 0; e < 2; e++) {
      b.endMoving[e] = !samePose(b.pose0[e]!, b.pose1[e]!)
      posedAt(b.pose1[e]!, b.pose1[e]!, 1, b.apos[e]!, b.amat[e]!)
    }
  }

  private prepare(awake: Body[]) {
    const { x, xe, v, w } = this
    for (const b of awake) {
      this.refreshEndFrames(b)
      let travel = 0
      const end = b.first + b.n
      // A body that has all but stopped is held up by what it rests on, so it is not expected to
      // fall; a body that has just been woken or is moving is.
      const fall = b.speed < SLOW_SPEED ? 0 : FALL
      for (let i = b.first; i < end; i++) {
        const i3 = 3 * i
        if (w[i]! > 0) {
          xe[i3] = x[i3]! + v[i3]! * FRAME_DT
          xe[i3 + 1] = x[i3 + 1]! + v[i3 + 1]! * FRAME_DT
          xe[i3 + 2] = x[i3 + 2]! + v[i3 + 2]! * FRAME_DT - fall
        }
      }
      for (let k = 0; k < b.kI.length; k++) {
        const i = b.kI[k]!
        const e = b.kEnd[k]!
        const l = b.kLocal
        toWorld(b.apos[e]!, b.amat[e]!, l[3 * k]!, l[3 * k + 1]!, l[3 * k + 2]!, xe, 3 * i)
        travel = Math.max(
          travel,
          Math.abs(xe[3 * i]! - x[3 * i]!) +
            Math.abs(xe[3 * i + 1]! - x[3 * i + 1]!) +
            Math.abs(xe[3 * i + 2]! - x[3 * i + 2]!)
        )
      }
      if (b.hintCount > 0) this.reachHints(b)
      let move = 0
      for (let i = b.first; i < end; i++) {
        const i3 = 3 * i
        const dx = xe[i3]! - x[i3]!,
          dy = xe[i3 + 1]! - x[i3 + 1]!,
          dz = xe[i3 + 2]! - x[i3 + 2]!
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d > MAX_SWEEP) {
          // An anchor thrown across the scene: bound the box, the contacts catch up over frames.
          const f = MAX_SWEEP / d
          xe[i3] = x[i3]! + dx * f
          xe[i3 + 1] = x[i3 + 1]! + dy * f
          xe[i3 + 2] = x[i3 + 2]! + dz * f
        }
        move = Math.max(move, Math.min(d, MAX_SWEEP))
      }
      b.move = move
      b.pad = b.radius + SKIN / 2 + Math.min(travel, MAX_SWEEP)
      this.fillBoxes(b, b.pad, true)
    }
    this.hash.build(this.box, this.box.length / 6)
    this.wakeTouching(awake)
    awake.sort((a, b) => a.index - b.index)
    if (this.bound.length < awake.length) this.bound = new Float64Array(2 * awake.length)
    awake.forEach((b, s) => {
      b.slot = s
      this.xf.set(x.subarray(3 * b.first, 3 * (b.first + b.n)), 3 * b.first)
    })
  }

  /**
   * A sleeping body that a moving awake one comes near wakes with its island (so awake grows). A
   * body that is awake but not moving wakes nobody: islands that are close without touching would
   * otherwise wake each other in turn for ever, and neither would sleep.
   */
  private wakeTouching(awake: Body[]) {
    if (this.bodies.every((b) => !b.asleep)) return
    const { hash, box, primBody, segCount } = this
    for (let qi = 0; qi < awake.length; qi++) {
      const b = awake[qi]!
      if (b.move <= WAKE_MOVE) continue
      const near = this.bodies.some(
        (o) =>
          o.asleep &&
          o.lo[0]! <= b.hi[0]! &&
          o.hi[0]! >= b.lo[0]! &&
          o.lo[1]! <= b.hi[1]! &&
          o.hi[1]! >= b.lo[1]! &&
          o.lo[2]! <= b.hi[2]! &&
          o.hi[2]! >= b.lo[2]!
      )
      if (!near) continue
      const nPrims = b.segI.length + b.triA.length
      for (let k = 0; k < nPrims; k++) {
        const g = k < b.segI.length ? b.segStart + k : segCount + b.triStart + (k - b.segI.length)
        const o = 6 * g
        const cnt = hash.query(
          box[o]!,
          box[o + 1]!,
          box[o + 2]!,
          box[o + 3]!,
          box[o + 4]!,
          box[o + 5]!,
          -1
        )
        for (let q = 0; q < cnt; q++) {
          const id = hash.result[q]!
          const other = this.bodies[primBody[id]!]!
          if (!other.asleep || !overlap(box, o, box, 6 * id)) continue
          for (const m of this.bodies) {
            if (m.asleep && m.group === other.group) {
              m.asleep = false
              m.quiet = 0
              m.age = 0
              m.speed = Infinity
              m.move = 0
              this.xe.set(this.x.subarray(3 * m.first, 3 * (m.first + m.n)), 3 * m.first)
              awake.push(m)
            }
          }
        }
      }
    }
  }

  private collectColliderContacts(awake: Body[]) {
    const { cand, x, xe, w, box, colliders } = this
    cand.n = 0
    this.strips.n = 0
    if (colliders.length === 0) return
    for (const b of awake) {
      for (let ci = 0; ci < colliders.length; ci++) {
        const c = colliders[ci]!
        if (
          b.lo[0]! > c.hi[0]! ||
          b.hi[0]! < c.lo[0]! ||
          b.lo[1]! > c.hi[1]! ||
          b.hi[1]! < c.lo[1]! ||
          b.lo[2]! > c.hi[2]! ||
          b.hi[2]! < c.lo[2]!
        ) {
          continue
        }
        const cb = tmpBounds
        cb.set(c.lo)
        cb.set(c.hi, 3)
        if (b.segI.length > 0) {
          for (let k = 0; k < b.segI.length; k++) {
            if (!overlap(box, 6 * (b.segStart + k), cb, 0)) continue
            const s = cand.next()
            const o = s * 4
            cand.d[o] = b.segI[k]!
            cand.d[o + 1] = b.segJ[k]!
            cand.d[o + 2] = ci
            cand.d[o + 3] = b.slot
            cand.f[2 * s] = gapSegmentCollider(x, c, b.segI[k]!, b.segJ[k]!, b.radius)
            cand.f[2 * s + 1] = b.radius
          }
        } else if (c.isBox && b.rig) {
          this.collectStrips(b, c, ci)
        } else {
          for (let i = b.first; i < b.first + b.gridCount; i++) {
            if (w[i]! === 0) continue
            let hit = true
            for (let a = 0; a < 3 && hit; a++) {
              const p = x[3 * i + a]!,
                q = xe[3 * i + a]!
              hit = Math.min(p, q) - b.pad <= c.hi[a]! && Math.max(p, q) + b.pad >= c.lo[a]!
            }
            if (!hit) continue
            const s = cand.next()
            const o = s * 4
            cand.d[o] = i
            cand.d[o + 1] = -1
            cand.d[o + 2] = ci
            cand.d[o + 3] = b.slot
            cand.f[2 * s] = gapParticleCollider(x, c, i, b.radius)
            cand.f[2 * s + 1] = b.radius
          }
        }
      }
    }
  }

  /**
   * The ribbon's strips (the sheet between neighbouring rows) that come near a box collider,
   * with the rows that carry them. The strips of two clamped rows never move and are left out.
   */
  private collectStrips(b: Body, c: Collider, ci: number) {
    const { x, xe, strips } = this
    const rig = b.rig!
    const cols = b.columns
    const pad = b.pad
    for (let r = rig.innerA; r < rig.innerB; r++) {
      const rowA = b.first + r * cols
      const rowB = rowA + cols
      let near = true
      for (let a = 0; a < 3 && near; a++) {
        let lo = Infinity
        let hi = -Infinity
        for (let k = 0; k < 4; k++) {
          const i = (k < 2 ? rowA : rowB) + (k & 1) * (cols - 1)
          const p = x[3 * i + a]!,
            q = xe[3 * i + a]!
          lo = Math.min(lo, p, q)
          hi = Math.max(hi, p, q)
        }
        near = lo - pad <= c.hi[a]! && hi + pad >= c.lo[a]!
      }
      if (!near) continue
      const s = strips.next()
      const o = s * 6
      strips.d[o] = rowA
      strips.d[o + 1] = rowB
      strips.d[o + 2] = rig.qStart + r
      strips.d[o + 3] = rig.qStart + r + 1
      strips.d[o + 4] = cols
      strips.d[o + 5] = ci
      strips.f[s] = b.radius
    }
  }

  /**
   * Finds every pair of primitives that can touch this frame, in an order that depends only on
   * the primitives' numbers. Contacts are solved in list order, and an order that shifts from one
   * frame to the next (as a hash's cell order does when boxes move) keeps a settled pile ringing.
   */
  private collectPairs(awake: Body[]) {
    const { hash, box, primBody, segCount, rod, rib, links, x, bodies } = this
    rod.n = 0
    rib.n = 0
    links.n = 0
    for (const b of awake) {
      for (let k = 0; k < b.segI.length; k++) {
        const g = b.segStart + k
        const o = 6 * g
        const cnt = hash.query(
          box[o]!,
          box[o + 1]!,
          box[o + 2]!,
          box[o + 3]!,
          box[o + 4]!,
          box[o + 5]!,
          g
        )
        const si = 3 * b.segI[k]!,
          sj = 3 * b.segJ[k]!
        const mx = 0.5 * (x[si]! + x[sj]!),
          my = 0.5 * (x[si + 1]! + x[sj + 1]!),
          mz = 0.5 * (x[si + 2]! + x[sj + 2]!)
        const half = 0.5 * len3(x[si]! - x[sj]!, x[si + 1]! - x[sj + 1]!, x[si + 2]! - x[sj + 2]!)
        let nr = 0
        let nt = 0
        for (let q = 0; q < cnt; q++) {
          const id = hash.result[q]!
          // Each rod pair is found from its lower segment; ribbon triangles come after every rod.
          if (!overlap(box, o, box, 6 * id)) continue
          const other = bodies[primBody[id]!]!
          if (id < segCount) {
            if (other === b && id - g < 3) continue
            const l = id - other.segStart
            // Keep only pairs that can come within reach during the frame (a sphere test).
            const oi = 3 * other.segI[l]!,
              oj = 3 * other.segJ[l]!
            const dx = mx - 0.5 * (x[oi]! + x[oj]!),
              dy = my - 0.5 * (x[oi + 1]! + x[oj + 1]!),
              dz = mz - 0.5 * (x[oi + 2]! + x[oj + 2]!)
            const oh = 0.5 * len3(x[oi]! - x[oj]!, x[oi + 1]! - x[oj + 1]!, x[oi + 2]! - x[oj + 2]!)
            const reach = b.radius + other.radius + CABLE_GAP
            const lim = reach + half + oh + b.move + other.move + SKIN
            if (dx * dx + dy * dy + dz * dz > lim * lim) continue
            const keep = reach + b.move + other.move + SKIN
            const near = closestSegSeg(
              x[si]!,
              x[si + 1]!,
              x[si + 2]!,
              x[sj]!,
              x[sj + 1]!,
              x[sj + 2]!,
              x[oi]!,
              x[oi + 1]!,
              x[oi + 2]!,
              x[oj]!,
              x[oj + 1]!,
              x[oj + 2]!,
              scratch
            )
            if (near > keep * keep) continue
            nr = this.keepCandidate(this.keptRod, nr, id, Math.sqrt(near) - reach)
          } else {
            const l = id - segCount - other.triStart
            const ta = 3 * other.triA[l]!,
              tb = 3 * other.triB[l]!,
              tc = 3 * other.triC[l]!
            const cx = (x[ta]! + x[tb]! + x[tc]!) / 3,
              cy = (x[ta + 1]! + x[tb + 1]! + x[tc + 1]!) / 3,
              cz = (x[ta + 2]! + x[tb + 2]! + x[tc + 2]!) / 3
            const rad = Math.max(
              len3(x[ta]! - cx, x[ta + 1]! - cy, x[ta + 2]! - cz),
              len3(x[tb]! - cx, x[tb + 1]! - cy, x[tb + 2]! - cz),
              len3(x[tc]! - cx, x[tc + 1]! - cy, x[tc + 2]! - cz)
            )
            const lim = b.radius + other.radius + half + rad + b.move + other.move + SKIN
            if ((mx - cx) ** 2 + (my - cy) ** 2 + (mz - cz) ** 2 > lim * lim) continue
            nt = this.keepCandidate(this.keptTri, nt, id, 0)
          }
        }
        // Rods in ascending segment number, then triangles in ascending triangle number.
        this.emitRods(b, k, nr)
        this.emitTriangles(b, k, nt)
      }
    }
  }

  // Candidates kept for one segment: the primitive's number and its slack (unsorted).
  private keptRod = { id: new Int32Array(64), slack: new Float64Array(64) }
  private keptTri = { id: new Int32Array(64), slack: new Float64Array(64) }

  /** Appends (id, slack) to a kept list, in order of id (insertion sort: the list is short). */
  private keepCandidate(
    list: { id: Int32Array; slack: Float64Array },
    n: number,
    id: number,
    slack: number
  ): number {
    if (n === list.id.length) {
      const ids = new Int32Array(2 * n)
      const slacks = new Float64Array(2 * n)
      ids.set(list.id)
      slacks.set(list.slack)
      list.id = ids
      list.slack = slacks
    }
    let j = n
    while (j > 0 && list.id[j - 1]! > id) {
      list.id[j] = list.id[j - 1]!
      list.slack[j] = list.slack[j - 1]!
      j--
    }
    list.id[j] = id
    list.slack[j] = slack
    return n + 1
  }

  private emitRods(b: Body, k: number, count: number) {
    const { rod, links } = this
    for (let q = 0; q < count; q++) {
      const id = this.keptRod.id[q]!
      const other = this.bodyOfSegment(id)
      const l = id - other.segStart
      const r = rod.next()
      const o = r * 6
      rod.d[o] = b.segI[k]!
      rod.d[o + 1] = b.segJ[k]!
      rod.d[o + 2] = other.segI[l]!
      rod.d[o + 3] = other.segJ[l]!
      rod.d[o + 4] = b.slot
      rod.d[o + 5] = other.slot
      rod.f[2 * r] = this.keptRod.slack[q]!
      rod.f[2 * r + 1] = b.radius + other.radius + CABLE_GAP
      if (other !== b) {
        const u = links.next()
        links.d[2 * u] = b.slot
        links.d[2 * u + 1] = other.slot
      }
    }
  }

  private emitTriangles(b: Body, k: number, count: number) {
    const { rib, links, segCount, x } = this
    for (let q = 0; q < count; q++) {
      const id = this.keptTri.id[q]!
      const other = this.bodyOfTriangle(id)
      const l = id - segCount - other.triStart
      const r = rib.next()
      const o = r * 7
      rib.d[o] = b.segI[k]!
      rib.d[o + 1] = b.segJ[k]!
      rib.d[o + 2] = other.triA[l]!
      rib.d[o + 3] = other.triB[l]!
      rib.d[o + 4] = other.triC[l]!
      rib.d[o + 5] = b.slot
      rib.d[o + 6] = other.slot
      const reach = b.radius + other.radius
      let slack = Infinity
      for (const ts of SAMPLES) {
        slack = Math.min(
          slack,
          Math.sqrt(
            gapPointTriangle(
              x,
              b.segI[k]!,
              b.segJ[k]!,
              ts,
              other.triA[l]!,
              other.triB[l]!,
              other.triC[l]!
            )
          ) - reach
        )
      }
      rib.f[2 * r] = slack
      rib.f[2 * r + 1] = reach
      if (other !== b) {
        const u = links.next()
        links.d[2 * u] = b.slot
        links.d[2 * u + 1] = other.slot
      }
    }
  }

  private bodyOfSegment(id: number): Body {
    return this.bodies[this.primBody[id]!]!
  }

  private bodyOfTriangle(id: number): Body {
    return this.bodies[this.primBody[id]!]!
  }

  private substep(awake: Body[], moving: Collider[], t: number, h: number) {
    const { x, xp, v, w, pool, bound, colliders, cand, rod, rib } = this
    const invH2 = 1 / (h * h)
    for (const c of moving) {
      c.p0.set(c.p)
      c.R0.set(c.R)
      posedAt(c.f0, c.f1, t, c.p, c.R)
    }
    for (const b of awake) {
      for (let e = 0; e < 2; e++) {
        if (b.endMoving[e]) posedAt(b.pose0[e]!, b.pose1[e]!, t, b.apos[e]!, b.amat[e]!)
      }
      const end = b.first + b.n
      for (let i = b.first; i < end; i++) {
        const i3 = 3 * i
        xp[i3] = x[i3]!
        xp[i3 + 1] = x[i3 + 1]!
        xp[i3 + 2] = x[i3 + 2]!
        if (w[i]! > 0) {
          v[i3 + 2] = v[i3 + 2]! - GRAVITY * h
          x[i3] = x[i3]! + v[i3]! * h
          x[i3 + 1] = x[i3 + 1]! + v[i3 + 1]! * h
          x[i3 + 2] = x[i3 + 2]! + v[i3 + 2]! * h
        }
      }
      const l = b.kLocal
      for (let k = 0; k < b.kI.length; k++) {
        const e = b.kEnd[k]!
        toWorld(b.apos[e]!, b.amat[e]!, l[3 * k]!, l[3 * k + 1]!, l[3 * k + 2]!, x, 3 * b.kI[k]!)
      }
      for (let g = 0; g < b.gI.length; g++) {
        const u = b.gU[g]!
        toWorld(
          b.apos[0],
          b.amat[0],
          b.gLoc[6 * g]!,
          b.gLoc[6 * g + 1]!,
          b.gLoc[6 * g + 2]!,
          tmpA,
          0
        )
        toWorld(
          b.apos[1],
          b.amat[1],
          b.gLoc[6 * g + 3]!,
          b.gLoc[6 * g + 4]!,
          b.gLoc[6 * g + 5]!,
          tmpB,
          0
        )
        for (let a = 0; a < 3; a++) b.gTarget[3 * g + a] = (1 - u) * tmpA[a]! + u * tmpB[a]!
      }
      this.relax(b)
    }
    this.lap(PREDICT)
    for (const b of awake) {
      if (b.rig) gatherRows(x, b)
      // Softest first, so the stiffest constraints have the last word in the substep.
      if (b.hintCount > 0) {
        solveGoals(x, w, b.hintI, b.hintGoal, b.hintCount, HINT_ALPHA, invH2)
        this.weighHints(b, true)
      }
      const pressed = this.weighPressed(b, true)
      if (pressed || b.pressFactor) {
        factorBending(w, b, invH2)
        b.pressFactor = pressed
      }
      solveBending(x, w, b)
      if (b.gI.length > 0) solveGoals(x, w, b.gI, b.gTarget, b.gI.length, b.gAlpha, invH2)
      solveChain(x, w, b)
      if (pressed) this.weighPressed(b, false)
      if (b.hintCount > 0) this.weighHints(b, false)
      solveLongRange(x, w, b)
      if (b.scale > 1 + 1e-9) straighten(x, b)
      if (b.rig) layRows(x, b)
    }
    this.lap(CHAINS)
    for (const b of awake) this.pressed.fill(0, b.first, b.first + b.n)
    this.measure(awake)
    // Cables first, then surfaces: what a pile rests on has the last word, so a stack settles
    // instead of creeping. The order is the same every substep; alternating it kept piles awake.
    solveRodPairs(x, w, rod.d, rod.f, rod.n, bound)
    solveRibbonPairs(pool, SAMPLES, rib.d, rib.f, rib.n, bound)
    this.lap(CABLES)
    solveSurfaces(pool, colliders, cand.d, cand.f, cand.n, bound)
    solveStrips(pool, colliders, this.strips.d, this.strips.f, this.strips.n)
    this.lap(SURFACES)
    const inv = 1 / h
    const maxStep = MAX_SPEED * h
    for (const b of awake) {
      const end = b.first + b.n
      const damp = b.damp
      for (let i = b.first; i < end; i++) {
        const i3 = i * 3
        let dx = x[i3]! - xp[i3]!,
          dy = x[i3 + 1]! - xp[i3 + 1]!,
          dz = x[i3 + 2]! - xp[i3 + 2]!
        const d2 = dx * dx + dy * dy + dz * dz
        if (w[i]! !== 0 && d2 > maxStep * maxStep) {
          // No particle may travel farther than MAX_SPEED allows in a substep: a safeguard against
          // an overlap or conflicting constraints throwing one across the scene.
          const f = maxStep / Math.sqrt(d2)
          dx *= f
          dy *= f
          dz *= f
          x[i3] = xp[i3]! + dx
          x[i3 + 1] = xp[i3 + 1]! + dy
          x[i3 + 2] = xp[i3 + 2]! + dz
        }
        if (w[i]! !== 0) {
          v[i3] = dx * inv * damp
          v[i3 + 1] = dy * inv * damp
          v[i3 + 2] = dz * inv * damp
        }
      }
    }
    this.lap(VELOCITY)
  }

  /**
   * How far each body's primitives have moved since the frame began, plus an allowance for what
   * the contacts themselves will move. A contact pair whose gap at the frame's start exceeds the
   * sum of its two bodies' bounds cannot be touching, so the contact solvers pass it by.
   */
  private measure(awake: Body[]) {
    const { x, xf, bound } = this
    for (const b of awake) {
      const end = 3 * (b.first + b.n)
      let far2 = 0
      for (let i = 3 * b.first; i < end; i += 3) {
        const fx = x[i]! - xf[i]!,
          fy = x[i + 1]! - xf[i + 1]!,
          fz = x[i + 2]! - xf[i + 2]!
        const f2 = fx * fx + fy * fy + fz * fz
        if (f2 > far2) far2 = f2
      }
      bound[b.slot] = Math.sqrt(far2) + BOUND_MARGIN
    }
  }

  /**
   * Over-span relaxation (SPEC 10.5): when the clamped ends are farther apart than the free span
   * is long, every rest length along the cable is scaled up so the stretch constraints and
   * long-range attachments settle on the straight, taut line between the ends.
   */
  private relax(b: Body) {
    const a3 = 3 * b.exitA,
      c3 = 3 * b.exitB
    const { x } = this
    const d = len3(x[a3]! - x[c3]!, x[a3 + 1]! - x[c3 + 1]!, x[a3 + 2]! - x[c3 + 2]!)
    const s = Math.max(1, d / b.freeLength)
    if (Math.abs(s - b.scale) < 1e-9) return
    b.scale = s
    for (let k = 0; k < b.dRest.length; k++) {
      const a = s * b.dAlong[k]!
      b.dRest[k] = Math.sqrt(b.dLat2[k]! + a * a)
    }
  }

  private syncRender(b: Body) {
    const end = 3 * (b.first + b.n)
    for (let i = 3 * b.first; i < end; i++) this.render[i] = this.x[i]!
  }

  private updateTaut(b: Body) {
    if (b.kind === 'jumper') return
    toWorld(b.apos[0], b.amat[0], b.flagLocalA[0], b.flagLocalA[1], b.flagLocalA[2], tmpA, 0)
    toWorld(b.apos[1], b.amat[1], b.flagLocalB[0], b.flagLocalB[1], b.flagLocalB[2], tmpB, 0)
    const d = Math.hypot(tmpA[0]! - tmpB[0]!, tmpA[1]! - tmpB[1]!, tmpA[2]! - tmpB[2]!)
    b.taut = d + b.allowanceMm > b.lengthMm
  }

  private finish(awake: Body[], moving: Collider[]) {
    for (const c of moving) {
      c.f0 = c.f1
      c.moving = false
      c.p.set(c.f1.position)
      quatToMat(c.f1.rotation, c.R)
      c.p0.set(c.p)
      c.R0.set(c.R)
      colliderBounds(c, c.p, c.R, tmpBounds)
      c.lo.set(tmpBounds.subarray(0, 3))
      c.hi.set(tmpBounds.subarray(3))
    }
    const { x, xf, w, ring } = this
    const slot = (this.tick++ % SLEEP_WINDOW) * 3 * this.cap
    const windowStill = (SLEEP_SPEED * SLEEP_WINDOW * FRAME_DT) ** 2
    for (const b of awake) {
      b.pose0 = [b.pose1[0], b.pose1[1]]
      b.endMoving[0] = b.endMoving[1] = false
      this.syncRender(b)
      this.updateTaut(b)
      let worst = 0
      const end = b.first + b.n
      for (let i = b.first; i < end; i++) {
        if (w[i]! === 0) continue
        const i3 = 3 * i
        const dx = x[i3]! - xf[i3]!,
          dy = x[i3 + 1]! - xf[i3 + 1]!,
          dz = x[i3 + 2]! - xf[i3 + 2]!
        worst = Math.max(worst, dx * dx + dy * dy + dz * dz)
      }
      if (!Number.isFinite(worst)) {
        // Numerical failure: put the body back where the frame found it and let it settle again.
        x.set(xf.subarray(3 * b.first, 3 * end), 3 * b.first)
        this.xp.set(xf.subarray(3 * b.first, 3 * end), 3 * b.first)
        this.v.fill(0, 3 * b.first, 3 * end)
        worst = 0
      }
      // Net travel over the window, once the body has been awake that long.
      let drift = Infinity
      if (b.age >= SLEEP_WINDOW) {
        drift = 0
        for (let i = b.first; i < end; i++) {
          if (w[i]! === 0) continue
          const i3 = 3 * i
          const dx = x[i3]! - ring[slot + i3]!,
            dy = x[i3 + 1]! - ring[slot + i3 + 1]!,
            dz = x[i3 + 2]! - ring[slot + i3 + 2]!
          drift = Math.max(drift, dx * dx + dy * dy + dz * dz)
        }
      }
      ring.set(x.subarray(3 * b.first, 3 * end), slot + 3 * b.first)
      b.age++
      b.quiet = drift < windowStill ? b.quiet + 1 : 0
      b.speed = Math.sqrt(worst) / FRAME_DT
    }
    if (awake.length > 0) this.updateIslands(awake)
  }

  /** Union-find over the bodies touching this frame; an island sleeps once all of it is quiet. */
  private updateIslands(awake: Body[]) {
    const parent = awake.map((_, i) => i)
    const find = (i: number) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!
        i = parent[i]!
      }
      return i
    }
    const { links } = this
    for (let u = 0; u < links.n; u++) {
      const a = find(links.d[2 * u]!)
      const b = find(links.d[2 * u + 1]!)
      // The smaller slot stays the root, so the result does not depend on link order.
      if (a < b) parent[b] = a
      else if (b < a) parent[a] = b
    }
    const quiet = new Map<number, boolean>()
    const label = new Map<number, number>()
    awake.forEach((b, i) => {
      const r = find(i)
      quiet.set(r, (quiet.get(r) ?? true) && b.quiet >= SLEEP_FRAMES)
      label.set(r, Math.min(label.get(r) ?? Infinity, b.id))
    })
    awake.forEach((b, i) => {
      const r = find(i)
      b.island = label.get(r)!
    })
    const groupOf = new Map<number, number>()
    awake.forEach((b, i) => {
      const r = find(i)
      if (!quiet.get(r)) return
      if (!groupOf.has(r)) groupOf.set(r, this.nextGroup++)
      b.asleep = true
      b.group = groupOf.get(r)!
      this.v.fill(0, 3 * b.first, 3 * (b.first + b.n))
      this.fillBoxes(b, b.radius + SKIN / 2, false)
    })
  }
}

function matrixOf(p: Pose): Float64Array {
  quatToMat(p.rotation, tmpMat)
  return Float64Array.from(tmpMat)
}

function shift(arr: Int32Array, by: number) {
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! + by
}

function shiftBody(b: Body, by: number) {
  for (const arr of [b.dI, b.dJ, b.cA, b.cB, b.cC, b.lI, b.lA, b.kI, b.gI, b.segI, b.segJ]) {
    shift(arr, by)
  }
  for (const arr of [b.triA, b.triB, b.triC, b.hintI]) shift(arr, by)
  if (b.rig) b.rig.qStart += by
  b.first += by
  b.exitA += by
  b.exitB += by
}
