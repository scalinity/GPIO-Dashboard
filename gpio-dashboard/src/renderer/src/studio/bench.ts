// What joins the Pi to the breadboard (SPEC 6.2–6.4, 10.4): the Pi's 40 header pins, the T-board,
// an IDC socket on each header and the ribbon between them. The pins are instanced and addressable
// by physical number; the T-board and the sockets are copies of their models; the ribbon is a
// strip along its design curve until the physics lane drives it.
import piBoardJson from '../content/controllers/pi5-board.json'
import ribbonJson from '../content/controllers/ribbon.json'
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
import { boardDef } from '../core/defs/boards'
import type { CircuitDoc } from '../core/model/types'
import { PI_PIN_TIPS_ABOVE_TABLE_MM } from '../core/reach/reach'
import { poseMatrix, tboardPose } from './coords'
import { ModelInstances } from './instances'
import { modelNow, textureNow } from './loaders'
import { type CableEnd, ribbonDesign, ribbonGeometry, ribbonMaterial } from './ribbon'

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

/** How high the ribbon's middle must stay above a point: the table, a board's top or the Pi's PCB. */
function floorOf(doc: CircuitDoc): (p: Vector3) => number {
  const clear = ribbonJson.thicknessMm / 2
  const tops = [
    ...doc.boards.map((b) => {
      const { lengthMm, widthMm, heightMm } = boardDef(b.defId).body
      return { transform: b.transform, size: [lengthMm, widthMm], top: heightMm }
    }),
    {
      transform: doc.controller.pi.transform,
      size: [piBoardJson.outline.widthMm, piBoardJson.outline.depthMm],
      top: PI_PCB_TOP_MM
    }
  ].map((t) => ({ ...t, toLocal: poseMatrix(t.transform, 0).invert() }))
  const local = new Vector3()
  return (p) => {
    let y = 0
    for (const t of tops) {
      local.copy(p).applyMatrix4(t.toLocal)
      const [x, cy] = [local.x, -local.z]
      if (x >= 0 && x <= t.size[0]! && cy >= 0 && cy <= t.size[1]!) y = Math.max(y, t.top)
    }
    return y + clear
  }
}

export class BenchLayer {
  /** The Pi's header pins, instance n − 1 for physical pin n (tests read it). */
  readonly piPins: InstancedMesh
  tboard: ModelInstances | null = null
  sockets: ModelInstances | null = null
  ribbon: Mesh | null = null
  private ribbonKey = ''
  /** Points across each of the ribbon's rows. */
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
    this.sockets?.set(onTboard ? [onPi, onTboard] : [onPi])

    const ends = this.sockets &&
      onTboard && [cableEnd(this.sockets, onPi), cableEnd(this.sockets, onTboard)]
    const colors = textureNow('/models/ribbon-colors.ktx2')
    const ridges = textureNow('/models/ribbon-ridges.ktx2')
    const key =
      ends?.[0] && ends[1]
        ? JSON.stringify([ends, doc.controller.ribbon.lengthMm, colors?.uuid, ridges?.uuid])
        : ''
    if (key === this.ribbonKey) return
    this.ribbonKey = key
    this.removeRibbon()
    if (!ends?.[0] || !ends[1]) return
    const rows = ribbonDesign(ends[0], ends[1], doc.controller.ribbon.lengthMm, floorOf(doc))
    this.columns = rows[0]!.length
    this.ribbon = new Mesh(ribbonGeometry(rows), ribbonMaterial(colors, ridges))
    this.ribbon.castShadow = this.ribbon.receiveShadow = true
    this.group.add(this.ribbon)
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
    this.ribbonKey = ''
  }

  private removeRibbon(): void {
    if (!this.ribbon) return
    this.group.remove(this.ribbon)
    this.ribbon.geometry.dispose()
    ;(this.ribbon.material as MeshStandardNodeMaterial).dispose()
    this.ribbon = null
  }
}
