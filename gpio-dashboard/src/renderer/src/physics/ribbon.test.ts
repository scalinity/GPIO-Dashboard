// The ribbon against colliders thinner than its particle spacing (ADR-0061, ADR-P2 strips): a
// Dupont housing 2.54 mm wide, a 1.6 mm PCB edge. Its grid is 5 mm along and 8.5 mm across, so a
// particle-only test lets the sheet pass between the particles. The checks measure the sheet itself:
// every cell of the grid, sampled finely, against the box.
import { describe, expect, it } from 'vitest'
import ribbonData from '../content/controllers/ribbon.json'
import { rng } from './math'
import { exit, triangleBox } from './strips'
import { BOARD, BOARD_TOP, FLIP, TABLE, at, newWorld, run, sdBox } from './testkit'
import type { Box } from './testkit'
import type { BodyId, Vec3 } from './types'
import type { CableWorld } from './world'

const HALF_THICKNESS = ribbonData.thicknessMm / 2

/** Deepest the ribbon's surface (its cells, sampled every ~0.5 mm) reaches into the box. */
function sheetIntoBox(world: CableWorld, id: BodyId, box: Box): number {
  const { rows, columns } = world.info(id)
  const P = world.positions(id)
  const pt = (r: number, c: number): Vec3 => {
    const i = (r * columns + c) * 3
    return [P[i]!, P[i + 1]!, P[i + 2]!]
  }
  const N = 8
  let worst = -Infinity
  const tris = (r: number, c: number): Vec3[][] => [
    [pt(r, c), pt(r + 1, c), pt(r + 1, c + 1)],
    [pt(r, c), pt(r + 1, c + 1), pt(r, c + 1)]
  ]
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < columns; c++) {
      for (const [a, b, d] of tris(r, c)) {
        for (let i = 0; i <= N; i++) {
          for (let j = 0; i + j <= N; j++) {
            const u = i / N,
              v = j / N,
              t = 1 - u - v
            const q = [0, 1, 2].map((k) => t * a![k]! + u * b![k]! + v * d![k]!)
            worst = Math.max(worst, HALF_THICKNESS - sdBox(q, box))
          }
        }
      }
    }
  }
  return worst
}

describe('ribbon strips', () => {
  it('a ribbon laid across a housing that fits between its particles does not sink onto it', () => {
    // A 2.54 mm housing stands off every column and every row of the grid, so no particle is ever
    // over it; only the sheet between them is.
    const worstOverall: number[] = []
    for (const [hx, hy] of [
      [4.2, 2.5],
      [-4.2, -12.5],
      [12.7, 31.3]
    ] as const) {
      const housing: Box = { c: [hx, hy, BOARD_TOP + 6], h: [1.27, 1.27, 6] }
      const world = newWorld(TABLE, BOARD)
      world.addCollider({ kind: 'box', halfExtents: housing.h }, at(...housing.c))
      const id = world.addRibbon({ a: at(0, -50, 30), b: at(0, 50, 30, FLIP) })
      run(world, 500)
      const depth = sheetIntoBox(world, id, housing)
      const board = sheetIntoBox(world, id, BOARD)
      console.info(
        `ribbon over a housing at (${hx}, ${hy}): into housing ${depth.toFixed(3)} mm, into board ${board.toFixed(3)} mm`
      )
      expect(depth).toBeLessThanOrEqual(0.5)
      expect(board).toBeLessThanOrEqual(0.5)
      worstOverall.push(depth)
    }
    // It really is held up by the housing in at least the central case: the sheet touches it.
    expect(worstOverall[0]).toBeGreaterThan(-0.5)
  })

  it('a ribbon dragged over the edge of a 1.6 mm plate stays out of it', () => {
    // The plate is thinner than the 5 mm between rows, so the edge passes between two of them.
    const plate: Box = { c: [0, 0, 20], h: [40, 25, 0.8] }
    const world = newWorld(TABLE)
    world.addCollider({ kind: 'box', halfExtents: plate.h }, at(...plate.c))
    const id = world.addRibbon({ a: at(0, -40, 26), b: at(0, 70, 8, FLIP) })
    run(world, 200)
    let worst = -Infinity
    for (let f = 0; f <= 150; f++) {
      world.setAnchor(id, 1, at(0, 70 - 0.3 * f, 8 + 0.1 * f, FLIP))
      world.step()
      if (f % 10 === 0) worst = Math.max(worst, sheetIntoBox(world, id, plate))
    }
    run(world, 200)
    worst = Math.max(worst, sheetIntoBox(world, id, plate))
    console.info(
      `ribbon dragged over a 1.6 mm plate edge: worst ${worst.toFixed(3)} mm into the plate`
    )
    expect(worst).toBeLessThanOrEqual(0.5)
  })

  it('a housing stood up through a settled ribbon pushes the sheet clear', () => {
    const world = newWorld(TABLE, BOARD)
    const id = world.addRibbon({ a: at(0, -50, 30), b: at(0, 50, 30, FLIP) })
    run(world, 400)
    // A housing appears under the middle of the sheet, between its particles, and the sheet is
    // lifted off it.
    const housing: Box = { c: [4.2, 2.5, BOARD_TOP + 6], h: [1.27, 1.27, 6] }
    const hId = world.addCollider({ kind: 'box', halfExtents: housing.h }, at(0, 0, 0))
    for (let f = 1; f <= 30; f++) {
      world.setColliderPose(hId, at(housing.c[0], housing.c[1], BOARD_TOP + 6 - 12 + (12 * f) / 30))
      world.step()
    }
    run(world, 300)
    const depth = sheetIntoBox(world, id, housing)
    console.info(`housing raised through a settled ribbon: ${depth.toFixed(3)} mm into it`)
    expect(depth).toBeLessThanOrEqual(0.5)
  })
})

describe('triangle against box', () => {
  const rand = rng(5)
  const rv = (s: number): Vec3 => [(rand() - 0.5) * s, (rand() - 0.5) * s, (rand() - 0.5) * s]

  it('agrees with a dense sampling of the triangle, and its way out clears the box', () => {
    const h: Vec3 = [3, 2, 1.5]
    let overlaps = 0
    for (let k = 0; k < 400; k++) {
      const a = rv(14),
        b = rv(14),
        c = rv(14)
      const t = Float64Array.from([...a, ...b, ...c])
      // The sheet's own samples: any inside the box means the triangle overlaps it.
      let inside = false
      for (let i = 0; i <= 24 && !inside; i++) {
        for (let j = 0; i + j <= 24 && !inside; j++) {
          const u = i / 24,
            v = j / 24
          const q = [0, 1, 2].map((m) => (1 - u - v) * a[m]! + u * b[m]! + v * c[m]!)
          inside = Math.abs(q[0]!) < h[0] && Math.abs(q[1]!) < h[1] && Math.abs(q[2]!) < h[2]
        }
      }
      const hit = triangleBox(t, h[0], h[1], h[2])
      if (inside) expect(hit).toBe(true)
      if (!hit) continue
      overlaps++
      // Moved along the reported direction by the reported depth (and a hair more) it is clear.
      const moved = t.map((v, i) => v + (exit[0]! + 1e-6) * exit[1 + (i % 3)]!)
      expect(triangleBox(Float64Array.from(moved), h[0], h[1], h[2])).toBe(false)
    }
    expect(overlaps).toBeGreaterThan(40)
  })
})
