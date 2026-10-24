// ERC against the real part library: the cases the tutorials and assistant evals depend on
// (SPEC 8, 20.6). GPIO24 is header pin 18, at row 9 f-j on the bench placement.
import { describe, expect, it } from 'vitest'
import { partDef } from '../defs/parts'
import type { CircuitDoc, Endpoint } from '../model/types'
import { at, emptyDoc, hole, part, wire } from '../testing/fixtures'
import { erc } from './erc'

const codes = (doc: CircuitDoc, code: string) =>
  erc(doc, partDef)
    .filter((i) => i.code === code)
    .map((i) => `${i.code}:${i.severity}`)
const pin = (p: string, id: string): Endpoint => ({ pin: { part: p, pin: id } })
const module = (id: string, defId: string) => {
  const def = partDef(defId)
  return part(id, defId, Object.fromEntries(def.pins.map((p) => [p.id, null])))
}

describe('ERC with library parts', () => {
  const sonar = (divider: boolean) => {
    const d = emptyDoc()
    d.parts.push(module('U1', 'hc-sr04'))
    d.wires.push(
      wire('W1', at(1, 'i'), pin('U1', 'VCC'), 'dupont-mf'),
      wire('W2', at(5, 'b'), pin('U1', 'GND'), 'dupont-mf')
    )
    if (!divider) d.wires.push(wire('W3', at(9, 'i'), pin('U1', 'ECHO'), 'dupont-mf'))
    else {
      d.parts.push(
        part('R1', 'resistor', { 1: hole(40, 'a'), 2: hole(44, 'a') }, { resistance: 1000 }),
        part('R2', 'resistor', { 1: hole(44, 'c'), 2: hole(48, 'c') }, { resistance: 2000 })
      )
      d.wires.push(
        wire('W3', at(40, 'b'), pin('U1', 'ECHO'), 'dupont-mf'),
        wire('W4', at(44, 'b'), at(9, 'i')),
        wire('W5', at(48, 'b'), at(5, 'c'))
      )
    }
    return d
  }

  it('flags HC-SR04 ECHO wired straight to a GPIO: it drives 5 V into a 3.3 V pin', () => {
    expect(codes(sonar(false), 'OVERVOLTAGE_GPIO')).toEqual(['OVERVOLTAGE_GPIO:error'])
  })

  it('clears once ECHO reaches the GPIO through a divider', () => {
    expect(codes(sonar(true), 'OVERVOLTAGE_GPIO')).toEqual([])
  })

  it('warns when an LCD1602 backpack powered from 5V pulls SDA up to 5 V', () => {
    const lcd = (supplyRow: number, supplyCol: 'i' | 'a') => {
      const d = emptyDoc()
      d.parts.push(module('LCD1', 'lcd1602-i2c'))
      d.wires.push(
        wire('W1', at(supplyRow, supplyCol), pin('LCD1', 'VCC'), 'dupont-mf'),
        wire('W2', at(2, 'a'), pin('LCD1', 'SDA'), 'dupont-mf')
      )
      return d
    }
    expect(codes(lcd(1, 'i'), 'OVERVOLTAGE_GPIO')).toEqual(['OVERVOLTAGE_GPIO:warning'])
    expect(codes(lcd(9, 'a'), 'OVERVOLTAGE_GPIO')).toEqual([])
  })

  it('flags a PN2222 base wired straight to a GPIO', () => {
    const d = emptyDoc()
    d.parts.push(part('Q1', 'pn2222', { 1: hole(40, 'a'), 2: hole(41, 'a'), 3: hole(42, 'a') }))
    d.wires.push(wire('W1', at(6, 'b'), at(41, 'b')))
    expect(codes(d, 'BJT_NO_BASE_RESISTOR')).toEqual(['BJT_NO_BASE_RESISTOR:error'])
  })

  it('lets a servo with a female socket take male-male leads with no gender problem', () => {
    const d = emptyDoc()
    d.parts.push(module('M1', 'sg90'))
    d.wires.push(wire('W1', at(9, 'j'), pin('M1', 'PWM')))
    expect(erc(d, partDef).filter((i) => i.severity === 'error')).toEqual([])
  })
})
