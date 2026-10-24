// The ribbon's rigid rows. The ribbon is stiff in its own plane and across its width, which a
// grid of stretch and shear constraints cannot hold at one Gauss-Seidel pass per substep (a
// 41 x 7 grid measured up to 31% strain). So each row rides on its centre particle: the centres
// form a chain solved like a lead, and the grid is rebuilt from them, every row straight with
// the true column spacing, all rows turned by the director field the two end frames define.
// The result is inextensible, cannot curve sideways, and bends only about the width axis.
import type { Body } from './body'

/** Row centres from the (predicted) grid: the mean of each free row. */
export function gatherRows(x: Float64Array, b: Body) {
  const rig = b.rig!
  const C = b.columns
  for (let r = rig.innerA + 1; r < rig.innerB; r++) {
    let sx = 0,
      sy = 0,
      sz = 0
    const row = b.first + r * C
    for (let c = 0; c < C; c++) {
      sx += x[3 * (row + c)]!
      sy += x[3 * (row + c) + 1]!
      sz += x[3 * (row + c) + 2]!
    }
    const q = 3 * (rig.qStart + r)
    x[q] = sx / C
    x[q + 1] = sy / C
    x[q + 2] = sz / C
  }
}

/**
 * The row direction a fraction t of the way from unit vector a (the first socket's width axis) to
 * unit vector b (the second's): a turn about a x b through t of the angle between them. A straight
 * blend of the two vectors would shrink to nothing where they point opposite ways, and the rows
 * with it. When they are exactly opposite the turn is about `hint` (the cable's own direction),
 * so the sheet takes a half twist along its length rather than collapsing.
 */
export function turnWidthAxis(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  t: number,
  hint: ArrayLike<number>,
  out: Float64Array
) {
  let kx = a[1]! * b[2]! - a[2]! * b[1]!,
    ky = a[2]! * b[0]! - a[0]! * b[2]!,
    kz = a[0]! * b[1]! - a[1]! * b[0]!
  const s = Math.hypot(kx, ky, kz)
  const d = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  if (s < 1e-9) {
    if (d > 0) {
      out[0] = a[0]!
      out[1] = a[1]!
      out[2] = a[2]!
      return
    }
    // Opposite: turn about the hint with a's component removed (any perpendicular if there is none).
    const h = hint[0]! * a[0]! + hint[1]! * a[1]! + hint[2]! * a[2]!
    kx = hint[0]! - h * a[0]!
    ky = hint[1]! - h * a[1]!
    kz = hint[2]! - h * a[2]!
    let kl = Math.hypot(kx, ky, kz)
    if (kl < 1e-9) {
      // a is along the hint: take the axis least aligned with a, crossed with a.
      const ax = Math.abs(a[0]!) < 0.9 ? 1 : 0
      kx = ax
      ky = 1 - ax
      kz = 0
      const e = kx * a[0]! + ky * a[1]! + kz * a[2]!
      kx -= e * a[0]!
      ky -= e * a[1]!
      kz -= e * a[2]!
      kl = Math.hypot(kx, ky, kz)
    }
    kx /= kl
    ky /= kl
    kz /= kl
  } else {
    kx /= s
    ky /= s
    kz /= s
  }
  // Rodrigues: a turned about k (k is perpendicular to a) through t of the angle to b.
  const phi = t * Math.atan2(s, d)
  const c = Math.cos(phi),
    sn = Math.sin(phi)
  out[0] = a[0]! * c + (ky * a[2]! - kz * a[1]!) * sn
  out[1] = a[1]! * c + (kz * a[0]! - kx * a[2]!) * sn
  out[2] = a[2]! * c + (kx * a[1]! - ky * a[0]!) * sn
}

const wa = new Float64Array(3)
const wb = new Float64Array(3)
const hint = new Float64Array(3)
const mid = new Float64Array(3)
const row = new Float64Array(3)

/**
 * Keeps the centre chain in the plane between the end frames (so the ribbon cannot curve
 * sideways), then lays the free rows out from it.
 */
export function layRows(x: Float64Array, b: Body) {
  const rig = b.rig!
  const C = b.columns
  const { innerA, innerB } = rig
  const qa = 3 * (rig.qStart + innerA)
  const qb = 3 * (rig.qStart + innerB)
  // Row directions come from the end frames' width axes (column 0 of each rotation).
  const ma = b.amat[0],
    mb = b.amat[1]
  wa[0] = ma[0]!
  wa[1] = ma[3]!
  wa[2] = ma[6]!
  wb[0] = mb[0]!
  wb[1] = mb[3]!
  wb[2] = mb[6]!
  hint[0] = x[qb]! - x[qa]!
  hint[1] = x[qb + 1]! - x[qa + 1]!
  hint[2] = x[qb + 2]! - x[qa + 2]!
  turnWidthAxis(wa, wb, 0.5, hint, mid)
  const ux = mid[0]!,
    uy = mid[1]!,
    uz = mid[2]!
  // Sideways offset between the clamped rows is shared out evenly along the span.
  const lb =
    (x[qb]! - x[qa]!) * ux + (x[qb + 1]! - x[qa + 1]!) * uy + (x[qb + 2]! - x[qa + 2]!) * uz
  const span = innerB - innerA
  for (let r = innerA + 1; r < innerB; r++) {
    const q = 3 * (rig.qStart + r)
    const t = (r - innerA) / span
    const l = (x[q]! - x[qa]!) * ux + (x[q + 1]! - x[qa + 1]!) * uy + (x[q + 2]! - x[qa + 2]!) * uz
    const d = t * lb - l
    x[q] = x[q]! + d * ux
    x[q + 1] = x[q + 1]! + d * uy
    x[q + 2] = x[q + 2]! + d * uz
    // Row direction: the end directions blended along the ribbon.
    turnWidthAxis(wa, wb, t, hint, row)
    const ex = row[0]!,
      ey = row[1]!,
      ez = row[2]!
    const rowStart = b.first + r * C
    for (let c = 0; c < C; c++) {
      const s = rig.lateral[c]!
      x[3 * (rowStart + c)] = x[q]! + s * ex
      x[3 * (rowStart + c) + 1] = x[q + 1]! + s * ey
      x[3 * (rowStart + c) + 2] = x[q + 2]! + s * ez
    }
  }
}
