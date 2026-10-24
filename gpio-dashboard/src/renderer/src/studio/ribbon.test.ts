// The ribbon's design: from one socket's cable line to the other's, conductor 1 on the same edge,
// as long as the cable is, and a strip whose u runs across it.
import ribbonJson from '../content/controllers/ribbon.json'
import { Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { type CableEnd, ribbonDesign, ribbonGeometry } from './ribbon'

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
// The default bench's two exits, roughly: the Pi's toward the front, the T-board's toward the Pi.
const pi: CableEnd = { a: v(-112.9, 11.3, -48), b: v(-62.1, 11.3, -48), out: v(0, 0, 1) }
const tboard: CableEnd = { a: v(-12, 29.8, -53.6), b: v(-12, 29.8, -2.8), out: v(-1, 0, 0) }
const rows = ribbonDesign(pi, tboard, ribbonJson.lengthMm, () => 0.5)
const middle = (row: Vector3[]) => row[0]!.clone().lerp(row.at(-1)!, 0.5)

describe('ribbonDesign', () => {
  it("starts and ends on the sockets' cable lines, conductor 1 at each socket's `a`", () => {
    expect(rows[0]![0]!.distanceTo(pi.a)).toBeLessThan(1e-6)
    expect(rows[0]!.at(-1)!.distanceTo(pi.b)).toBeLessThan(1e-6)
    expect(rows.at(-1)![0]!.distanceTo(tboard.a)).toBeLessThan(1e-6)
    expect(rows.at(-1)!.at(-1)!.distanceTo(tboard.b)).toBeLessThan(1e-6)
  })

  it('is as long as the cable along its middle, and as wide', () => {
    let length = 0
    for (let i = 1; i < rows.length; i++)
      length += middle(rows[i]!).distanceTo(middle(rows[i - 1]!))
    expect(length).toBeCloseTo(ribbonJson.lengthMm, 1)
    for (const row of rows)
      expect(row[0]!.distanceTo(row.at(-1)!)).toBeCloseTo(ribbonJson.widthMm, 6)
  })

  it('stays above its floor', () => {
    for (const row of rows) expect(middle(row).y).toBeGreaterThanOrEqual(0.5 - 1e-9)
  })
})

describe('ribbonGeometry', () => {
  it('maps u across from conductor 1, and v a unit per pitch along', () => {
    const g = ribbonGeometry([
      [v(0, 0, 0), v(50.8, 0, 0)],
      [v(0, 0, 2.54), v(50.8, 0, 2.54)]
    ])
    expect([...g.getAttribute('uv').array]).toEqual([0, 0, 1, 0, 0, 1, 1, 1])
    expect(g.getIndex()!.count).toBe(6)
  })
})
