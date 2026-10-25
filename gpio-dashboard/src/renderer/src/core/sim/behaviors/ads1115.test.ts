// ADS1115 against TI SBAS444E (https://www.ti.com/lit/ds/symlink/ads1115.pdf): Table 8-1 pointer
// register, Table 8-3 config register (reset 8583h; OS, MUX, PGA, MODE, DR and comparator bits),
// Table 7-1 full-scale ranges, Table 7-2 ADDR addresses, section 7.3.7 comparator, and the
// pull-ups and ADDR pull-down from the Adafruit breakout schematic noted in ads1115-module.part.json.
import { describe, expect, it } from 'vitest'
import { partDef } from '../../defs/parts'
import type { Behavior, BehaviorIo } from '../behavior'
import { createAds1115 } from './ads1115'

const FSR = [6.144, 4.096, 2.048, 1.024, 0.512, 0.256]
const RATES = [8, 16, 32, 64, 128, 250, 475, 860]

interface ConfigFields {
  os?: number
  mux?: number
  pga?: number
  mode?: number
  dr?: number
  compMode?: number
  compPol?: number
  compLat?: number
  que?: number
}

const cfg = (f: ConfigFields = {}) =>
  ((f.os ?? 1) << 15) |
  ((f.mux ?? 0) << 12) |
  ((f.pga ?? 2) << 9) |
  ((f.mode ?? 1) << 8) |
  ((f.dr ?? 4) << 5) |
  ((f.compMode ?? 0) << 4) |
  ((f.compPol ?? 0) << 3) |
  ((f.compLat ?? 0) << 2) |
  (f.que ?? 3)

function rig(supply = 3.3) {
  const beh: Behavior = createAds1115(partDef('ads1115-module'), {})
  const i2c = beh.i2c!
  const volts: Record<string, number> = {
    VDD: supply,
    GND: 0,
    ADDR: 0,
    SDA: supply,
    SCL: supply,
    A0: 0,
    A1: 0,
    A2: 0,
    A3: 0
  }
  let t = 0
  const io: BehaviorIo = {
    get t() {
      return t
    },
    v: (pin) => volts[pin] ?? 0,
    env: {}
  }
  const at = (time: number) => {
    t = time
    beh.update(io)
  }
  const until = (time: number) => {
    while (beh.nextEvent() <= time) at(beh.nextEvent())
    at(time)
  }
  const writeReg = (pointer: number, value: number) =>
    i2c.write([pointer, (value >> 8) & 0xff, value & 0xff])
  const readReg = (pointer: number) => {
    i2c.write([pointer])
    const [msb, lsb] = i2c.read(2)!
    return (msb! << 8) | lsb!
  }
  const readCode = () => {
    const raw = readReg(0)
    return raw & 0x8000 ? raw - 0x10000 : raw
  }
  // Starts a single conversion and waits for it, as `adc.read` does.
  const convert = (f: ConfigFields = {}) => {
    writeReg(1, cfg({ os: 1, ...f }))
    until(t + 1 / RATES[f.dr ?? 4]! + 1e-6)
    return readCode()
  }
  at(0)
  return { beh, i2c, volts, at, until, writeReg, readReg, readCode, convert, now: () => t }
}

describe('ads1115', () => {
  it('powers up with the datasheet register values', () => {
    const r = rig()
    expect(r.readReg(1)).toBe(0x8583)
    expect(r.readReg(2)).toBe(0x8000)
    expect(r.readReg(3)).toBe(0x7fff)
    expect(r.readReg(0)).toBe(0)
  })

  it('answers at 0x48 and returns the pointed register MSB first', () => {
    const r = rig()
    expect(r.i2c.address()).toBe(0x48)
    r.i2c.write([1])
    expect(r.i2c.read(2)).toEqual([0x85, 0x83])
    // A longer read repeats the register.
    expect(r.i2c.read(4)).toEqual([0x85, 0x83, 0x85, 0x83])
  })

  it('takes its address from the net ADDR sits on', () => {
    // Table 7-2: GND 0x48, VDD 0x49, SDA 0x4A, SCL 0x4B.
    const cases: Array<[string, number, Record<string, number>]> = [
      ['GND', 0x48, { ADDR: 0 }],
      ['VDD', 0x49, { ADDR: 3.3 }],
      ['SDA', 0x4a, { ADDR: 2.9, SDA: 2.9 }],
      ['SCL', 0x4b, { ADDR: 2.7, SCL: 2.7 }]
    ]
    for (const [, address, set] of cases) {
      const r = rig()
      Object.assign(r.volts, set)
      r.at(1)
      expect(r.i2c.address()).toBe(address)
      expect(r.beh.view()).toMatchObject({ address })
    }
    // Nothing connected: the board's 10 kOhm pull-down holds ADDR at GND.
    const open = rig()
    open.at(1)
    expect(open.i2c.address()).toBe(0x48)
  })

  it('converts single-shot after 1/DR and reads OS low until then', () => {
    const r = rig()
    r.volts.A0 = 1.024
    r.at(1)
    // OS = 1, MUX = AIN0-GND, PGA = +-4.096 V, single-shot, 128 SPS, comparator off.
    r.writeReg(1, cfg({ mux: 4, pga: 1 }))
    expect(cfg({ mux: 4, pga: 1 })).toBe(0xc383)
    expect(r.beh.nextEvent()).toBeCloseTo(1 + 1 / 128, 9)
    expect(r.readReg(1) & 0x8000).toBe(0) // converting
    expect(r.readReg(0)).toBe(0) // nothing converted yet
    r.until(1 + 1 / 128 + 1e-6)
    expect(r.readReg(1) & 0x8000).toBe(0x8000) // done
    expect(r.readReg(0)).toBe(0x2000) // 1.024 / 4.096 * 32768
    expect(r.beh.nextEvent()).toBe(Infinity)
  })

  it('ignores an OS write while a conversion is running', () => {
    const r = rig()
    r.volts.A0 = 1
    r.at(1)
    r.writeReg(1, cfg({ mux: 4 }))
    const done = r.beh.nextEvent()
    r.at(1.002)
    r.writeReg(1, cfg({ mux: 4 }))
    expect(r.beh.nextEvent()).toBe(done)
  })

  it('scales each PGA range: half of full scale reads 16384', () => {
    FSR.forEach((fsr, pga) => {
      const r = rig(5)
      r.volts.A0 = fsr / 2
      r.at(1)
      expect(r.convert({ mux: 4, pga })).toBe(16384)
    })
    // PGA codes 6 and 7 are +-0.256 V as well.
    for (const pga of [6, 7]) {
      const r = rig()
      r.volts.A0 = 0.128
      r.at(1)
      expect(r.convert({ mux: 4, pga })).toBe(16384)
    }
  })

  it('rounds to the nearest code and clamps at the ends', () => {
    const r = rig(5)
    r.at(1)
    r.volts.A0 = 1.0
    // 1.0 / 2.048 * 32768 = 16000 exactly.
    expect(r.convert({ mux: 4, pga: 2 })).toBe(16000)
    r.volts.A0 = 1.0000306 // 16000.49 codes
    expect(r.convert({ mux: 4, pga: 2 })).toBe(16000)
    r.volts.A0 = 1.0000313 // 16000.5+ codes
    expect(r.convert({ mux: 4, pga: 2 })).toBe(16001)
    r.volts.A0 = 4
    expect(r.convert({ mux: 4, pga: 2 })).toBe(32767)
    r.volts.A0 = 0
    r.volts.A1 = 4
    expect(r.convert({ mux: 0, pga: 2 })).toBe(-32768)
  })

  it('selects the input pair from MUX', () => {
    const r = rig(5)
    Object.assign(r.volts, { A0: 0.1, A1: 0.2, A2: 0.3, A3: 0.4 })
    r.at(1)
    const lsb = 2.048 / 32768
    const code = (v: number) => Math.round(v / lsb)
    // Differential: AIN0-AIN1, AIN0-AIN3, AIN1-AIN3, AIN2-AIN3.
    expect(r.convert({ mux: 0 })).toBe(code(0.1 - 0.2))
    expect(r.convert({ mux: 1 })).toBe(code(0.1 - 0.4))
    expect(r.convert({ mux: 2 })).toBe(code(0.2 - 0.4))
    expect(r.convert({ mux: 3 })).toBe(code(0.3 - 0.4))
    // Single-ended against ground: AIN0..AIN3.
    expect(r.convert({ mux: 4 })).toBe(code(0.1))
    expect(r.convert({ mux: 5 })).toBe(code(0.2))
    expect(r.convert({ mux: 6 })).toBe(code(0.3))
    expect(r.convert({ mux: 7 })).toBe(code(0.4))
  })

  it('measures single-ended inputs against its own ground pin', () => {
    const r = rig(5)
    r.volts.GND = 0.5
    r.volts.A0 = 1.5
    r.at(1)
    expect(r.convert({ mux: 4 })).toBe(Math.round(1 / (2.048 / 32768)))
  })

  it('keeps the previous result in the conversion register until a new one finishes', () => {
    const r = rig()
    r.volts.A0 = 1.024
    r.at(1)
    expect(r.convert({ mux: 4, pga: 1 })).toBe(0x2000)
    r.volts.A0 = 2.048
    r.writeReg(1, cfg({ mux: 4, pga: 1 }))
    expect(r.readCode()).toBe(0x2000)
    r.until(r.now() + 1 / 128 + 1e-6)
    expect(r.readCode()).toBe(0x4000)
  })

  it('converts every 1/DR in continuous mode at each data rate', () => {
    RATES.forEach((sps, dr) => {
      const r = rig()
      r.volts.A0 = 0.5
      r.at(1)
      r.writeReg(1, cfg({ mux: 4, mode: 0, dr }))
      expect(r.beh.nextEvent()).toBeCloseTo(1 + 1 / sps, 9)
      r.until(1 + 1 / sps)
      const first = r.readCode()
      expect(first).toBe(Math.round(0.5 / (2.048 / 32768)))
      expect(r.beh.nextEvent()).toBeCloseTo(1 + 2 / sps, 9)
      r.volts.A0 = 1
      r.until(1 + 2 / sps)
      expect(r.readCode()).toBe(Math.round(1 / (2.048 / 32768)))
    })
  })

  it('catches up after a long gap without looping through every missed conversion', () => {
    const r = rig()
    r.volts.A0 = 0.5
    r.at(1)
    r.writeReg(1, cfg({ mux: 4, mode: 0, dr: 0 }))
    r.at(11)
    expect(r.beh.nextEvent()).toBeGreaterThan(11)
    expect(r.beh.nextEvent()).toBeLessThanOrEqual(11 + 0.125 + 1e-9)
  })

  it('stops converting when switched back to single-shot', () => {
    const r = rig()
    r.at(1)
    r.writeReg(1, cfg({ mux: 4, mode: 0, os: 0 }))
    expect(r.beh.nextEvent()).toBeLessThan(Infinity)
    r.writeReg(1, cfg({ mux: 4, mode: 1, os: 0 }))
    expect(r.beh.nextEvent()).toBe(Infinity)
  })

  it('stores the threshold registers', () => {
    const r = rig()
    r.writeReg(2, 0x1234)
    r.writeReg(3, 0x5678)
    expect(r.readReg(2)).toBe(0x1234)
    expect(r.readReg(3)).toBe(0x5678)
    expect(r.readReg(0)).toBe(0) // the conversion register is read-only
    r.writeReg(0, 0x4321)
    expect(r.readReg(0)).toBe(0)
  })

  describe('comparator', () => {
    // Codes at +-2.048 V: 1 V is 16000.
    const setup = (f: ConfigFields) => {
      const r = rig()
      r.at(1)
      r.writeReg(3, 20000)
      r.writeReg(2, 10000)
      r.writeReg(1, cfg({ mux: 4, mode: 0, que: 0, dr: 7, ...f }))
      const settle = (v: number) => {
        r.volts.A0 = v
        r.until(r.now() + 0.01)
      }
      return { r, settle }
    }
    const low = (r: ReturnType<typeof rig>) => 'ALRT' in r.beh.drives()

    it('asserts above Hi_thresh and releases only below Lo_thresh (traditional, active low)', () => {
      const { r, settle } = setup({})
      settle(0.5)
      expect(low(r)).toBe(false)
      settle(1.5) // 24000 > 20000
      expect(low(r)).toBe(true)
      settle(1.0) // 16000: between the thresholds, stays asserted
      expect(low(r)).toBe(true)
      settle(0.5) // 8000 < 10000
      expect(low(r)).toBe(false)
    })

    it('drives ALRT as an open drain: low to its own ground, otherwise no drive', () => {
      const { r, settle } = setup({})
      settle(1.5)
      expect(r.beh.drives().ALRT).toMatchObject({ ref: 'GND', volts: 0 })
      expect(r.beh.drives().ALRT!.ohms).toBeCloseTo(50, 6)
      expect(Object.keys(r.beh.drives())).toEqual(['ALRT'])
      settle(0.5)
      expect(r.beh.drives()).toEqual({})
    })

    it('flips with active-high polarity: pulled low while not asserted', () => {
      const { r, settle } = setup({ compPol: 1 })
      settle(0.5)
      expect(low(r)).toBe(true)
      settle(1.5)
      expect(low(r)).toBe(false)
    })

    it('asserts outside the window and releases inside it (window mode)', () => {
      const { r, settle } = setup({ compMode: 1 })
      settle(1.0)
      expect(low(r)).toBe(false)
      settle(1.5)
      expect(low(r)).toBe(true)
      settle(1.0)
      expect(low(r)).toBe(false)
      settle(0.2)
      expect(low(r)).toBe(true)
    })

    it('leaves ALRT released while the comparator is disabled (COMP_QUE = 11)', () => {
      const { r, settle } = setup({ que: 3 })
      settle(1.5)
      expect(low(r)).toBe(false)
      expect(r.beh.view()).toMatchObject({ alertLow: false })
    })
  })

  it('has the breakout board resistors: 10 kOhm pull-ups on SDA, SCL, ALRT and a pull-down on ADDR', () => {
    const r = rig()
    r.at(1)
    const loads = r.beh.loads()
    expect(loads).toContainEqual({ a: 'SDA', b: 'VDD', ohms: 10000 })
    expect(loads).toContainEqual({ a: 'SCL', b: 'VDD', ohms: 10000 })
    expect(loads).toContainEqual({ a: 'ALRT', b: 'VDD', ohms: 10000 })
    expect(loads).toContainEqual({ a: 'ADDR', b: 'GND', ohms: 10000 })
  })

  it('draws 150 uA while converting and 0.5 uA in power-down', () => {
    const r = rig(3.3)
    r.at(1)
    const supply = () => r.beh.loads().find((l) => l.a === 'VDD' && l.b === 'GND')!
    expect(supply().ohms).toBeCloseTo(3.3 / 0.5e-6, 3)
    r.writeReg(1, cfg({ mux: 4, mode: 0 }))
    expect(supply().ohms).toBeCloseTo(3.3 / 150e-6, 3)
  })

  it('NACKs, draws nothing and forgets its registers while unpowered', () => {
    const r = rig(0)
    r.at(1)
    expect(r.i2c.address()).toBeNull()
    expect(r.i2c.write([1, 0, 0])).toBe(false)
    expect(r.i2c.read(2)).toBeNull()
    expect(r.beh.drives()).toEqual({})
    expect(r.beh.nextEvent()).toBe(Infinity)
    expect(r.beh.view()).toMatchObject({ powered: false, address: null })
    expect(r.beh.loads().some((l) => l.a === 'VDD' && l.b === 'GND')).toBe(false)
    // The board's resistors are still there.
    expect(r.beh.loads()).toContainEqual({ a: 'SDA', b: 'VDD', ohms: 10000 })

    r.volts.VDD = 3.3
    r.at(2)
    r.writeReg(1, cfg({ mux: 4, mode: 0, pga: 0 }))
    r.writeReg(3, 1234)
    r.volts.VDD = 0
    r.at(3)
    r.volts.VDD = 3.3
    r.at(4)
    expect(r.readReg(1)).toBe(0x8583)
    expect(r.readReg(3)).toBe(0x7fff)
    expect(r.beh.nextEvent()).toBe(Infinity)
  })

  it('is idempotent for repeated updates at one time with the same voltages', () => {
    const r = rig()
    r.volts.A0 = 1
    r.at(1)
    r.writeReg(1, cfg({ mux: 4, mode: 0, que: 0 }))
    r.until(1.02)
    const snapshot = () =>
      JSON.stringify([r.beh.drives(), r.beh.loads(), r.beh.nextEvent(), r.beh.view()])
    const before = snapshot()
    r.at(r.now())
    r.at(r.now())
    expect(snapshot()).toBe(before)
  })
})
