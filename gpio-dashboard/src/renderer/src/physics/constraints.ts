// XPBD constraint kernels (Macklin, Muller, Chentanez, "XPBD", MIG 2016). With small steps
// (Macklin et al., SCA 2019) each constraint is projected once per substep, so the multiplier
// starts at zero and eq. 18 reduces to  dlambda = -C / (sum w |grad C|^2 + alpha / h^2).
import type { Body } from './body'

/**
 * Bending as the length of the discrete curvature vector C = |a - 2b + c|, which is linear in the
 * turning angle (a skip-one distance constraint is quadratic in it, and nearly free for gentle
 * bends). With segment length s the bending energy is (EI / s) theta^2 / 2 for k = EI / s^3.
 */
export function solveCurvature(x: Float64Array, w: Float64Array, b: Body, invH2: number) {
  const { cA, cB, cC, cAlpha } = b
  const n = cA.length
  // One symmetric sweep (forward, then back): a one-way sweep carries a directional bias that
  // bends the wire's shape and keeps piles creeping; alternating the direction per substep did too.
  for (let s = 0; s < 2 * n; s++) {
    const k = s < n ? s : 2 * n - 1 - s
    const a = cA[k]!,
      m = cB[k]!,
      c = cC[k]!
    const wa = w[a]!,
      wm = w[m]!,
      wc = w[c]!
    const a3 = a * 3,
      m3 = m * 3,
      c3 = c * 3
    const qx = x[a3]! - 2 * x[m3]! + x[c3]!,
      qy = x[a3 + 1]! - 2 * x[m3 + 1]! + x[c3 + 1]!,
      qz = x[a3 + 2]! - 2 * x[m3 + 2]! + x[c3 + 2]!
    const q = Math.sqrt(qx * qx + qy * qy + qz * qz)
    if (q < 1e-9) continue
    const denom = wa + 4 * wm + wc
    if (denom === 0) continue
    // grad_a = grad_c = q/|q|, grad_b = -2 q/|q|
    const f = -1 / (denom + cAlpha[k]! * invH2)
    x[a3] = x[a3]! + wa * f * qx
    x[a3 + 1] = x[a3 + 1]! + wa * f * qy
    x[a3 + 2] = x[a3 + 2]! + wa * f * qz
    x[m3] = x[m3]! - 2 * wm * f * qx
    x[m3 + 1] = x[m3 + 1]! - 2 * wm * f * qy
    x[m3 + 2] = x[m3 + 2]! - 2 * wm * f * qz
    x[c3] = x[c3]! + wc * f * qx
    x[c3 + 1] = x[c3 + 1]! + wc * f * qy
    x[c3 + 2] = x[c3 + 2]! + wc * f * qz
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

let chainBuf = new Float64Array(7 * 128)

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
  if (chainBuf.length < 7 * m) chainBuf = new Float64Array(7 * m * 2)
  const cap = chainBuf.length / 7
  const nx = chainBuf.subarray(0, cap)
  const ny = chainBuf.subarray(cap, 2 * cap)
  const nz = chainBuf.subarray(2 * cap, 3 * cap)
  const diag = chainBuf.subarray(3 * cap, 4 * cap)
  const rhs = chainBuf.subarray(4 * cap, 5 * cap)
  const up = chainBuf.subarray(5 * cap, 6 * cap)
  const lo = chainBuf.subarray(6 * cap, 7 * cap)
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
      nx[k] = dx / d
      ny[k] = dy / d
      nz[k] = dz / d
      rhs[k] = dRest[k]! - d
    }
    const dg = w[dI[k]!]! + w[dJ[k]!]!
    // A touch of compliance: a chain pulled exactly straight has more constraints than freedoms.
    diag[k] = dg > 1e-12 ? dg * (1 + 1e-6) : 1
  }
  // Forward elimination: lo holds the eliminated super-diagonal, rhs the reduced right side.
  for (let k = 0; k < m; k++) {
    let dg = diag[k]!
    let r = rhs[k]!
    if (k > 0) {
      const off = -w[dI[k]!]! * (nx[k - 1]! * nx[k]! + ny[k - 1]! * ny[k]! + nz[k - 1]! * nz[k]!)
      dg -= off * up[k - 1]!
      r -= off * lo[k - 1]!
      if (dg < 1e-6 * diag[k]!) dg = 1e-6 * diag[k]!
    }
    if (k < m - 1) {
      const next = -w[dJ[k]!]! * (nx[k]! * nx[k + 1]! + ny[k]! * ny[k + 1]! + nz[k]! * nz[k + 1]!)
      up[k] = next / dg
    }
    lo[k] = r / dg
  }
  // Back substitution into rhs.
  rhs[m - 1] = lo[m - 1]!
  for (let k = m - 2; k >= 0; k--) rhs[k] = lo[k]! - up[k]! * rhs[k + 1]!
  for (let k = 0; k < m; k++) {
    const l = rhs[k]!
    const i = dI[k]!,
      j = dJ[k]!
    const wi = w[i]! * l,
      wj = w[j]! * l
    const i3 = i * 3,
      j3 = j * 3
    x[i3] = x[i3]! + wi * nx[k]!
    x[i3 + 1] = x[i3 + 1]! + wi * ny[k]!
    x[i3 + 2] = x[i3 + 2]! + wi * nz[k]!
    x[j3] = x[j3]! - wj * nx[k]!
    x[j3 + 1] = x[j3 + 1]! - wj * ny[k]!
    x[j3 + 2] = x[j3 + 2]! - wj * nz[k]!
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
