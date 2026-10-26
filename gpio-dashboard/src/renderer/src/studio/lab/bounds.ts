// The Lab workroom's extent, and what keeps the camera in it (SPEC 10.7, ADR-0144). The tabletop
// stays at y = 0 (the physics floor is unchanged), so the room's floor is 900 mm below it. The
// camera never passes through a wall, the floor or the ceiling: a view farther than the room
// allows is shortened along its line to the target. The front (+z, south) is open, as a stage's
// is, for a camera that must stand farther back than the room is deep; the side the camera
// stands behind or close to is cut away, with its furniture.
import type { Vector3 } from 'three/webgpu'

/** The room's inside faces, mm. */
export const ROOM = {
  floor: -900,
  ceiling: 1900,
  west: -2400,
  east: 2400,
  north: -1700,
  south: 2600
} as const

/** The camera keeps this far inside a wall, the floor and the ceiling. */
export const MARGIN_MM = 150

/**
 * A side is cut away while the camera stands within this of its face: further than any piece of
 * furniture stands out from its wall, so the camera is never inside one.
 */
export const NEAR_MM = 900

export type Side = 'north' | 'south' | 'east' | 'west' | 'ceiling'
export const SIDES: Side[] = ['north', 'south', 'east', 'west', 'ceiling']

const LOW = { x: ROOM.west + MARGIN_MM, y: ROOM.floor + MARGIN_MM, z: ROOM.north + MARGIN_MM }
const HIGH = { x: ROOM.east - MARGIN_MM, y: ROOM.ceiling - MARGIN_MM, z: Infinity }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * Keeps `target` inside the room and shortens `position`'s distance from it until the camera is
 * inside too, keeping the direction. Returns whether either moved.
 */
export function clampToRoom(position: Vector3, target: Vector3): boolean {
  let moved = false
  for (const axis of ['x', 'y', 'z'] as const) {
    const v = clamp(target[axis], LOW[axis], HIGH[axis])
    if (v !== target[axis]) [target[axis], moved] = [v, true]
  }
  const offset = position.clone().sub(target)
  const length = offset.length()
  if (length === 0) return moved
  let reach = length
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = offset[axis] / length
    if (d > 0) reach = Math.min(reach, (HIGH[axis] - target[axis]) / d)
    else if (d < 0) reach = Math.min(reach, (LOW[axis] - target[axis]) / d)
  }
  if (reach >= length) return moved
  position.copy(target).addScaledVector(offset, reach / length)
  return true
}

/** The sides the camera at `position` stands behind or within NEAR_MM of. */
export function cutSides(position: Vector3): Set<Side> {
  const cut = new Set<Side>()
  if (position.z < ROOM.north + NEAR_MM) cut.add('north')
  if (position.z > ROOM.south - NEAR_MM) cut.add('south')
  if (position.x < ROOM.west + NEAR_MM) cut.add('west')
  if (position.x > ROOM.east - NEAR_MM) cut.add('east')
  if (position.y > ROOM.ceiling - NEAR_MM) cut.add('ceiling')
  return cut
}
