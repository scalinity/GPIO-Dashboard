// 74HC595 against the TI SN74HC595 datasheet (SCLS041J): pin diagram (section 5), recommended
// operating conditions (6.3), electrical characteristics (6.5) and the function table (8.4).
import { describe, expect, it } from 'vitest'
import { PART_DEFS } from '../../defs/parts'
import { bench } from './fake-io'
import { pinId } from './pins'
import { createShiftRegister595 } from './shift-register-595'

const def = PART_DEFS.get('ic-74hc595')!

function setup(vcc = 5) {
  const b = bench()
  const model = createShiftRegister595(def, {})
  const set = (label: string, volts: number) => {
    b.volts[pinId(def, label)] = volts
  }
  const step = () => model.update(b.io)
  const view = () =>
    model.view() as {
      powered: boolean
      shift: boolean[]
      storage: boolean[]
      outputsEnabled: boolean
    }
  set('VCC', vcc)
  set('SRCLR', vcc)
  step()
  const pulse = (label: string) => {
    set(label, vcc)
    step()
    set(label, 0)
    step()
  }
  const shiftIn = (bit: number) => {
    set('SER', bit ? vcc : 0)
    pulse('SRCLK')
  }
  /** true or false for a driven output, null for high impedance. */
  const out = (label: string) => {
    const drive = model.drives()[pinId(def, label)]
    return drive ? drive.volts > 0 : null
  }
  const byte = () => ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'].map(out)
  return { b, model, set, step, view, pulse, shiftIn, out, byte }
}

// Shifting these bits in, first to last, leaves the first one in QH.
const BITS = [1, 0, 1, 1, 0, 0, 1, 0]
const QA_TO_QH = [false, true, false, false, true, true, false, true]

describe('74HC595 pins', () => {
  it('uses the pin numbers of the datasheet package diagram', () => {
    const numbers = Object.fromEntries(def.pins.map((p) => [p.label, p.id]))
    expect(numbers).toMatchObject({
      QB: '1',
      QH: '7',
      GND: '8',
      "QH'": '9',
      SRCLR: '10',
      SRCLK: '11',
      RCLK: '12',
      OE: '13',
      SER: '14',
      QA: '15',
      VCC: '16'
    })
  })
})

describe('74HC595 shifting and latching (function table, page 12)', () => {
  it('shifts on SRCLK and copies to the outputs only on RCLK', () => {
    const t = setup()
    BITS.forEach(t.shiftIn)
    expect(t.byte()).toEqual(new Array(8).fill(false))
    expect(t.view().shift).toEqual(QA_TO_QH)
    t.pulse('RCLK')
    expect(t.byte()).toEqual(QA_TO_QH)
    expect(t.view().storage).toEqual(QA_TO_QH)
  })

  it('keeps the outputs while the shift register moves on', () => {
    const t = setup()
    BITS.forEach(t.shiftIn)
    t.pulse('RCLK')
    t.shiftIn(1)
    expect(t.byte()).toEqual(QA_TO_QH)
    expect(t.view().shift).toEqual([true, ...QA_TO_QH.slice(0, 7)])
  })

  it('shows the last shift stage on QH′ before the latch', () => {
    const t = setup()
    BITS.forEach(t.shiftIn)
    expect(t.out("QH'")).toBe(true)
    t.shiftIn(0)
    expect(t.out("QH'")).toBe(false)
  })

  it('does not shift on a falling SRCLK edge', () => {
    const t = setup()
    t.set('SER', 5)
    t.set('SRCLK', 5)
    t.step()
    const afterRise = [true, ...new Array(7).fill(false)]
    expect(t.view().shift).toEqual(afterRise)
    t.set('SRCLK', 0)
    t.step()
    expect(t.view().shift).toEqual(afterRise)
  })

  it('takes the old shift register when RCLK and SRCLK rise together', () => {
    // Section 8.1: with both clocks tied, the shift register is one pulse ahead of storage.
    const t = setup()
    t.shiftIn(1)
    t.set('SER', 0)
    t.set('SRCLK', 5)
    t.set('RCLK', 5)
    t.step()
    expect(t.view().storage).toEqual([true, ...new Array(7).fill(false)])
    expect(t.view().shift).toEqual([false, true, ...new Array(6).fill(false)])
  })

  it('clears the shift register asynchronously on SRCLR low, leaving storage alone', () => {
    const t = setup()
    BITS.forEach(t.shiftIn)
    t.pulse('RCLK')
    t.set('SRCLR', 0)
    t.step()
    expect(t.view().shift).toEqual(new Array(8).fill(false))
    expect(t.out("QH'")).toBe(false)
    expect(t.byte()).toEqual(QA_TO_QH)
    // The clear wins over a clock pulse while SRCLR is low.
    t.shiftIn(1)
    expect(t.view().shift).toEqual(new Array(8).fill(false))
    t.set('SRCLR', 5)
    t.step()
    t.shiftIn(1)
    expect(t.out("QH'")).toBe(false)
    expect(t.view().shift[0]).toBe(true)
  })

  it('sees no edge in the first powered update', () => {
    const b = bench()
    const model = createShiftRegister595(def, {})
    b.volts[pinId(def, 'VCC')] = 5
    b.volts[pinId(def, 'SRCLR')] = 5
    b.volts[pinId(def, 'SER')] = 5
    b.volts[pinId(def, 'SRCLK')] = 5
    model.update(b.io)
    expect(model.view()).toMatchObject({ shift: new Array(8).fill(false) })
  })
})

describe('74HC595 output enable', () => {
  it('floats QA-QH when OE is high but keeps QH′ driven', () => {
    const t = setup()
    BITS.forEach(t.shiftIn)
    t.pulse('RCLK')
    t.set('OE', 5)
    t.step()
    expect(t.byte()).toEqual(new Array(8).fill(null))
    expect(t.out("QH'")).toBe(true)
    expect(t.view().outputsEnabled).toBe(false)
    t.set('OE', 0)
    t.step()
    expect(t.byte()).toEqual(QA_TO_QH)
  })
})

describe('74HC595 input thresholds scale with the supply (section 6.3)', () => {
  const clockIn = (vcc: number, serVolts: number) => {
    const t = setup(vcc)
    t.set('SER', serVolts)
    t.set('SRCLK', vcc)
    t.step()
    return t.view().shift[0]
  }

  it('reads a 3.3 V logic high on a 5 V part as low, as VIH is 3.5 V there', () => {
    // 3.15 V at 4.5 V and 4.2 V at 6 V interpolate to 3.5 V at 5 V.
    expect(clockIn(5, 3.3)).toBe(false)
    expect(clockIn(5, 3.6)).toBe(true)
  })

  it('puts VIH at 2.358 V on a 3.3 V supply', () => {
    // 1.5 V at 2 V and 3.15 V at 4.5 V interpolate to 2.358 V at 3.3 V.
    expect(clockIn(3.3, 2.3)).toBe(false)
    expect(clockIn(3.3, 2.4)).toBe(true)
  })

  it('uses the table rows exactly at 2, 4.5 and 6 V', () => {
    expect(clockIn(4.5, 3.14)).toBe(false)
    expect(clockIn(4.5, 3.16)).toBe(true)
    expect(clockIn(2, 1.4)).toBe(false)
    expect(clockIn(2, 1.6)).toBe(true)
    expect(clockIn(6, 4.1)).toBe(false)
    expect(clockIn(6, 4.3)).toBe(true)
  })

  it('holds the previous level between VIL and VIH', () => {
    const t = setup(5)
    t.set('SER', 5)
    t.pulse('SRCLK')
    // 2.5 V at a 5 V supply is above VIL (1.5 V) and below VIH (3.5 V): SER stays high.
    t.set('SER', 2.5)
    t.pulse('SRCLK')
    expect(t.view().shift.slice(0, 2)).toEqual([true, true])
  })
})

describe('74HC595 drives and supply load', () => {
  it('derives output resistance from VOH and VOL at 4.5 V (section 6.5)', () => {
    const t = setup(5)
    t.shiftIn(1)
    t.pulse('RCLK')
    const drives = t.model.drives()
    // (4.5 - 3.84) V / 6 mA = 110 ohm high; 0.33 V / 6 mA = 55 ohm low.
    expect(drives[pinId(def, 'QA')]).toEqual({ ref: '8', volts: 5, ohms: expect.closeTo(110, 6) })
    expect(drives[pinId(def, 'QB')]).toEqual({ ref: '8', volts: 0, ohms: expect.closeTo(55, 6) })
    // QH' is rated 4 mA: 165 ohm high, 82.5 ohm low.
    t.shiftIn(0)
    const qh = (label: string) => t.model.drives()[pinId(def, label)]!
    expect(qh("QH'").ohms).toBeCloseTo(82.5, 6)
    BITS.forEach(t.shiftIn)
    expect(qh("QH'").ohms).toBeCloseTo(165, 6)
  })

  it('references drives to the part ground, not circuit ground', () => {
    const t = setup(5)
    t.set('GND', 1)
    t.set('VCC', 6)
    t.step()
    expect(t.model.drives()[pinId(def, 'QA')]).toMatchObject({ ref: '8', volts: 0 })
    t.shiftIn(1)
    t.pulse('RCLK')
    expect(t.model.drives()[pinId(def, 'QA')]).toMatchObject({ ref: '8', volts: 5 })
  })

  it('draws ICC max (80 uA) from the supply', () => {
    const t = setup(5)
    expect(t.model.loads()).toEqual([{ a: '16', b: '8', ohms: expect.closeTo(62500, 3) }])
  })
})

describe('74HC595 unpowered', () => {
  it('drives and loads nothing below the 2 V minimum and loses its contents', () => {
    const t = setup(5)
    BITS.forEach(t.shiftIn)
    t.pulse('RCLK')
    t.set('VCC', 1.9)
    t.step()
    expect(t.model.drives()).toEqual({})
    expect(t.model.loads()).toEqual([])
    expect(t.view()).toMatchObject({ powered: false, outputsEnabled: false })
    t.set('VCC', 5)
    t.step()
    expect(t.byte()).toEqual(new Array(8).fill(false))
    expect(t.view().shift).toEqual(new Array(8).fill(false))
  })

  it('has no timers', () => {
    expect(setup().model.nextEvent()).toBe(Infinity)
  })
})

describe('74HC595 repeated updates', () => {
  it('change nothing at the same time with the same voltages', () => {
    const t = setup()
    BITS.forEach(t.shiftIn)
    t.set('RCLK', 5)
    t.step()
    const snapshot = () =>
      JSON.stringify([t.model.drives(), t.model.loads(), t.view(), t.model.nextEvent()])
    const before = snapshot()
    t.step()
    t.step()
    expect(snapshot()).toBe(before)
  })
})
