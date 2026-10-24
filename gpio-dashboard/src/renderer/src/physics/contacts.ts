// Contact projection. A contact is C = n . (pA - pB) - r >= 0, where each side is a weighted point
// on up to three particles. One projection per substep, as for the other constraints; friction
// follows Macklin et al., "Unified Particle Physics for Real-Time Applications" (2014): the
// relative tangential motion this substep is cancelled up to the Coulomb limit, scaled by the
// depth just resolved.
import { closestPointTriangle, closestSegSeg, pointBox, segmentBox } from './shapes'
import type { Pose } from './types'

export interface Pool {
  x: Float64Array
  xp: Float64Array
  w: Float64Array
}

export interface Collider {
  id: number
  isBox: boolean
  hx: number
  hy: number
  hz: number
  radius: number
  halfLength: number
  /** Placement at the start of the frame and the target set since. */
  f0: Pose
  f1: Pose
  moving: boolean
  /** Pose now (end of the current substep) and at the start of it; R is row-major. */
  p: Float64Array
  R: Float64Array
  p0: Float64Array
  R0: Float64Array
  /** World bounds, swept over the frame. */
  lo: Float64Array
  hi: Float64Array
}

/** Static and kinetic Coulomb coefficients for PVC on plastic. */
/** Static and kinetic Coulomb coefficients of the cable against a surface (PVC on plastic). */
const MU_STATIC = 0.5
const MU_KINETIC = 0.4
/** Most a contact moves its points along the normal in one substep, mm. */
const MAX_PUSH = 1

const ci = new Int32Array(6)
const cc = new Float64Array(6)
const o = new Float64Array(8)
const sc = new Float64Array(8)
const disp = new Float64Array(3)

function resolve(
  pool: Pool,
  count: number,
  nx: number,
  ny: number,
  nz: number,
  C: number,
  dbx: number,
  dby: number,
  dbz: number,
  slide: boolean
) {
  const { x, xp, w } = pool
  let denom = 0
  for (let k = 0; k < count; k++) denom += w[ci[k]!]! * cc[k]! * cc[k]!
  if (denom <= 0) return
  // A deep overlap (a design curve drawn through something) is pushed out over several substeps.
  const push = Math.min(-C, MAX_PUSH)
  const lam = push / denom
  for (let k = 0; k < count; k++) {
    const i3 = ci[k]! * 3
    const f = w[ci[k]!]! * cc[k]! * lam
    x[i3] = x[i3]! + f * nx
    x[i3 + 1] = x[i3 + 1]! + f * ny
    x[i3 + 2] = x[i3 + 2]! + f * nz
  }
  if (!slide) return
  // Friction: relative motion of the two contact points since the substep began.
  let rx = -dbx,
    ry = -dby,
    rz = -dbz
  for (let k = 0; k < count; k++) {
    const i3 = ci[k]! * 3
    rx += cc[k]! * (x[i3]! - xp[i3]!)
    ry += cc[k]! * (x[i3 + 1]! - xp[i3 + 1]!)
    rz += cc[k]! * (x[i3 + 2]! - xp[i3 + 2]!)
  }
  const rn = rx * nx + ry * ny + rz * nz
  const tx = rx - rn * nx,
    ty = ry - rn * ny,
    tz = rz - rn * nz
  const tn = Math.sqrt(tx * tx + ty * ty + tz * tz)
  if (tn < 1e-12) return
  const s = tn < MU_STATIC * push ? 1 : Math.min(1, (MU_KINETIC * push) / tn)
  const lamF = (-s * tn) / denom / tn
  for (let k = 0; k < count; k++) {
    const i3 = ci[k]! * 3
    const f = w[ci[k]!]! * cc[k]! * lamF
    x[i3] = x[i3]! + f * tx
    x[i3 + 1] = x[i3 + 1]! + f * ty
    x[i3 + 2] = x[i3 + 2]! + f * tz
  }
}

/** How far the collider's own point at world position (wx, wy, wz) moved this substep. */
function colliderMotion(c: Collider, wx: number, wy: number, wz: number) {
  if (!c.moving) {
    disp[0] = disp[1] = disp[2] = 0
    return
  }
  const { p, R, p0, R0 } = c
  const dx = wx - p[0]!,
    dy = wy - p[1]!,
    dz = wz - p[2]!
  const lx = R[0]! * dx + R[3]! * dy + R[6]! * dz
  const ly = R[1]! * dx + R[4]! * dy + R[7]! * dz
  const lz = R[2]! * dx + R[5]! * dy + R[8]! * dz
  disp[0] = wx - (p0[0]! + R0[0]! * lx + R0[1]! * ly + R0[2]! * lz)
  disp[1] = wy - (p0[1]! + R0[3]! * lx + R0[4]! * ly + R0[5]! * lz)
  disp[2] = wz - (p0[2]! + R0[6]! * lx + R0[7]! * ly + R0[8]! * lz)
}

/** A rod segment i-j (a capsule of radius r) against a collider. */
export function contactSegmentCollider(pool: Pool, c: Collider, i: number, j: number, r: number) {
  const { x } = pool
  const i3 = i * 3,
    j3 = j * 3
  const { p, R } = c
  if (c.isBox) {
    const ax = x[i3]! - p[0]!,
      ay = x[i3 + 1]! - p[1]!,
      az = x[i3 + 2]! - p[2]!
    const bx = x[j3]! - p[0]!,
      by = x[j3 + 1]! - p[1]!,
      bz = x[j3 + 2]! - p[2]!
    const lax = R[0]! * ax + R[3]! * ay + R[6]! * az,
      lay = R[1]! * ax + R[4]! * ay + R[7]! * az,
      laz = R[2]! * ax + R[5]! * ay + R[8]! * az
    const lbx = R[0]! * bx + R[3]! * by + R[6]! * bz,
      lby = R[1]! * bx + R[4]! * by + R[7]! * bz,
      lbz = R[2]! * bx + R[5]! * by + R[8]! * bz
    // Both ends beyond the same face by more than the radius: no contact, and most candidates are.
    const hx = c.hx + r,
      hy = c.hy + r,
      hz = c.hz + r
    if (
      (lax > hx && lbx > hx) ||
      (lax < -hx && lbx < -hx) ||
      (lay > hy && lby > hy) ||
      (lay < -hy && lby < -hy) ||
      (laz > hz && lbz > hz) ||
      (laz < -hz && lbz < -hz)
    ) {
      return
    }
    segmentBox(lax, lay, laz, lbx, lby, lbz, c.hx, c.hy, c.hz, o)
    const C = o[4]! - r
    if (C >= 0) return
    const t = o[0]!
    const nx = R[0]! * o[1]! + R[1]! * o[2]! + R[2]! * o[3]!
    const ny = R[3]! * o[1]! + R[4]! * o[2]! + R[5]! * o[3]!
    const nz = R[6]! * o[1]! + R[7]! * o[2]! + R[8]! * o[3]!
    // The collider's surface point under the contact.
    const px = x[i3]! + (x[j3]! - x[i3]!) * t - nx * o[4]!
    const py = x[i3 + 1]! + (x[j3 + 1]! - x[i3 + 1]!) * t - ny * o[4]!
    const pz = x[i3 + 2]! + (x[j3 + 2]! - x[i3 + 2]!) * t - nz * o[4]!
    colliderMotion(c, px, py, pz)
    ci[0] = i
    ci[1] = j
    cc[0] = 1 - t
    cc[1] = t
    resolve(pool, 2, nx, ny, nz, C, disp[0]!, disp[1]!, disp[2]!, true)
    return
  }
  capsuleContact(pool, c, i3, j3, r, i, j)
}

function capsuleContact(
  pool: Pool,
  c: Collider,
  i3: number,
  j3: number,
  r: number,
  i: number,
  j: number
) {
  const { x } = pool
  const { p, R } = c
  const ex = R[2]! * c.halfLength,
    ey = R[5]! * c.halfLength,
    ez = R[8]! * c.halfLength
  const d2 = closestSegSeg(
    x[i3]!,
    x[i3 + 1]!,
    x[i3 + 2]!,
    x[j3]!,
    x[j3 + 1]!,
    x[j3 + 2]!,
    p[0]! - ex,
    p[1]! - ey,
    p[2]! - ez,
    p[0]! + ex,
    p[1]! + ey,
    p[2]! + ez,
    sc
  )
  const reach = r + c.radius
  if (d2 >= reach * reach) return
  const s = sc[0]!,
    t = sc[1]!
  const qx = p[0]! - ex + 2 * ex * t,
    qy = p[1]! - ey + 2 * ey * t,
    qz = p[2]! - ez + 2 * ez * t
  let nx = x[i3]! + (x[j3]! - x[i3]!) * s - qx
  let ny = x[i3 + 1]! + (x[j3 + 1]! - x[i3 + 1]!) * s - qy
  let nz = x[i3 + 2]! + (x[j3 + 2]! - x[i3 + 2]!) * s - qz
  const d = Math.sqrt(d2)
  if (d < 1e-9) {
    nx = R[0]!
    ny = R[3]!
    nz = R[6]!
  } else {
    nx /= d
    ny /= d
    nz /= d
  }
  colliderMotion(c, qx + nx * c.radius, qy + ny * c.radius, qz + nz * c.radius)
  ci[0] = i
  ci[1] = j
  cc[0] = 1 - s
  cc[1] = s
  resolve(pool, 2, nx, ny, nz, d - reach, disp[0]!, disp[1]!, disp[2]!, true)
}

/** A single particle (a ribbon point of radius r) against a collider. */
export function contactParticleCollider(pool: Pool, c: Collider, i: number, r: number) {
  const { x } = pool
  const i3 = i * 3
  const { p, R } = c
  if (c.isBox) {
    const ax = x[i3]! - p[0]!,
      ay = x[i3 + 1]! - p[1]!,
      az = x[i3 + 2]! - p[2]!
    pointBox(
      R[0]! * ax + R[3]! * ay + R[6]! * az,
      R[1]! * ax + R[4]! * ay + R[7]! * az,
      R[2]! * ax + R[5]! * ay + R[8]! * az,
      c.hx,
      c.hy,
      c.hz,
      o
    )
    const C = o[3]! - r
    if (C >= 0) return
    const nx = R[0]! * o[0]! + R[1]! * o[1]! + R[2]! * o[2]!
    const ny = R[3]! * o[0]! + R[4]! * o[1]! + R[5]! * o[2]!
    const nz = R[6]! * o[0]! + R[7]! * o[1]! + R[8]! * o[2]!
    colliderMotion(c, x[i3]! - nx * o[3]!, x[i3 + 1]! - ny * o[3]!, x[i3 + 2]! - nz * o[3]!)
    ci[0] = i
    cc[0] = 1
    resolve(pool, 1, nx, ny, nz, C, disp[0]!, disp[1]!, disp[2]!, true)
    return
  }
  capsuleContact(pool, c, i3, i3, r, i, i)
  // With both ends the same particle the two weights add to one on it.
}

/** Rod segment i-j against rod segment k-l (capsule-capsule). */
export function contactSegmentSegment(
  pool: Pool,
  i: number,
  j: number,
  k: number,
  l: number,
  reach: number
) {
  const { x } = pool
  const i3 = i * 3,
    j3 = j * 3,
    k3 = k * 3,
    l3 = l * 3
  const d2 = closestSegSeg(
    x[i3]!,
    x[i3 + 1]!,
    x[i3 + 2]!,
    x[j3]!,
    x[j3 + 1]!,
    x[j3 + 2]!,
    x[k3]!,
    x[k3 + 1]!,
    x[k3 + 2]!,
    x[l3]!,
    x[l3 + 1]!,
    x[l3 + 2]!,
    sc
  )
  if (d2 >= reach * reach) return
  const s = sc[0]!,
    t = sc[1]!
  let nx = x[i3]! + (x[j3]! - x[i3]!) * s - (x[k3]! + (x[l3]! - x[k3]!) * t)
  let ny = x[i3 + 1]! + (x[j3 + 1]! - x[i3 + 1]!) * s - (x[k3 + 1]! + (x[l3 + 1]! - x[k3 + 1]!) * t)
  let nz = x[i3 + 2]! + (x[j3 + 2]! - x[i3 + 2]!) * s - (x[k3 + 2]! + (x[l3 + 2]! - x[k3 + 2]!) * t)
  const d = Math.sqrt(d2)
  if (d < 1e-9) {
    // Crossing exactly: push apart along the common perpendicular, else straight up.
    const ax = x[j3]! - x[i3]!,
      ay = x[j3 + 1]! - x[i3 + 1]!,
      az = x[j3 + 2]! - x[i3 + 2]!
    const bx = x[l3]! - x[k3]!,
      by = x[l3 + 1]! - x[k3 + 1]!,
      bz = x[l3 + 2]! - x[k3 + 2]!
    nx = ay * bz - az * by
    ny = az * bx - ax * bz
    nz = ax * by - ay * bx
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (nl < 1e-12) {
      nx = 0
      ny = 0
      nz = 1
    } else {
      nx /= nl
      ny /= nl
      nz /= nl
    }
  } else {
    nx /= d
    ny /= d
    nz /= d
  }
  ci[0] = i
  ci[1] = j
  ci[2] = k
  ci[3] = l
  cc[0] = 1 - s
  cc[1] = s
  cc[2] = -(1 - t)
  cc[3] = -t
  resolve(pool, 4, nx, ny, nz, d - reach, 0, 0, 0, false)
}

/** The point at fraction `ts` along rod segment i-j against ribbon triangle a-b-c. */
export function contactPointTriangle(
  pool: Pool,
  i: number,
  j: number,
  ts: number,
  a: number,
  b: number,
  c: number,
  reach: number
) {
  const { x } = pool
  const i3 = i * 3,
    j3 = j * 3,
    a3 = a * 3,
    b3 = b * 3,
    c3 = c * 3
  const px = x[i3]! + (x[j3]! - x[i3]!) * ts
  const py = x[i3 + 1]! + (x[j3 + 1]! - x[i3 + 1]!) * ts
  const pz = x[i3 + 2]! + (x[j3 + 2]! - x[i3 + 2]!) * ts
  const d2 = closestPointTriangle(
    px,
    py,
    pz,
    x[a3]!,
    x[a3 + 1]!,
    x[a3 + 2]!,
    x[b3]!,
    x[b3 + 1]!,
    x[b3 + 2]!,
    x[c3]!,
    x[c3 + 1]!,
    x[c3 + 2]!,
    sc
  )
  if (d2 >= reach * reach) return
  const u = sc[0]!,
    v = sc[1]!,
    wt = sc[2]!
  let nx = px - (u * x[a3]! + v * x[b3]! + wt * x[c3]!)
  let ny = py - (u * x[a3 + 1]! + v * x[b3 + 1]! + wt * x[c3 + 1]!)
  let nz = pz - (u * x[a3 + 2]! + v * x[b3 + 2]! + wt * x[c3 + 2]!)
  const d = Math.sqrt(d2)
  if (d < 1e-9) {
    const e1x = x[b3]! - x[a3]!,
      e1y = x[b3 + 1]! - x[a3 + 1]!,
      e1z = x[b3 + 2]! - x[a3 + 2]!
    const e2x = x[c3]! - x[a3]!,
      e2y = x[c3 + 1]! - x[a3 + 1]!,
      e2z = x[c3 + 2]! - x[a3 + 2]!
    nx = e1y * e2z - e1z * e2y
    ny = e1z * e2x - e1x * e2z
    nz = e1x * e2y - e1y * e2x
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= nl
    ny /= nl
    nz /= nl
  } else {
    nx /= d
    ny /= d
    nz /= d
  }
  ci[0] = i
  ci[1] = j
  ci[2] = a
  ci[3] = b
  ci[4] = c
  cc[0] = 1 - ts
  cc[1] = ts
  cc[2] = -u
  cc[3] = -v
  cc[4] = -wt
  resolve(pool, 5, nx, ny, nz, d - reach, 0, 0, 0, false)
}
