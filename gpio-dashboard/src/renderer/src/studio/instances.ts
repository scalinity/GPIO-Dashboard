// One loaded model drawn any number of times (SPEC 10.8): an InstancedMesh per mesh in the model,
// so every copy shares one draw call per mesh. Each copy can carry its own colour and emission on
// any named mesh, node or material, and its own transform on any named node (SPEC 10.6), set
// through the handles the parts layer gives out.
import {
  Box3,
  Color,
  type Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  MeshPhysicalNodeMaterial,
  type Object3D
} from 'three/webgpu'
import { instancedDynamicBufferAttribute } from 'three/tsl'

interface Piece {
  source: Mesh
  /** The mesh and its ancestors below the model's scene, outermost first. */
  chain: Object3D[]
  /** Its own name, its ancestors' and its material's: what a handle can call it. */
  names: Set<string>
  mesh: InstancedMesh
  /** Per-copy colour multiplies a white copy of the material; null until a copy is tinted. */
  tinted: boolean
  emission: InstancedBufferAttribute | null
  /** The material made for tint or emission, which this class owns. */
  owned: Material | null
}

const white = new Color(1, 1, 1)

/** A node material with every own property of `m` (as three converts materials itself). */
function nodeMaterial(m: Material): MeshPhysicalNodeMaterial {
  const out = new MeshPhysicalNodeMaterial()
  for (const [key, value] of Object.entries(m))
    if (key !== 'uuid' && key !== '_listeners')
      (out as unknown as Record<string, unknown>)[key] = value
  return out
}

export class ModelInstances {
  private readonly pieces: Piece[] = []
  private poses: Matrix4[] = []
  /** Per copy: node name → transform applied after the node's own (identity when absent). */
  private nodes: Map<string, Matrix4>[] = []

  constructor(
    private readonly group: Group,
    private readonly model: Group,
    capacity = 1
  ) {
    model.traverse((o) => {
      const source = o as Mesh
      if (!source.isMesh) return
      const chain: Object3D[] = []
      for (let n: Object3D | null = source; n && n !== model; n = n.parent) chain.unshift(n)
      const material = source.material as Material
      const names = new Set([...chain.map((n) => n.name), material.name].filter(Boolean))
      const piece: Piece = {
        source,
        chain,
        names,
        mesh: null!,
        tinted: false,
        emission: null,
        owned: null
      }
      piece.mesh = this.instanced(piece, capacity)
      this.pieces.push(piece)
    })
  }

  get count(): number {
    return this.poses.length
  }

  /** The root node's glTF extras (a flexible part's `seatMm`). */
  get extras(): Record<string, unknown> {
    return this.model.children[0]?.userData ?? {}
  }

  /** Every name a mesh, node or material of the model goes by. */
  names(): string[] {
    return [...new Set(this.pieces.flatMap((p) => [...p.names]))]
  }

  /** The model's bounds in its own frame. */
  bounds(): Box3 {
    return new Box3().setFromObject(this.model)
  }

  /** A node's transform relative to the model (an empty such as `pin-1`, `socket` or `wire`). */
  node(name: string): Matrix4 | null {
    return this.model.getObjectByName(name)?.matrixWorld ?? null
  }

  /** Places one copy per pose. Every copy starts with the model's own colours and transforms. */
  set(poses: Matrix4[]): void {
    const grow = poses.length > this.pieces[0]!.mesh.instanceMatrix.count
    this.poses = poses
    this.nodes = poses.map(() => new Map())
    for (const piece of this.pieces) {
      if (grow) {
        this.release(piece)
        piece.mesh = this.instanced(piece, poses.length * 2)
      }
      piece.mesh.count = poses.length
      if (piece.tinted) for (let i = 0; i < poses.length; i++) this.tint(piece, i, null)
      if (piece.emission) piece.emission.array.fill(0)
      for (let i = 0; i < poses.length; i++) this.place(piece, i)
      this.changed(piece)
    }
  }

  /** Moves copy `i` without resetting it (a lift during insertion). */
  move(i: number, pose: Matrix4): void {
    this.poses[i] = pose
    for (const piece of this.pieces) {
      this.place(piece, i)
      this.changed(piece)
    }
  }

  /** Tints copy `i`'s meshes called `name`; null restores the model's colour. */
  color(i: number, name: string, color: Color | null): void {
    for (const piece of this.named(name)) {
      if (!piece.tinted && color) {
        piece.tinted = true
        this.refresh(piece)
        for (let j = 0; j < this.poses.length; j++) this.tint(piece, j, null)
      }
      if (piece.tinted) this.tint(piece, i, color)
      this.changed(piece)
    }
  }

  /** Lights copy `i`'s meshes called `name` with a linear emitted colour; null turns it off. */
  emit(i: number, name: string, color: Color | null): void {
    for (const piece of this.named(name)) {
      if (!piece.emission && color) {
        const capacity = piece.mesh.instanceMatrix.count
        piece.emission = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
        this.refresh(piece)
      }
      if (!piece.emission) continue
      ;(color ?? new Color(0, 0, 0)).toArray(piece.emission.array, i * 3)
      piece.emission.needsUpdate = true
    }
  }

  /** Sets copy `i`'s transform of node `name`, after the node's own; null restores it. */
  transform(i: number, name: string, matrix: Matrix4 | null): void {
    if (matrix) this.nodes[i]!.set(name, matrix.clone())
    else this.nodes[i]!.delete(name)
    for (const piece of this.pieces) {
      if (!piece.chain.some((n) => n.name === name)) continue
      this.place(piece, i)
      this.changed(piece)
    }
  }

  /** Copy `i`'s pose read back from what its first mesh draws (measurements). */
  drawnPose(i: number): Matrix4 {
    const piece = this.pieces[0]!
    const drawn = new Matrix4()
    piece.mesh.getMatrixAt(i, drawn)
    return drawn.multiply(this.local(piece, i).invert())
  }

  dispose(): void {
    for (const piece of this.pieces) this.release(piece)
  }

  private named(name: string): Piece[] {
    return this.pieces.filter((p) => p.names.has(name))
  }

  private instanced(piece: Piece, capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(piece.source.geometry, piece.source.material, capacity)
    mesh.name = piece.source.name
    mesh.count = 0
    mesh.castShadow = mesh.receiveShadow = true
    piece.tinted = false
    piece.emission = null
    this.group.add(mesh)
    return mesh
  }

  /** Builds the material copy that per-copy tint or emission needs. */
  private refresh(piece: Piece): void {
    piece.owned?.dispose()
    const source = piece.source.material as MeshStandardMaterial
    let m: Material = source
    if (piece.tinted) {
      const copy = source.clone()
      copy.color.copy(white)
      m = copy
      if (!piece.mesh.instanceColor) {
        const capacity = piece.mesh.instanceMatrix.count
        piece.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
      }
    }
    if (piece.emission) {
      const lit = nodeMaterial(m)
      lit.emissiveNode = instancedDynamicBufferAttribute(piece.emission, 'vec3')
      if (m !== source) m.dispose()
      m = lit
    }
    piece.owned = m === source ? null : m
    piece.mesh.material = m
  }

  private tint(piece: Piece, i: number, color: Color | null): void {
    piece.mesh.setColorAt(i, color ?? (piece.source.material as MeshStandardMaterial).color)
  }

  private local(piece: Piece, i: number): Matrix4 {
    const m = new Matrix4()
    const nodes = this.nodes[i]
    for (const n of piece.chain) {
      m.multiply(n.matrix)
      const extra = nodes?.get(n.name)
      if (extra) m.multiply(extra)
    }
    return m
  }

  private place(piece: Piece, i: number): void {
    piece.mesh.setMatrixAt(i, this.local(piece, i).premultiply(this.poses[i]!))
  }

  private changed(piece: Piece): void {
    piece.mesh.instanceMatrix.needsUpdate = true
    if (piece.mesh.instanceColor) piece.mesh.instanceColor.needsUpdate = true
    // Bounds are recomputed from the copies on the next frustum test.
    piece.mesh.boundingSphere = null
    piece.mesh.boundingBox = null
  }

  private release(piece: Piece): void {
    this.group.remove(piece.mesh)
    piece.mesh.dispose()
    piece.owned?.dispose()
    piece.owned = null
  }
}
