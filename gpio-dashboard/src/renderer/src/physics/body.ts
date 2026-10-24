// A simulated body: a range of the world's particle pool plus the constraints that hold it.
// Constraint tables are in pool indices (the builders emit them body-local; the world shifts them).
import type { BodyKind, Pose, Vec3 } from './types'

export interface Constraints {
  /** Distance constraints: rest length = sqrt(lat2 + (scale * along)^2), so over-span relaxes
   *  only the part along the cable. They are rigid and solved as a chain (solveChain). */
  dI: Int32Array
  dJ: Int32Array
  dLat2: Float64Array
  dAlong: Float64Array
  dRest: Float64Array
  /** Curvature constraints x_a - 2 x_b + x_c = 0 (bending), along a chain (factorBending). */
  cA: Int32Array
  cB: Int32Array
  cC: Int32Array
  cAlpha: Float64Array
  /** LDL^T factors of the bending system: L's two sub-diagonals and 1 / D, per constraint. */
  bL1: Float64Array
  bL2: Float64Array
  bD: Float64Array
  /** Long-range attachments: particle lI stays within lMax * scale of the clamped particle lA. */
  lI: Int32Array
  lA: Int32Array
  lMax: Float64Array
  /** Clamped particles: end 0 or 1 and their position in that end's frame. */
  kI: Int32Array
  kEnd: Uint8Array
  kLocal: Float64Array
  /** Solid jumper shape goals: particle, blend fraction, local position in each end frame. */
  gI: Int32Array
  gU: Float64Array
  gLoc: Float64Array
  gTarget: Float64Array
  gAlpha: number
}

/** A ribbon's rigid rows: particle `qStart + r` is row r's centre, and the grid is rebuilt from it. */
export interface RibbonRig {
  innerA: number
  innerB: number
  lateral: Float64Array
  qStart: number
}

export interface Body extends Constraints {
  id: number
  kind: BodyKind
  first: number
  n: number
  /** Particles shown to the caller: all of them, but for a ribbon just its grid. */
  gridCount: number
  rows: number
  columns: number
  wireStart: number
  wireEnd: number
  /** Contact radius: half the wire diameter, or half the ribbon thickness. */
  radius: number
  /** Collision primitives: rod segments or ribbon triangles (pool indices). */
  rig: RibbonRig | null
  segI: Int32Array
  segJ: Int32Array
  triA: Int32Array
  triB: Int32Array
  triC: Int32Array
  /** Position of this body's primitives in the world-wide primitive lists. */
  segStart: number
  triStart: number
  /** Route hints: a particle pulled softly toward each target, and its own inverse mass. */
  hintI: Int32Array
  hintTarget: Float64Array
  hintCount: number
  hintW: Float64Array
  /** Whether the bending factors were found with pressed particles' weights (weighPressed). */
  pressFactor: boolean
  /** Over-span: the clamped particles bounding the free span, and its rest length. */
  exitA: number
  exitB: number
  freeLength: number
  /** Where the span is measured for the taut flag, in each frame's local coordinates. */
  flagLocalA: Vec3
  flagLocalB: Vec3
  lengthMm: number
  allowanceMm: number
  /** Frame placement at the start of the frame and the target set since. */
  pose0: [Pose, Pose]
  pose1: [Pose, Pose]
  // State
  asleep: boolean
  /** Consecutive frames spent below the sleep speed. */
  quiet: number
  /** Frames awake since it last woke (its window of positions is valid from SLEEP_WINDOW on). */
  age: number
  /** Sleeping bodies of one island share a group and wake together. */
  group: number
  /** Label of the island the body was last in: the smallest body id of its contact component. */
  island: number
  taut: boolean
  scale: number
  /** Index in the world's body list, and in this frame's awake list. */
  index: number
  slot: number
  /** Fastest particle over the last frame, mm/s, and this frame's velocity damping factor. */
  speed: number
  /** Farthest any particle is expected to travel this frame, mm. */
  move: number
  damp: number
  /** Broad-phase padding for this frame: radius, skin and anchor travel. */
  pad: number
  /** Each end frame's pose now (updated per substep when it moves), and whether it moves. */
  apos: [Float64Array, Float64Array]
  amat: [Float64Array, Float64Array]
  endMoving: [boolean, boolean]
  /** Swept bounds of the whole body, used to wake it and to cull colliders. */
  lo: Float64Array
  hi: Float64Array
}

export interface Spec {
  kind: BodyKind
  n: number
  gridCount: number
  rows: number
  columns: number
  wireStart: number
  wireEnd: number
  radius: number
  x0: Float64Array
  w: Float64Array
  constraints: Omit<Constraints, 'dRest' | 'gTarget' | 'bL1' | 'bL2' | 'bD'>
  rig: { innerA: number; innerB: number; lateral: Float64Array } | null
  segI: Int32Array
  segJ: Int32Array
  triA: Int32Array
  triB: Int32Array
  triC: Int32Array
  exitA: number
  exitB: number
  freeLength: number
  flagLocalA: Vec3
  flagLocalB: Vec3
  lengthMm: number
  allowanceMm: number
}
