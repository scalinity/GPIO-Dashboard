// Public types of the cable solver (SPEC 10.5). Units are mm, g and s; the frame is the core table
// frame (z up). Nothing here knows about the document: callers map anchors and colliders onto it.
import type { Vec3 } from '../core/model/types'

export type { Vec3 }

/** Unit quaternion as [x, y, z, w]. */
export type Quat = readonly [number, number, number, number]

/** A rigid frame: where a socket or housing is, and how it is turned. */
export interface Pose {
  position: Vec3
  rotation: Quat
}

export type ColliderShape =
  | { kind: 'box'; halfExtents: Vec3 }
  /** The axis runs along the collider's local z, `halfLength` each way from the centre. */
  | { kind: 'capsule'; radius: number; halfLength: number }

export type BodyId = number
export type ColliderId = number
export type BodyKind = 'ribbon' | 'lead' | 'jumper'

/**
 * The ribbon runs from frame `a` to frame `b`. In each frame the cable enters along +y with
 * its width along x and its thickness along z, and the first and last clamped rows sit in the
 * frame (so both sockets must agree on which conductor is at which x).
 */
export interface RibbonDef {
  a: Pose
  b: Pose
  /** Overall length including the clamped ends; defaults to the ribbon data's 200 mm. */
  lengthMm?: number
  /** Particles across the width, 5 to 9; defaults to 7. */
  columns?: number
  /** Centreline of the starting shape (a design curve); defaults to an arch between the frames. */
  guess?: readonly Vec3[]
}

/**
 * A Dupont lead. Each frame sits at the housing base with +z along the housing axis (up out of
 * a hole), so a housing in a hole stands vertical and the wire leaves its tip. `lengthMm` is the
 * wire between the two housing tips.
 */
export interface LeadDef {
  a: Pose
  b: Pose
  lengthMm: number
  guess?: readonly Vec3[]
}

/**
 * A solid jumper. Frames sit where the wire enters its holes; `shape` is the authored bend as a
 * polyline from the first frame's origin to the second's, in the poses given here.
 */
export interface JumperDef {
  a: Pose
  b: Pose
  shape: readonly Vec3[]
}

export interface BodyInfo {
  kind: BodyKind
  /** Particles in `positions(id)`, three floats each. */
  particles: number
  /** Ribbon: rows along the length and columns across (row-major). Rods: one column. */
  rows: number
  columns: number
  /** The particles worth drawing: [wireStart, wireEnd). A lead's housing particles lie outside. */
  wireStart: number
  wireEnd: number
}

export interface WorldOptions {
  /** Seeds the symmetry-breaking jitter of new bodies. */
  seed?: number
  /** Substeps per 1/60 s frame; the default is 12. */
  substeps?: number
  /** Pool size; positions views stay valid while it holds. */
  maxParticles?: number
  /** Time each phase of every step; read it back with `phaseTimes()`. Off by default. */
  profile?: boolean
}
