// Core frames (mm, z up) in the three.js scene (mm, y up): a core point (x, y, z) is three
// (x, z, −y). A rotation about core z by θ is a rotation about three's y by the same θ.
import { Vector3 } from 'three/webgpu'
import { boardDef } from '../core/defs/boards'
import { partDef } from '../core/defs/parts'
import { holePosition } from '../core/geometry/breadboard'
import type {
  BoardInstance,
  CircuitDoc,
  Endpoint,
  HoleRef,
  PartInstance,
  Transform2D,
  Vec2
} from '../core/model/types'
import { ASSUMED_HEIGHTS_MM, toTable } from '../core/reach/reach'

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

/** A hole's centre on its board's top surface, in the scene. */
export function holeInScene(board: BoardInstance, hole: HoleRef, target = new Vector3()): Vector3 {
  const def = boardDef(board.defId)
  return toThree(toTable(board.transform, holePosition(def, hole)), def.body.heightMm, target)
}

/** Where an off-board module's connector pin is in the scene, or null if it isn't on the table. */
export function modulePinInScene(part: PartInstance, pin: string): Vector3 | null {
  const offset = partDef(part.defId).pins.find((p) => p.id === pin)?.offsetPitch
  const pose = part.placement.offboardPose
  if (!pose || !offset) return null
  return toThree(toTable(pose, [offset[0] * 2.54, offset[1] * 2.54]), ASSUMED_HEIGHTS_MM.modulePin)
}

/** Where a lead end is: in a hole on a board, or on an off-board module's pin. */
export function endpointInScene(
  doc: CircuitDoc,
  end: Endpoint
): { at: Vector3; turn: number } | null {
  if ('hole' in end) {
    const board = doc.boards.find((b) => b.id === end.hole.board)
    if (!board) return null
    return { at: holeInScene(board, end.hole), turn: (board.transform.rotationDeg * Math.PI) / 180 }
  }
  const part = doc.parts.find((p) => p.id === end.pin.part)
  const at = part && modulePinInScene(part, end.pin.pin)
  if (!at) return null
  return { at, turn: (part.placement.offboardPose!.rotationDeg * Math.PI) / 180 }
}
