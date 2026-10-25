// The tube drawn along a cable's particles: smooth between them, square to the cable everywhere,
// and framed by parallel transport, so it never twists about the cable as the cable moves.
import { BufferAttribute, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { RADIAL, SUBDIVISIONS, Tube } from './tube'

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** A quarter circle of radius 30 in the plane y = 0, every 3 mm or so. */
const arc = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 15) * (Math.PI / 2)
  return v(30 * Math.cos(a), 0, 30 * Math.sin(a))
})

const ring = (tube: Tube, i: number) => {
  const p = tube.geometry.getAttribute('position') as BufferAttribute
  const n = tube.geometry.getAttribute('normal') as BufferAttribute
  return Array.from({ length: RADIAL + 1 }, (_, j) => ({
    p: new Vector3().fromBufferAttribute(p, i * (RADIAL + 1) + j),
    n: new Vector3().fromBufferAttribute(n, i * (RADIAL + 1) + j)
  }))
}

describe('Tube', () => {
  it('runs through every point, smoothed between them, at its radius', () => {
    const tube = new Tube(0.5)
    tube.fit(arc, v(0, 1, 0))
    expect(tube.line).toHaveLength((arc.length - 1) * SUBDIVISIONS + 1)
    arc.forEach((p, i) => expect(tube.line[i * SUBDIVISIONS]!.distanceTo(p)).toBeLessThan(1e-9))
    // Between the points the spline stays on the circle to well under the wire's radius.
    for (const p of tube.line) expect(Math.abs(Math.hypot(p.x, p.z) - 30)).toBeLessThan(0.05)
    expect(tube.length).toBeCloseTo((Math.PI / 2) * 30, 1)
    tube.line.forEach((c, i) => {
      for (const { p, n } of ring(tube, i)) {
        expect(p.distanceTo(c)).toBeCloseTo(0.5, 5)
        expect(n.length()).toBeCloseTo(1, 5)
      }
    })
  })

  it('stays square to the cable and does not twist about it on a bend', () => {
    const tube = new Tube(0.5)
    tube.fit(arc, v(0, 1, 0))
    for (let i = 1; i < tube.line.length - 1; i++) {
      const t = tube.line[i + 1]!.clone()
        .sub(tube.line[i - 1]!)
        .normalize()
      const r = ring(tube, i)
      for (const { n } of r) expect(Math.abs(n.dot(t))).toBeLessThan(0.02)
      // On a plane curve the transported frame keeps the seam (v = 0) on the plane's normal.
      expect(Math.abs(r[0]!.n.y)).toBeCloseTo(1, 3)
    }
  })

  it('starts facing its reference, and refits in place while the count holds', () => {
    const tube = new Tube(0.5)
    tube.fit(arc, v(0, 1, 0))
    const position = tube.geometry.getAttribute('position')
    // The arc starts along +z; a reference along x puts the seam on x, as TubeGeometry's does
    // with its first normal (its v = 0 vertex sits at minus the normal).
    tube.fit(
      arc.map((p) => p.clone().add(v(0, 5, 0))),
      v(1, 0, 0)
    )
    expect(tube.geometry.getAttribute('position')).toBe(position)
    expect(ring(tube, 0)[0]!.n.dot(v(1, 0, 0))).toBeCloseTo(-1, 2)
  })
})
