// The workroom's furniture (ADR-0144), after the exhibit house style's furniture language: bevelled,
// chunky engineered pieces and faceted low-poly plants, in millimetres. Each builder draws one
// piece into a side's batches through a Builder, whose frame stands the piece on the floor with
// its front facing +z; the room moves and turns that frame against a wall. Practical lamps and
// screens are emitters at most EMIT_MAX bright; what glows around them is a card at most
// GLOW_MAX bright.
import {
  type BufferGeometry,
  BoxGeometry,
  Color,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3
} from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { type Batch, type Finish, type Surface } from './bake'

export interface Batches {
  lit: Batch
  emit: Batch
  glow: Batch
}

/** The room's finishes, sRGB. Metal stays rough enough that the key's highlight on it is under 2. */
export const FINISH = {
  plaster: { color: '#3f484b', roughness: 0.92 },
  wainscot: { color: '#2a201a', roughness: 0.55 },
  trim: { color: '#1a1d24', roughness: 0.5 },
  ceiling: { color: '#171a22', roughness: 0.95 },
  tile: { color: '#3b393f', roughness: 0.7 },
  grout: { color: '#24252b', roughness: 0.9 },
  rug: { color: '#1f2c36', roughness: 0.95 },
  rugBorder: { color: '#4a3527', roughness: 0.95 },
  walnut: { color: '#3a2a20', roughness: 0.55 },
  oak: { color: '#5a4230', roughness: 0.62 },
  butcher: { color: '#8a6747', roughness: 0.6 },
  steel: { color: '#5a5f68', roughness: 0.6, metalness: 0.5 },
  darkSteel: { color: '#23272e', roughness: 0.6, metalness: 0.5 },
  brass: { color: '#c08a3e', roughness: 0.5, metalness: 0.7 },
  cream: { color: '#e7ddca', roughness: 0.8 },
  paper: { color: '#86817a', roughness: 0.9 },
  charcoal: { color: '#2e3136', roughness: 0.7 },
  rubber: { color: '#1c1d20', roughness: 0.92 },
  terracotta: { color: '#8a6450', roughness: 0.8 },
  leaf: { color: '#5f8c45', roughness: 0.72 },
  leafDark: { color: '#46703a', roughness: 0.74 },
  hardboard: { color: '#957d60', roughness: 0.85 },
  toolbox: { color: '#4e2724', roughness: 0.55, metalness: 0.3 },
  bin: { color: '#7e868f', roughness: 0.6 },
  red: { color: '#a8382d', roughness: 0.6 },
  blue: { color: '#2f5d9a', roughness: 0.6 },
  slate: { color: '#3b4a5e', roughness: 0.7 },
  black: { color: '#202124', roughness: 0.6 },
  yellow: { color: '#c9a227', roughness: 0.6 },
  green: { color: '#3f8a4f', roughness: 0.6 },
  orange: { color: '#c46a2e', roughness: 0.6 },
  violet: { color: '#6a4f9a', roughness: 0.6 }
} satisfies Record<string, Finish>

/** Seeded random numbers (mulberry32): the room is dressed the same way every time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ONE = new Vector3(1, 1, 1)
type Turn = [x: number, y: number, z: number]

/** A box with chamfered edges (one segment of rounding), or a plain one for small parts. */
function block(w: number, h: number, d: number, bevel: number): BufferGeometry {
  const r = Math.min(bevel, Math.min(w, h, d) / 2 - 0.01)
  return r > 0.5 ? new RoundedBoxGeometry(w, h, d, 1, r) : new BoxGeometry(w, h, d)
}

/** A low-poly, flat-shaded copy (each face its own normal), as the house style draws naturals. */
function faceted(geometry: BufferGeometry): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  geometry.dispose()
  g.computeVertexNormals()
  return g
}

/** Draws pieces into one side's batches, in a frame standing on the floor. */
export class Builder {
  private readonly frame = new Matrix4()

  constructor(private readonly into: Batches) {}

  /** Stands the frame at (x, y, z) in the room, its front turned `turn` radians about the vertical. */
  at(x: number, y: number, z: number, turn = 0): this {
    this.frame.makeRotationY(turn).setPosition(x, y, z)
    return this
  }

  private matrix(x: number, y: number, z: number, turn: Turn = [0, 0, 0]): Matrix4 {
    const q = new Quaternion().setFromEuler(new Euler(...turn))
    return this.frame.clone().multiply(new Matrix4().compose(new Vector3(x, y, z), q, ONE))
  }

  solid(
    g: BufferGeometry,
    f: Finish,
    at: [number, number, number],
    turn?: Turn,
    surface: Surface = 'piece'
  ): void {
    this.into.lit.lit(g, this.matrix(...at, turn), f, surface)
  }

  /** A bevelled box of size w × h × d centred at (x, y, z). */
  box(
    w: number,
    h: number,
    d: number,
    f: Finish,
    x: number,
    y: number,
    z: number,
    bevel = 6
  ): void {
    this.solid(block(w, h, d, bevel), f, [x, y, z])
  }

  /** A cylinder along y (or turned), centred at (x, y, z). */
  rod(
    r: number,
    h: number,
    f: Finish,
    x: number,
    y: number,
    z: number,
    turn?: Turn,
    segments = 12,
    r2 = r
  ): void {
    this.solid(new CylinderGeometry(r, r2, h, segments), f, [x, y, z], turn)
  }

  /** An unlit emitter, `gain` times `color` in linear light (EMIT_MAX at most). */
  emit(
    g: BufferGeometry,
    color: string | ((p: Vector3) => Color),
    gain: number,
    at: [number, number, number],
    turn?: Turn
  ): void {
    this.into.emit.light(g, this.matrix(...at, turn), color, gain)
  }

  /** A soft glow card w × h facing +z (or turned), `gain` times `color` at its centre. */
  glow(
    w: number,
    h: number,
    color: string,
    gain: number,
    at: [number, number, number],
    turn?: Turn
  ): void {
    this.into.glow.light(new PlaneGeometry(w, h), this.matrix(...at, turn), color, gain)
  }

  /** Three crossed glow cards around a bulb, so it glows from every side. */
  halo(size: number, color: string, gain: number, at: [number, number, number]): void {
    this.glow(size, size, color, gain, at)
    this.glow(size, size, color, gain, at, [0, Math.PI / 2, 0])
    this.glow(size, size, color, gain, at, [Math.PI / 2, 0, 0])
  }
}

// ---------- under the bench ----------

/** The bench's legs, apron and lower shelf, under StageRig's table (1000 × 700, top at y = 0). */
export function benchFrame(b: Builder, floor: number): void {
  const { steel, rubber, butcher, toolbox, bin, cream, charcoal } = FINISH
  const [cx, cz, hw, hd] = [20, 30, 500, 350]
  const legH = -20 - floor
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const [x, z] = [cx + sx * (hw - 60), cz + sz * (hd - 60)]
      b.box(50, legH, 50, steel, x, floor + legH / 2, z, 5)
      b.rod(30, 14, rubber, x, floor + 7, z)
    }
  for (const sz of [-1, 1]) b.box(hw * 2 - 100, 70, 22, steel, cx, -55, cz + sz * (hd - 60), 4)
  for (const sx of [-1, 1]) b.box(22, 70, hd * 2 - 100, steel, cx + sx * (hw - 60), -55, cz, 4)
  // The lower shelf and what is kept on it.
  b.box(hw * 2 - 80, 18, hd * 2 - 90, butcher, cx, floor + 150, cz, 4)
  b.box(420, 200, 220, toolbox, cx - 220, floor + 260, cz - 40, 12)
  b.box(300, 14, 30, steel, cx - 220, floor + 370, cz - 40, 4)
  b.box(320, 70, 210, bin, cx + 160, floor + 194, cz + 40, 6)
  for (let i = 0; i < 4; i++) b.box(72, 64, 200, cream, cx + 50 + i * 74, floor + 194, cz + 40, 3)
  b.rod(90, 160, charcoal, cx + 330, floor + 240, cz - 120, [Math.PI / 2, 0, 0], 16)
  b.emit(new BoxGeometry(hw * 2 - 140, 4, 4), '#ffa83c', 0.22, [cx, -92, cz + hd - 48])
  b.glow(hw * 2.4, 1000, '#ffa83c', 0.025, [cx, floor + 10, cz + hd + 150], [-Math.PI / 2, 0, 0])
}

// ---------- north wall ----------

/**
 * The dusk window, its frame and sill, standing on a frame at the sill's height `sill`: the pane
 * is the brightest thing on the north wall.
 */
export function duskWindow(b: Builder, w: number, h: number, sill: number): void {
  const { darkSteel, cream } = FINISH
  // Dusty rose at the horizon, lavender, then deep blue: well under the lit circuit.
  const horizon = new Color('#cf9c92')
  const middle = new Color('#9d8fd8')
  const top = new Color('#3d4384')
  const sky = (p: Vector3) => {
    const k = (p.y - sill) / h
    return k < 0.3
      ? horizon.clone().lerp(middle, k / 0.3)
      : middle.clone().lerp(top, Math.min(1, (k - 0.3) / 0.7))
  }
  b.emit(new PlaneGeometry(w, h, 1, 10), sky, 0.22, [0, h / 2, 34])
  for (const x of [-w / 2, -w / 6, w / 6, w / 2]) b.box(34, h + 34, 40, darkSteel, x, h / 2, 50, 4)
  for (const y of [0, h / 3, (2 * h) / 3, h]) b.box(w + 34, 30, 40, darkSteel, 0, y, 50, 4)
  b.box(w + 180, 30, 160, cream, 0, -25, 90, 6)
}

/** An amber light bar on the wall: a housing, its strip, and the wash it throws on the wall. */
export function lightBar(b: Builder, h: number): void {
  b.box(64, h, 40, FINISH.trim, 0, h / 2, 20, 6)
  b.emit(new BoxGeometry(18, h - 40, 10), '#ffa83c', 0.3, [0, h / 2, 44])
  b.glow(260, h * 1.1, '#ffa83c', 0.05, [0, h / 2, 6])
}

/** A low walnut sideboard with brass pulls, books and a faceted vase. */
export function credenza(b: Builder, rng: () => number, w: number): void {
  const { walnut, steel, brass, charcoal, cream, terracotta, oak } = FINISH
  const [h, d, legs] = [500, 440, 90]
  b.box(w, h - legs - 25, d, walnut, 0, legs + (h - legs - 25) / 2, 0, 12)
  b.box(w + 30, 25, d + 20, walnut, 0, h - 12, 0, 8)
  for (const x of [-w / 2 + 70, w / 2 - 70])
    for (const z of [-d / 2 + 60, d / 2 - 60]) b.rod(16, legs, steel, x, legs / 2, z, undefined, 8)
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / 4
    if (i > 0) b.box(6, h - legs - 70, 6, charcoal, -w / 2 + (w * i) / 4, legs + 200, d / 2 + 2, 0)
    b.box(130, 14, 18, brass, x, h - 110, d / 2 + 10, 4)
  }
  let y = h
  for (let i = 0; i < 3; i++) {
    const t = 40 + rng() * 25
    b.box(
      380 - i * 30,
      t,
      270 - i * 20,
      i === 1 ? cream : FINISH.slate,
      -w / 2 + 330,
      y + t / 2,
      0,
      4
    )
    y += t
  }
  b.box(260, 130, 200, oak, w / 2 - 520, h + 65, -20, 10)
  b.solid(faceted(new CylinderGeometry(70, 90, 240, 7)), terracotta, [w / 2 - 200, h + 120, 20])
  for (let i = 0; i < 3; i++)
    b.rod(
      4,
      380 + i * 60,
      oak,
      w / 2 - 200 + (i - 1) * 25,
      h + 400 + i * 20,
      20,
      [0, 0, (i - 1) * 0.2],
      5
    )
}

/** A tall plant in a faceted cream pot, its foliage low-poly clusters. */
export function plant(b: Builder, rng: () => number, height: number): void {
  const { cream, leaf, leafDark, oak } = FINISH
  b.solid(faceted(new CylinderGeometry(190, 150, 380, 8)), cream, [0, 190, 0])
  b.solid(faceted(new CylinderGeometry(175, 175, 20, 8)), FINISH.charcoal, [0, 375, 0])
  b.rod(14, height - 500, oak, 0, 380 + (height - 500) / 2, 0, undefined, 6)
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2
    const up = 0.35 + (i / 9) * 0.65
    const r = 140 + rng() * 120
    const at: [number, number, number] = [
      Math.cos(a) * r * (1 - up * 0.4),
      380 + up * (height - 420),
      Math.sin(a) * r * (1 - up * 0.4)
    ]
    const size = 150 + rng() * 110
    const g = faceted(new IcosahedronGeometry(size, 0))
    g.scale(1, 0.55 + rng() * 0.3, 1)
    b.solid(g, i % 2 ? leaf : leafDark, at, [rng(), rng() * 3, rng()])
  }
}

// ---------- west wall ----------

/** A wall bench: a butcher-block top on steel legs, with a lower shelf of bins. */
export function wallBench(b: Builder, w: number, d: number): void {
  const { butcher, steel, rubber, bin, charcoal } = FINISH
  const top = 900
  b.box(w, 40, d, butcher, 0, top - 20, 0, 8)
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      b.box(45, top - 40, 45, steel, sx * (w / 2 - 50), (top - 40) / 2, sz * (d / 2 - 50), 4)
      b.rod(26, 12, rubber, sx * (w / 2 - 50), 6, sz * (d / 2 - 50))
    }
  b.box(w - 60, 16, d - 80, steel, 0, 240, 0, 4)
  // An amber strip under the top's front edge lights the shelf of bins.
  b.emit(new BoxGeometry(w - 80, 8, 12), '#ffa83c', 1.1, [0, top - 46, d / 2 - 30])
  b.glow(w * 1.2, 900, '#ffa83c', 0.06, [0, top - 420, d / 2 + 4])
  for (let i = 0; i < 5; i++)
    b.box(260, 160, 360, i % 2 ? bin : charcoal, -w / 2 + 220 + i * 390, 330, 0, 8)
}

/** A pegboard with pliers, cutters, drivers and a rod of wire spools. */
export function pegboard(b: Builder, rng: () => number, w: number, h: number): void {
  const { hardboard, grout, red, blue, black, yellow, green, steel, darkSteel, orange } = FINISH
  b.box(w, h, 12, hardboard, 0, h / 2, 6, 3)
  for (let x = -w / 2 + 40; x < w / 2 - 20; x += 50)
    for (let y = 40; y < h - 20; y += 50) b.solid(new PlaneGeometry(9, 9), grout, [x, y, 13])
  // Pliers and side cutters: two handles in coloured grips and the steel jaws.
  const pliers = (x: number, grip: Finish, spread: number) => {
    for (const s of [-1, 1]) {
      b.box(22, 190, 14, grip, x + s * spread, h / 2 - 120, 30, 6)
      b.box(14, 90, 12, darkSteel, x + s * spread * 0.4, h / 2 + 20, 30, 4)
    }
  }
  pliers(-w / 2 + 160, red, 22)
  pliers(-w / 2 + 300, blue, 18)
  pliers(-w / 2 + 430, red, 15)
  // Screwdrivers, handle up.
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + 580 + i * 55
    b.rod(16, 110, [yellow, red, blue, black, green][i]!, x, h / 2 + 40, 34)
    b.rod(4, 140 + rng() * 60, steel, x, h / 2 - 90, 34, undefined, 6)
  }
  // A rod of wire spools, as the kit's leads are coloured.
  const rodX = w / 2 - 420
  b.rod(8, 560, steel, rodX, h / 2 + 140, 70, [0, 0, Math.PI / 2], 8)
  ;[red, black, yellow, green, blue, orange].forEach((f, i) => {
    const x = rodX - 240 + i * 96
    b.rod(42, 70, f, x, h / 2 + 140, 70, [0, 0, Math.PI / 2], 16)
    for (const s of [-1, 1])
      b.rod(58, 8, black, x + s * 38, h / 2 + 140, 70, [0, 0, Math.PI / 2], 16)
  })
  // A steel rule and a coil of solder wire.
  b.box(30, 600, 4, steel, w / 2 - 80, h / 2, 16, 1)
  b.rod(60, 30, steel, w / 2 - 200, h / 2 - 200, 40, [Math.PI / 2, 0, 0], 16)
}

/** An articulated desk lamp, its bulb lit warm. */
export function deskLamp(b: Builder): void {
  const { steel, darkSteel } = FINISH
  b.rod(90, 24, darkSteel, 0, 12, 0, undefined, 20)
  b.box(22, 380, 22, steel, 60, 200, 0, 4)
  b.solid(block(22, 360, 22, 4), steel, [180, 470, 0], [0, 0, -0.95])
  b.solid(new CylinderGeometry(40, 120, 150, 20, 1, true), darkSteel, [300, 560, 0], [0, 0, -0.5])
  b.emit(new SphereGeometry(38, 12, 8), '#ffd29a', 1.2, [318, 525, 0])
  b.halo(300, '#ffc070', 0.1, [330, 500, 0])
  b.glow(700, 500, '#ffb070', 0.08, [360, 2, 0], [-Math.PI / 2, 0, 0])
  b.glow(800, 700, '#ffb070', 0.05, [300, 400, -280])
}

/** A bench oscilloscope with a dim trace on its screen. */
export function scope(b: Builder): void {
  const { charcoal, darkSteel, cream } = FINISH
  const [w, h, d] = [380, 200, 300]
  b.box(w, h, d, charcoal, 0, h / 2, 0, 14)
  b.emit(new PlaneGeometry(210, 140), '#0d2a2e', 1, [-60, h / 2 + 4, d / 2 + 1])
  // The trace: a sine of short segments, cyan, under the screens' share of the attention.
  for (let i = 0; i < 24; i++) {
    const x0 = -160 + i * 8.4
    const y0 = h / 2 + 4 + Math.sin(i / 2.6) * 42
    const y1 = h / 2 + 4 + Math.sin((i + 1) / 2.6) * 42
    const a = Math.atan2(y1 - y0, 8.4)
    b.emit(
      new PlaneGeometry(Math.hypot(8.4, y1 - y0) + 1, 3.5),
      '#7fe3ff',
      0.55,
      [x0 + 4.2, (y0 + y1) / 2, d / 2 + 2],
      [0, 0, a]
    )
  }
  b.glow(320, 240, '#7fe3ff', 0.06, [-60, h / 2 + 4, d / 2 + 6])
  for (let i = 0; i < 6; i++)
    b.rod(
      13,
      16,
      i < 2 ? cream : darkSteel,
      105 + (i % 2) * 50,
      40 + Math.floor(i / 2) * 55,
      d / 2 + 8,
      [Math.PI / 2, 0, 0],
      12
    )
}

/** A bench power supply: two dim readouts and red and black posts. */
export function powerSupply(b: Builder): void {
  const { darkSteel, red, black } = FINISH
  const [w, h, d] = [260, 150, 280]
  b.box(w, h, d, darkSteel, 0, h / 2, 0, 10)
  for (const [x, colour] of [
    [-62, '#ff6b4a'],
    [62, '#ffb454']
  ] as const) {
    b.emit(new PlaneGeometry(96, 34), '#1a0d08', 1, [x, 105, d / 2 + 1])
    for (let i = 0; i < 4; i++)
      b.emit(new PlaneGeometry(14, 22), colour, 0.5, [x - 33 + i * 22, 105, d / 2 + 2])
  }
  for (const [x, f] of [
    [-50, red],
    [0, black],
    [50, red]
  ] as const)
    b.rod(11, 22, f, x, 42, d / 2 + 11, [Math.PI / 2, 0, 0], 10)
}

// ---------- east wall ----------

/** A tall cabinet of small parts drawers, each with a label and a pull. */
export function drawerCabinet(b: Builder, cols: number, rows: number): void {
  const { steel, bin, paper, darkSteel } = FINISH
  const [w, h, d] = [cols * 120 + 40, rows * 90 + 60, 320]
  b.box(w, h, d, steel, 0, h / 2, 0, 10)
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) {
      const [x, y] = [-w / 2 + 20 + 120 * (c + 0.5), 30 + 90 * (r + 0.5)]
      b.solid(new BoxGeometry(108, 80, 14), bin, [x, y, d / 2 + 4])
      b.solid(new PlaneGeometry(56, 18), paper, [x, y + 18, d / 2 + 12])
      b.solid(new BoxGeometry(40, 8, 10), darkSteel, [x, y - 20, d / 2 + 14])
    }
}

/** An open shelf of components and books, lit from below by an amber strip. */
export function shelf(b: Builder, rng: () => number, w: number, heights: number[]): void {
  const { walnut, steel, cream, charcoal, yellow, paper } = FINISH
  const d = 260
  for (const y of heights) {
    b.box(w, 26, d, walnut, 0, y, d / 2, 6)
    for (const x of [-w / 2 + 120, w / 2 - 120])
      b.box(20, 120, d - 40, steel, x, y - 70, d / 2 - 10, 3)
  }
  // The lowest board's underside carries the strip; it washes the wall and what stands below.
  const low = heights[0]!
  b.emit(new BoxGeometry(w - 60, 8, 12), '#ffa83c', 1.1, [0, low - 17, d - 40])
  b.glow(w * 1.3, 1100, '#ffa83c', 0.06, [0, low - 380, 4])
  for (const y of heights) {
    let x = -w / 2 + 60
    while (x < w / 2 - 120) {
      const kind = rng()
      if (kind < 0.45) {
        const t = 30 + rng() * 25
        const hh = 180 + rng() * 70
        b.box(
          t,
          hh,
          170,
          [FINISH.blue, FINISH.red, cream, charcoal, FINISH.green][Math.floor(rng() * 5)]!,
          x + t / 2,
          y + 13 + hh / 2,
          d / 2,
          2
        )
        x += t + 4
      } else if (kind < 0.7) {
        // A reel of parts on tape.
        b.rod(85, 16, paper, x + 90, y + 98, d / 2, [Math.PI / 2, 0, 0], 20)
        x += 190
      } else if (kind < 0.85) {
        b.box(150, 110, 180, cream, x + 75, y + 68, d / 2, 8)
        x += 165
      } else {
        // A multimeter in its yellow holster.
        b.box(90, 170, 45, yellow, x + 45, y + 98, d / 2, 10)
        b.emit(new PlaneGeometry(60, 30), '#1c2420', 1, [x + 45, y + 135, d / 2 + 24])
        x += 110
      }
    }
  }
}

/** A soldering station on a small table: its readout, the iron in its stand and solder. */
export function solderingStation(b: Builder): void {
  const { walnut, steel, darkSteel, charcoal, brass, black } = FINISH
  const top = 720
  b.box(620, 30, 480, walnut, 0, top - 15, 0, 6)
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.box(36, top - 30, 36, steel, sx * 270, (top - 30) / 2, sz * 200, 4)
  b.box(560, 14, 420, steel, 0, 160, 0, 3)
  b.box(200, 110, 170, darkSteel, -120, top + 55, 40, 10)
  b.emit(new PlaneGeometry(90, 34), '#1a0d08', 1, [-140, top + 75, 126])
  for (let i = 0; i < 3; i++)
    b.emit(new PlaneGeometry(16, 24), '#ff6b4a', 0.5, [-162 + i * 22, top + 75, 127])
  b.rod(18, 18, charcoal, -60, top + 50, 132, [Math.PI / 2, 0, 0], 12)
  // The stand's coil and the iron resting in it.
  b.rod(32, 120, steel, 120, top + 70, 20, [0.6, 0, 0], 14)
  b.rod(11, 210, charcoal, 120, top + 110, 60, [0.6, 0, 0], 10)
  b.rod(40, 18, brass, 210, top + 10, -80, undefined, 14)
  b.rod(36, 36, steel, 30, top + 18, -130, [Math.PI / 2, 0, 0], 16)
  b.rod(7, 600, black, -10, top + 40, -40, [0, 0.8, Math.PI / 2], 6)
}

// ---------- south wall ----------

/** A panelled walnut door in its frame. */
export function door(b: Builder): void {
  const { trim, oak, brass } = FINISH
  const [w, h] = [900, 2100]
  b.box(w + 140, 70, 50, trim, 0, h + 35, 25, 6)
  for (const s of [-1, 1]) b.box(70, h, 50, trim, s * (w / 2 + 35), h / 2, 25, 6)
  b.box(w, h, 44, oak, 0, h / 2, 22, 8)
  for (const y of [h * 0.3, h * 0.72]) b.box(w - 220, h * 0.36, 16, FINISH.wainscot, 0, y, 50, 10)
  b.rod(14, 140, brass, w / 2 - 90, 1000, 70, [0, 0, Math.PI / 2], 10)
  b.rod(30, 12, brass, w / 2 - 90, 1000, 52, [Math.PI / 2, 0, 0], 16)
  b.emit(new BoxGeometry(w - 20, 8, 6), '#ffb878', 0.9, [0, 4, 47])
  b.glow(w * 1.2, 520, '#ffb878', 0.07, [0, 6, 260], [-Math.PI / 2, 0, 0])
}

/** A round shop stool with splayed legs and a foot ring. */
/** A wall sconce by the door: a brass plate and a frosted shade washing the wall around it. */
export function sconce(b: Builder): void {
  b.box(110, 180, 20, FINISH.brass, 0, 0, 10, 4)
  b.emit(new CylinderGeometry(70, 50, 120, 16), '#ffc58a', 1, [0, 30, 90])
  b.glow(700, 1100, '#ffb070', 0.08, [0, 0, 30])
}

export function stool(b: Builder): void {
  const { oak, steel } = FINISH
  b.rod(180, 45, oak, 0, 660, 0, undefined, 20)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    b.rod(
      14,
      680,
      steel,
      Math.cos(a) * 120,
      330,
      Math.sin(a) * 120,
      [Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12],
      8
    )
  }
  b.solid(new CylinderGeometry(150, 150, 14, 20, 1, true), steel, [0, 240, 0])
}

/**
 * The background echo: a framed GPIO pinout, faint, two columns of twenty pins in their roles'
 * colours (power, ground, GPIO, I2C, SPI, UART), read by silhouette through the blur.
 */
export function pinoutPoster(b: Builder): void {
  const { trim, paper, red, orange, black, green, blue, violet, yellow } = FINISH
  const [w, h] = [620, 880]
  b.box(w + 50, h + 50, 30, trim, 0, 0, 15, 6)
  b.solid(new PlaneGeometry(w, h), paper, [0, 0, 31])
  b.solid(new PlaneGeometry(w * 0.7, 50), FINISH.charcoal, [0, h / 2 - 70, 32])
  // The 40-pin header's roles, left column then right (pin 1 at the top left).
  const left = 'P i g g G g g g P s s s G i g g g g g G'.split(' ')
  const right = 'V V G u u g G g g G g s s i G g G g g g'.split(' ')
  const role: Record<string, Finish> = {
    P: orange,
    V: red,
    G: black,
    g: green,
    i: blue,
    s: violet,
    u: yellow
  }
  const pitch = (h - 200) / 20
  for (let r = 0; r < 20; r++)
    for (const [col, roles] of [
      [-1, left],
      [1, right]
    ] as const) {
      const y = h / 2 - 140 - r * pitch
      b.solid(new BoxGeometry(30, 30, 6), role[roles[r]!]!, [col * 24, y, 34])
      b.solid(new PlaneGeometry(160, 14), FINISH.grout, [col * 135, y, 32])
    }
}

// ---------- ceiling ----------

/** A pendant lamp hanging `drop` mm from the ceiling, its bulb dim. */
export function pendant(b: Builder, drop: number): void {
  const { black, darkSteel } = FINISH
  b.rod(4, drop, black, 0, -drop / 2, 0, undefined, 6)
  b.solid(new CylinderGeometry(30, 150, 140, 24, 1, true), darkSteel, [0, -drop - 60, 0])
  b.rod(34, 30, darkSteel, 0, -drop + 10, 0, undefined, 16)
  b.emit(new SphereGeometry(34, 12, 8), '#ffd29a', 0.9, [0, -drop - 110, 0])
  b.halo(220, '#ffc070', 0.05, [0, -drop - 130, 0])
}
