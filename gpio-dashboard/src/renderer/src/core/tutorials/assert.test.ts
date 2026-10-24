// The assertion runner's I2C path: devices answer only when their SDA/SCL reach GPIO2/3.
// Bench strips: 3V3 row 1 a-e, GPIO2 (SDA) row 2 a-e, GPIO3 (SCL) row 3 a-e, GND row 5 a-e.
import { describe, expect, it } from 'vitest'
import { partDef } from '../defs/parts'
import { at, emptyDoc, hole, part, wire } from '../testing/fixtures'
import { runAssertion } from './assert'
import { AssertionSchema } from './tutorial'

function adc(withSda: boolean) {
  const d = emptyDoc()
  const pins = Object.fromEntries(partDef('ads7830-module').pins.map((p) => [p.id, null]))
  const pin = (id: string) => ({ pin: { part: 'U1', pin: id } })
  // A 10 kΩ / 10 kΩ divider from 3V3 puts 1.65 V on A0.
  d.parts.push(
    part('U1', 'ads7830-module', pins),
    part('R1', 'resistor', { 1: hole(30, 'b'), 2: hole(34, 'b') }, { resistance: 10_000 }),
    part('R2', 'resistor', { 1: hole(34, 'c'), 2: hole(38, 'c') }, { resistance: 10_000 })
  )
  d.wires.push(
    wire('W1', at(1, 'a'), at(30, 'a')),
    wire('W2', at(38, 'a'), at(5, 'a')),
    wire('W3', at(34, 'a'), pin('A0'), 'dupont-mf'),
    wire('W4', at(1, 'b'), pin('VCC'), 'dupont-mf'),
    wire('W5', at(5, 'b'), pin('GND'), 'dupont-mf'),
    wire('W6', at(3, 'a'), pin('SCL'), 'dupont-mf')
  )
  if (withSda) d.wires.push(wire('W7', at(2, 'a'), pin('SDA'), 'dupont-mf'))
  return d
}

// The kit's ADCDevice.py selects channel 0 with command 0x84, then reads one byte.
const read = AssertionSchema.parse({
  name: 'A0 reads half scale',
  sequence: [{ i2c: [{ address: 0x48, write: [0x84] }] }],
  expect: [{ i2cRead: 0x48, bytes: [{ min: 127, max: 129 }] }]
})

describe('I2C assertions', () => {
  it('read the ADS7830 on the bus: 1.65 V of a 3.3 V full scale is 128', () => {
    expect(runAssertion(adc(true), partDef, read)).toEqual([])
  })

  it('get no answer when SDA is not wired to GPIO2', () => {
    expect(runAssertion(adc(false), partDef, read)).toEqual([
      'I2C write to 0x48 was not acknowledged',
      'I2C read from 0x48 was not acknowledged'
    ])
  })
})
