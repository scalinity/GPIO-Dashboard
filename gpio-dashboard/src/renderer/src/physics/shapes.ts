// Closest-point kernels for the contact tests. Each writes into a caller-owned Float64Array so
// the substep loop allocates nothing. Closest-point routines follow Ericson, "Real-Time
// Collision Detection" (2005), sections 5.1.2 to 5.1.9.

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Closest points of segments p1-q1 and p2-q2 (Ericson 5.1.9). Writes the parameters into
 * out[0] (first segment) and out[1] (second), and returns the squared distance.
 */
export function closestSegSeg(
  p1x: number,
  p1y: number,
  p1z: number,
  q1x: number,
  q1y: number,
  q1z: number,
  p2x: number,
  p2y: number,
  p2z: number,
  q2x: number,
  q2y: number,
  q2z: number,
  out: Float64Array
): number {
  const d1x = q1x - p1x,
    d1y = q1y - p1y,
    d1z = q1z - p1z
  const d2x = q2x - p2x,
    d2y = q2y - p2y,
    d2z = q2z - p2z
  const rx = p1x - p2x,
    ry = p1y - p2y,
    rz = p1z - p2z
  const a = d1x * d1x + d1y * d1y + d1z * d1z
  const e = d2x * d2x + d2y * d2y + d2z * d2z
  const f = d2x * rx + d2y * ry + d2z * rz
  let s: number
  let t: number
  if (a <= 1e-14 && e <= 1e-14) {
    s = 0
    t = 0
  } else if (a <= 1e-14) {
    s = 0
    t = clamp01(f / e)
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz
    if (e <= 1e-14) {
      t = 0
      s = clamp01(-c / a)
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z
      const denom = a * e - b * b
      s = denom > 1e-14 * a * e ? clamp01((b * f - c * e) / denom) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = clamp01(-c / a)
      } else if (t > 1) {
        t = 1
        s = clamp01((b - c) / a)
      }
    }
  }
  out[0] = s
  out[1] = t
  const dx = rx + d1x * s - d2x * t,
    dy = ry + d1y * s - d2y * t,
    dz = rz + d1z * s - d2z * t
  return dx * dx + dy * dy + dz * dz
}

/**
 * Closest point of triangle abc to p (Ericson 5.1.5). Writes the barycentric weights of a, b and
 * c into out[0..2] and returns the squared distance.
 */
export function closestPointTriangle(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  out: Float64Array
): number {
  const abx = bx - ax,
    aby = by - ay,
    abz = bz - az
  const acx = cx - ax,
    acy = cy - ay,
    acz = cz - az
  const apx = px - ax,
    apy = py - ay,
    apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  let u: number, v: number, w: number
  if (d1 <= 0 && d2 <= 0) {
    u = 1
    v = 0
    w = 0
  } else {
    const bpx = px - bx,
      bpy = py - by,
      bpz = pz - bz
    const d3 = abx * bpx + aby * bpy + abz * bpz
    const d4 = acx * bpx + acy * bpy + acz * bpz
    const cpx = px - cx,
      cpy = py - cy,
      cpz = pz - cz
    const d5 = abx * cpx + aby * cpy + abz * cpz
    const d6 = acx * cpx + acy * cpy + acz * cpz
    const vc = d1 * d4 - d3 * d2
    const vb = d5 * d2 - d1 * d6
    const va = d3 * d6 - d5 * d4
    if (d3 >= 0 && d4 <= d3) {
      u = 0
      v = 1
      w = 0
    } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      v = d1 / (d1 - d3)
      u = 1 - v
      w = 0
    } else if (d6 >= 0 && d5 <= d6) {
      u = 0
      v = 0
      w = 1
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      w = d2 / (d2 - d6)
      u = 1 - w
      v = 0
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      w = (d4 - d3) / (d4 - d3 + (d5 - d6))
      u = 0
      v = 1 - w
    } else {
      const inv = 1 / (va + vb + vc)
      v = vb * inv
      w = vc * inv
      u = 1 - v - w
    }
  }
  out[0] = u
  out[1] = v
  out[2] = w
  const dx = px - (u * ax + v * bx + w * cx)
  const dy = py - (u * ay + v * by + w * cy)
  const dz = pz - (u * az + v * bz + w * cz)
  return dx * dx + dy * dy + dz * dz
}

/**
 * Signed distance from a point to an axis-aligned box centred on the origin (box-local
 * coordinates), with the outward normal. out[0..2] = normal, out[3] = signed distance (negative
 * inside: minus the depth to the nearest face).
 */
export function pointBox(
  px: number,
  py: number,
  pz: number,
  hx: number,
  hy: number,
  hz: number,
  out: Float64Array
): void {
  const ex = Math.abs(px) - hx,
    ey = Math.abs(py) - hy,
    ez = Math.abs(pz) - hz
  if (ex <= 0 && ey <= 0 && ez <= 0) {
    // Inside: leave through the nearest face.
    if (ex >= ey && ex >= ez) {
      out[0] = px < 0 ? -1 : 1
      out[1] = 0
      out[2] = 0
      out[3] = ex
    } else if (ey >= ez) {
      out[0] = 0
      out[1] = py < 0 ? -1 : 1
      out[2] = 0
      out[3] = ey
    } else {
      out[0] = 0
      out[1] = 0
      out[2] = pz < 0 ? -1 : 1
      out[3] = ez
    }
    return
  }
  const qx = ex > 0 ? ex * (px < 0 ? -1 : 1) : 0
  const qy = ey > 0 ? ey * (py < 0 ? -1 : 1) : 0
  const qz = ez > 0 ? ez * (pz < 0 ? -1 : 1) : 0
  const d = Math.sqrt(qx * qx + qy * qy + qz * qz)
  out[0] = qx / d
  out[1] = qy / d
  out[2] = qz / d
  out[3] = d
}

const bp = new Float64Array(8)

/**
 * Closest approach of segment a-b to an axis-aligned box centred on the origin (box-local
 * coordinates). The distance is convex along the segment, and its square is piecewise quadratic
 * with breakpoints where the segment crosses a slab plane, so each piece is minimised exactly.
 * out[0] = parameter along the segment, out[1..3] = outward normal, out[4] = signed distance
 * (negative when the segment passes through the box: minus the depth at its deepest sampled point).
 */
export function segmentBox(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  hx: number,
  hy: number,
  hz: number,
  out: Float64Array
): void {
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az
  let n = 0
  bp[n++] = 0
  bp[n++] = 1
  // Slab crossings inside (0, 1).
  for (let k = 0; k < 3; k++) {
    const a = k === 0 ? ax : k === 1 ? ay : az
    const d = k === 0 ? dx : k === 1 ? dy : dz
    const h = k === 0 ? hx : k === 1 ? hy : hz
    if (d > 1e-12 || d < -1e-12) {
      const t1 = (h - a) / d
      const t2 = (-h - a) / d
      if (t1 > 0 && t1 < 1) bp[n++] = t1
      if (t2 > 0 && t2 < 1) bp[n++] = t2
    }
  }
  // Insertion sort of the few breakpoints.
  for (let i = 1; i < n; i++) {
    const v = bp[i]!
    let j = i - 1
    while (j >= 0 && bp[j]! > v) {
      bp[j + 1] = bp[j]!
      j--
    }
    bp[j + 1] = v
  }
  let best = Infinity
  let bestT = 0.5
  let inside = -1
  for (let i = 0; i + 1 < n; i++) {
    const t0 = bp[i]!,
      t1 = bp[i + 1]!
    if (t1 - t0 < 1e-12) continue
    const tm = 0.5 * (t0 + t1)
    // On this piece each outside axis contributes (s*(a + t*d) - h)^2, linear inside the square.
    let num = 0,
      den = 0,
      outsideAxes = 0
    for (let k = 0; k < 3; k++) {
      const a = k === 0 ? ax : k === 1 ? ay : az
      const d = k === 0 ? dx : k === 1 ? dy : dz
      const h = k === 0 ? hx : k === 1 ? hy : hz
      const u = a + tm * d
      const s = u > h ? 1 : u < -h ? -1 : 0
      if (s !== 0) {
        outsideAxes++
        const c0 = s * a - h
        const c1 = s * d
        num += c0 * c1
        den += c1 * c1
      }
    }
    let t = den > 1e-18 ? -num / den : tm
    if (t < t0) t = t0
    else if (t > t1) t = t1
    const ux = Math.max(Math.abs(ax + t * dx) - hx, 0)
    const uy = Math.max(Math.abs(ay + t * dy) - hy, 0)
    const uz = Math.max(Math.abs(az + t * dz) - hz, 0)
    const d2 = ux * ux + uy * uy + uz * uz
    if (outsideAxes === 0) inside = tm
    if (d2 < best - 1e-18) {
      best = d2
      bestT = t
    }
  }
  if (inside >= 0) {
    // The segment passes through the box: report the deepest point of that stretch.
    pointBox(ax + inside * dx, ay + inside * dy, az + inside * dz, hx, hy, hz, bp)
    out[0] = inside
    out[1] = bp[0]!
    out[2] = bp[1]!
    out[3] = bp[2]!
    out[4] = bp[3]!
    return
  }
  pointBox(ax + bestT * dx, ay + bestT * dy, az + bestT * dz, hx, hy, hz, bp)
  out[0] = bestT
  out[1] = bp[0]!
  out[2] = bp[1]!
  out[3] = bp[2]!
  out[4] = bp[3]!
}
