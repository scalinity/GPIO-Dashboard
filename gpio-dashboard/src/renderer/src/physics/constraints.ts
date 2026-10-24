// XPBD constraint kernels (Macklin, Muller, Chentanez, "XPBD", MIG 2016). With small steps
// (Macklin et al., SCA 2019) each constraint is projected once per substep, so the multiplier
// starts at zero and eq. 18 reduces to  dlambda = -C / (sum w |grad C|^2 + alpha / h^2).
import type { Body } from './body'

/**
 * Bending as the length of the discrete curvature vector C = |a - 2b + c|, which is linear in the
 * turning angle (a skip-one distance constraint is quadratic in it, and nearly free for gentle
 * bends). With segment length s the bending energy is (EI / s) theta^2 / 2 for k = EI / s^3.
 * Every constraint's gradient is q/|q| on a and c and -2q/|q| on b, so its multiplier step
 * -|q| / (sum w |grad|^2 + alpha / h^2) turns into a displacement along q itself: no square root
 * and no division is needed once cInv = -1 / (w_a + 4 w_b + w_c + alpha / h^2) is known.
 */
export function solveCurvature(x: Float64Array, w: Float64Array, b: Body) {
  const { cA, cB, cC, cInv } = b
  const n = cA.length
  // One symmetric sweep (forward, then back): a one-way sweep carries a directional bias that
  // bends the wire's shape and keeps piles creeping; alternating the direction per substep did too.
  for (let s = 0; s < 2 * n; s++) {
    const k = s < n ? s : 2 * n - 1 - s
    const f = cInv[k]!
    if (f === 0) continue
    const a3 = cA[k]! * 3,
      m3 = cB[k]! * 3,
      c3 = cC[k]! * 3
    const qx = x[a3]! - 2 * x[m3]! + x[c3]!,
      qy = x[a3 + 1]! - 2 * x[m3 + 1]! + x[c3 + 1]!,
      qz = x[a3 + 2]! - 2 * x[m3 + 2]! + x[c3 + 2]!
    if (qx * qx + qy * qy + qz * qz < 1e-18) continue
    const wa = w[cA[k]!]! * f,
      wm = 2 * w[cB[k]!]! * f,
      wc = w[cC[k]!]! * f
    x[a3] = x[a3]! + wa * qx
    x[a3 + 1] = x[a3 + 1]! + wa * qy
    x[a3 + 2] = x[a3 + 2]! + wa * qz
    x[m3] = x[m3]! - wm * qx
    x[m3 + 1] = x[m3 + 1]! - wm * qy
    x[m3 + 2] = x[m3 + 2]! - wm * qz
    x[c3] = x[c3]! + wc * qx
    x[c3 + 1] = x[c3 + 1]! + wc * qy
    x[c3 + 2] = x[c3 + 2]! + wc * qz
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
