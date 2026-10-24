// Reading and measuring the shipped GLBs. build.ts records these measurements in the manifests;
// check.ts and the Vitest guard measure the committed files the same way.
import { createHash } from 'node:crypto'
import { type Document, type Node, NodeIO, type Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { listTextureSlots } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
export interface Box {
  min: Vec3
  max: Vec3
}

export async function glbIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready])
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder
  })
}

export const readGlb = async (path: string) => (await glbIO()).read(path)

/** Every primitive with the node that holds it, in scene order. */
export function primitives(doc: Document): { node: Node; prim: Primitive }[] {
  const out: { node: Node; prim: Primitive }[] = []
  const visit = (node: Node) => {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) out.push({ node, prim })
    node.listChildren().forEach(visit)
  }
  for (const scene of doc.getRoot().listScenes()) scene.listChildren().forEach(visit)
  return out
}

export const triangleCount = (doc: Document) =>
  primitives(doc).reduce((n, { prim }) => n + prim.getIndices()!.getCount() / 3, 0)

/**
 * SHA-256 over every primitive's decoded indices and vertex attributes, with its node's name and
 * world matrix and its material's name. Textures are left out: they are compared by SSIM.
 */
export function geometryHash(doc: Document): string {
  const hash = createHash('sha256')
  const bytes = (a: ArrayLike<number> & ArrayBufferView) =>
    new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  for (const { node, prim } of primitives(doc)) {
    hash.update(`${node.getName()}|${prim.getMaterial()?.getName()}|${node.getWorldMatrix()}`)
    hash.update(bytes(prim.getIndices()!.getArray()!))
    for (const semantic of prim.listSemantics().sort()) {
      hash.update(semantic)
      hash.update(bytes(prim.getAttribute(semantic)!.getArray()!))
    }
  }
  return hash.digest('hex')
}

/**
 * A primitive's positions in the core frame (mm, z up). The exporter wrote core (x, y, z) as
 * glTF (x, z, -y); quantization put a scale and offset on the node, so go through world space.
 */
export function corePositions(node: Node, prim: Primitive): Float64Array {
  const m = node.getWorldMatrix()
  const pos = prim.getAttribute('POSITION')!
  const out = new Float64Array(pos.getCount() * 3)
  const e = [0, 0, 0]
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, e)
    const [x, y, z] = e as Vec3
    out[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]
    out[i * 3 + 1] = -(m[2] * x + m[6] * y + m[10] * z + m[14])
    out[i * 3 + 2] = m[1] * x + m[5] * y + m[9] * z + m[13]
  }
  return out
}

/** The box around every primitive, or those with the named material, in the core frame. */
export function bounds(doc: Document, material?: string): Box {
  const box: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (const { node, prim } of primitives(doc)) {
    if (material && prim.getMaterial()?.getName() !== material) continue
    const p = corePositions(node, prim)
    for (let i = 0; i < p.length; i++) {
      box.min[i % 3] = Math.min(box.min[i % 3]!, p[i]!)
      box.max[i % 3] = Math.max(box.max[i % 3]!, p[i]!)
    }
  }
  return box
}

/**
 * The boxes around the connected pieces of a material's triangles, in the core frame. Vertices
 * at the same position join pieces even when their normals differ. With wallsOnly, only
 * near-vertical triangles count, so a hole through a slab comes out as the piece of its wall.
 */
export function islands(doc: Document, material: string, wallsOnly = false): Box[] {
  const boxes: Box[] = []
  for (const { node, prim } of primitives(doc)) {
    if (prim.getMaterial()?.getName() !== material) continue
    const p = corePositions(node, prim)
    const idx = prim.getIndices()!.getArray()!
    const n = p.length / 3
    const parent = Int32Array.from({ length: n }, (_, i) => i)
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!
      return i
    }
    const byPosition = new Map<string, number>()
    for (let i = 0; i < n; i++) {
      const key = `${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]}`
      const first = byPosition.get(key)
      if (first === undefined) byPosition.set(key, i)
      else parent[find(i)] = find(first)
    }
    const used = new Uint8Array(n)
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!]
      if (wallsOnly) {
        const u = [0, 1, 2].map((k) => p[b * 3 + k]! - p[a * 3 + k]!)
        const v = [0, 1, 2].map((k) => p[c * 3 + k]! - p[a * 3 + k]!)
        const nx = u[1]! * v[2]! - u[2]! * v[1]!
        const ny = u[2]! * v[0]! - u[0]! * v[2]!
        const nz = u[0]! * v[1]! - u[1]! * v[0]!
        if (Math.abs(nz) > 0.2 * Math.hypot(nx, ny, nz)) continue
      }
      used[a] = used[b] = used[c] = 1
      parent[find(a)] = find(b)
      parent[find(b)] = find(c)
    }
    const byRoot = new Map<number, Box>()
    for (let i = 0; i < n; i++) {
      if (!used[i]) continue
      const r = find(i)
      const box =
        byRoot.get(r) ??
        byRoot
          .set(r, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] })
          .get(r)!
      for (let k = 0; k < 3; k++) {
        box.min[k] = Math.min(box.min[k]!, p[i * 3 + k]!)
        box.max[k] = Math.max(box.max[k]!, p[i * 3 + k]!)
      }
    }
    boxes.push(...byRoot.values())
  }
  return boxes
}

export const centre = (b: Box): Vec2 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]

/**
 * How measured points line up with expected ones: the worst distance from an expected point to
 * its nearest measured point, and how many distinct measured points were nearest to one.
 * A one-to-one match has matched === expected.length === measured.length.
 */
export function coincidence(expected: Vec2[], measured: Vec2[]) {
  let worst = 0
  const claimed = new Set<number>()
  for (const [x, y] of expected) {
    let best = -1
    let distance = Infinity
    measured.forEach(([mx, my], i) => {
      const d = Math.hypot(mx - x, my - y)
      if (d < distance) [best, distance] = [i, d]
    })
    worst = Math.max(worst, distance)
    claimed.add(best)
  }
  return { worst, matched: claimed.size, expected: expected.length, measured: measured.length }
}

/** The Basis Universal mode of a KTX2 image, from its data format descriptor's colour model. */
export function ktx2Format(image: Uint8Array): 'ETC1S' | 'UASTC' | 'other' {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength)
  const model = image[view.getUint32(48, true) + 12]
  return model === 163 ? 'ETC1S' : model === 166 ? 'UASTC' : 'other'
}

export function textures(doc: Document) {
  return doc
    .getRoot()
    .listTextures()
    .map((t) => ({
      name: t.getName(),
      mimeType: t.getMimeType(),
      format: t.getMimeType() === 'image/ktx2' ? ktx2Format(t.getImage()!) : 'other',
      size: t.getSize() ?? [0, 0],
      slots: listTextureSlots(t)
    }))
}
