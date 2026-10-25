// The closest-point kernels against brute-force sampling.
import { describe, expect, it } from 'vitest'
import { rng } from './math'
import { closestPointTriangle, closestSegSeg, pointBox, segmentBox } from './shapes'

const out = new Float64Array(8)
const rand = rng(7)
const between = (lo: number, hi: number) => lo + (hi - lo) * rand()

describe('closestSegSeg', () => {
  it('matches a dense sampling of both segments', () => {
    for (let trial = 0; trial < 200; trial++) {
      const p = Array.from({ length: 12 }, () => between(-10, 10))
      const d2 = closestSegSeg(
        p[0]!,
        p[1]!,
        p[2]!,
        p[3]!,
        p[4]!,
        p[5]!,
        p[6]!,
        p[7]!,
        p[8]!,
        p[9]!,
        p[10]!,
        p[11]!,
        out
      )
      let best = Infinity
      const N = 120
      for (let i = 0; i <= N; i++) {
        const s = i / N
        const ax = p[0]! + (p[3]! - p[0]!) * s
        const ay = p[1]! + (p[4]! - p[1]!) * s
        const az = p[2]! + (p[5]! - p[2]!) * s
        for (let j = 0; j <= N; j++) {
          const t = j / N
          const bx = p[6]! + (p[9]! - p[6]!) * t
          const by = p[7]! + (p[10]! - p[7]!) * t
          const bz = p[8]! + (p[11]! - p[8]!) * t
          best = Math.min(best, (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2)
        }
      }
      expect(d2).toBeLessThanOrEqual(best + 1e-9)
      expect(d2).toBeGreaterThan(best - 0.5)
    }
  })

  it('handles parallel and degenerate segments', () => {
    expect(closestSegSeg(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, out)).toBeCloseTo(1, 12)
    expect(closestSegSeg(0, 0, 0, 0, 0, 0, 3, 4, 0, 3, 4, 0, out)).toBeCloseTo(25, 12)
  })
})

describe('closestPointTriangle', () => {
  it('returns weights that sum to one and a point no farther than a dense sampling', () => {
    for (let trial = 0; trial < 200; trial++) {
      const v = Array.from({ length: 12 }, () => between(-5, 5))
      const d2 = closestPointTriangle(
        v[0]!,
        v[1]!,
        v[2]!,
        v[3]!,
        v[4]!,
        v[5]!,
        v[6]!,
        v[7]!,
        v[8]!,
        v[9]!,
        v[10]!,
        v[11]!,
        out
      )
      expect(out[0]! + out[1]! + out[2]!).toBeCloseTo(1, 9)
      expect(Math.min(out[0]!, out[1]!, out[2]!)).toBeGreaterThanOrEqual(-1e-12)
      let best = Infinity
      const N = 60
      for (let i = 0; i <= N; i++) {
        for (let j = 0; j <= N - i; j++) {
          const b = i / N,
            c = j / N,
            a = 1 - b - c
          const qx = a * v[3]! + b * v[6]! + c * v[9]!
          const qy = a * v[4]! + b * v[7]! + c * v[10]!
          const qz = a * v[5]! + b * v[8]! + c * v[11]!
          best = Math.min(best, (v[0]! - qx) ** 2 + (v[1]! - qy) ** 2 + (v[2]! - qz) ** 2)
        }
      }
      expect(d2).toBeLessThanOrEqual(best + 1e-9)
      expect(d2).toBeGreaterThan(best - 0.5)
    }
  })
})

describe('pointBox', () => {
  it('gives the distance outside and the depth to the nearest face inside', () => {
    pointBox(5, 0, 0, 2, 3, 4, out)
    expect(out[3]).toBeCloseTo(3, 12)
    expect([out[0], out[1], out[2]]).toEqual([1, 0, 0])
    pointBox(3, 5, 0, 2, 3, 4, out)
    expect(out[3]).toBeCloseTo(Math.hypot(1, 2), 12)
    pointBox(0.5, 0.5, 3.5, 2, 3, 4, out)
    expect(out[3]).toBeCloseTo(-0.5, 12)
    expect([out[0], out[1], out[2]]).toEqual([0, 0, 1])
  })
})

describe('segmentBox', () => {
  const H = [4, 3, 2] as const
  const sd = (x: number, y: number, z: number) => {
    pointBox(x, y, z, H[0], H[1], H[2], out)
    return out[3]!
  }

  it('finds the minimum signed distance along random segments, outside the box', () => {
    for (let trial = 0; trial < 400; trial++) {
      const p = Array.from({ length: 6 }, (_, i) => between(-9, 9) * (i % 3 === 2 ? 0.6 : 1))
      segmentBox(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!, p[5]!, H[0], H[1], H[2], out)
      const got = out[4]!
      let best = Infinity
      const N = 4000
      for (let i = 0; i <= N; i++) {
        const t = i / N
        best = Math.min(
          best,
          sd(p[0]! + (p[3]! - p[0]!) * t, p[1]! + (p[4]! - p[1]!) * t, p[2]! + (p[5]! - p[2]!) * t)
        )
      }
      if (best > 0) {
        expect(got).toBeGreaterThan(0)
        expect(got).toBeLessThanOrEqual(best + 1e-9)
        expect(got).toBeGreaterThan(best - 1e-3)
      } else {
        // The segment goes through the box: negative, a depth no more than the box's half size.
        expect(got).toBeLessThanOrEqual(0)
      }
    }
  })

  it('treats a segment lying flat on a face as touching along its midpoint', () => {
    segmentBox(-1, 0, 2.5, 1, 0, 2.5, H[0], H[1], H[2], out)
    expect(out[4]).toBeCloseTo(0.5, 12)
    expect([out[1], out[2], out[3]]).toEqual([0, 0, 1])
  })

  it('catches a segment that straddles a thin ridge between two endpoints outside it', () => {
    // Both ends are 3 mm either side of the box top face's centre line, at table height; the
    // segment between them passes through the box.
    segmentBox(-6, 0, 0, 6, 0, 0, H[0], H[1], H[2], out)
    expect(out[4]).toBeLessThan(0)
  })
})
