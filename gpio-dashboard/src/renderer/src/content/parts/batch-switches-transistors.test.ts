// Datasheet facts for the switch, transistor, buzzer, motor, relay and power-module definitions.
// Each assertion cites the datasheet page or figure it was read from; the part files' provenance
// notes carry the full source list and every conflict between sources.
import { describe, expect, it } from 'vitest'
import { loadPartDef } from '../../core/defs/parts'
import type { PartDef } from '../../core/model/types'
import activeBuzzerRaw from './active-buzzer.part.json'
import powerModuleRaw from './breadboard-power-module.part.json'
import dcMotorRaw from './dc-motor.part.json'
import passiveBuzzerRaw from './passive-buzzer.part.json'
import pn2222Raw from './pn2222.part.json'
import relayRaw from './relay-module-5v.part.json'
import s8050Raw from './s8050.part.json'
import s8550Raw from './s8550.part.json'
import tactRaw from './tact-switch-6mm.part.json'
import tiltRaw from './tilt-switch.part.json'

function load(id: string, raw: unknown): PartDef {
  return loadPartDef(`../../content/parts/${id}.part.json`, raw)
}

const tact = load('tact-switch-6mm', tactRaw)
const tilt = load('tilt-switch', tiltRaw)
const pn2222 = load('pn2222', pn2222Raw)
const s8050 = load('s8050', s8050Raw)
const s8550 = load('s8550', s8550Raw)
const activeBuzzer = load('active-buzzer', activeBuzzerRaw)
const passiveBuzzer = load('passive-buzzer', passiveBuzzerRaw)
const dcMotor = load('dc-motor', dcMotorRaw)
const relay = load('relay-module-5v', relayRaw)
const power = load('breadboard-power-module', powerModuleRaw)

const offsets = (def: PartDef): Record<string, readonly [number, number]> =>
  Object.fromEntries(def.pins.map((p) => [p.id, p.offsetPitch]))

describe('kit membership (SunFounder Basic Starter Kit component list image)', () => {
  it.each([
    { id: 'tact-switch-6mm', def: tact, entry: 'Button x5' },
    { id: 'tilt-switch', def: tilt, entry: 'Tilt Switch x1' },
    { id: 'pn2222', def: pn2222, entry: 'PN2222 x2' },
    { id: 'active-buzzer', def: activeBuzzer, entry: 'Active Buzzer x1' },
    { id: 'passive-buzzer', def: passiveBuzzer, entry: 'Passive Buzzer x1' },
    { id: 'dc-motor', def: dcMotor, entry: 'Motor & Fan x1' },
    { id: 'relay-module-5v', def: relay, entry: 'Relay Module x1' },
    { id: 'breadboard-power-module', def: power, entry: 'Power Supply Module x1' }
  ])('tags $id as in the kit (list entry "$entry")', ({ def }) => {
    expect(def.kitTags).toEqual(['kit'])
  })

  it('tags S8050 and S8550 as not in the kit, which ships PN2222 instead', () => {
    expect(s8050.kitTags).toEqual(['not in kit'])
    expect(s8550.kitTags).toEqual(['not in kit'])
  })
})

describe('6 mm tactile switch (Omron B3F datasheet, page 4, B3F-1000 drawing)', () => {
  it('numbers its four terminals 1 to 4 like the Omron terminal arrangement', () => {
    expect(tact.pins.map((p) => p.id)).toEqual(['1', '2', '3', '4'])
    expect(tact.pins.every((p) => p.role === 'switch')).toBe(true)
  })

  it('joins 1-2 and 3-4 internally: the terminal pairs 6.5 mm apart are the always-connected ones', () => {
    // Internal Connections (Top View): 4-3 and 2-1 are bused, the switch bridges the two buses.
    expect(tact.internalConnections).toEqual([
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('is a rigid part that straddles the trench, as SunFounder seats it in the Button project', () => {
    // SunFounder 2.1.1 Fritzing diagram: columns e and f, two rows apart.
    expect(tact.footprint).toEqual({ kind: 'rigid', straddleTrench: true })
  })

  it('puts the 6.5 mm axis across the trench (3 pitches) and the 4.5 mm axis along the rows (2 pitches)', () => {
    // PCB Processing Dimensions: 6.5 +/-0.1 x 4.5 +/-0.1 mm; 7.62 mm is e to f, 5.08 mm is 2 rows.
    expect(offsets(tact)).toEqual({ '1': [0, 0], '2': [0, 3], '3': [2, 0], '4': [2, 3] })
  })

  it('lands each joined pair in a single row, one terminal on each side of the trench', () => {
    const [p1, p2, p3, p4] = tact.pins.map((p) => p.offsetPitch)
    expect(p1?.[0]).toBe(p2?.[0])
    expect(p3?.[0]).toBe(p4?.[0])
    expect(Math.abs((p1?.[1] ?? 0) - (p2?.[1] ?? 0))).toBe(3)
    expect(Math.abs((p3?.[0] ?? 0) - (p1?.[0] ?? 0))).toBe(2)
  })

  it('records the datasheet hole pattern, body size and height', () => {
    expect(tact.geometry).toMatchObject({
      family: 'tact-switch',
      params: { terminalPitchLongMm: 6.5, terminalPitchShortMm: 4.5, bodyWidthMm: 6, heightMm: 4.3 }
    })
    expect(tact.bodyMm).toEqual([6, 6, 4.3])
  })

  it('takes contact resistance and bounce from Omron page 2 and the rating from Multicomp MCDTS6', () => {
    // Omron: contact resistance 100 mOhm max, bounce 5 ms max; Multicomp: 50 mA 12 VDC.
    expect(tact.sim.model).toBe('tact-switch')
    expect(tact.sim.params).toMatchObject({
      contactMaxOhm: 0.1,
      bounceMaxMs: 5,
      ratedMaxV: 12,
      ratedMaxMa: 50
    })
  })

  it('offers a momentary or retained mode, momentary by default', () => {
    expect(tact.properties.mode).toEqual({
      type: 'enum',
      label: 'Mode',
      options: ['momentary', 'retain'],
      default: 'momentary'
    })
  })
})

describe('ball tilt switch (Bailin SW-520D datasheet)', () => {
  it('has two unpolarised leads and no internal connection', () => {
    expect(tilt.pins.map((p) => p.id)).toEqual(['1', '2'])
    expect(tilt.internalConnections).toEqual([])
  })

  it('is rigid with its leads one pitch apart, matching the 2.4 mm lead spacing on page 2', () => {
    expect(tilt.footprint).toEqual({ kind: 'rigid' })
    expect(offsets(tilt)).toEqual({ '1': [0, 0], '2': [1, 0] })
    expect(tilt.geometry).toMatchObject({ params: { leadSpacingMm: 2.4, leadDiaMm: 0.6 } })
  })

  it('takes body size from the page 2 drawing: 5.2 mm diameter, 11.5 mm long', () => {
    expect(tilt.bodyMm).toEqual([5.2, 5.2, 11.5])
  })

  it('takes 12 V, under 10 ohm closed and over 10 Mohm open from the datasheet, and 5 mA from the 100y sheet', () => {
    expect(tilt.sim.model).toBe('tilt-switch')
    expect(tilt.sim.params).toMatchObject({
      ratedMaxV: 12,
      contactMaxOhm: 10,
      insulationMinOhm: 10_000_000,
      maxCurrentMa: 5
    })
  })

  it('is closed when upright and opens when the tilted property is set', () => {
    expect(tilt.properties.tilted).toMatchObject({ type: 'boolean', default: false })
  })
})

describe('PN2222A (onsemi/Fairchild PN2222A datasheet rev 1.1.0, July 2014)', () => {
  it('lists the TO-92 pins as emitter, base, collector (figure "E B C", package drawing note)', () => {
    expect(pn2222.pins.map((p) => [p.id, p.role])).toEqual([
      ['1', 'emitter'],
      ['2', 'base'],
      ['3', 'collector']
    ])
    expect(offsets(pn2222)).toEqual({ '1': [0, 0], '2': [1, 0], '3': [2, 0] })
    expect(pn2222.footprint).toEqual({ kind: 'rigid' })
  })

  it('is an NPN with the datasheet gain, saturation voltages and limits', () => {
    // On Characteristics: hFE 100-300 at 150 mA/10 V; VCE(sat) 0.3 V at 150/15 mA; VBE(sat) 0.6-1.2 V.
    expect(pn2222.sim.model).toBe('npn')
    expect(pn2222.sim.params).toMatchObject({
      hfeMin: 100,
      hfeMax: 300,
      hfeTestIcMa: 150,
      vceSatMaxV: 0.3,
      vbeSatMinV: 0.6,
      vbeSatMaxV: 1.2,
      vceoV: 40,
      pdMaxW: 0.625
    })
  })

  it('uses the lower 600 mA collector current where sheets disagree with the 1.0 A absolute maximum', () => {
    expect(pn2222.sim.params.icMaxMa).toBe(600)
    expect(pn2222.provenance.notes).toContain('1.0 A')
  })

  it('takes body size from the package drawing maxima', () => {
    expect(pn2222.bodyMm).toEqual([5.2, 4.19, 5.33])
  })
})

describe('S8050 and S8550 (MCC datasheets) and the TO-92 pin-order conflict', () => {
  it('lists S8050 pins as emitter, base, collector, the order MCC, JSCJ, UTC and LGE give', () => {
    expect(s8050.pins.map((p) => [p.id, p.role])).toEqual([
      ['1', 'emitter'],
      ['2', 'base'],
      ['3', 'collector']
    ])
    expect(offsets(s8050)).toEqual({ '1': [0, 0], '2': [1, 0], '3': [2, 0] })
  })

  it('lists S8550 pins as emitter, base, collector, the order MCC, onsemi and UTC give', () => {
    expect(s8550.pins.map((p) => [p.id, p.role])).toEqual([
      ['1', 'emitter'],
      ['2', 'base'],
      ['3', 'collector']
    ])
    expect(offsets(s8550)).toEqual({ '1': [0, 0], '2': [1, 0], '3': [2, 0] })
  })

  it('records the reversed collector-base-emitter order of the Foshan Blue Rocket parts in both notes', () => {
    for (const def of [s8050, s8550]) {
      expect(def.provenance.notes).toContain('Blue Rocket')
      expect(def.provenance.notes).toContain('PIN ORDER CONFLICT')
    }
  })

  it('models S8050 as an NPN with the MCC gain, saturation voltages and limits', () => {
    // MCC S8050: hFE(1) 85-300 at 50 mA/1 V; hFE(2) >= 50 at 500 mA; VCE(sat) <= 0.6 V; IC 500 mA.
    expect(s8050.sim.model).toBe('npn')
    expect(s8050.sim.params).toMatchObject({
      hfeMin: 85,
      hfeMax: 300,
      hfeAt500MaMin: 50,
      vceSatMaxV: 0.6,
      vbeSatMaxV: 1.2,
      icMaxMa: 500,
      vceoV: 25,
      vcboV: 40,
      pdMaxW: 0.625
    })
  })

  it('models S8550 as a PNP with the MCC gain, saturation voltages and limits', () => {
    // MCC S8550 rev D: hFE(1) 85-300 at 50 mA/1 V; hFE(2) >= 40 at 500 mA; VCE(sat) <= 0.6 V.
    expect(s8550.sim.model).toBe('pnp')
    expect(s8550.sim.params).toMatchObject({
      hfeMin: 85,
      hfeMax: 300,
      hfeAt500MaMin: 40,
      vceSatMaxV: 0.6,
      vbeSatMaxV: 1.2,
      icMaxMa: 500,
      vceoV: 25,
      vcboV: 40,
      pdMaxW: 0.625
    })
  })

  it('carries the hFE rank ranges B 85-150, C 120-200, D 160-300 on both parts', () => {
    for (const def of [s8050, s8550]) {
      expect(def.sim.params).toMatchObject({
        hfeClassB: '85-150',
        hfeClassC: '120-200',
        hfeClassD: '160-300'
      })
    }
  })
})

describe('12 mm buzzers', () => {
  it('seats the active buzzer 3 pitches apart for the 7.6 mm lead pitch of the TMB12A05 drawing', () => {
    expect(activeBuzzer.pins.map((p) => [p.id, p.role])).toEqual([
      ['+', 'positive'],
      ['-', 'negative']
    ])
    expect(offsets(activeBuzzer)).toEqual({ '+': [0, 0], '-': [3, 0] })
    expect(activeBuzzer.footprint).toEqual({ kind: 'rigid' })
    expect(activeBuzzer.geometry).toMatchObject({ params: { leadPitchMm: 7.6, bodyDiaMm: 12 } })
    expect(activeBuzzer.bodyMm).toEqual([12, 12, 9.5])
  })

  it('takes rated 5 V, 4 to 8 V, at most 30 mA and 2300 +/-300 Hz from the TMB12A05 approval sheet', () => {
    expect(activeBuzzer.sim.model).toBe('active-buzzer')
    expect(activeBuzzer.sim.params).toMatchObject({
      ratedV: 5,
      operatingMinV: 4,
      operatingMaxV: 8,
      currentMa: 30,
      resonantHz: 2300,
      resonantTolHz: 300
    })
  })

  it('seats the passive buzzer on the same 3-pitch spacing SunFounder draws for it', () => {
    expect(offsets(passiveBuzzer)).toEqual({ '+': [0, 0], '-': [3, 0] })
    expect(passiveBuzzer.footprint).toEqual({ kind: 'rigid' })
  })

  it('treats the passive buzzer as a coil, with the WT-1209T 45 ohm, 5 V, 70 mA and 2400 Hz', () => {
    // Soberton WT-1209T page 1: coil 45 +/-4 ohm, rated 5 Vo-p, max 70 mA at 2.4 kHz, 2400 Hz.
    expect(passiveBuzzer.sim.model).toBe('passive-buzzer')
    expect(passiveBuzzer.sim.params).toMatchObject({
      coilOhm: 45,
      coilTolOhm: 4,
      ratedV: 5,
      currentMa: 70,
      resonantHz: 2400
    })
    expect(passiveBuzzer.pins.every((p) => p.electricalType === 'passive')).toBe(true)
  })
})

describe('DC motor with fan blade (130-size motor sheet, Adafruit 711 text)', () => {
  it('is an off-board part whose two leads end in male pins', () => {
    expect(dcMotor.footprint).toEqual({ kind: 'offboard' })
    expect(dcMotor.pins.map((p) => [p.id, p.connector])).toEqual([
      ['red', 'male-pin'],
      ['black', 'male-pin']
    ])
  })

  it('takes rated 6 V, 70 mA no-load, 9100 rpm no-load and 500 mA stall from the sheet', () => {
    expect(dcMotor.sim.model).toBe('dc-motor')
    expect(dcMotor.sim.params).toMatchObject({
      ratedV: 6,
      noLoadMa: 70,
      noLoadRpm: 9100,
      loadedMa: 250,
      stallMa: 500
    })
  })

  it('records no terminal resistance, because the sheet gives none', () => {
    expect(Object.keys(dcMotor.sim.params).some((k) => /ohm/i.test(k))).toBe(false)
  })

  it('takes the 27.5 x 20 x 15 mm body and 8 x 2 mm shaft from the sheet', () => {
    expect(dcMotor.bodyMm).toEqual([27.5, 20, 15])
    expect(dcMotor.geometry).toMatchObject({ params: { shaftLengthMm: 8, shaftDiaMm: 2 } })
  })
})

describe('5 V relay module (Songle SRD-05VDC-SL-C on a 3-pin module)', () => {
  it('is an off-board module, not a bare relay', () => {
    expect(relay.id).toBe('relay-module-5v')
    expect(relay.category).toBe('module')
    expect(relay.footprint).toEqual({ kind: 'offboard' })
  })

  it('has the S, +, - male header and the NC, COM, NO screw terminals in silkscreen order', () => {
    expect(relay.pins.map((p) => [p.id, p.role, p.connector])).toEqual([
      ['S', 'signal', 'male-pin'],
      ['+', 'power', 'male-pin'],
      ['-', 'ground', 'male-pin'],
      ['NC', 'contact', 'female-socket'],
      ['COM', 'contact', 'female-socket'],
      ['NO', 'contact', 'female-socket']
    ])
  })

  it('takes the 5 V coil from the Songle sheet: 70 ohm, 71.4 mA, pull-in 75 percent, drop-out 10 percent', () => {
    // Songle SRD coil data chart, 05 VDC high-sensitivity row.
    expect(relay.sim.model).toBe('relay-module')
    expect(relay.sim.params).toMatchObject({
      coilV: 5,
      coilOhm: 70,
      coilMa: 71.4,
      pickUpMaxV: 3.75,
      dropOutMinV: 0.5,
      operateMaxMs: 10,
      releaseMaxMs: 5
    })
  })

  it('rates the contacts at the form C values of the sheet: 7 A at 28 VDC, 10 A at 125 VAC, 7 A at 240 VAC', () => {
    expect(relay.sim.params).toMatchObject({
      contactMax28VdcA: 7,
      contactMax125VacA: 10,
      contactMax240VacA: 7
    })
  })

  it('does not assert an input polarity that no datasheet gives', () => {
    expect(Object.keys(relay.sim.params).some((k) => /active|polarity/i.test(k))).toBe(false)
  })
})

describe('MB102 breadboard power module (Handson Technology datasheet)', () => {
  it('is an off-board module whose eight J6 header pins are all male', () => {
    expect(power.footprint).toEqual({ kind: 'offboard' })
    expect(power.pins).toHaveLength(8)
    expect(power.pins.every((p) => p.connector === 'male-pin')).toBe(true)
  })

  it('wires J6 as 3.3 V on pins 1 and 3, 5 V on pins 5 and 7, ground on pins 2, 4, 6 and 8', () => {
    // Schematic page 3: J6 8-PIN, odd pins supplies, even pins ground.
    expect(power.internalConnections).toEqual([
      ['1', '3'],
      ['5', '7'],
      ['2', '4', '6', '8']
    ])
    const labels = Object.fromEntries(power.pins.map((p) => [p.id, p.label.split(' ')[0]]))
    expect(labels).toEqual({
      '1': '3V3',
      '2': 'GND',
      '3': '3V3',
      '4': 'GND',
      '5': '5V',
      '6': 'GND',
      '7': '5V',
      '8': 'GND'
    })
  })

  it('takes 6.5 to 12 V input, 3.3 V and 5 V outputs and under 700 mA from the datasheet brief', () => {
    expect(power.sim.model).toBe('power-module')
    expect(power.sim.params).toMatchObject({
      inputMinV: 6.5,
      inputMaxV: 12,
      out33V: 3.3,
      out5V: 5,
      maxOutputMa: 700
    })
  })

  it("takes the datasheet's 53 mm length and the 33 mm width the kit's board measures", () => {
    // Handson gives 5.3 x 3.5 cm; SunFounder's photo of the kit's board, Components101 and the 45-in-1
    // kit give 33 mm across.
    expect(power.geometry).toMatchObject({ params: { boardLengthMm: 53, boardWidthMm: 33 } })
  })

  it('notes that it plugs into the rail holes and that the rail-plug footprint is pending', () => {
    expect(power.provenance.notes).toContain(
      'Plugs into the rail holes in real use; rail-plug footprint pending'
    )
  })
})
