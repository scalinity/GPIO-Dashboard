// L293D against the TI L293/L293D datasheet (SLRS008D): pin diagram (section 5), recommended
// operating conditions (page 4), electrical characteristics (6.5, page 5) and the function
// table (page 8).
import { describe, expect, it } from 'vitest'
import { PART_DEFS } from '../../defs/parts'
import { createL293d } from './l293d'
import { bench } from './fake-io'
import { pinId } from './pins'

const def = PART_DEFS.get('ic-l293d')!

function setup(vcc1 = 5, vcc2 = 12) {
  const b = bench()
  const model = createL293d(def, {})
  const set = (label: string, volts: number) => {
    b.volts[pinId(def, label)] = volts
  }
  const step = () => model.update(b.io)
  const view = () => model.view() as { powered: boolean; outputs: string[] }
  set('VCC1', vcc1)
  set('VCC2', vcc2)
  step()
  const drive = (label: string) => model.drives()[pinId(def, label)]
  return { b, model, set, step, view, drive }
}

describe('L293D pins', () => {
  it('uses the pin numbers of the datasheet package diagram', () => {
    const numbers = Object.fromEntries(def.pins.map((p) => [p.label, p.id]))
    expect(numbers).toMatchObject({
      '1,2EN': '1',
      '1A': '2',
      '1Y': '3',
      '2Y': '6',
      '2A': '7',
      VCC2: '8',
      '3,4EN': '9',
      '3A': '10',
      '3Y': '11',
      '4Y': '14',
      '4A': '15',
      VCC1: '16'
    })
  })
})

describe('L293D function table (page 8)', () => {
  it('follows A while enabled and floats while the enable is low', () => {
    const t = setup()
    t.set('1,2EN', 5)
    t.set('1A', 5)
    t.set('2A', 0)
    t.step()
    expect(t.drive('1Y')).toBeDefined()
    expect(t.drive('1Y')!.volts).toBeGreaterThan(5)
    expect(t.drive('2Y')!.volts).toBeLessThan(1)
    expect(t.view().outputs).toEqual(['high', 'low', 'z', 'z'])
    t.set('1,2EN', 0)
    t.step()
    expect(t.drive('1Y')).toBeUndefined()
    expect(t.drive('2Y')).toBeUndefined()
  })

  it('shares each enable between its pair of drivers only', () => {
    const t = setup()
    t.set('3,4EN', 5)
    t.set('3A', 5)
    t.set('4A', 5)
    t.step()
    expect(t.view().outputs).toEqual(['z', 'z', 'high', 'high'])
    t.set('3,4EN', 0)
    t.set('1,2EN', 5)
    t.set('1A', 5)
    t.step()
    expect(t.view().outputs).toEqual(['high', 'low', 'z', 'z'])
  })

  it('treats a floating-low enable and input as disabled and low', () => {
    const t = setup()
    expect(t.model.drives()).toEqual({})
    t.set('1,2EN', 5)
    t.step()
    expect(t.view().outputs).toEqual(['low', 'low', 'z', 'z'])
  })
})

describe('L293D output levels (section 6.5, page 5)', () => {
  it('sits the typical drop below VCC2 at 0.6 A, using the typ-to-limit drop as resistance', () => {
    const t = setup(5, 12)
    t.set('1,2EN', 5)
    t.set('1A', 5)
    t.step()
    const high = t.drive('1Y')!
    expect(high.ref).toBe('4')
    // VOH min is VCC2 - 1.8 V and typ VCC2 - 1.4 V at 0.6 A: (1.8 - 1.4) V / 0.6 A = 0.667 ohm.
    expect(high.ohms).toBeCloseTo(0.4 / 0.6, 9)
    expect(high.volts - 0.6 * high.ohms).toBeCloseTo(12 - 1.4, 9)
  })

  it('sits the typical VOL above ground at 0.6 A', () => {
    const t = setup()
    t.set('1,2EN', 5)
    t.step()
    const low = t.drive('1Y')!
    // VOL typ is 1.2 V and max 1.8 V at 0.6 A: (1.8 - 1.2) V / 0.6 A = 1 ohm.
    expect(low.ohms).toBeCloseTo(1, 9)
    expect(low.volts + 0.6 * low.ohms).toBeCloseTo(1.2, 9)
  })

  it('tracks VCC2, the motor supply, not VCC1', () => {
    const t = setup(5, 24)
    t.set('1,2EN', 5)
    t.set('1A', 5)
    t.step()
    const at24 = t.drive('1Y')!.volts
    t.set('VCC2', 9)
    t.step()
    expect(at24 - t.drive('1Y')!.volts).toBeCloseTo(15, 9)
  })

  it('measures everything from the part ground', () => {
    const t = setup(6, 13)
    t.set('GND', 1)
    t.set('1,2EN', 6)
    t.set('1A', 6)
    t.step()
    // 6 V above a 1 V ground is a logic high; the supplies are 5 V and 12 V.
    expect(t.drive('1Y')).toMatchObject({ ref: '4', volts: expect.closeTo(12 - 1, 9) })
  })
})

describe('L293D TTL inputs (page 4)', () => {
  it('switches at VIH 2.3 V and VIL 1.5 V and holds in between', () => {
    const t = setup()
    t.set('1,2EN', 5)
    const outputOf = () => t.view().outputs[0]
    t.set('1A', 2.0)
    t.step()
    expect(outputOf()).toBe('low')
    t.set('1A', 2.3)
    t.step()
    expect(outputOf()).toBe('high')
    t.set('1A', 2.0)
    t.step()
    expect(outputOf()).toBe('high')
    t.set('1A', 1.5)
    t.step()
    expect(outputOf()).toBe('low')
  })
})

describe('L293D supply load (section 6.5, page 5)', () => {
  it('draws the all-high maxima: 22 mA from VCC1 and 24 mA from VCC2', () => {
    const t = setup(5, 12)
    t.set('1,2EN', 5)
    t.set('3,4EN', 5)
    for (const a of ['1A', '2A', '3A', '4A']) t.set(a, 5)
    t.step()
    expect(t.model.loads()).toEqual([
      { a: '16', b: '4', ohms: expect.closeTo(5 / 0.022, 6) },
      { a: '8', b: '4', ohms: expect.closeTo(12 / 0.024, 6) }
    ])
  })

  it('draws the all-low maxima: 60 mA and 6 mA', () => {
    const t = setup(5, 12)
    t.set('1,2EN', 5)
    t.set('3,4EN', 5)
    t.step()
    expect(t.model.loads()).toEqual([
      { a: '16', b: '4', ohms: expect.closeTo(5 / 0.06, 6) },
      { a: '8', b: '4', ohms: expect.closeTo(12 / 0.006, 6) }
    ])
  })

  it('draws the high-impedance maxima: 24 mA and 4 mA', () => {
    const t = setup(5, 12)
    expect(t.model.loads()).toEqual([
      { a: '16', b: '4', ohms: expect.closeTo(5 / 0.024, 6) },
      { a: '8', b: '4', ohms: expect.closeTo(12 / 0.004, 6) }
    ])
  })

  it('takes a quarter of each row per output when the outputs differ', () => {
    const t = setup(5, 12)
    t.set('1,2EN', 5)
    t.set('1A', 5)
    t.step()
    // 1Y high, 2Y low, 3Y and 4Y high impedance.
    const mA = (22 + 60 + 24 + 24) / 4
    expect(t.model.loads()[0]!.ohms).toBeCloseTo(5 / (mA * 1e-3), 6)
  })
})

describe('L293D unpowered', () => {
  it('drives and loads nothing with both supplies off', () => {
    const t = setup(0, 0)
    t.set('1,2EN', 5)
    t.set('1A', 5)
    t.step()
    expect(t.model.drives()).toEqual({})
    expect(t.model.loads()).toEqual([])
    expect(t.view()).toMatchObject({ powered: false, outputs: ['z', 'z', 'z', 'z'] })
  })

  it('floats the outputs below the 4.5 V logic minimum even with a motor supply', () => {
    const t = setup(4.4, 12)
    t.set('1,2EN', 5)
    t.set('1A', 5)
    t.step()
    expect(t.model.drives()).toEqual({})
    expect(t.view()).toMatchObject({ powered: false })
  })

  it('floats the outputs without a motor supply', () => {
    const t = setup(5, 0)
    t.set('1,2EN', 5)
    t.set('1A', 5)
    t.step()
    expect(t.model.drives()).toEqual({})
    expect(t.model.loads()).toEqual([{ a: '16', b: '4', ohms: expect.closeTo(5 / 0.024, 6) }])
  })

  it('has no timers', () => {
    expect(setup().model.nextEvent()).toBe(Infinity)
  })
})

describe('L293D repeated updates', () => {
  it('change nothing at the same time with the same voltages', () => {
    const t = setup()
    t.set('1,2EN', 5)
    t.set('1A', 2.0)
    t.set('2A', 5)
    t.step()
    const snapshot = () =>
      JSON.stringify([t.model.drives(), t.model.loads(), t.view(), t.model.nextEvent()])
    const before = snapshot()
    t.step()
    t.step()
    expect(snapshot()).toBe(before)
  })
})
