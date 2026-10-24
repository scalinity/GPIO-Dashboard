// The Studio's side of physics.worker (SPEC 4.3, 10.5): it turns what the layers placed into the
// solver's scene (collider proxies from every *.colliders.json at its model's pose, and each
// cable's anchors) in the solver's core frame, sends it whenever it changes, and reads the newest
// published step back once per drawn frame. The document never leaves the main thread.
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu'
import type { Pose, Vec3 } from '../physics'
import {
  type BodySpec,
  CableBuffer,
  type CableBody,
  type CableScene,
  type CableStep,
  type ColliderSpec,
  type PhysicsRequest
} from '../workers/physicsTransport'

/** The solver's particle pool, which sizes the shared buffer: room for about 130 leads. */
export const MAX_PARTICLES = 8192

// The scene is three's (y up); the solver runs in the core frame (z up): (x, y, z) -> (x, -z, y).
const TO_CORE = new Matrix4().makeRotationX(Math.PI / 2)
const TO_THREE = new Matrix4().makeRotationX(-Math.PI / 2)
const ONE = new Vector3(1, 1, 1)
const Z = new Vector3(0, 0, 1)

/** A scene point in the core frame. */
export const toCore = (v: Vector3): Vec3 => [v.x, -v.z, v.y]

/** Particle `i` of core-frame positions, as a scene point. */
export const fromCore = (p: ArrayLike<number>, i: number, target = new Vector3()): Vector3 =>
  target.set(p[3 * i]!, p[3 * i + 2]!, -p[3 * i + 1]!)

/** A frame built in core axes and placed in the scene by `m` (as models are), as a core pose. */
export function corePose(m: Matrix4): Pose {
  const [p, q, s] = [new Vector3(), new Quaternion(), new Vector3()]
  TO_CORE.clone().multiply(m).multiply(TO_THREE).decompose(p, q, s)
  return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] }
}

/** A `<model>.colliders.json`: boxes and capsules in the model's core frame (scripts/assets). */
export interface ColliderFile {
  boxes: { name: string; min: number[]; max: number[] }[]
  capsules?: { name: string; a: number[]; b: number[]; radius: number }[]
}

/** A model's collider file placed in the scene: by its model's pose, keyed by what it is. */
export interface Placement {
  key: string
  url: string
  pose: Matrix4
  /** Taken off the top of a box named `housing`: a Dupont housing stops short of its own wire. */
  trimTopMm?: number
}

/** The table's top is the scene's y = 0; it reaches well past anything on it. */
export const TABLE: ColliderSpec = {
  key: 'table',
  shape: { kind: 'box', halfExtents: [3000, 3000, 10] },
  pose: { position: [0, 0, -10], rotation: [0, 0, 0, 1] }
}

/**
 * The solver's colliders for a placed file. A box that holds one of `exits` (the lead wire exits,
 * scene points) is left out: those are clamped, and a contact could never push them out of it.
 */
export function placeColliders(p: Placement, file: ColliderFile, exits: Vector3[]): ColliderSpec[] {
  const out: ColliderSpec[] = []
  const toLocal = p.pose.clone().invert()
  const local = new Vector3()
  const holds = (min: number[], max: number[]) =>
    exits.some((e) => {
      const [x, y, z] = toCore(local.copy(e).applyMatrix4(toLocal))
      return (
        x >= min[0]! && x <= max[0]! && y >= min[1]! && y <= max[1]! && z >= min[2]! && z <= max[2]!
      )
    })
  file.boxes.forEach((b, i) => {
    const max =
      b.name === 'housing' && p.trimTopMm ? [b.max[0]!, b.max[1]!, b.max[2]! - p.trimTopMm] : b.max
    if (holds(b.min, max)) return
    const mid = (a: number) => (b.min[a]! + max[a]!) / 2
    const half = (a: number) => (max[a]! - b.min[a]!) / 2
    out.push({
      key: `${p.key}/${i}`,
      shape: { kind: 'box', halfExtents: [half(0), half(1), half(2)] },
      pose: corePose(
        p.pose.clone().multiply(new Matrix4().makeTranslation(mid(0), mid(2), -mid(1)))
      )
    })
  })
  file.capsules?.forEach((c, i) => {
    // The capsule's own frame, in the model's core axes: centred, its z along the capsule.
    const [a, b] = [new Vector3(...c.a), new Vector3(...c.b)]
    const axis = b.clone().sub(a)
    const length = axis.length()
    const local = new Matrix4().compose(
      a.add(b).multiplyScalar(0.5),
      new Quaternion().setFromUnitVectors(Z, axis.normalize()),
      ONE
    )
    const m = p.pose.clone().multiply(TO_THREE).multiply(local).multiply(TO_CORE)
    out.push({
      key: `${p.key}/c${i}`,
      shape: { kind: 'capsule', radius: c.radius, halfLength: length / 2 },
      pose: corePose(m)
    })
  })
  return out
}

type Unhandled<T> = T extends unknown ? Omit<T, 'handle'> : never

/** A cable as a layer hands it over: `build` names what its particles were made from. */
export interface CableIn {
  key: string
  build: string
  spec: Unhandled<BodySpec>
}

/** A cable's latest particles: the step's positions and where in them its own sit. */
export interface CableState {
  body: CableBody
  positions: Float32Array
}

/** What the solver was sent and where it put the cables (tests measure penetration from it). */
export interface CablesReport {
  colliders: ColliderSpec[]
  cables: {
    key: string
    kind: BodySpec['kind']
    rows: number
    columns: number
    asleep: boolean
    taut: boolean
    /** The drawn particles, three core-frame floats each. */
    points: number[]
  }[]
}

export class Cables {
  /** Shared buffers need a cross-origin-isolated page (SPEC 4.3); without one nothing simulates. */
  readonly available =
    typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true
  /** The last scene sent (tests measure against its colliders). */
  scene: CableScene | null = null
  private worker: Worker | null = null
  private buffer: CableBuffer | null = null
  private sent = 0
  private settleId = 0
  private text = ''
  private read = -1
  private shown = false
  private step: CableStep | null = null
  private readonly handles = new Map<string, { handle: number; build: string }>()
  private nextHandle = 1

  /** Sends the scene if it changed. `settle` starts a fresh world and settles it offscreen. */
  sync(colliders: ColliderSpec[], cables: CableIn[], settle: boolean): void {
    if (!this.start()) return
    for (const key of [...this.handles.keys()])
      if (!cables.some((c) => c.key === key)) this.handles.delete(key)
    const bodies = cables.map(({ key, build, spec }): BodySpec => {
      let h = this.handles.get(key)
      if (h?.build !== build) this.handles.set(key, (h = { handle: this.nextHandle++, build }))
      return { ...spec, handle: h.handle } as BodySpec
    })
    const scene = { colliders, bodies }
    const text = JSON.stringify(scene)
    if (!settle && text === this.text) return
    this.text = text
    this.scene = scene
    const id = ++this.sent
    if (settle) this.settleId = id
    const req: PhysicsRequest = { type: 'scene', id, scene, settle }
    this.worker!.postMessage(req)
  }

  /** Whether the cables changed since the last call: a new step, or the settled scene showing. */
  poll(): boolean {
    const buffer = this.buffer
    if (!buffer) return false
    const shown = this.ready
    let changed = shown !== this.shown
    this.shown = shown
    if (buffer.seq !== this.read) {
      const step = buffer.read()
      if (step) {
        this.read = step.seq
        this.step = step
        changed = true
      }
    }
    return changed && shown
  }

  /** Whether the cables still move: an island is awake, or a scene is on its way. */
  get moving(): boolean {
    const b = this.buffer
    return !!b && (b.awake || b.acknowledged < this.sent)
  }

  /** The last settle has been applied, so what the buffer holds may be shown. */
  get ready(): boolean {
    return !!this.buffer && this.settleId > 0 && this.buffer.acknowledged >= this.settleId
  }

  /** The worker's step times, in ms. */
  get stepMs(): { last: number; mean: number; max: number } | null {
    return this.buffer?.stepMs ?? null
  }

  /** A cable's particles in the latest step, once the settled scene may be shown. */
  state(key: string): CableState | null {
    const handle = this.handles.get(key)?.handle
    const body = handle === undefined || !this.ready ? undefined : this.step?.bodies.get(handle)
    return body ? { body, positions: this.step!.positions } : null
  }

  /** The last scene's colliders and each cable's drawn particles (core frame), for tests. */
  report(): CablesReport | null {
    const { scene, step } = this
    if (!scene || !step || !this.ready) return null
    const kinds = new Map(scene.bodies.map((b) => [b.handle, b.kind]))
    const cables: CablesReport['cables'] = []
    for (const [key, { handle }] of this.handles) {
      const body = step.bodies.get(handle)
      if (!body) continue
      const from = 3 * (body.offset + body.wireStart)
      const to = 3 * (body.offset + body.wireEnd)
      cables.push({
        key,
        kind: kinds.get(handle)!,
        rows: body.rows,
        columns: body.columns,
        asleep: body.asleep,
        taut: body.taut,
        points: Array.from(step.positions.subarray(from, to))
      })
    }
    return { colliders: scene.colliders, cables }
  }

  private start(): boolean {
    if (this.worker) return true
    if (!this.available) return false
    this.buffer = CableBuffer.create(MAX_PARTICLES)
    this.worker = new Worker(new URL('../workers/physics.worker.ts', import.meta.url), {
      type: 'module'
    })
    const init: PhysicsRequest = {
      type: 'init',
      buffer: this.buffer.buffer,
      maxParticles: MAX_PARTICLES
    }
    this.worker.postMessage(init)
    return true
  }
}
