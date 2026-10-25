// T-board placement, body clearance and pin identity (SPEC 6.3, 6.4, 18).
import { describe, expect, it } from 'vitest'
import { boardDef } from '../defs/boards'
import { headerNetName, PI_HEADER, piPin, TBOARD } from '../defs/controllers'
import type { ColPair, TboardPlacement } from '../model/types'
import { COL_PAIRS, MAIN_COLUMNS } from '../model/types'
import { columnY, holeKey, holePosition, isValidHole } from './breadboard'
import {
  tboardBlockedHoles,
  tboardPinHole,
  tboardPinHoles,
  tboardPlacementProblems
} from './tboard'

const bb = boardDef('bb-830')
const bench: TboardPlacement = {
  board: 'bb1',
  pin1Row: 1,
  colPair: 'd/h',
  orientation: 'header-toward-row-0'
}
const key = (pin: number, p = bench) => holeKey(tboardPinHole(p, pin))

describe('T-board pin placement', () => {
  it('puts the bench placement on d/h: odd pins in d, even pins in h, pin 1 at row 1', () => {
    expect(key(1)).toBe('bb1:1d')
    expect(key(2)).toBe('bb1:1h')
    expect(key(39)).toBe('bb1:20d')
    expect(key(40)).toBe('bb1:20h')
  })

  it('lands every pin in a real hole (D2: the baseline drew them between holes)', () => {
    for (const pair of COL_PAIRS) {
      for (const hole of tboardPinHoles({ ...bench, colPair: pair })) {
        expect(isValidHole(bb, hole)).toBe(true)
      }
    }
  })

  it('allows only column pairs exactly 6 pitches apart, matching the pin-row spacing', () => {
    expect(TBOARD.rowSpacingPitches).toBe(6)
    const sixApart: ColPair[] = []
    for (const a of MAIN_COLUMNS.slice(0, 5)) {
      for (const b of MAIN_COLUMNS.slice(5)) {
        if (Math.abs(columnY(bb, b) - columnY(bb, a) - 6 * 2.54) < 1e-9) {
          sixApart.push(`${a}/${b}` as ColPair)
        }
      }
    }
    expect(sixApart).toEqual([...COL_PAIRS])
    expect(sixApart).not.toContain('e/f') // only 3 pitches apart
  })

  it('turned 180 degrees puts odd pins in the f-j column and counts rows downward', () => {
    const turned: TboardPlacement = { ...bench, pin1Row: 63, orientation: 'header-toward-last-row' }
    expect(key(1, turned)).toBe('bb1:63h')
    expect(key(2, turned)).toBe('bb1:63d')
    expect(key(40, turned)).toBe('bb1:44d')
    expect(tboardPlacementProblems(bb, turned)).toEqual([])
  })

  it('refuses a placement whose pins would run off the board', () => {
    expect(tboardPlacementProblems(bb, { ...bench, pin1Row: 45 })).toHaveLength(1)
    expect(tboardPlacementProblems(bb, { ...bench, pin1Row: 44 })).toEqual([])
  })
})

describe('T-board body clearance (bench placement)', () => {
  const blocked = new Set(tboardBlockedHoles(bb, TBOARD, bench).map(holeKey))

  it('covers e, f and g under the stem in rows 1-20, leaving a, b, c, i, j usable', () => {
    for (let row = 1; row <= 20; row++) {
      for (const col of ['e', 'f', 'g']) expect(blocked).toContain(`bb1:${row}${col}`)
      for (const col of ['a', 'b', 'c', 'i', 'j']) expect(blocked).not.toContain(`bb1:${row}${col}`)
    }
  })

  it('covers d to h in rows 21-23, where the stem runs past pin 39', () => {
    for (const row of [21, 22, 23]) {
      for (const col of ['d', 'e', 'f', 'g', 'h']) expect(blocked).toContain(`bb1:${row}${col}`)
      for (const col of ['a', 'b', 'c', 'i', 'j']) expect(blocked).not.toContain(`bb1:${row}${col}`)
    }
  })

  it('leaves rows 24-63 fully free: 40 rows (D1: the baseline left 10)', () => {
    const freeRows = Array.from({ length: 63 }, (_, i) => i + 1).filter((row) =>
      MAIN_COLUMNS.every((col) => !blocked.has(`bb1:${row}${col}`) && row > 20)
    )
    expect(freeRows).toEqual(Array.from({ length: 40 }, (_, i) => i + 24))
  })

  it('blocks no rail holes', () => {
    expect([...blocked].some((k) => /[+-]\./.test(k))).toBe(false)
  })

  it('blocks columns c and i too when the bench says a Dupont will not seat beside the stem', () => {
    const strict = new Set(
      tboardBlockedHoles(bb, { ...TBOARD, edgeColumnsUsable: false }, bench).map(holeKey)
    )
    for (const row of [1, 10, 23]) {
      expect(strict).toContain(`bb1:${row}c`)
      expect(strict).toContain(`bb1:${row}i`)
      expect(strict).not.toContain(`bb1:${row}b`)
    }
  })

  it('sits a column-c housing about 1.1 mm into the stem edge, the lean the bench allows', () => {
    const [, yc] = holePosition(bb, { board: 'bb1', area: 'main', row: 5, col: 'c' })
    const [, yd] = holePosition(bb, { board: 'bb1', area: 'main', row: 5, col: 'd' })
    const stemEdge = yd + TBOARD.outline.stem.yMin
    expect(TBOARD.dupontHousingMm / 2 - (stemEdge - yc)).toBeCloseTo(1.1, 1)
  })
})

describe('T-board pins through the ribbon to the Pi 5 header', () => {
  // T-board silkscreen names (reference photos) and the official header names they stand for.
  const alias: Record<string, string> = {
    SDA1: 'GP2',
    SCL1: 'GP3',
    TXD0: 'GP14',
    RXD0: 'GP15',
    SPIMOSI: 'GP10',
    SPIMISO: 'GP9',
    SPISCLK: 'GP11',
    SPICE0: 'GP8',
    SPICE1: 'GP7',
    ID_SD: 'GP0',
    ID_SC: 'GP1',
    '5V0': '5V'
  }
  const official = (label: string) => alias[label] ?? label.replace(/^GPIO(\d+)$/, 'GP$1')

  it('has the same name at both ends of every straight-through conductor', () => {
    expect(PI_HEADER).toHaveLength(40)
    for (const { pin, label } of TBOARD.pins) {
      expect(official(label), `pin ${pin}`).toBe(piPin(pin).name)
    }
  })

  it('matches the alternate functions the official table gives for the named pins', () => {
    const fn = (n: number) => piPin(n).function
    expect(fn(3)).toMatch(/SDA/)
    expect(fn(5)).toMatch(/SCL/)
    expect(fn(8)).toMatch(/TXD/)
    expect(fn(10)).toMatch(/RXD/)
    expect(fn(19)).toMatch(/MOSI/)
    expect(fn(21)).toMatch(/MISO/)
    expect(fn(23)).toMatch(/SCLK/)
    expect(fn(24)).toMatch(/CE0/)
    expect(fn(26)).toMatch(/CE1/)
    expect(fn(27)).toMatch(/ID_SD/)
    expect(fn(28)).toMatch(/ID_SC/)
  })

  it('names the shared supply nets: 8 GND pins, two 3V3, two 5V', () => {
    const names = TBOARD.pins.map(({ pin }) => headerNetName(pin))
    expect(names.filter((n) => n === 'GND')).toHaveLength(8)
    expect(names.filter((n) => n === '3V3')).toEqual(['3V3', '3V3'])
    expect(names.filter((n) => n === '5V')).toEqual(['5V', '5V'])
    expect(headerNetName(11)).toBe('GPIO17')
    expect(headerNetName(12)).toBe('GPIO18')
  })
})
