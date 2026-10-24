// Headless scenes for the cable solver (SPEC 10.5, 19 "Physics tests"). Each scene builds a world,
// runs it, and measures the result with code of its own, so a solver bug cannot hide in the
// measurement. Units are mm, g and s; z is up and the table top is z = 0.
import { describe, expect, it } from 'vitest'
import dupont from '../content/leads/dupont.json'
import ribbonData from '../content/controllers/ribbon.json'
import {
  BOARD,
  BOARD_TOP,
  FLIP,
  HANG,
  HOUSING,
  TABLE,
  WIRE_R,
  at,
  cableOverlap,
  crossingPair,
  depthIntoBox,
  dist,
  hangOver,
  newWorld,
  pathLength,
  place,
  rodIntoRibbon,
  run,
  sdBox,
  sheetIntoBox,
  wire,
  yaw
} from './testkit'
import type { Box } from './testkit'
import type { BodyId, Vec3 } from './types'
import { CableWorld, FRAME_DT } from './world'

describe('determinism', () => {
  const build = () => {
    const world = newWorld(TABLE, BOARD)
    const ids = [
      world.addLead({ a: at(-30, 0, BOARD_TOP), b: at(30, 5, BOARD_TOP), lengthMm: 110 }),
      world.addLead({ a: at(-10, -15, BOARD_TOP), b: at(20, 15, BOARD_TOP), lengthMm: 90 }),
      world.addRibbon({ a: at(-120, 0, 20), b: at(-60, 0, 25, FLIP) })
    ]
    run(world, 150)
    return { world, ids }
  }

  it('gives identical positions and sleep flags for identical inputs', () => {
    const a = build()
    const b = build()
    a.ids.forEach((id, k) => {
      expect(Array.from(a.world.positions(id))).toEqual(Array.from(b.world.positions(b.ids[k]!)))
      expect(a.world.isAsleep(id)).toBe(b.world.isAsleep(b.ids[k]!))
    })
  })

  it('depends on the seed only through the starting jitter', () => {
    const make = (seed: number) => {
      const w = new CableWorld({ seed })
      return w.positions(w.addLead({ a: at(-30, 0, 0), b: at(30, 0, 0), lengthMm: 100 }))
    }
    expect(Array.from(make(1))).not.toEqual(Array.from(make(2)))
    expect(Array.from(make(1))).toEqual(Array.from(make(1)))
  })
})

describe('inextensibility', () => {
  it('holds an in-span lead at its length within 1% (and no segment stretches past 5%)', () => {
    const world = newWorld(TABLE)
    const L = 200
    const id = world.addLead({ a: at(-70, 0, 0), b: at(70, 0, 0), lengthMm: L })
    run(world, 300)
    const pts = wire(world, id)
    const stretch = pathLength(pts) / L - 1
    const worst = Math.max(
      ...pts.slice(1).map((p, i) => Math.abs(dist(p, pts[i]!) / (L / (pts.length - 1)) - 1))
    )
    console.info(
      `lead length error ${(stretch * 100).toFixed(3)}%, worst segment ${(worst * 100).toFixed(2)}%`
    )
    expect(Math.abs(stretch)).toBeLessThan(0.01)
    expect(worst).toBeLessThan(0.05)
  })

  it('holds a hanging lead at its length with the table out of the way', () => {
    const world = newWorld()
    const L = 160
    const id = world.addLead({ a: at(-50, 0, 100), b: at(50, 0, 100), lengthMm: L })
    run(world, 300)
    expect(Math.abs(pathLength(wire(world, id)) / L - 1)).toBeLessThan(0.005)
  })

  it('holds the ribbon at its length within 0.5% along every column', () => {
    const world = newWorld(TABLE)
    const id = world.addRibbon({ a: at(0, 0, 18), b: at(0, 130, 18, FLIP) })
    run(world, 300)
    const { rows, columns } = world.info(id)
    const p = world.positions(id)
    for (let c = 0; c < columns; c++) {
      const col: Vec3[] = []
      for (let r = 0; r < rows; r++) {
        const i = r * columns + c
        col.push([p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!])
      }
      expect(Math.abs(pathLength(col) / ribbonData.lengthMm - 1)).toBeLessThan(0.005)
    }
  })
})

describe('clamped ends', () => {
  it('keep a lead housing within 0.05 mm of its frame while the frame is dragged', () => {
    const world = newWorld(TABLE)
    const a0 = at(-40, 0, 0)
    const id = world.addLead({ a: a0, b: at(40, 0, 0), lengthMm: 120 })
    const L = 120
    const sw = L / Math.round(L / 3)
    let worst = 0
    for (let f = 0; f < 200; f++) {
      const a = at(-40 + 30 * Math.sin(f / 25), 20 * Math.sin(f / 40), 0, yaw(Math.sin(f / 30)))
      world.setAnchor(id, 0, a)
      world.step()
      const p = world.positions(id)
      const expected: [number, Vec3][] = [
        [0, place(a, [0, 0, HOUSING - sw])],
        [1, place(a, [0, 0, HOUSING])]
      ]
      for (const [i, e] of expected)
        worst = Math.max(worst, dist([p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!], e))
    }
    console.info(`lead attachment error ${worst.toExponential(2)} mm`)
    expect(worst).toBeLessThanOrEqual(0.05)
  })

  it('keep the ribbon rows in both sockets within 0.05 mm while one socket moves', () => {
    const world = newWorld(TABLE)
    const a = at(0, 0, 20)
    const id = world.addRibbon({ a, b: at(0, 120, 20, FLIP) })
    const { rows, columns } = world.info(id)
    const sp = ribbonData.lengthMm / (rows - 1)
    const dx = ribbonData.widthMm / (columns - 1)
    let worst = 0
    for (let f = 0; f < 150; f++) {
      const b = at(0, 120 + 25 * Math.sin(f / 30), 20 + 10 * Math.sin(f / 17), FLIP)
      world.setAnchor(id, 1, b)
      world.step()
      const p = world.positions(id)
      for (let c = 0; c < columns; c++) {
        const x = -ribbonData.widthMm / 2 + c * dx
        for (const r of [0, 1]) {
          const e = place(a, [x, r * sp, 0])
          const i = r * columns + c
          worst = Math.max(worst, dist([p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!], e))
        }
        for (const r of [rows - 1, rows - 2]) {
          const e = place(b, [x, (rows - 1 - r) * sp, 0])
          const i = r * columns + c
          worst = Math.max(worst, dist([p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!], e))
        }
      }
    }
    console.info(`ribbon attachment error ${worst.toExponential(2)} mm`)
    expect(worst).toBeLessThanOrEqual(0.05)
  })
})

describe('contacts', () => {
  it('lead over a part: nothing reaches more than 0.5 mm into the table, board or part', () => {
    // A wall across the board, risen under a hanging lead that would hang lower without it.
    const part: Box = { c: [0, 0, BOARD_TOP + 7], h: [5, 26, 7] }
    const world = newWorld(TABLE, BOARD)
    const id = hangOver(world, part).lead
    run(world, 300)
    const pts = wire(world, id)
    const depths = [TABLE, BOARD, part].map((b) => depthIntoBox(pts, WIRE_R, b))
    console.info(
      `lead over part: table ${depths[0]!.toFixed(3)}, board ${depths[1]!.toFixed(3)}, part ${depths[2]!.toFixed(3)} mm`
    )
    for (const d of depths) expect(d).toBeLessThanOrEqual(0.5)
    // It really rests on the part: over the wall the wire is above its top, and within 0.5 mm of
    // touching it.
    const over = pts.filter((p) => Math.abs(p[0]) < part.h[0])
    expect(Math.min(...over.map((p) => p[2]))).toBeGreaterThan(part.c[2] + part.h[2])
    expect(depths[2]).toBeGreaterThan(-0.5)
  })

  it('a lead lying across a part thinner than its particle spacing does not cut through it', () => {
    // A 2.4 mm wall: two particles can straddle it, so only segment contacts can find it.
    const part: Box = { c: [0, 0, BOARD_TOP + 7], h: [1.2, 26, 7] }
    const world = newWorld(TABLE, BOARD)
    const id = hangOver(world, part).lead
    run(world, 300)
    const depth = depthIntoBox(wire(world, id), WIRE_R, part)
    console.info(`lead across a thin wall: ${depth.toFixed(3)} mm into the part`)
    expect(depth).toBeLessThanOrEqual(0.5)
    expect(depth).toBeGreaterThan(-0.5)
  })

  it('lead over lead: the wires overlap by no more than 0.5 mm', () => {
    const world = newWorld(TABLE, BOARD)
    const { a, b } = crossingPair(world)
    run(world, 400)
    const overlap = cableOverlap(wire(world, a), WIRE_R, wire(world, b), WIRE_R)
    console.info(`lead over lead: overlap ${overlap.toFixed(3)} mm`)
    expect(overlap).toBeLessThanOrEqual(0.5)
    // They rest on each other: within 0.5 mm of touching, and so in one island.
    expect(overlap).toBeGreaterThan(-0.5)
    expect(world.islandOf(a)).toBe(world.islandOf(b))
  })

  it('a pile of five leads: no pair overlaps by more than 0.5 mm', () => {
    const world = newWorld(TABLE, BOARD)
    const ids = [-12, -6, 0, 6, 12].map((y) =>
      world.addLead({ a: at(-25, y, BOARD_TOP), b: at(25, -y, BOARD_TOP), lengthMm: 80 })
    )
    run(world, 400)
    let between = -Infinity
    let board = -Infinity
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        between = Math.max(
          between,
          cableOverlap(wire(world, ids[i]!), WIRE_R, wire(world, ids[j]!), WIRE_R)
        )
      }
      board = Math.max(board, depthIntoBox(wire(world, ids[i]!), WIRE_R, BOARD))
    }
    console.info(
      `pile of five: leads overlap by ${between.toFixed(3)} mm, the board by ${board.toFixed(3)} mm`
    )
    expect(Math.max(between, board)).toBeLessThanOrEqual(0.5)
    // They do rest on one another: the closest pair is within 0.5 mm of touching.
    expect(between).toBeGreaterThan(-0.5)
  })

  it('lead over ribbon: the lead rests on the sheet without sinking more than 0.5 mm', () => {
    const world = newWorld(TABLE)
    const ribbon = world.addRibbon({ a: at(0, -95, 14), b: at(0, 95, 14, FLIP) })
    run(world, 250)
    // Hung across the taut ribbon, 90 mm apart: on its own it would hang about 4 mm lower.
    const lead = world.addLead({
      a: at(-45, 0, HANG, FLIP),
      b: at(45, 0, HANG, FLIP),
      wireMm: 130
    })
    run(world, 300)
    const depth = rodIntoRibbon(world, lead, ribbon)
    console.info(`lead over ribbon: depth ${depth.toFixed(3)} mm`)
    expect(depth).toBeLessThanOrEqual(0.5)
    expect(depth).toBeGreaterThan(-0.5)
  })

  it('ribbon over the breadboard edge: no particle reaches more than 0.5 mm into board or table', () => {
    const world = newWorld(TABLE, BOARD)
    // The near socket lies on the board and the far one is out on the table, near enough the
    // ribbon's reach that it cannot arch clear: it runs over the board's edge and down to the table.
    const id = world.addRibbon({ a: at(0, -10, BOARD_TOP + 0.5), b: at(0, 175, 1, FLIP) })
    run(world, 400)
    const { rows, columns } = world.info(id)
    const p = world.positions(id)
    const pts: Vec3[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const i = (r * columns + c) * 3
        pts.push([p[i]!, p[i + 1]!, p[i + 2]!])
      }
    }
    const R = ribbonData.thicknessMm / 2
    const depths = [BOARD, TABLE].map((b) => Math.max(...pts.map((q) => R - sdBox(q, b))))
    console.info(
      `ribbon over edge: board ${depths[0]!.toFixed(3)}, table ${depths[1]!.toFixed(3)} mm`
    )
    for (const d of depths) expect(d).toBeLessThanOrEqual(0.5)
    // It is draped over the edge: some of it lies on the board, and some is past the edge, where
    // it hangs down toward the table.
    const edge = BOARD.c[1] + BOARD.h[1]
    expect(pts.some((q) => q[1] < edge && sdBox(q, BOARD) < 1)).toBe(true)
    expect(pts.some((q) => q[1] > edge + 5 && q[2] < BOARD_TOP)).toBe(true)
    expect(depths[0]).toBeGreaterThan(-0.5)
  })
})

describe('dragging', () => {
  it('the far socket dragged across the board: the ribbon never reaches more than 0.5 mm in', () => {
    // Both sockets lie on the table either side of the board, 193 mm apart: the ribbon has 6 mm more
    // than the way over the board takes, so it lies on the board between them.
    const world = newWorld(TABLE, BOARD)
    const id = world.addRibbon({ a: at(0, -99, 1), b: at(-25, 94, 1, FLIP) })
    run(world, 250)
    const { rows, columns } = world.info(id)
    const R = ribbonData.thicknessMm / 2
    let worst = -Infinity
    let board = -Infinity
    for (let f = 0; f <= 180; f++) {
      // Up to 0.9 mm a frame, about 50 mm/s, across and back: the ribbon slides along the board.
      const t = f / 180
      world.setAnchor(id, 1, at(-25 * Math.cos(Math.PI * 2 * t), 94, 1, FLIP))
      world.step()
      const p = world.positions(id)
      for (let r = 2; r < rows - 2; r++) {
        for (let c = 0; c < columns; c++) {
          const q = [
            p[(r * columns + c) * 3]!,
            p[(r * columns + c) * 3 + 1]!,
            p[(r * columns + c) * 3 + 2]!
          ]
          worst = Math.max(worst, R - sdBox(q, BOARD), R - sdBox(q, TABLE))
        }
      }
      // The sheet rests on the board's edges, between particles: measured on the sheet itself.
      if (f % 10 === 0) board = Math.max(board, sheetIntoBox(world, id, BOARD))
    }
    console.info(`far socket dragged across the board: worst penetration ${worst.toFixed(3)} mm`)
    expect(worst).toBeLessThanOrEqual(0.5)
    // The ribbon does touch the board during the drag.
    expect(board).toBeGreaterThan(-0.5)
    expect(Array.from(world.positions(id)).every(Number.isFinite)).toBe(true)
  })
})

describe('ribbon rigidity', () => {
  it('stays straight across, parallel row to row, and cannot curve sideways', () => {
    const world = newWorld(TABLE)
    const id = world.addRibbon({ a: at(0, 0, 20), b: at(0, 120, 20, FLIP) })
    run(world, 120)
    // Pull the far socket sideways, up and farther away, then let it come to rest.
    for (let f = 0; f < 90; f++) {
      world.setAnchor(id, 1, at(8 * (f / 90), 120 + 20 * (f / 90), 20 + 10 * (f / 90), FLIP))
      world.step()
    }
    run(world, 200)
    const { rows, columns } = world.info(id)
    const p = world.positions(id)
    const pt = (r: number, c: number): Vec3 => {
      const i = (r * columns + c) * 3
      return [p[i]!, p[i + 1]!, p[i + 2]!]
    }
    const dx = ribbonData.widthMm / (columns - 1)
    let spacing = 0
    let collinear = 0
    let skew = 0
    const dir0 = [0, 1, 2].map((k) => pt(rows >> 1, columns - 1)[k]! - pt(rows >> 1, 0)[k]!)
    const n0 = Math.hypot(...dir0)
    for (let r = 0; r < rows; r++) {
      const first = pt(r, 0)
      const dir = [0, 1, 2].map((k) => pt(r, columns - 1)[k]! - first[k]!)
      const n = Math.hypot(...dir)
      for (let c = 0; c < columns; c++) {
        const q = pt(r, c)
        spacing = Math.max(spacing, Math.abs(dist(q, pt(r, 0)) - c * dx))
        // distance of the column point from the row's end-to-end line
        const t = [0, 1, 2].map((k) => (q[k]! - first[k]!) * 1)
        const along = (t[0]! * dir[0]! + t[1]! * dir[1]! + t[2]! * dir[2]!) / n
        collinear = Math.max(
          collinear,
          Math.sqrt(Math.max(0, t[0]! ** 2 + t[1]! ** 2 + t[2]! ** 2 - along * along))
        )
      }
      skew = Math.max(
        skew,
        Math.acos(
          Math.min(1, (dir[0]! * dir0[0]! + dir[1]! * dir0[1]! + dir[2]! * dir0[2]!) / (n * n0))
        )
      )
    }
    console.info(
      `ribbon rigidity: spacing ${spacing.toExponential(2)} mm, off-line ${collinear.toExponential(2)} mm, row turn ${((skew * 180) / Math.PI).toFixed(3)} deg`
    )
    expect(spacing).toBeLessThan(0.05)
    expect(collinear).toBeLessThan(0.05)
    expect(skew).toBeLessThan(0.02)
    // The centreline stays between the end frames' planes: no sideways curve beyond the offset.
    const sideways = Array.from({ length: rows }, (_, r) => pt(r, (columns - 1) / 2)[0]!)
    expect(Math.min(...sideways)).toBeGreaterThan(-0.5)
    expect(Math.max(...sideways)).toBeLessThan(8.5)
    // Monotonic: it shears evenly along the length rather than bowing out.
    for (let r = 1; r < rows; r++) expect(sideways[r]! - sideways[r - 1]!).toBeGreaterThan(-0.05)
  })
})

describe('sleep', () => {
  const settled = () => {
    const world = newWorld(TABLE, BOARD)
    const id = world.addLead({ a: at(-30, 0, BOARD_TOP), b: at(30, 0, BOARD_TOP), lengthMm: 100 })
    run(world, 400)
    return { world, id }
  }

  it('an island sleeps within 2 s of the last anchor input', () => {
    const { world, id } = settled()
    expect(world.isAsleep(id)).toBe(true)
    for (let f = 1; f <= 60; f++) {
      world.setAnchor(id, 0, at(-30 + f / 3, 0, BOARD_TOP))
      world.step()
      expect(world.isAsleep(id)).toBe(false)
    }
    let frames = 0
    while (!world.isAsleep(id) && frames < 300) {
      world.step()
      frames++
    }
    console.info(
      `asleep ${frames} frames (${((frames * FRAME_DT) | 0) + ((frames * FRAME_DT) % 1)} s) after the last input`
    )
    expect(frames * FRAME_DT).toBeLessThanOrEqual(2)
  })

  it('wakes at once on an anchor change, and not on an unchanged one', () => {
    const { world, id } = settled()
    world.setAnchor(id, 0, at(-30, 0, BOARD_TOP))
    expect(world.isAsleep(id)).toBe(true)
    world.setAnchor(id, 0, at(-29, 0, BOARD_TOP))
    expect(world.isAsleep(id)).toBe(false)
    expect(world.allAsleep()).toBe(false)
  })

  it('a sleeping body does not move', () => {
    const { world, id } = settled()
    const before = Array.from(world.positions(id))
    run(world, 30)
    expect(Array.from(world.positions(id))).toEqual(before)
  })

  it('a lead resting on a part wakes and falls when the part is dragged away', () => {
    // A wall across the board, risen under a hanging lead that would hang lower on its own: only
    // the part holds its middle up.
    const part: Box = { c: [0, 0, BOARD_TOP + 7], h: [3, 26, 7] }
    const world = newWorld(TABLE, BOARD)
    const { lead: id, wall: partId } = hangOver(world, part)
    run(world, 400)
    expect(world.isAsleep(id)).toBe(true)
    const middle = () => wire(world, id)[Math.floor(wire(world, id).length / 2)]![2]
    const held = middle()
    expect(held).toBeGreaterThan(part.c[2] + part.h[2])
    for (let f = 1; f <= 40; f++) {
      world.setColliderPose(partId, at(0, 60 * (f / 40), part.c[2]))
      world.step()
    }
    expect(world.isAsleep(id)).toBe(false)
    run(world, 300)
    expect(middle()).toBeLessThan(held - 8)
    expect(world.isAsleep(id)).toBe(true)
  })

  it('touching leads share an island and sleep together; separate leads do not', () => {
    const world = newWorld(TABLE, BOARD)
    const { a, b, aEnds } = crossingPair(world)
    const far = world.addLead({ a: at(-300, 0, 0), b: at(-240, 0, 0), lengthMm: 90 })
    run(world, 300)
    expect(cableOverlap(wire(world, a), WIRE_R, wire(world, b), WIRE_R)).toBeGreaterThan(-0.5)
    expect(world.islandOf(a)).toBe(world.islandOf(b))
    expect(world.islandOf(far)).not.toBe(world.islandOf(a))
    // Waking one wakes its island but not the far lead.
    run(world, 200)
    expect(world.isAsleep(far)).toBe(true)
    world.setAnchor(a, 0, at(-29, 0, aEnds[0].position[2], FLIP))
    expect(world.isAsleep(a)).toBe(false)
    expect(world.isAsleep(b)).toBe(false)
    expect(world.isAsleep(far)).toBe(true)
  })
})

describe('over-span', () => {
  const taut = (gap: number, length = 100) => {
    const world = newWorld(TABLE)
    const id = world.addLead({ a: at(-gap / 2, 0, 0), b: at(gap / 2, 0, 0), lengthMm: length })
    run(world, 250)
    return { world, id }
  }

  it('relaxes to a straight, taut span and reports itself taut', () => {
    const { world, id } = taut(130, 100)
    expect(world.isTaut(id)).toBe(true)
    const pts = wire(world, id)
    const a = pts[0]!
    const b = pts[pts.length - 1]!
    // Every wire particle lies on the line between the housing tips.
    const ab = [0, 1, 2].map((k) => b[k]! - a[k]!)
    const len = Math.hypot(...ab)
    let off = 0
    for (const q of pts) {
      const t = ((q[0] - a[0]) * ab[0]! + (q[1] - a[1]) * ab[1]! + (q[2] - a[2]) * ab[2]!) / len
      off = Math.max(
        off,
        Math.hypot(
          q[0] - a[0] - (t * ab[0]!) / len,
          q[1] - a[1] - (t * ab[1]!) / len,
          q[2] - a[2] - (t * ab[2]!) / len
        )
      )
    }
    console.info(
      `over-span lead: ${off.toExponential(2)} mm off the line, spans ${len.toFixed(2)} mm of ${130} mm`
    )
    expect(off).toBeLessThan(0.5)
    expect(len).toBeCloseTo(130, 1)
    const gaps = pts.slice(1).map((p, i) => dist(p, pts[i]!))
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.1)
  })

  it('reports tautness on the same rule as LEAD_TOO_SHORT: reach plus two bend radii', () => {
    // core/reach: requiredMm = distance between the housing tips + 2 * minBendRadiusMm.
    const bend = 2 * dupont.minBendRadiusMm
    const L = 100
    for (const tip of [L - bend - 1, L - bend - 0.1, L - bend + 0.1, L, L + 10]) {
      const world = newWorld()
      const id = world.addLead({ a: at(-tip / 2, 0, 0), b: at(tip / 2, 0, 0), lengthMm: L })
      expect(world.isTaut(id)).toBe(tip + bend > L)
    }
  })

  it('an in-span lead is not taut', () => {
    const { world, id } = taut(40, 150)
    expect(world.isTaut(id)).toBe(false)
  })

  it('goes slack again when the ends come back within reach', () => {
    const world = newWorld(TABLE)
    const id = world.addLead({ a: at(-65, 0, 0), b: at(65, 0, 0), lengthMm: 100 })
    run(world, 150)
    expect(world.isTaut(id)).toBe(true)
    world.setAnchor(id, 1, at(15, 0, 0))
    run(world, 300)
    expect(world.isTaut(id)).toBe(false)
    const pts = wire(world, id)
    expect(Math.abs(pathLength(pts) / 100 - 1)).toBeLessThan(0.01)
  })

  it('a ribbon pulled beyond its length is straight and taut, with its rows intact', () => {
    // core/reach: requiredMm = distance between the sockets + 2 * clampedEndMm.
    const clamp = 2 * ribbonData.clampedEndMm
    const world = newWorld(TABLE)
    const near = world.addRibbon({ a: at(0, 0, 40), b: at(0, 200 - clamp - 1, 40, FLIP) })
    const far = world.addRibbon({ a: at(0, 0, 80), b: at(0, 240, 80, FLIP) })
    run(world, 200)
    expect(world.isTaut(near)).toBe(false)
    expect(world.isTaut(far)).toBe(true)
    const { rows, columns } = world.info(far)
    const p = world.positions(far)
    const mid = columns >> 1
    let off = 0
    for (let r = 0; r < rows; r++) {
      const i = (r * columns + mid) * 3
      // The centre column runs straight along y at the sockets' height.
      off = Math.max(off, Math.hypot(p[i]!, p[i + 2]! - 80))
    }
    console.info(`over-span ribbon: centre column ${off.toExponential(2)} mm off the line`)
    expect(off).toBeLessThan(0.05)
    const dx = ribbonData.widthMm / (columns - 1)
    for (let r = 0; r < rows; r++) {
      const a = r * columns * 3
      const e = (r * columns + columns - 1) * 3
      expect(Math.hypot(p[e]! - p[a]!, p[e + 1]! - p[a + 1]!, p[e + 2]! - p[a + 2]!)).toBeCloseTo(
        dx * (columns - 1),
        3
      )
    }
  })
})

describe('route hints', () => {
  it('pull the span toward a soft target', () => {
    const make = (hints: Vec3[]) => {
      const world = newWorld(TABLE)
      const id = world.addLead({ a: at(-50, 0, 0), b: at(50, 0, 0), lengthMm: 160 })
      world.setRouteHints(id, hints)
      run(world, 300)
      return { world, id }
    }
    const target: Vec3 = [0, 45, 25]
    const free = make([])
    const hinted = make([target])
    const nearest = (w: CableWorld, id: BodyId) =>
      Math.min(...wire(w, id).map((p) => dist(p, target)))
    console.info(
      `route hint: nearest wire ${nearest(hinted.world, hinted.id).toFixed(2)} mm from the hint, ${nearest(free.world, free.id).toFixed(1)} mm without`
    )
    expect(nearest(hinted.world, hinted.id)).toBeLessThan(1.5)
    expect(nearest(free.world, free.id)).toBeGreaterThan(15)
    // Still the same length: the hint bends the lead, it does not stretch it.
    expect(Math.abs(pathLength(wire(hinted.world, hinted.id)) / 160 - 1)).toBeLessThan(0.01)
  })

  it('use at most three targets and can be cleared', () => {
    const world = newWorld(TABLE)
    const id = world.addLead({ a: at(-60, 0, 0), b: at(60, 0, 0), lengthMm: 200 })
    const targets: Vec3[] = [
      [-30, 20, 20],
      [0, 30, 25],
      [30, 20, 20],
      [0, -60, 40]
    ]
    world.setRouteHints(id, targets)
    run(world, 350)
    const pts = wire(world, id)
    const near = (t: Vec3) => Math.min(...pts.map((p) => dist(p, t)))
    expect(near(targets[0]!)).toBeLessThan(2)
    expect(near(targets[2]!)).toBeLessThan(2)
    expect(near(targets[3]!)).toBeGreaterThan(20)
    world.setRouteHints(id, [])
    run(world, 300)
    expect(Math.min(...wire(world, id).map((p) => dist(p, targets[1]!)))).toBeGreaterThan(3)
  })
})

describe('solid jumpers', () => {
  const arch = (): Vec3[] => {
    const pts: Vec3[] = []
    for (let k = 0; k <= 8; k++) pts.push([-20, 0, (10 * k) / 8])
    for (let k = 1; k < 8; k++) pts.push([-20 + (40 * k) / 8, 0, 10])
    for (let k = 0; k <= 8; k++) pts.push([20, 0, 10 - (10 * k) / 8])
    return pts
  }
  const maxFromShape = (world: CableWorld, id: BodyId, shape: Vec3[]) => {
    const pts = wire(world, id)
    return Math.max(
      ...pts.map((p) => {
        let best = Infinity
        for (let i = 0; i + 1 < shape.length; i++) {
          const a = shape[i]!,
            b = shape[i + 1]!
          const ab = [0, 1, 2].map((k) => b[k]! - a[k]!)
          const l2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2
          const t = Math.min(
            1,
            Math.max(
              0,
              ((p[0] - a[0]) * ab[0]! + (p[1] - a[1]) * ab[1]! + (p[2] - a[2]) * ab[2]!) / l2
            )
          )
          best = Math.min(
            best,
            Math.hypot(p[0] - a[0] - t * ab[0]!, p[1] - a[1] - t * ab[1]!, p[2] - a[2] - t * ab[2]!)
          )
        }
        return best
      })
    )
  }

  it('hold the authored bend, follow their holes, and spring back after a push', () => {
    const shape = arch()
    const world = newWorld(TABLE)
    const id = world.addJumper({ a: at(-20, 0, 0), b: at(20, 0, 0), shape })
    run(world, 120)
    expect(maxFromShape(world, id, shape)).toBeLessThan(0.3)
    // Carry both ends 30 mm along y: the arch moves with them and keeps its shape.
    const moved = shape.map((p): Vec3 => [p[0], p[1] + 30, p[2]])
    for (let f = 1; f <= 40; f++) {
      world.setAnchor(id, 0, at(-20, 30 * (f / 40), 0))
      world.setAnchor(id, 1, at(20, 30 * (f / 40), 0))
      world.step()
    }
    run(world, 60)
    expect(maxFromShape(world, id, moved)).toBeLessThan(0.3)
    // A kinematic probe presses on the top: it deflects elastically while pushed...
    const probe = world.addCollider(
      { kind: 'capsule', radius: 2, halfLength: 6 },
      at(0, 30, 17, [0.7071068, 0, 0, 0.7071068])
    )
    for (let f = 1; f <= 30; f++) {
      world.setColliderPose(probe, at(0, 30, 17 - 7 * (f / 30), [0.7071068, 0, 0, 0.7071068]))
      world.step()
    }
    run(world, 30)
    // Under the probe (|x| < 2) the wire sits at the probe's underside, 2.5 mm below its top.
    const under = wire(world, id).filter((p) => Math.abs(p[0]) < 2)
    const dip = Math.min(...under.map((p) => p[2]))
    console.info(`jumper under the probe: ${dip.toFixed(2)} mm (rest 10)`)
    expect(dip).toBeLessThan(10 - 1.5)
    expect(dip).toBeGreaterThan(5)
    // ...and returns when the probe is removed.
    world.removeCollider(probe)
    run(world, 200)
    expect(maxFromShape(world, id, moved)).toBeLessThan(0.3)
  })
})

describe('housings', () => {
  it('a lead in a hole leaves its housing upward, vertical at the tip', () => {
    const world = newWorld(TABLE, BOARD)
    const id = world.addLead({ a: at(-30, 0, BOARD_TOP), b: at(30, 0, BOARD_TOP), lengthMm: 120 })
    run(world, 400)
    const pts = wire(world, id)
    // The first wire segments climb: the lead leaves upward, as the housing stands vertical.
    expect(pts[1]![2]).toBeGreaterThan(pts[0]![2] + 2)
    expect(pts[2]![2]).toBeGreaterThan(pts[1]![2])
    const tail = pts.length - 1
    expect(pts[tail - 1]![2]).toBeGreaterThan(pts[tail]![2] + 2)
    const first = [0, 1, 2].map((k) => pts[1]![k]! - pts[0]![k]!)
    const tilt = (Math.acos(first[2]! / Math.hypot(...first)) * 180) / Math.PI
    console.info(`first wire segment is ${tilt.toFixed(1)} deg from vertical`)
    expect(tilt).toBeLessThan(25)
  })
})

describe('world bookkeeping', () => {
  it('removing a body leaves the others exactly as they were', () => {
    const world = newWorld(TABLE)
    const a = world.addLead({ a: at(-30, 0, 0), b: at(30, 0, 0), lengthMm: 90 })
    const b = world.addLead({ a: at(-30, 40, 0), b: at(30, 40, 0), lengthMm: 90 })
    const c = world.addLead({ a: at(-30, 80, 0), b: at(30, 80, 0), lengthMm: 90 })
    run(world, 300)
    const before = Array.from(world.positions(c))
    world.removeBody(b)
    expect(Array.from(world.positions(c))).toEqual(before)
    run(world, 30)
    expect(Array.from(world.positions(c))).toEqual(before)
    expect(() => world.positions(b)).toThrow(RangeError)
    expect(world.positions(a).length).toBe(world.positions(c).length)
  })

  it('removing a collider lets what rested on it fall', () => {
    const part: Box = { c: [0, 0, BOARD_TOP + 7], h: [3, 26, 7] }
    const world = newWorld(TABLE, BOARD)
    const { lead: id, wall: partId } = hangOver(world, part)
    run(world, 400)
    const middle = () => wire(world, id)[Math.floor(wire(world, id).length / 2)]![2]
    const held = middle()
    expect(held).toBeGreaterThan(part.c[2] + part.h[2])
    world.removeCollider(partId)
    expect(world.isAsleep(id)).toBe(false)
    run(world, 300)
    expect(middle()).toBeLessThan(held - 8)
  })

  it('refuses a body that does not fit the particle pool', () => {
    const world = new CableWorld({ maxParticles: 60 })
    world.addLead({ a: at(0, 0, 0), b: at(40, 0, 0), lengthMm: 100 })
    expect(() => world.addLead({ a: at(0, 20, 0), b: at(40, 20, 0), lengthMm: 100 })).toThrow(
      RangeError
    )
  })

  it('settle runs until everything sleeps, within its bound', () => {
    const world = newWorld(TABLE, BOARD)
    const id = world.addLead({ a: at(-30, 0, BOARD_TOP), b: at(30, 0, BOARD_TOP), lengthMm: 100 })
    const frames = world.settle(600)
    console.info(
      `settle from the design curve: ${frames} frames (${(frames * FRAME_DT).toFixed(2)} s)`
    )
    expect(world.isAsleep(id)).toBe(true)
    expect(frames).toBeLessThan(600)
    const bounded = new CableWorld()
    const other = bounded.addLead({ a: at(-30, 0, 0), b: at(30, 0, 0), lengthMm: 100 })
    expect(bounded.settle(5)).toBe(5)
    expect(bounded.isAsleep(other)).toBe(false)
  })

  it('stays finite and inside its safeguards when a socket is thrown across the scene', () => {
    const world = newWorld(TABLE)
    const lead = world.addLead({ a: at(-30, 0, 0), b: at(30, 0, 0), lengthMm: 100 })
    const ribbon = world.addRibbon({ a: at(0, 0, 20), b: at(0, 120, 20, FLIP) })
    run(world, 60)
    world.setAnchor(lead, 1, at(900, -700, 300))
    world.setAnchor(ribbon, 1, at(-800, 900, 400, FLIP))
    run(world, 120)
    for (const id of [lead, ribbon]) {
      expect(Array.from(world.positions(id)).every(Number.isFinite)).toBe(true)
    }
  })
})
