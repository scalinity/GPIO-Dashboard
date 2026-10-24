// Builds the particle layout and constraint tables of each body kind (SPEC 10.5).
import dupont from '../content/leads/dupont.json'
import ribbonData from '../content/controllers/ribbon.json'
import { quatToMat, toLocal, toWorld } from './math'
import { turnWidthAxis } from './ribbon'
import type { Spec } from './body'
import type { JumperDef, LeadDef, Pose, RibbonDef } from './types'

/**
 * Tunables that no datasheet gives. Masses are estimates (a 1 mm PVC jumper weighs about 2 g per
 * metre; a 40-way ribbon about 40 g per metre). The bending stiffnesses EI are in g mm^3 / s^2
 * (1 N mm^2 = 1e6): a stranded 26-28 AWG jumper is about 1 to 25 N mm^2 (copper strands plus a
 * soft PVC jacket) and a 40-way ribbon 100 to 500. The ribbon is set to 50, below that range: at
 * 150 its row polyline, which bends hard at the clamps, measures 199.5 mm of the 200 mm that the
 * Studio checks it against, and 10 substeps no longer carry it round a plate's edge. A lead of
 * 2 N mm^2 stands about 90 mm before its own weight folds it (the self-buckling length,
 * (7.8 EI / weight per mm)^(1/3)). Above about 1e6 the lead's value stops showing in the shape:
 * one sweep a substep cannot carry the stiffness any further along the chain (the ADR on bending
 * stiffness). Compliances below are XPBD alphas, s^2/g.
 */
export const MATERIAL = {
  leadGramsPerMm: 0.002,
  jumperGramsPerMm: 0.004,
  ribbonGramsPerMm: 0.04,
  leadEI: 2e6,
  /** The first joint above a housing is stiffer: the wire leaves its strain relief straight. */
  housingBendFactor: 0.2,
  ribbonEI: 5e7,
  /** Across the ribbon's width the strip does not bend. */
  ribbonAcrossAlpha: 1e-9,
  /** A solid jumper deflects elastically: about 0.05 mm under its own weight. */
  jumperGoalAlpha: 8e-4
}

/** Rod particle spacing, mm (SPEC 10.5: about 3 mm). */
export const ROD_SPACING = 3
/** Ribbon particle spacing along its length, mm (SPEC 10.5: about 5 mm). */
export const RIBBON_SPACING = 5
export const DEFAULT_RIBBON_COLUMNS = 7

type V3 = [number, number, number]
const col = (m: Float64Array, c: number): V3 => [m[c]!, m[3 + c]!, m[6 + c]!]

function poseFrame(p: Pose) {
  const pos = Float64Array.from(p.position)
  const mat = new Float64Array(9)
  quatToMat(p.rotation, mat)
  return { pos, mat }
}

function polylineLength(p: Float64Array): number {
  let len = 0
  for (let i = 3; i < p.length; i += 3) {
    len += Math.hypot(p[i]! - p[i - 3]!, p[i + 1]! - p[i - 2]!, p[i + 2]! - p[i - 1]!)
  }
  return len
}

/** Points evenly spaced by arc length along a polyline. */
export function resample(poly: ArrayLike<number>, count: number): Float64Array {
  const m = poly.length / 3
  const out = new Float64Array(3 * count)
  const cum = new Float64Array(m)
  for (let i = 1; i < m; i++) {
    cum[i] =
      cum[i - 1]! +
      Math.hypot(
        poly[3 * i]! - poly[3 * i - 3]!,
        poly[3 * i + 1]! - poly[3 * i - 2]!,
        poly[3 * i + 2]! - poly[3 * i - 1]!
      )
  }
  const total = cum[m - 1]!
  let seg = 0
  for (let k = 0; k < count; k++) {
    const target = count === 1 ? 0 : (total * k) / (count - 1)
    while (seg < m - 2 && cum[seg + 1]! < target) seg++
    const span = cum[seg + 1]! - cum[seg]!
    const f = span > 1e-12 ? Math.min(1, Math.max(0, (target - cum[seg]!) / span)) : 0
    for (let a = 0; a < 3; a++) {
      out[3 * k + a] = poly[3 * seg + a]! + (poly[3 * seg + 3 + a]! - poly[3 * seg + a]!) * f
    }
  }
  return out
}

/**
 * A design curve of the given length from p0 leaving along d0 to p1 arriving along d1: a cubic
 * Hermite curve whose tangent magnitude is found by bisection so the arc length matches. When
 * the ends are farther apart than the length it is the straight line (an over-span cable).
 */
export function designCurve(
  p0: V3,
  d0: V3,
  p1: V3,
  d1: V3,
  length: number,
  count: number
): Float64Array {
  const direct = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
  const N = 64
  const sample = (m: number) => {
    const out = new Float64Array(3 * (N + 1))
    for (let i = 0; i <= N; i++) {
      const u = i / N
      const h00 = 2 * u * u * u - 3 * u * u + 1
      const h10 = u * u * u - 2 * u * u + u
      const h01 = -2 * u * u * u + 3 * u * u
      const h11 = u * u * u - u * u
      for (let a = 0; a < 3; a++) {
        out[3 * i + a] = h00 * p0[a]! + h10 * m * d0[a]! + h01 * p1[a]! + h11 * m * d1[a]!
      }
    }
    return out
  }
  if (direct >= length) return resample([...p0, ...p1], count)
  let lo = 0
  let hi = 2 * length
  for (let it = 0; it < 40; it++) {
    const mid = 0.5 * (lo + hi)
    if (polylineLength(sample(mid)) < length) lo = mid
    else hi = mid
  }
  return resample(sample(hi), count)
}

/** How far a lead's design curve leans over at its housings (tangent of the tilt). */
const LEAN = 0.5

/** The direction d tilted toward the horizontal direction (sx, sy). */
function leaning(d: V3, sx: number, sy: number): V3 {
  const x = d[0] + LEAN * sx
  const y = d[1] + LEAN * sy
  const l = Math.hypot(x, y, d[2]) || 1
  return [x / l, y / l, d[2] / l]
}

/** A direction tipped up (dz > 0) or down (dz < 0), so a ribbon's guess arches over its ends. */
function tilted(d: V3, dz: number): V3 {
  const z = d[2] + 0.7 * dz
  const l = Math.hypot(d[0], d[1], z) || 1
  return [d[0] / l, d[1] / l, z / l]
}

const toTyped = (a: number[]) => Float64Array.from(a)
const toInt = (a: number[]) => Int32Array.from(a)

/** Symmetry-breaking jitter: a straight, vertical lead would otherwise never pick a side. */
const JITTER_MM = 0.01

export function buildLead(def: LeadDef, rand: () => number): Spec {
  const L = def.wireMm ?? def.lengthMm
  const nseg = Math.max(2, Math.round(L / ROD_SPACING))
  const sw = L / nseg
  const n = nseg + 3
  const hl = dupont.housing.lengthMm
  const A = poseFrame(def.a)
  const B = poseFrame(def.b)
  const x0 = new Float64Array(3 * n)
  const w = new Float64Array(n)
  const m = MATERIAL.leadGramsPerMm * sw
  const e = new Float64Array(3)

  const exitA = 1
  const exitB = n - 2
  const guessCurve = (): Float64Array => {
    if (def.guess && def.guess.length >= 2) return resample(def.guess.flat(), nseg + 1)
    const pa = new Float64Array(3)
    const pb = new Float64Array(3)
    toWorld(A.pos, A.mat, 0, 0, hl, pa, 0)
    toWorld(B.pos, B.mat, 0, 0, hl, pb, 0)
    const za = col(A.mat, 2)
    const zb = col(B.mat, 2)
    // Both ends lean the same way, so the loop folds over to one side as a real lead does; a
    // planar arch would fall in its own plane and crumple.
    const side = rand() < 0.5 ? -1 : 1
    let sx = side * (pb[1]! - pa[1]!),
      sy = -side * (pb[0]! - pa[0]!)
    const sl = Math.hypot(sx, sy)
    if (sl < 1e-6) {
      sx = side
      sy = 0
    } else {
      sx /= sl
      sy /= sl
    }
    return designCurve(
      [pa[0]!, pa[1]!, pa[2]!],
      leaning(za, sx, sy),
      [pb[0]!, pb[1]!, pb[2]!],
      leaning([-zb[0], -zb[1], -zb[2]], -sx, -sy),
      L,
      nseg + 1
    )
  }
  const curve = guessCurve()
  for (let k = 0; k <= nseg; k++) {
    for (let a = 0; a < 3; a++) x0[3 * (k + 1) + a] = curve[3 * k + a]! + (rand() - 0.5) * JITTER_MM
    w[k + 1] = 1 / m
  }

  const kI = [0, 1, n - 2, n - 1]
  const kEnd = [0, 0, 1, 1]
  const kLocal = [0, 0, hl - sw, 0, 0, hl, 0, 0, hl, 0, 0, hl - sw]
  for (let k = 0; k < 4; k++) {
    const F = kEnd[k] === 0 ? A : B
    toWorld(F.pos, F.mat, kLocal[3 * k]!, kLocal[3 * k + 1]!, kLocal[3 * k + 2]!, e, 0)
    x0.set(e, 3 * kI[k]!)
    w[kI[k]!] = 0
  }

  const dI: number[] = []
  const dJ: number[] = []
  for (let k = 1; k <= n - 3; k++) {
    dI.push(k)
    dJ.push(k + 1)
  }
  const cA: number[] = []
  const cB: number[] = []
  const cC: number[] = []
  const cAlpha: number[] = []
  const alpha = (sw * sw * sw) / MATERIAL.leadEI
  for (let k = 1; k <= n - 2; k++) {
    cA.push(k - 1)
    cB.push(k)
    cC.push(k + 1)
    cAlpha.push(k === 1 || k === n - 2 ? alpha * MATERIAL.housingBendFactor : alpha)
  }
  const lI: number[] = []
  const lA: number[] = []
  const lMax: number[] = []
  for (let k = 2; k <= n - 3; k++) {
    lI.push(k, k)
    lA.push(exitA, exitB)
    lMax.push((k - exitA) * sw, (exitB - k) * sw)
  }
  return {
    kind: 'lead',
    n,
    gridCount: n,
    rows: n,
    columns: 1,
    wireStart: 1,
    wireEnd: n - 1,
    radius: dupont.wire.outerDiameterMm / 2,
    x0,
    w,
    constraints: {
      dI: toInt(dI),
      dJ: toInt(dJ),
      dLat2: new Float64Array(dI.length),
      dAlong: new Float64Array(dI.length).fill(sw),
      cA: toInt(cA),
      cB: toInt(cB),
      cC: toInt(cC),
      cAlpha: toTyped(cAlpha),
      lI: toInt(lI),
      lA: toInt(lA),
      lMax: toTyped(lMax),
      kI: toInt(kI),
      kEnd: Uint8Array.from(kEnd),
      kLocal: toTyped(kLocal),
      gI: new Int32Array(0),
      gU: new Float64Array(0),
      gLoc: new Float64Array(0),
      gAlpha: 0
    },
    rig: null,
    segI: toInt(dI),
    segJ: toInt(dJ),
    triA: new Int32Array(0),
    triB: new Int32Array(0),
    triC: new Int32Array(0),
    exitA,
    exitB,
    freeLength: nseg * sw,
    flagLocalA: [0, 0, hl],
    flagLocalB: [0, 0, hl],
    lengthMm: L,
    allowanceMm: 2 * dupont.minBendRadiusMm
  }
}

export function buildJumper(def: JumperDef): Spec {
  const poly = def.shape.flat()
  const total = polylineLength(Float64Array.from(poly))
  const nseg = Math.max(2, Math.round(total / ROD_SPACING))
  const n = nseg + 1
  const sw = total / nseg
  const curve = resample(poly, n)
  const A = poseFrame(def.a)
  const B = poseFrame(def.b)
  const w = new Float64Array(n).fill(1 / (MATERIAL.jumperGramsPerMm * sw))
  w[0] = 0
  w[n - 1] = 0
  const gI: number[] = []
  const gU: number[] = []
  const gLoc: number[] = []
  const loc = new Float64Array(3)
  for (let k = 1; k < n - 1; k++) {
    gI.push(k)
    gU.push(k / (n - 1))
    for (const F of [A, B]) {
      toLocal(F.pos, F.mat, curve[3 * k]!, curve[3 * k + 1]!, curve[3 * k + 2]!, loc, 0)
      gLoc.push(loc[0]!, loc[1]!, loc[2]!)
    }
  }
  const kLocal = new Float64Array(6)
  toLocal(A.pos, A.mat, curve[0]!, curve[1]!, curve[2]!, kLocal, 0)
  toLocal(B.pos, B.mat, curve[3 * n - 3]!, curve[3 * n - 2]!, curve[3 * n - 1]!, kLocal, 3)
  const segs = (): [Int32Array, Int32Array] => [
    Int32Array.from({ length: nseg }, (_, k) => k),
    Int32Array.from({ length: nseg }, (_, k) => k + 1)
  ]
  const [dI, dJ] = segs()
  const [segI, segJ] = segs()
  return {
    kind: 'jumper',
    n,
    gridCount: n,
    rows: n,
    columns: 1,
    wireStart: 0,
    wireEnd: n,
    radius: dupont.wire.outerDiameterMm / 2,
    x0: curve,
    w,
    constraints: {
      dI,
      dJ,
      dLat2: new Float64Array(nseg),
      // Rest lengths are the authored spacing, not the average: a bend's chord is shorter.
      dAlong: Float64Array.from({ length: nseg }, (_, k) =>
        Math.hypot(
          curve[3 * k + 3]! - curve[3 * k]!,
          curve[3 * k + 4]! - curve[3 * k + 1]!,
          curve[3 * k + 5]! - curve[3 * k + 2]!
        )
      ),
      cA: new Int32Array(0),
      cB: new Int32Array(0),
      cC: new Int32Array(0),
      cAlpha: new Float64Array(0),
      lI: new Int32Array(0),
      lA: new Int32Array(0),
      lMax: new Float64Array(0),
      kI: Int32Array.of(0, n - 1),
      kEnd: Uint8Array.of(0, 1),
      kLocal,
      gI: toInt(gI),
      gU: toTyped(gU),
      gLoc: toTyped(gLoc),
      gAlpha: MATERIAL.jumperGoalAlpha
    },
    rig: null,
    segI,
    segJ,
    triA: new Int32Array(0),
    triB: new Int32Array(0),
    triC: new Int32Array(0),
    exitA: 0,
    exitB: n - 1,
    freeLength: total,
    flagLocalA: [0, 0, 0],
    flagLocalB: [0, 0, 0],
    lengthMm: total,
    allowanceMm: 0
  }
}

export function buildRibbon(def: RibbonDef, rand: () => number): Spec {
  const Lr = def.lengthMm ?? ribbonData.lengthMm
  const C = Math.min(9, Math.max(5, Math.round(def.columns ?? DEFAULT_RIBBON_COLUMNS)))
  const rows = Math.round(Lr / RIBBON_SPACING) + 1
  const sp = Lr / (rows - 1)
  const W = ribbonData.widthMm
  const dx = W / (C - 1)
  const grid = rows * C
  const idx = (r: number, c: number) => r * C + c
  /** The row's centre particle, which carries the row's dynamics. */
  const q = (r: number) => grid + r
  const A = poseFrame(def.a)
  const B = poseFrame(def.b)
  // The last row of each clamped end; at least two rows so the bend at the socket edge is held.
  const clampRows = Math.max(1, Math.floor(ribbonData.clampedEndMm / sp + 1e-9))
  const innerA = clampRows
  const innerB = rows - 1 - clampRows
  const clamped = (r: number) => r <= innerA || r >= innerB
  const n = grid + rows
  const x0 = new Float64Array(3 * n)
  const w = new Float64Array(n)
  const rowMass = MATERIAL.ribbonGramsPerMm * sp
  const lateral = Float64Array.from({ length: C }, (_, c) => -W / 2 + c * dx)

  // Free rows follow a design curve through the centreline of the span.
  const fa = new Float64Array(3)
  const fb = new Float64Array(3)
  toWorld(A.pos, A.mat, 0, innerA * sp, 0, fa, 0)
  toWorld(B.pos, B.mat, 0, (rows - 1 - innerB) * sp, 0, fb, 0)
  const ya = col(A.mat, 1)
  const yb = col(B.mat, 1)
  const span = innerB - innerA
  const centre =
    def.guess && def.guess.length >= 2
      ? resample(def.guess.flat(), span + 1)
      : designCurve(
          [fa[0]!, fa[1]!, fa[2]!],
          tilted(ya, 1),
          [fb[0]!, fb[1]!, fb[2]!],
          tilted([-yb[0], -yb[1], -yb[2]], -1),
          span * sp,
          span + 1
        )
  const xa = col(A.mat, 0)
  const xb = col(B.mat, 0)
  const chord: V3 = [fb[0]! - fa[0]!, fb[1]! - fa[1]!, fb[2]! - fa[2]!]
  const dir = new Float64Array(3)
  const p = new Float64Array(3)
  for (let r = 0; r < rows; r++) {
    if (r <= innerA) toWorld(A.pos, A.mat, 0, r * sp, 0, p, 0)
    else if (r >= innerB) toWorld(B.pos, B.mat, 0, (rows - 1 - r) * sp, 0, p, 0)
    else p.set(centre.subarray(3 * (r - innerA), 3 * (r - innerA) + 3))
    x0.set(p, 3 * q(r))
    w[q(r)] = clamped(r) ? 0 : 1 / rowMass
    for (let c = 0; c < C; c++) {
      const lx = lateral[c]!
      if (r <= innerA) {
        toWorld(A.pos, A.mat, lx, r * sp, 0, p, 0)
      } else if (r >= innerB) {
        toWorld(B.pos, B.mat, lx, (rows - 1 - r) * sp, 0, p, 0)
      } else {
        const k = r - innerA
        const u = k / span
        turnWidthAxis(xa, xb, u, chord, dir)
        const ex = dir[0]!,
          ey = dir[1]!,
          ez = dir[2]!
        p[0] = centre[3 * k]! + lx * ex + (rand() - 0.5) * JITTER_MM
        p[1] = centre[3 * k + 1]! + lx * ey + (rand() - 0.5) * JITTER_MM
        p[2] = centre[3 * k + 2]! + lx * ez + (rand() - 0.5) * JITTER_MM
      }
      x0.set(p, 3 * idx(r, c))
      w[idx(r, c)] = clamped(r) ? 0 : C / rowMass
    }
  }

  const kI: number[] = []
  const kEnd: number[] = []
  const kLocal: number[] = []
  for (let r = 0; r < rows; r++) {
    if (!clamped(r)) continue
    const s = (r <= innerA ? r : rows - 1 - r) * sp
    for (let c = 0; c < C; c++) {
      kI.push(idx(r, c))
      kEnd.push(r <= innerA ? 0 : 1)
      kLocal.push(lateral[c]!, s, 0)
    }
    kI.push(q(r))
    kEnd.push(r <= innerA ? 0 : 1)
    kLocal.push(0, s, 0)
  }

  // The chain through the row centres: stretch, bending and long-range attachments.
  const dI: number[] = []
  const dJ: number[] = []
  for (let r = innerA; r < innerB; r++) {
    dI.push(q(r))
    dJ.push(q(r + 1))
  }
  const cA: number[] = []
  const cB: number[] = []
  const cC: number[] = []
  const cAlpha: number[] = []
  const alpha = (sp * sp * sp) / MATERIAL.ribbonEI
  for (let r = innerA; r <= innerB; r++) {
    if (r === 0 || r === rows - 1) continue
    cA.push(q(r - 1))
    cB.push(q(r))
    cC.push(q(r + 1))
    cAlpha.push(alpha)
  }
  const lI: number[] = []
  const lA: number[] = []
  const lMax: number[] = []
  for (let r = innerA + 1; r < innerB; r++) {
    lI.push(q(r), q(r))
    lA.push(q(innerA), q(innerB))
    lMax.push((r - innerA) * sp, (innerB - r) * sp)
  }

  const triA: number[] = []
  const triB: number[] = []
  const triC: number[] = []
  for (let r = 0; r < rows - 1; r++) {
    if (clamped(r) && clamped(r + 1)) continue
    for (let c = 0; c < C - 1; c++) {
      triA.push(idx(r, c), idx(r, c))
      triB.push(idx(r + 1, c), idx(r + 1, c + 1))
      triC.push(idx(r + 1, c + 1), idx(r, c + 1))
    }
  }

  return {
    kind: 'ribbon',
    n,
    gridCount: grid,
    rows,
    columns: C,
    wireStart: 0,
    wireEnd: grid,
    radius: ribbonData.thicknessMm / 2,
    x0,
    w,
    constraints: {
      dI: toInt(dI),
      dJ: toInt(dJ),
      dLat2: new Float64Array(dI.length),
      dAlong: new Float64Array(dI.length).fill(sp),
      cA: toInt(cA),
      cB: toInt(cB),
      cC: toInt(cC),
      cAlpha: toTyped(cAlpha),
      lI: toInt(lI),
      lA: toInt(lA),
      lMax: toTyped(lMax),
      kI: toInt(kI),
      kEnd: Uint8Array.from(kEnd),
      kLocal: toTyped(kLocal),
      gI: new Int32Array(0),
      gU: new Float64Array(0),
      gLoc: new Float64Array(0),
      gAlpha: 0
    },
    rig: { innerA, innerB, lateral },
    segI: new Int32Array(0),
    segJ: new Int32Array(0),
    triA: toInt(triA),
    triB: toInt(triB),
    triC: toInt(triC),
    exitA: q(innerA),
    exitB: q(innerB),
    freeLength: span * sp,
    flagLocalA: [0, 0, 0],
    flagLocalB: [0, 0, 0],
    lengthMm: Lr,
    allowanceMm: 2 * ribbonData.clampedEndMm
  }
}
