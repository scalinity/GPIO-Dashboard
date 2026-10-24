// Sleep (SPEC 10.5, 19, acceptance 13): every scene stops simulating, and so stops rendering,
// within 2 s of its last anchor change, and nothing visibly jumps when it does. A pile that never
// sleeps costs a frame of physics and a frame of drawing for ever.
import { describe, expect, it } from 'vitest'
import {
  BOARD,
  BOARD_TOP,
  FLIP,
  TABLE,
  at,
  boxShape,
  crossingPair,
  densePile,
  newWorld,
  run
} from './testkit'
import type { BodyId, Pose, Vec3 } from './types'
import type { CableWorld } from './world'
import { FRAME_DT } from './world'

const TWO_SECONDS = Math.round(2 / FRAME_DT)

/** Steps until everything sleeps (or `max` frames) and returns the frames it took. */
function framesToSleep(world: CableWorld, max = 600): number {
  let frames = 0
  while (!world.allAsleep() && frames < max) {
    world.step()
    frames++
  }
  return frames
}

/** Every particle of the bodies, as the renderer would read it. */
function snapshot(world: CableWorld, ids: BodyId[]): Float32Array {
  const parts = ids.map((id) => Float32Array.from(world.positions(id)))
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** The farthest any particle is between two snapshots, mm. */
function farthest(a: Float32Array, b: Float32Array): number {
  let worst = 0
  for (let i = 0; i < a.length; i += 3) {
    worst = Math.max(worst, Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!))
  }
  return worst
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
]

/** An anchor and the two places the scene's last input carries it between. */
interface Nudge {
  id: BodyId
  end: 0 | 1
  from: Pose
  to: Pose
}

interface Scene {
  name: string
  world: CableWorld
  bodies: BodyId[]
  nudges: Nudge[]
}

function scenes(): Scene[] {
  const out: Scene[] = []
  {
    const world = newWorld(TABLE, BOARD)
    const a = at(-30, 0, BOARD_TOP)
    const id = world.addLead({ a, b: at(30, 0, BOARD_TOP), wireMm: 100 })
    out.push({
      name: 'one lead',
      world,
      bodies: [id],
      nudges: [{ id, end: 0, from: a, to: at(-26, 3, BOARD_TOP) }]
    })
  }
  {
    const world = newWorld(TABLE, BOARD)
    const { a, b } = crossingPair(world)
    out.push({
      name: 'two crossing leads',
      world,
      bodies: [a, b],
      nudges: [{ id: b, end: 0, from: at(0, -18, BOARD_TOP), to: at(2, -18, BOARD_TOP) }]
    })
  }
  {
    const world = newWorld(TABLE, BOARD)
    const ids = [-12, -6, 0, 6, 12].map((y) =>
      world.addLead({ a: at(-25, y, BOARD_TOP), b: at(25, -y, BOARD_TOP), wireMm: 80 })
    )
    out.push({
      name: 'a pile of five',
      world,
      bodies: ids,
      nudges: [{ id: ids[2]!, end: 1, from: at(25, 0, BOARD_TOP), to: at(26, 2, BOARD_TOP) }]
    })
  }
  {
    const world = newWorld(TABLE, BOARD)
    world.addCollider(
      boxShape({ c: [0, 0, BOARD_TOP + 7], h: [3, 26, 7] }),
      at(0, 0, BOARD_TOP + 7)
    )
    const id = world.addLead({ a: at(-30, 0, BOARD_TOP), b: at(30, 0, BOARD_TOP), wireMm: 72 })
    out.push({
      name: 'a lead over a part',
      world,
      bodies: [id],
      nudges: [{ id, end: 1, from: at(30, 0, BOARD_TOP), to: at(29, 1, BOARD_TOP) }]
    })
  }
  {
    const world = newWorld(TABLE)
    const ribbon = world.addRibbon({ a: at(0, -95, 14), b: at(0, 95, 14, FLIP) })
    world.step()
    const lead = world.addLead({ a: at(-45, 0, 0), b: at(45, 0, 0), wireMm: 110 })
    out.push({
      name: 'a lead lying on the ribbon',
      world,
      bodies: [ribbon, lead],
      nudges: [{ id: lead, end: 0, from: at(-45, 0, 0), to: at(-42, 2, 0) }]
    })
  }
  {
    const world = newWorld(TABLE, BOARD)
    const far = at(0, 150, 12, FLIP)
    const id = world.addRibbon({ a: at(0, -10, BOARD_TOP + 0.5), b: far })
    out.push({
      name: 'a ribbon over the breadboard edge',
      world,
      bodies: [id],
      nudges: [{ id, end: 1, from: far, to: at(4, 148, 12, FLIP) }]
    })
  }
  {
    const world = newWorld(TABLE, BOARD)
    const arch: Vec3[] = []
    for (let k = 0; k <= 8; k++) arch.push([-20, 0, BOARD_TOP + (10 * k) / 8])
    for (let k = 1; k < 8; k++) arch.push([-20 + (40 * k) / 8, 0, BOARD_TOP + 10])
    for (let k = 0; k <= 8; k++) arch.push([20, 0, BOARD_TOP + 10 - (10 * k) / 8])
    const id = world.addJumper({ a: at(-20, 0, BOARD_TOP), b: at(20, 0, BOARD_TOP), shape: arch })
    out.push({
      name: 'a solid jumper',
      world,
      bodies: [id],
      nudges: [{ id, end: 1, from: at(20, 0, BOARD_TOP), to: at(21, 0, BOARD_TOP) }]
    })
  }
  {
    const world = newWorld(TABLE)
    const b = at(65, 0, 0)
    const id = world.addLead({ a: at(-65, 0, 0), b, wireMm: 100 })
    out.push({
      name: 'an over-span lead pulled taut',
      world,
      bodies: [id],
      nudges: [{ id, end: 1, from: b, to: at(70, 0, 0) }]
    })
  }
  return out
}

/** Carries each nudge's anchor from `from` to `to` over 20 frames: the scene's last input. */
function lastInput(world: CableWorld, nudges: Nudge[]) {
  for (let f = 1; f <= 20; f++) {
    for (const n of nudges) {
      const t = f / 20
      world.setAnchor(n.id, n.end, {
        position: lerp(n.from.position, n.to.position, t),
        rotation: n.to.rotation
      })
    }
    world.step()
  }
}

describe('every test scene sleeps within 2 s of its last anchor change', () => {
  for (const s of scenes()) {
    it(`${s.name}, and nothing visibly moves as it does`, () => {
      run(s.world, 400)
      expect(s.world.allAsleep()).toBe(true)
      lastInput(s.world, s.nudges)
      expect(s.world.allAsleep()).toBe(false)
      // Step to sleep, keeping the last frame that was drawn before it.
      let before = snapshot(s.world, s.bodies)
      let frames = 0
      while (!s.world.allAsleep() && frames < 600) {
        before = snapshot(s.world, s.bodies)
        s.world.step()
        frames++
      }
      const jump = farthest(before, snapshot(s.world, s.bodies))
      console.info(
        `${s.name}: asleep ${frames} frames (${(frames * FRAME_DT).toFixed(2)} s) after the last input; last frame moved ${jump.toFixed(4)} mm`
      )
      expect(frames).toBeLessThanOrEqual(TWO_SECONDS)
      // The frame that sleeps is the one the renderer last drew: the step before it moved nothing a
      // pixel would show (0.1 mm is under a pixel at the Studio's closest zoom).
      expect(jump).toBeLessThan(0.1)
      // And it stays put.
      const rest = snapshot(s.world, s.bodies)
      run(s.world, 60)
      expect(farthest(rest, snapshot(s.world, s.bodies))).toBe(0)
    })
  }
})

describe('the dense pile', () => {
  // 40 leads of 165 mm of wire on one breadboard, each between two distinct holes, and the ribbon.
  for (const seed of [1, 2, 3, 4]) {
    it(`layout ${seed} settles asleep within 2 s, and again within 2 s of every drag`, () => {
      const { world, leads, ends, ribbon, socket, bodies } = densePile(seed)
      const first = framesToSleep(world)
      console.info(
        `dense pile ${seed}: asleep ${first} frames (${(first * FRAME_DT).toFixed(2)} s) from its design curves`
      )
      expect(world.allAsleep()).toBe(true)
      expect(first).toBeLessThanOrEqual(TWO_SECONDS)
      // Drag the far end of every other lead 5 mm along the board, and the ribbon's socket 10 mm,
      // over 30 frames: half the pile and the ribbon move, and the whole island wakes.
      for (let f = 1; f <= 30; f++) {
        const t = f / 30
        leads.forEach((id, k) => {
          if (k % 2 === 0) return
          const to = ends[k]![1]
          world.setAnchor(id, 1, at(to.position[0], to.position[1] + 5 * t, to.position[2]))
        })
        world.setAnchor(
          ribbon,
          1,
          at(socket.position[0] + 10 * t, socket.position[1], socket.position[2], FLIP)
        )
        world.step()
      }
      expect(world.allAsleep()).toBe(false)
      let before = snapshot(world, bodies)
      let frames = 0
      while (!world.allAsleep() && frames < 600) {
        before = snapshot(world, bodies)
        world.step()
        frames++
      }
      const jump = farthest(before, snapshot(world, bodies))
      console.info(
        `dense pile ${seed}: asleep ${frames} frames (${(frames * FRAME_DT).toFixed(2)} s) after the last drag; last frame moved ${jump.toFixed(4)} mm`
      )
      expect(frames).toBeLessThanOrEqual(TWO_SECONDS)
      expect(jump).toBeLessThan(0.1)
    })
  }
})

describe('islands that are close but not touching', () => {
  it('do not wake one another in turn: two diagonal leads 2.2 mm apart both sleep, and stay asleep', () => {
    // Two runs along the board's diagonal, 2.2 mm apart side to side: the wires are 1.2 mm clear of
    // each other and never touch, but along the diagonal their padded boxes overlap. An awake body
    // wakes a sleeper only while it is itself moving, so the pair can be asleep together and a
    // micron's nudge to one wakes the other for a moment, not for ever.
    const world = newWorld(TABLE, BOARD)
    const a = world.addLead({ a: at(-25, -25, BOARD_TOP), b: at(25, 25, BOARD_TOP), wireMm: 80 })
    const b = world.addLead({
      a: at(-25 + 1.55, -25 - 1.55, BOARD_TOP),
      b: at(25 + 1.55, 25 - 1.55, BOARD_TOP),
      wireMm: 80
    })
    framesToSleep(world, 300)
    expect(world.allAsleep()).toBe(true)
    expect(world.islandOf(a)).not.toBe(world.islandOf(b))
    // Asleep for good: no frame in the next five seconds wakes either.
    for (let f = 0; f < 300; f++) {
      world.step()
      expect(world.allAsleep()).toBe(true)
    }
    // A micron's nudge to one wakes it; both are asleep again within 2 s.
    world.setAnchor(a, 0, at(-25 + 0.001, -25, BOARD_TOP))
    expect(world.isAsleep(a)).toBe(false)
    expect(framesToSleep(world, 300)).toBeLessThanOrEqual(TWO_SECONDS)
  })
})
