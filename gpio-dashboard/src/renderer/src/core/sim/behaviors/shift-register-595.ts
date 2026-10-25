// 74HC595 8-bit shift register with output latches (TI SN74HC595, SCLS041J). Function table:
// section 8.4, page 12. Propagation delays (17 ns typical) are far below the solver's time step,
// so outputs follow their clocks at the same simulation time.
import { logicLevel, param, type BehaviorFactory, type Drive } from '../behavior'
import { pinId } from './pins'

const STAGES = 8

/** Piecewise-linear value at `vcc` through the datasheet's (VCC, value) rows, flat outside them. */
function atSupply(vcc: number, rows: [number, number][]): number {
  const first = rows[0]!
  if (vcc <= first[0]) return first[1]
  for (let i = 1; i < rows.length; i++) {
    const [x0, y0] = rows[i - 1]!
    const [x1, y1] = rows[i]!
    if (vcc <= x1) return y0 + ((y1 - y0) * (vcc - x0)) / (x1 - x0)
  }
  return rows[rows.length - 1]![1]
}

export const createShiftRegister595: BehaviorFactory = (def) => {
  const vccMin = param(def, 'vccMinV')
  const vccMax = param(def, 'vccMaxV')
  const vccMid = param(def, 'thresholdVccV')
  // VIH and VIL are tabulated only at VCC = 2, 4.5 and 6 V (section 6.3, page 4); between the
  // rows they are interpolated, which is a modelling choice and not a datasheet number.
  const vihRows: [number, number][] = [
    [vccMin, param(def, 'vihMinV_vcc2V')],
    [vccMid, param(def, 'vihMinV')],
    [vccMax, param(def, 'vihMinV_vcc6V')]
  ]
  const vilRows: [number, number][] = [
    [vccMin, param(def, 'vilMaxV_vcc2V')],
    [vccMid, param(def, 'vilMaxV')],
    [vccMax, param(def, 'vilMaxV_vcc6V')]
  ]

  // Output resistance from the VOH and VOL limits (section 6.5, page 5), all at VCC = 4.5 V:
  // (VCC - VOH,min) / IOH and VOL,max / IOL. The datasheet rates 6 mA for QA-QH and 4 mA for
  // QH'. The same resistance is used at every supply, an assumption: the 2 V and 6 V rows
  // are not in params.
  const testVcc = param(def, 'outputTestVccV')
  const ohmsHigh = (testVcc - param(def, 'vohMinV')) / (param(def, 'iohMa') * 1e-3)
  const ohmsLow = param(def, 'volMaxV') / (param(def, 'iolMa') * 1e-3)
  const ohmsHighQh = (testVcc - param(def, 'vohMinV')) / (param(def, 'qhPrimeIohMa') * 1e-3)
  const ohmsLowQh = param(def, 'volMaxV') / (param(def, 'qhPrimeIolMa') * 1e-3)
  const iccMax = param(def, 'iccMaxUa') * 1e-6

  const vcc = pinId(def, 'VCC')
  const gnd = pinId(def, 'GND')
  const ser = pinId(def, 'SER')
  const srclk = pinId(def, 'SRCLK')
  const rclk = pinId(def, 'RCLK')
  const srclr = pinId(def, 'SRCLR')
  const oe = pinId(def, 'OE')
  const qhPrime = pinId(def, "QH'")
  // QA first: index 0 is the stage SER shifts into, index 7 is QH.
  const q = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'].map((label) => pinId(def, label))

  let powered = false
  let supply = 0
  // Until the first powered update there are no previous levels, so no edge can be seen.
  let primed = false
  let levels = { ser: false, srclk: false, rclk: false, srclr: false, oe: false }
  let shift: boolean[] = new Array<boolean>(STAGES).fill(false)
  let storage: boolean[] = new Array<boolean>(STAGES).fill(false)

  const drive = (high: boolean, ohmsHi: number, ohmsLo: number): Drive => ({
    ref: gnd,
    volts: high ? supply : 0,
    ohms: high ? ohmsHi : ohmsLo
  })

  return {
    update(io) {
      supply = io.v(vcc) - io.v(gnd)
      if (supply < vccMin) {
        // CMOS registers do not hold data without a supply. The datasheet gives no power-up
        // state, so zeros are used to keep the part deterministic.
        powered = false
        primed = false
        shift = shift.map(() => false)
        storage = storage.map(() => false)
        return
      }
      powered = true
      const vih = atSupply(supply, vihRows)
      const vil = atSupply(supply, vilRows)
      const read = (pin: string, previous: boolean) =>
        logicLevel(io.v(pin) - io.v(gnd), vil, vih, previous)
      const next = {
        ser: read(ser, levels.ser),
        srclk: read(srclk, levels.srclk),
        rclk: read(rclk, levels.rclk),
        srclr: read(srclr, levels.srclr),
        oe: read(oe, levels.oe)
      }
      const was = primed ? levels : next
      primed = true
      levels = next

      // RCLK is handled before SRCLK so that with both rising together the storage register takes
      // the old shift register: "the shift register is one clock pulse ahead" (section 8.1).
      if (!was.rclk && next.rclk) storage = [...shift]
      if (!next.srclr) shift = shift.map(() => false)
      else if (!was.srclk && next.srclk) shift = [next.ser, ...shift.slice(0, STAGES - 1)]
    },
    drives() {
      if (!powered) return {}
      const out: Record<string, Drive> = {}
      // OE is active low and disables QA-QH only; QH' is the shift register's last stage.
      if (!levels.oe) {
        q.forEach((pin, i) => {
          out[pin] = drive(storage[i]!, ohmsHigh, ohmsLow)
        })
      }
      out[qhPrime] = drive(shift[STAGES - 1]!, ohmsHighQh, ohmsLowQh)
      return out
    },
    loads() {
      // Static supply current at its datasheet maximum (section 6.5, page 5).
      return powered ? [{ a: vcc, b: gnd, ohms: supply / iccMax }] : []
    },
    nextEvent: () => Infinity,
    view: () => ({
      powered,
      shift: [...shift],
      storage: [...storage],
      outputsEnabled: powered && !levels.oe
    })
  }
}
