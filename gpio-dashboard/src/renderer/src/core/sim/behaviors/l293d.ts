// L293D quadruple half-H driver (TI L293/L293D, SLRS008D). Each driver follows its A input while
// its enable is high and floats while it is low (function table, page 8). The output clamp
// diodes (section 8.1) are not modelled: the behaviour interface has no nonlinear element.
// Propagation delays (800 ns typical, page 5) are far below the solver's time step.
import { logicLevel, param, type BehaviorFactory, type Drive, type Load } from '../behavior'
import { pinId } from './pins'

type Output = 'high' | 'low' | 'z'

export const createL293d: BehaviorFactory = (def) => {
  const vcc1Min = param(def, 'vcc1MinV')
  const vcc2Min = param(def, 'vcc2MinV')
  const vih = param(def, 'vihMinV')
  const vil = param(def, 'vilMaxV')

  // Section 6.5, page 5: VOH = VCC2 - 1.4 V typ (VCC2 - 1.8 V min) at IOH = -0.6 A, and VOL = 1.2 V
  // typ (1.8 V max) at IOL = 0.6 A. The typ-to-limit drop at the test current gives the output
  // resistance, and the rest of the typical drop is a fixed offset, so a Thevenin source has
  // exactly the typical drop at 0.6 A: VCC2 - 1.0 V behind 0.667 ohm high, 0.6 V behind 1 ohm low.
  const testA = param(def, 'outputTestMa') * 1e-3
  const ohmsHigh = (param(def, 'vohBelowVcc2MaxV') - param(def, 'vohBelowVcc2TypV')) / testA
  const dropHigh = param(def, 'vohBelowVcc2TypV') - testA * ohmsHigh
  const ohmsLow = (param(def, 'volMaxV') - param(def, 'volTypV')) / testA
  const offsetLow = param(def, 'volTypV') - testA * ohmsLow

  // Supply currents are tabulated for all four outputs high, all low and all high impedance, as
  // maxima (section 6.5, page 5). A mix of states takes each output's quarter of the matching row.
  const icc1 = {
    high: param(def, 'icc1AllHighMaxMa') * 1e-3,
    low: param(def, 'icc1AllLowMaxMa') * 1e-3,
    z: param(def, 'icc1HiZMaxMa') * 1e-3
  }
  const icc2 = {
    high: param(def, 'icc2AllHighMaxMa') * 1e-3,
    low: param(def, 'icc2AllLowMaxMa') * 1e-3,
    z: param(def, 'icc2HiZMaxMa') * 1e-3
  }

  const vcc1 = pinId(def, 'VCC1')
  const vcc2 = pinId(def, 'VCC2')
  // Pins 4, 5, 12 and 13 are one internal ground net.
  const gnd = pinId(def, 'GND')
  const channels = [
    { a: '1A', y: '1Y', en: '1,2EN' },
    { a: '2A', y: '2Y', en: '1,2EN' },
    { a: '3A', y: '3Y', en: '3,4EN' },
    { a: '4A', y: '4Y', en: '3,4EN' }
  ].map((c) => ({ a: pinId(def, c.a), y: pinId(def, c.y), en: pinId(def, c.en) }))

  let supply1 = 0
  let supply2 = 0
  const inputs = new Map<string, boolean>()
  let outputs: Output[] = channels.map(() => 'z')

  const logicOk = () => supply1 >= vcc1Min
  const motorOk = () => supply2 >= vcc2Min

  return {
    update(io) {
      supply1 = io.v(vcc1) - io.v(gnd)
      supply2 = io.v(vcc2) - io.v(gnd)
      const level = (pin: string) => {
        const next = logicLevel(io.v(pin) - io.v(gnd), vil, vih, inputs.get(pin) ?? false)
        inputs.set(pin, next)
        return next
      }
      const powered = logicOk() && motorOk()
      outputs = channels.map((c) => {
        const a = level(c.a)
        const enabled = level(c.en)
        if (!powered || !enabled) return 'z'
        return a ? 'high' : 'low'
      })
    },
    drives() {
      const out: Record<string, Drive> = {}
      channels.forEach((c, i) => {
        const state = outputs[i]
        if (state === 'high') {
          out[c.y] = { ref: gnd, volts: supply2 - dropHigh, ohms: ohmsHigh }
        } else if (state === 'low') {
          out[c.y] = { ref: gnd, volts: offsetLow, ohms: ohmsLow }
        }
      })
      return out
    },
    loads() {
      const loads: Load[] = []
      const share = (table: typeof icc1) =>
        outputs.reduce((sum, state) => sum + table[state] / channels.length, 0)
      if (logicOk()) loads.push({ a: vcc1, b: gnd, ohms: supply1 / share(icc1) })
      if (motorOk()) loads.push({ a: vcc2, b: gnd, ohms: supply2 / share(icc2) })
      return loads
    },
    nextEvent: () => Infinity,
    view: () => ({ powered: logicOk() && motorOk(), outputs: [...outputs] })
  }
}
