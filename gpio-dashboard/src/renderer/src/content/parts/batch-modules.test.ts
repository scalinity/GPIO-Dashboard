// Datasheet facts for the sensor and module parts of this batch. Each assertion cites where the
// number comes from, so a definition cannot drift away from its source without a test failing.
import { describe, expect, it } from 'vitest'
import { loadPartDef } from '../../core/defs/parts'
import type { PartDef } from '../../core/model/types'

const raw = import.meta.glob<unknown>('./*.part.json', { eager: true, import: 'default' })

function part(id: string): PartDef {
  return loadPartDef(`../../content/parts/${id}.part.json`, raw[`./${id}.part.json`])
}

const pinIds = (def: PartDef): string[] => def.pins.map((p) => p.id)
const pinLabels = (def: PartDef): string[] => def.pins.map((p) => p.label)
const pin = (def: PartDef, id: string) => {
  const found = def.pins.find((p) => p.id === id)
  if (!found) throw new Error(`${def.id} has no pin ${id}`)
  return found
}

const BATCH = [
  'dht11-module',
  'dht11',
  'joystick-module',
  'sg90',
  'hc-sr04',
  'hc-sr501',
  'lcd1602-i2c',
  'keypad-4x4',
  'ads1115-module',
  'ads7830-module'
]

describe('the batch as a whole', () => {
  it('has a definition file for every part of the batch', () => {
    for (const id of BATCH) expect(raw[`./${id}.part.json`], id).toBeDefined()
  })

  it('tags only the DHT11 module and the ADS7830 module as in the kit', () => {
    // SunFounder Basic Starter Kit Component List photo (Basic_List.jpg): "DHT11 Temperature and
    // Humidity Module x1" and "ADS7830 Module x1"; the lesson list has no other part of this batch.
    const inKit = BATCH.filter((id) => part(id).kitTags.includes('kit'))
    expect(inKit.sort()).toEqual(['ads7830-module', 'dht11-module'])
    for (const id of BATCH.filter((b) => !inKit.includes(b))) {
      expect(part(id).kitTags).toEqual(['not in kit'])
    }
  })

  it('gives every off-board module pin a connector gender and a distinct position', () => {
    // SPEC 6.5: each module's part def records its connector gender per pin.
    for (const id of BATCH) {
      const def = part(id)
      if (def.footprint.kind !== 'offboard') continue
      expect(
        def.pins.every((p) => p.connector === 'male-pin' || p.connector === 'female-socket'),
        id
      ).toBe(true)
      const positions = def.pins.map((p) => p.offsetPitch.join(','))
      expect(new Set(positions).size, `${id} pin positions`).toBe(def.pins.length)
    }
  })
})

describe('dht11-module (the kit module)', () => {
  const def = part('dht11-module')

  it('lists the breakout pins as S, VCC, GND in the printed order', () => {
    // Kit wiring diagram 2.2.3.png: left pin to GPIO17, middle to the + rail, right to the - rail;
    // silkscreen prints S and - at the ends (SunFounder 12-component_dht11 photo).
    expect(pinIds(def)).toEqual(['DATA', 'VCC', 'GND'])
    expect(pinLabels(def)).toEqual(['S', 'VCC', '-'])
  })

  it('has male header pins on all three positions in a row', () => {
    // Kit and SunFounder photos show a 3-pin male header.
    expect(def.pins.map((p) => p.connector)).toEqual(['male-pin', 'male-pin', 'male-pin'])
    expect(def.pins.map((p) => p.offsetPitch)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0]
    ])
  })

  it('has a 10 kOhm on-board pull-up from DATA to VCC', () => {
    // SunFounder module photo: SMD R1 marked "103"; schematic label "10k" (the drawn topology is
    // wrong, see the part notes). arduinomodules.info says 1 kOhm for KY-015: recorded conflict.
    expect(def.sim.params.dataPullupOhm).toBe(10000)
    expect(def.sim.params.dataPullupTo).toBe('VCC')
  })

  it('runs from 3.3 V to 5.5 V and uses the dht11 model', () => {
    // Aosong DHT11 Product Manual: Power supply DC 3.3 ~ 5.5 V.
    expect(def.sim.model).toBe('dht11')
    expect(def.sim.params.vccMinV).toBe(3.3)
    expect(def.sim.params.vccMaxV).toBe(5.5)
  })

  it('exposes temperature and humidity inputs over the sensor range', () => {
    // OSEPP-translated DHT11 datasheet: 0-50 C and 20-90 %RH.
    expect(def.properties.temperatureC).toMatchObject({ type: 'number', min: 0, max: 50 })
    expect(def.properties.humidityPct).toMatchObject({ type: 'number', min: 20, max: 90 })
  })
})

describe('dht11 (bare 4-pin sensor)', () => {
  const def = part('dht11')

  it('orders the pins VDD, DATA, NC, GND as in the Aosong pin description', () => {
    // Aosong DHT11 Product Manual section 5: 1 VDD, 2 DATA, 3 NC, 4 GND.
    expect(pinIds(def)).toEqual(['VDD', 'DATA', 'NC', 'GND'])
    expect(pin(def, 'NC')).toMatchObject({ role: 'nc', electricalType: 'nc' })
  })

  it('is a rigid part with four pins at 2.54 mm spacing', () => {
    // Aosong drawing: 1pin to 4pin at 2.54 mm pitch.
    expect(def.footprint).toEqual({ kind: 'rigid' })
    expect(def.pins.map((p) => p.offsetPitch)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0]
    ])
    expect(def.pins.some((p) => p.connector)).toBe(false)
  })

  it('is not in the kit because the kit ships the 3-pin module', () => {
    // Kit Component List photo: "DHT11 Temperature and Humidity Module x1".
    expect(def.kitTags).toEqual(['not in kit'])
  })

  it('records supply, accuracy and resolution from the datasheets', () => {
    // Aosong manual: DC 3.3-5.5 V, humidity +-5 %RH, temperature +-2 C; OSEPP: 1 %RH and 1 C steps.
    expect(def.sim.params).toMatchObject({
      vccMinV: 3.3,
      vccMaxV: 5.5,
      humidityAccuracyPct: 5,
      temperatureAccuracyC: 2,
      humidityResolutionPct: 1,
      temperatureResolutionC: 1
    })
  })

  it('records the single-wire timing', () => {
    // Aosong manual: start low >= 18 ms, 80 us response low then 80 us high, 50 us bit start,
    // 26-28 us high for a 0 and 70 us for a 1, 40 bits; OSEPP: host release 20-40 us.
    expect(def.sim.params).toMatchObject({
      startLowMinMs: 18,
      hostReleaseMinUs: 20,
      hostReleaseMaxUs: 40,
      responseLowUs: 80,
      responseHighUs: 80,
      bitStartLowUs: 50,
      bitZeroHighMinUs: 26,
      bitZeroHighMaxUs: 28,
      bitOneHighUs: 70,
      frameBits: 40
    })
  })

  it('has no on-board pull-up and needs about 5.1 kOhm outside', () => {
    // Aosong manual: single bus "usually requires an external approximately 5.1 kOhm pull up".
    expect(def.sim.params.onBoardPullup).toBe(false)
    expect(def.sim.params.externalPullupRecommendedOhm).toBe(5100)
  })
})

describe('joystick-module', () => {
  const def = part('joystick-module')

  it('lists the pins GND, +5V, VRX, VRY, SW in the printed order', () => {
    // SunFounder joystick photo: header printed GND, +5V, VRX, VRY, SW top to bottom.
    expect(pinLabels(def)).toEqual(['GND', '+5V', 'VRX', 'VRY', 'SW'])
    expect(pinIds(def)).toEqual(['GND', 'VCC', 'VRX', 'VRY', 'SW'])
    expect(def.pins.every((p) => p.connector === 'male-pin')).toBe(true)
  })

  it('outputs the two axes as analog levels and the button as a switch contact', () => {
    // SunFounder schematic: two pots between VCC and GND with wipers VRX and VRY; SW is a switch to GND.
    expect(pin(def, 'VRX').role).toBe('analog-out')
    expect(pin(def, 'VRY').role).toBe('analog-out')
    expect(pin(def, 'SW')).toMatchObject({ role: 'switch', electricalType: 'passive' })
  })

  it('has no on-board pull-up on SW', () => {
    // SunFounder page: "The pushbutton switch outputs a floating signal by default"; R1 pad is empty.
    expect(def.sim.params.swOnBoardPullup).toBe(false)
  })

  it('accepts a 3.3 V to 5 V supply', () => {
    // SunFounder: "Supply Voltage: 3.3V or 5V"; Joy-IT KY-023 datasheet: operating voltage 3.3 V.
    expect(def.sim.params.vccMinV).toBe(3.3)
    expect(def.sim.params.vccMaxV).toBe(5)
  })

  it('has x and y sliders from 0 to 100 and a pressed switch', () => {
    // SPEC 11.4 environment inputs for the joystick.
    expect(def.properties.x).toMatchObject({ type: 'number', min: 0, max: 100 })
    expect(def.properties.y).toMatchObject({ type: 'number', min: 0, max: 100 })
    expect(def.properties.pressed).toMatchObject({ type: 'boolean', default: false })
  })
})

describe('sg90', () => {
  const def = part('sg90')

  it('lists brown GND, red VCC, orange PWM on a female socket', () => {
    // SunFounder SG90 page: brown GND, orange signal, red VCC; photo: 3-position socket housing.
    expect(pinIds(def)).toEqual(['GND', 'VCC', 'PWM'])
    expect(def.pins.map((p) => p.label)).toEqual(['Brown (GND)', 'Red (VCC)', 'Orange (signal)'])
    expect(def.pins.every((p) => p.connector === 'female-socket')).toBe(true)
  })

  it('uses a 20 ms period and maps 1.0, 1.5 and 2.0 ms to -90, 0 and +90 degrees', () => {
    // SunFounder: a pulse every 20 ms, 1.5 ms is neutral; SG90 data sheet: 1.5 ms middle,
    // ~2 ms and ~1 ms the two ends of the +-90 degree travel.
    expect(def.sim.params).toMatchObject({
      pwmPeriodMs: 20,
      pulseCenterUs: 1500,
      pulseMinUs: 1000,
      pulseMaxUs: 2000,
      angleMinDeg: -90,
      angleMaxDeg: 90
    })
  })

  it('moves at 0.1 s per 60 degrees on 4.8 V with 1.8 kgf-cm of stall torque', () => {
    // SG90 data sheet and TowerPro page: 0.1 sec/60 degree, stall torque 1.8 kgf-cm at 4.8 V.
    expect(def.sim.params).toMatchObject({
      speedSecPer60Deg: 0.1,
      speedAtVccV: 4.8,
      stallTorqueKgfCm: 1.8
    })
  })

  it('runs from 4.8 V up to 6 V', () => {
    // SG90 data sheet: 4.8 V (~5 V); TowerPro: "Voltages from 4.8V - 6V are fine".
    expect(def.sim.params).toMatchObject({ vccMinV: 4.8, vccMaxV: 6 })
  })
})

describe('hc-sr04', () => {
  const def = part('hc-sr04')

  it('lists Vcc, Trig, Echo, GND on male pins', () => {
    // Elecfreaks datasheet wiring: Vcc, Trig, Echo, GND; SunFounder photo: 4-pin male header.
    expect(pinIds(def)).toEqual(['VCC', 'TRIG', 'ECHO', 'GND'])
    expect(pinLabels(def)).toEqual(['Vcc', 'Trig', 'Echo', 'Gnd'])
    expect(def.pins.every((p) => p.connector === 'male-pin')).toBe(true)
  })

  it('is powered from 5 V and draws 15 mA', () => {
    // Elecfreaks datasheet: Working Voltage DC 5 V, Working Current 15 mA.
    expect(def.sim.params).toMatchObject({ vccMinV: 5, vccMaxV: 5, workingCurrentMa: 15 })
  })

  it('drives ECHO high at 5 V, so a 3.3 V GPIO needs a divider', () => {
    // Datasheet: ECHO is a TTL-level output on a 5 V supply; e-yantra: "ECHO outputs 5V. Use a voltage
    // divider (1k + 2k) to bring it down to 3.3V"; pimylifeup agrees (SPEC 8 OVERVOLTAGE_GPIO).
    expect(def.sim.params.echoOutputHighV).toBe(5)
    expect(def.sim.params.echoOutputHighV).toBeGreaterThan(3.3)
    expect(pin(def, 'ECHO')).toMatchObject({ role: 'logic-out', electricalType: 'output' })
  })

  it('takes a 10 us trigger pulse and reports 2 to 400 cm within 15 degrees', () => {
    // Elecfreaks datasheet: 10uS TTL trigger, 2 cm - 400 cm, measuring angle 15 degree, uS / 58 = cm.
    expect(def.sim.params).toMatchObject({
      trigPulseMinUs: 10,
      rangeMinCm: 2,
      rangeMaxCm: 400,
      measuringAngleDeg: 15,
      echoUsPerCm: 58
    })
    expect(def.properties.distanceCm).toMatchObject({ type: 'number', min: 2, max: 400 })
  })
})

describe('hc-sr501', () => {
  const def = part('hc-sr501')

  it('lists VCC, OUT, GND on male pins', () => {
    // SunFounder back-of-board drawing: VCC OUT GND; components101: pin 1 Vcc, 2 Dout, 3 Ground.
    expect(pinIds(def)).toEqual(['VCC', 'OUT', 'GND'])
    expect(def.pins.every((p) => p.connector === 'male-pin')).toBe(true)
  })

  it('outputs 3.3 V high, so it is safe for a 3.3 V GPIO', () => {
    // ElecFreaks specification: Level output High 3.3 V / Low 0 V.
    expect(def.sim.params.outputHighV).toBe(3.3)
    expect(def.sim.params.outputLowV).toBe(0)
  })

  it('takes 4.5 V to 20 V', () => {
    // ElecFreaks specification: operating voltage range DC 4.5-20 V (SunFounder says 5-20 V).
    expect(def.sim.params).toMatchObject({ vccMinV: 4.5, vccMaxV: 20 })
  })

  it('holds the output for 5 to 200 s and blocks for 2.5 s by default', () => {
    // ElecFreaks specification: delay time 5-200 S, block time 2.5 S (default).
    expect(def.sim.params).toMatchObject({ delayMinS: 5, delayMaxS: 200, blockTimeS: 2.5 })
  })

  it('selects repeatable (H) or non-repeatable (L) trigger by jumper, repeatable by default', () => {
    // ElecFreaks: "L can not be repeated trigger / H can be repeated trigger (Default repeated trigger)".
    expect(def.sim.params.triggerModeDefault).toBe('H')
    expect(String(def.sim.params.triggerJumper)).toContain('L = non-repeatable')
    expect(String(def.sim.params.triggerJumper)).toContain('H = repeatable')
  })

  it('has a motion input', () => {
    // SPEC 11.4: PIR environment input.
    expect(def.properties.motion).toMatchObject({ type: 'boolean', default: false })
  })
})

describe('lcd1602-i2c', () => {
  const def = part('lcd1602-i2c')

  it('lists GND, VCC, SDA, SCL on male pins', () => {
    // SunFounder backpack photo (26_back_lcd1602.jpg): header printed GND, VCC, SDA, SCL.
    expect(pinIds(def)).toEqual(['GND', 'VCC', 'SDA', 'SCL'])
    expect(def.pins.every((p) => p.connector === 'male-pin')).toBe(true)
  })

  it('answers at 0x27 for a PCF8574 backpack and 0x3F for a PCF8574A backpack', () => {
    // TI PCF8574 datasheet 7.3.3: 0100 A2 A1 A0 = 0x20-0x27; TI PCF8574A: 0111 A2 A1 A0 = 0x38-0x3F;
    // pads open pull the address pins high (SunFounder: default 0x27, in a few cases 0x3F).
    expect(def.sim.params).toMatchObject({
      i2cAddress: '0x27',
      i2cAddressAlt: '0x3F',
      i2cAddressPcf8574: '0x20-0x27',
      i2cAddressPcf8574a: '0x38-0x3F'
    })
  })

  it('pulls SDA and SCL up with 4.7 kOhm to VCC', () => {
    // Silicon Chip "El Cheapo Modules Part 5": 4.7 kOhm pull-up on each of SDA and SCL (rail deduced:
    // VCC is the only positive pin). Not read from the SunFounder board's own schematic.
    expect(def.sim.params.i2cPullupOhm).toBe(4700)
    expect(def.sim.params.i2cPullupTo).toBe('VCC')
  })

  it('puts the I2C lines at the supply voltage, 5 V when powered from 5 V', () => {
    // Pull-ups to VCC with a 5 V supply (LCD-1602A datasheet: VDD 4.5-5.5 V) means idle SDA/SCL at
    // about 5 V: the OVERVOLTAGE_GPIO case in SPEC 8.
    expect(def.sim.params.i2cIdleHighLevel).toBe('VCC')
    expect(def.sim.params).toMatchObject({ vccNominalV: 5, vccMinV: 4.5, vccMaxV: 5.5 })
  })

  it('uses 10 kOhm pull-ups to VCC on the address pads', () => {
    // Silicon Chip: A0-A2 each have a 10 kOhm pull-up to logic high (VCC).
    expect(def.sim.params).toMatchObject({
      i2cAddressPadsPullupOhm: 10000,
      i2cAddressPadsPullupTo: 'VCC'
    })
  })
})

describe('keypad-4x4', () => {
  const def = part('keypad-4x4')

  it('lists R1-R4 then C1-C4 in connector order on female sockets', () => {
    // SunFounder keypad schematic (keypad314.png): header R1 R2 R3 R4 C1 C2 C3 C4; protosupplies:
    // cable ends in a 2.54 mm 1x8 female header (SPEC 6.5: female sockets).
    expect(pinIds(def)).toEqual(['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'])
    expect(def.pins.every((p) => p.connector === 'female-socket')).toBe(true)
    expect(def.pins.map((p) => p.offsetPitch[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('is a 4 by 4 switch matrix with the printed key layout', () => {
    // SunFounder schematic: rows 1-2-3-A, 4-5-6-B, 7-8-9-C, *-0-#-D; plain switches, no diodes.
    expect(def.sim.model).toBe('keypad-4x4')
    expect(def.sim.params).toMatchObject({
      rows: 4,
      columns: 4,
      keyLayout: '123A456B789C*0#D',
      diodes: false
    })
  })

  it('has no pull-up or pull-down resistors of its own', () => {
    // SunFounder: pull-up or pull-down resistors must be added to the input wires.
    expect(def.sim.params.onBoardPullups).toBe(false)
  })
})

describe('ads1115-module', () => {
  const def = part('ads1115-module')

  it('lists VDD, GND, SCL, SDA, ADDR, ALRT, A0-A3 on male pins', () => {
    // Adafruit pinout page and photo: VIN GND SCL SDA ADDR ALRT, then A0-A3 (A+/A- are outputs).
    expect(pinIds(def)).toEqual([
      'VDD',
      'GND',
      'SCL',
      'SDA',
      'ADDR',
      'ALRT',
      'A0',
      'A1',
      'A2',
      'A3'
    ])
    expect(def.pins.every((p) => p.connector === 'male-pin')).toBe(true)
  })

  it('takes 2 V to 5 V on the board', () => {
    // Adafruit: "Acceptable voltages are 2V to 5V"; TI datasheet chip limit is 2.0-5.5 V.
    expect(def.sim.params).toMatchObject({
      vccMinV: 2,
      vccMaxV: 5,
      chipVddMinV: 2,
      chipVddMaxV: 5.5
    })
  })

  it('selects 0x48 to 0x4B with ADDR tied to GND, VDD, SDA or SCL', () => {
    // TI ADS1115 datasheet Table 7-2; Adafruit address table.
    expect(def.sim.params).toMatchObject({
      i2cAddress: '0x48',
      i2cAddressAddrGnd: '0x48',
      i2cAddressAddrVdd: '0x49',
      i2cAddressAddrSda: '0x4A',
      i2cAddressAddrScl: '0x4B'
    })
  })

  it('pulls SDA and SCL up to VDD with 10 kOhm, so a 5 V supply puts 5 V on the bus', () => {
    // Adafruit pinout page: "This pin has a 10K pullup to VIN" for SDA and SCL; schematics show R to VDD.
    expect(def.sim.params).toMatchObject({
      i2cPullupOhm: 10000,
      i2cPullupTo: 'VDD',
      i2cIdleHighLevel: 'VDD'
    })
  })

  it('offers six gain ranges and eight data rates at 16 bits', () => {
    // TI datasheet Table 7-1 and electrical characteristics: FSR +-6.144 to +-0.256 V; 8-860 SPS.
    expect(def.sim.params).toMatchObject({
      resolutionBits: 16,
      pgaRangesV: '6.144,4.096,2.048,1.024,0.512,0.256',
      dataRatesSps: '8,16,32,64,128,250,475,860'
    })
  })

  it('limits the digital pins to 5.5 V and the analog inputs to VDD + 0.3 V', () => {
    // TI datasheet absolute maximum ratings.
    expect(def.sim.params).toMatchObject({ digitalInMaxV: 5.5, analogInMaxAboveVddV: 0.3 })
  })

  it('is not the ADC the kit ships', () => {
    // The kit's ADC is the ADS7830 module.
    expect(def.kitTags).toEqual(['not in kit'])
  })
})

describe('ads7830-module (the kit ADC)', () => {
  const def = part('ads7830-module')

  it('is in the kit and uses the ads1115 model as the closest available', () => {
    // Kit Component List: "ADS7830 Module x1"; no ADS7830 sim model exists yet.
    expect(def.kitTags).toEqual(['kit'])
    expect(def.sim.model).toBe('ads1115')
  })

  it('lists A0-A7 then VCC, SDA, SCL, GND on male pins', () => {
    // Kit module drawing (ADS7830_Module.png): left column A0-A7, right column VCC SDA SCL GND.
    expect(pinIds(def)).toEqual([
      'A0',
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'A6',
      'A7',
      'VCC',
      'SDA',
      'SCL',
      'GND'
    ])
    expect(def.pins.every((p) => p.connector === 'male-pin')).toBe(true)
  })

  it('answers at the fixed address 0x48 with no address pins on the module', () => {
    // Kit table: "IIC Serial Clock Address 0x48"; the lesson code probes 0x48; TI sets 0x48-0x4B by A1/A0.
    expect(def.sim.params).toMatchObject({
      i2cAddress: '0x48',
      i2cAddressRangeChip: '0x48-0x4B',
      addressPinsOnModule: false
    })
  })

  it('reads 8 channels at 8 bits against a 2.5 V internal reference that is off at power-up', () => {
    // TI ADS7830 datasheet: 8 single-ended / 4 differential inputs, 8 bits, built-in 2.5 V reference,
    // defaults to off, 70 kHz sampling.
    expect(def.sim.params).toMatchObject({
      channels: 8,
      differentialPairs: 4,
      resolutionBits: 8,
      internalReferenceV: 2.5,
      internalReferenceDefaultOn: false,
      maxSampleRateKsps: 70
    })
  })

  it('takes a 2.7 V to 5.25 V supply and never more than 6 V', () => {
    // TI datasheet: 2.7 V to 5 V operation (4.75-5.25 V specified at 5 V); +VDD absolute maximum 6 V.
    expect(def.sim.params).toMatchObject({ vccMinV: 2.7, vccMaxV: 5.25, vccAbsMaxV: 6 })
  })

  it('marks the on-board I2C pull-ups as unverified', () => {
    // The kit publishes no schematic for the module (R1-R3, LED1, C1 are visible, roles are not).
    expect(def.sim.params.i2cPullupVerified).toBe(false)
    expect(def.sim.params.i2cPullupOhm).toBeUndefined()
  })
})
