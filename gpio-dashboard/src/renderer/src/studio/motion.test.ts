// Motion channels (SPEC 10.6): an ease reaches its target and stops asking for frames, a spin starts
// from rest on its first frame and keeps asking, and a channel's first transform is applied at once.
import { Matrix4 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { Motion, type Target } from './motion'

const ease = (target: number): Target => ({
  node: 'plunger',
  kind: 'ease',
  target,
  tau: 0.02,
  matrix: (v) => new Matrix4().makeTranslation(0, -v, 0)
})
const spin = (target: number): Target => ({
  node: 'rotor',
  kind: 'spin',
  target,
  tau: 0.1,
  matrix: (v) => new Matrix4().makeRotationX(v)
})

describe('Motion', () => {
  it('applies a new channel’s transform on its first step, then goes quiet', () => {
    const m = new Motion()
    const applied: number[] = []
    expect(m.aim('SW1', ease(0))).toBe(true)
    expect(m.step(0, (_, __, matrix) => applied.push(matrix.elements[13]!))).toBe(false)
    expect(applied).toHaveLength(1)
    expect(applied[0]).toBeCloseTo(0)
    expect(m.step(0.016, () => applied.push(1))).toBe(false)
    expect(applied).toHaveLength(1)
  })

  it('eases to a new target and settles on it exactly', () => {
    const m = new Motion()
    m.aim('SW1', ease(0))
    m.step(0, () => {})
    expect(m.aim('SW1', ease(1))).toBe(true)
    let frames = 0
    while (m.step(0.016, () => {}) && frames++ < 200);
    expect(m.valueOf('SW1', 'plunger')).toBe(1)
    expect(frames).toBeLessThan(60)
    // The same target again asks for nothing.
    expect(m.aim('SW1', ease(1))).toBe(false)
  })

  it('starts a spin on its first frame even though no time has passed, and keeps going', () => {
    const m = new Motion()
    m.aim('M1', spin(0))
    m.step(0, () => {})
    m.aim('M1', spin(8))
    expect(m.step(0, () => {})).toBe(true)
    for (let i = 0; i < 100; i++) expect(m.step(0.016, () => {})).toBe(true)
    expect(m.valueOf('M1', 'rotor')).not.toBe(0)
    // Stopped, it winds down and then asks for no more frames.
    m.aim('M1', spin(0))
    let frames = 0
    while (m.step(0.016, () => {}) && frames++ < 1000);
    expect(frames).toBeLessThan(1000)
  })

  it('forgets a part’s channels', () => {
    const m = new Motion()
    m.aim('SW1', ease(0))
    m.drop('SW1')
    expect(m.parts()).toEqual([])
  })
})
