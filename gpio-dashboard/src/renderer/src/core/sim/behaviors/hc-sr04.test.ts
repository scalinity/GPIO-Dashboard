// HC-SR04 against the Elecfreaks datasheet (https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf):
// "IO trigger for at least 10us high level", then "eight 40 kHz" and "raise its echo", with
// "uS / 58 = centimeters", and the 38 ms no-echo pulse from the ITead datasheet page 2
// (https://iarduino.ru/lib/HC-SR04.pdf).
import { describe, expect, it } from 'vitest'
import { partDef } from '../../defs/parts'
import type { Behavior, BehaviorIo, EnvValue } from '../behavior'
import { createHcSr04 } from './hc-sr04'

interface Transition {
  t: number
  high: boolean
}

// Stands in for the circuit: the host drives TRIG, and the module's ECHO is read off its drive.
function rig(supply = 5) {
  const beh: Behavior = createHcSr04(partDef('hc-sr04'), {})
  const env: Record<string, EnvValue> = { distanceCm: 100 }
  const volts: Record<string, number> = { VCC: supply, GND: 0, TRIG: 0, ECHO: 0 }
  let t = 0
  const echo: Transition[] = []
  const io: BehaviorIo = {
    get t() {
      return t
    },
    v: (pin) => volts[pin] ?? 0,
    env
  }
  const settle = () => {
    for (let i = 0; i < 8; i++) {
      beh.update(io)
      const d = beh.drives().ECHO
      const v = d ? d.volts : 0
      if (v === volts.ECHO) return
      volts.ECHO = v
      echo.push({ t, high: v > 1 })
    }
    throw new Error('did not settle')
  }
  const at = (time: number) => {
    t = time
    settle()
  }
  const trigger = (widthUs: number) => {
    volts.TRIG = 3.3
    settle()
    t += widthUs * 1e-6
    volts.TRIG = 0
    settle()
    return t
  }
  const runOut = () => {
    while (beh.nextEvent() < Infinity) at(beh.nextEvent())
  }
  settle()
  return { beh, env, volts, echo, at, trigger, runOut, now: () => t }
}

// What a host driver does with ECHO: time the high phase and divide by 58 us per cm.
const measureCm = (echo: Transition[]) => {
  const rise = echo.find((e) => e.high)!
  const fall = echo.find((e) => !e.high && e.t > rise.t)!
  return { cm: (fall.t - rise.t) / 58e-6, widthS: fall.t - rise.t, start: rise.t }
}

describe('hc-sr04', () => {
  it('raises ECHO after the 8-cycle 40 kHz burst for 58 us per centimetre', () => {
    const r = rig()
    r.at(1)
    const fell = r.trigger(10)
    // 8 cycles at 40 kHz is 200 us after the trigger's falling edge.
    expect(r.beh.nextEvent()).toBeCloseTo(fell + 200e-6, 9)
    r.runOut()
    const m = measureCm(r.echo)
    expect(m.start).toBeCloseTo(fell + 200e-6, 9)
    expect(m.cm).toBeCloseTo(100, 6)
    expect(r.echo).toHaveLength(2)
    expect(r.beh.nextEvent()).toBe(Infinity)
  })

  it('follows the distance in the environment', () => {
    const r = rig()
    r.at(1)
    for (const [i, cm] of [10, 37.5, 250].entries()) {
      r.env.distanceCm = cm
      r.echo.length = 0
      r.at(1 + i)
      r.trigger(10)
      r.runOut()
      expect(measureCm(r.echo).cm).toBeCloseTo(cm, 6)
    }
  })

  it('drives ECHO high at its own VCC level and low at 0 V, relative to its ground', () => {
    const r = rig(5)
    r.at(1)
    expect(r.beh.drives().ECHO).toMatchObject({ ref: 'GND', volts: 0 })
    r.trigger(10)
    r.at(r.beh.nextEvent())
    expect(r.beh.drives().ECHO).toMatchObject({ ref: 'GND', volts: 5 })
    expect(r.beh.view()).toMatchObject({ powered: true, measuring: true, echo: true })
    const sag = rig(4.7)
    sag.at(1)
    sag.trigger(10)
    sag.at(sag.beh.nextEvent())
    expect(sag.beh.drives().ECHO!.volts).toBeCloseTo(4.7, 9)
  })

  it('clamps a near object to the 2 cm minimum range', () => {
    const r = rig()
    r.at(1)
    r.env.distanceCm = 0.5
    r.trigger(10)
    r.runOut()
    expect(measureCm(r.echo).cm).toBeCloseTo(2, 6)
  })

  it('reports 400 cm at the far end of the range and 38 ms beyond it', () => {
    const r = rig()
    r.at(1)
    r.env.distanceCm = 400
    r.trigger(10)
    r.runOut()
    expect(measureCm(r.echo).cm).toBeCloseTo(400, 6)
    r.echo.length = 0
    r.at(2)
    r.env.distanceCm = 450
    r.trigger(10)
    r.runOut()
    expect(measureCm(r.echo).widthS).toBeCloseTo(0.038, 9)
  })

  it('ignores a trigger pulse shorter than 10 us', () => {
    const r = rig()
    r.at(1)
    r.trigger(5)
    expect(r.beh.nextEvent()).toBe(Infinity)
    expect(r.echo).toHaveLength(0)
    r.trigger(10)
    expect(r.beh.nextEvent()).toBeLessThan(Infinity)
  })

  it('starts on the falling edge, not while TRIG is held high', () => {
    const r = rig()
    r.at(1)
    r.volts.TRIG = 3.3
    r.at(1.001)
    expect(r.beh.nextEvent()).toBe(Infinity)
  })

  it('ignores a trigger inside the 60 ms measurement cycle and accepts one after it', () => {
    const r = rig()
    r.at(1)
    const first = r.trigger(10)
    r.runOut()
    r.echo.length = 0
    r.at(first + 0.03)
    r.trigger(10)
    expect(r.beh.nextEvent()).toBe(Infinity)
    expect(r.echo).toHaveLength(0)
    r.at(first + 0.07)
    r.trigger(10)
    expect(r.beh.nextEvent()).toBeLessThan(Infinity)
  })

  it('draws the datasheet working current from its supply and does nothing while unpowered', () => {
    const on = rig(5)
    on.at(1)
    // Working current 15 mA at 5 V.
    expect(on.beh.loads()).toEqual([{ a: 'VCC', b: 'GND', ohms: 5 / 0.015 }])

    // The module is a 5 V part: from 3.3 V it is taken to be off.
    const off = rig(3.3)
    off.at(1)
    off.trigger(10)
    expect(off.beh.nextEvent()).toBe(Infinity)
    expect(off.beh.drives()).toEqual({})
    expect(off.beh.loads()).toEqual([])
    expect(off.beh.view()).toMatchObject({ powered: false })

    const dead = rig(0)
    dead.at(1)
    expect(dead.beh.drives()).toEqual({})
    expect(dead.beh.loads()).toEqual([])
  })

  it('forgets a measurement in progress when the supply drops', () => {
    const r = rig()
    r.at(1)
    r.trigger(10)
    r.volts.VCC = 0
    r.at(1.0001)
    expect(r.beh.nextEvent()).toBe(Infinity)
    expect(r.beh.drives()).toEqual({})
  })

  it('is idempotent for repeated updates at one time with the same voltages', () => {
    const r = rig()
    r.at(1)
    r.trigger(10)
    r.at(r.beh.nextEvent())
    const snapshot = () =>
      JSON.stringify([r.beh.drives(), r.beh.loads(), r.beh.nextEvent(), r.beh.view()])
    const before = snapshot()
    const io: BehaviorIo = { t: r.now(), v: (pin) => r.volts[pin] ?? 0, env: r.env }
    r.beh.update(io)
    r.beh.update(io)
    expect(snapshot()).toBe(before)
  })
})
