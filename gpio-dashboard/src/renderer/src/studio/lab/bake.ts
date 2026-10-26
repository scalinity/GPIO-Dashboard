// Baking the workroom's pieces into a few merged meshes (ADR-0144). Each piece's geometry is placed
// in the room, coloured per vertex (with its roughness and metalness as attributes beside the
// colour) and darkened by an occlusion term worked out from where each vertex stands: near the
// floor, in a corner, under the bench, or facing down. Then every piece of one kind on one side is
// merged into one geometry, so the whole room is a handful of draws on three materials.
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  Matrix4,
  MathUtils,
  Vector3
} from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ROOM } from './bounds'

/** How a lit surface looks: its colour (sRGB hex) and how rough and metallic it is. */
export interface Finish {
  color: string
  roughness?: number
  metalness?: number
}

/** What the occlusion term treats a surface as. */
export type Surface = 'floor' | 'wall' | 'ceiling' | 'piece'

/** The bench's top, which shades what stands under it (its table is StageRig's). */
const BENCH = { x: 20, z: 30, halfWidth: 500, halfDepth: 350 }

const smooth = (a: number, b: number, v: number) => MathUtils.smoothstep(v, a, b)

/** Distance to the nearest wall, in plan. */
const toWall = (p: Vector3) =>
  Math.min(p.x - ROOM.west, ROOM.east - p.x, p.z - ROOM.north, ROOM.south - p.z)

/**
 * Light that reaches a vertex, 0 to 1: a cheap stand-in for ambient occlusion, baked once, as the
 * room never moves.
 */
export function occlusion(surface: Surface, p: Vector3, n: Vector3): number {
  const height = p.y - ROOM.floor
  const corner = 0.7 + 0.3 * smooth(0, 700, toWall(p))
  if (surface === 'floor') {
    const underBench =
      Math.abs(p.x - BENCH.x) < BENCH.halfWidth && Math.abs(p.z - BENCH.z) < BENCH.halfDepth
    return corner * (underBench ? 0.55 : 1)
  }
  if (surface === 'ceiling') return corner
  if (surface === 'wall') {
    // A wall's own face is at distance 0 from itself: its corners are where it meets the next.
    const along = Math.min(
      Math.abs(n.x) > 0.5 ? Infinity : Math.min(p.x - ROOM.west, ROOM.east - p.x),
      Math.abs(n.z) > 0.5 ? Infinity : Math.min(p.z - ROOM.north, ROOM.south - p.z)
    )
    return (
      (0.62 + 0.38 * smooth(0, 450, height)) *
      (0.75 + 0.25 * smooth(0, 600, along)) *
      (0.85 + 0.15 * smooth(0, 400, ROOM.ceiling - p.y))
    )
  }
  const underBench =
    p.y < -20 &&
    Math.abs(p.x - BENCH.x) < BENCH.halfWidth + 20 &&
    Math.abs(p.z - BENCH.z) < BENCH.halfDepth + 20
  return (
    (0.6 + 0.4 * smooth(0, 280, height)) *
    (n.y < -0.5 ? 0.6 : 1) *
    (0.82 + 0.18 * smooth(0, 220, toWall(p))) *
    (underBench ? 0.6 : 1)
  )
}

/**
 * One kind of geometry for one side of the room, gathered piece by piece and merged once.
 * - `lit`: surfaces the lights shine on: a colour, a roughness and a metalness per vertex.
 * - `emit`: practical lamps and screens, drawn unlit at a linear colour (at most 1.5).
 * - `glow`: soft additive cards, their colour times a falloff across their uvs.
 */
export class Batch {
  private readonly pieces: BufferGeometry[] = []
  /** The largest linear colour channel an `emit` or `glow` piece was given. */
  peak = 0

  constructor(readonly kind: 'lit' | 'emit' | 'glow') {}

  get empty(): boolean {
    return this.pieces.length === 0
  }

  /** Adds `geometry` placed by `matrix`, with a lit finish (occlusion baked in). */
  lit(geometry: BufferGeometry, matrix: Matrix4, finish: Finish, surface: Surface): void {
    const g = this.place(geometry, matrix)
    const position = g.getAttribute('position')
    const normal = g.getAttribute('normal')
    const base = new Color(finish.color)
    const [p, n] = [new Vector3(), new Vector3()]
    const colour = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i)
      n.fromBufferAttribute(normal, i)
      const k = occlusion(surface, p, n)
      colour.set([base.r * k, base.g * k, base.b * k], i * 3)
    }
    g.setAttribute('color', new BufferAttribute(colour, 3))
    g.setAttribute('roughness', fill(position.count, finish.roughness ?? 0.85))
    g.setAttribute('metalness', fill(position.count, finish.metalness ?? 0))
    this.pieces.push(g)
  }

  /**
   * Adds an emitter or glow card: `color` (sRGB hex, or a colour per vertex from its place in the
   * room) times `gain`, in linear light.
   */
  light(
    geometry: BufferGeometry,
    matrix: Matrix4,
    color: string | ((p: Vector3) => Color),
    gain: number
  ): void {
    const g = this.place(geometry, matrix)
    const position = g.getAttribute('position')
    const fixed = typeof color === 'string' ? new Color(color) : null
    const p = new Vector3()
    const colour = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) {
      const c = (fixed ?? (color as (p: Vector3) => Color)(p.fromBufferAttribute(position, i)))
        .clone()
        .multiplyScalar(gain)
      this.peak = Math.max(this.peak, c.r, c.g, c.b)
      colour.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new BufferAttribute(colour, 3))
    this.pieces.push(g)
  }

  /** Every piece as one geometry. */
  merge(): BufferGeometry {
    const merged = mergeGeometries(this.pieces)
    if (!merged) throw new Error(`the room's ${this.kind} pieces do not merge`)
    for (const g of this.pieces) g.dispose()
    return merged
  }

  /** A copy of `geometry` in the room's frame, indexed, with only what this kind uses. */
  private place(geometry: BufferGeometry, matrix: Matrix4): BufferGeometry {
    const g = geometry.clone().applyMatrix4(matrix)
    for (const name of Object.keys(g.attributes))
      if (name !== 'position' && name !== 'normal' && !(name === 'uv' && this.kind === 'glow'))
        g.deleteAttribute(name)
    if (!g.index) {
      const index = new Uint32Array(g.getAttribute('position').count)
      for (let i = 0; i < index.length; i++) index[i] = i
      g.setIndex(new BufferAttribute(index, 1))
    }
    geometry.dispose()
    return g
  }
}

function fill(count: number, value: number): BufferAttribute {
  return new BufferAttribute(new Float32Array(count).fill(value), 1)
}
