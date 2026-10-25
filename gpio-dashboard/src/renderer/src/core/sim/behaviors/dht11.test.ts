// DHT11 protocol against the Aosong DHT11 Product Manual, section 7 (steps one to four and the end
// signal), and the translated datasheet section 5 (host release wait 20-40 us).
import { describe, expect, it } from 'vitest'
import { partDef } from '../../defs/parts'
import type { Behavior, BehaviorIo, EnvValue } from '../behavior'
import { createDht11 } from './dht11'

const DEFS = [
  { id: 'dht11', vcc: 'VDD' },
  { id: 'dht11-module', vcc: 'VCC' }
]

interface Transition {
  t: number
  high: boolean
}

// Stands in for the circuit: one DATA net with a pull-up to the supply, a host that can pull it
// low, and the loop that re-solves until the behaviour stops changing its drives.
function rig(id: string, vcc: string, supply = 3.3) {
  const beh: Behavior = createDht11(partDef(id), {})
  const env: Record<string, EnvValue> = { temperatureC: 24, humidityPct: 53 }
  const volts: Record<string, number> = { [vcc]: supply, GND: 0, DATA: supply }
  let t = 0
  let hostLow = false
  const line: Transition[] = []
  const io: BehaviorIo = {
    get t() {
      return t
    },
    v: (pin) => volts[pin] ?? 0,
    env
  }
  const level = () => (hostLow || 'DATA' in beh.drives() ? 0.15 : volts[vcc]!)

  const settle = () => {
    for (let i = 0; i < 8; i++) {
      beh.update(io)
      const v = level()
      if (v === volts.DATA) return
      volts.DATA = v
      line.push({ t, high: v > 1 })
    }
    throw new Error('did not settle')
  }
  const at = (time: number) => {
    t = time
    settle()
  }
  const hostStart = (lowMs: number) => {
    hostLow = true
    settle()
    t += lowMs / 1000
    hostLow = false
    settle()
  }
  const runOut = () => {
    while (beh.nextEvent() < Infinity) at(beh.nextEvent())
  }
  settle()
  // One read, as a host driver does it: start, then follow the line to the end.
  const read = (lowMs = 20) => {
    hostStart(lowMs)
    const from = line.length - 1
    runOut()
    return line.slice(from)
  }
  return {
    beh,
    env,
    volts,
    line,
    at,
    hostStart,
    runOut,
    read,
    now: () => t,
    setSupply: (v: number) => (volts[vcc] = v)
  }
}

// frame[0] is the host's release; frame[1] and [2] the response; bit i starts low at
// frame[3 + 2i], goes high at frame[4 + 2i] and ends at frame[5 + 2i].
function decode(frame: Transition[]) {
  expect(frame).toHaveLength(85)
  const bits = Array.from({ length: 40 }, (_, i) =>
    frame[5 + 2 * i]!.t - frame[4 + 2 * i]!.t > 50e-6 ? 1 : 0
  )
  return Array.from({ length: 5 }, (_, b) =>
    bits.slice(b * 8, b * 8 + 8).reduce<number>((acc, bit) => (acc << 1) | bit, 0)
  )
}

describe.each(DEFS)('$id', ({ id, vcc }) => {
  it('answers a start with the datasheet timing and a correct frame', () => {
    const r = rig(id, vcc)
    r.at(1.5)
    r.hostStart(20)
    const release = r.now()
    expect(r.beh.nextEvent()).toBeCloseTo(release + 30e-6, 9) // inside the 20-40 us wait
    const from = r.line.length - 1
    r.runOut()
    const frame = r.line.slice(from)

    const rel = frame.map((e) => ({ high: e.high, t: e.t - release }))
    expect(rel[1]).toMatchObject({ high: false })
    expect(rel[1]!.t).toBeCloseTo(30e-6, 9)
    expect(rel[2]!.t - rel[1]!.t).toBeCloseTo(80e-6, 9) // response low
    expect(rel[3]!.t - rel[2]!.t).toBeCloseTo(80e-6, 9) // response high
    expect(rel[4]!.t - rel[3]!.t).toBeCloseTo(50e-6, 9) // each bit starts 50 us low

    const bytes = decode(frame)
    expect(bytes).toEqual([53, 0, 24, 0, 77])
    // Aosong manual, parity example one: 0x35 + 0x00 + 0x18 + 0x00 = 0x4D.
    expect((bytes[0]! + bytes[1]! + bytes[2]! + bytes[3]!) & 0xff).toBe(bytes[4])

    // 0 bits are high 27 us (middle of 26-28 us), 1 bits 70 us.
    const bits = bytes.flatMap((b) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1))
    bits.forEach((bit, i) => {
      expect(frame[5 + 2 * i]!.t - frame[4 + 2 * i]!.t).toBeCloseTo(bit ? 70e-6 : 27e-6, 9)
    })

    // The last bit is followed by 50 us low, then the sensor lets go.
    expect(frame[84]!.high).toBe(true)
    expect(frame[84]!.t - frame[83]!.t).toBeCloseTo(50e-6, 9)
    expect(r.beh.nextEvent()).toBe(Infinity)
    expect(r.beh.drives()).toEqual({})
  })

  it('pulls DATA low through a low resistance to its own ground and releases with no drive', () => {
    const r = rig(id, vcc)
    r.at(1.5)
    r.hostStart(20)
    r.at(r.beh.nextEvent())
    const d = r.beh.drives()
    expect(Object.keys(d)).toEqual(['DATA'])
    expect(d.DATA).toMatchObject({ ref: 'GND', volts: 0 })
    expect(d.DATA!.ohms).toBeLessThan(500)
    r.at(r.beh.nextEvent())
    expect(r.beh.drives()).toEqual({})
  })

  it('does not answer within the power-up wait, and does after it', () => {
    // Aosong manual, step one: no commands within 1 s of power.
    const r = rig(id, vcc)
    r.at(0)
    r.at(0.5)
    r.hostStart(20)
    expect(r.beh.nextEvent()).toBe(Infinity)
    r.at(1.0)
    r.hostStart(20)
    expect(r.beh.nextEvent()).toBeLessThan(Infinity)
  })

  it('ignores a start that is low for less than 18 ms', () => {
    const r = rig(id, vcc)
    r.at(1.5)
    r.hostStart(10)
    expect(r.beh.nextEvent()).toBe(Infinity)
    r.at(2)
    r.hostStart(18)
    expect(r.beh.nextEvent()).toBeLessThan(Infinity)
  })

  it('repeats the previous reading for a start inside the sampling period', () => {
    const r = rig(id, vcc)
    r.at(1.5)
    expect(decode(r.read())).toEqual([53, 0, 24, 0, 77])
    r.env.temperatureC = 31
    r.env.humidityPct = 40
    r.at(2.5) // one second after the first read: under the 2 s period
    expect(decode(r.read())).toEqual([53, 0, 24, 0, 77])
    r.at(3.6) // more than 2 s after the first sample
    expect(decode(r.read())).toEqual([40, 0, 31, 0, 71])
  })

  it('rounds to the resolution and clamps to the measuring range', () => {
    const r = rig(id, vcc)
    r.at(1.5)
    r.env.temperatureC = 60
    r.env.humidityPct = 95
    expect(decode(r.read()).slice(0, 3)).toEqual([90, 0, 50])
    r.at(4)
    r.env.temperatureC = -5
    r.env.humidityPct = 10
    expect(decode(r.read()).slice(0, 3)).toEqual([20, 0, 0])
    r.at(7)
    r.env.temperatureC = 22.6
    r.env.humidityPct = 44.4
    expect(decode(r.read()).slice(0, 3)).toEqual([44, 0, 23])
  })

  it('is silent and draws nothing while unpowered, and forgets its warm-up when power returns', () => {
    const r = rig(id, vcc, 0)
    r.at(5)
    r.hostStart(20)
    expect(r.beh.nextEvent()).toBe(Infinity)
    expect(r.beh.drives()).toEqual({})
    expect(r.beh.view()).toMatchObject({ powered: false })
    expect(r.beh.loads().some((l) => l.a === vcc && l.b === 'GND')).toBe(false)

    r.setSupply(3.3)
    r.at(10)
    r.hostStart(20) // 0 s after power-up
    expect(r.beh.nextEvent()).toBe(Infinity)
    r.at(11.5)
    expect(decode(r.read())).toEqual([53, 0, 24, 0, 77])
    r.setSupply(0)
    r.at(12)
    expect(r.beh.view()).toMatchObject({ powered: false, temperatureC: null })
  })

  it('draws the datasheet current from its own supply and ground', () => {
    // Aosong manual: 0.3 mA measuring, 60 uA standby; load = supply voltage / current.
    const r = rig(id, vcc)
    r.at(1.5)
    const supplyLoad = () => r.beh.loads().find((l) => l.a === vcc && l.b === 'GND')!
    expect(supplyLoad().ohms).toBeCloseTo(3.3 / 60e-6, 3)
    r.hostStart(20)
    expect(supplyLoad().ohms).toBeCloseTo(3.3 / 0.3e-3, 3)
    r.runOut()
    expect(supplyLoad().ohms).toBeCloseTo(3.3 / 60e-6, 3)
  })

  it('is idempotent for repeated updates at one time with the same voltages', () => {
    const r = rig(id, vcc)
    r.at(1.5)
    r.hostStart(20)
    r.at(r.beh.nextEvent())
    const snapshot = () =>
      JSON.stringify([r.beh.drives(), r.beh.loads(), r.beh.nextEvent(), r.beh.view()])
    const before = snapshot()
    const io: BehaviorIo = {
      t: r.now(),
      v: (pin) => ({ [vcc]: 3.3, GND: 0, DATA: 0.15 })[pin] ?? 0,
      env: r.env
    }
    r.beh.update(io)
    r.beh.update(io)
    expect(snapshot()).toBe(before)
  })
})

describe('on-board pull-up', () => {
  it('is a load from DATA to VCC on the module only', () => {
    // DHT11 module: R1 10 kOhm, S to VCC (part definition provenance notes, SunFounder board photo).
    const module = rig('dht11-module', 'VCC')
    module.at(0)
    expect(module.beh.loads()).toContainEqual({ a: 'DATA', b: 'VCC', ohms: 10000 })
    const bare = rig('dht11', 'VDD')
    bare.at(0)
    expect(bare.beh.loads().filter((l) => l.a === 'DATA')).toEqual([])
  })

  it('stays when the supply is off, as it is a plain resistor', () => {
    const module = rig('dht11-module', 'VCC', 0)
    module.at(0)
    expect(module.beh.loads()).toEqual([{ a: 'DATA', b: 'VCC', ohms: 10000 }])
  })
})
