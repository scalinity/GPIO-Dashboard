// Datasheet facts for the passive and LED part definitions. Every expected value is copied from
// the datasheet named in the comment beside it, not from the definition file.
import { describe, expect, it } from 'vitest'
import { loadPartDef } from '../../core/defs/parts'
import ceramicRaw from './ceramic-capacitor.part.json'
import diodeRaw from './diode-1n4007.part.json'
import electrolyticRaw from './electrolytic-capacitor.part.json'
import ldrRaw from './ldr.part.json'
import ledRaw from './led.part.json'
import ntcRaw from './ntc-10k.part.json'
import potRaw from './potentiometer-10k.part.json'
import resistorRaw from './resistor.part.json'
import rgbCaRaw from './rgb-led-ca.part.json'
import rgbCcRaw from './rgb-led-cc.part.json'

const load = (id: string, raw: unknown) => loadPartDef(`../../content/parts/${id}.part.json`, raw)

const resistor = load('resistor', resistorRaw)
const led = load('led', ledRaw)
const rgbCc = load('rgb-led-cc', rgbCcRaw)
const rgbCa = load('rgb-led-ca', rgbCaRaw)
const ceramic = load('ceramic-capacitor', ceramicRaw)
const electrolytic = load('electrolytic-capacitor', electrolyticRaw)
const diode = load('diode-1n4007', diodeRaw)
const pot = load('potentiometer-10k', potRaw)
const ldr = load('ldr', ldrRaw)
const ntc = load('ntc-10k', ntcRaw)

const pinSummary = (def: typeof resistor) =>
  def.pins.map((p) => [p.id, p.role, p.offsetPitch] as const)

describe('resistor', () => {
  it('has two interchangeable leads and spans an upright mount up to the lead reach', () => {
    expect(pinSummary(resistor)).toEqual([
      ['1', 'passive', [0, 0]],
      ['2', 'passive', [1, 0]]
    ])
    // Span 1 is the upright mount; 16 = floor((6.3 + 2 x (26 - 8)) / 2.54), see the notes.
    expect(resistor.footprint).toEqual({ kind: 'flex-2lead', minSpan: 1, maxSpan: 16 })
    expect(resistor.sim.model).toBe('resistor')
  })

  it('takes power and voltage ratings from the Yageo CFR-25 column', () => {
    expect(resistor.sim.params.ratedPowerW).toBe(0.25) // CFR V.3 p.3 Table 1: 1/4 W at 70 C
    expect(resistor.sim.params.maxWorkingV).toBe(250) // CFR V.3 p.3 Table 1: CFR-25 250 V
    expect(resistor.sim.params.maxOverloadV).toBe(500) // CFR V.3 p.3 Table 1: CFR-25 500 V
  })

  it('takes the body from the CFR-25 dimensions table', () => {
    const g = resistor.geometry
    if (!('family' in g)) throw new Error('resistor geometry is a family')
    expect(g.family).toBe('axial-resistor')
    expect(g.params.bodyLengthMm).toBe(6.3) // CFR V.3 p.3 DIMENSIONS: L 6.3 +-0.5
    expect(g.params.bodyDiameterMm).toBe(2.4) // CFR V.3 p.3 DIMENSIONS: D 2.4 +-0.2
    expect(g.params.leadLengthMm).toBe(28) // CFR V.3 p.3 DIMENSIONS: H 28 +-2
    expect(g.params.leadDiameterMm).toBe(0.55) // CFR V.3 p.3 DIMENSIONS: d 0.55 +-0.05
    expect(resistor.bodyMm).toEqual([6.3, 2.4, 2.4])
  })

  it('defaults to 220 ohm, 5% and offers 5% and 1% tolerance', () => {
    expect(resistor.properties.resistance).toMatchObject({ default: 220, min: 1 }) // kit list: 220 ohm x20
    expect(resistor.properties.tolerance).toEqual({
      type: 'enum',
      label: 'Tolerance',
      options: ['5%', '1%'], // CFR-25JB is +-5%; the 1% grade is MFR-25FB (MFR V.4 p.2 part code F = +-1%)
      default: '5%'
    })
  })

  it('is in the kit', () => {
    expect(resistor.kitTags).toEqual(['kit']) // component list image: resistors 220/1k/10k
  })
})

describe('led', () => {
  it('has anode first and cathode second on a 1-pitch minimum span', () => {
    expect(pinSummary(led)).toEqual([
      ['A', 'anode', [0, 0]],
      ['K', 'cathode', [1, 0]]
    ])
    // Kingbright WP7113 p.1 drawing: the leads are 2.54 mm apart; the cathode is the shorter lead.
    // 15 = floor((2.54 + 2 x (27 - 8)) / 2.54) from the 27 mm minimum lead length, see the notes.
    expect(led.footprint).toEqual({ kind: 'flex-2lead', minSpan: 1, maxSpan: 15 })
    expect(led.sim.model).toBe('led')
    expect(led.kitTags).toEqual(['kit']) // component list image: red/yellow/green/white/blue LEDs x5
  })

  it('offers five colours and both sizes', () => {
    expect(led.properties.color).toMatchObject({
      options: ['red', 'green', 'blue', 'yellow', 'white']
    })
    expect(led.properties.size).toMatchObject({ options: ['3mm', '5mm'], default: '5mm' })
  })

  // part, VF typ, VF max, IF test, IF max DC, IR max (A) at VR 5 V, PD max (W)
  const table = [
    // 5 mm: p.2 ELECTRICAL / OPTICAL CHARACTERISTICS and ABSOLUTE MAXIMUM RATINGS
    ['red', '5mm', 'WP7113ID', 1.9, 2.3, 10, 30, 1e-5, 0.075], // DSAF0012 V.14A
    ['yellow', '5mm', 'WP7113YD', 1.95, 2.4, 10, 30, 1e-5, 0.075], // DSAF2448 V.11B
    ['green', '5mm', 'WP7113GD', 2.0, 2.4, 10, 25, 1e-5, 0.0625], // DSAE9335 V.12B
    ['blue', '5mm', 'WP7113QBC-D', 3.3, 4.0, 20, 30, 5e-5, 0.12], // DSAG3481 V.18B
    ['white', '5mm', 'WP7113QWC-D', 3.3, 4.0, 20, 30, 5e-5, 0.12], // DSAI6407 V.6B
    // 3 mm: p.2 electrical characteristics table and absolute maximum ratings table
    ['red', '3mm', 'WP7104ID', 2.0, 2.5, 20, 30, 1e-5, 0.075], // DSAF2304 V.3
    ['yellow', '3mm', 'WP7104YD', 2.1, 2.5, 20, 30, 1e-5, 0.075], // DSAF2337 V.3
    ['green', '3mm', 'WP7104GD', 2.2, 2.5, 20, 25, 1e-5, 0.0625], // DSAF2299 V.4
    ['blue', '3mm', 'WP7104QBC-D', 3.3, 4.0, 20, 30, 5e-5, 0.12], // DSAF4262 V.8
    ['white', '3mm', 'WP7104QWC-D', 3.3, 4.0, 20, 30, 5e-5, 0.12] // DSAE9924 V.10B
  ] as const

  it.each(table)(
    '%s %s (%s) carries the datasheet forward voltage, test current and ratings',
    (color, size, _part, vfTyp, vfMax, ifTest, ifMax, irMax, pdMax) => {
      const k = `${color}.${size}.`
      const p = led.sim.params
      expect(p[`${k}vfTypV`]).toBe(vfTyp)
      expect(p[`${k}vfMaxV`]).toBe(vfMax)
      expect(p[`${k}ifTestMa`]).toBe(ifTest)
      expect(p[`${k}ifMaxMa`]).toBe(ifMax)
      expect(p[`${k}vrMaxV`]).toBe(5) // every sheet: reverse voltage 5 V
      expect(p[`${k}irMaxA`]).toBe(irMax)
      expect(p[`${k}pdMaxW`]).toBe(pdMax)
    }
  )

  it('lists a Kingbright datasheet for each of the ten colour and size combinations', () => {
    for (const [, , part] of table) {
      const url = `https://www.kingbrightusa.com/images/catalog/SPEC/${part}.pdf`
      expect(led.provenance.sources).toContain(url)
    }
  })

  it('takes both package outlines from the datasheet drawings', () => {
    const g = led.geometry
    if (!('family' in g)) throw new Error('led geometry is a family')
    expect(g.family).toBe('led')
    expect(g.params['5mm.domeDiameterMm']).toBe(5) // WP7113 p.1: dia 5
    expect(g.params['5mm.flangeDiameterMm']).toBe(5.9) // WP7113 p.1: dia 5.9
    expect(g.params['5mm.bodyLengthMm']).toBe(8.6) // WP7113 p.1: 8.6
    expect(g.params['5mm.leadLengthMinMm']).toBe(27) // WP7113 p.1: 27 min
    expect(g.params['3mm.flangeDiameterMm']).toBe(3.2) // WP7104 p.1: dia 3.2
    expect(g.params['3mm.bodyLengthMm']).toBe(5.4) // WP7104 p.1: 5.4 +-0.5
    expect(led.bodyMm).toEqual([5.9, 5.9, 8.6]) // 5 mm default
  })
})

describe('rgb-led-cc', () => {
  it('has red, the common cathode, green then blue on four adjacent leads', () => {
    // YSL-R596CR3G4B5C-C10 p.2 drawing: 1 RED, 2 common, 3 GREEN, 4 BLUE
    expect(pinSummary(rgbCc)).toEqual([
      ['R', 'anode', [0, 0]],
      ['K', 'cathode', [1, 0]],
      ['G', 'anode', [2, 0]],
      ['B', 'anode', [3, 0]]
    ])
    expect(rgbCc.footprint).toEqual({ kind: 'rigid' })
  })

  it('declares pin K as the common cathode', () => {
    // YSL p.2 schematic: the three cathodes join at pin 2, the longest lead (29.5 mm)
    expect(rgbCc.sim.params.commonPin).toBe('K')
    expect(rgbCc.sim.params.commonType).toBe('cathode')
    expect(rgbCc.pins.find((p) => p.id === 'K')?.role).toBe('cathode')
  })

  it('carries per-channel forward voltage and current from the YSL table', () => {
    const p = rgbCc.sim.params
    // YSL p.1 Typical Electrical & Optical Characteristics, VF at IF = 20 mA (min/typ/max)
    expect([p['red.vfMinV'], p['red.vfTypV'], p['red.vfMaxV']]).toEqual([1.8, 2.0, 2.2])
    expect([p['green.vfMinV'], p['green.vfTypV'], p['green.vfMaxV']]).toEqual([3.0, 3.2, 3.4])
    expect([p['blue.vfMinV'], p['blue.vfTypV'], p['blue.vfMaxV']]).toEqual([3.0, 3.2, 3.4])
    for (const c of ['red', 'green', 'blue']) {
      expect(p[`${c}.ifTestMa`]).toBe(20) // YSL p.1 test condition IF = 20 mA
      expect(p[`${c}.ifMaxMa`]).toBe(20) // YSL p.1 absolute maximum: forward current 20 mA
      expect(p[`${c}.ifPeakMa`]).toBe(30) // YSL p.1: peak forward current 30 mA, duty 1/10, 10 kHz
      expect(p[`${c}.irMaxA`]).toBe(1e-5) // YSL p.1: reverse current 10 uA at VR = 5 V
    }
  })

  it('is the kit RGB LED', () => {
    // component list image: LED-RGB x1; SunFounder 1.1.2 wiring: 2nd (longest) lead to GND
    expect(rgbCc.kitTags).toEqual(['kit'])
    expect(rgbCc.sim.model).toBe('rgb-led')
  })

  it('takes the body from the YSL drawing', () => {
    const g = rgbCc.geometry
    if (!('family' in g)) throw new Error('rgb geometry is a family')
    expect(g.family).toBe('rgb-led')
    expect(g.params.domeDiameterMm).toBe(5) // YSL p.2: 5.00
    expect(g.params.flangeDiameterMm).toBe(5.8) // YSL p.2: 5.80
    expect(g.params.bodyHeightMm).toBe(8.7) // YSL p.2: 8.70
    expect(g.params.commonLeadLengthMm).toBe(29.5) // YSL p.2: longest lead 29.5
  })
})

describe('rgb-led-ca', () => {
  it('has red, the common anode, blue then green on four adjacent leads', () => {
    // Dialight 521-8559F LED SCHEMATIC: 1 RED CATHODE, 2 COMMON ANODE, 3 BLUE CATHODE, 4 GREEN CATHODE
    expect(pinSummary(rgbCa)).toEqual([
      ['R', 'cathode', [0, 0]],
      ['A', 'anode', [1, 0]],
      ['B', 'cathode', [2, 0]],
      ['G', 'cathode', [3, 0]]
    ])
    expect(rgbCa.footprint).toEqual({ kind: 'rigid' })
  })

  it('declares pin A as the common anode', () => {
    expect(rgbCa.sim.params.commonPin).toBe('A') // Dialight schematic: anodes joined at pin 2
    expect(rgbCa.sim.params.commonType).toBe('anode')
  })

  it('carries per-channel forward voltage and ratings from the Dialight table', () => {
    const p = rgbCa.sim.params
    // Dialight OPERATING CHARACTERISTICS, VF at IF = 20 mA (min/typ/max)
    expect([p['red.vfMinV'], p['red.vfTypV'], p['red.vfMaxV']]).toEqual([1.7, 2.2, 2.7])
    expect([p['blue.vfMinV'], p['blue.vfTypV'], p['blue.vfMaxV']]).toEqual([2.5, 3.2, 3.7])
    expect([p['green.vfMinV'], p['green.vfTypV'], p['green.vfMaxV']]).toEqual([2.5, 3.2, 3.7])
    // Dialight ABSOLUTE MAXIMUM RATINGS: DC 30 mA each, PD 80/108/108 mW, peak 90/100/100 mA
    expect(p['red.ifMaxMa']).toBe(30)
    expect(p['red.pdMaxW']).toBe(0.08)
    expect(p['green.pdMaxW']).toBe(0.108)
    expect(p['blue.pdMaxW']).toBe(0.108)
    expect(p['red.ifPeakMa']).toBe(90)
    expect(p['green.ifPeakMa']).toBe(100)
    expect(p['blue.ifPeakMa']).toBe(100)
    expect(p['red.irMaxA']).toBe(1e-5) // Dialight: reverse current 10 uA max at VR = 5 V
  })

  it('is not in the kit', () => {
    expect(rgbCa.kitTags).toEqual(['not in kit']) // the kit LED is common cathode (rgb-led-cc)
    expect(rgbCa.sim.model).toBe('rgb-led')
  })

  it('takes the body from the Dialight drawing', () => {
    const g = rgbCa.geometry
    if (!('family' in g)) throw new Error('rgb geometry is a family')
    expect(g.params.bodyHeightMm).toBe(8.6) // Dialight: .339 [8,6]
    expect(g.params.flangeDiameterMm).toBe(5.8) // Dialight: dia .228 [5,8]
    expect(g.params.leadPitchNativeMm).toBe(1.27) // Dialight: .050 [1,27] 3 PL
  })
})

describe('ceramic-capacitor', () => {
  it('has two leads two pitches apart', () => {
    expect(pinSummary(ceramic)).toEqual([
      ['1', 'passive', [0, 0]],
      ['2', 'passive', [2, 0]]
    ])
    // KEMET C1059 p.2: lead spacing 5.08 +-0.38 mm = 2 pitches; 20 from the 31.75 mm minimum lead
    expect(ceramic.footprint).toEqual({ kind: 'flex-2lead', minSpan: 2, maxSpan: 20 })
    expect(ceramic.sim.model).toBe('capacitor')
  })

  it('defaults to the kit 104 value of 100 nF at 50 V', () => {
    expect(ceramic.properties.capacitance).toMatchObject({ default: 1e-7, unit: 'F' }) // 104 = 10 x 10^4 pF
    expect(ceramic.properties.ratedVoltage).toMatchObject({ default: 50 }) // C1059 p.4: 0.1 uF offered at 50 V
    expect(ceramic.sim.params.ratedVoltageV).toBe(50)
    expect(ceramic.kitTags).toEqual(['kit']) // component list image: Capacitor 104 x4
  })

  it('takes the body from the C052 dimensions row', () => {
    const g = ceramic.geometry
    if (!('family' in g)) throw new Error('ceramic geometry is a family')
    expect(g.family).toBe('ceramic-cap')
    expect(g.params.bodyLengthMm).toBe(4.83) // C1059 p.2: C05X length 4.83 +-0.25
    expect(g.params.bodyThicknessMm).toBe(2.29) // C1059 p.2: thickness 2.29 +-0.25
    expect(g.params.leadDiameterMm).toBe(0.635) // C1059 p.2: 0.025 in
    expect(ceramic.sim.params.dfMax).toBe(0.025) // C1059 p.3: DF 2.5% for 50 V to 250 V
    expect(ceramic.sim.params.tccMax).toBe(0.15) // C1059 p.3: X7R +-15%
  })
})

describe('electrolytic-capacitor', () => {
  it('has the positive lead first and the negative lead second', () => {
    // Nichicon UVR p.1 radial lead drawing: the long lead is marked plus, the short lead minus
    expect(pinSummary(electrolytic)).toEqual([
      ['+', 'positive', [0, 0]],
      ['-', 'negative', [1, 0]]
    ])
    // 6 = floor((3.5 + 2 x (15 - 8)) / 2.54); lead spacing 3.5 +-0.5 mm (UVR p.1 table, dia 8)
    expect(electrolytic.footprint).toEqual({ kind: 'flex-2lead', minSpan: 1, maxSpan: 6 })
    expect(electrolytic.sim.model).toBe('electrolytic')
  })

  it('is the 220 uF 25 V UVR1E221MPD row', () => {
    expect(electrolytic.properties.capacitance).toMatchObject({ default: 2.2e-4 }) // UVR part table
    expect(electrolytic.properties.ratedVoltage).toMatchObject({ default: 25 })
    expect(electrolytic.sim.params.ratedVoltageV).toBe(25)
    expect(electrolytic.sim.params.tanDeltaMax).toBe(0.16) // UVR p.1: tan delta 0.16 at 25 V
    expect(electrolytic.sim.params.leakageCoef2Min).toBe(0.01) // UVR p.1: 0.01CV uA after 2 minutes
    expect(electrolytic.sim.params.ratedRippleMa).toBe(330) // UVR part table, 85 C 120 Hz
    expect(electrolytic.sim.params.capTolPct).toBe(20) // UVR p.1: +-20% at 120 Hz
  })

  it('takes the body from the UVR dimensions', () => {
    const g = electrolytic.geometry
    if (!('family' in g)) throw new Error('electrolytic geometry is a family')
    expect(g.family).toBe('electrolytic-cap')
    expect(g.params.diameterMm).toBe(8) // UVR part table: 8 x 11.5
    expect(g.params.lengthMm).toBe(11.5)
    expect(g.params.leadSpacingMm).toBe(3.5) // UVR p.1 table: P = 3.5 for dia 8
    expect(g.params.leadDiameterMm).toBe(0.6) // UVR p.1 table: d = 0.6 for dia 8
  })

  it('is not in the kit', () => {
    expect(electrolytic.kitTags).toEqual(['not in kit']) // the component list has no electrolytic
  })
})

describe('diode-1n4007', () => {
  it('has the anode first and the cathode band second', () => {
    // Vishay 88503 p.1: "color band denotes cathode end"
    expect(pinSummary(diode)).toEqual([
      ['A', 'anode', [0, 0]],
      ['K', 'cathode', [1, 0]]
    ])
    // 15 = floor((5.2 + 2 x (25.4 - 8)) / 2.54); package outline p.4: body 5.2 max, leads 25.4 min
    expect(diode.footprint).toEqual({ kind: 'flex-2lead', minSpan: 1, maxSpan: 15 })
    expect(diode.sim.model).toBe('diode')
    expect(diode.kitTags).toEqual(['kit']) // component list image: 1N4007 x2
  })

  it('carries the 1N4007 column of the Vishay tables', () => {
    const p = diode.sim.params
    expect(p.vrrmV).toBe(1000) // p.1 maximum ratings: VRRM 1000 V
    expect(p.vrmsV).toBe(700) // p.1: VRMS 700 V
    expect(p.vdcV).toBe(1000) // p.1: VDC 1000 V
    expect(p.ifAvA).toBe(1.0) // p.1: IF(AV) 1.0 A
    expect(p.ifsmA).toBe(30) // p.1: IFSM 30 A, 8.3 ms half sine
    expect(p.vfMaxV).toBe(1.1) // p.2: maximum VF 1.1 V ...
    expect(p.vfTestA).toBe(1.0) // ... at IF = 1.0 A
    expect(p.irMaxA).toBe(5e-6) // p.2: IR 5.0 uA at 25 C
    expect(p.irMaxHotA).toBe(5e-5) // p.2: IR 50 uA at 125 C
    expect(p.cjTypF).toBe(1.5e-11) // p.2: CJ 15 pF at 4 V, 1 MHz
  })

  it('keeps the curve-read typical drop between 0.85 V and the 1.1 V maximum', () => {
    // Fig. 4 p.3 read by eye (about 0.92 V at 1 A); it is not a table value
    const typ = diode.sim.params.vfTypFig4V
    expect(typeof typ === 'number' && typ > 0.85 && typ < 1.1).toBe(true)
  })

  it('takes the body from the DO-41 outline', () => {
    const g = diode.geometry
    if (!('family' in g)) throw new Error('diode geometry is a family')
    expect(g.family).toBe('diode')
    expect(g.params.bodyLengthMm).toBe(5.2) // p.4: 0.205 (5.2) max, 0.160 (4.1) min
    expect(g.params.bodyDiameterMm).toBe(2.7) // p.4: 0.107 (2.7) max, 0.080 (2.0) min
    expect(g.params.leadLengthMinMm).toBe(25.4) // p.4: 1.0 (25.4) min
    expect(diode.bodyMm).toEqual([5.2, 2.7, 2.7])
  })
})

describe('potentiometer-10k', () => {
  it('has three terminals on a 5 mm pitch, mapped to a 2-pitch stride, with the wiper in the middle', () => {
    // Alpha RV16AF-20 p.3 outline: terminals at 5 + 5 mm; circuit: wiper on terminal 2
    expect(pinSummary(pot)).toEqual([
      ['1', 'passive', [0, 0]],
      ['2', 'wiper', [2, 0]],
      ['3', 'passive', [4, 0]]
    ])
    expect(pot.footprint).toEqual({ kind: 'rigid' })
    expect(pot.sim.model).toBe('potentiometer')
    expect(pot.kitTags).toEqual(['kit']) // component list image: Potentiometer (10k) x1
  })

  it('has a 10 kohm linear track over 300 degrees', () => {
    const p = pot.sim.params
    expect(p.totalResistanceOhm).toBe(10000) // SunFounder 2.1.3 and the component list: 10 kohm
    expect(p.rotationDeg).toBe(300) // Alpha p.1: total rotational angle 300 +-5 degrees
    expect(p.rotationTolDeg).toBe(5)
    expect(p.maxVoltageV).toBe(150) // Alpha p.1: 150 V AC
    expect(p.ratedPowerW).toBe(0.2) // Conrad-hosted Alpha RV16A-20 sheet: linear 0.2 W
    expect(p.taper).toBe('linear')
  })

  it('exposes the wiper as a percentage that defaults to the middle', () => {
    expect(pot.properties.wiper).toEqual({
      type: 'number',
      label: 'Wiper position',
      unit: '%',
      min: 0,
      max: 100,
      default: 50
    })
  })

  it('takes the 5 mm terminal pitch and body from the Alpha outline', () => {
    const g = pot.geometry
    if (!('family' in g)) throw new Error('potentiometer geometry is a family')
    expect(g.family).toBe('potentiometer')
    expect(g.params.pinPitchMm).toBe(5.0) // p.3: 5 and 5
    expect(g.params.pinLengthBelowBodyMm).toBe(3.5) // p.3: 3.5
    expect(g.params.shaftAxisHeightMm).toBe(12.5) // p.3: 12.5
    expect(g.params.bodyDiameterMm).toBe(16.5) // p.3: dia 16.5
    expect(g.params.frontWidthMm).toBe(17) // p.3: dia 17
    expect(g.params.bodyDepthMm).toBe(9.1) // p.3: 9.1
  })
})

describe('ldr', () => {
  it('has two leads, a 1-pitch minimum span and the lux property', () => {
    expect(pinSummary(ldr)).toEqual([
      ['1', 'passive', [0, 0]],
      ['2', 'passive', [1, 0]]
    ])
    // Senba GL55 p.3: lead pitch 3.0 mm; 20 = floor((3.0 + 2 x (33 - 8)) / 2.54), 33 mm minimum lead
    expect(ldr.footprint).toEqual({ kind: 'flex-2lead', minSpan: 1, maxSpan: 20 })
    expect(ldr.sim.model).toBe('ldr')
    expect(ldr.properties.lux).toMatchObject({ default: 100, min: 0 })
    expect(ldr.kitTags).toEqual(['kit']) // component list image: Photoresistor x2
  })

  it('carries the GL5528 row of the Senba table', () => {
    const p = ldr.sim.params
    expect(p.r10LuxMinOhm).toBe(10000) // Senba p.2: light resistance (10 lux) 10-20 kohm
    expect(p.r10LuxMaxOhm).toBe(20000)
    expect(p.darkMinOhm).toBe(1000000) // Senba p.2: dark resistance 1 Mohm
    expect(p.gamma).toBe(0.6) // Senba p.2: gamma 0.6 (SparkFun SEN-09088 says 0.7)
    expect(p.ratedPowerW).toBe(0.1) // Senba p.1: 100 mW
    expect(p.maxVoltageV).toBe(150) // Senba p.1: 150 V
    expect(p.peakWavelengthNm).toBe(540) // Senba p.1: 540 nm
  })

  it('keeps the nominal 10 lux resistance inside the datasheet range', () => {
    const p = ldr.sim.params
    const r10 = p.r10LuxOhm
    expect(typeof r10 === 'number' && r10 >= 10000 && r10 <= 20000).toBe(true)
  })

  it('takes the body from the Senba dimension drawing', () => {
    const g = ldr.geometry
    if (!('family' in g)) throw new Error('ldr geometry is a family')
    expect(g.family).toBe('ldr')
    expect(g.params.discDiameterMm).toBe(5.1) // p.3: dia 5.1 +-0.1
    expect(g.params.flatHeightMm).toBe(4.3) // p.3: 4.3 +-0.2
    expect(g.params.thicknessMm).toBe(2.1) // p.3: 2.1 +-0.2
    expect(g.params.leadPitchMm).toBe(3.0) // p.3: 3.0 +-0.1
    expect(g.params.leadDiameterMm).toBe(0.5) // p.3: dia 0.50 +-0.05
    expect(g.params.leadLengthMm).toBe(34) // p.3: 34 +-1
  })
})

describe('ntc-10k', () => {
  it('has two leads, a 1-pitch minimum span and the temperature property', () => {
    expect(pinSummary(ntc)).toEqual([
      ['1', 'passive', [0, 0]],
      ['2', 'passive', [1, 0]]
    ])
    expect(ntc.footprint).toEqual({ kind: 'flex-2lead', minSpan: 1, maxSpan: 6 })
    expect(ntc.sim.model).toBe('ntc')
    expect(ntc.properties.temperatureC).toMatchObject({ default: 25, min: -20, max: 120 }) // Semiware p.1: -20 to 120 C
    expect(ntc.kitTags).toEqual(['kit']) // component list image: Thermistor x1
  })

  it('carries R25 and the B value from the Semiware electrical table', () => {
    const p = ntc.sim.params
    expect(p.r25Ohm).toBe(10000) // Semiware p.1: R25 10 kohm +-1%
    expect(p.betaK).toBe(3950) // Semiware p.1: B25/50 3950 K +-1%; SunFounder 2.2.2 also uses 3950
    expect(p.betaTolPct).toBe(1)
    expect(p.dissipationMinWPerK).toBe(0.002) // Semiware p.1: at least 2 mW/C
    expect(p.timeConstantMaxS).toBe(7) // Semiware p.1: at most 7 s
  })

  it('carries resistance-temperature table points from Exhibit 1', () => {
    const p = ntc.sim.params
    expect(p.rAtMinus20CelsiusOhm).toBe(97839.6) // Exhibit 1: -20 C 97.8396 kohm
    expect(p.rAt0CelsiusOhm).toBe(32754.7) // Exhibit 1: 0 C 32.7547 kohm
    expect(p.rAt50CelsiusOhm).toBe(3588.2) // Exhibit 1: 50 C 3.5882 kohm
    expect(p.rAt85CelsiusOhm).toBe(1058) // Exhibit 1: 85 C 1.0580 kohm
    expect(p.rAt100CelsiusOhm).toBe(667.6) // Exhibit 1: 100 C 0.6676 kohm
    expect(p.rAt125CelsiusOhm).toBe(332.6) // Exhibit 1: 125 C 0.3326 kohm
  })

  it('has table points that reproduce B25/50 within half a percent', () => {
    const p = ntc.sim.params
    const r25 = Number(p.r25Ohm)
    const r50 = Number(p.rAt50CelsiusOhm)
    const beta = Math.log(r25 / r50) / (1 / 298.15 - 1 / 323.15)
    expect(Math.abs(beta - 3950) / 3950).toBeLessThan(0.005)
  })

  it('takes the body from the Semiware outline', () => {
    const g = ntc.geometry
    if (!('family' in g)) throw new Error('ntc geometry is a family')
    expect(g.family).toBe('ntc')
    expect(g.params.bodyDiameterMm).toBe(2.2) // p.1: D max 2.2 (range 1.8-2.2)
    expect(g.params.bodyLengthMm).toBe(4) // p.1: L1 4 mm
    expect(g.params.totalLengthMaxMm).toBe(32) // p.1: L max 32 mm
    expect(g.params.leadSpacingMm).toBe(2.0) // p.1: F 2.0 mm
  })
})
