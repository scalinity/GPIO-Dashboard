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
  let ux = ma[0]! + mb[0]!,
    uy = ma[3]! + mb[3]!,
    uz = ma[6]! + mb[6]!
  const ul = Math.hypot(ux, uy, uz) || 1
  ux /= ul
  uy /= ul
  uz /= ul
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
    let ex = (1 - t) * ma[0]! + t * mb[0]!
    let ey = (1 - t) * ma[3]! + t * mb[3]!
    let ez = (1 - t) * ma[6]! + t * mb[6]!
    const el = Math.hypot(ex, ey, ez) || 1
    ex /= el
    ey /= el
    ez /= el
    const row = b.first + r * C
    for (let c = 0; c < C; c++) {
      const s = rig.lateral[c]!
      x[3 * (row + c)] = x[q]! + s * ex
      x[3 * (row + c) + 1] = x[q + 1]! + s * ey
      x[3 * (row + c) + 2] = x[q + 2]! + s * ez
    }
  }
}
