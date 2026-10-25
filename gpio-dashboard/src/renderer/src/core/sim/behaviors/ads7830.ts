// ADS7830 8-bit I2C ADC on the kit's module (SPEC 9), driven at transaction level. Command byte
// and channel tables from TI SBAS302C (https://www.ti.com/lit/ds/symlink/ads7830.pdf), pages 13-14:
// SD C2 C1 C0 PD1 PD0 X X, Table 1 power-down selection, Table 2 channel selection.
import type { PartDef } from '../../model/types'
import { param, type Behavior, type BehaviorFactory, type I2cDevice, type Load } from '../behavior'

// Single-ended channel by C2C1C0 (Table 2, SD = 1): the order is not sequential.
const SINGLE_ENDED = [0, 2, 4, 6, 1, 3, 5, 7]

// Quiescent current at 100 kHz standard mode (TI SBAS302C, Electrical Characteristics): 60 uA in
// the 2.7-3.6 V table, 150 uA in the 4.75-5.25 V table. The module's power LED and resistors are
// not documented, so they are not modelled.
const QUIESCENT_LOW_SUPPLY_A = 60e-6
const QUIESCENT_HIGH_SUPPLY_A = 150e-6
const LOW_SUPPLY_MAX_V = 3.6
// The stated minimum supply is a specification limit, not a cliff, and a loaded rail sags a
// little: the part runs down to this fraction of vccMinV (modelling assumption).
const SUPPLY_MARGIN = 0.9

function addressOf(def: PartDef): number {
  const address = Number(def.sim.params.i2cAddress)
  if (!Number.isInteger(address)) throw new Error(`${def.id}: sim param i2cAddress is missing`)
  return address
}

export const createAds7830: BehaviorFactory = (def): Behavior => {
  const p = (key: string) => param(def, key)
  const address = addressOf(def)
  const channels = p('channels')

  let supply = 0
  let powered = false
  // Volts at A0..A7 above this part's ground pin, from the latest solve.
  let inputs: number[] = new Array<number>(channels).fill(0)
  // The reset value of the command byte is not given: until one arrives there is no conversion.
  let command: number | null = null

  const sample = (): number => {
    if (command === null) return 0
    const select = (command >> 4) & 7
    let vin: number
    if (command & 0x80) {
      vin = inputs[SINGLE_ENDED[select]!]!
    } else {
      // Differential pairs (Table 2, SD = 0): C0 picks the pair, C2 swaps the polarity.
      const pair = select & 3
      const swap = select >> 2
      vin = inputs[2 * pair + swap]! - inputs[2 * pair + 1 - swap]!
    }
    // PD1 turns the 2.5 V internal reference on (Table 1). With it off, the kit's lesson takes
    // the full scale as the module's supply (3.3 V over 256 steps) and the REFIN wiring is
    // undocumented: assumption.
    const fullScale = command & 0x08 ? p('internalReferenceV') : supply
    return Math.max(0, Math.min(255, Math.floor((vin / fullScale) * 256)))
  }

  const i2c: I2cDevice = {
    address: () => (powered ? address : null),
    write(bytes) {
      if (!powered) return false
      if (bytes.length) command = bytes[bytes.length - 1]!
      return true
    },
    read(count) {
      if (!powered) return null
      return new Array<number>(count).fill(sample())
    }
  }

  return {
    update(io) {
      supply = io.v('VCC') - io.v('GND')
      if (supply < p('vccMinV') * SUPPLY_MARGIN) {
        powered = false
        command = null
        return
      }
      powered = true
      inputs = Array.from({ length: channels }, (_, i) => io.v(`A${i}`) - io.v('GND'))
    },
    drives() {
      return {}
    },
    loads() {
      const list: Load[] = []
      if (powered) {
        const amps = supply <= LOW_SUPPLY_MAX_V ? QUIESCENT_LOW_SUPPLY_A : QUIESCENT_HIGH_SUPPLY_A
        list.push({ a: 'VCC', b: 'GND', ohms: supply / amps })
      }
      return list
    },
    nextEvent() {
      return Infinity
    },
    view() {
      return { powered, address: powered ? address : null, command }
    },
    i2c
  }
}
