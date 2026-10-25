// ADC0834 against the TI ADC0831/2/4/8-N datasheet (SNAS531B): pin diagram (Figure 3, page 2),
// electrical characteristics (pages 4 and 5), MUX addressing (Tables 4 and 5, page 14), the
// digital interface (pages 15 and 16) and the ADC0834 timing diagram (Figure 20, page 10). The
// host side follows the usual bit-banged driver: start bit, SGL/DIF, ODD/SIGN and SELECT1, eight
// bits read after each falling clock edge MSB first, then eight more LSB first.
import { describe, expect, it } from 'vitest'
import { PART_DEFS } from '../../defs/parts'
import { createAdc0834 } from './adc0834'
import { bench } from './fake-io'
import { pinId } from './pins'

const def = PART_DEFS.get('ic-adc0834')!

interface Address {
  single: boolean
  odd: boolean
  select1: boolean
}

function setup(vcc = 5, vref = 5) {
  const b = bench()
  const model = createAdc0834(def, {})
  const set = (label: string, volts: number) => {
    b.volts[pinId(def, label)] = volts
  }
  const step = () => model.update(b.io)
  const view = () => model.view() as { powered: boolean; phase: string; result: number | null }
  set('VCC', vcc)
  set('VREF', vref)
  set('CS', vcc)
  step()
  /** 1 or 0 for a driven pin, null for high impedance. */
  const level = (label: string) => {
    const drive = model.drives()[pinId(def, label)]
    return drive ? (drive.volts > 0 ? 1 : 0) : null
  }
  /** One clock period with `di` set up first; reports DO and SARS after each edge. */
  const pulse = (di: number) => {
    set('DI', di ? vcc : 0)
    step()
    set('CLK', vcc)
    step()
    const afterRise = { dout: level('DO'), sars: level('SARS') }
    set('CLK', 0)
    step()
    return { afterRise, dout: level('DO'), sars: level('SARS') }
  }
  const select = (a: Address) => {
    set('CS', 0)
    step()
    pulse(1)
    pulse(a.single ? 1 : 0)
    pulse(a.odd ? 1 : 0)
    return pulse(a.select1 ? 1 : 0)
  }
  /** A whole conversion as the host reads it. */
  const convert = (a: Address) => {
    const leading = select(a)
    let msbFirst = 0
    for (let i = 0; i < 8; i++) msbFirst = (msbFirst << 1) | pulse(0).dout!
    let lsbFirst = 0
    for (let i = 0; i < 8; i++) {
      lsbFirst |= level('DO')! << i
      pulse(0)
    }
    return { leading, msbFirst, lsbFirst }
  }
  return { b, model, set, step, view, level, pulse, select, convert }
}

const CH0: Address = { single: true, odd: false, select1: false }
const volts = (code: number, vref = 5) => (code * vref) / 255

describe('ADC0834 pins', () => {
  it('uses the pin numbers of Figure 3', () => {
    const numbers = Object.fromEntries(def.pins.map((p) => [p.label, p.id]))
    expect(numbers).toMatchObject({
      'V+': '1',
      CS: '2',
      CH0: '3',
      CH1: '4',
      CH2: '5',
      CH3: '6',
      DGND: '7',
      AGND: '8',
      VREF: '9',
      DO: '10',
      SARS: '11',
      CLK: '12',
      DI: '13',
      VCC: '14'
    })
  })
})

describe('ADC0834 serial protocol (Figure 20)', () => {
  it('returns the same code MSB first and LSB first', () => {
    // 168 = 10101000: MSB first reads 1,0,1,0,1,0,0,0 and LSB first 0,0,0,1,0,1,0,1.
    const t = setup()
    t.set('CH0', volts(168))
    const r = t.convert(CH0)
    expect(r.msbFirst).toBe(168)
    expect(r.lsbFirst).toBe(168)
  })

  it('shifts the bits out in the order of the timing diagram', () => {
    const t = setup()
    t.set('CH0', volts(168))
    const bits: (number | null)[] = [t.select(CH0).dout]
    for (let i = 0; i < 17; i++) bits.push(t.pulse(0).dout)
    // The leading zero, D7..D0 on falling edges 5-12, then D1..D7 on 13-19, then low.
    expect(bits.slice(0, 16)).toEqual([0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1])
    expect(bits.slice(16)).toEqual([0, 0])
  })

  it('floats DO until the falling edge after SELECT1, with a leading zero', () => {
    const t = setup()
    t.set('CS', 0)
    t.step()
    expect(t.level('DO')).toBeNull()
    expect(t.pulse(1).dout).toBeNull()
    expect(t.pulse(1).dout).toBeNull()
    expect(t.pulse(0).dout).toBeNull()
    const last = t.pulse(0)
    expect(last.afterRise.dout).toBeNull()
    expect(last.dout).toBe(0)
  })

  it('raises SARS after the MUX settles and drops it half a clock after the conversion', () => {
    const t = setup()
    t.set('CH0', volts(100))
    t.set('CS', 0)
    t.step()
    expect(t.level('SARS')).toBe(0)
    t.pulse(1)
    t.pulse(1)
    t.pulse(0)
    const fourth = t.pulse(0)
    expect(fourth.afterRise.sars).toBe(0)
    expect(fourth.sars).toBe(1)
    // Falling edges 5 to 12 shift out the result; SARS stays high through the 12th.
    for (let edge = 5; edge <= 12; edge++) expect(t.pulse(0).sars).toBe(1)
    const thirteenth = t.pulse(0)
    expect(thirteenth.afterRise.sars).toBe(0)
    expect(thirteenth.sars).toBe(0)
  })

  it('ignores leading zeros before the start bit', () => {
    const t = setup()
    t.set('CH0', volts(77))
    t.set('CS', 0)
    t.step()
    t.pulse(0)
    t.pulse(0)
    t.pulse(0)
    t.pulse(1)
    t.pulse(1)
    t.pulse(0)
    t.pulse(0)
    let code = 0
    for (let i = 0; i < 8; i++) code = (code << 1) | t.pulse(0).dout!
    expect(code).toBe(77)
  })

  it('ignores DI while the result shifts out', () => {
    const t = setup()
    t.set('CH0', volts(200))
    t.select(CH0)
    let code = 0
    for (let i = 0; i < 8; i++) code = (code << 1) | t.pulse(1).dout!
    expect(code).toBe(200)
  })

  it('holds DO low after the LSB-first stream until CS goes high', () => {
    const t = setup()
    t.set('CH0', volts(255))
    t.select(CH0)
    for (let i = 0; i < 15; i++) t.pulse(0)
    for (let i = 0; i < 6; i++) expect(t.pulse(1).dout).toBe(0)
  })

  it('clears on CS high, floats DO and SARS, and needs a new address for the next conversion', () => {
    const t = setup()
    t.set('CH0', volts(90))
    t.select(CH0)
    t.pulse(0)
    t.pulse(0)
    t.set('CS', 5)
    t.step()
    expect(t.level('DO')).toBeNull()
    expect(t.level('SARS')).toBeNull()
    expect(t.view()).toMatchObject({ phase: 'idle', result: null })
    t.set('CH0', volts(31))
    expect(t.convert(CH0)).toMatchObject({ msbFirst: 31, lsbFirst: 31 })
  })

  it('does not clock anything while CS is high', () => {
    const t = setup()
    t.pulse(1)
    t.pulse(1)
    t.pulse(0)
    t.pulse(0)
    expect(t.level('DO')).toBeNull()
    expect(t.view().phase).toBe('idle')
  })
})

describe('ADC0834 MUX addressing (Tables 4 and 5)', () => {
  const inputs = [volts(10), volts(60), volts(130), volts(240)]
  const sources = [
    { odd: false, select1: false, channel: 0 },
    { odd: true, select1: false, channel: 1 },
    { odd: false, select1: true, channel: 2 },
    { odd: true, select1: true, channel: 3 }
  ]

  it.each(sources)('reads single-ended channel $channel', ({ odd, select1, channel }) => {
    const t = setup()
    inputs.forEach((v, i) => t.set(`CH${i}`, v))
    const code = [10, 60, 130, 240][channel]
    expect(t.convert({ single: true, odd, select1 })).toMatchObject({
      msbFirst: code,
      lsbFirst: code
    })
  })

  it('reads a differential pair as positive minus negative and clamps a negative result to 0', () => {
    const t = setup()
    t.set('CH0', 3)
    t.set('CH1', 1)
    t.set('CH2', 4)
    t.set('CH3', 0.5)
    const code = (volts: number) => Math.round((255 * volts) / 5)
    expect(t.convert({ single: false, odd: false, select1: false }).msbFirst).toBe(code(2))
    t.set('CS', 5)
    t.step()
    expect(t.convert({ single: false, odd: true, select1: false }).msbFirst).toBe(0)
    t.set('CS', 5)
    t.step()
    expect(t.convert({ single: false, odd: false, select1: true }).msbFirst).toBe(code(3.5))
    t.set('CS', 5)
    t.step()
    expect(t.convert({ single: false, odd: true, select1: true }).msbFirst).toBe(0)
  })
})

describe('ADC0834 conversion', () => {
  it('rounds 255 * Vin / VREF and clamps to 0..255', () => {
    const t = setup(5, 5)
    t.set('CH0', 2.5)
    expect(t.convert(CH0).msbFirst).toBe(128)
    t.set('CS', 5)
    t.step()
    t.set('CH0', 7)
    expect(t.convert(CH0).msbFirst).toBe(255)
    t.set('CS', 5)
    t.step()
    t.set('CH0', -0.2)
    expect(t.convert(CH0).msbFirst).toBe(0)
  })

  it('scales to VREF', () => {
    const t = setup(5, 2.5)
    t.set('CH0', 1)
    expect(t.convert(CH0).msbFirst).toBe(102)
  })

  it('reads zero while VREF is not above AGND', () => {
    const t = setup(5, 0)
    t.set('CH0', 3)
    expect(t.convert(CH0).msbFirst).toBe(0)
  })

  it('measures analog inputs against AGND', () => {
    const t = setup(5, 5.5)
    t.set('AGND', 0.5)
    t.set('CH0', 3)
    // (3.0 - 0.5) V of a (5.5 - 0.5) V reference is half scale.
    expect(t.convert(CH0).msbFirst).toBe(128)
  })

  it('takes the input once the MUX has settled, not when the address starts', () => {
    const t = setup()
    t.set('CH0', volts(10))
    t.set('CS', 0)
    t.step()
    t.pulse(1)
    t.pulse(1)
    t.pulse(0)
    t.set('CH0', volts(220))
    t.pulse(0)
    let code = 0
    for (let i = 0; i < 8; i++) code = (code << 1) | t.pulse(0).dout!
    expect(code).toBe(220)
    expect(t.view().result).toBe(220)
  })
})

describe('ADC0834 drives and loads (page 5)', () => {
  it('derives output resistance from VOH at -360 uA and VOL at 1.6 mA', () => {
    const t = setup()
    t.set('CH0', volts(255))
    t.select(CH0)
    const high = t.pulse(0)
    expect(high.dout).toBe(1)
    const drives = t.model.drives()
    // (4.75 - 2.4) V / 0.36 mA = 6528 ohm high, 0.4 V / 1.6 mA = 250 ohm low; ref is DGND.
    expect(drives['10']).toEqual({ ref: '7', volts: 5, ohms: expect.closeTo(2.35 / 0.00036, 6) })
    expect(drives['11']).toEqual({ ref: '7', volts: 5, ohms: expect.closeTo(2.35 / 0.00036, 6) })
    t.set('CH0', 0)
    t.set('CS', 5)
    t.step()
    t.select(CH0)
    t.pulse(0)
    expect(t.model.drives()['10']).toEqual({ ref: '7', volts: 0, ohms: expect.closeTo(250, 6) })
  })

  it('reads inputs with TTL thresholds, VIH 2.0 V and VIL 0.8 V', () => {
    const t = setup()
    t.set('CH0', volts(255))
    t.set('CS', 0)
    t.step()
    // 1.5 V is neither level, so DI keeps its previous low and there is no start bit.
    t.set('DI', 1.5)
    t.step()
    t.set('CLK', 5)
    t.step()
    t.set('CLK', 0)
    t.step()
    expect(t.view().phase).toBe('start')
    t.set('DI', 2.0)
    t.step()
    t.set('CLK', 5)
    t.step()
    expect(t.view().phase).toBe('address')
  })

  it('draws the supply current and the reference ladder', () => {
    const t = setup(5, 5)
    // 2.5 mA max ICC from VCC; typical 3.5 kohm from VREF to AGND.
    expect(t.model.loads()).toEqual([
      { a: '14', b: '7', ohms: expect.closeTo(2000, 6) },
      { a: '9', b: '8', ohms: 3500 }
    ])
  })
})

describe('ADC0834 unpowered', () => {
  it('drives and loads nothing below the 4.5 V minimum', () => {
    const t = setup(4.4, 4.4)
    t.set('CS', 0)
    t.step()
    expect(t.model.drives()).toEqual({})
    expect(t.model.loads()).toEqual([])
    expect(t.view()).toMatchObject({ powered: false, phase: 'idle', result: null })
  })

  it('forgets a conversion in progress when the supply drops', () => {
    const t = setup()
    t.set('CH0', volts(100))
    t.select(CH0)
    t.pulse(0)
    t.set('VCC', 0)
    t.step()
    expect(t.model.drives()).toEqual({})
    t.set('VCC', 5)
    t.step()
    expect(t.model.drives()).toEqual({ '11': expect.objectContaining({ volts: 0 }) })
    expect(t.view().phase).toBe('start')
  })

  it('has no timers', () => {
    expect(setup().model.nextEvent()).toBe(Infinity)
  })
})

describe('ADC0834 repeated updates', () => {
  it('change nothing at the same time with the same voltages', () => {
    const t = setup()
    t.set('CH0', volts(168))
    t.select(CH0)
    t.pulse(0)
    t.pulse(0)
    t.set('CLK', 5)
    t.step()
    const snapshot = () =>
      JSON.stringify([t.model.drives(), t.model.loads(), t.model.view(), t.model.nextEvent()])
    const before = snapshot()
    t.step()
    t.step()
    expect(snapshot()).toBe(before)
  })
})
