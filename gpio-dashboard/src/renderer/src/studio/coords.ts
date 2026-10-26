// Core frames (mm, z up) in the three.js scene (mm, y up): a core point (x, y, z) is three
// (x, z, −y). A rotation about core z by θ is a rotation about three's y by the same θ.
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu'
import dupontJson from '../content/leads/dupont.json'
import { boardDef } from '../core/defs/boards'
import type { Rect } from '../core/defs/controllers'
import { partDef } from '../core/defs/parts'
import { holePosition } from '../core/geometry/breadboard'
import { tboardToBoard } from '../core/geometry/tboard'
import type {
  BoardInstance,
  CircuitDoc,
  Endpoint,
  HoleRef,
  PartInstance,
  Transform2D,
  Vec2
} from '../core/model/types'
import { docPartDefs } from '../core/netlist/netlist'
import { ASSUMED_HEIGHTS_MM, restHeightMm, toTable } from '../core/reach/reach'

const up = new Vector3(0, 1, 0)

/** A part's definition in `doc`: the library's, or one of the project's own (SPEC 7). */
export const defOf = (doc: CircuitDoc, defId: string) => docPartDefs(doc, partDef)(defId)

export function toThree([x, y]: Vec2, z: number, target = new Vector3()): Vector3 {
  return target.set(x, z, -y)
}

/** Scene position and rotation for a local frame placed on the table at `transform`, `z` up. */
export function tablePose(
  transform: Transform2D,
  z: number
): { position: [number, number, number]; rotation: [number, number, number] } {
  const [x, y] = transform.position
  return { position: [x, z, -y], rotation: [0, (transform.rotationDeg * Math.PI) / 180, 0] }
}

/** The same placement as a matrix: a model built in that local frame goes into the scene by it. */
export function poseMatrix(transform: Transform2D, z: number): Matrix4 {
  return new Matrix4().compose(
    toThree(transform.position, z),
    new Quaternion().setFromAxisAngle(up, (transform.rotationDeg * Math.PI) / 180),
    new Vector3(1, 1, 1)
  )
}

/** The T-board's frame (pin 1 at the origin, z = 0 on the board's top), or null off any board. */
export function tboardPose(doc: CircuitDoc): Matrix4 | null {
  const tb = doc.controller.tboard
  const board = doc.boards.find((b) => b.id === tb.board)
  if (!board) return null
  const def = boardDef(board.defId)
  const turn = tb.orientation === 'header-toward-last-row' ? 180 : 0
  return poseMatrix(
    {
      position: toTable(board.transform, tboardToBoard(def, tb, [0, 0])),
      rotationDeg: board.transform.rotationDeg + turn
    },
    def.body.heightMm
  )
}

/** A hole's centre on its board's top surface, in the scene. */
export function holeInScene(board: BoardInstance, hole: HoleRef, target = new Vector3()): Vector3 {
  const def = boardDef(board.defId)
  return toThree(toTable(board.transform, holePosition(def, hole)), def.body.heightMm, target)
}

/** An off-board module's pin, as its model has it: the tip relative to the first pin, and the axis. */
export interface ModulePinFrame {
  /** In the module's frame, three axes; x and z are measured from the first pin. */
  at: Vector3
  axis: Vector3
}

/** What an off-board module's model says about it, in its pose's frame (first pin at the origin). */
export interface ModuleModel {
  pins: Record<string, ModulePinFrame>
  /** Its footprint in core x and y, and its height. */
  rect: Rect
  /**
   * The footprints of its rigid pieces, which decide what it rests on: a cable or tail lies where
   * the model draws it, so it does not lift a module whose ends are on the table.
   */
  rests: Rect[]
  top: number
}

const modules = new Map<string, ModuleModel>()

/** Records a module definition's model once it has loaded; until then its pins are assumed. */
export function setModuleModel(defId: string, model: ModuleModel): void {
  modules.set(defId, model)
}

export function moduleModel(defId: string): ModuleModel | undefined {
  return modules.get(defId)
}

/** Where a module's pin is in its pose's frame: the model's tip, or the definition's layout. */
function modulePinLocal(doc: CircuitDoc, part: PartInstance, pin: string): ModulePinFrame | null {
  const known = modules.get(part.defId)?.pins[pin]
  if (known) return known
  const offset = defOf(doc, part.defId).pins.find((p) => p.id === pin)?.offsetPitch
  if (!offset) return null
  return {
    at: toThree([offset[0] * 2.54, offset[1] * 2.54], ASSUMED_HEIGHTS_MM.modulePin),
    axis: up
  }
}

/**
 * How far a module's lowest pin pointing sideways (a right-angle header lying flat) sits below the
 * half-width of the Dupont housing that plugs onto it: lifted that much, the housing clears the
 * surface the module rests on instead of passing through it.
 */
function housingClearance(model: ModuleModel): number {
  const half = dupontJson.housing.widthMm / 2
  let lift = 0
  for (const { at, axis } of Object.values(model.pins))
    if (Math.abs(axis.y) < 0.5) lift = Math.max(lift, half - at.y)
  return lift
}

/** How far a module is raised above what it rests on, so housings on flat-lying pins clear it. */
export function moduleLiftMm(defId: string): number {
  const model = modules.get(defId)
  return model ? housingClearance(model) : 0
}

/**
 * How high an off-board module laid at `pose` rests: on the highest board under any of its rigid
 * pieces, else on the table, raised by `moduleLiftMm`. Until its model has loaded, its first pin
 * stands in for the footprint.
 */
export function moduleRestMm(doc: CircuitDoc, defId: string, pose: Transform2D): number {
  const outlines: Vec2[][] = modules.get(defId)?.rests.map((r) => [
    [r.xMin, r.yMin],
    [r.xMax, r.yMin],
    [r.xMax, r.yMax],
    [r.xMin, r.yMax]
  ]) ?? [[[0, 0]]]
  const rest = Math.max(
    ...outlines.map((o) =>
      restHeightMm(
        doc,
        o.map((c) => toTable(pose, c))
      )
    )
  )
  return rest + moduleLiftMm(defId)
}

/** Where an off-board module's connector pin is in the scene, or null if it isn't on the table. */
export function modulePinInScene(doc: CircuitDoc, part: PartInstance, pin: string): Vector3 | null {
  const pose = part.placement.offboardPose
  const local = pose && modulePinLocal(doc, part, pin)
  return local
    ? local.at.clone().applyMatrix4(poseMatrix(pose, moduleRestMm(doc, part.defId, pose)))
    : null
}

/**
 * Where a lead end mates, and the way a housing there points out (SPEC 6.5): straight up out of a
 * hole, or along a module's pin or socket.
 */
export function endpointInScene(
  doc: CircuitDoc,
  end: Endpoint
): { at: Vector3; turn: number; axis: Vector3 } | null {
  if ('hole' in end) {
    const board = doc.boards.find((b) => b.id === end.hole.board)
    if (!board) return null
    return {
      at: holeInScene(board, end.hole),
      turn: (board.transform.rotationDeg * Math.PI) / 180,
      axis: up.clone()
    }
  }
  const part = doc.parts.find((p) => p.id === end.pin.part)
  const pose = part?.placement.offboardPose
  const local = pose && modulePinLocal(doc, part, end.pin.pin)
  if (!local) return null
  const turn = (pose.rotationDeg * Math.PI) / 180
  return {
    at: local.at.clone().applyMatrix4(poseMatrix(pose, moduleRestMm(doc, part.defId, pose))),
    turn,
    axis: local.axis.clone().applyAxisAngle(up, turn)
  }
}
