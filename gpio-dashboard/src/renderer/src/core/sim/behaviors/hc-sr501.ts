// HC-SR501 PIR motion module (ElecFreaks specification and its copies, cited in the part
// definition). A BISS0001 controller drives OUT: high for the delay after motion, then low for the
// block time, and low for about a minute after power-up. Jumper H retriggers the delay on each
// movement, L holds OUT high for the delay whatever happens (BISS0001 pin A: "A = 1 repeatable,
// A = 0 not repeatable"). env.motion is whether something is moving in view. env.delayS and
// env.trigger ('H' or 'L'), when present, stand in for the delay potentiometer and the jumper;
// without them the module runs at its shortest delay and its default jumper position.
import { param, type BehaviorFactory, type Drive } from '../behavior'

// BISS0001 VO pin, Electrical Parameters (Shenzhen Fuman Electronics, S&CIC0806, page 2):
// VOH >= 4 V at VDD = 5 V and IOH = 0.5 mA, VOL <= 0.4 V at VDD = 5 V and IOL = 0.1 mA.
// https://atta.szlcsc.com/upload/public/pdf/source/20170205/1486278494872.pdf
// The module runs the chip from its 3.3 V regulator and its schematic was not found, so these
// resistances, taken at 5 V and with no allowance for any resistor between VO and OUT, are
// assumptions for OUT.
const OUT_HIGH_OHMS = (5 - 4) / 0.5e-3
const OUT_LOW_OHMS = 0.4 / 0.1e-3

export const createHcSr501: BehaviorFactory = (def) => {
  const vccMin = param(def, 'vccMinV')
  const outHighV = param(def, 'outputHighV')
  const outLowV = param(def, 'outputLowV')
  const quiescent = param(def, 'quiescentCurrentMaxUa') * 1e-6
  const delayMin = param(def, 'delayMinS')
  const delayMax = param(def, 'delayMaxS')
  const blockS = param(def, 'blockTimeS')
  const initS = param(def, 'startupInitS')
  const defaultMode = def.sim.params.triggerModeDefault

  let supply = 0
  let now = 0
  /** When the supply last became valid; null while unpowered. */
  let poweredAt: number | null = null
  let initialising = false
  let high = false
  let holdUntil = 0
  let blockUntil = 0
  let moving = false

  return {
    update(io) {
      now = io.t
      supply = io.v('VCC') - io.v('GND')
      if (supply < vccMin) {
        poweredAt = null
        initialising = false
        high = false
        blockUntil = 0
        moving = false
        return
      }
      if (poweredAt === null) poweredAt = io.t
      const motion = io.env.motion === true
      initialising = io.t < poweredAt + initS
      // During start-up OUT stays low and motion is ignored.
      if (initialising) {
        moving = motion
        return
      }
      const delay =
        typeof io.env.delayS === 'number'
          ? Math.min(delayMax, Math.max(delayMin, io.env.delayS))
          : delayMin
      const repeatable = (io.env.trigger ?? defaultMode) === 'H'

      // Repeatable: the hold runs from the last movement, which is the update that last saw one.
      if (high && repeatable && (motion || moving)) holdUntil = Math.max(holdUntil, io.t + delay)
      if (high && io.t >= holdUntil) {
        high = false
        blockUntil = holdUntil + blockS
      }
      if (!high && motion && io.t >= blockUntil) {
        high = true
        holdUntil = io.t + delay
      }
      moving = motion
    },
    drives(): Record<string, Drive> {
      if (poweredAt === null) return {}
      return {
        OUT: high
          ? { ref: 'GND', volts: outHighV, ohms: OUT_HIGH_OHMS }
          : { ref: 'GND', volts: outLowV, ohms: OUT_LOW_OHMS }
      }
    },
    loads() {
      return poweredAt === null ? [] : [{ a: 'VCC', b: 'GND', ohms: supply / quiescent }]
    },
    nextEvent() {
      if (poweredAt === null) return Infinity
      if (initialising) return poweredAt + initS
      if (high) return holdUntil
      return blockUntil > now ? blockUntil : Infinity
    },
    view: () => ({
      powered: poweredAt !== null,
      initialising,
      out: high,
      blocked: !high && blockUntil > now
    })
  }
}
