// The LCD1602's characters (SPEC 10.6): the glyph table covers the controller's ASCII range, the
// custom characters come from CGRAM, and anything else shows a box.
import { describe, expect, it } from 'vitest'
import { glyphRows, hasGlyph } from './lcd'

const cgram = new Array<number>(64).fill(0)

describe('glyphRows', () => {
  it('has a glyph for every code from space to the left arrow, each of seven five-bit rows', () => {
    for (let code = 0x20; code <= 0x7f; code++) {
      expect(hasGlyph(code), `0x${code.toString(16)}`).toBe(true)
      const rows = glyphRows(code, cgram)
      expect(rows).toHaveLength(7)
      for (const row of rows) expect(row).toBeLessThan(32)
    }
  })

  it('draws a capital A as the usual 5x7 shape', () => {
    expect(glyphRows(0x41, cgram)).toEqual([0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11])
  })

  it('reads codes 0 to 7, and their copies at 8 to 15, from CGRAM', () => {
    const custom = [...cgram]
    custom.splice(8, 8, 0x1f, 0, 0x1f, 0, 0x1f, 0, 0x1f, 0)
    expect(glyphRows(1, custom)).toEqual([0x1f, 0, 0x1f, 0, 0x1f, 0, 0x1f, 0])
    expect(glyphRows(9, custom)).toEqual(glyphRows(1, custom))
  })

  it('shows a hollow box for a code with no glyph', () => {
    expect(hasGlyph(0xb1)).toBe(false)
    expect(glyphRows(0xb1, cgram)).toEqual([0x1f, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f])
  })
})
