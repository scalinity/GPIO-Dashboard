// The Lab workroom's bounds (ADR-0144): every camera preset of every tutorial stands inside the
// room, and the clamp keeps any camera in, shortening its distance along its line to the target.
import { PerspectiveCamera, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { TUTORIALS } from '../../core/defs/tutorials'
import { PRESETS, presetView } from '../camera'
import { LAB } from '../look'
import { clampToRoom, cutSides, MARGIN_MM, NEAR_MM, ROOM } from './bounds'

const inside = (p: Vector3) =>
  p.x >= ROOM.west + MARGIN_MM &&
  p.x <= ROOM.east - MARGIN_MM &&
  p.y >= ROOM.floor + MARGIN_MM &&
  p.y <= ROOM.ceiling - MARGIN_MM &&
  p.z >= ROOM.north + MARGIN_MM &&
  p.z <= ROOM.south

describe('the workroom bounds', () => {
  it('every preset of every tutorial stands inside the room, at any canvas shape', () => {
    const outside: string[] = []
    // From a narrow canvas beside both panels to a wide one with both folded away.
    for (const aspect of [0.6, 1, 1.6, 2.4]) {
      const camera = new PerspectiveCamera(35, aspect, 5, 20000)
      for (const t of TUTORIALS)
        for (const preset of PRESETS) {
          const view = presetView(preset, t.doc, camera, new Vector3())
          // The orbit holds the camera within the Lab look's reach of its target.
          const offset = view.position.clone().sub(view.target)
          offset.setLength(Math.min(offset.length(), LAB.maxDistance))
          const at = view.target.clone().add(offset)
          if (!inside(at) || cutSides(at).size)
            outside.push(`${t.meta.id} ${preset} at ${aspect}: ${at.toArray().map(Math.round)}`)
        }
    }
    expect(outside).toEqual([])
  })

  it('shortens a camera outside the room along its line to the target', () => {
    const target = new Vector3(0, 0, 0)
    const position = new Vector3(-4000, 500, -4000)
    expect(clampToRoom(position, target)).toBe(true)
    expect(inside(position)).toBe(true)
    // Same direction, shorter.
    expect(
      position
        .clone()
        .normalize()
        .dot(new Vector3(-4000, 500, -4000).normalize())
    ).toBeCloseTo(1)
    // The north wall is nearer than the west along that line.
    expect(position.z).toBeCloseTo(ROOM.north + MARGIN_MM)
    // A camera inside is left where it is.
    const still = new Vector3(400, 400, 400)
    expect(clampToRoom(still, target)).toBe(false)
    expect(still.toArray()).toEqual([400, 400, 400])
  })

  it('keeps any orbit inside, the front open, and the target in the room', () => {
    const target = new Vector3(0, 0, 0)
    for (let az = 0; az < 360; az += 15)
      for (const polar of [5, 45, 85]) {
        const a = (az * Math.PI) / 180
        const p = (polar * Math.PI) / 180
        const r = LAB.maxDistance
        const position = new Vector3(
          r * Math.sin(p) * Math.sin(a),
          r * Math.cos(p),
          r * Math.sin(p) * Math.cos(a)
        )
        clampToRoom(position, target)
        expect(inside(position), `${az} ${polar}`).toBe(true)
      }
    // The front is open: a camera may stand south of the room, where the south side is cut away.
    const far = new Vector3(0, 300, 4000)
    expect(clampToRoom(far, target)).toBe(false)
    expect(cutSides(far)).toEqual(new Set(['south']))
    const panned = new Vector3(9000, 0, 0)
    clampToRoom(new Vector3(9000, 300, 400), panned)
    expect(panned.x).toBe(ROOM.east - MARGIN_MM)
    expect(NEAR_MM).toBeGreaterThan(600)
  })
})
