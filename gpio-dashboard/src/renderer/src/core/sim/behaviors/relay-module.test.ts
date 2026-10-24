// Relay module against the Songle SRD-05VDC-SL-C datasheet values in the part definition: 70 ohm
// coil, pull-in at 75 % (3.75 V), drop-out at 10 % (0.5 V), operate time 10 ms max, release time
// 5 ms max, contact resistance 100 mohm max, and the SunFounder module's S-high-energises polarity.
import { describe, expect, it } from 'vitest'
import { PART_DEFS } from '../../defs/parts'
import { bench } from './fake-io'
import { createRelayModule } from './relay-module'

const def = PART_DEFS.get('relay-module-5v')!

function setup(supply = 5) {
  const b = bench()
  const model = createRelayModule(def, {})
  const set = (pin: string, volts: number) => {
    b.volts[pin] = volts
  }
  const at = (t: number) => {
    b.t = t
    model.update(b.io)
  }
  const view = () =>
    model.view() as { powered: boolean; coilDriven: boolean; energised: boolean; contact: string }
  set('+', supply)
  at(0)
  return { b, model, set, at, view }
}

const contactTo = (t: ReturnType<typeof setup>) => t.model.loads().find((l) => l.a === 'COM')?.b

describe('relay module trigger and timing', () => {
  it('energises 10 ms after S goes high, and not before', () => {
    const t = setup()
    t.set('S', 3.3)
    t.at(1)
    expect(t.view()).toMatchObject({ coilDriven: true, energised: false, contact: 'NC' })
    expect(t.model.nextEvent()).toBeCloseTo(1.01, 9)
    t.at(1.0099)
    expect(contactTo(t)).toBe('NC')
    t.at(1.01)
    expect(t.view()).toMatchObject({ energised: true, contact: 'NO' })
    expect(contactTo(t)).toBe('NO')
    expect(t.model.nextEvent()).toBe(Infinity)
  })

  it('releases 5 ms after S goes low', () => {
    const t = setup()
    t.set('S', 3.3)
    t.at(0)
    t.at(0.01)
    t.set('S', 0)
    t.at(2)
    expect(t.view()).toMatchObject({ coilDriven: false, energised: true })
    expect(t.model.nextEvent()).toBeCloseTo(2.005, 9)
    t.at(2.005)
    expect(t.view()).toMatchObject({ energised: false, contact: 'NC' })
    expect(contactTo(t)).toBe('NC')
  })

  it('does not move for a signal pulse shorter than the operate time', () => {
    const t = setup()
    t.set('S', 3.3)
    t.at(1)
    t.set('S', 0)
    t.at(1.004)
    expect(t.model.nextEvent()).toBe(Infinity)
    t.at(1.02)
    expect(t.view().energised).toBe(false)
  })

  it('keeps the armature when S returns before the release time is over', () => {
    const t = setup()
    t.set('S', 3.3)
    t.at(0)
    t.at(0.01)
    t.set('S', 0)
    t.at(1)
    t.set('S', 3.3)
    t.at(1.002)
    expect(t.model.nextEvent()).toBe(Infinity)
    t.at(1.02)
    expect(t.view().energised).toBe(true)
  })

  it('stays released with S low', () => {
    const t = setup()
    t.set('S', 0)
    t.at(1)
    t.at(5)
    expect(t.view()).toMatchObject({ coilDriven: false, energised: false })
  })

  it('holds S between 0.7 V and 1.5 V at its previous level', () => {
    const t = setup()
    t.set('S', 1)
    t.at(1)
    expect(t.view().coilDriven).toBe(false)
    t.set('S', 3.3)
    t.at(2)
    t.set('S', 1)
    t.at(3)
    expect(t.view().coilDriven).toBe(true)
    t.set('S', 0.7)
    t.at(4)
    expect(t.view().coilDriven).toBe(false)
  })
})

describe('relay module coil voltage', () => {
  it('needs the supply to reach 3.75 V to pull in', () => {
    const low = setup(3.74)
    low.set('S', 3.3)
    low.at(1)
    low.at(2)
    expect(low.view().energised).toBe(false)
    const ok = setup(3.75)
    ok.set('S', 3.3)
    ok.at(1)
    ok.at(1.01)
    expect(ok.view().energised).toBe(true)
  })

  it('holds down to 0.5 V, then drops out', () => {
    const t = setup()
    t.set('S', 3.3)
    t.at(0)
    t.at(0.01)
    t.set('+', 2)
    t.at(1)
    expect(t.view().energised).toBe(true)
    expect(t.model.nextEvent()).toBe(Infinity)
    t.set('+', 0.5)
    t.at(2)
    t.at(2.005)
    expect(t.view().energised).toBe(false)
  })

  it('measures the supply and S against the - pin', () => {
    const t = setup()
    t.set('-', 1)
    t.set('+', 6)
    t.set('S', 4.3)
    t.at(1)
    t.at(1.01)
    expect(t.view().energised).toBe(true)
  })
})

describe('relay module loads', () => {
  it('has no outputs', () => {
    const t = setup()
    t.set('S', 3.3)
    t.at(1)
    expect(t.model.drives()).toEqual({})
  })

  it('draws the 70 ohm coil and the S input while S is high, and nothing while low', () => {
    const t = setup()
    expect(t.model.loads().filter((l) => l.a !== 'COM')).toEqual([])
    t.set('S', 3.3)
    t.at(1)
    expect(t.model.loads()).toEqual(
      expect.arrayContaining([
        { a: '+', b: '-', ohms: 70 },
        { a: 'S', b: '-', ohms: 1000 }
      ])
    )
  })

  it('closes COM to NC at the 0.1 ohm contact maximum when released and to NO when energised', () => {
    const t = setup()
    expect(t.model.loads()).toEqual([{ a: 'COM', b: 'NC', ohms: 0.1 }])
    t.set('S', 3.3)
    t.at(1)
    t.at(1.01)
    expect(t.model.loads().filter((l) => l.a === 'COM')).toEqual([{ a: 'COM', b: 'NO', ohms: 0.1 }])
  })
})

describe('relay module unpowered', () => {
  it('never energises without supply, even with S high', () => {
    const t = setup(0)
    t.set('S', 3.3)
    t.at(1)
    t.at(2)
    expect(t.view()).toMatchObject({ powered: false, energised: false, contact: 'NC' })
    expect(contactTo(t)).toBe('NC')
  })

  it('releases after the release time when the supply is removed', () => {
    const t = setup()
    t.set('S', 3.3)
    t.at(0)
    t.at(0.01)
    expect(t.view().powered).toBe(true)
    t.set('+', 0)
    t.at(1)
    expect(t.view().powered).toBe(false)
    t.at(1.005)
    expect(t.view().energised).toBe(false)
  })
})

describe('relay module repeated updates', () => {
  it('change nothing at the same time with the same voltages', () => {
    const t = setup()
    t.set('S', 3.3)
    t.at(1)
    const snapshot = () =>
      JSON.stringify([t.model.drives(), t.model.loads(), t.model.view(), t.model.nextEvent()])
    const before = snapshot()
    t.at(1)
    t.at(1)
    expect(snapshot()).toBe(before)
    t.at(1.01)
    const energised = snapshot()
    t.at(1.01)
    expect(snapshot()).toBe(energised)
  })
})
