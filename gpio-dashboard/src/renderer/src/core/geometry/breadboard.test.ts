// Breadboard geometry against the BB830 datasheet values (SPEC 6.1, 18).
import { describe, expect, it } from 'vitest'
import { boardDef } from '../defs/boards'
import type { HoleRef } from '../model/types'
import { MAIN_COLUMNS, RAIL_IDS } from '../model/types'
import {
  boardHoles,
  columnY,
  holeKey,
  holePosition,
  isValidHole,
  nearestHole,
  parseHoleKey,
  railHoleRow,
  railY,
  rowX,
  stripKey
} from './breadboard'

const bb = boardDef('bb-830')
const P = 2.54
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe('bb-830 geometry', () => {
  const holes = boardHoles(bb, 'bb1')

  it('has 630 circuit holes and 200 rail holes, each with a unique key', () => {
    expect(holes.filter((h) => h.area === 'main')).toHaveLength(630)
    expect(holes.filter((h) => h.area === 'rail')).toHaveLength(200)
    expect(new Set(holes.map(holeKey)).size).toBe(830)
  })

  it('has 63 rows (D1: the baseline drew 30)', () => {
    expect(bb.rows).toBe(63)
    expect(isValidHole(bb, { board: 'bb1', area: 'main', row: 63, col: 'j' })).toBe(true)
    expect(isValidHole(bb, { board: 'bb1', area: 'main', row: 64, col: 'a' })).toBe(false)
    expect(isValidHole(bb, { board: 'bb1', area: 'main', row: 0, col: 'a' })).toBe(false)
  })

  it('spaces rows and columns on the 2.54 mm pitch with a 3-pitch trench between e and f', () => {
    close(rowX(bb, 2) - rowX(bb, 1), P)
    close(columnY(bb, 'b') - columnY(bb, 'a'), P)
    close(columnY(bb, 'e') - columnY(bb, 'a'), 4 * P)
    close(columnY(bb, 'f') - columnY(bb, 'e'), 3 * P) // 0.3" for DIPs (SPEC 6.1)
    close(columnY(bb, 'j') - columnY(bb, 'f'), 4 * P)
  })

  it('groups each row into two five-hole strips', () => {
    const strips = new Map<string, HoleRef[]>()
    for (const h of holes) strips.set(stripKey(bb, h), [...(strips.get(stripKey(bb, h)) ?? []), h])
    const main = [...strips.entries()].filter(([, hs]) => hs[0]!.area === 'main')
    expect(main).toHaveLength(126)
    expect(main.every(([, hs]) => hs.length === 5)).toBe(true)
    const row5 = holes.filter((h) => h.area === 'main' && h.row === 5)
    expect(new Set(row5.map((h) => stripKey(bb, h)))).toEqual(new Set(['bb1:5a-e', 'bb1:5f-j']))
  })

  it('makes each rail one 50-hole strip, or two halves when split', () => {
    for (const rail of RAIL_IDS) {
      const railHoles = holes.filter((h) => h.area === 'rail' && h.rail === rail)
      expect(railHoles).toHaveLength(50)
      expect(new Set(railHoles.map((h) => stripKey(bb, h)))).toEqual(new Set([`bb1:${rail}`]))
      expect(new Set(railHoles.map((h) => stripKey(bb, h, true))).size).toBe(2)
    }
  })

  it('puts rail holes in groups of five in line with rows 3-7, 9-13, ... 57-61', () => {
    const rows = Array.from({ length: 50 }, (_, i) => railHoleRow(bb, i))
    const expected = Array.from({ length: 10 }, (_, g) =>
      [0, 1, 2, 3, 4].map((k) => 3 + 6 * g + k)
    ).flat()
    expect(rows).toEqual(expected)
    expect(rows).not.toContain(8)
    expect(rows.at(-1)).toBe(61)
  })

  it('places the rail lines 0.25" and 0.35" outside the outer columns, 0.1" apart', () => {
    for (const side of ['top', 'bottom'] as const) {
      const edge = side === 'top' ? columnY(bb, 'j') : columnY(bb, 'a')
      const d = (rail: (typeof RAIL_IDS)[number]) => Math.abs(railY(bb, rail) - edge)
      const near = Math.min(d(`${side}+`), d(`${side}-`))
      const far = Math.max(d(`${side}+`), d(`${side}-`))
      close(near, 2.5 * P)
      close(far, 3.5 * P)
    }
  })

  it('reads the legend as the photos show: top + inner, bottom + outer', () => {
    expect(railY(bb, 'top+')).toBeLessThan(railY(bb, 'top-'))
    expect(railY(bb, 'top+')).toBeGreaterThan(columnY(bb, 'j'))
    expect(railY(bb, 'bottom+')).toBeLessThan(railY(bb, 'bottom-'))
    expect(railY(bb, 'bottom-')).toBeLessThan(columnY(bb, 'a'))
  })

  it('keeps every hole inside the 165.1 x 54.6 mm body, with the grid centred', () => {
    for (const h of holes) {
      const [x, y] = holePosition(bb, h)
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(bb.body.lengthMm)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(bb.body.widthMm)
    }
    close(rowX(bb, 1), bb.body.lengthMm - rowX(bb, 63))
    close(railY(bb, 'bottom+'), bb.body.widthMm - railY(bb, 'top-'))
  })

  it('finds each hole again from its own position, and nothing between holes', () => {
    for (const h of holes) {
      expect(nearestHole(bb, 'bb1', holePosition(bb, h))).toEqual(h)
    }
    const [x, y] = holePosition(bb, { board: 'bb1', area: 'main', row: 10, col: 'e' })
    expect(nearestHole(bb, 'bb1', [x, y + 1.5 * P])).toBeNull() // middle of the trench
  })

  it('round-trips hole keys', () => {
    for (const h of holes) expect(parseHoleKey(holeKey(h))).toEqual(h)
    expect(parseHoleKey('bb1:64k')).toBeNull()
  })

  it('names every column and rail the model allows', () => {
    expect(MAIN_COLUMNS.join('')).toBe('abcdefghij')
    expect(RAIL_IDS).toEqual(['top+', 'top-', 'bottom+', 'bottom-'])
  })
})

describe('bb-400 geometry', () => {
  const half = boardDef('bb-400')
  const holes = boardHoles(half, 'bb2')

  it('has 300 circuit holes in 30 rows and four 25-hole rails', () => {
    expect(holes.filter((h) => h.area === 'main')).toHaveLength(300)
    expect(holes.filter((h) => h.area === 'rail')).toHaveLength(100)
    expect(half.rows).toBe(30)
  })

  it('offsets its rail holes half a pitch (0.050") from the circuit rows, in groups of five', () => {
    const rows = Array.from({ length: 25 }, (_, i) => railHoleRow(half, i))
    expect(rows.slice(0, 6)).toEqual([1.5, 2.5, 3.5, 4.5, 5.5, 7.5])
    expect(rows.at(-1)).toBe(29.5)
  })

  it('keeps every hole inside its 84.0 x 54.3 mm body and finds each again', () => {
    for (const h of holes) {
      const [x, y] = holePosition(half, h)
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(half.body.lengthMm)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(half.body.widthMm)
      expect(nearestHole(half, 'bb2', [x, y])).toEqual(h)
    }
  })
})
