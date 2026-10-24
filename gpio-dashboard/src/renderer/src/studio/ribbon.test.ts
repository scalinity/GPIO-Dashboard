// The ribbon's strip: u across the cable from conductor 1, v a unit per pitch along it.
import { Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { ribbonGeometry } from './ribbon'

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)

describe('ribbonGeometry', () => {
  it('maps u across from conductor 1, and v a unit per pitch along', () => {
    const g = ribbonGeometry([
      [v(0, 0, 0), v(50.8, 0, 0)],
      [v(0, 0, 2.54), v(50.8, 0, 2.54)]
    ])
    expect([...g.getAttribute('uv').array]).toEqual([0, 0, 1, 0, 0, 1, 1, 1])
    expect(g.getIndex()!.count).toBe(6)
  })

  it('refits the same geometry in place while the grid keeps its size', () => {
    const rows = [
      [v(0, 0, 0), v(50.8, 0, 0)],
      [v(0, 0, 2.54), v(50.8, 0, 2.54)]
    ]
    const g = ribbonGeometry(rows)
    const position = g.getAttribute('position')
    ribbonGeometry(
      rows.map((row) => row.map((p) => p.clone().setY(3))),
      g
    )
    expect(g.getAttribute('position')).toBe(position)
    expect(position.getY(3)).toBe(3)
  })
})
