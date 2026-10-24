// What joins the Pi to the breadboard (SPEC 6.2–6.4, 10.4, 10.5): the Pi's 40 header pins, the
// T-board, an IDC socket on each header and the ribbon between them. The pins are instanced and
// addressable by physical number; the T-board and the sockets are copies of their models; the
// ribbon is simulated, clamped in both sockets' cable lines with conductor 1 on the same side, and
// drawn as a strip through the solver's rows of particles.
import piBoardJson from '../content/controllers/pi5-board.json'
import {
  BoxGeometry,
  Color,
  type Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector3
} from 'three/webgpu'
import type { Pose } from '../physics'
import type { CircuitDoc } from '../core/model/types'
import { PI_PIN_TIPS_ABOVE_TABLE_MM } from '../core/reach/reach'
import { type CableIn, type CableState, fromCore, type Placement, toCore } from './cables'
import { poseMatrix, tboardPose } from './coords'
import { ModelInstances } from './instances'
import { modelNow, textureNow } from './loaders'
import { type CableEnd, ribbonGeometry, ribbonMaterial } from './ribbon'
import { SUBDIVISIONS } from './tube'

// Heights in the Pi's model, from pi5.colliders.json (bench.test.ts holds them to it).
/** The header's posts run from below the PCB (header-pins) to PI_PIN_TIPS_ABOVE_TABLE_MM. */
export const PI_PIN_BOTTOM_MM = 0.886
/** The top of the header's plastic base, where a socket's mating face rests (header-base). */
export const PI_HEADER_BASE_TOP_MM = 5.326
/** The PCB's top face (pcb). */
export const PI_PCB_TOP_MM = 2.756

const PIN_SIDE_MM = 0.64
const GOLD = new Color('#d8b15a')
const up = new Vector3(0, 1, 0)
/** Socket frames' way out of the cable wall: core −x. */
const cableWall = new Vector3(-1, 0, 0)
/** Particles across the simulated ribbon (the solver takes 5 to 9). */
const RIBBON_COLUMNS = 7
/** An over-span ribbon is tinted toward this red (SPEC 10.5). */
const TAUT = new Color('#ff6b6b')

/** Each header pin's centre in the Pi's frame: odd pins on the inner row, from the end away from the ports. */
function piPinXY(physical: number): [number, number] {
  const { pin1Mm, pitchMm } = piBoardJson.header
  const k = Math.floor((physical - 1) / 2)
  return [pin1Mm[0]! + k * pitchMm, pin1Mm[1]! + (physical % 2 === 1 ? 0 : pitchMm)]
}

/** A socket's cable exit in the scene, from its pose. */
function cableEnd(sockets: ModelInstances, pose: Matrix4): CableEnd | null {
  const a = sockets.node('cable-a')
  const b = sockets.node('cable-b')
  if (!a || !b) return null
  const at = (m: Matrix4) => new Vector3().setFromMatrixPosition(m.clone().premultiply(pose))
  const out = cableWall.clone().transformDirection(pose)
  return { a: at(a), b: at(b), out }
}

/**
 * The solver's frame at a socket (physics/types RibbonDef): at the middle of the cable's exit
 * line, +y out into the cable and +x from conductor 1 toward 40, so the column at -x is conductor
 * 1 at both ends.
 */
function ribbonFrame(end: CableEnd): Pose {
  const [a, b] = [new Vector3(...toCore(end.a)), new Vector3(...toCore(end.b))]
  const x = b.clone().sub(a).normalize()
  const y = new Vector3(...toCore(end.out))
  y.addScaledVector(x, -y.dot(x)).normalize()
  const q = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(x, y, x.clone().cross(y))
  )
  const o = a.add(b).multiplyScalar(0.5)
  return { position: [o.x, o.y, o.z], rotation: [q.x, q.y, q.z, q.w] }
}

/** Points between each pair of rows along a uniform Catmull-Rom spline, column by column. */
function smoothRows(rows: Vector3[][]): Vector3[][] {
  const n = rows.length
  const at = (i: number, j: number) =>
    i < 0
      ? rows[0]![j]!.clone().multiplyScalar(2).sub(rows[1]![j]!)
      : i >= n
        ? rows[n - 1]![j]!.clone()
            .multiplyScalar(2)
            .sub(rows[n - 2]![j]!)
        : rows[i]![j]!
  const out: Vector3[][] = []
  for (let i = 0; i + 1 < n; i++)
    for (let s = 0; s < SUBDIVISIONS; s++) {
      const t = s / SUBDIVISIONS
      const [t2, t3] = [t * t, t * t * t]
      const c = [
        -0.5 * t3 + t2 - 0.5 * t,
        1.5 * t3 - 2.5 * t2 + 1,
        -1.5 * t3 + 2 * t2 + 0.5 * t,
        0.5 * t3 - 0.5 * t2
      ]
      out.push(
        rows[i]!.map((_, j) =>
          [i - 1, i, i + 1, i + 2].reduce(
            (p, r, k) => p.addScaledVector(at(r, j), c[k]!),
            new Vector3()
          )
        )
      )
    }
  out.push(rows[n - 1]!)
  return out
}

export class BenchLayer {
  /** The Pi's header pins, instance n − 1 for physical pin n (tests read it). */
  readonly piPins: InstancedMesh
  tboard: ModelInstances | null = null
  sockets: ModelInstances | null = null
  ribbon: Mesh | null = null
  /** The two sockets' cable exits, the Pi's first; null until both sockets are placed. */
  private ends: [CableEnd, CableEnd] | null = null
  private poses: { tboard: Matrix4 | null; sockets: Matrix4[] } = { tboard: null, sockets: [] }
  private lengthMm = 0
  private textures = ''
  private taut = false
  /** Points across each of the ribbon's drawn rows. */
  private columns = 0
  private readonly pinMaterial = new MeshStandardNodeMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.35
  })

  constructor(private readonly group: Group) {
    const height = PI_PIN_TIPS_ABOVE_TABLE_MM - PI_PIN_BOTTOM_MM
    this.piPins = new InstancedMesh(
      new BoxGeometry(PIN_SIDE_MM, height, PIN_SIDE_MM),
      this.pinMaterial,
      40
    )
    this.piPins.castShadow = this.piPins.receiveShadow = true
    for (let n = 1; n <= 40; n++) this.piPins.setColorAt(n - 1, GOLD)
    group.add(this.piPins)
  }

  /** Tints a header pin (live Pi state); null restores its gold. */
  setPiPin(physical: number, color: Color | null): void {
    this.piPins.setColorAt(physical - 1, color ?? GOLD)
    this.piPins.instanceColor!.needsUpdate = true
  }

  /** Places everything from the document; models still loading are placed when they arrive. */
  update(doc: CircuitDoc): void {
    const pi = poseMatrix(doc.controller.pi.transform, 0)
    const height = PI_PIN_TIPS_ABOVE_TABLE_MM - PI_PIN_BOTTOM_MM
    const m = new Matrix4()
    for (let n = 1; n <= 40; n++) {
      const [x, y] = piPinXY(n)
      m.makeTranslation(x, PI_PIN_BOTTOM_MM + height / 2, -y).premultiply(pi)
      this.piPins.setMatrixAt(n - 1, m)
    }
    this.piPins.instanceMatrix.needsUpdate = true
    this.piPins.boundingSphere = null

    const tbPose = tboardPose(doc)
    const tbModel = modelNow('/models/tboard.glb')
    if (tbModel && !this.tboard) this.tboard = new ModelInstances(this.group, tbModel)
    this.tboard?.set(tbPose ? [tbPose] : [])

    const socketModel = modelNow('/models/idc-socket.glb')
    if (socketModel && !this.sockets) this.sockets = new ModelInstances(this.group, socketModel)
    // At the Pi the socket turns a quarter so contact 1 meets pin 1 and the cable leaves toward
    // the board's middle; on the T-board it sits on the shroud's rim as modelled (ADR-0038).
    const [cx, cy] = piBoardJson.header.centerMm
    const onPi = new Matrix4()
      .compose(
        new Vector3(cx, PI_HEADER_BASE_TOP_MM, -cy!),
        new Quaternion().setFromAxisAngle(up, Math.PI / 2),
        new Vector3(1, 1, 1)
      )
      .premultiply(pi)
    const rim = this.tboard?.node('socket')
    const onTboard = tbPose && rim ? rim.clone().premultiply(tbPose) : null
    const sockets = onTboard ? [onPi, onTboard] : [onPi]
    this.sockets?.set(sockets)
    this.poses = { tboard: tbPose, sockets }

    const ends = this.sockets &&
      onTboard && [cableEnd(this.sockets, onPi), cableEnd(this.sockets, onTboard)]
    this.ends = ends?.[0] && ends[1] ? [ends[0], ends[1]] : null
    this.lengthMm = doc.controller.ribbon.lengthMm
    const colors = textureNow('/models/ribbon-colors.ktx2')
    const ridges = textureNow('/models/ribbon-ridges.ktx2')
    const textures = JSON.stringify([colors?.uuid, ridges?.uuid])
    if (!this.ends) this.removeRibbon()
    else if (this.ribbon && textures !== this.textures) {
      ;(this.ribbon.material as MeshStandardNodeMaterial).dispose()
      this.ribbon.material = this.ribbonMaterial(colors, ridges)
    }
    this.textures = textures
  }

  /** Whether the models the ribbon's ends come from have settled. */
  get ready(): boolean {
    return (
      modelNow('/models/tboard.glb') !== undefined &&
      modelNow('/models/idc-socket.glb') !== undefined
    )
  }

  /** The T-board and the sockets, as collider placements. */
  placements(): Placement[] {
    const { tboard, sockets } = this.poses
    return [
      ...(tboard ? [{ key: 'tboard', url: '/models/tboard.colliders.json', pose: tboard }] : []),
      ...sockets.map((pose, i) => ({
        key: `socket${i}`,
        url: '/models/idc-socket.colliders.json',
        pose
      }))
    ]
  }

  /** The ribbon, as the solver's cable: clamped at both sockets' cable lines. */
  cable(): CableIn | null {
    if (!this.ends) return null
    const [a, b] = this.ends.map(ribbonFrame) as [Pose, Pose]
    return {
      key: 'ribbon',
      build: `ribbon ${this.lengthMm}`,
      spec: { kind: 'ribbon', a, b, lengthMm: this.lengthMm, columns: RIBBON_COLUMNS }
    }
  }

  /** Draws the ribbon through its particles; hidden until the settled scene is `ready`. */
  simulate(state: CableState | null, ready: boolean): void {
    if (!ready || !state || !this.ends) {
      if (!ready) this.removeRibbon()
      return
    }
    const { body, positions } = state
    const rows = Array.from({ length: body.rows }, (_, r) =>
      Array.from({ length: body.columns }, (_, c) =>
        fromCore(positions, body.offset + r * body.columns + c)
      )
    )
    const smooth = smoothRows(rows)
    this.columns = body.columns
    if (!this.ribbon) {
      const colors = textureNow('/models/ribbon-colors.ktx2')
      const ridges = textureNow('/models/ribbon-ridges.ktx2')
      this.ribbon = new Mesh(ribbonGeometry(smooth), this.ribbonMaterial(colors, ridges))
      this.ribbon.castShadow = this.ribbon.receiveShadow = true
      this.ribbon.frustumCulled = false
      this.group.add(this.ribbon)
    } else ribbonGeometry(smooth, this.ribbon.geometry)
    if (body.taut !== this.taut) {
      this.taut = body.taut
      this.tint(this.ribbon.material as MeshStandardNodeMaterial)
    }
  }

  /** The ribbon's length along its middle, measured from its mesh; null when it isn't drawn. */
  ribbonLength(): number | null {
    const position = this.ribbon?.geometry.getAttribute('position')
    if (!position) return null
    const middle = (row: number) => {
      const c = new Vector3()
      for (let j = 0; j < this.columns; j++)
        c.add(new Vector3().fromBufferAttribute(position, row * this.columns + j))
      return c.divideScalar(this.columns)
    }
    let length = 0
    for (let row = 1; row < position.count / this.columns; row++)
      length += middle(row).distanceTo(middle(row - 1))
    return length
  }

  /** Frees the GPU side; the next update draws everything again. */
  dispose(): void {
    this.piPins.geometry.dispose()
    this.piPins.dispose()
    this.pinMaterial.dispose()
    this.tboard?.dispose()
    this.sockets?.dispose()
    this.tboard = this.sockets = null
    this.removeRibbon()
  }

  private ribbonMaterial(
    colors: ReturnType<typeof textureNow>,
    ridges: ReturnType<typeof textureNow>
  ): MeshStandardNodeMaterial {
    return this.tint(ribbonMaterial(colors, ridges))
  }

  /** Over-span, the PVC takes a red tint; in span, its own colour. */
  private tint(m: MeshStandardNodeMaterial): MeshStandardNodeMaterial {
    const base = m.map ? new Color(0xffffff) : new Color(0x9a9a9e)
    m.color.copy(this.taut ? base.multiply(TAUT) : base)
    m.emissive.copy(this.taut ? TAUT.clone().multiplyScalar(0.2) : new Color(0))
    return m
  }

  private removeRibbon(): void {
    if (!this.ribbon) return
    this.group.remove(this.ribbon)
    this.ribbon.geometry.dispose()
    ;(this.ribbon.material as MeshStandardNodeMaterial).dispose()
    this.ribbon = null
  }
}
