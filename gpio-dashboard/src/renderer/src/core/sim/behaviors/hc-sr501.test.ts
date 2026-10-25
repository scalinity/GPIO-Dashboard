// HC-SR501 against the ElecFreaks specification and its copies listed in the part definition:
// 4.5-20 V supply, 3.3 V / 0 V output, delay 5-200 s (shortest by default), 2.5 s block time,
// about one minute of start-up, jumper H = repeatable trigger and L = non-repeatable.
import { describe, expect, it } from 'vitest'
import type { EnvValue } from '../behavior'
import { PART_DEFS } from '../../defs/parts'
import { bench } from './fake-io'
import { createHcSr501 } from './hc-sr501'

const def = PART_DEFS.get('hc-sr501')!

function setup(vcc = 5, extra: Record<string, EnvValue> = {}) {
  const b = bench()
  const model = createHcSr501(def, {})
  b.volts['VCC'] = vcc
  const at = (t: number, motion = false) => {
    b.t = t
    b.env = { motion, ...extra }
    model.update(b.io)
  }
  const view = () =>
    model.view() as { powered: boolean; initialising: boolean; out: boolean; blocked: boolean }
  /** The level OUT is driven to, or null when it is not driven. */
  const out = () => {
    const drive = model.drives()['OUT']
    return drive ? drive.volts : null
  }
  at(0)
  return { b, model, at, view, out }
}

describe('HC-SR501 start-up', () => {
  it('holds OUT low for a minute and ignores motion meanwhile', () => {
    const t = setup()
    expect(t.view()).toMatchObject({ powered: true, initialising: true, out: false })
    expect(t.model.nextEvent()).toBe(60)
    t.at(1, true)
    t.at(59.9, true)
    expect(t.out()).toBe(0)
    expect(t.model.nextEvent()).toBe(60)
  })

  it('accepts motion from the end of the minute', () => {
    const t = setup()
    t.at(10, true)
    t.at(60, true)
    expect(t.view()).toMatchObject({ initialising: false, out: true })
    expect(t.out()).toBe(3.3)
  })

  it('counts the minute from when the supply became valid', () => {
    const t = setup(0)
    t.at(5)
    expect(t.view().powered).toBe(false)
    t.b.volts['VCC'] = 5
    t.at(10)
    t.at(69.9, true)
    expect(t.out()).toBe(0)
    t.at(70, true)
    expect(t.out()).toBe(3.3)
  })
})

describe('HC-SR501 repeatable trigger (jumper H, the default)', () => {
  it('goes high on motion and holds for the 5 s delay after the last movement', () => {
    const t = setup()
    t.at(61, true)
    expect(t.out()).toBe(3.3)
    expect(t.model.nextEvent()).toBe(66)
    t.at(62)
    expect(t.model.nextEvent()).toBe(67)
    t.at(66.9)
    expect(t.out()).toBe(3.3)
    t.at(67)
    expect(t.out()).toBe(0)
  })

  it('restarts the delay on each movement and counts it from the last one', () => {
    const t = setup()
    t.at(61, true)
    t.at(63, true)
    expect(t.model.nextEvent()).toBe(68)
    t.at(64)
    expect(t.model.nextEvent()).toBe(69)
    t.at(68.9)
    expect(t.out()).toBe(3.3)
    t.at(69)
    expect(t.out()).toBe(0)
  })

  it('stays high while motion continues past the delay', () => {
    const t = setup()
    t.at(61, true)
    t.at(66, true)
    expect(t.out()).toBe(3.3)
    expect(t.model.nextEvent()).toBe(71)
    t.at(71, true)
    expect(t.out()).toBe(3.3)
  })

  it('ignores motion for 2.5 s after OUT falls, then accepts it', () => {
    const t = setup()
    t.at(61, true)
    t.at(62)
    t.at(67)
    expect(t.view()).toMatchObject({ out: false, blocked: true })
    expect(t.model.nextEvent()).toBe(69.5)
    t.at(68, true)
    expect(t.out()).toBe(0)
    t.at(69.4, true)
    expect(t.out()).toBe(0)
    t.at(69.5, true)
    expect(t.out()).toBe(3.3)
    expect(t.view().blocked).toBe(false)
  })

  it('times the block from when OUT fell even if the update arrives late', () => {
    const t = setup()
    t.at(61, true)
    t.at(62)
    // OUT fell at 67; an update at 69 is 2 s late, and the block still ends at 69.5.
    t.at(69)
    expect(t.view()).toMatchObject({ out: false, blocked: true })
    t.at(69.6, true)
    expect(t.out()).toBe(3.3)
  })
})

describe('HC-SR501 non-repeatable trigger (jumper L)', () => {
  it('drops OUT after the delay even while motion continues, then blocks, then retriggers', () => {
    const t = setup(5, { trigger: 'L' })
    t.at(61, true)
    t.at(63, true)
    t.at(65, true)
    expect(t.model.nextEvent()).toBe(66)
    t.at(66, true)
    expect(t.out()).toBe(0)
    expect(t.model.nextEvent()).toBe(68.5)
    t.at(68.5, true)
    expect(t.out()).toBe(3.3)
    expect(t.model.nextEvent()).toBe(73.5)
  })

  it('does not extend the hold when motion stops and starts again', () => {
    const t = setup(5, { trigger: 'L' })
    t.at(61, true)
    t.at(62)
    t.at(63, true)
    expect(t.model.nextEvent()).toBe(66)
  })
})

describe('HC-SR501 delay setting', () => {
  const holdEnd = (delayS: number) => {
    const t = setup(5, { delayS })
    t.at(61, true)
    return t.model.nextEvent()
  }

  it('holds for env.delayS, limited to the 5 s to 200 s of the potentiometer', () => {
    expect(holdEnd(30)).toBe(91)
    expect(holdEnd(1)).toBe(66)
    expect(holdEnd(500)).toBe(261)
  })
})

describe('HC-SR501 output and supply load', () => {
  it('drives OUT 3.3 V or 0 V above GND through the BISS0001 output resistance', () => {
    const t = setup()
    // (5 - 4) V at 0.5 mA high and 0.4 V at 0.1 mA low.
    expect(t.model.drives()).toEqual({
      OUT: { ref: 'GND', volts: 0, ohms: expect.closeTo(4000, 6) }
    })
    t.at(61, true)
    expect(t.model.drives()).toEqual({
      OUT: { ref: 'GND', volts: 3.3, ohms: expect.closeTo(2000, 6) }
    })
  })

  it('measures its supply against its own GND pin and draws 50 uA at most', () => {
    const t = setup()
    t.b.volts['GND'] = 1
    t.b.volts['VCC'] = 6
    t.at(1)
    expect(t.model.loads()).toEqual([{ a: 'VCC', b: 'GND', ohms: expect.closeTo(100_000, 6) }])
  })

  it('treats a motion value that is not a boolean as no motion', () => {
    const t = setup()
    t.at(61, 'yes' as unknown as boolean)
    expect(t.out()).toBe(0)
  })
})

describe('HC-SR501 unpowered', () => {
  it('drives and loads nothing below 4.5 V', () => {
    const t = setup(4.4)
    t.at(100, true)
    expect(t.model.drives()).toEqual({})
    expect(t.model.loads()).toEqual([])
    expect(t.model.nextEvent()).toBe(Infinity)
    expect(t.view()).toMatchObject({ powered: false, out: false })
  })

  it('starts over with a new minute of start-up after a power loss', () => {
    const t = setup()
    t.at(61, true)
    expect(t.out()).toBe(3.3)
    t.b.volts['VCC'] = 0
    t.at(62, true)
    expect(t.model.drives()).toEqual({})
    t.b.volts['VCC'] = 5
    t.at(100, true)
    expect(t.view()).toMatchObject({ powered: true, initialising: true, out: false })
    expect(t.out()).toBe(0)
    t.at(159.9, true)
    expect(t.out()).toBe(0)
    t.at(160, true)
    expect(t.out()).toBe(3.3)
  })
})

describe('HC-SR501 repeated updates', () => {
  it('change nothing at the same time with the same input', () => {
    const t = setup()
    t.at(61, true)
    t.at(63, true)
    t.at(64)
    const snapshot = () =>
      JSON.stringify([t.model.drives(), t.model.loads(), t.model.view(), t.model.nextEvent()])
    const before = snapshot()
    t.at(64)
    t.at(64)
    expect(snapshot()).toBe(before)
    t.at(69)
    const low = snapshot()
    t.at(69)
    expect(snapshot()).toBe(low)
  })
})
