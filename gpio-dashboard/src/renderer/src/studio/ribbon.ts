// The ribbon between the two IDC sockets (SPEC 6.4, 10.4, 10.5): a strip mesh through rows of
// points across the cable, from conductor 1's edge to conductor 40's. Until the physics lane
// simulates it, the rows follow a design curve of the cable's real length that sags onto whatever
// is under it; the strip is built from any rows, so the simulated particle grid can replace them.
import ribbonJson from '../content/controllers/ribbon.json'
import {
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Float32BufferAttribute,
  MeshStandardNodeMaterial,
  NearestFilter,
  Quaternion,
  RepeatWrapping,
  type Texture,
  Vector3
} from 'three/webgpu'

/** One socket's cable exit: conductor 1's end of the exit line, conductor 40's, and the way out. */
export interface CableEnd {
  a: Vector3
  b: Vector3
  out: Vector3
}

/** Rows about this far apart along the cable (the physics grid's spacing, SPEC 10.5). */
const ROW_MM = 2.5
/** Points across each row (the physics grid has 5 to 9, SPEC 10.5). */
const COLUMNS = 9
/** How far the cable runs out of a socket before it turns toward its belly. */
const REACH_MM = 20

/** Points along a polyline at even arc length, `step` apart (the last at its end). */
function resample(points: Vector3[], step: number): Vector3[] {
  const total = length(points)
  const n = Math.max(2, Math.round(total / step) + 1)
  const out: Vector3[] = []
  let i = 0
  let walked = 0
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1)
    while (i < points.length - 2 && walked + points[i]!.distanceTo(points[i + 1]!) < target) {
      walked += points[i]!.distanceTo(points[i + 1]!)
      i++
    }
    const seg = points[i]!.distanceTo(points[i + 1]!)
    out.push(
      points[i]!.clone().lerp(points[i + 1]!, seg > 0 ? Math.min(1, (target - walked) / seg) : 0)
    )
  }
  return out
}

function length(points: Vector3[]): number {
  let s = 0
  for (let i = 1; i < points.length; i++) s += points[i - 1]!.distanceTo(points[i]!)
  return s
}

/**
 * A centreline from `p0` leaving along `d0` to `p1` leaving along `d1`, over a crown that leans
 * `s` out toward where both exits point and stands half that above the higher exit, held at least
 * `floor` high. Its length grows with `s`.
 */
function centreline(
  p0: Vector3,
  d0: Vector3,
  p1: Vector3,
  d1: Vector3,
  s: number,
  floor: (p: Vector3) => number
): Vector3[] {
  const a = p0.clone().addScaledVector(d0, REACH_MM)
  const b = p1.clone().addScaledVector(d1, REACH_MM)
  const lean = d0.clone().add(d1).setY(0)
  if (lean.lengthSq() > 1e-6) lean.normalize()
  const crown = a
    .clone()
    .lerp(b, 0.5)
    .addScaledVector(lean, s)
    .setY(Math.max(a.y, b.y) + s / 2)
  const points = new CatmullRomCurve3([p0, a, crown, b, p1], false, 'centripetal').getPoints(120)
  // Whatever is underneath holds it up; smoothing rounds where it comes to rest.
  for (let pass = 0; pass < 8; pass++) {
    for (const p of points) p.y = Math.max(p.y, floor(p))
    for (let i = 1; i < points.length - 1; i++)
      points[i]!.y = (points[i - 1]!.y + 2 * points[i]!.y + points[i + 1]!.y) / 4
  }
  for (const p of points) p.y = Math.max(p.y, floor(p))
  return points
}

/**
 * The ribbon's design: rows across the cable, conductor 1 first, about ROW_MM apart, from the Pi's
 * socket to the T-board's. The ends run straight out of the sockets for the clamped length, the
 * whole is `lengthMm` long, and the width turns from one socket's exit line to the other's with
 * the least twist.
 */
export function ribbonDesign(
  pi: CableEnd,
  tboard: CableEnd,
  lengthMm: number,
  floor: (p: Vector3) => number
): Vector3[][] {
  const clamp = ribbonJson.clampedEndMm
  const mid = (e: CableEnd) => e.a.clone().add(e.b).multiplyScalar(0.5)
  const p0 = mid(pi).addScaledVector(pi.out, clamp)
  const p1 = mid(tboard).addScaledVector(tboard.out, clamp)
  const line = (s: number) =>
    resample([mid(pi), ...centreline(p0, pi.out, p1, tboard.out, s, floor), mid(tboard)], ROW_MM)
  // The length grows with the belly; a span too long for the cable is drawn taut.
  let [lo, hi] = [0, lengthMm]
  for (let k = 0; k < 30; k++) {
    const s = (lo + hi) / 2
    if (length(line(s)) < lengthMm) lo = s
    else hi = s
  }
  const centre = line(lo)

  // Rotation-minimizing frames from the Pi's exit line, then the twist left over at the T-board
  // spread evenly along the cable.
  const tangents = centre.map((_, i) =>
    centre[Math.min(i + 1, centre.length - 1)]!.clone()
      .sub(centre[Math.max(i - 1, 0)]!)
      .normalize()
  )
  const across: Vector3[] = [pi.b.clone().sub(pi.a).normalize()]
  const q = new Quaternion()
  for (let i = 1; i < centre.length; i++) {
    q.setFromUnitVectors(tangents[i - 1]!, tangents[i]!)
    across.push(across[i - 1]!.clone().applyQuaternion(q))
  }
  const last = centre.length - 1
  const want = tboard.b.clone().sub(tboard.a).normalize()
  const got = across[last]!
  const twist = Math.atan2(got.clone().cross(want).dot(tangents[last]!), got.dot(want))
  // A flat cable twists most easily where it runs steeply, so the twist goes there.
  const steep = tangents.slice(0, last).map((t) => Math.abs(t.y) + 0.05)
  const total = steep.reduce((s, x) => s + x, 0)
  let share = 0
  const width = ribbonJson.widthMm
  return centre.map((c, i) => {
    if (i > 0) share += steep[i - 1]! / total
    const w = across[i]!.applyAxisAngle(tangents[i]!, twist * share).normalize()
    return Array.from({ length: COLUMNS }, (_, j) =>
      c.clone().addScaledVector(w, width * (j / (COLUMNS - 1) - 0.5))
    )
  })
}

/** The strip through rows of points: u across (0 at conductor 1's edge), v one unit per pitch along. */
export function ribbonGeometry(rows: Vector3[][]): BufferGeometry {
  const cols = rows[0]!.length
  const position: number[] = []
  const uv: number[] = []
  const index: number[] = []
  let along = 0
  rows.forEach((row, i) => {
    const centre = row.reduce((s, p) => s.add(p), new Vector3()).divideScalar(row.length)
    if (i > 0) {
      const before = rows[i - 1]!.reduce((s, p) => s.add(p), new Vector3())
      along += centre.distanceTo(before.divideScalar(row.length))
    }
    row.forEach((p, j) => {
      position.push(p.x, p.y, p.z)
      uv.push(j / (cols - 1), along / 2.54)
    })
    if (i > 0)
      for (let j = 0; j < cols - 1; j++) {
        const [a, b] = [(i - 1) * cols + j, i * cols + j]
        index.push(a, b, a + 1, a + 1, b, b + 1)
      }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * PVC over the 40 conductors: the colour lookup sampled nearest, one texel per conductor, and the
 * ridge normal map repeated along the cable (ADR-0039). Either may still be loading.
 */
export function ribbonMaterial(
  colors: Texture | null | undefined,
  ridges: Texture | null | undefined
): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ color: colors ? 0xffffff : 0x9a9a9e, roughness: 0.6 })
  m.side = DoubleSide
  if (colors) {
    colors.magFilter = colors.minFilter = NearestFilter
    colors.generateMipmaps = false
    m.map = colors
  }
  if (ridges) {
    ridges.wrapS = ridges.wrapT = RepeatWrapping
    m.normalMap = ridges
  }
  return m
}
