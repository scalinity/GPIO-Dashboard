// The Lab workroom (ADR-0144): a handful of meshes and triangles, no shadows, nothing on the set
// bright enough to bloom, and something on every side.
import {
  Box3,
  type BufferGeometry,
  Color,
  type Mesh,
  MeshStandardNodeMaterial,
  Vector3
} from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { BLOOM_THRESHOLD } from '../renderer'
import { ROOM, SIDES } from './bounds'
import { EMIT_MAX, GLOW_MAX } from './materials'
import { FINISH } from './pieces'
import { buildRoom } from './room'

const room = buildRoom()
const meshes: Mesh[] = []
room.group.traverse((o) => {
  if ((o as Mesh).isMesh) meshes.push(o as Mesh)
})
const triangles = (g: BufferGeometry) =>
  (g.index ? g.index.count : g.attributes.position!.count) / 3

describe('the workroom', () => {
  it('is at most 18 meshes and 60k triangles, casting and taking no shadow', () => {
    expect(meshes.length).toBeLessThanOrEqual(18)
    const total = meshes.reduce((n, m) => n + triangles(m.geometry), 0)
    expect(total).toBeLessThanOrEqual(60_000)
    expect(meshes.filter((m) => m.castShadow || m.receiveShadow)).toEqual([])
    // Three materials in all, shared by every side.
    expect(new Set(meshes.map((m) => m.material)).size).toBe(3)
  })

  it('draws nothing past the bloom threshold: emitters, glow over them, and lit finishes', () => {
    expect(room.peaks.emit).toBeLessThanOrEqual(EMIT_MAX)
    expect(room.peaks.glow).toBeLessThanOrEqual(GLOW_MAX)
    expect(EMIT_MAX + 3 * GLOW_MAX).toBeLessThan(BLOOM_THRESHOLD)
    // Every vertex colour is what was asked: emitters and cards under their caps.
    for (const m of meshes) {
      const colour = m.geometry.getAttribute('color')
      let peak = 0
      for (let i = 0; i < colour.count * 3; i++) peak = Math.max(peak, colour.array[i]!)
      const lit = m.material instanceof MeshStandardNodeMaterial
      expect(peak, m.name).toBeLessThanOrEqual(
        lit ? 1 : m.name.endsWith('glow') ? GLOW_MAX : EMIT_MAX
      )
    }
    // Metal stays rough enough that the key's highlight on it is under the threshold.
    for (const f of Object.values(FINISH) as { roughness?: number; metalness?: number }[])
      if ((f.metalness ?? 0) > 0) expect(f.roughness).toBeGreaterThanOrEqual(0.5)
    expect(new Color(FINISH.plaster.color).r).toBeLessThan(0.1)
  })

  it('is furnished on every side, and finished on every face', () => {
    for (const side of [...SIDES, 'floor'] as const)
      expect(room.furnished[side].length, side).toBeGreaterThan(0)
    expect(room.furnished.north).toContain('GPIO pinout poster')
    // The walls, floor and ceiling close the room: every face has a surface on it.
    const box = new Box3().setFromObject(room.group)
    expect(box.min.x).toBeLessThanOrEqual(ROOM.west)
    expect(box.max.x).toBeGreaterThanOrEqual(ROOM.east)
    expect(box.min.z).toBeLessThanOrEqual(ROOM.north)
    expect(box.max.z).toBeGreaterThanOrEqual(ROOM.south)
    expect(box.min.y).toBeLessThanOrEqual(ROOM.floor)
    expect(box.max.y).toBeGreaterThanOrEqual(ROOM.ceiling)
  })

  it('cuts away the side the camera stands near or behind, and nothing else', () => {
    expect([...room.cutaway(new Vector3(400, 400, 400))]).toEqual([])
    expect(SIDES.every((s) => room.sides[s].visible)).toBe(true)
    expect([...room.cutaway(new Vector3(-2000, 300, 0))]).toEqual(['west'])
    expect(room.sides.west.visible).toBe(false)
    expect([...room.cutaway(new Vector3(0, 300, 3000))]).toEqual(['south'])
    expect([...room.cutaway(new Vector3(0, 1700, 0))]).toEqual(['ceiling'])
    expect(room.sides.west.visible).toBe(true)
  })
})
