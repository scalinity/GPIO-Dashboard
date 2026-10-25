// Part leads: each runs from its exit into its hole, bent the same way every time, at the
// diameter its definition's params give.
import { Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { partDef } from '../core/defs/parts'
import { bentLeadGeometry, LEAD_DEPTH_MM, leadDiameterMm, leadPath, RADIAL } from './leads'

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
const down = v(0, -1, 0)
const hole = v(10, 8.5, 0)

describe('leadPath', () => {
  it('goes straight down a hole under its exit', () => {
    expect(leadPath(v(10, 9.5, 0), down, hole)).toEqual([
      v(10, 9.5, 0),
      v(10, 8.5 - LEAD_DEPTH_MM, 0)
    ])
  })

  it('jogs at a knee halfway down to a hole beside its exit', () => {
    expect(leadPath(v(7.46, 9.5, 0), down, hole)).toEqual([
      v(7.46, 9.5, 0),
      v(7.46, 9, 0),
      v(10, 9, 0),
      v(10, 6.5, 0)
    ])
  })

  it('runs along an axial body, then down', () => {
    expect(leadPath(v(3.15, 9.7, 0), v(1, 0, 0), hole)).toEqual([
      v(3.15, 9.7, 0),
      v(10, 9.7, 0),
      v(10, 6.5, 0)
    ])
  })

  it('goes over the top from an end standing up', () => {
    const path = leadPath(v(7.46, 16, 0), v(0, 1, 0), hole)
    expect(path[1]!.y).toBeGreaterThan(16)
    expect(path.at(-1)).toEqual(v(10, 6.5, 0))
  })
})

describe('bentLeadGeometry', () => {
  it("ends its last ring on the path's end", () => {
    const tube = bentLeadGeometry(leadPath(v(7.46, 9.5, 0), down, hole), 0.25, 0.5)
    const position = tube.getAttribute('position')
    const end = new Vector3()
    for (let k = 0; k < RADIAL; k++)
      end.add(new Vector3().fromBufferAttribute(position, position.count - RADIAL - 1 + k))
    end.divideScalar(RADIAL)
    expect(end.distanceTo(v(10, 6.5, 0))).toBeLessThan(1e-6)
  })
})

describe('leadDiameterMm', () => {
  it.each([
    ['resistor', {}, 0.55],
    ['led', { size: '3mm', color: 'red' }, 0.5],
    ['ic-74hc595', {}, 0.53],
    ['tact-switch-6mm', {}, 0.7],
    ['potentiometer-10k', {}, 1.0]
  ])('%s', (id, props, mm) => {
    expect(leadDiameterMm(partDef(id), props)).toBe(mm)
  })
})
