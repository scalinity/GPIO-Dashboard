// Small vector and quaternion helpers. Hot code works on typed arrays; these cover set-up and
// the per-substep frame interpolation.
import type { Pose, Quat } from './types'

export const IDENTITY: Quat = [0, 0, 0, 1]

/** Row-major 3x3 rotation matrix from a unit quaternion. */
export function quatToMat(q: Quat, m: Float64Array): void {
  const [x, y, z, w] = q
  const xx = x * x,
    yy = y * y,
    zz = z * z
  m[0] = 1 - 2 * (yy + zz)
  m[1] = 2 * (x * y - w * z)
  m[2] = 2 * (x * z + w * y)
  m[3] = 2 * (x * y + w * z)
  m[4] = 1 - 2 * (xx + zz)
  m[5] = 2 * (y * z - w * x)
  m[6] = 2 * (x * z - w * y)
  m[7] = 2 * (y * z + w * x)
  m[8] = 1 - 2 * (xx + yy)
}

export function normalizeQuat(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3])
  return n < 1e-12 ? IDENTITY : [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

/** Normalized lerp along the shorter arc; exact enough for the small per-substep steps. */
export function nlerp(a: Quat, b: Quat, t: number): Quat {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1
  return normalizeQuat([
    a[0] + (s * b[0] - a[0]) * t,
    a[1] + (s * b[1] - a[1]) * t,
    a[2] + (s * b[2] - a[2]) * t,
    a[3] + (s * b[3] - a[3]) * t
  ])
}

/** Writes pose(t) between `p0` and `p1`: the origin into `pos`, the rotation into `mat`. */
export function posedAt(p0: Pose, p1: Pose, t: number, pos: Float64Array, mat: Float64Array) {
  pos[0] = p0.position[0] + (p1.position[0] - p0.position[0]) * t
  pos[1] = p0.position[1] + (p1.position[1] - p0.position[1]) * t
  pos[2] = p0.position[2] + (p1.position[2] - p0.position[2]) * t
  quatToMat(t >= 1 ? p1.rotation : nlerp(p0.rotation, p1.rotation, t), mat)
}

/** Rotates the local vector by `mat` (row-major) and adds `pos`; writes into `out` at `o`. */
export function toWorld(
  pos: Float64Array,
  mat: Float64Array,
  lx: number,
  ly: number,
  lz: number,
  out: Float64Array,
  o: number
) {
  out[o] = pos[0]! + mat[0]! * lx + mat[1]! * ly + mat[2]! * lz
  out[o + 1] = pos[1]! + mat[3]! * lx + mat[4]! * ly + mat[5]! * lz
  out[o + 2] = pos[2]! + mat[6]! * lx + mat[7]! * ly + mat[8]! * lz
}

/** The inverse of `toWorld`: world point to the frame's local coordinates. */
export function toLocal(
  pos: Float64Array,
  mat: Float64Array,
  wx: number,
  wy: number,
  wz: number,
  out: Float64Array,
  o: number
) {
  const dx = wx - pos[0]!,
    dy = wy - pos[1]!,
    dz = wz - pos[2]!
  out[o] = mat[0]! * dx + mat[3]! * dy + mat[6]! * dz
  out[o + 1] = mat[1]! * dx + mat[4]! * dy + mat[7]! * dz
  out[o + 2] = mat[2]! * dx + mat[5]! * dy + mat[8]! * dz
}

export function samePose(a: Pose, b: Pose): boolean {
  return (
    Math.abs(a.position[0] - b.position[0]) < 1e-9 &&
    Math.abs(a.position[1] - b.position[1]) < 1e-9 &&
    Math.abs(a.position[2] - b.position[2]) < 1e-9 &&
    Math.abs(a.rotation[0] - b.rotation[0]) < 1e-9 &&
    Math.abs(a.rotation[1] - b.rotation[1]) < 1e-9 &&
    Math.abs(a.rotation[2] - b.rotation[2]) < 1e-9 &&
    Math.abs(a.rotation[3] - b.rotation[3]) < 1e-9
  )
}

/** mulberry32: a tiny seeded generator, so a seed fixes every jitter the solver adds. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
