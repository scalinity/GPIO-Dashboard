// Flat square markers just above holes and pins: hover strips, placed footprints and ghosts. One
// instanced mesh per set, replaced when it has to grow.
import {
  BoxGeometry,
  Color,
  type Group,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  Quaternion,
  Vector3
} from 'three/webgpu'

export interface Marker {
  at: Vector3
  /** Rotation about the vertical, in radians. */
  turn: number
  size: number
  color: Color
}

const geometry = new BoxGeometry(1, 0.3, 1)
const material = new MeshBasicNodeMaterial()
const up = new Vector3(0, 1, 0)

export class Markers {
  private mesh: InstancedMesh

  /** `lift` raises the markers above what they mark, in mm. */
  constructor(
    private readonly group: Group,
    private readonly lift: number
  ) {
    this.mesh = this.instanced(64)
  }

  get count(): number {
    return this.mesh.count
  }

  set(markers: Marker[]): void {
    if (markers.length > this.mesh.instanceMatrix.count) {
      this.group.remove(this.mesh)
      this.mesh.dispose()
      this.mesh = this.instanced(markers.length * 2)
    }
    const m = new Matrix4()
    const q = new Quaternion()
    const position = new Vector3()
    markers.forEach(({ at, turn, size, color }, i) => {
      position.copy(at).y += this.lift
      m.compose(position, q.setFromAxisAngle(up, turn), new Vector3(size, 1, size))
      this.mesh.setMatrixAt(i, m)
      this.mesh.setColorAt(i, color)
    })
    this.mesh.count = markers.length
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  private instanced(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, capacity)
    // Colours exist from the start, so the material never has to be rebuilt for them.
    mesh.setColorAt(0, new Color())
    mesh.count = 0
    mesh.frustumCulled = false
    this.group.add(mesh)
    return mesh
  }
}
