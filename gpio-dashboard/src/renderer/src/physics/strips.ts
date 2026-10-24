// Ribbon strips against box colliders (SPEC 10.5, ADR-0061).
//
// The ribbon's grid particles are 5 mm apart along its length and 8.5 mm across, so a collider
// thinner than that (a Dupont housing 2.54 mm wide, the T-board's 1.6 mm PCB, a socket's edge)
// can stand between them, and a particle-only test never sees it. The sheet is the surface
// between neighbouring rows, and its rows are straight: a strip is two triangles on its four
// corner particles. Each triangle is tested against the box as a whole (a separating-axis test on
// the box inflated by half the sheet's thickness) and, when they overlap, both rows of the strip
// are carried clear together. Rows are rigid (ribbon.ts re-lays every row from its centre each
// substep), so moving a whole row is the push that sticks; pushing one grid particle moved the
// row's centre by only 1/columns of it.
import { colliderMotion, contactMotion } from './contacts'
import type { Collider, Pool } from './contacts'

/** Coulomb coefficients of the sheet on plastic, as for the cables. */
const MU_STATIC = 0.5
const MU_KINETIC = 0.4
/** Most a strip is moved along the normal in one substep, mm. */
const MAX_PUSH = 1

/** After `triangleBox` returns true: the distance to move the triangle, then the direction. */
export const exit = new Float64Array(4)

// The best separating axis found so far (box-local), and how far the triangle must move along it.
let bestDepth = 0
let bestX = 0
let bestY = 0
let bestZ = 0

/**
 * One candidate axis of the triangle t (nine numbers, box-local) against the box of half extents
 * h centred on the origin. Returns false when the axis separates them.
 */
function axis(
  t: Float64Array,
  ax: number,
  ay: number,
  az: number,
  hx: number,
  hy: number,
  hz: number
): boolean {
  const l2 = ax * ax + ay * ay + az * az
  if (l2 < 1e-12) return true
  const inv = 1 / Math.sqrt(l2)
  ax *= inv
  ay *= inv
  az *= inv
  const p0 = t[0]! * ax + t[1]! * ay + t[2]! * az
  const p1 = t[3]! * ax + t[4]! * ay + t[5]! * az
  const p2 = t[6]! * ax + t[7]! * ay + t[8]! * az
  const lo = Math.min(p0, p1, p2)
  const hi = Math.max(p0, p1, p2)
  const rho = hx * Math.abs(ax) + hy * Math.abs(ay) + hz * Math.abs(az)
  // Moving the triangle along +axis by `plus` clears the box; along -axis, by `minus`.
  const plus = rho - lo
  const minus = hi + rho
  if (plus <= 0 || minus <= 0) return false
  if (plus < bestDepth) {
    bestDepth = plus
    bestX = ax
    bestY = ay
    bestZ = az
  }
  if (minus < bestDepth) {
    bestDepth = minus
    bestX = -ax
    bestY = -ay
    bestZ = -az
  }
  return true
}

/**
 * Whether triangle t overlaps the box, by the separating-axis theorem (the box's three faces, the
 * triangle's plane and the nine edge pairs). When it does, bestDepth and (bestX, bestY, bestZ)
 * give the shortest way out: the distance to move the triangle, and the direction.
 */
export function triangleBox(t: Float64Array, hx: number, hy: number, hz: number): boolean {
  bestDepth = Infinity
  if (!axis(t, 1, 0, 0, hx, hy, hz)) return false
  if (!axis(t, 0, 1, 0, hx, hy, hz)) return false
  if (!axis(t, 0, 0, 1, hx, hy, hz)) return false
  const e0x = t[3]! - t[0]!,
    e0y = t[4]! - t[1]!,
    e0z = t[5]! - t[2]!
  const e1x = t[6]! - t[3]!,
    e1y = t[7]! - t[4]!,
    e1z = t[8]! - t[5]!
  const e2x = t[0]! - t[6]!,
    e2y = t[1]! - t[7]!,
    e2z = t[2]! - t[8]!
  if (!axis(t, e0y * e1z - e0z * e1y, e0z * e1x - e0x * e1z, e0x * e1y - e0y * e1x, hx, hy, hz)) {
    return false
  }
  // Edge directions crossed with the box axes: E x X = (0, ez, -ey), E x Y = (-ez, 0, ex), E x Z = (ey, -ex, 0).
  if (!axis(t, 0, e0z, -e0y, hx, hy, hz)) return false
  if (!axis(t, -e0z, 0, e0x, hx, hy, hz)) return false
  if (!axis(t, e0y, -e0x, 0, hx, hy, hz)) return false
  if (!axis(t, 0, e1z, -e1y, hx, hy, hz)) return false
  if (!axis(t, -e1z, 0, e1x, hx, hy, hz)) return false
  if (!axis(t, e1y, -e1x, 0, hx, hy, hz)) return false
  if (!axis(t, 0, e2z, -e2y, hx, hy, hz)) return false
  if (!axis(t, -e2z, 0, e2x, hx, hy, hz)) return false
  if (!axis(t, e2y, -e2x, 0, hx, hy, hz)) return false
  exit[0] = bestDepth
  exit[1] = bestX
  exit[2] = bestY
  exit[3] = bestZ
  return true
}

const local = new Float64Array(12)
const corner = new Int32Array(4)
const tri = new Float64Array(9)

/** Corners of the strip (a0, a1, b0, b1) are triangles (a0, a1, b0) and (a1, b1, b0). */
const TRIANGLES = [
  [0, 1, 2],
  [1, 3, 2]
] as const

/**
 * Strip between rows A and B of a ribbon against a box. `rowA` and `rowB` are the rows' first grid
 * particles, `qa` and `qb` their centre particles, and `r` is half the sheet's thickness.
 *
 * Along the separating axis a triangle clears the box exactly when each of its corners does, so
 * each row is carried clear by the depth of its own deepest corner and no more. (Moving both rows
 * by the triangle's deepest corner lifted a row that was resting on the surface: it hopped.)
 */
export function contactStrip(
  pool: Pool,
  c: Collider,
  rowA: number,
  rowB: number,
  qa: number,
  qb: number,
  cols: number,
  r: number
) {
  const { x, w } = pool
  const wa = w[qa]!,
    wb = w[qb]!
  if (wa + wb <= 0) return
  corner[0] = rowA
  corner[1] = rowA + cols - 1
  corner[2] = rowB
  corner[3] = rowB + cols - 1
  const { p, R } = c
  const hx = c.hx + r,
    hy = c.hy + r,
    hz = c.hz + r
  for (let t = 0; t < 2; t++) {
    // The corners again for each triangle: the first one's push has moved them.
    for (let k = 0; k < 4; k++) {
      const i3 = corner[k]! * 3
      const dx = x[i3]! - p[0]!,
        dy = x[i3 + 1]! - p[1]!,
        dz = x[i3 + 2]! - p[2]!
      local[3 * k] = R[0]! * dx + R[3]! * dy + R[6]! * dz
      local[3 * k + 1] = R[1]! * dx + R[4]! * dy + R[7]! * dz
      local[3 * k + 2] = R[2]! * dx + R[5]! * dy + R[8]! * dz
    }
    const v = TRIANGLES[t]!
    for (let k = 0; k < 3; k++) {
      tri[3 * k] = local[3 * v[k]!]!
      tri[3 * k + 1] = local[3 * v[k]! + 1]!
      tri[3 * k + 2] = local[3 * v[k]! + 2]!
    }
    if (!triangleBox(tri, hx, hy, hz)) continue
    const rho = hx * Math.abs(bestX) + hy * Math.abs(bestY) + hz * Math.abs(bestZ)
    // The deepest corner of each row along the way out.
    let depthA = 0,
      depthB = 0
    for (let k = 0; k < 3; k++) {
      const depth = rho - (tri[3 * k]! * bestX + tri[3 * k + 1]! * bestY + tri[3 * k + 2]! * bestZ)
      if (v[k]! < 2) depthA = Math.max(depthA, depth)
      else depthB = Math.max(depthB, depth)
    }
    const nx = R[0]! * bestX + R[1]! * bestY + R[2]! * bestZ
    const ny = R[3]! * bestX + R[4]! * bestY + R[5]! * bestZ
    const nz = R[6]! * bestX + R[7]! * bestY + R[8]! * bestZ
    if (wa > 0 && depthA > 0) carry(pool, c, rowA, qa, cols, Math.min(depthA, MAX_PUSH), nx, ny, nz)
    if (wb > 0 && depthB > 0) carry(pool, c, rowB, qb, cols, Math.min(depthB, MAX_PUSH), nx, ny, nz)
  }
}

/** Carries a row `push` along the unit normal, then cancels its sliding on the collider (friction). */
function carry(
  pool: Pool,
  c: Collider,
  row: number,
  q: number,
  cols: number,
  push: number,
  nx: number,
  ny: number,
  nz: number
) {
  const { x, xp } = pool
  shift(x, row, q, cols, push * nx, push * ny, push * nz)
  const q3 = q * 3
  colliderMotion(c, x[q3]!, x[q3 + 1]!, x[q3 + 2]!)
  let rx = x[q3]! - xp[q3]! - contactMotion[0]!,
    ry = x[q3 + 1]! - xp[q3 + 1]! - contactMotion[1]!,
    rz = x[q3 + 2]! - xp[q3 + 2]! - contactMotion[2]!
  const rn = rx * nx + ry * ny + rz * nz
  rx -= rn * nx
  ry -= rn * ny
  rz -= rn * nz
  const tn = Math.sqrt(rx * rx + ry * ry + rz * rz)
  if (tn < 1e-12) return
  const s = tn < MU_STATIC * push ? 1 : Math.min(1, (MU_KINETIC * push) / tn)
  shift(x, row, q, cols, -s * rx, -s * ry, -s * rz)
}

/** Translates a whole row: its grid particles and its centre. */
function shift(
  x: Float64Array,
  row: number,
  q: number,
  cols: number,
  dx: number,
  dy: number,
  dz: number
) {
  if (dx === 0 && dy === 0 && dz === 0) return
  for (let c = 0; c < cols; c++) {
    const i3 = (row + c) * 3
    x[i3] = x[i3]! + dx
    x[i3 + 1] = x[i3 + 1]! + dy
    x[i3 + 2] = x[i3 + 2]! + dz
  }
  const q3 = q * 3
  x[q3] = x[q3]! + dx
  x[q3 + 1] = x[q3 + 1]! + dy
  x[q3 + 2] = x[q3 + 2]! + dz
}

/** Every strip candidate of the frame; records [rowA, rowB, qA, qB, columns, collider] + [half thickness]. */
export function solveStrips(
  pool: Pool,
  colliders: Collider[],
  d: Int32Array,
  f: Float64Array,
  n: number
) {
  for (let s = 0; s < n; s++) {
    const o = 6 * s
    contactStrip(
      pool,
      colliders[d[o + 5]!]!,
      d[o]!,
      d[o + 1]!,
      d[o + 2]!,
      d[o + 3]!,
      d[o + 4]!,
      f[s]!
    )
  }
}
