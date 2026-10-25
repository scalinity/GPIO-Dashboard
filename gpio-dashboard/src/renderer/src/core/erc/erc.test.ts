// Each ERC rule fires on its positive fixture and stays quiet on its negative one (SPEC 8, 18).
// Bench strips: 3V3 rows 1/9 a-e, 5V rows 1/2 f-j, GND row 5 a-e and rows 3/7/10 f-j,
// GPIO17 row 6 a-e, GPIO18 row 6 f-j, GPIO2 (SDA) row 2 a-e.
import { describe, expect, it } from 'vitest'
import type { CircuitDoc, Endpoint, PartDef } from '../model/types'
import { validateDoc } from '../ops/validate'
import {
  at,
  CUSTOM_RES,
  emptyDoc,
  fixtureDefs,
  hole,
  LED,
  MODULE,
  part,
  RES,
  wire
} from '../testing/fixtures'
import { erc } from './erc'

const NPN: PartDef = {
  ...RES,
  id: 'test-npn',
  name: 'Test NPN',
  category: 'semiconductor',
  pins: [
    { id: 'E', label: 'E', role: 'emitter', electricalType: 'passive', offsetPitch: [0, 0] },
    { id: 'B', label: 'B', role: 'base', electricalType: 'input', offsetPitch: [1, 0] },
    { id: 'C', label: 'C', role: 'collector', electricalType: 'passive', offsetPitch: [2, 0] }
  ],
  footprint: { kind: 'rigid' },
  sim: { model: 'npn', params: {} },
  properties: {}
}
const BUZZER: PartDef = {
  ...LED,
  id: 'test-buzzer',
  name: 'Test buzzer',
  category: 'audio',
  pins: [
    { id: '+', label: '+', role: 'positive', electricalType: 'passive', offsetPitch: [0, 0] },
    { id: '-', label: '−', role: 'negative', electricalType: 'passive', offsetPitch: [1, 0] }
  ],
  sim: { model: 'active-buzzer', params: {} }
}
const ECHO: PartDef = {
  ...MODULE,
  id: 'test-echo',
  name: 'Test 5 V output module',
  sim: { model: 'hc-sr04', params: { outputHighV: 5 } }
}
const I2C: PartDef = {
  ...MODULE,
  id: 'test-i2c',
  name: 'Test I2C module',
  pins: [
    {
      id: 'VCC',
      label: 'VCC',
      role: 'power',
      electricalType: 'power-in',
      offsetPitch: [0, 0],
      connector: 'male-pin'
    },
    {
      id: 'SDA',
      label: 'SDA',
      role: 'logic-io',
      electricalType: 'bidirectional',
      offsetPitch: [1, 0],
      connector: 'male-pin'
    },
    {
      id: 'GND',
      label: 'GND',
      role: 'ground',
      electricalType: 'power-in',
      offsetPitch: [2, 0],
      connector: 'male-pin'
    }
  ],
  sim: { model: 'lcd1602-i2c', params: { i2cPullupTo: 'VCC' } }
}
const NO_SHEET: PartDef = { ...RES, id: 'test-nosheet', kitTags: ['no datasheet'] }
const EXTRA = new Map([NPN, BUZZER, ECHO, I2C, NO_SHEET].map((d) => [d.id, d]))
const defs = (id: string) => EXTRA.get(id) ?? fixtureDefs(id)

const codes = (doc: CircuitDoc, code?: string) =>
  erc(doc, defs)
    .filter((i) => !code || i.code === code)
    .map((i) => `${i.code}:${i.severity}`)

const doc = (build: (d: CircuitDoc) => void, source = '') => {
  const d = emptyDoc()
  d.code.source = source
  build(d)
  return d
}
const pin = (p: string, id: string): Endpoint => ({ pin: { part: p, pin: id } })

describe('ERC rules', () => {
  it('SHORT_SUPPLY: 3V3 joined to GND', () => {
    expect(
      codes(
        doc((d) => d.wires.push(wire('W1', at(1, 'a'), at(5, 'a')))),
        'SHORT_SUPPLY'
      )
    ).toEqual(['SHORT_SUPPLY:error'])
    expect(codes(emptyDoc())).toEqual([])
  })

  it('GPIO_TO_SUPPLY_DIRECT: an output wired straight to GND, but not an input', () => {
    const short = (mode: string) =>
      doc(
        (d) => d.wires.push(wire('W1', at(6, 'a'), at(5, 'b'))),
        `import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.${mode})`
      )
    expect(codes(short('OUT'), 'GPIO_TO_SUPPLY_DIRECT')).toEqual(['GPIO_TO_SUPPLY_DIRECT:error'])
    expect(codes(short('IN'), 'GPIO_TO_SUPPLY_DIRECT')).toEqual([])
  })

  it('OVERVOLTAGE_GPIO: 5V on a GPIO directly, or pulled up to 5V, but not through a divider', () => {
    expect(
      codes(
        doc((d) => d.wires.push(wire('W1', at(1, 'i'), at(6, 'a')))),
        'OVERVOLTAGE_GPIO'
      )
    ).toContain('OVERVOLTAGE_GPIO:error')
    const pulledUp = (divider: boolean) =>
      doc((d) => {
        d.parts.push(part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: hole(32, 'a') }))
        d.wires.push(wire('W1', at(1, 'i'), at(30, 'b')), wire('W2', at(32, 'b'), at(6, 'a')))
        if (divider) {
          d.parts.push(part('R2', 'test-resistor', { 1: hole(32, 'c'), 2: hole(34, 'c') }))
          d.wires.push(wire('W3', at(34, 'd'), at(5, 'a')))
        }
      })
    expect(codes(pulledUp(false), 'OVERVOLTAGE_GPIO')).toEqual(['OVERVOLTAGE_GPIO:error'])
    expect(codes(pulledUp(true), 'OVERVOLTAGE_GPIO')).toEqual([])
  })

  it('OVERVOLTAGE_GPIO: a 5 V module output straight into a GPIO, and I2C pull-ups to a 5 V supply', () => {
    const echo = doc((d) => {
      d.parts.push(part('U1', 'test-echo', { VCC: null, OUT: null, GND: null }))
      d.wires.push(wire('W1', at(6, 'a'), pin('U1', 'OUT'), 'dupont-mf'))
    })
    expect(codes(echo, 'OVERVOLTAGE_GPIO')).toEqual(['OVERVOLTAGE_GPIO:error'])
    const i2c = (supply: Endpoint) =>
      doc((d) => {
        d.parts.push(part('U2', 'test-i2c', { VCC: null, SDA: null, GND: null }))
        d.wires.push(
          wire('W1', supply, pin('U2', 'VCC'), 'dupont-mf'),
          wire('W2', at(2, 'a'), pin('U2', 'SDA'), 'dupont-mf')
        )
      })
    expect(codes(i2c(at(2, 'i')), 'OVERVOLTAGE_GPIO')).toEqual(['OVERVOLTAGE_GPIO:warning'])
    expect(codes(i2c(at(9, 'a')), 'OVERVOLTAGE_GPIO')).toEqual([])
  })

  it('LED_NO_LIMIT: an LED straight between 3V3 and a GPIO, not with a series resistor', () => {
    const led = (withResistor: boolean) =>
      doc((d) => {
        d.parts.push(part('D1', 'test-led', { A: hole(30, 'a'), K: hole(31, 'a') }))
        d.wires.push(wire('W2', at(31, 'b'), at(6, 'a')))
        if (withResistor) {
          d.parts.push(part('R1', 'test-resistor', { 1: hole(27, 'a'), 2: hole(30, 'c') }))
          d.wires.push(wire('W1', at(1, 'a'), at(27, 'b')))
        } else d.wires.push(wire('W1', at(1, 'a'), at(30, 'b')))
      })
    expect(codes(led(false), 'LED_NO_LIMIT')).toEqual(['LED_NO_LIMIT:error'])
    expect(codes(led(true), 'LED_NO_LIMIT')).toEqual([])
  })

  it('LED_REVERSED: anode toward GND and cathode toward the supply', () => {
    const led = (a: number, k: number) =>
      doc((d) => {
        d.parts.push(part('R1', 'test-resistor', { 1: hole(27, 'a'), 2: hole(30, 'a') }))
        d.parts.push(part('D1', 'test-led', { A: hole(30, 'c'), K: hole(31, 'c') }))
        d.wires.push(wire('W1', at(a, 'b'), at(27, 'b')), wire('W2', at(31, 'b'), at(k, 'b')))
      })
    expect(codes(led(5, 1), 'LED_REVERSED')).toEqual(['LED_REVERSED:error'])
    expect(codes(led(1, 5), 'LED_REVERSED')).toEqual([])
  })

  it('COMPONENT_SHORTED: both leads in one strip', () => {
    const r = (row2: number) =>
      doc((d) =>
        d.parts.push(part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: hole(row2, 'c') }))
      )
    expect(codes(r(30), 'COMPONENT_SHORTED')).toEqual(['COMPONENT_SHORTED:warning'])
    expect(codes(r(33), 'COMPONENT_SHORTED')).toEqual([])
  })

  it('FLOATING_INPUT: a button input with no pull, unless the code or a resistor pulls it', () => {
    const button = (setup: string, pullResistor = false) =>
      doc((d) => {
        d.parts.push(
          part('SW1', 'test-button', {
            1: hole(40, 'e'),
            2: hole(40, 'f'),
            3: hole(42, 'e'),
            4: hole(42, 'f')
          })
        )
        d.wires.push(wire('W1', at(6, 'i'), at(40, 'a')), wire('W2', at(42, 'a'), at(5, 'b')))
        if (pullResistor) {
          d.parts.push(part('R1', 'test-resistor', { 1: hole(40, 'b'), 2: hole(44, 'b') }))
          d.wires.push(wire('W3', at(44, 'a'), at(9, 'b')))
        }
      }, `import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(18, ${setup})`)
    expect(codes(button('GPIO.IN'), 'FLOATING_INPUT')).toEqual(['FLOATING_INPUT:warning'])
    expect(codes(button('GPIO.IN, pull_up_down=GPIO.PUD_UP'), 'FLOATING_INPUT')).toEqual([])
    expect(codes(button('GPIO.IN', true), 'FLOATING_INPUT')).toEqual([])
  })

  it('INDUCTIVE_NO_DRIVER: a buzzer driven straight from a GPIO', () => {
    const buzzer = (from: number) =>
      doc((d) => {
        d.parts.push(part('BZ1', 'test-buzzer', { '+': hole(30, 'a'), '-': hole(31, 'a') }))
        d.wires.push(wire('W1', at(from, 'b'), at(30, 'b')), wire('W2', at(31, 'b'), at(5, 'b')))
      })
    expect(codes(buzzer(6), 'INDUCTIVE_NO_DRIVER')).toEqual(['INDUCTIVE_NO_DRIVER:error'])
    expect(codes(buzzer(1), 'INDUCTIVE_NO_DRIVER')).toEqual([])
  })

  it('BJT_NO_BASE_RESISTOR: a transistor base straight on a GPIO', () => {
    const npn = (viaResistor: boolean) =>
      doc((d) => {
        d.parts.push(
          part('Q1', 'test-npn', { E: hole(40, 'a'), B: hole(41, 'a'), C: hole(42, 'a') })
        )
        if (viaResistor) {
          d.parts.push(part('R1', 'test-resistor', { 1: hole(41, 'b'), 2: hole(45, 'b') }))
          d.wires.push(wire('W1', at(6, 'a'), at(45, 'a')))
        } else d.wires.push(wire('W1', at(6, 'a'), at(41, 'b')))
      })
    expect(codes(npn(false), 'BJT_NO_BASE_RESISTOR')).toEqual(['BJT_NO_BASE_RESISTOR:error'])
    expect(codes(npn(true), 'BJT_NO_BASE_RESISTOR')).toEqual([])
  })

  it('DANGLING: a lead end alone in a strip, and an unplaced pin', () => {
    expect(
      codes(
        doc((d) => d.wires.push(wire('W1', at(6, 'a'), at(30, 'a')))),
        'DANGLING'
      )
    ).toEqual(['DANGLING:warning'])
    expect(
      codes(
        doc((d) => d.parts.push(part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: null }))),
        'DANGLING'
      )
    ).toEqual(['DANGLING:warning'])
    const complete = doc((d) => {
      d.parts.push(part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: hole(33, 'a') }))
      d.wires.push(wire('W1', at(9, 'a'), at(30, 'b')), wire('W2', at(33, 'b'), at(5, 'b')))
    })
    expect(codes(complete, 'DANGLING')).toEqual([])
  })

  it('RAIL_UNPOWERED: a rail in use with no supply', () => {
    const rail: Endpoint = { hole: { board: 'bb1', area: 'rail', rail: 'bottom+', index: 10 } }
    const rail2: Endpoint = { hole: { board: 'bb1', area: 'rail', rail: 'bottom+', index: 40 } }
    const withRail = (feed: boolean) =>
      doc((d) => {
        d.parts.push(part('R1', 'test-resistor', { 1: hole(40, 'a'), 2: hole(43, 'a') }))
        d.wires.push(wire('W1', rail, at(40, 'b')))
        if (feed) d.wires.push(wire('W2', at(9, 'a'), rail2))
      })
    expect(codes(withRail(false), 'RAIL_UNPOWERED')).toEqual(['RAIL_UNPOWERED:warning'])
    expect(codes(withRail(true), 'RAIL_UNPOWERED')).toEqual([])
  })

  it('CODE_PIN_MISMATCH: code pins with nothing wired, and wired pins the code never sets up', () => {
    const wired = (source: string) =>
      doc((d) => {
        d.parts.push(part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: hole(33, 'a') }))
        d.wires.push(wire('W1', at(6, 'a'), at(30, 'b')), wire('W2', at(33, 'b'), at(5, 'b')))
      }, source)
    expect(codes(wired('GPIO.setup(17, GPIO.OUT)'), 'CODE_PIN_MISMATCH')).toEqual([])
    expect(codes(wired(''), 'CODE_PIN_MISMATCH')).toEqual(['CODE_PIN_MISMATCH:warning'])
    expect(
      codes(wired('GPIO.setup(17, GPIO.OUT)\nGPIO.setup(22, GPIO.OUT)'), 'CODE_PIN_MISMATCH')
    ).toEqual(['CODE_PIN_MISMATCH:warning'])
  })

  it('LEAD_TOO_SHORT: a lead shorter than its span, and a ribbon that cannot reach the Pi', () => {
    const lead = (length: number) =>
      doc((d) => d.wires.push({ ...wire('W1', at(24, 'a'), at(63, 'j')), lengthMm: length }))
    expect(codes(lead(40), 'LEAD_TOO_SHORT')).toEqual(['LEAD_TOO_SHORT:warning'])
    expect(codes(lead(200), 'LEAD_TOO_SHORT')).toEqual([])
    const farPi = doc((d) => (d.controller.pi.transform.position = [-400, 0]))
    expect(codes(farPi, 'LEAD_TOO_SHORT')).toEqual(['LEAD_TOO_SHORT:warning'])
  })

  it('LEAD_TOO_SHORT counts only the wire between the housings, not the length as sold', () => {
    // A 200 mm male-male lead is 200 mm tip to tip: two 12 mm housings and two 5.5 mm pins
    // leave 165 mm of wire. Here the exits are 175 mm apart, so it can't reach.
    const span = doc((d) => {
      d.boards.push({
        id: 'bb2',
        defId: 'bb-830',
        transform: { position: [0, 175], rotationDeg: 0 }
      })
      const far: Endpoint = { hole: { board: 'bb2', area: 'main', row: 24, col: 'a' } }
      d.wires.push({ ...wire('W1', at(24, 'a'), far), lengthMm: 200 })
    })
    expect(codes(span, 'LEAD_TOO_SHORT')).toEqual(['LEAD_TOO_SHORT:warning'])
  })

  it('PART_WITHOUT_DATASHEET: info only', () => {
    const d = doc((x) =>
      x.parts.push(part('R1', 'test-nosheet', { 1: hole(30, 'a'), 2: hole(33, 'a') }))
    )
    expect(codes(d, 'PART_WITHOUT_DATASHEET')).toEqual(['PART_WITHOUT_DATASHEET:info'])
  })

  it('PART_WITHOUT_DATASHEET: a custom part with no sources gets it, from the document alone', () => {
    const d = doc((x) => {
      x.customParts = [{ ...CUSTOM_RES, kitTags: ['custom'] }]
      x.parts.push(part('R1', CUSTOM_RES.id, { 1: hole(30, 'a'), 2: hole(33, 'a') }))
    })
    expect(codes(d, 'PART_WITHOUT_DATASHEET')).toEqual(['PART_WITHOUT_DATASHEET:info'])
    expect(validateDoc(d, defs)).toEqual([])
    const cited = doc((x) => {
      x.customParts = [
        { ...CUSTOM_RES, kitTags: ['custom'], provenance: { sources: ['https://example.com/a'] } }
      ]
      x.parts.push(part('R1', CUSTOM_RES.id, { 1: hole(30, 'a'), 2: hole(33, 'a') }))
    })
    expect(codes(cited, 'PART_WITHOUT_DATASHEET')).toEqual([])
  })

  it('lists errors before warnings before info', () => {
    const d = doc((x) => {
      x.parts.push(part('R1', 'test-nosheet', { 1: hole(30, 'a'), 2: hole(30, 'c') }))
      x.wires.push(wire('W1', at(1, 'a'), at(5, 'a')))
    })
    const severities = erc(d, defs).map((i) => i.severity)
    expect(severities).toEqual(
      [...severities].sort(
        (a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b)
      )
    )
  })
})
