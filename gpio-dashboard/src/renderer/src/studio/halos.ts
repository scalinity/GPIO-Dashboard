// Warning halos (SPEC 11.5): a soft glow on the board under a part that an ERC issue names as over
// its rating. One instanced quad per halo, additive, so the bloom lifts it; static, so a halo never
// keeps the scene drawing.
import {
  AdditiveBlending,
  Color,
  type Group,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3
} from 'three/webgpu'
import { float, length, smoothstep, uv, vec3 } from 'three/tsl'

export interface Halo {
  /** The part's selection box (bodies.ts), a transform of the unit cube. */
  box: Matrix4
  color: Color
}

/** The glow reaches this much beyond the box, as a multiple and in mm. */
const REACH = 1.8
const MARGIN_MM = 4
const LIFT_MM = 0.2

export class Halos {
  private mesh: InstancedMesh | null = null
  private readonly geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  private readonly material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    // Light, not a surface: the Lab look's fog leaves it as bright as it is drawn.
    fog: false
  })

  constructor(private readonly group: Group) {
    // The instance colour multiplies this white; the falloff is the glow's shape.
    this.material.colorNode = vec3(1, 1, 1)
    this.material.opacityNode = float(1).sub(smoothstep(0.1, 0.5, length(uv().sub(0.5))))
  }

  get count(): number {
    return this.mesh?.count ?? 0
  }

  set(halos: Halo[]): void {
    if (!halos.length) {
      if (this.mesh) this.mesh.count = 0
      return
    }
    if (!this.mesh || halos.length > this.mesh.instanceMatrix.count) {
      this.release()
      this.mesh = new InstancedMesh(this.geometry, this.material, halos.length * 2)
      this.mesh.setColorAt(0, new Color())
      this.mesh.frustumCulled = false
      this.mesh.renderOrder = 2
      this.group.add(this.mesh)
    }
    const [position, rotation, scale] = [new Vector3(), new Quaternion(), new Vector3()]
    halos.forEach(({ box, color }, i) => {
      box.decompose(position, rotation, scale)
      position.y -= scale.y / 2 - LIFT_MM
      this.mesh!.setMatrixAt(
        i,
        new Matrix4().compose(
          position,
          rotation,
          new Vector3(scale.x * REACH + MARGIN_MM, 1, scale.z * REACH + MARGIN_MM)
        )
      )
      this.mesh!.setColorAt(i, color)
    })
    this.mesh.count = halos.length
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  dispose(): void {
    this.release()
    this.geometry.dispose()
    this.material.dispose()
  }

  private release(): void {
    if (!this.mesh) return
    this.group.remove(this.mesh)
    this.mesh.dispose()
    this.mesh = null
  }
}
