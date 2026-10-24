// LCD1602 backpack: PCF8574 pin mapping P0=RS, P1=RW, P2=E, P3=backlight, P4-P7=D4-D7 (Silicon Chip
// "El Cheapo Modules Part 5" Fig.1; Handson Technology I2C 1602 guide), and the HD44780U instruction
// set, DDRAM map and 4-bit initialisation (https://www.sparkfun.com/datasheets/LCD/HD44780.pdf,
// Table 6, Figures 4-6, Figure 24).
import { describe, expect, it } from 'vitest'
import { partDef } from '../../defs/parts'
import type { Behavior, BehaviorIo } from '../behavior'
import { createLcd1602I2c } from './lcd1602-i2c'

const RS = 0x01
const RW = 0x02
const E = 0x04
const BL = 0x08

function rig(supply = 5) {
  const beh: Behavior = createLcd1602I2c(partDef('lcd1602-i2c'), {})
  const i2c = beh.i2c!
  const volts: Record<string, number> = { VCC: supply, GND: 0, SDA: supply, SCL: supply }
  const io: BehaviorIo = { t: 0, v: (pin) => volts[pin] ?? 0, env: {} }
  const update = () => beh.update(io)
  update()

  // One nibble as a backpack driver sends it: E high with the data, then E low (latches).
  const nibble = (rs: boolean, n: number, backlight = true) => {
    const base = (n << 4) | (rs ? RS : 0) | (backlight ? BL : 0)
    i2c.write([base | E])
    i2c.write([base])
  }
  const send = (rs: boolean, byte: number) => {
    nibble(rs, byte >> 4)
    nibble(rs, byte & 0x0f)
  }
  const command = (byte: number) => send(false, byte)
  const text = (s: string) => [...s].forEach((c) => send(true, c.charCodeAt(0)))
  // Figure 24: three 8-bit function sets, the switch to 4 bits, then function set, display off,
  // clear and entry mode.
  const init = () => {
    nibble(false, 0x3)
    nibble(false, 0x3)
    nibble(false, 0x3)
    nibble(false, 0x2)
    command(0x28)
    command(0x08)
    command(0x01)
    command(0x06)
    command(0x0c)
  }
  const lines = () => beh.view().lines as [string, string]
  return { beh, i2c, volts, update, nibble, send, command, text, init, lines }
}

const pad = (s: string) => s.padEnd(16, ' ')

describe('lcd1602-i2c', () => {
  it('answers at 0x27 and acknowledges writes and reads while powered', () => {
    const r = rig()
    expect(r.i2c.address()).toBe(0x27)
    expect(r.i2c.write([])).toBe(true)
    expect(r.i2c.read(1)).not.toBeNull()
  })

  it('starts blank, display off, with the backlight on (all PCF8574 outputs high)', () => {
    const r = rig()
    expect(r.beh.view()).toMatchObject({
      powered: true,
      displayOn: false,
      backlight: true,
      lines: [pad(''), pad('')]
    })
  })

  it('shows text after the Figure 24 initialisation, on two lines', () => {
    const r = rig()
    r.init()
    r.text('Hello, world!')
    r.command(0xc0)
    r.text('Line 2')
    expect(r.lines()).toEqual([pad('Hello, world!'), pad('Line 2')])
    expect(r.beh.view()).toMatchObject({ displayOn: true })
  })

  it('does not show text written as 4-bit pairs before the interface has been set to 4 bits', () => {
    const r = rig()
    r.text('Hi')
    expect(r.lines()[0]!.startsWith('Hi')).toBe(false)
  })

  it('latches a nibble on the falling edge of E only', () => {
    const r = rig()
    r.init()
    r.command(0x80)
    const data = (n: number) => (n << 4) | RS | BL
    r.i2c.write([data(0x4) | E]) // E high: nothing yet
    r.i2c.write([data(0x1) | E])
    r.i2c.write([data(0x1)]) // E falls: latches 0x1, pairing with nothing yet
    expect(r.lines()[0]).toBe(pad(''))
    r.i2c.write([data(0x4) | E])
    r.i2c.write([data(0x4)]) // E falls again: 0x1 then 0x4 = 0x14
    expect(r.lines()[0]!.charCodeAt(0)).toBe(0x14)
  })

  it('does not write on a read cycle (R/W high)', () => {
    const r = rig()
    r.init()
    r.command(0x80)
    const base = (0x4 << 4) | RS | RW | BL
    r.i2c.write([base | E])
    r.i2c.write([base])
    r.i2c.write([base | E])
    r.i2c.write([base])
    expect(r.lines()[0]).toBe(pad(''))
  })

  it('accepts several bytes in one write', () => {
    const r = rig()
    r.init()
    r.command(0x80)
    const nib = (n: number) => (n << 4) | RS | BL
    r.i2c.write([nib(0x4) | E, nib(0x4), nib(0x1) | E, nib(0x1)])
    expect(r.lines()[0]![0]).toBe('A')
  })

  it('clears the display and returns the address to the start', () => {
    const r = rig()
    r.init()
    r.text('abc')
    r.command(0x01)
    expect(r.lines()[0]).toBe(pad(''))
    r.text('x')
    expect(r.lines()[0]).toBe(pad('x'))
  })

  it('sets DDRAM addresses on both lines up to 0x0F and 0x4F', () => {
    const r = rig()
    r.init()
    r.command(0x8f)
    r.text('R')
    r.command(0xcf)
    r.text('Z')
    expect(r.lines()[0]![15]).toBe('R')
    expect(r.lines()[1]![15]).toBe('Z')
  })

  it('writes the 80 bytes of DDRAM and ignores the gap between the lines', () => {
    const r = rig()
    r.init()
    r.command(0x80 | 0x27)
    r.text('XY') // 0x27 is the last byte of line 1; 0x28 holds nothing in two-line mode
    r.command(0x80 | 0x40)
    r.text('Q')
    expect(r.lines()[1]![0]).toBe('Q')
    expect(r.lines()[0]).toBe(pad(''))
    for (let i = 0; i < 24; i++) r.command(0x18) // shift the window to put column 39 at the right
    expect(r.lines()[0]![15]).toBe('X')
  })

  it('writes right to left with entry mode decrement', () => {
    const r = rig()
    r.init()
    r.command(0x04) // I/D = 0, S = 0
    r.command(0x85)
    r.text('abc')
    expect(r.lines()[0]!.slice(3, 6)).toBe('cba')
  })

  it('moves the cursor with the cursor shift instruction without writing', () => {
    const r = rig()
    r.init()
    r.command(0x0f)
    r.command(0x14) // cursor right
    r.command(0x14)
    expect(r.beh.view().cursor).toMatchObject({ row: 0, col: 2, on: true, blink: true })
    r.command(0x10) // cursor left
    expect(r.beh.view().cursor).toMatchObject({ col: 1 })
    expect(r.lines()[0]).toBe(pad(''))
  })

  it('shifts the display window with the display shift instruction, on both lines', () => {
    const r = rig()
    r.init()
    r.text('ABCDEFGHIJKLMNOPQRST')
    r.command(0xc0)
    r.text('abcdefghijklmnopqrst')
    r.command(0x18) // shift display left
    expect(r.lines()).toEqual(['BCDEFGHIJKLMNOPQ', 'bcdefghijklmnopq'])
    r.command(0x1c)
    r.command(0x1c) // shift right twice: the window starts at column 39 of each line
    expect(r.lines()).toEqual([' ABCDEFGHIJKLMNO', ' abcdefghijklmno'])
    r.command(0x02) // return home undoes the shift and keeps DDRAM
    expect(r.lines()[0]).toBe('ABCDEFGHIJKLMNOP')
  })

  it('shifts the display on each write when entry mode has S set', () => {
    const r = rig()
    r.init()
    r.command(0x07) // I/D = 1, S = 1
    r.text('AB')
    expect(r.lines()[0]).toBe(pad(''))
    r.command(0x02)
    expect(r.lines()[0]).toBe(pad('AB'))
  })

  it('reports the cursor on the screen, following a display shift and hiding it off screen', () => {
    const r = rig()
    r.init()
    r.command(0x0e) // display on, cursor on, blink off
    r.command(0xc5)
    expect(r.beh.view().cursor).toEqual({ row: 1, col: 5, on: true, blink: false })
    r.command(0x18)
    expect(r.beh.view().cursor).toMatchObject({ col: 4 })
    r.command(0x80 | 0x20)
    expect(r.beh.view().cursor).toMatchObject({ on: false })
    r.command(0x0c)
    r.command(0x80)
    expect(r.beh.view().cursor).toMatchObject({ on: false, blink: false })
  })

  it('turns the display off without losing DDRAM', () => {
    const r = rig()
    r.init()
    r.text('keep')
    r.command(0x08)
    expect(r.beh.view()).toMatchObject({ displayOn: false })
    expect(r.lines()[0]).toBe(pad('keep'))
    r.command(0x0c)
    expect(r.beh.view()).toMatchObject({ displayOn: true })
  })

  it('stores custom characters in CGRAM and keeps them out of DDRAM', () => {
    const r = rig()
    r.init()
    r.command(0x40) // CGRAM address 0
    const heart = [0x00, 0x0a, 0x1f, 0x1f, 0x0e, 0x04, 0x00, 0x00]
    heart.forEach((b) => r.send(true, b))
    r.command(0x80)
    r.send(true, 0)
    expect((r.beh.view().cgram as number[]).slice(0, 8)).toEqual(heart)
    expect(r.lines()[0]![0]).toBe('\u0000')
    expect(r.lines()[0]![1]).toBe(' ')
    // A second character: CGRAM address 8 starts it.
    r.command(0x48)
    r.send(true, 0x11)
    expect((r.beh.view().cgram as number[])[8]).toBe(0x11)
  })

  it('follows the backlight bit', () => {
    const r = rig()
    r.init()
    r.i2c.write([0x00])
    expect(r.beh.view()).toMatchObject({ backlight: false })
    r.i2c.write([BL])
    expect(r.beh.view()).toMatchObject({ backlight: true })
  })

  it('reads back the port, and reports never busy during a read cycle', () => {
    const r = rig()
    r.i2c.write([0x58])
    expect(r.i2c.read(1)).toEqual([0x58])
    r.i2c.write([0xf0 | RW | E])
    expect(r.i2c.read(2)).toEqual([0x06, 0x06])
  })

  it('pulls SDA and SCL up to its own supply and draws the logic current', () => {
    // Silicon Chip Fig.1: 4.7 kOhm on SDA and SCL; LCD-1602A datasheet: 1.2 mA at 5 V.
    const r = rig(5)
    const loads = r.beh.loads()
    expect(loads.slice(0, 2)).toEqual([
      { a: 'SDA', b: 'VCC', ohms: 4700 },
      { a: 'SCL', b: 'VCC', ohms: 4700 }
    ])
    expect(loads).toHaveLength(3)
    expect(loads[2]).toMatchObject({ a: 'VCC', b: 'GND' })
    expect(loads[2]!.ohms).toBeCloseTo(5 / 0.0012, 6)
  })

  it('NACKs everything, shows nothing and draws no current while unpowered', () => {
    const r = rig(0)
    expect(r.i2c.address()).toBeNull()
    expect(r.i2c.write([0x00])).toBe(false)
    expect(r.i2c.read(1)).toBeNull()
    expect(r.beh.view()).toMatchObject({
      powered: false,
      backlight: false,
      lines: [pad(''), pad('')]
    })
    expect(r.beh.loads().some((l) => l.a === 'VCC' && l.b === 'GND')).toBe(false)
    expect(r.beh.drives()).toEqual({})
  })

  it('answers on the bus from 3.3 V but the LCD does not run, and it starts afresh at 5 V', () => {
    // The PCF8574 runs from 2.5 V (TI); the LCD-1602A needs 4.5 V.
    const r = rig(3.3)
    expect(r.i2c.address()).toBe(0x27)
    expect(r.i2c.write([0x00])).toBe(true)
    expect(r.beh.view()).toMatchObject({ powered: false })
    r.init()
    r.text('Hi')
    expect(r.lines()[0]).toBe(pad(''))
    r.volts.VCC = 5
    r.update()
    r.init()
    r.text('Hi')
    expect(r.lines()[0]).toBe(pad('Hi'))
  })

  it('loses its contents when the supply drops and returns to the all-high port', () => {
    const r = rig()
    r.init()
    r.text('gone')
    r.i2c.write([0x00])
    r.volts.VCC = 0
    r.update()
    r.volts.VCC = 5
    r.update()
    expect(r.lines()[0]).toBe(pad(''))
    expect(r.beh.view()).toMatchObject({ displayOn: false, backlight: true })
  })

  it('is idempotent for repeated updates at one time with the same voltages', () => {
    const r = rig()
    r.init()
    r.text('same')
    const snapshot = () =>
      JSON.stringify([r.beh.drives(), r.beh.loads(), r.beh.nextEvent(), r.beh.view()])
    const before = snapshot()
    r.update()
    r.update()
    expect(snapshot()).toBe(before)
    expect(r.beh.nextEvent()).toBe(Infinity)
  })
})
