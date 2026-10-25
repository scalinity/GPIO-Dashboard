// SG90 against the data sheet (https://www.friendlywire.com/projects/ne555-servo-safe/SG90-datasheet.pdf):
// 1.5 ms pulse is the middle, about 2 ms and 1 ms the two ends, 0.1 s per 60 degrees, dead band
// 10 us; currents from servodatabase.com as recorded in sg90.part.json (10 mA idle, 100 mA running).
import { describe, expect, it } from 'vitest'
import { partDef } from '../../defs/parts'
import type { Behavior, BehaviorIo } from '../behavior'
import { createSg90 } from './sg90'

// Stands in for the circuit: a host that drives PWM, and the events the servo asks for.
function rig(supply = 5) {
  const beh: Behavior = createSg90(partDef('sg90'), {})
  const volts: Record<string, number> = { VCC: supply, GND: 0, PWM: 0 }
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
  // Runs the servo's own events up to `time`, then updates there.
  const until = (time: number) => {
    while (beh.nextEvent() <= time) at(beh.nextEvent())
    at(time)
  }
  // One PWM pulse starting at the current time; returns its rising and falling edge times.
  const pulse = (widthUs: number) => {
    const rose = t
    volts.PWM = 3.3
    at(rose)
    until(rose + widthUs * 1e-6)
    volts.PWM = 0
    at(rose + widthUs * 1e-6)
    return { rose, fell: rose + widthUs * 1e-6 }
  }
  // A train of 20 ms frames, as a PWM driver produces.
  const frames = (widthUs: number, count: number) => {
    let last = { rose: t, fell: t }
    for (let i = 0; i < count; i++) {
      const start = t
      last = pulse(widthUs)
      until(start + 0.02)
    }
    return last
  }
  const angle = () => beh.view().angleDeg as number
  at(0)
  return { beh, volts, at, until, pulse, frames, angle, now: () => t }
}

describe('sg90', () => {
  it('maps 1000, 1500 and 2000 us to -90, 0 and +90 degrees', () => {
    for (const [us, deg] of [
      [1000, -90],
      [1500, 0],
      [2000, 90]
    ] as const) {
      const r = rig()
      r.frames(us, 15)
      expect(r.angle()).toBeCloseTo(deg, 6)
      expect(r.beh.view()).toMatchObject({ targetDeg: expect.closeTo(deg, 6), holding: true })
    }
  })

  it('maps pulses in between linearly', () => {
    const r = rig()
    r.frames(1750, 15)
    expect(r.angle()).toBeCloseTo(45, 6)
  })

  it('clamps pulses outside 500-2400 us and stops at the end of travel', () => {
    const r = rig()
    r.frames(300, 15)
    expect(r.beh.view().targetDeg).toBeCloseTo(-90, 6)
    r.frames(3000, 15)
    expect(r.beh.view().targetDeg).toBeCloseTo(90, 6)
    r.frames(2400, 15)
    expect(r.angle()).toBeCloseTo(90, 6)
  })

  it('ignores a change inside the 10 us dead band and follows one outside it', () => {
    const r = rig()
    r.frames(1500, 10)
    r.frames(1508, 3)
    expect(r.beh.view().targetDeg).toBeCloseTo(0, 6)
    r.frames(1495, 3)
    expect(r.beh.view().targetDeg).toBeCloseTo(0, 6)
    r.frames(1520, 3)
    expect(r.beh.view().targetDeg).toBeCloseTo(3.6, 6)
  })

  it('slews at 60 degrees per 0.1 s and asks for its arrival time', () => {
    const r = rig()
    r.frames(1500, 5)
    // 18 degrees at 600 degrees per second is 30 ms, inside the 60 ms the signal is trusted for.
    const { fell } = r.pulse(1600)
    expect(r.beh.nextEvent()).toBeCloseTo(fell + 0.03, 9)
    r.until(fell + 0.015)
    expect(r.angle()).toBeCloseTo(9, 4)
    expect(r.beh.view()).toMatchObject({ moving: true })
    r.until(fell + 0.03)
    expect(r.angle()).toBeCloseTo(18, 9)
    expect(r.beh.view()).toMatchObject({ moving: false })
  })

  it('moves at the same rate through a long move under a steady pulse train', () => {
    const r = rig()
    r.frames(1500, 5)
    const t0 = r.now()
    r.frames(2000, 4)
    // The pulse ended 2 ms into the first frame; the horn has moved ever since.
    expect(r.angle()).toBeCloseTo((r.now() - t0 - 0.002) * 600, 4)
    r.frames(2000, 5)
    expect(r.angle()).toBeCloseTo(90, 9)
  })

  it('retargets from where it is when a new pulse arrives mid-move', () => {
    const r = rig()
    r.frames(1500, 5)
    const t0 = r.now()
    r.frames(2000, 3)
    expect(r.angle()).toBeCloseTo(0.058 * 600, 4)
    const { fell } = r.pulse(1000)
    // 1 ms later it has gone a further 0.6 degrees, then turns around.
    expect(r.angle()).toBeCloseTo(0.059 * 600, 4)
    expect(r.beh.view().targetDeg).toBeCloseTo(-90, 6)
    r.until(t0 + 0.06 + 0.02)
    expect(r.angle()).toBeCloseTo(0.059 * 600 - (t0 + 0.08 - fell) * 600, 4)
  })

  it('draws running current while it moves and idle current when it stops', () => {
    const r = rig(5)
    r.frames(1500, 5)
    const idle = () => r.beh.loads()[0]!.ohms
    expect(idle()).toBeCloseTo(5 / 0.01, 6)
    const { fell } = r.pulse(2000)
    expect(r.beh.loads()).toEqual([{ a: 'VCC', b: 'GND', ohms: expect.closeTo(5 / 0.1, 6) }])
    r.until(fell + 0.15)
    expect(idle()).toBeCloseTo(5 / 0.01, 6)
  })

  it('stops holding after three missed periods and keeps its angle', () => {
    const r = rig()
    r.frames(1500, 5)
    const { rose, fell } = r.pulse(2000)
    // The signal ends here. The servo gives up 3 x 20 ms after the last pulse began, which is
    // 58 ms into a 150 ms move: 34.8 degrees.
    expect(r.beh.nextEvent()).toBeCloseTo(rose + 0.06, 9)
    r.until(fell + 0.02)
    expect(r.beh.view()).toMatchObject({ holding: true })
    r.until(rose + 0.06)
    expect(r.beh.view()).toMatchObject({ holding: false, moving: false })
    expect(r.angle()).toBeCloseTo((0.06 - 0.002) * 600, 6)
    r.until(rose + 1)
    expect(r.angle()).toBeCloseTo(34.8, 6)
    expect(r.beh.nextEvent()).toBe(Infinity)
    expect(r.beh.loads()[0]!.ohms).toBeCloseTo(5 / 0.01, 6)
  })

  it('does not lose the signal while pulses keep coming, and resumes after a gap', () => {
    const r = rig()
    r.frames(1500, 20)
    expect(r.beh.view()).toMatchObject({ holding: true })
    r.until(r.now() + 0.5)
    expect(r.beh.view()).toMatchObject({ holding: false })
    r.frames(1800, 15)
    expect(r.angle()).toBeCloseTo(54, 6)
    expect(r.beh.view()).toMatchObject({ holding: true })
  })

  it('does nothing and draws nothing while unpowered, and keeps its angle through a power cut', () => {
    const r = rig()
    r.frames(2000, 15)
    expect(r.angle()).toBeCloseTo(90, 6)
    r.volts.VCC = 0
    r.at(r.now() + 0.01)
    expect(r.beh.view()).toMatchObject({ powered: false, holding: false })
    expect(r.beh.loads()).toEqual([])
    expect(r.beh.nextEvent()).toBe(Infinity)
    r.frames(1000, 15)
    expect(r.angle()).toBeCloseTo(90, 6)
    r.volts.VCC = 5
    r.at(r.now() + 0.01)
    expect(r.beh.view()).toMatchObject({ powered: true, holding: false })
    r.frames(1000, 16)
    expect(r.angle()).toBeCloseTo(-90, 6)
  })

  it('does not run from 3.3 V', () => {
    const r = rig(3.3)
    r.frames(2000, 15)
    expect(r.beh.view()).toMatchObject({ powered: false })
    expect(r.angle()).toBe(0)
  })

  it('drives no pin', () => {
    const r = rig()
    r.frames(1500, 3)
    expect(r.beh.drives()).toEqual({})
  })

  it('is idempotent for repeated updates at one time with the same voltages', () => {
    const r = rig()
    r.frames(1500, 5)
    const { fell } = r.pulse(2000)
    r.until(fell + 0.05)
    const snapshot = () =>
      JSON.stringify([r.beh.drives(), r.beh.loads(), r.beh.nextEvent(), r.beh.view()])
    const before = snapshot()
    const io: BehaviorIo = { t: r.now(), v: (pin) => r.volts[pin] ?? 0, env: {} }
    r.beh.update(io)
    r.beh.update(io)
    expect(snapshot()).toBe(before)
  })
})
