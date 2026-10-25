// What physics.worker runs (SPEC 4.3, 10.5): one CableWorld, fed the Studio's cable scenes and
// published into the shared buffer. A pure class, so tests drive it without a Worker. It sees
// colliders, anchors and route hints only, never the document.
import { type BodyId, type BodyInfo, CableWorld, type ColliderId, FRAME_DT } from '../physics'
import type { BodySpec, BodyOut, CableBuffer, CableScene } from './physicsTransport'

/** Opening settles offscreen until everything sleeps, for at most this long (SPEC 10.5). */
export const SETTLE_MS = 1000
/**
 * SPEC 10.5's sleep test, applied to the whole world: when no particle has moved faster than
 * 0.5 mm/s for 30 frames, stepping stops, even where two islands near each other keep waking one
 * another without moving.
 */
const STILL_MM = 0.5 * FRAME_DT
const STILL_FRAMES = 30

interface Held {
  id: BodyId
  info: BodyInfo
  spec: BodySpec
}

export class PhysicsHost {
  private world: CableWorld
  private colliders = new Map<string, { id: ColliderId; shape: string }>()
  private bodies = new Map<number, Held>()
  /** The current run of awake steps, for the step-time figures. */
  private run = { steps: 0, totalUs: 0, maxUs: 0 }
  /** Each body's particles as the last frame left them, and how many frames nothing has moved. */
  private last = new Map<number, Float32Array>()
  private still = 0

  constructor(
    private readonly out: CableBuffer,
    private readonly now: () => number = () => performance.now()
  ) {
    this.world = this.fresh()
  }

  get awake(): boolean {
    return !this.world.allAsleep() && this.still < STILL_FRAMES
  }

  /**
   * Brings the world to the scene and publishes the result. `settle` starts a fresh world and
   * settles it offscreen first; a lead added from a given start (a route) settles offscreen too, as
   * it would on opening, so it rests the same way either time.
   */
  apply(id: number, scene: CableScene, settle: boolean): void {
    if (settle) {
      this.world = this.fresh()
      this.colliders.clear()
      this.bodies.clear()
    }
    this.still = 0
    this.applyColliders(scene)
    if (this.applyBodies(scene) || settle) {
      const start = this.now()
      while (this.awake && this.now() - start < SETTLE_MS) this.settleFrame()
    }
    this.publish()
    this.out.acknowledge(id)
  }

  /** One 1/60 s frame; returns whether anything is still awake. */
  step(): boolean {
    const t0 = this.now()
    this.world.step()
    const us = (this.now() - t0) * 1000
    this.track()
    const run = this.run
    run.steps += 1
    run.totalUs += us
    run.maxUs = Math.max(run.maxUs, us)
    this.out.timed(us, run.totalUs / run.steps, run.maxUs)
    this.publish()
    const awake = this.awake
    if (!awake) this.run = { steps: 0, totalUs: 0, maxUs: 0 }
    return awake
  }

  /** One frame of settling, with the solver's extra damping. */
  private settleFrame(): void {
    this.world.settle(1)
    this.track()
  }

  /** Counts the frames in which no particle has moved faster than STILL_MM a frame. */
  private track(): void {
    let most = 0
    for (const [handle, { id }] of this.bodies) {
      const p = this.world.positions(id)
      const q = this.last.get(handle)
      if (q?.length !== p.length) {
        this.last.set(handle, Float32Array.from(p))
        most = Infinity
        continue
      }
      for (let i = 0; i < p.length; i += 3)
        most = Math.max(
          most,
          Math.hypot(p[i]! - q[i]!, p[i + 1]! - q[i + 1]!, p[i + 2]! - q[i + 2]!)
        )
      q.set(p)
    }
    for (const handle of this.last.keys()) if (!this.bodies.has(handle)) this.last.delete(handle)
    this.still = most < STILL_MM ? this.still + 1 : 0
  }

  private fresh(): CableWorld {
    return new CableWorld({ maxParticles: this.out.maxParticles })
  }

  private applyColliders(scene: CableScene): void {
    const seen = new Set<string>()
    for (const c of scene.colliders) {
      seen.add(c.key)
      const shape = JSON.stringify(c.shape)
      const held = this.colliders.get(c.key)
      if (held?.shape === shape) {
        this.world.setColliderPose(held.id, c.pose)
        continue
      }
      if (held) this.world.removeCollider(held.id)
      this.colliders.set(c.key, { id: this.world.addCollider(c.shape, c.pose), shape })
    }
    for (const [key, held] of this.colliders) {
      if (seen.has(key)) continue
      this.world.removeCollider(held.id)
      this.colliders.delete(key)
    }
  }

  /** Adds, moves and removes bodies; returns whether a lead was added from a given start. */
  private applyBodies(scene: CableScene): boolean {
    const seen = new Set<number>()
    let routed = false
    for (const spec of scene.bodies) {
      seen.add(spec.handle)
      const held = this.bodies.get(spec.handle)
      if (!held) {
        this.add(spec)
        routed ||= spec.kind === 'lead' && !!spec.guess
        continue
      }
      this.world.setAnchor(held.id, 0, spec.a)
      this.world.setAnchor(held.id, 1, spec.b)
      if (
        spec.kind === 'lead' &&
        held.spec.kind === 'lead' &&
        JSON.stringify(spec.hints) !== JSON.stringify(held.spec.hints)
      )
        this.world.setRouteHints(held.id, spec.hints)
      held.spec = spec
    }
    for (const [handle, held] of this.bodies) {
      if (seen.has(handle)) continue
      this.world.removeBody(held.id)
      this.bodies.delete(handle)
    }
    return routed
  }

  private add(spec: BodySpec): void {
    const w = this.world
    let id: BodyId
    try {
      if (spec.kind === 'lead') {
        id = w.addLead({ a: spec.a, b: spec.b, wireMm: spec.wireMm, guess: spec.guess })
        if (spec.hints.length) w.setRouteHints(id, spec.hints)
      } else if (spec.kind === 'ribbon')
        id = w.addRibbon({ a: spec.a, b: spec.b, lengthMm: spec.lengthMm, columns: spec.columns })
      else id = w.addJumper({ a: spec.a, b: spec.b, shape: spec.shape })
    } catch (e) {
      // A full particle pool leaves this cable out; the rest still run.
      console.warn(`[physics] cable ${spec.handle} left out: ${String(e)}`)
      return
    }
    this.bodies.set(spec.handle, { id, info: w.info(id), spec })
  }

  private publish(): void {
    const w = this.world
    const out: BodyOut[] = []
    for (const [handle, { id, info }] of this.bodies) {
      out.push({
        handle,
        rows: info.rows,
        columns: info.columns,
        wireStart: info.wireStart,
        wireEnd: info.wireEnd,
        // Stepping has stopped once everything is still, whatever the islands say.
        asleep: w.isAsleep(id) || !this.awake,
        taut: w.isTaut(id),
        positions: w.positions(id)
      })
    }
    this.out.publish(out, this.awake)
  }
}
