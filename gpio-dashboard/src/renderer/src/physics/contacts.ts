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
  /** Set for each particle a collider contact moved this substep (CableWorld.weighPressed). */
  pressed: Uint8Array
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
/**
 * No particle moves more than this many times the depth a contact is resolving. A contact point
 * near a clamped end rests on one light weight, and moving that particle far enough to clear the
 * point swings the segment: a hair's-breadth overlap kicked a particle 1.7 mm and kept a settled
 * pile ringing. Past the cap the contact clears over a few substeps instead.
 */
const MAX_SHARE = 2

const ci = new Int32Array(6)
const cc = new Float64Array(6)
const o = new Float64Array(8)
const sc = new Float64Array(8)
const disp = new Float64Array(3)
/** Where `colliderMotion` leaves the collider point's displacement over the substep. */
export const contactMotion = disp

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
  let lam = push / denom
  let big = 0
  for (let k = 0; k < count; k++) {
    const share = w[ci[k]!]! * Math.abs(cc[k]!)
    if (share > big) big = share
  }
  if (big * lam > MAX_SHARE * push) lam = (MAX_SHARE * push) / big
  for (let k = 0; k < count; k++) {
    const i3 = ci[k]! * 3
    const f = w[ci[k]!]! * cc[k]! * lam
    x[i3] = x[i3]! + f * nx
    x[i3 + 1] = x[i3 + 1]! + f * ny
    x[i3 + 2] = x[i3 + 2]! + f * nz
  }
  if (!slide) return
  for (let k = 0; k < count; k++) if (cc[k] !== 0) pool.pressed[ci[k]!] = 1
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
export function colliderMotion(c: Collider, wx: number, wy: number, wz: number) {
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
    // A cable lying over one face, inside the other two slabs, is by far the commonest contact:
    // its nearest point is its lower end (or its middle when level) straight down to the face.
    const inX = lax <= c.hx && lax >= -c.hx && lbx <= c.hx && lbx >= -c.hx
    const inY = lay <= c.hy && lay >= -c.hy && lby <= c.hy && lby >= -c.hy
    const inZ = laz <= c.hz && laz >= -c.hz && lbz <= c.hz && lbz >= -c.hz
    let fa = -1
    let la = 0,
      lb = 0,
      lh = 0
    if (inX && inY && !inZ) {
      fa = 2
      la = laz
      lb = lbz
      lh = c.hz
    } else if (inX && inZ && !inY) {
      fa = 1
      la = lay
      lb = lby
      lh = c.hy
    } else if (inY && inZ && !inX) {
      fa = 0
      la = lax
      lb = lbx
      lh = c.hx
    }
    // (both ends must be beyond the same face; a segment that pierces the slab takes the general path)
    if (fa >= 0 && !((la > lh && lb > lh) || (la < -lh && lb < -lh))) fa = -1
    let t: number
    let lnx = 0,
      lny = 0,
      lnz = 0
    let sd: number
    if (fa >= 0) {
      const da = (la > 0 ? la : -la) - lh,
        db = (lb > 0 ? lb : -lb) - lh
      sd = da < db ? da : db
      t = da - db > 1e-9 ? 1 : db - da > 1e-9 ? 0 : 0.5
      const side = la > 0 ? 1 : -1
      if (fa === 2) lnz = side
      else if (fa === 1) lny = side
      else lnx = side
    } else {
      segmentBox(lax, lay, laz, lbx, lby, lbz, c.hx, c.hy, c.hz, o)
      sd = o[4]!
      t = o[0]!
      lnx = o[1]!
      lny = o[2]!
      lnz = o[3]!
    }
    const C = sd - r
    if (C >= 0) return
    const nx = R[0]! * lnx + R[1]! * lny + R[2]! * lnz
    const ny = R[3]! * lnx + R[4]! * lny + R[5]! * lnz
    const nz = R[6]! * lnx + R[7]! * lny + R[8]! * lnz
    // The collider's surface point under the contact.
    const px = x[i3]! + (x[j3]! - x[i3]!) * t - nx * sd
    const py = x[i3 + 1]! + (x[j3 + 1]! - x[i3 + 1]!) * t - ny * sd
    const pz = x[i3 + 2]! + (x[j3 + 2]! - x[i3 + 2]!) * t - nz * sd
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

/**
 * Every rod-to-rod contact of the frame, in list order. A record is [i, j, k, l, slotA, slotB]
 * (the two segments' particles and their bodies' awake slots) with floats [slack, reach], where
 * slack is the gap between the two capsule surfaces when the list was built. A pair whose slack
 * exceeds what the two bodies have moved since cannot touch yet and is passed over unread.
 */
export function solveRodPairs(
  x: Float64Array,
  w: Float64Array,
  d: Int32Array,
  f: Float64Array,
  n: number,
  bound: Float64Array
) {
  for (let s = 0; s < n; s++) {
    const o = 6 * s
    const slack = f[2 * s]!
    if (slack > bound[d[o + 4]!]! + bound[d[o + 5]!]!) continue
    const reach = f[2 * s + 1]!
    const i = d[o]!,
      j = d[o + 1]!,
      k = d[o + 2]!,
      l = d[o + 3]!
    const i3 = i * 3,
      j3 = j * 3,
      k3 = k * 3,
      l3 = l * 3
    const p1x = x[i3]!,
      p1y = x[i3 + 1]!,
      p1z = x[i3 + 2]!
    const d1x = x[j3]! - p1x,
      d1y = x[j3 + 1]! - p1y,
      d1z = x[j3 + 2]! - p1z
    const p2x = x[k3]!,
      p2y = x[k3 + 1]!,
      p2z = x[k3 + 2]!
    const d2x = x[l3]! - p2x,
      d2y = x[l3 + 1]! - p2y,
      d2z = x[l3 + 2]! - p2z
    const rx = p1x - p2x,
      ry = p1y - p2y,
      rz = p1z - p2z
    // Closest points of the two segments (Ericson 5.1.9): parameters sa and tb.
    const a = d1x * d1x + d1y * d1y + d1z * d1z
    const e = d2x * d2x + d2y * d2y + d2z * d2z
    const ff = d2x * rx + d2y * ry + d2z * rz
    let sa: number
    let tb: number
    if (a <= 1e-14 && e <= 1e-14) {
      sa = 0
      tb = 0
    } else if (a <= 1e-14) {
      sa = 0
      tb = ff / e
      tb = tb < 0 ? 0 : tb > 1 ? 1 : tb
    } else {
      const c = d1x * rx + d1y * ry + d1z * rz
      if (e <= 1e-14) {
        tb = 0
        sa = -c / a
        sa = sa < 0 ? 0 : sa > 1 ? 1 : sa
      } else {
        const bb = d1x * d2x + d1y * d2y + d1z * d2z
        const denom = a * e - bb * bb
        if (denom > 1e-14 * a * e) {
          sa = (bb * ff - c * e) / denom
          sa = sa < 0 ? 0 : sa > 1 ? 1 : sa
        } else {
          sa = 0
        }
        tb = (bb * sa + ff) / e
        if (tb < 0) {
          tb = 0
          sa = -c / a
          sa = sa < 0 ? 0 : sa > 1 ? 1 : sa
        } else if (tb > 1) {
          tb = 1
          sa = (bb - c) / a
          sa = sa < 0 ? 0 : sa > 1 ? 1 : sa
        }
      }
    }
    let nx = rx + d1x * sa - d2x * tb,
      ny = ry + d1y * sa - d2y * tb,
      nz = rz + d1z * sa - d2z * tb
    const dist2 = nx * nx + ny * ny + nz * nz
    if (dist2 >= reach * reach) continue
    const dist = Math.sqrt(dist2)
    if (dist < 1e-9) {
      // Crossing exactly: push apart along the common perpendicular, else straight up.
      nx = d1y * d2z - d1z * d2y
      ny = d1z * d2x - d1x * d2z
      nz = d1x * d2y - d1y * d2x
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
      nx /= dist
      ny /= dist
      nz /= dist
    }
    const a0 = 1 - sa,
      b0 = 1 - tb
    const wi = w[i]!,
      wj = w[j]!,
      wk = w[k]!,
      wl = w[l]!
    const denom = wi * a0 * a0 + wj * sa * sa + wk * b0 * b0 + wl * tb * tb
    if (denom <= 0) continue
    // A deep overlap is pushed out over several substeps.
    const push = Math.min(reach - dist, MAX_PUSH)
    const lam = push / denom
    let fi = wi * a0 * lam,
      fj = wj * sa * lam,
      fk = wk * b0 * lam,
      fl = wl * tb * lam
    const big = Math.max(fi, fj, fk, fl)
    if (big > MAX_SHARE * push) {
      const scale = (MAX_SHARE * push) / big
      fi *= scale
      fj *= scale
      fk *= scale
      fl *= scale
    }
    x[i3] = x[i3]! + fi * nx
    x[i3 + 1] = x[i3 + 1]! + fi * ny
    x[i3 + 2] = x[i3 + 2]! + fi * nz
    x[j3] = x[j3]! + fj * nx
    x[j3 + 1] = x[j3 + 1]! + fj * ny
    x[j3 + 2] = x[j3 + 2]! + fj * nz
    x[k3] = x[k3]! - fk * nx
    x[k3 + 1] = x[k3 + 1]! - fk * ny
    x[k3 + 2] = x[k3 + 2]! - fk * nz
    x[l3] = x[l3]! - fl * nx
    x[l3 + 1] = x[l3 + 1]! - fl * ny
    x[l3 + 2] = x[l3 + 2]! - fl * nz
  }
}

/** Rod segments (or ribbon particles) against colliders; records [i, j | -1, collider, slot], floats [slack, radius]. */
export function solveSurfaces(
  pool: Pool,
  colliders: Collider[],
  d: Int32Array,
  f: Float64Array,
  n: number,
  bound: Float64Array
) {
  for (let s = 0; s < n; s++) {
    const o = 4 * s
    const c = colliders[d[o + 2]!]!
    // A moving collider can close any gap, so its candidates are always read.
    if (!c.moving && f[2 * s]! > bound[d[o + 3]!]!) continue
    const r = f[2 * s + 1]!
    if (d[o + 1]! >= 0) contactSegmentCollider(pool, c, d[o]!, d[o + 1]!, r)
    else contactParticleCollider(pool, c, d[o]!, r)
  }
}

/** Rod segments against ribbon triangles; records [i, j, a, b, c, slotA, slotB], floats [slack, reach]. */
export function solveRibbonPairs(
  pool: Pool,
  samples: readonly number[],
  d: Int32Array,
  f: Float64Array,
  n: number,
  bound: Float64Array
) {
  for (let s = 0; s < n; s++) {
    const o = 7 * s
    if (f[2 * s]! > bound[d[o + 5]!]! + bound[d[o + 6]!]!) continue
    const reach = f[2 * s + 1]!
    for (let q = 0; q < samples.length; q++) {
      contactPointTriangle(
        pool,
        d[o]!,
        d[o + 1]!,
        samples[q]!,
        d[o + 2]!,
        d[o + 3]!,
        d[o + 4]!,
        reach
      )
    }
  }
}

/**
 * Signed gap, mm, between a rod segment i-j (a capsule of radius r) and a collider: negative while
 * they overlap. Measured on the current positions and the collider's current pose.
 */
export function gapSegmentCollider(x: Float64Array, c: Collider, i: number, j: number, r: number) {
  const i3 = i * 3,
    j3 = j * 3
  const { p, R } = c
  if (!c.isBox) {
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
    return Math.sqrt(d2) - r - c.radius
  }
  const ax = x[i3]! - p[0]!,
    ay = x[i3 + 1]! - p[1]!,
    az = x[i3 + 2]! - p[2]!
  const bx = x[j3]! - p[0]!,
    by = x[j3 + 1]! - p[1]!,
    bz = x[j3 + 2]! - p[2]!
  segmentBox(
    R[0]! * ax + R[3]! * ay + R[6]! * az,
    R[1]! * ax + R[4]! * ay + R[7]! * az,
    R[2]! * ax + R[5]! * ay + R[8]! * az,
    R[0]! * bx + R[3]! * by + R[6]! * bz,
    R[1]! * bx + R[4]! * by + R[7]! * bz,
    R[2]! * bx + R[5]! * by + R[8]! * bz,
    c.hx,
    c.hy,
    c.hz,
    o
  )
  return o[4]! - r
}

/** Signed gap, mm, between a particle (a ball of radius r) and a collider. */
export function gapParticleCollider(x: Float64Array, c: Collider, i: number, r: number) {
  return gapSegmentCollider(x, c, i, i, r)
}

/** Squared distance from the point `ts` of the way along rod segment i-j to triangle a-b-c. */
export function gapPointTriangle(
  x: Float64Array,
  i: number,
  j: number,
  ts: number,
  a: number,
  b: number,
  c: number
) {
  const i3 = i * 3,
    j3 = j * 3,
    a3 = a * 3,
    b3 = b * 3,
    c3 = c * 3
  return closestPointTriangle(
    x[i3]! + (x[j3]! - x[i3]!) * ts,
    x[i3 + 1]! + (x[j3 + 1]! - x[i3 + 1]!) * ts,
    x[i3 + 2]! + (x[j3 + 2]! - x[i3 + 2]!) * ts,
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
}
