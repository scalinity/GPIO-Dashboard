// XPBD constraint kernels (Macklin, Muller, Chentanez, "XPBD", MIG 2016). With small steps
// (Macklin et al., SCA 2019) each constraint is projected once per substep, so the multiplier
// starts at zero and eq. 18 reduces to  dlambda = -C / (sum w |grad C|^2 + alpha / h^2).
import type { Body } from './body'

/**
 * Bending along a chain is the discrete curvature vector C_k = x_k - 2 x_(k+1) + x_(k+2) held at
 * zero with compliance alpha_k = s^3 / EI: its energy |C|^2 / (2 alpha) is EI theta^2 / (2 s) for
 * a turn of theta at a joint, the elastic rod's. C is linear in the positions, so J is constant and
 * the XPBD system of all of a chain's bending constraints together,
 *   (J W J^T + alpha / h^2) lambda = -C(x),
 * is exact rather than linearised, is the same matrix for x, y and z, and is pentadiagonal
 * (constraint k shares two particles with k + 1 and one with k + 2). Its LDL^T factors depend
 * only on the inverse masses, the compliances and the substep, so they are found once per body
 * (`factorBending`) and each substep is a forward and a back substitution with three right-hand
 * sides: O(n), exact, and the whole chain's stiffness acts at once. One Gauss-Seidel sweep a
 * substep carried a joint's correction one particle along, so a realistic EI saturated a few
 * particles above the housing (ADR-0076).
 *
 * The constraints must form a chain: constraint k acts on pool particles p + k, p + k + 1 and
 * p + k + 2 for p = cA[0].
 */
export function factorBending(w: Float64Array, b: Body, invH2: number) {
  const { cA, cB, cC, cAlpha, bL1, bL2, bD } = b
  const m = cA.length
  const p = m > 0 ? cA[0]! : 0
  let d1 = 0,
    d2 = 0
  for (let k = 0; k < m; k++) {
    if (cA[k] !== p + k || cB[k] !== p + k + 1 || cC[k] !== p + k + 2) {
      throw new RangeError('bending constraints must run along a chain')
    }
    const wa = w[p + k]!,
      wb = w[p + k + 1]!,
      wc = w[p + k + 2]!
    // Row k of J W J^T + alpha~: diagonal, and its couplings to rows k - 1 and k - 2.
    const diag = wa + 4 * wb + wc + cAlpha[k]! * invH2
    const sub1 = k > 0 ? -2 * w[p + k]! - 2 * w[p + k + 1]! : 0
    const sub2 = k > 1 ? w[p + k]! : 0
    const l2 = k > 1 ? sub2 / d2 : 0
    const l1 = k > 0 ? (sub1 - l2 * (k > 1 ? bL1[k - 1]! : 0) * d2) / d1 : 0
    const d = diag - l1 * l1 * d1 - l2 * l2 * d2
    bL1[k] = l1
    bL2[k] = l2
    bD[k] = 1 / d
    d2 = d1
    d1 = d
  }
}

// Work arrays of the bending solve: the three right-hand sides, then the three multipliers.
let bx = new Float64Array(256)
let by = new Float64Array(256)
let bz = new Float64Array(256)

/** One exact XPBD projection of a chain's bending constraints (see `factorBending`). */
export function solveBending(x: Float64Array, w: Float64Array, b: Body) {
  const { cA, bL1, bL2, bD } = b
  const m = cA.length
  if (m === 0) return
  if (bx.length < m) {
    bx = new Float64Array(2 * m)
    by = new Float64Array(2 * m)
    bz = new Float64Array(2 * m)
  }
  const p3 = cA[0]! * 3
  // Forward: L y = -C.
  let x1 = 0,
    y1 = 0,
    z1 = 0,
    x2 = 0,
    y2 = 0,
    z2 = 0
  for (let k = 0, i = p3; k < m; k++, i += 3) {
    const l1 = bL1[k]!,
      l2 = bL2[k]!
    const rx = 2 * x[i + 3]! - x[i]! - x[i + 6]! - l1 * x1 - l2 * x2
    const ry = 2 * x[i + 4]! - x[i + 1]! - x[i + 7]! - l1 * y1 - l2 * y2
    const rz = 2 * x[i + 5]! - x[i + 2]! - x[i + 8]! - l1 * z1 - l2 * z2
    bx[k] = rx
    by[k] = ry
    bz[k] = rz
    x2 = x1
    y2 = y1
    z2 = z1
    x1 = rx
    y1 = ry
    z1 = rz
  }
  // Back: L^T lambda = D^-1 y, and each particle's move W J^T lambda as soon as its three
  // multipliers are known (particle p + k + 2 is the last of constraint k, the middle of k + 1 and
  // the first of k + 2).
  x1 = y1 = z1 = x2 = y2 = z2 = 0
  for (let k = m - 1; k >= -2; k--) {
    let lx = 0,
      ly = 0,
      lz = 0
    if (k >= 0) {
      const d = bD[k]!
      const l1 = k + 1 < m ? bL1[k + 1]! : 0
      const l2 = k + 2 < m ? bL2[k + 2]! : 0
      lx = bx[k]! * d - l1 * x1 - l2 * x2
      ly = by[k]! * d - l1 * y1 - l2 * y2
      lz = bz[k]! * d - l1 * z1 - l2 * z2
    }
    const j3 = p3 + 3 * (k + 2)
    const wj = w[cA[0]! + k + 2]!
    if (wj !== 0) {
      x[j3] = x[j3]! + wj * (x2 - 2 * x1 + lx)
      x[j3 + 1] = x[j3 + 1]! + wj * (y2 - 2 * y1 + ly)
      x[j3 + 2] = x[j3 + 2]! + wj * (z2 - 2 * z1 + lz)
    }
    x2 = x1
    y2 = y1
    z2 = z1
    x1 = lx
    y1 = ly
    z1 = lz
  }
}

/**
 * Long-range attachments (Kim, Chentanez, Muller-Fischer, SCA 2012): a particle may not stray
 * farther than the cable length from its clamped anchor. One-sided, applied last so the bound
 * holds exactly after each substep.
 */
export function solveLongRange(x: Float64Array, w: Float64Array, b: Body) {
  const { lI, lA, lMax } = b
  const scale = b.scale
  for (let k = 0; k < lI.length; k++) {
    const i = lI[k]!
    if (w[i]! === 0) continue
    const i3 = i * 3,
      a3 = lA[k]! * 3
    const dx = x[i3]! - x[a3]!,
      dy = x[i3 + 1]! - x[a3 + 1]!,
      dz = x[i3 + 2]! - x[a3 + 2]!
    const max = lMax[k]! * scale
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 <= max * max) continue
    const f = max / Math.sqrt(d2)
    x[i3] = x[a3]! + dx * f
    x[i3 + 1] = x[a3 + 1]! + dy * f
    x[i3 + 2] = x[a3 + 2]! + dz * f
  }
}

/** Soft pulls of particles toward target points: C = |x - target| with compliance alpha. */
export function solveGoals(
  x: Float64Array,
  w: Float64Array,
  idx: Int32Array,
  target: Float64Array,
  count: number,
  alpha: number,
  invH2: number
) {
  for (let k = 0; k < count; k++) {
    const i = idx[k]!
    const wi = w[i]!
    if (wi === 0) continue
    const i3 = i * 3
    const dx = x[i3]! - target[3 * k]!,
      dy = x[i3 + 1]! - target[3 * k + 1]!,
      dz = x[i3 + 2]! - target[3 * k + 2]!
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (d < 1e-12) continue
    const f = -1 / (wi + alpha * invH2)
    x[i3] = x[i3]! + wi * f * dx
    x[i3 + 1] = x[i3 + 1]! + wi * f * dy
    x[i3 + 2] = x[i3 + 2]! + wi * f * dz
  }
}

// Work arrays of the chain solver, grown to the longest chain seen.
let nx = new Float64Array(256)
let ny = new Float64Array(256)
let nz = new Float64Array(256)
let diag = new Float64Array(256)
let rhs = new Float64Array(256)
let up = new Float64Array(256)
let lo = new Float64Array(256)

/**
 * Stretch constraints along a chain (constraint k joins dI[k] and dJ[k] = dI[k+1]), all rigid,
 * solved together. Linearised, the XPBD system  A dlambda = -C  with A = J W J^T is tridiagonal,
 * so the Thomas algorithm gives every multiplier at once in O(n). A chain this long converges
 * far too slowly under Gauss-Seidel at one pass per substep (a compressive load needs a pass per
 * link to travel the chain); solved directly the whole chain is inextensible every substep.
 */
export function solveChain(x: Float64Array, w: Float64Array, b: Body) {
  const { dI, dJ, dRest } = b
  const m = dI.length
  if (m === 0) return
  if (nx.length < m) {
    const size = 2 * m
    nx = new Float64Array(size)
    ny = new Float64Array(size)
    nz = new Float64Array(size)
    diag = new Float64Array(size)
    rhs = new Float64Array(size)
    up = new Float64Array(size)
    lo = new Float64Array(size)
  }
  for (let k = 0; k < m; k++) {
    const i3 = dI[k]! * 3,
      j3 = dJ[k]! * 3
    const dx = x[i3]! - x[j3]!,
      dy = x[i3 + 1]! - x[j3 + 1]!,
      dz = x[i3 + 2]! - x[j3 + 2]!
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (d < 1e-12) {
      nx[k] = ny[k] = nz[k] = 0
      rhs[k] = 0
    } else {
      const inv = 1 / d
      nx[k] = dx * inv
      ny[k] = dy * inv
      nz[k] = dz * inv
      rhs[k] = dRest[k]! - d
    }
    const dg = w[dI[k]!]! + w[dJ[k]!]!
    // A touch of compliance: a chain pulled exactly straight has more constraints than freedoms.
    diag[k] = dg > 1e-12 ? dg * (1 + 1e-6) : 1
  }
  // Forward elimination. Constraints k-1 and k share particle dJ[k-1] = dI[k], so the coupling
  // between them, off, is computed once; up holds the eliminated super-diagonal and lo the
  // reduced right side.
  let off = 0
  for (let k = 0; k < m; k++) {
    let dg = diag[k]!
    let r = rhs[k]!
    if (k > 0) {
      dg -= off * up[k - 1]!
      r -= off * lo[k - 1]!
      if (dg < 1e-6 * diag[k]!) dg = 1e-6 * diag[k]!
    }
    const rdg = 1 / dg
    if (k < m - 1) {
      off = -w[dJ[k]!]! * (nx[k]! * nx[k + 1]! + ny[k]! * ny[k + 1]! + nz[k]! * nz[k + 1]!)
      up[k] = off * rdg
    }
    lo[k] = r * rdg
  }
  // Back substitution, applying each multiplier as it is found.
  let next = 0
  for (let k = m - 1; k >= 0; k--) {
    const l = lo[k]! - up[k]! * next
    next = l
    const i = dI[k]!,
      j = dJ[k]!
    const wi = w[i]! * l,
      wj = w[j]! * l
    const i3 = i * 3,
      j3 = j * 3
    const kx = nx[k]!,
      ky = ny[k]!,
      kz = nz[k]!
    x[i3] = x[i3]! + wi * kx
    x[i3 + 1] = x[i3 + 1]! + wi * ky
    x[i3 + 2] = x[i3 + 2]! + wi * kz
    x[j3] = x[j3]! - wj * kx
    x[j3 + 1] = x[j3 + 1]! - wj * ky
    x[j3 + 2] = x[j3 + 2]! - wj * kz
  }
}

/**
 * An over-span cable between its clamps: with the rest lengths scaled to the span the only
 * shape that fits is the straight line, and a position solver sags off it under gravity at a
 * rate set by second-order length change (a taut chain's constraints barely see lateral motion).
 * So the span is laid on the line directly, evenly spaced.
 */
export function straighten(x: Float64Array, b: Body) {
  const a3 = 3 * b.exitA,
    c3 = 3 * b.exitB
  const n = b.exitB - b.exitA
  for (let i = b.exitA + 1; i < b.exitB; i++) {
    const t = (i - b.exitA) / n
    const i3 = 3 * i
    x[i3] = x[a3]! + (x[c3]! - x[a3]!) * t
    x[i3 + 1] = x[a3 + 1]! + (x[c3 + 1]! - x[a3 + 1]!) * t
    x[i3 + 2] = x[a3 + 2]! + (x[c3 + 2]! - x[a3 + 2]!) * t
  }
}
