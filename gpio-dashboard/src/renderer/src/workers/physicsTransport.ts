// What passes between the Studio and physics.worker (SPEC 4.3, 10.5). The Studio sends the cable
// scene as messages: collider proxies, and each cable's kinematic anchors, built from the document
// plus any drag in progress, with route hints. It never sends the document. The worker sends
// particle positions and per-body flags back through one SharedArrayBuffer in two halves: it
// writes a whole step into the half nobody is being pointed at, then publishes that half. A
// half's generation is odd while the worker writes it, so a reader can tell it raced a write and
// read again; with two halves, that takes a reader slower than a whole solver step.
import type { ColliderShape, Pose, Vec3 } from '../physics'

export const MAX_BODIES = 256

// Header slots (Int32).
/** The half holding the latest whole step; -1 before the first. */
const FRONT = 0
/** Bumped by every publish. */
const SEQ = 1
/** The id of the last scene message the worker has applied. */
const ACK = 2
/** 1 while any island is awake, so the worker keeps stepping. */
const AWAKE = 3
/** The last step's time, and the mean and longest of the current run of awake steps, in µs. */
const STEP_US = 4
const MEAN_US = 5
const MAX_US = 6
/** GEN + h: half h's generation, odd while it is written. */
const GEN = 7
const HEADER = 9

/** Per body in a half's table (Int32), after the table's body count. */
const FIELDS = 8
const ASLEEP = 1
const TAUT = 2

/** A collider proxy, keyed by what placed it (`bb1`, `pi`, `R1`, `W3:a`) and its box. */
export interface ColliderSpec {
  key: string
  shape: ColliderShape
  pose: Pose
}

/** A cable: its handle (the Studio's, stable while it can keep its particles) and its anchors. */
export type BodySpec =
  | {
      handle: number
      kind: 'lead'
      a: Pose
      b: Pose
      lengthMm: number
      hints: Vec3[]
      /** Where a new lead starts, settled offscreen from there; else the solver's design curve. */
      guess?: Vec3[]
    }
  | { handle: number; kind: 'ribbon'; a: Pose; b: Pose; lengthMm: number; columns: number }
  | { handle: number; kind: 'jumper'; a: Pose; b: Pose; shape: Vec3[] }

export interface CableScene {
  colliders: ColliderSpec[]
  bodies: BodySpec[]
}

export type PhysicsRequest =
  | { type: 'init'; buffer: SharedArrayBuffer; maxParticles: number }
  /** The whole scene; `settle` starts a fresh world and settles it offscreen first. */
  | { type: 'scene'; id: number; scene: CableScene; settle: boolean }

/** One body in a published step. Its particles are `positions[3 * offset …]`, `particles` of them. */
export interface CableBody {
  handle: number
  offset: number
  particles: number
  /** Ribbon: rows along and columns across (row-major); rods: one column. */
  rows: number
  columns: number
  /** The particles worth drawing: [wireStart, wireEnd). */
  wireStart: number
  wireEnd: number
  asleep: boolean
  taut: boolean
}

/** A published step, copied out of the shared buffer. */
export interface CableStep {
  seq: number
  bodies: Map<number, CableBody>
  positions: Float32Array
}

/** What the worker hands `publish`: a body's numbers and its positions, three floats each. */
export type BodyOut = Omit<CableBody, 'offset' | 'particles'> & { positions: Float32Array }

const tableInts = 1 + MAX_BODIES * FIELDS

/** Bytes for a buffer sized to the world's particle pool. */
export const bufferBytes = (maxParticles: number) =>
  4 * (HEADER + 2 * tableInts + 2 * 3 * maxParticles)

export class CableBuffer {
  private readonly header: Int32Array
  private readonly tables: [Int32Array, Int32Array]
  private readonly halves: [Float32Array, Float32Array]
  private readonly copy: Float32Array

  constructor(
    readonly buffer: SharedArrayBuffer,
    readonly maxParticles: number
  ) {
    const floats = 3 * maxParticles
    this.header = new Int32Array(buffer, 0, HEADER)
    let at = 4 * HEADER
    const table = () => new Int32Array(buffer, (at += 4 * tableInts) - 4 * tableInts, tableInts)
    this.tables = [table(), table()]
    const half = () => new Float32Array(buffer, (at += 4 * floats) - 4 * floats, floats)
    this.halves = [half(), half()]
    this.copy = new Float32Array(floats)
  }

  static create(maxParticles: number): CableBuffer {
    const buffer = new CableBuffer(new SharedArrayBuffer(bufferBytes(maxParticles)), maxParticles)
    buffer.header[FRONT] = -1
    return buffer
  }

  // ---- The worker's side -----------------------------------------------------------------------

  /** Writes a whole step into the back half, then makes it the front. */
  publish(bodies: BodyOut[], awake: boolean): void {
    const h = this.header
    const back = Atomics.load(h, FRONT) === 0 ? 1 : 0
    const table = this.tables[back]
    const out = this.halves[back]
    Atomics.add(h, GEN + back, 1)
    let offset = 0
    let count = 0
    for (const b of bodies) {
      const particles = b.positions.length / 3
      if (count === MAX_BODIES || 3 * (offset + particles) > out.length) break
      const o = 1 + count * FIELDS
      table[o] = b.handle
      table[o + 1] = offset
      table[o + 2] = particles
      table[o + 3] = b.rows
      table[o + 4] = b.columns
      table[o + 5] = b.wireStart
      table[o + 6] = b.wireEnd
      table[o + 7] = (b.asleep ? ASLEEP : 0) | (b.taut ? TAUT : 0)
      out.set(b.positions, 3 * offset)
      offset += particles
      count++
    }
    table[0] = count
    Atomics.add(h, GEN + back, 1)
    Atomics.store(h, AWAKE, awake ? 1 : 0)
    Atomics.store(h, FRONT, back)
    Atomics.add(h, SEQ, 1)
  }

  /** Records the last step's time and the current run's mean and longest, in µs. */
  timed(lastUs: number, meanUs: number, maxUs: number): void {
    Atomics.store(this.header, STEP_US, Math.round(lastUs))
    Atomics.store(this.header, MEAN_US, Math.round(meanUs))
    Atomics.store(this.header, MAX_US, Math.round(maxUs))
  }

  acknowledge(id: number): void {
    Atomics.store(this.header, ACK, id)
  }

  // ---- The Studio's side -----------------------------------------------------------------------

  get seq(): number {
    return Atomics.load(this.header, SEQ)
  }

  get acknowledged(): number {
    return Atomics.load(this.header, ACK)
  }

  get awake(): boolean {
    return Atomics.load(this.header, AWAKE) === 1
  }

  /** The last step's time and the current run's mean and longest, in ms. */
  get stepMs(): { last: number; mean: number; max: number } {
    const h = this.header
    return {
      last: Atomics.load(h, STEP_US) / 1000,
      mean: Atomics.load(h, MEAN_US) / 1000,
      max: Atomics.load(h, MAX_US) / 1000
    }
  }

  /** The latest whole step, or null before the first. The positions are reused by the next read. */
  read(): CableStep | null {
    const h = this.header
    for (let attempt = 0; attempt < 4; attempt++) {
      const seq = Atomics.load(h, SEQ)
      const front = Atomics.load(h, FRONT)
      if (front < 0) return null
      const gen = Atomics.load(h, GEN + front)
      if (gen & 1) continue
      const table = this.tables[front as 0 | 1]
      const count = Math.min(table[0]!, MAX_BODIES)
      const bodies = new Map<number, CableBody>()
      let end = 0
      for (let k = 0; k < count; k++) {
        const o = 1 + k * FIELDS
        const body: CableBody = {
          handle: table[o]!,
          offset: table[o + 1]!,
          particles: table[o + 2]!,
          rows: table[o + 3]!,
          columns: table[o + 4]!,
          wireStart: table[o + 5]!,
          wireEnd: table[o + 6]!,
          asleep: (table[o + 7]! & ASLEEP) !== 0,
          taut: (table[o + 7]! & TAUT) !== 0
        }
        bodies.set(body.handle, body)
        end = Math.max(end, body.offset + body.particles)
      }
      this.copy.set(this.halves[front as 0 | 1].subarray(0, 3 * end))
      if (Atomics.load(h, GEN + front) === gen) return { seq, bodies, positions: this.copy }
    }
    return null
  }
}
