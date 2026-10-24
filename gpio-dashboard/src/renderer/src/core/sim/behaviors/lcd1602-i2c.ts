// LCD1602 with an I2C backpack (SPEC 9): a PCF8574 expander wired to an HD44780 in 4-bit mode.
// Driven at transaction level through `i2c`; SDA and SCL edges are not simulated.
//
// Backpack wiring, from the Silicon Chip "El Cheapo Modules Part 5" circuit (Fig.1: PCF8574T pin
// 4 = RS, 5 = R/W, 6 = EN, 7 = backlight transistor Q1, 9-12 = D4-D7, i.e. P0-P7) and the Handson
// Technology I2C 1602 guide sketch `LiquidCrystal_I2C lcd(0x3F, 2, 1, 0, 4, 5, 6, 7, 3, POSITIVE)`
// = (addr, en, rw, rs, d4, d5, d6, d7, bl):
//   https://www.siliconchip.com.au/Issue/SC/2017/March/El+Cheapo+Modules%2C+Part+5%3A+LCD+module+with+I%C2%B2C
//   https://www.handsontec.com/dataspecs/module/I2C_1602_LCD.pdf
//
// HD44780U (https://www.sparkfun.com/datasheets/LCD/HD44780.pdf): Table 6 instruction set,
// pages 10-12 DDRAM addressing and display shift, Table 7 shift, page 22 Figure 9 4-bit transfers,
// page 46 Figure 24 4-bit initialisation by instruction.
import type { PartDef } from '../../model/types'
import { param, type Behavior, type BehaviorFactory, type I2cDevice, type Load } from '../behavior'

const RS = 0x01
const RW = 0x02
const E = 0x04
const BACKLIGHT = 0x08

// The stated minimum supply is a specification limit, not a cliff, and a loaded rail sags a
// little: each part runs down to this fraction of its minimum (modelling assumption).
const SUPPLY_MARGIN = 0.9

const LINE_LENGTH = 40
const WIDTH = 16

interface Hd44780 {
  ddram: number[]
  cgram: number[]
  ac: number
  inCgram: boolean
  // Power-on state is an 8-bit interface; a 4-bit one is chosen by function set (Figure 24).
  eightBit: boolean
  twoLines: boolean
  displayOn: boolean
  cursorOn: boolean
  blink: boolean
  increment: boolean
  shiftWithWrite: boolean
  shift: number
  highNibble: number | null
}

// What the internal reset circuit leaves (page 23): display clear, 8-bit, 1 line, display off,
// increment without shift.
const powerOn = (): Hd44780 => ({
  ddram: new Array<number>(80).fill(0x20),
  cgram: new Array<number>(64).fill(0),
  ac: 0,
  inCgram: false,
  eightBit: true,
  twoLines: false,
  displayOn: false,
  cursorOn: false,
  blink: false,
  increment: true,
  shiftWithWrite: false,
  shift: 0,
  highNibble: null
})

// DDRAM is 80 bytes. One line: 0x00-0x4F. Two lines: 0x00-0x27 and 0x40-0x67 (page 11); the
// addresses between and beyond hold nothing.
function ddramSlot(lcd: Hd44780, address: number): number | null {
  if (!lcd.twoLines) return address < 80 ? address : null
  if (address < 0x28) return address
  return address >= 0x40 && address < 0x68 ? address - 0x18 : null
}

function execute(lcd: Hd44780, rs: boolean, byte: number) {
  const step = lcd.increment ? 1 : -1
  if (rs) {
    if (lcd.inCgram) {
      lcd.cgram[lcd.ac & 0x3f] = byte
      lcd.ac = (lcd.ac + step) & 0x3f
      return
    }
    const slot = ddramSlot(lcd, lcd.ac)
    if (slot !== null) lcd.ddram[slot] = byte
    lcd.ac = (lcd.ac + step) & 0x7f
    if (lcd.shiftWithWrite) lcd.shift = (lcd.shift + step + LINE_LENGTH) % LINE_LENGTH
  } else if (byte & 0x80) {
    lcd.ac = byte & 0x7f
    lcd.inCgram = false
  } else if (byte & 0x40) {
    lcd.ac = byte & 0x3f
    lcd.inCgram = true
  } else if (byte & 0x20) {
    lcd.eightBit = !!(byte & 0x10)
    lcd.twoLines = !!(byte & 0x08)
  } else if (byte & 0x10) {
    const right = !!(byte & 0x04)
    if (byte & 0x08) lcd.shift = (lcd.shift + (right ? -1 : 1) + LINE_LENGTH) % LINE_LENGTH
    else lcd.ac = (lcd.ac + (right ? 1 : -1)) & 0x7f
  } else if (byte & 0x08) {
    lcd.displayOn = !!(byte & 0x04)
    lcd.cursorOn = !!(byte & 0x02)
    lcd.blink = !!(byte & 0x01)
  } else if (byte & 0x04) {
    lcd.increment = !!(byte & 0x02)
    lcd.shiftWithWrite = !!(byte & 0x01)
  } else if (byte & 0x02) {
    lcd.ac = 0
    lcd.inCgram = false
    lcd.shift = 0
  } else if (byte & 0x01) {
    lcd.ddram.fill(0x20)
    lcd.ac = 0
    lcd.inCgram = false
    lcd.increment = true
    lcd.shift = 0
  }
}

// A falling E latches one nibble from D4-D7. An 8-bit interface takes it as a whole instruction
// whose DB3-DB0 are low (they are not connected); a 4-bit one pairs high then low nibbles.
function latchNibble(lcd: Hd44780, rs: boolean, nibble: number) {
  if (lcd.eightBit) {
    execute(lcd, rs, nibble << 4)
  } else if (lcd.highNibble === null) {
    lcd.highNibble = nibble
  } else {
    execute(lcd, rs, (lcd.highNibble << 4) | nibble)
    lcd.highNibble = null
  }
}

function addressOf(def: PartDef): number {
  const address = Number(def.sim.params.i2cAddress)
  if (!Number.isInteger(address)) throw new Error(`${def.id}: sim param i2cAddress is missing`)
  return address
}

export const createLcd1602I2c: BehaviorFactory = (def): Behavior => {
  const p = (key: string) => param(def, key)
  const address = addressOf(def)
  const pullupOhm = p('i2cPullupOhm')
  const pullupTo = def.sim.params.i2cPullupTo
  if (typeof pullupTo !== 'string') throw new Error(`${def.id}: sim param i2cPullupTo is missing`)

  let supply = 0
  // The PCF8574 answers from 2.5 V; the HD44780 module needs 4.5 V (the LCD-1602A datasheet).
  let expanderUp = false
  let lcdUp = false
  // The PCF8574 powers up with every output high (TI datasheet, power-on reset).
  let port = 0xff
  let lcd = powerOn()

  const i2c: I2cDevice = {
    address: () => (expanderUp ? address : null),
    write(bytes) {
      if (!expanderUp) return false
      for (const byte of bytes) {
        const falling = !!(port & E) && !(byte & E)
        port = byte
        // R/W high is a read cycle: nothing is written.
        if (falling && lcdUp && !(byte & RW)) latchNibble(lcd, !!(byte & RS), byte >> 4)
      }
      return true
    },
    read(count) {
      if (!expanderUp) return null
      // With R/W high the LCD would drive D4-D7: it reports never busy and address zero.
      const value = port & RW ? port & 0x0f : port
      return new Array<number>(count).fill(value)
    }
  }

  return {
    update(io) {
      supply = io.v('VCC') - io.v('GND')
      const expanderNow = supply >= p('expanderSupplyMinV') * SUPPLY_MARGIN
      const lcdNow = supply >= p('vccMinV') * SUPPLY_MARGIN
      if (!expanderNow) port = 0xff
      if (lcdNow !== lcdUp) lcd = powerOn()
      expanderUp = expanderNow
      lcdUp = lcdNow
    },
    drives() {
      return {}
    },
    loads() {
      const list: Load[] = [
        { a: 'SDA', b: pullupTo, ohms: pullupOhm },
        { a: 'SCL', b: pullupTo, ohms: pullupOhm }
      ]
      if (lcdUp)
        list.push({ a: 'VCC', b: 'GND', ohms: supply / (p('logicSupplyCurrentMa') / 1000) })
      return list
    },
    nextEvent() {
      return Infinity
    },
    view() {
      // The window starts `shift` columns into each line (Figure 5: shifted left, it starts at 01).
      const lines = [0, 0x40].map((base) => {
        let text = ''
        for (let i = 0; i < WIDTH; i++) {
          const slot = ddramSlot(lcd, base + ((lcd.shift + i) % LINE_LENGTH))
          text += String.fromCharCode(slot === null ? 0x20 : lcd.ddram[slot]!)
        }
        return text
      })
      const column = lcd.ac & 0x3f
      const col = (column - lcd.shift + LINE_LENGTH) % LINE_LENGTH
      const visible = !lcd.inCgram && column < LINE_LENGTH && col < WIDTH
      return {
        powered: lcdUp,
        lines: lines as [string, string],
        backlight: expanderUp && !!(port & BACKLIGHT),
        displayOn: lcd.displayOn,
        cursor: {
          row: lcd.ac >> 6,
          col,
          on: visible && lcd.cursorOn,
          blink: visible && lcd.blink
        },
        cgram: [...lcd.cgram]
      }
    },
    i2c
  }
}
