// Datasheet facts for the ICs and displays. Each expectation was read from the document named in
// its comment (see each part's provenance notes for the full source list); none is derived from
// the JSON under test.
import { describe, expect, it } from 'vitest'
import { loadPartDef } from '../../core/defs/parts'
import type { PartDef } from '../../core/model/types'
import barGraphRaw from './bar-graph-10.part.json'
import adc0834Raw from './ic-adc0834.part.json'
import hc595Raw from './ic-74hc595.part.json'
import l293dRaw from './ic-l293d.part.json'
import matrixRaw from './led-matrix-8x8.part.json'
import fourDigitRaw from './seven-segment-4digit.part.json'
import segmentCaRaw from './seven-segment-ca.part.json'
import segmentCcRaw from './seven-segment-cc.part.json'

const load = (id: string, raw: unknown): PartDef =>
  loadPartDef(`../../content/parts/${id}.part.json`, raw)

const pinLabels = (def: PartDef) => Object.fromEntries(def.pins.map((p) => [p.id, p.label]))
const idsLabelled = (def: PartDef, label: string) =>
  def.pins.filter((p) => p.label === label).map((p) => p.id)
const idsWithRole = (def: PartDef, role: string) =>
  def.pins.filter((p) => p.role === role).map((p) => p.id)
const offsetOf = (def: PartDef, id: string) => def.pins.find((p) => p.id === id)?.offsetPitch
const acrossOffsets = (def: PartDef) =>
  [...new Set(def.pins.map((p) => p.offsetPitch[1]))].sort((m, n) => m - n)

describe('74HC595 shift register', () => {
  const def = load('ic-74hc595', hc595Raw)

  it('numbers its 16 pins as in the TI SN74HC595 top view', () => {
    // TI SCLS041J, section 5 (page 3): 16-pin SOIC/PDIP top view and Table 5-1.
    expect(pinLabels(def)).toEqual({
      '1': 'QB',
      '2': 'QC',
      '3': 'QD',
      '4': 'QE',
      '5': 'QF',
      '6': 'QG',
      '7': 'QH',
      '8': 'GND',
      '9': "QH'",
      '10': 'SRCLR',
      '11': 'SRCLK',
      '12': 'RCLK',
      '13': 'OE',
      '14': 'SER',
      '15': 'QA',
      '16': 'VCC'
    })
  })

  it('has VCC on pin 16 and GND on pin 8', () => {
    // TI SCLS041J page 3, package top view (Table 5-1 leaves the VCC cell for DIP blank).
    expect(idsLabelled(def, 'VCC')).toEqual(['16'])
    expect(idsLabelled(def, 'GND')).toEqual(['8'])
    expect(def.pins.find((p) => p.id === '16')?.role).toBe('power')
    expect(def.pins.find((p) => p.id === '8')?.role).toBe('ground')
  })

  it('treats the eight outputs and QH-prime as logic outputs and the five controls as inputs', () => {
    // TI SCLS041J Table 5-1 (page 3): QA-QH and QH' are type O, SER/SRCLK/RCLK/SRCLR/OE are type I.
    expect(idsWithRole(def, 'logic-out').sort((m, n) => Number(m) - Number(n))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '9',
      '15'
    ])
    expect(idsWithRole(def, 'logic-in').sort((m, n) => Number(m) - Number(n))).toEqual([
      '10',
      '11',
      '12',
      '13',
      '14'
    ])
  })

  it('has no pins tied inside the package', () => {
    // TI SCLS041J Figure functional block diagram (page 1): eight independent outputs.
    expect(def.internalConnections).toEqual([])
  })

  it('straddles the trench with rows 3 pitches apart', () => {
    // TI drawing MPDI002C (N R-PDIP-T16): 0.300 in row spacing; SCLS041J page 1 lists SN74HC595N.
    expect(def.footprint).toEqual({ kind: 'rigid', straddleTrench: true })
    expect(acrossOffsets(def)).toEqual([0, 3])
    // Pin 1 at the origin, pin 8 at the end of the first row, pin 9 opposite pin 8, pin 16 opposite pin 1.
    expect(offsetOf(def, '1')).toEqual([0, 0])
    expect(offsetOf(def, '8')).toEqual([7, 0])
    expect(offsetOf(def, '9')).toEqual([7, 3])
    expect(offsetOf(def, '16')).toEqual([0, 3])
  })

  it('records the supply range, thresholds, drive and clock limits', () => {
    const p = def.sim.params
    expect(def.sim.model).toBe('shift-register-595')
    // TI SCLS041J section 6.3 (page 4): VCC 2 to 6 V; section 6.1: absolute maximum 7 V.
    expect([p.vccMinV, p.vccMaxV, p.vccAbsMaxV]).toEqual([2, 6, 7])
    // Section 6.3: VIH 3.15 V and VIL 1.35 V at VCC = 4.5 V; 1.5 / 0.5 V at 2 V; 4.2 / 1.8 V at 6 V.
    expect([p.thresholdVccV, p.vihMinV, p.vilMaxV]).toEqual([4.5, 3.15, 1.35])
    expect([p.vihMinV_vcc2V, p.vilMaxV_vcc2V]).toEqual([1.5, 0.5])
    expect([p.vihMinV_vcc6V, p.vilMaxV_vcc6V]).toEqual([4.2, 1.8])
    // Section 6.5 (page 5): SN74HC595 VOH >= 3.84 V at -6 mA and VOL <= 0.33 V at 6 mA, VCC = 4.5 V.
    expect([p.iohMa, p.iolMa, p.vohMinV, p.volMaxV]).toEqual([6, 6, 3.84, 0.33])
    // Section 6.5: QH' is rated 4 mA instead of 6 mA at the same VCC.
    expect([p.qhPrimeIohMa, p.qhPrimeIolMa]).toEqual([4, 4])
    // Section 6.1: +/-35 mA per output, +/-70 mA through VCC or GND.
    expect([p.ioAbsMaxMa, p.vccGndAbsMaxMa]).toEqual([35, 70])
    // Section 6.6 (page 6) at 4.5 V: fclock 25 MHz max, pulse 20 ns, SER setup 25 ns, SRCLK-to-RCLK 19 ns.
    expect([p.fmaxHz, p.twMinNs, p.tsuSerMinNs, p.tsuSrclkToRclkMinNs, p.thSerMinNs]).toEqual([
      25_000_000, 20, 25, 19, 0
    ])
    // Section 6.7 (page 8) at 4.5 V, 50 pF: RCLK to QA-QH 17 ns typical, 37 ns maximum.
    expect([p.tpdNs, p.tpdMaxNs]).toEqual([17, 37])
    // Table 5-1 / function table (section 8.4, page 12): OE and SRCLR act when low.
    expect([p.oeActiveLow, p.srclrActiveLow]).toEqual([true, true])
  })

  it('is tagged as a kit part', () => {
    // SunFounder component list image: "74HC595 x2".
    expect(def.kitTags).toEqual(['kit'])
  })
})

describe('ADC0834 serial ADC', () => {
  const def = load('ic-adc0834', adc0834Raw)

  it('numbers its 14 pins as in the TI ADC0834-N top view', () => {
    // TI SNAS531B, Figure 3 (page 2): ADC0834-N 4-channel MUX SOIC/PDIP top view.
    expect(pinLabels(def)).toEqual({
      '1': 'V+',
      '2': 'CS',
      '3': 'CH0',
      '4': 'CH1',
      '5': 'CH2',
      '6': 'CH3',
      '7': 'DGND',
      '8': 'AGND',
      '9': 'VREF',
      '10': 'DO',
      '11': 'SARS',
      '12': 'CLK',
      '13': 'DI',
      '14': 'VCC'
    })
  })

  it('has VCC on pin 14, the shunt-regulator input V+ on pin 1 and separate analog and digital grounds', () => {
    // TI SNAS531B Figure 3 (page 2); the "COM internally connected to A GND" note means no COM pin.
    expect(idsLabelled(def, 'VCC')).toEqual(['14'])
    expect(idsLabelled(def, 'V+')).toEqual(['1'])
    expect(idsWithRole(def, 'ground')).toEqual(['7', '8'])
    expect(def.internalConnections).toEqual([])
  })

  it('reads four analog channels and a reference, and drives DO and SARS', () => {
    // TI SNAS531B Figure 3 (page 2) and Absolute Maximum Ratings (page 3): CH0-CH3 and VREF are analog inputs.
    expect(idsWithRole(def, 'analog-in')).toEqual(['3', '4', '5', '6', '9'])
    expect(idsLabelled(def, 'DO')).toEqual(['10'])
    expect(def.pins.find((p) => p.label === 'DO')?.role).toBe('logic-out')
    expect(def.pins.find((p) => p.label === 'SARS')?.role).toBe('logic-out')
    expect(idsWithRole(def, 'logic-in')).toEqual(['2', '12', '13'])
  })

  it('straddles the trench with rows 3 pitches apart', () => {
    // TI SNAS531B page 1 features: "0.3 in. Standard Width, 8-, 14- or 20-Pin PDIP Package".
    expect(def.footprint).toEqual({ kind: 'rigid', straddleTrench: true })
    expect(acrossOffsets(def)).toEqual([0, 3])
    expect(offsetOf(def, '7')).toEqual([6, 0])
    expect(offsetOf(def, '8')).toEqual([6, 3])
    expect(offsetOf(def, '14')).toEqual([0, 3])
  })

  it('records the supply, logic levels and clock limits', () => {
    const p = def.sim.params
    expect(def.sim.model).toBe('adc0834')
    // TI SNAS531B Operating Ratings (page 3): VCC 4.5 to 6.3 V; Absolute Maximum Ratings: 6.5 V.
    expect([p.vccMinV, p.vccMaxV, p.vccAbsMaxV]).toEqual([4.5, 6.3, 6.5])
    // Digital and DC characteristics, ADC0834BCN/CCN column (page 5).
    expect([p.vihMinV, p.vilMaxV]).toEqual([2, 0.8])
    expect([p.vohMinV, p.iohMa, p.volMaxV, p.iolMa]).toEqual([2.4, 0.36, 0.4, 1.6])
    expect(p.iccMaxMa).toBe(2.5)
    // AC characteristics (page 6): fCLK 10 kHz to 400 kHz, 8 clocks per conversion, 8-bit result.
    expect([p.fclkMinHz, p.fclkMaxHz, p.conversionClocks, p.resolutionBits]).toEqual([
      10_000, 400_000, 8, 8
    ])
    expect([p.tSetupMinNs, p.tHoldMinNs]).toEqual([250, 90])
    expect(p.channelCount).toBe(4)
  })

  it('is tagged as not in the kit', () => {
    // SunFounder component list image: an ADS7830 module and no ADC0834.
    expect(def.kitTags).toEqual(['not in kit'])
  })
})

describe('L293D motor driver', () => {
  const def = load('ic-l293d', l293dRaw)

  it('numbers its 16 pins as in the TI NE package top view', () => {
    // TI SLRS008D, section 5 (page 3): NE 16-pin PDIP top view and Pin Functions table.
    expect(pinLabels(def)).toEqual({
      '1': '1,2EN',
      '2': '1A',
      '3': '1Y',
      '4': 'GND',
      '5': 'GND',
      '6': '2Y',
      '7': '2A',
      '8': 'VCC2',
      '9': '3,4EN',
      '10': '3A',
      '11': '3Y',
      '12': 'GND',
      '13': 'GND',
      '14': '4Y',
      '15': '4A',
      '16': 'VCC1'
    })
  })

  it('keeps the logic supply VCC1 and the motor supply VCC2 as separate power pins', () => {
    // TI SLRS008D page 3: VCC1 = pin 16 (5 V logic), VCC2 = pin 8 (4.5 to 36 V drivers).
    expect(idsLabelled(def, 'VCC1')).toEqual(['16'])
    expect(idsLabelled(def, 'VCC2')).toEqual(['8'])
    expect(idsWithRole(def, 'power')).toEqual(['8', '16'])
  })

  it('has four ground pins joined, and four driver outputs', () => {
    // TI SLRS008D page 3: GROUND = 4, 5, 12, 13; Figure 6 shows them as one GND node.
    expect(idsWithRole(def, 'ground')).toEqual(['4', '5', '12', '13'])
    expect(def.internalConnections).toEqual([['4', '5', '12', '13']])
    // Page 3: <1:4>Y = pins 3, 6, 11, 14 (outputs); inputs 2, 7, 10, 15; enables 1 and 9.
    expect(idsWithRole(def, 'driver-out')).toEqual(['3', '6', '11', '14'])
    expect(idsWithRole(def, 'logic-in')).toEqual(['1', '2', '7', '9', '10', '15'])
  })

  it('straddles the trench with rows 3 pitches apart', () => {
    // TI drawing MPDI002C (N R-PDIP-T16) 0.300 in row spacing; the NE drawing is not in SLRS008D.
    expect(def.footprint).toEqual({ kind: 'rigid', straddleTrench: true })
    expect(acrossOffsets(def)).toEqual([0, 3])
    expect(offsetOf(def, '8')).toEqual([7, 0])
    expect(offsetOf(def, '9')).toEqual([7, 3])
    expect(offsetOf(def, '16')).toEqual([0, 3])
  })

  it('records both supply ranges, the clamp diodes and the output limits', () => {
    const p = def.sim.params
    expect(def.sim.model).toBe('l293d')
    // TI SLRS008D Recommended Operating Conditions (page 4): VCC1 4.5 to 7 V; VCC2 up to 36 V, not below VCC1.
    expect([p.vcc1MinV, p.vcc1MaxV, p.vcc2MinV, p.vcc2MaxV, p.vcc2AtLeastVcc1]).toEqual([
      4.5,
      7,
      4.5,
      36,
      true
    ])
    // Same table: VIH 2.3 V min and VIL 1.5 V max.
    expect([p.vihMinV, p.vilMaxV]).toEqual([2.3, 1.5])
    // Section 8.1 (page 7): "On the L293D, these diodes are integrated"; section 6.5 (page 5): clamp 1.3 V.
    expect(p.outputClampDiodes).toBe(true)
    expect([p.clampHighVfTypV, p.clampLowVfTypV]).toEqual([1.3, 1.3])
    // Section 6.1 (page 4): 600 mA continuous and 1.2 A peak per channel for the L293D.
    expect([p.ioContinuousMaxMa, p.ioPeakMaxMa]).toEqual([600, 1200])
    // Section 6.5 (page 5) at 0.6 A: output high is VCC2 - 1.4 V typical, low is 1.2 V typical, 1.8 V max.
    expect([p.vohBelowVcc2TypV, p.volTypV, p.volMaxV]).toEqual([1.4, 1.2, 1.8])
  })

  it('is tagged as a kit part', () => {
    // SunFounder component list image: "L293D x1".
    expect(def.kitTags).toEqual(['kit'])
  })
})

describe('7-segment display, one digit', () => {
  // Kingbright SC56-11EWA (common cathode) and SA56-11EWA (common anode), page 1 drawing and circuit.
  const segments = {
    '1': 'e',
    '2': 'd',
    '3': 'COM',
    '4': 'c',
    '5': 'dp',
    '6': 'b',
    '7': 'a',
    '8': 'COM',
    '9': 'f',
    '10': 'g'
  }

  function checkDisplay(
    name: string,
    id: string,
    raw: unknown,
    commonRole: 'cathode' | 'anode',
    segmentRole: 'cathode' | 'anode',
    tags: string[]
  ) {
    describe(name, () => {
      const def = load(id, raw)

      it('numbers its 10 pins as in the Kingbright drawing', () => {
        expect(pinLabels(def)).toEqual(segments)
      })

      it('joins the two common pins, 3 and 8', () => {
        // Page 1 circuit: the common terminal is labelled "3,8".
        expect(idsLabelled(def, 'COM')).toEqual(['3', '8'])
        expect(idsWithRole(def, commonRole)).toEqual(['3', '8'])
        expect(def.internalConnections).toEqual([['3', '8']])
        expect(def.sim.params.commonType).toBe(commonRole)
      })

      it('puts the eight segment pins on the opposite LED end', () => {
        expect(idsWithRole(def, segmentRole)).toEqual(['1', '2', '4', '5', '6', '7', '9', '10'])
      })

      it('straddles the trench with rows 6 pitches apart', () => {
        // Page 1: 15.24 mm (0.6 in) between rows on a 2.54 mm pitch.
        expect(def.footprint).toEqual({ kind: 'rigid', straddleTrench: true })
        expect(acrossOffsets(def)).toEqual([0, 6])
        expect(offsetOf(def, '1')).toEqual([0, 0])
        expect(offsetOf(def, '5')).toEqual([4, 0])
        expect(offsetOf(def, '6')).toEqual([4, 6])
        expect(offsetOf(def, '10')).toEqual([0, 6])
      })

      it('records the forward voltage and current ratings', () => {
        const p = def.sim.params
        expect(def.sim.model).toBe('seven-segment')
        // Page 2: VF 1.9 V typ and 2.3 V max at 10 mA; DC IF 30 mA; peak IF 160 mA at 1/10 duty; VR 5 V.
        expect([p.vfTypV, p.vfMaxV, p.ifTestMa, p.ifMaxMa, p.ifPeakMa, p.vrMaxV]).toEqual([
          1.9, 2.3, 10, 30, 160, 5
        ])
        expect(p.digitCount).toBe(1)
      })

      it('carries the kit tag the SunFounder documents give it', () => {
        // SunFounder page 1.1.4: "In this kit, we use a Common Cathode display."
        expect(def.kitTags).toEqual(tags)
      })
    })
  }

  checkDisplay('common cathode', 'seven-segment-cc', segmentCcRaw, 'cathode', 'anode', ['kit'])
  checkDisplay('common anode', 'seven-segment-ca', segmentCaRaw, 'anode', 'cathode', ['not in kit'])
})

describe('4-digit 7-segment display', () => {
  const def = load('seven-segment-4digit', fourDigitRaw)

  it('numbers its 12 pins as in the Kingbright CA56-12 drawing', () => {
    // Kingbright CA56-12EWA page 1 circuit: Dig1 12, Dig2 9, Dig3 8, Dig4 6; a 11, b 7, c 4, d 2, e 1, f 10, g 5, DP 3.
    expect(pinLabels(def)).toEqual({
      '1': 'e',
      '2': 'd',
      '3': 'dp',
      '4': 'c',
      '5': 'g',
      '6': 'D4',
      '7': 'b',
      '8': 'D3',
      '9': 'D2',
      '10': 'f',
      '11': 'a',
      '12': 'D1'
    })
  })

  it('has four separate anode digit commons and shared cathode segment pins', () => {
    // Same circuit: each digit has its own common anode; segment pins serve all four digits.
    expect(idsWithRole(def, 'anode')).toEqual(['6', '8', '9', '12'])
    expect(idsWithRole(def, 'cathode')).toEqual(['1', '2', '3', '4', '5', '7', '10', '11'])
    expect(def.internalConnections).toEqual([])
    expect(def.sim.params.commonType).toBe('anode')
    expect(def.sim.params.digitCount).toBe(4)
  })

  it('matches the SunFounder Vincent kit pin numbering for its common-anode 4-digit display', () => {
    // SunFounder 4-digit page (Vincent kit): D1 12, D2 9, D3 8, D4 6 and a 11, b 7, c 4, d 2, e 1, f 10, g 5, dp 3.
    const commons = Object.fromEntries(
      ['D1', 'D2', 'D3', 'D4'].map((label) => [label, idsLabelled(def, label)[0]])
    )
    expect(commons).toEqual({ D1: '12', D2: '9', D3: '8', D4: '6' })
  })

  it('straddles the trench with rows 6 pitches apart', () => {
    // Kingbright CA56-12EWA page 1: 15.24 mm (0.6 in) between rows; 12 pins on a 2.54 mm pitch.
    expect(def.footprint).toEqual({ kind: 'rigid', straddleTrench: true })
    expect(acrossOffsets(def)).toEqual([0, 6])
    expect(offsetOf(def, '6')).toEqual([5, 0])
    expect(offsetOf(def, '7')).toEqual([5, 6])
    expect(offsetOf(def, '12')).toEqual([0, 6])
  })

  it('records the forward voltage and current ratings', () => {
    const p = def.sim.params
    expect(def.sim.model).toBe('seven-segment-4digit')
    // Kingbright CA56-12EWA page 2: VF 1.9 V typ and 2.3 V max at 10 mA; IF 30 mA; peak 160 mA; VR 5 V.
    expect([p.vfTypV, p.vfMaxV, p.ifTestMa, p.ifMaxMa, p.ifPeakMa, p.vrMaxV]).toEqual([
      1.9, 2.3, 10, 30, 160, 5
    ])
  })

  it('is tagged as not in the kit', () => {
    // SunFounder component list image: no 4-digit display.
    expect(def.kitTags).toEqual(['not in kit'])
  })
})

describe('8x8 LED dot matrix', () => {
  const def = load('led-matrix-8x8', matrixRaw)
  const rowPins = ['9', '14', '8', '12', '1', '7', '2', '5']
  const colPins = ['13', '3', '4', '10', '6', '11', '15', '16']

  it('numbers its 16 pins as in the Toplite 788BS circuit diagram', () => {
    // TOP-CA-788BS data sheet, page 2 (section 4 circuit diagram).
    expect(pinLabels(def)).toEqual({
      '1': 'ROW5',
      '2': 'ROW7',
      '3': 'COL2',
      '4': 'COL3',
      '5': 'ROW8',
      '6': 'COL5',
      '7': 'ROW6',
      '8': 'ROW3',
      '9': 'ROW1',
      '10': 'COL4',
      '11': 'COL6',
      '12': 'ROW4',
      '13': 'COL1',
      '14': 'ROW2',
      '15': 'COL7',
      '16': 'COL8'
    })
  })

  it('lists rows 1 to 8 on pins 9, 14, 8, 12, 1, 7, 2, 5 and columns 1 to 8 on 13, 3, 4, 10, 6, 11, 15, 16', () => {
    // TOP-CA-788BS page 2; the same two tables are on SunFounder page 1.1.3.
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => idsLabelled(def, `ROW${n}`)[0])).toEqual(rowPins)
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => idsLabelled(def, `COL${n}`)[0])).toEqual(colPins)
  })

  it('has the row pins on the LED anodes and the column pins on the cathodes', () => {
    // TOP-CA-788BS page 2: diode anodes on the row lines, cathodes on the column lines (type CA).
    expect(def.pins.filter((p) => p.role === 'anode').map((p) => p.id)).toEqual(
      rowPins.slice().sort((m, n) => Number(m) - Number(n))
    )
    expect(def.pins.filter((p) => p.role === 'cathode').map((p) => p.id)).toEqual(
      colPins.slice().sort((m, n) => Number(m) - Number(n))
    )
    expect(def.sim.params.commonType).toBe('anode')
    expect(def.sim.params.rowsAreAnodes).toBe(true)
    expect(def.internalConnections).toEqual([])
  })

  it('straddles the trench with rows 6 pitches apart', () => {
    // TOP-CA-788BS page 2: 15.0 mm between pin rows (6 x 2.54 = 15.24 mm on the breadboard grid).
    expect(def.footprint).toEqual({ kind: 'rigid', straddleTrench: true })
    expect(acrossOffsets(def)).toEqual([0, 6])
    expect(offsetOf(def, '8')).toEqual([7, 0])
    expect(offsetOf(def, '9')).toEqual([7, 6])
    expect(offsetOf(def, '16')).toEqual([0, 6])
  })

  it('records the forward voltage and current ratings', () => {
    const p = def.sim.params
    expect(def.sim.model).toBe('led-matrix-8x8')
    // TOP-CA-788BS page 3: VF 1.80 / 2.10 / 2.40 V at 20 mA; IF 30 mA per dot; peak 120 mA; VR 5 V.
    expect([p.vfMinV, p.vfTypV, p.vfMaxV, p.ifTestMa, p.ifMaxMa, p.ifPeakMa, p.vrMaxV]).toEqual([
      1.8, 2.1, 2.4, 20, 30, 120, 5
    ])
  })

  it('is tagged as a kit part', () => {
    // SunFounder page 1.1.3: "we use a CA type (labeled as 788BS)"; component list: 20mm Dot Matrix Module.
    expect(def.kitTags).toEqual(['kit'])
  })
})

describe('10-segment LED bar graph', () => {
  const def = load('bar-graph-10', barGraphRaw)

  it('numbers its 20 pins as in the Kingbright DC10EWA drawing', () => {
    // Kingbright DC10EWA page 1 circuit: pins 1-10 anodes, pins 20 down to 11 their cathodes.
    expect(pinLabels(def)).toEqual({
      '1': 'A1',
      '2': 'A2',
      '3': 'A3',
      '4': 'A4',
      '5': 'A5',
      '6': 'A6',
      '7': 'A7',
      '8': 'A8',
      '9': 'A9',
      '10': 'A10',
      '11': 'K10',
      '12': 'K9',
      '13': 'K8',
      '14': 'K7',
      '15': 'K6',
      '16': 'K5',
      '17': 'K4',
      '18': 'K3',
      '19': 'K2',
      '20': 'K1'
    })
  })

  it('has anodes on one side and cathodes on the other, with LED n between pins n and 21 - n', () => {
    // DC10EWA page 1 circuit: LED 1 is pins 1 and 20, LED 10 is pins 10 and 11.
    expect(def.pins.filter((p) => p.role === 'anode').map((p) => p.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10'
    ])
    expect(def.pins.filter((p) => p.role === 'cathode').map((p) => p.id)).toEqual([
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
      '17',
      '18',
      '19',
      '20'
    ])
    for (let n = 1; n <= 10; n++) {
      expect(idsLabelled(def, `A${n}`)).toEqual([String(n)])
      expect(idsLabelled(def, `K${n}`)).toEqual([String(21 - n)])
    }
    expect(def.internalConnections).toEqual([])
    expect(def.sim.params.commonType).toBe('none')
  })

  it('straddles the trench with rows 3 pitches apart', () => {
    // DC10EWA page 1 PCB layout: 7.5 mm (0.295 in) between rows, 2.54 mm pitch; ten pins per row.
    expect(def.footprint).toEqual({ kind: 'rigid', straddleTrench: true })
    expect(acrossOffsets(def)).toEqual([0, 3])
    expect(offsetOf(def, '10')).toEqual([9, 0])
    expect(offsetOf(def, '11')).toEqual([9, 3])
    expect(offsetOf(def, '20')).toEqual([0, 3])
  })

  it('records the forward voltage and current ratings', () => {
    const p = def.sim.params
    expect(def.sim.model).toBe('bar-graph-10')
    // DC10EWA page 2: VF 1.9 V typ and 2.3 V max at 10 mA; IF 30 mA; peak 160 mA at 1/10 duty; VR 5 V.
    expect([p.vfTypV, p.vfMaxV, p.ifTestMa, p.ifMaxMa, p.ifPeakMa, p.vrMaxV]).toEqual([
      1.9, 2.3, 10, 30, 160, 5
    ])
    expect(p.segmentCount).toBe(10)
  })

  it('is tagged as a kit part', () => {
    // SunFounder component list image: "LED Bar Graph x1".
    expect(def.kitTags).toEqual(['kit'])
  })
})
