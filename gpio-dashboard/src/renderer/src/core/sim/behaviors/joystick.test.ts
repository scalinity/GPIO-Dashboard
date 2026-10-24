// Joystick against the SunFounder schematic and pin notes in the part definition: two potentiometers
// between +5V and GND with wipers VRX and VRY (0 to VCC, half of VCC at rest), and a switch from SW
// to GND with nothing pulling SW up.
import { describe, expect, it } from 'vitest'
import type { EnvValue } from '../behavior'
import { PART_DEFS } from '../../defs/parts'
import { bench } from './fake-io'
import { createJoystick } from './joystick'

const def = PART_DEFS.get('joystick-module')!

function setup(env: Record<string, EnvValue> = { x: 50, y: 50, pressed: false }, vcc = 5) {
  const b = bench(env)
  const model = createJoystick(def, {})
  b.volts['VCC'] = vcc
  model.update(b.io)
  const track = (wiper: string) => {
    const loads = model.loads()
    const up = loads.find((l) => l.a === 'VCC' && l.b === wiper)!.ohms
    const down = loads.find((l) => l.a === wiper && l.b === 'GND')!.ohms
    return { up, down }
  }
  return { b, model, track }
}

describe('joystick axes', () => {
  it('splits a 10 kohm track in half at rest', () => {
    const t = setup()
    expect(t.track('VRX')).toEqual({ up: 5000, down: 5000 })
    expect(t.track('VRY')).toEqual({ up: 5000, down: 5000 })
  })

  it('moves each wiper independently, 0 at GND and 100 at VCC', () => {
    const t = setup({ x: 25, y: 80, pressed: false })
    expect(t.track('VRX')).toEqual({ up: 7500, down: 2500 })
    const y = t.track('VRY')
    expect(y.up).toBeCloseTo(2000, 9)
    expect(y.down).toBeCloseTo(8000, 9)
  })

  it.each([0, 10, 50, 90, 100])('puts the wiper at %i of 100', (position) => {
    const { up, down } = setup({ x: position, y: 50, pressed: false }).track('VRX')
    expect(down / (up + down)).toBeCloseTo(position / 100, 3)
  })

  it('keeps a 1 ohm contact at the end of travel so no load is a short', () => {
    const low = setup({ x: 0, y: 100, pressed: false })
    expect(low.track('VRX')).toEqual({ up: 10000, down: 1 })
    expect(low.track('VRY')).toEqual({ up: 1, down: 10000 })
  })

  it('clamps out-of-range positions and falls back to rest for missing or invalid ones', () => {
    expect(setup({ x: 150, y: -20 }).track('VRX').down).toBe(10000)
    expect(setup({ x: 150, y: -20 }).track('VRY').down).toBe(1)
    expect(setup({}).track('VRX')).toEqual({ up: 5000, down: 5000 })
    expect(setup({ x: Number.NaN, y: 'left' }).track('VRY')).toEqual({ up: 5000, down: 5000 })
  })

  it('follows env as it changes', () => {
    const t = setup()
    t.b.env = { x: 100, y: 50, pressed: false }
    t.model.update(t.b.io)
    expect(t.track('VRX')).toEqual({ up: 1, down: 10000 })
  })
})

describe('joystick button', () => {
  it('leaves SW floating when released', () => {
    const t = setup({ x: 50, y: 50, pressed: false })
    expect(t.model.loads().some((l) => l.a === 'SW' || l.b === 'SW')).toBe(false)
    expect(t.model.view()).toMatchObject({ pressed: false })
  })

  it('joins SW to GND at a 0.1 ohm contact while pressed', () => {
    const t = setup({ x: 50, y: 50, pressed: true })
    expect(t.model.loads()).toContainEqual({ a: 'SW', b: 'GND', ohms: 0.1 })
    expect(t.model.view()).toMatchObject({ pressed: true })
  })

  it('does not treat a non-boolean as a press', () => {
    const t = setup({ x: 50, y: 50, pressed: 'true' })
    expect(t.model.loads().some((l) => l.a === 'SW')).toBe(false)
  })
})

describe('joystick unpowered', () => {
  it('reports unpowered below 3.3 V, drives nothing and keeps its passive tracks', () => {
    const t = setup({ x: 50, y: 50, pressed: true }, 3.2)
    expect(t.model.view()).toMatchObject({ powered: false })
    expect(t.model.drives()).toEqual({})
    expect(t.track('VRX')).toEqual({ up: 5000, down: 5000 })
  })

  it('reports powered from 3.3 V', () => {
    expect(setup(undefined, 3.3).model.view()).toMatchObject({ powered: true })
    expect(setup(undefined, 5).model.view()).toMatchObject({ powered: true, x: 50, y: 50 })
  })

  it('has no timers', () => {
    expect(setup().model.nextEvent()).toBe(Infinity)
  })
})

describe('joystick repeated updates', () => {
  it('change nothing at the same time with the same input', () => {
    const t = setup({ x: 30, y: 70, pressed: true })
    const snapshot = () =>
      JSON.stringify([t.model.drives(), t.model.loads(), t.model.view(), t.model.nextEvent()])
    const before = snapshot()
    t.model.update(t.b.io)
    t.model.update(t.b.io)
    expect(snapshot()).toBe(before)
  })
})
