// Core frames (mm, z up) in the three.js scene (mm, y up): a core point (x, y, z) is three
// (x, z, −y). A rotation about core z by θ is a rotation about three's y by the same θ.
import { Vector3 } from 'three/webgpu'
import { boardDef } from '../core/defs/boards'
import { holePosition } from '../core/geometry/breadboard'
import type { BoardInstance, HoleRef, Transform2D, Vec2 } from '../core/model/types'
import { toTable } from '../core/reach/reach'

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
