// The ribbon between the two IDC sockets (SPEC 6.4, 10.4, 10.5): a strip mesh through rows of
// points across the cable, from conductor 1's edge to conductor 40's. The rows are the solver's
// (bench.ts), refitted in place while the ribbon moves.
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  MeshStandardNodeMaterial,
  NearestFilter,
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

/**
 * The strip through rows of points: u across (0 at conductor 1's edge), v one unit per pitch along.
 * Given the geometry it last built, it refits that in place while the grid keeps its size.
 */
export function ribbonGeometry(rows: Vector3[][], geometry = new BufferGeometry()): BufferGeometry {
  const cols = rows[0]!.length
  const count = rows.length * cols
  if (geometry.getAttribute('position')?.count !== count) {
    const index: number[] = []
    for (let i = 1; i < rows.length; i++)
      for (let j = 0; j < cols - 1; j++) {
        const [a, b] = [(i - 1) * cols + j, i * cols + j]
        index.push(a, b, a + 1, a + 1, b, b + 1)
      }
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(3 * count), 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(2 * count), 2))
    geometry.setIndex(index)
  }
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  let along = 0
  const centre = new Vector3()
  const before = new Vector3()
  rows.forEach((row, i) => {
    centre.set(0, 0, 0)
    for (const p of row) centre.add(p)
    centre.divideScalar(cols)
    if (i > 0) along += centre.distanceTo(before)
    before.copy(centre)
    row.forEach((p, j) => {
      position.setXYZ(i * cols + j, p.x, p.y, p.z)
      uv.setXY(i * cols + j, j / (cols - 1), along / 2.54)
    })
  })
  position.needsUpdate = uv.needsUpdate = true
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
