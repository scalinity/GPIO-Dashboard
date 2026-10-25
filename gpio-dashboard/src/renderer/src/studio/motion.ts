// Animated parts (SPEC 10.6), driven by simulation state, not physics: where each animated node of a
// part should be, and the channels that ease it there. The nodes are pivots or mesh nodes that load
// with an identity rotation (ADR-0031, ADR-0043): a turn is about the node's own axis, a travel is
// along its own -y (core -z), both in mm and degrees, composed after the node's load transform.
import { Matrix4 } from 'three/webgpu'
import type { PartDef, PartInstance } from '../core/model/types'
import type { EnvValue } from '../core/sim/behavior'
import type { Snapshot } from '../core/sim/session'

/** The tact switch's plunger travel when pressed: a modelling choice (Omron B3F: 0.25 mm to actuate). */
export const PLUNGER_TRAVEL_MM = 0.4
/** The relay armature's swing when the coil pulls it in, a modelling choice. */
export const ARMATURE_SWING_DEG = 6
/** A motor at its no-load speed turns this fast on screen, in rad/s; slower ones in proportion. */
export const SPIN_MAX_RAD_S = 6 * Math.PI

const rad = (deg: number) => (deg * Math.PI) / 180

/** How a channel approaches its target: an exponential ease, or a spin whose speed eases. */
export type Kind = 'ease' | 'spin'

export interface Target {
  /** The model node it moves. */
  node: string
  kind: Kind
  /** A position for an ease, an angular speed (rad/s) for a spin. */
  target: number
  /** Time constant of the ease, in seconds. */
  tau: number
  /** The transform after the node's own for a position (or, for a spin, the angle in radians). */
  matrix(value: number): Matrix4
}

/** What each animated node of the part should do now. */
export function motionOf(
  part: PartInstance,
  def: PartDef,
  snapshot: Snapshot | null,
  env: Readonly<Record<string, EnvValue>> | undefined
): Target[] {
  const p = def.sim.params
  const value = (key: string) => env?.[key] ?? part.props[key] ?? def.properties[key]?.default
  const view = snapshot?.parts[part.id]
  switch (def.sim.model) {
    case 'tact-switch':
      return [
        {
          node: 'plunger',
          kind: 'ease',
          target: value('pressed') === true ? 1 : 0,
          tau: 0.025,
          matrix: (v) => new Matrix4().makeTranslation(0, -PLUNGER_TRAVEL_MM * v, 0)
        }
      ]
    case 'potentiometer': {
      const wiper = Math.min(Math.max(Number(value('wiper')) / 100, 0), 1)
      return [
        {
          node: 'shaft',
          kind: 'ease',
          target: (wiper - 0.5) * Number(p.rotationDeg),
          tau: 0.05,
          // Seen from the shaft's end (core -y), a higher wiper turns it clockwise.
          matrix: (v) => new Matrix4().makeRotationZ(-rad(v))
        }
      ]
    }
    case 'sg90':
      return [
        {
          node: 'horn',
          kind: 'ease',
          target: Number(view?.angleDeg ?? 0),
          tau: 0.04,
          // A longer pulse turns the horn clockwise seen from above (SG90 data sheet).
          matrix: (v) => new Matrix4().makeRotationY(-rad(v))
        }
      ]
    case 'dc-motor': {
      const rpm = Number(view?.rpm ?? 0)
      return [
        {
          node: 'rotor',
          kind: 'spin',
          target: SPIN_MAX_RAD_S * Math.min(Math.max(rpm / Number(p.noLoadRpm), -1), 1),
          tau: 0.15,
          matrix: (v) => new Matrix4().makeRotationX(v)
        }
      ]
    }
    case 'relay-module':
      return [
        {
          node: 'armature',
          kind: 'ease',
          target: view?.energised === true ? 1 : 0,
          tau: 0.02,
          matrix: (v) => new Matrix4().makeRotationZ(-rad(ARMATURE_SWING_DEG) * v)
        }
      ]
    default:
      return []
  }
}

interface Channel extends Target {
  value: number
  speed: number
  /** Set until the node has been given its first transform. */
  fresh: boolean
}

const SETTLED = 1e-3
const SPIN_SETTLED = 1e-2

/** The animated channels of every part: eased toward their targets, a frame at a time. */
export class Motion {
  private readonly channels = new Map<string, Channel>()

  /**
   * Aims a part's node at a target; a new channel starts there (an ease) or at rest (a spin).
   * True when that changes where the node is headed, so a frame is due.
   */
  aim(part: string, t: Target): boolean {
    const key = `${part}\n${t.node}`
    const c = this.channels.get(key)
    if (c) {
      const moved = c.target !== t.target
      Object.assign(c, t)
      return moved
    }
    this.channels.set(key, { ...t, value: t.kind === 'ease' ? t.target : 0, speed: 0, fresh: true })
    return true
  }

  /** Forgets a part's channels (it left the document). */
  drop(part: string): void {
    for (const key of this.channels.keys())
      if (key.startsWith(`${part}\n`)) this.channels.delete(key)
  }

  parts(): string[] {
    return [...new Set([...this.channels.keys()].map((k) => k.split('\n')[0]!))]
  }

  /** A channel's present value (tests, reports). */
  valueOf(part: string, node: string): number | undefined {
    return this.channels.get(`${part}\n${node}`)?.value
  }

  /**
   * Moves every channel on by `dt` seconds. `apply` is called with the new transform of each node
   * that moved; the result says whether anything is still moving.
   */
  step(dt: number, apply: (part: string, node: string, matrix: Matrix4) => void): boolean {
    let moving = false
    for (const [key, c] of this.channels) {
      const k = 1 - Math.exp(-dt / c.tau)
      let changed = c.fresh
      c.fresh = false
      if (c.kind === 'ease') {
        const gap = c.target - c.value
        if (gap !== 0) {
          const next = Math.abs(gap) < SETTLED ? c.target : c.value + gap * k
          changed ||= next !== c.value
          c.value = next
          moving ||= next !== c.target
        }
      } else {
        const gap = c.target - c.speed
        c.speed = Math.abs(gap) < SPIN_SETTLED ? c.target : c.speed + gap * k
        if (c.speed !== 0) {
          c.value = (c.value + c.speed * dt) % (2 * Math.PI)
          changed = true
        }
        // Still turning, or about to (the first frame of a start has no time passed).
        moving ||= c.speed !== 0 || c.target !== 0
      }
      if (changed) apply(key.split('\n')[0]!, c.node, c.matrix(c.value))
    }
    return moving
  }
}
