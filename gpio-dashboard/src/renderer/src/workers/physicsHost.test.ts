// What the physics worker does with the Studio's scenes: it builds and moves the world from
// colliders, anchors and route hints alone, settles on opening, steps until everything sleeps, and
// publishes each step whole. Units are mm; the frame is the core table frame (z up).
import { describe, expect, it } from 'vitest'
import type { Pose, Quat } from '../physics'
import { PhysicsHost } from './physicsHost'
import { type BodySpec, CableBuffer, type CableScene, type ColliderSpec } from './physicsTransport'

const UP: Quat = [0, 0, 0, 1]
const at = (x: number, y: number, z: number): Pose => ({ position: [x, y, z], rotation: UP })
const TABLE: ColliderSpec = {
  key: 'table',
  shape: { kind: 'box', halfExtents: [500, 500, 10] },
  pose: at(0, 0, -10)
}
const BOARD: ColliderSpec = {
  key: 'bb1/0',
  shape: { kind: 'box', halfExtents: [80, 27, 4.25] },
  pose: at(0, 0, 4.25)
}
const lead = (handle: number, b = at(30, 0, 8.5), hints: [number, number, number][] = []) =>
  ({ handle, kind: 'lead', a: at(-30, 0, 8.5), b, wireMm: 120, hints }) as BodySpec

function setup() {
  const out = CableBuffer.create(4096)
  const host = new PhysicsHost(out)
  const reader = new CableBuffer(out.buffer, 4096)
  let id = 0
  const apply = (bodies: BodySpec[], settle = false, colliders = [TABLE, BOARD]) => {
    const scene: CableScene = { colliders, bodies }
    host.apply(++id, scene, settle)
    return reader.read()!
  }
  const run = (limit = 600) => {
    let frames = 0
    while (frames < limit && host.step()) frames++
    return frames
  }
  return { host, reader, apply, run }
}

const points = (step: NonNullable<ReturnType<CableBuffer['read']>>, handle: number) => {
  const b = step.bodies.get(handle)!
  return Array.from({ length: b.particles }, (_, i) =>
    [0, 1, 2].map((k) => step.positions[3 * (b.offset + i) + k]!)
  )
}

describe('PhysicsHost', () => {
  it('settles a scene offscreen on opening and publishes it asleep, on the board', () => {
    const { host, reader, apply } = setup()
    const step = apply([lead(1)], true)
    expect(reader.acknowledged).toBe(1)
    expect(host.awake).toBe(false)
    expect(reader.awake).toBe(false)
    expect(step.bodies.get(1)!.asleep).toBe(true)
    // Nothing falls into the board or the table (the wire is 0.5 mm thick each way).
    for (const [x, y, z] of points(step, 1)) {
      const onBoard = Math.abs(x!) <= 80 && Math.abs(y!) <= 27
      expect(z).toBeGreaterThan(onBoard ? 8.5 : 0)
    }
  })

  it('moves an anchor, steps until everything is still again, and stops', () => {
    const { host, apply, run, reader } = setup()
    apply([lead(1)], true)
    apply([lead(1, at(10, 15, 8.5))])
    expect(host.awake).toBe(true)
    expect(run()).toBeLessThan(600)
    expect(host.awake).toBe(false)
    const step = reader.read()!
    // The clamped exit sits a housing length above the new frame.
    const b = step.bodies.get(1)!
    const exit = points(step, 1)[b.wireEnd - 1]!
    expect(Math.hypot(exit[0]! - 10, exit[1]! - 15, exit[2]! - 20.5)).toBeLessThan(1e-3)
    expect(step.bodies.get(1)!.asleep).toBe(true)
    expect(reader.stepMs!.max).toBeGreaterThan(0)
  })

  it('pulls a lead through its route hint; a lead started from a route is settled at once', () => {
    const { apply, run } = setup()
    const hint: [number, number, number] = [0, -20, 45]
    const near = (step: ReturnType<typeof apply>, handle: number) =>
      Math.min(...points(step, handle).map((p) => Math.hypot(...p.map((v, k) => v - hint[k]!))))
    expect(near(apply([lead(1)], true), 1)).toBeGreaterThan(10)
    apply([lead(1, undefined, [hint])])
    run()
    expect(near(apply([lead(1, undefined, [hint])]), 1)).toBeLessThan(2)
    // A second lead, alone and given its route as a start, comes back from apply() already still.
    const { apply: applyAlone, reader } = setup()
    const guess: [number, number, number][] = [
      [-30, 0, 20.5],
      [-20, -12, 42],
      [0, -20, 52],
      [20, -12, 42],
      [30, 0, 20.5]
    ]
    const routed = applyAlone([{ ...lead(2, undefined, [hint]), guess } as BodySpec])
    expect(reader.awake).toBe(false)
    expect(near(routed, 2)).toBeLessThan(2)
  })

  it('removes what the scene no longer holds, and flags an over-span lead taut', () => {
    const { apply, run, reader } = setup()
    apply([lead(1), lead(2, at(30, 10, 8.5))], true)
    expect(apply([lead(2, at(200, 10, 8.5))]).bodies.has(1)).toBe(false)
    run()
    expect(reader.read()!.bodies.get(2)!.taut).toBe(true)
  })

  it('moves a collider by its key: a board raised under a lead raises the lead', () => {
    const { apply, run, reader } = setup()
    const lowest = (step: ReturnType<typeof apply>) =>
      Math.min(...points(step, 1).map((p) => (Math.abs(p[1]!) <= 27 ? p[2]! : Infinity)))
    const before = lowest(apply([lead(1)], true))
    const raised = { ...lead(1, at(30, 0, 14.5)), a: at(-30, 0, 14.5) }
    apply([raised], false, [TABLE, { ...BOARD, pose: at(0, 0, 10.25) }])
    run()
    expect(lowest(reader.read()!) - before).toBeCloseTo(6, 0)
  })
})
