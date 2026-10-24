// A round tube along a moving polyline (SPEC 10.5 "Rendering"): smoothed between the points by a
// Catmull-Rom spline and framed by parallel transport, the double-reflection rotation-minimizing
// frames of Wang et al. 2008, from a reference that turns with the cable's first end, so the surface
// never twists or pops as the cable moves. The geometry is refitted in place; it is reallocated
// only when the number of points changes. Its uv runs as three's TubeGeometry's does: u along
// (by length), v around.
import { BufferAttribute, BufferGeometry, Vector3 } from 'three/webgpu'

/** Points the spline puts between two of the polyline's. */
export const SUBDIVISIONS = 3
export const RADIAL = 8
/** Around the tube, vertex j sits at minus the frame's normal turned by 2πj/RADIAL (as TubeGeometry). */
const COS = Array.from({ length: RADIAL + 1 }, (_, j) => Math.cos((2 * Math.PI * j) / RADIAL))
const SIN = Array.from({ length: RADIAL + 1 }, (_, j) => Math.sin((2 * Math.PI * j) / RADIAL))

export class Tube {
  readonly geometry = new BufferGeometry()
  /** The smoothed centreline as last fitted (picking and boxes read it). */
  readonly line: Vector3[] = []
  /** Its length, mm. */
  length = 0
  private count = 0
  private tangents: Vector3[] = []
  private normals: Vector3[] = []

  constructor(readonly radius: number) {}

  /**
   * Fits the tube to `points`. `reference` sets the frame at the first point: it is the way the
   * surface's v = 0 faces, made square to the tube there.
   */
  fit(points: Vector3[], reference: Vector3): void {
    const n = points.length < 2 ? 0 : (points.length - 1) * SUBDIVISIONS + 1
    if (n !== this.count) this.allocate(n)
    if (!n) return
    smooth(points, this.line)
    const { line, tangents: t, normals: r } = this
    for (let i = 0; i < n; i++)
      t[i]!.subVectors(line[Math.min(n - 1, i + 1)]!, line[Math.max(0, i - 1)]!).normalize()
    const square = (v: Vector3) => r[0]!.copy(v).addScaledVector(t[0]!, -v.dot(t[0]!))
    if (square(reference).lengthSq() < 1e-12)
      square(Math.abs(t[0]!.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0))
    r[0]!.normalize()
    const v1 = new Vector3()
    const v2 = new Vector3()
    const rL = new Vector3()
    const tL = new Vector3()
    for (let i = 0; i + 1 < n; i++) {
      v1.subVectors(line[i + 1]!, line[i]!)
      const c1 = v1.dot(v1)
      if (c1 < 1e-18) {
        r[i + 1]!.copy(r[i]!)
        continue
      }
      rL.copy(r[i]!).addScaledVector(v1, (-2 / c1) * v1.dot(r[i]!))
      tL.copy(t[i]!).addScaledVector(v1, (-2 / c1) * v1.dot(t[i]!))
      v2.subVectors(t[i + 1]!, tL)
      const c2 = v2.dot(v2)
      r[i + 1]!.copy(rL)
      if (c2 > 1e-18) r[i + 1]!.addScaledVector(v2, (-2 / c2) * v2.dot(rL))
      r[i + 1]!.normalize()
    }
    const position = this.geometry.getAttribute('position') as BufferAttribute
    const normal = this.geometry.getAttribute('normal') as BufferAttribute
    const uv = this.geometry.getAttribute('uv') as BufferAttribute
    const [P, N, U] = [position.array, normal.array, uv.array]
    const s = new Vector3()
    let along = 0
    for (let i = 1; i < n; i++) along += line[i]!.distanceTo(line[i - 1]!)
    this.length = along
    along = 0
    for (let i = 0; i < n; i++) {
      if (i > 0) along += line[i]!.distanceTo(line[i - 1]!)
      const c = line[i]!
      const ri = r[i]!
      s.crossVectors(t[i]!, ri)
      for (let j = 0; j <= RADIAL; j++) {
        const k = i * (RADIAL + 1) + j
        const nx = -COS[j]! * ri.x + SIN[j]! * s.x
        const ny = -COS[j]! * ri.y + SIN[j]! * s.y
        const nz = -COS[j]! * ri.z + SIN[j]! * s.z
        N[3 * k] = nx
        N[3 * k + 1] = ny
        N[3 * k + 2] = nz
        P[3 * k] = c.x + this.radius * nx
        P[3 * k + 1] = c.y + this.radius * ny
        P[3 * k + 2] = c.z + this.radius * nz
        U[2 * k] = this.length > 0 ? along / this.length : 0
        U[2 * k + 1] = j / RADIAL
      }
    }
    position.needsUpdate = normal.needsUpdate = uv.needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
  }

  private allocate(n: number): void {
    this.count = n
    const vertices = n * (RADIAL + 1)
    const g = this.geometry
    g.setAttribute('position', new BufferAttribute(new Float32Array(3 * vertices), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(3 * vertices), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array(2 * vertices), 2))
    const index: number[] = []
    for (let i = 1; i < n; i++)
      for (let j = 1; j <= RADIAL; j++) {
        const a = (RADIAL + 1) * (i - 1) + (j - 1)
        const b = (RADIAL + 1) * i + (j - 1)
        const c = (RADIAL + 1) * i + j
        const e = (RADIAL + 1) * (i - 1) + j
        index.push(a, b, e, b, c, e)
      }
    g.setIndex(index)
    const grow = (list: Vector3[]) => {
      while (list.length < n) list.push(new Vector3())
      list.length = n
    }
    grow(this.line)
    grow(this.tangents)
    grow(this.normals)
  }
}

/** A uniform Catmull-Rom spline through `points`, SUBDIVISIONS steps per span, into `out`. */
function smooth(points: Vector3[], out: Vector3[]): void {
  const m = points.length
  const p = (i: number, target: Vector3) =>
    i < 0
      ? target.copy(points[0]!).multiplyScalar(2).sub(points[1]!)
      : i >= m
        ? target
            .copy(points[m - 1]!)
            .multiplyScalar(2)
            .sub(points[m - 2]!)
        : target.copy(points[i]!)
  const [p0, p1, p2, p3] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  let k = 0
  for (let i = 0; i + 1 < m; i++) {
    p(i - 1, p0)
    p(i, p1)
    p(i + 1, p2)
    p(i + 2, p3)
    for (let s = 0; s < SUBDIVISIONS; s++) {
      const t = s / SUBDIVISIONS
      const [t2, t3] = [t * t, t * t * t]
      const c0 = -0.5 * t3 + t2 - 0.5 * t
      const c1 = 1.5 * t3 - 2.5 * t2 + 1
      const c2 = -1.5 * t3 + 2 * t2 + 0.5 * t
      const c3 = 0.5 * t3 - 0.5 * t2
      out[k++]!.set(0, 0, 0)
        .addScaledVector(p0, c0)
        .addScaledVector(p1, c1)
        .addScaledVector(p2, c2)
        .addScaledVector(p3, c3)
    }
  }
  out[k]!.copy(points[m - 1]!)
}
