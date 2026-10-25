// ADS1115 16-bit I2C ADC on a breakout board (SPEC 9), driven at transaction level. Register
// model from TI SBAS444E (https://www.ti.com/lit/ds/symlink/ads1115.pdf): Table 8-1 pointer,
// 8.1.2 conversion, Table 8-3 config (reset 8583h), 8.1.4 thresholds (reset 8000h / 7FFFh),
// Table 7-1 full-scale ranges, Table 7-2 addresses, 7.3.7 comparator.
import type { PartDef } from '../../model/types'
import {
  param,
  type Behavior,
  type BehaviorFactory,
  type Drive,
  type I2cDevice,
  type Load
} from '../behavior'

// Input pairs by MUX[2:0] (Table 8-3); -1 is GND.
const MUX: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 3],
  [1, 3],
  [2, 3],
  [0, -1],
  [1, -1],
  [2, -1],
  [3, -1]
]

const CONFIG_RESET = 0x8583
const LO_RESET = 0x8000
const HI_RESET = 0x7fff

// ALERT/RDY is open drain: VOL 0.15 V typical at IOL = 3 mA (TI SBAS444E section 5.5, Digital
// Input/Output), so 50 ohms to ground when it pulls low.
const ALERT_LOW_OHM = 0.15 / 0.003
// IVDD power-down, 0.5 uA typical at 25 C (TI SBAS444E section 5.5, Power-Supply).
const POWER_DOWN_A = 0.5e-6
// The stated minimum supply is a specification limit, not a cliff, and a loaded rail sags a
// little: the part runs down to this fraction of vccMinV (modelling assumption).
const SUPPLY_MARGIN = 0.9
const EPS_S = 1e-9

const signed16 = (v: number) => (v & 0x8000 ? v - 0x10000 : v)

function numberList(def: PartDef, key: string): number[] {
  const list = String(def.sim.params[key]).split(',').map(Number)
  if (!list.length || list.some((n) => !Number.isFinite(n))) {
    throw new Error(`${def.id}: sim param ${key} is missing`)
  }
  return list
}

function numberParam(def: PartDef, key: string): number {
  const n = Number(def.sim.params[key])
  if (!Number.isInteger(n)) throw new Error(`${def.id}: sim param ${key} is missing`)
  return n
}

function pinParam(def: PartDef, key: string): string {
  const pin = def.sim.params[key]
  if (typeof pin !== 'string') throw new Error(`${def.id}: sim param ${key} is missing`)
  return pin
}

export const createAds1115: BehaviorFactory = (def): Behavior => {
  const p = (key: string) => param(def, key)
  const rangesV = numberList(def, 'pgaRangesV')
  const ratesSps = numberList(def, 'dataRatesSps')
  // ADDR to GND, VDD, SDA, SCL (Table 7-2), in the order a tie is resolved.
  const addressPins = [
    { pin: 'GND', address: numberParam(def, 'i2cAddressAddrGnd') },
    { pin: 'VDD', address: numberParam(def, 'i2cAddressAddrVdd') },
    { pin: 'SDA', address: numberParam(def, 'i2cAddressAddrSda') },
    { pin: 'SCL', address: numberParam(def, 'i2cAddressAddrScl') }
  ]

  let supply = 0
  let powered = false
  let now = 0
  let address = addressPins[0]!.address
  let pointer = 0
  let config = CONFIG_RESET & 0x7fff
  let lo = LO_RESET
  let hi = HI_RESET
  let conversion = 0
  let converting = false
  let doneAt = 0
  let asserted = false

  const rangeIndex = () => Math.min((config >> 9) & 7, rangesV.length - 1)
  const periodS = () => 1 / ratesSps[(config >> 5) & 7]!
  const continuous = () => !(config & 0x100)
  const polarityHigh = () => !!(config & 0x08)
  const comparatorOn = () => (config & 3) !== 3

  const reset = () => {
    powered = false
    pointer = 0
    config = CONFIG_RESET & 0x7fff
    lo = LO_RESET
    hi = HI_RESET
    conversion = 0
    converting = false
    asserted = false
  }

  const compare = (code: number) => {
    if (!comparatorOn()) {
      asserted = false
      return
    }
    const high = signed16(hi)
    const low = signed16(lo)
    if (config & 0x10) asserted = code > high || code < low
    else if (code > high) asserted = true
    else if (code < low) asserted = false
  }

  const writeConfig = (value: number) => {
    const wasContinuous = continuous()
    config = value & 0x7fff
    if (!comparatorOn()) asserted = false
    if (continuous()) {
      converting = true
      doneAt = now + periodS()
    } else {
      if (wasContinuous) converting = false
      // OS = 1 starts a single conversion, and has no effect while one is running.
      if (value & 0x8000 && !converting) {
        converting = true
        doneAt = now + periodS()
      }
    }
  }

  const registerValue = () => {
    if (pointer === 0) return conversion & 0xffff
    if (pointer === 1) return config | (converting && !continuous() ? 0 : 0x8000)
    return pointer === 2 ? lo : hi
  }

  const i2c: I2cDevice = {
    address: () => (powered ? address : null),
    write(bytes) {
      if (!powered) return false
      if (bytes.length === 0) return true
      pointer = bytes[0]! & 3
      if (bytes.length >= 3) {
        const value = (bytes[1]! << 8) | bytes[2]!
        if (pointer === 1) writeConfig(value)
        else if (pointer === 2) lo = value
        else if (pointer === 3) hi = value
      }
      return true
    },
    read(count) {
      if (!powered) return null
      const value = registerValue()
      return Array.from({ length: count }, (_, i) => (i % 2 === 0 ? value >> 8 : value & 0xff))
    }
  }

  return {
    update(io) {
      supply = io.v('VDD') - io.v('GND')
      if (supply < p('vccMinV') * SUPPLY_MARGIN) {
        reset()
        return
      }
      powered = true
      now = io.t
      // The address pin is read as the supply, ground or bus line it is closest to.
      const level = io.v('ADDR')
      let best = Infinity
      for (const candidate of addressPins) {
        const gap = Math.abs(level - io.v(candidate.pin))
        if (gap < best) {
          best = gap
          address = candidate.address
        }
      }
      if (converting && io.t >= doneAt - EPS_S) {
        const [positive, negative] = MUX[(config >> 12) & 7]!
        const volts = io.v(`A${positive}`) - (negative < 0 ? io.v('GND') : io.v(`A${negative}`))
        conversion = Math.max(
          -32768,
          Math.min(32767, Math.round((volts / rangesV[rangeIndex()]!) * 32768))
        )
        compare(conversion)
        if (continuous()) {
          const missed = Math.max(1, Math.floor((io.t - doneAt) / periodS()) + 1)
          doneAt += missed * periodS()
        } else {
          converting = false
        }
      }
    },
    drives(): Record<string, Drive> {
      if (!powered || !comparatorOn() || asserted === polarityHigh()) return {}
      return { ALRT: { ref: 'GND', volts: 0, ohms: ALERT_LOW_OHM } }
    },
    loads() {
      const list: Load[] = [
        { a: 'SDA', b: pinParam(def, 'i2cPullupTo'), ohms: p('i2cPullupOhm') },
        { a: 'SCL', b: pinParam(def, 'i2cPullupTo'), ohms: p('i2cPullupOhm') },
        { a: 'ALRT', b: pinParam(def, 'alrtPullupTo'), ohms: p('alrtPullupOhm') },
        { a: 'ADDR', b: pinParam(def, 'addrPulldownTo'), ohms: p('addrPulldownOhm') }
      ]
      if (powered) {
        const amps = converting ? p('supplyCurrentContinuousUa') * 1e-6 : POWER_DOWN_A
        list.push({ a: 'VDD', b: 'GND', ohms: supply / amps })
      }
      return list
    },
    nextEvent() {
      return powered && converting ? doneAt : Infinity
    },
    view() {
      return {
        powered,
        address: powered ? address : null,
        continuous: continuous(),
        converting,
        conversion,
        fullScaleV: rangesV[rangeIndex()],
        alertLow: powered && comparatorOn() && asserted !== polarityHigh()
      }
    },
    i2c
  }
}
