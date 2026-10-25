// ADS7830 against TI SBAS302C (https://www.ti.com/lit/ds/symlink/ads7830.pdf): command byte
// SD C2 C1 C0 PD1 PD0 X X (page 13), Table 1 power-down selection, Table 2 channel selection
// (page 14), and the kit's ADCDevice.py
// (https://raw.githubusercontent.com/lafvintech/Basic-Starter-Kit-for-Raspberry-Pi/main/python/ADCDevice.py,
// linked from the kit's Download the Code page), whose ADS7830.analogRead reads with
// cmd = 0x84 | (((chn << 2 | chn >> 1) & 0x07) << 4).
import { describe, expect, it } from 'vitest'
import { partDef } from '../../defs/parts'
import type { Behavior, BehaviorIo } from '../behavior'
import { createAds7830 } from './ads7830'

function rig(supply = 3.3) {
  const beh: Behavior = createAds7830(partDef('ads7830-module'), {})
  const i2c = beh.i2c!
  const volts: Record<string, number> = { VCC: supply, GND: 0 }
  const io: BehaviorIo = { t: 0, v: (pin) => volts[pin] ?? 0, env: {} }
  const update = () => beh.update(io)
  // 0.1 V, 0.2 V ... on A0..A7: every channel distinct.
  for (let i = 0; i < 8; i++) volts[`A${i}`] = (i + 1) * 0.1
  update()
  // i2c.smbus read_byte_data(address, cmd): a write of the command, then a one-byte read.
  const readByteData = (cmd: number) => {
    expect(i2c.write([cmd])).toBe(true)
    return i2c.read(1)![0]!
  }
  return { beh, i2c, volts, update, readByteData }
}

// The kit's Python, parenthesised as written: 0x84 | (((chn<<2 | chn>>1) & 0x07) << 4).
const kitCommand = (chn: number) => 0x84 | ((((chn << 2) | (chn >> 1)) & 0x07) << 4)

describe('ads7830', () => {
  it('answers at the fixed address 0x48', () => {
    const r = rig()
    expect(r.i2c.address()).toBe(0x48)
    expect(r.beh.view()).toMatchObject({ powered: true, address: 0x48 })
  })

  it('acknowledges the kit detectI2C probe, a one-byte write of 0', () => {
    const r = rig()
    expect(r.i2c.write([0])).toBe(true)
    expect(r.i2c.write([])).toBe(true)
  })

  it('selects channels in the non-sequential order of Table 2', () => {
    // SD = 1, C2C1C0 -> CH: 000 CH0, 001 CH2, 010 CH4, 011 CH6, 100 CH1, 101 CH3, 110 CH5, 111 CH7.
    const table = [0, 2, 4, 6, 1, 3, 5, 7]
    const r = rig(3.3)
    table.forEach((channel, bits) => {
      const cmd = 0x80 | (bits << 4) | 0x04 // single-ended, reference off, converter on
      expect(r.readByteData(cmd)).toBe(Math.floor((((channel + 1) * 0.1) / 3.3) * 256))
    })
  })

  it('has the kit command select the channel it asks for', () => {
    const r = rig(3.3)
    // The kit's expression gives these command bytes for chn 0..7 ...
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(kitCommand)).toEqual([
      0x84, 0xc4, 0x94, 0xd4, 0xa4, 0xe4, 0xb4, 0xf4
    ])
    // ... which are single-ended (SD = 1), converter on with the reference off (PD1 PD0 = 01),
    for (let chn = 0; chn < 8; chn++) {
      const cmd = kitCommand(chn)
      expect(cmd & 0x80).toBe(0x80)
      expect(cmd & 0x0c).toBe(0x04)
      // ... and read the intended channel.
      expect(r.readByteData(cmd)).toBe(Math.floor((((chn + 1) * 0.1) / 3.3) * 256))
    }
  })

  it('divides the module supply into 256 steps while the internal reference is off', () => {
    // The kit lesson: the 3.3 V input range in 256 equal parts.
    const r = rig(3.3)
    r.volts.A0 = 1.0
    r.update()
    expect(r.readByteData(0x84)).toBe(Math.floor((1 / 3.3) * 256)) // 77
    const five = rig(5)
    five.volts.A0 = 1.0
    five.update()
    expect(five.readByteData(0x84)).toBe(Math.floor((1 / 5) * 256)) // 51
  })

  it('uses the 2.5 V internal reference while PD1 is set', () => {
    const r = rig(3.3)
    r.volts.A0 = 1.0
    r.update()
    for (const pd of [0b10, 0b11]) {
      expect(r.readByteData(0x80 | (pd << 2))).toBe(Math.floor((1 / 2.5) * 256)) // 102
    }
    // Back to the supply as soon as a command has PD1 clear (SBAS302C, internal reference text).
    expect(r.readByteData(0x84)).toBe(77)
  })

  it('floors rather than rounds, and clamps to 0 and 255', () => {
    const r = rig(3.3)
    // 77.58 steps -> 77; just over 255.99 steps and above -> 255.
    r.volts.A0 = 1.0
    r.update()
    expect(r.readByteData(0x84)).toBe(77)
    r.volts.A0 = 3.3
    r.update()
    expect(r.readByteData(0x84)).toBe(255)
    r.volts.A0 = 3.3 * (255.9 / 256)
    r.update()
    expect(r.readByteData(0x84)).toBe(255)
    r.volts.A0 = 4.5
    r.update()
    expect(r.readByteData(0x84)).toBe(255)
    r.volts.A0 = 0
    r.update()
    expect(r.readByteData(0x84)).toBe(0)
    r.volts.A0 = -0.2
    r.update()
    expect(r.readByteData(0x84)).toBe(0)
  })

  it('measures against its own ground pin', () => {
    const r = rig(3.3)
    r.volts.GND = 0.5
    r.volts.VCC = 3.8
    r.volts.A0 = 1.5
    r.update()
    expect(r.readByteData(0x84)).toBe(Math.floor((1 / 3.3) * 256))
  })

  it('reads differential pairs with the polarity of C2 (SD = 0)', () => {
    // Table 2: 000 CH0+ CH1-, 100 CH0- CH1+, 001 CH2+ CH3-, 111 CH6- CH7+.
    const r = rig(3.3)
    r.volts.A0 = 2
    r.volts.A1 = 0.5
    r.volts.A6 = 0.4
    r.volts.A7 = 1.4
    r.update()
    const diff = (bits: number) => r.readByteData((bits << 4) | 0x04)
    expect(diff(0b000)).toBe(Math.floor((1.5 / 3.3) * 256))
    expect(diff(0b100)).toBe(0) // negative differential reads zero (straight binary)
    expect(diff(0b111)).toBe(Math.floor((1.0 / 3.3) * 256))
    expect(diff(0b011)).toBe(0)
  })

  it('returns one conversion per requested byte and follows the inputs', () => {
    const r = rig(3.3)
    r.i2c.write([0x84])
    const first = r.i2c.read(3)!
    expect(first).toHaveLength(3)
    expect(new Set(first).size).toBe(1)
    r.volts.A0 = 2
    r.update()
    expect(r.i2c.read(1)![0]).toBe(Math.floor((2 / 3.3) * 256))
  })

  it('reads zero before any command', () => {
    const r = rig()
    expect(r.i2c.read(2)).toEqual([0, 0])
  })

  it('draws the datasheet quiescent current from its supply and has no I2C pull-ups', () => {
    // SBAS302C: 60 uA at 2.7-3.6 V, 150 uA at 4.75-5.25 V (100 kHz). The module's pull-ups are
    // not documented (i2cPullupVerified is false), so there are none.
    const low = rig(3.3).beh.loads()
    expect(low).toHaveLength(1)
    expect(low[0]).toMatchObject({ a: 'VCC', b: 'GND' })
    expect(low[0]!.ohms).toBeCloseTo(3.3 / 60e-6, 3)
    const high = rig(5).beh.loads()
    expect(high[0]!.ohms).toBeCloseTo(5 / 150e-6, 3)
  })

  it('NACKs, draws nothing and drops its command while unpowered', () => {
    const r = rig(0)
    expect(r.i2c.address()).toBeNull()
    expect(r.i2c.write([0x84])).toBe(false)
    expect(r.i2c.read(1)).toBeNull()
    expect(r.beh.view()).toMatchObject({ powered: false, address: null })
    expect(r.beh.loads()).toEqual([])
    expect(r.beh.drives()).toEqual({})
    expect(r.beh.nextEvent()).toBe(Infinity)

    const cycled = rig(3.3)
    cycled.i2c.write([0x84])
    cycled.volts.VCC = 0
    cycled.update()
    cycled.volts.VCC = 3.3
    cycled.update()
    expect(cycled.beh.view()).toMatchObject({ command: null })
  })

  it('does not run below its supply minimum', () => {
    const r = rig(2.0)
    expect(r.i2c.address()).toBeNull()
  })

  it('is idempotent for repeated updates with the same voltages', () => {
    const r = rig()
    r.i2c.write([0x84])
    const snapshot = () =>
      JSON.stringify([
        r.beh.drives(),
        r.beh.loads(),
        r.beh.nextEvent(),
        r.beh.view(),
        r.i2c.read(1)
      ])
    const before = snapshot()
    r.update()
    r.update()
    expect(snapshot()).toBe(before)
  })
})
