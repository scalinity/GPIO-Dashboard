// ADC0834 4-channel 8-bit serial A/D converter (TI ADC0831/2/4/8-N, SNAS531B). The protocol is
// the functional description on pages 13 to 16 and the ADC0834 timing diagram (Figure 20, page 10):
//
//   rising CLK 1-4   DI: start bit (the first 1; leading zeros are ignored), SGL/DIF, ODD/SIGN,
//                    SELECT1. The MUX then settles for half a clock period.
//   falling CLK 4    DO leaves high impedance with a leading zero; SARS goes high.
//   falling CLK 5-12 DO shifts out D7 (MSB) to D0 (LSB).
//   rising CLK 13    SARS goes low.
//   falling CLK 13-19 DO shifts out D1 to D7 (the LSB-first stream shares D0 with the first).
//   after that       DO stays low until CS goes high; CS high clears everything and floats DO
//                    and SARS.
import { logicLevel, param, type BehaviorFactory, type Drive } from '../behavior'
import { pinId } from './pins'

type Phase = 'idle' | 'start' | 'address' | 'settle' | 'output'

// The VOH limit is tested at VCC = 4.75 V (Digital and DC Characteristics, page 5).
const VOH_TEST_VCC = 4.75

export const createAdc0834: BehaviorFactory = (def) => {
  const vccMin = param(def, 'vccMinV')
  const vih = param(def, 'vihMinV')
  const vil = param(def, 'vilMaxV')
  // 2.4 V at -360 uA and 0.4 V at 1.6 mA (page 5) give the output resistance at 4.75 V. The
  // short-circuit currents (ISOURCE, ISINK) imply a lower resistance and are not used.
  const ohmsHigh = (VOH_TEST_VCC - param(def, 'vohMinV')) / (param(def, 'iohMa') * 1e-3)
  const ohmsLow = param(def, 'volMaxV') / (param(def, 'iolMa') * 1e-3)
  const iccMax = param(def, 'iccMaxMa') * 1e-3
  // The reference ladder is a resistor string from VREF to AGND, typically 3.5 kohm (page 4).
  const vrefOhms = param(def, 'vrefRinTypKohm') * 1e3
  const bits = param(def, 'resolutionBits')
  const lastCode = 2 ** bits - 1

  const vcc = pinId(def, 'VCC')
  const dgnd = pinId(def, 'DGND')
  const agnd = pinId(def, 'AGND')
  const vref = pinId(def, 'VREF')
  const cs = pinId(def, 'CS')
  const clk = pinId(def, 'CLK')
  const di = pinId(def, 'DI')
  const dout = pinId(def, 'DO')
  const sars = pinId(def, 'SARS')
  const channels = ['CH0', 'CH1', 'CH2', 'CH3'].map((label) => pinId(def, label))

  let powered = false
  let supply = 0
  let primed = false
  let phase: Phase = 'idle'
  let levels = { cs: true, clk: false, di: false }
  let address: boolean[] = []
  let result = 0
  let step = 0
  let sarsHigh = false
  let doHigh = false

  const reset = () => {
    phase = 'idle'
    address = []
    result = 0
    step = 0
    sarsHigh = false
    doHigh = false
  }

  /** The bit on DO after the `n`th falling clock edge that follows the leading zero. */
  const bitAt = (n: number) => {
    if (n <= bits) return ((result >> (bits - n)) & 1) === 1
    if (n < 2 * bits) return ((result >> (n - bits)) & 1) === 1
    return false
  }

  // Tables 4 and 5 (page 14): ODD/SIGN and SELECT1 pick the channel (single-ended) or pair.
  const convert = (volt: (pin: string) => number) => {
    const [single, odd, select1] = address as [boolean, boolean, boolean]
    const pair = select1 ? 2 : 0
    const plus = volt(channels[pair + (odd ? 1 : 0)]!)
    const vin = single ? plus : plus - volt(channels[pair + (odd ? 0 : 1)]!)
    const span = volt(vref)
    if (!(span > 0)) return 0
    return Math.min(lastCode, Math.max(0, Math.round((lastCode * vin) / span)))
  }

  return {
    update(io) {
      supply = io.v(vcc) - io.v(dgnd)
      if (supply < vccMin) {
        powered = false
        primed = false
        reset()
        return
      }
      powered = true
      const read = (pin: string, previous: boolean) =>
        logicLevel(io.v(pin) - io.v(dgnd), vil, vih, previous)
      const next = {
        cs: read(cs, levels.cs),
        clk: read(clk, levels.clk),
        di: read(di, levels.di)
      }
      const was = primed ? levels : next
      primed = true
      levels = next

      if (next.cs) {
        reset()
        return
      }
      if (phase === 'idle') phase = 'start'

      // Analog inputs are measured against AGND.
      const volt = (pin: string) => io.v(pin) - io.v(agnd)
      if (!was.clk && next.clk) {
        if (phase === 'start') {
          if (next.di) {
            phase = 'address'
            address = []
          }
        } else if (phase === 'address') {
          address.push(next.di)
          if (address.length === 3) phase = 'settle'
        } else if (phase === 'output' && step >= bits) {
          sarsHigh = false
        }
      } else if (was.clk && !next.clk) {
        if (phase === 'settle') {
          // The input is taken once the MUX has settled, at the start of the conversion.
          result = convert(volt)
          phase = 'output'
          step = 0
          sarsHigh = true
          doHigh = false
        } else if (phase === 'output') {
          step += 1
          doHigh = bitAt(step)
        }
      }
    },
    drives() {
      if (!powered || phase === 'idle') return {}
      const level = (high: boolean): Drive => ({
        ref: dgnd,
        volts: high ? supply : 0,
        ohms: high ? ohmsHigh : ohmsLow
      })
      const out: Record<string, Drive> = { [sars]: level(sarsHigh) }
      if (phase === 'output') out[dout] = level(doHigh)
      return out
    },
    loads() {
      if (!powered) return []
      return [
        { a: vcc, b: dgnd, ohms: supply / iccMax },
        { a: vref, b: agnd, ohms: vrefOhms }
      ]
    },
    nextEvent: () => Infinity,
    view: () => ({
      powered,
      phase,
      result: phase === 'output' ? result : null
    })
  }
}
