// The physics worker's shared buffer: a reader gets whole steps only, body by body, even while the
// worker is part-way through writing the next one.
import { describe, expect, it } from 'vitest'
import { type BodyOut, bufferBytes, CableBuffer, MAX_BODIES } from './physicsTransport'

const body = (handle: number, particles: number, value: number, taut = false): BodyOut => ({
  handle,
  rows: particles,
  columns: 1,
  wireStart: 1,
  wireEnd: particles - 1,
  asleep: !taut,
  taut,
  positions: new Float32Array(3 * particles).fill(value)
})

describe('CableBuffer', () => {
  it('is sized from the particle pool, two halves of three floats per particle', () => {
    expect(bufferBytes(1000) - bufferBytes(0)).toBe(2 * 3 * 4 * 1000)
  })

  it('reads back the last published step: every body, its flags and its particles', () => {
    const worker = CableBuffer.create(64)
    const reader = new CableBuffer(worker.buffer, 64)
    expect(reader.read()).toBeNull()
    worker.publish([body(7, 4, 1), body(9, 3, 2, true)], true)
    worker.publish([body(7, 4, 3), body(9, 3, 4, true)], false)
    const step = reader.read()!
    expect(step.seq).toBe(2)
    expect(reader.awake).toBe(false)
    const [a, b] = [step.bodies.get(7)!, step.bodies.get(9)!]
    expect(a).toEqual({
      handle: 7,
      offset: 0,
      particles: 4,
      rows: 4,
      columns: 1,
      wireStart: 1,
      wireEnd: 3,
      asleep: true,
      taut: false
    })
    expect([b.offset, b.particles, b.asleep, b.taut]).toEqual([4, 3, false, true])
    expect([...step.positions.subarray(0, 12)].every((v) => v === 3)).toBe(true)
    expect([...step.positions.subarray(12, 21)].every((v) => v === 4)).toBe(true)
  })

  it('never shows a step the worker is still writing', () => {
    const worker = CableBuffer.create(64)
    const reader = new CableBuffer(worker.buffer, 64)
    worker.publish([body(1, 4, 1), body(2, 4, 1)], true)
    // The renderer reads while the worker is between the bodies of the next step.
    let during: number[] = []
    const next = [body(1, 4, 2)]
    Object.defineProperty(next, 1, {
      get: () => {
        const step = reader.read()!
        during = [...step.positions.subarray(0, 24)]
        return body(2, 4, 2)
      }
    })
    next.length = 2
    worker.publish(next, true)
    expect(during.every((v) => v === 1)).toBe(true)
    expect([...reader.read()!.positions.subarray(0, 24)].every((v) => v === 2)).toBe(true)
  })

  it('keeps what fits: at most MAX_BODIES bodies and the pool', () => {
    const worker = CableBuffer.create(8)
    worker.publish([body(1, 6, 1), body(2, 6, 1)], true)
    expect([...new CableBuffer(worker.buffer, 8).read()!.bodies.keys()]).toEqual([1])
    expect(MAX_BODIES).toBeGreaterThanOrEqual(64)
  })

  it('carries the acknowledged scene and the step times', () => {
    const worker = CableBuffer.create(8)
    const reader = new CableBuffer(worker.buffer, 8)
    worker.acknowledge(12)
    worker.timed(1500, 2250, 4100)
    expect(reader.acknowledged).toBe(12)
    expect(reader.stepMs).toEqual({ last: 1.5, mean: 2.25, max: 4.1 })
  })
})
