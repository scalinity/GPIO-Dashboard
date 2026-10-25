// SG90 micro servo (SPEC 9). Each PWM pulse is measured from its rising to its falling edge and
// mapped linearly to a target angle (1.5 ms is the middle, about 1 ms and 2 ms the two ends:
// SG90 data sheet, https://www.friendlywire.com/projects/ne555-servo-safe/SG90-datasheet.pdf).
import { logicLevel, param, type Behavior, type BehaviorFactory, type Load } from '../behavior'

// No source gives the signal pin's thresholds: TTL levels are assumed (VIL 0.8 V, VIH 2.0 V),
// which a 3.3 V GPIO satisfies, as it does on hardware.
const PWM_VIL = 0.8
const PWM_VIH = 2.0
// The servo's electronics refresh every ~20 ms frame. One missing frame is ordinary jitter (a
// software PWM misses frames), so the servo is taken to lose the signal after three periods
// without a pulse, and then stops driving the motor (an analog servo goes slack without
// pulses). No source gives this figure: modelling assumption.
const LOST_PERIODS = 3
// The data sheet gives 4.8 V with no tolerance (another vendor's text says 4.0-7.2 V): the servo
// is taken to run down to 90 % of vccMinV, between the two (modelling assumption).
const SUPPLY_MARGIN = 0.9
const EPS_S = 1e-9
const EPS_DEG = 1e-9

export const createSg90: BehaviorFactory = (def): Behavior => {
  const p = (key: string) => param(def, key)
  const degPerS = 60 / p('speedSecPer60Deg')
  const lostAfterS = LOST_PERIODS * (p('pwmPeriodMs') / 1000)
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

  let supply = 0
  let powered = false
  let pwmHigh = false
  let rise: number | null = null
  let lastRise = 0
  let holding = false
  let commandUs: number | null = null
  // The horn rests at the middle until the first pulse moves it, and stays where it is
  // through a power cut.
  let angle = 0
  let target = 0
  let at = 0

  // Moves the horn toward its target up to time `to`; it only moves while the servo holds.
  const advance = (to: number) => {
    if (holding && powered && angle !== target) {
      const step = degPerS * (to - at)
      const gap = target - angle
      angle = Math.abs(gap) <= step + EPS_DEG ? target : angle + Math.sign(gap) * step
    }
    at = to
  }

  return {
    update(io) {
      supply = io.v('VCC') - io.v('GND')
      if (supply < p('vccMinV') * SUPPLY_MARGIN) {
        at = io.t
        powered = false
        holding = false
        pwmHigh = false
        rise = null
        commandUs = null
        return
      }
      powered = true
      if (holding && io.t >= lastRise + lostAfterS - EPS_S) {
        advance(lastRise + lostAfterS)
        holding = false
      }
      advance(io.t)
      const was = pwmHigh
      pwmHigh = logicLevel(io.v('PWM') - io.v('GND'), PWM_VIL, PWM_VIH, pwmHigh)
      if (!was && pwmHigh) rise = io.t
      else if (was && !pwmHigh && rise !== null) {
        const widthUs = clamp((io.t - rise) * 1e6, p('pulseLimitMinUs'), p('pulseLimitMaxUs'))
        holding = true
        lastRise = rise
        rise = null
        // A change inside the dead band is not followed.
        if (commandUs === null || Math.abs(widthUs - commandUs) > p('deadBandUs')) {
          commandUs = widthUs
          const slope = (p('angleMaxDeg') - p('angleMinDeg')) / (p('pulseMaxUs') - p('pulseMinUs'))
          const mapped = p('angleMinDeg') + (widthUs - p('pulseMinUs')) * slope
          target = clamp(mapped, p('angleMinDeg'), p('angleMaxDeg'))
        }
      }
    },
    drives() {
      return {}
    },
    loads() {
      const list: Load[] = []
      if (powered) {
        const moving = holding && angle !== target
        const amps = (moving ? p('runningCurrentMa') : p('idleCurrentMa')) / 1000
        list.push({ a: 'VCC', b: 'GND', ohms: supply / amps })
      }
      return list
    },
    nextEvent() {
      if (!powered || !holding) return Infinity
      const arrival = angle === target ? Infinity : at + Math.abs(target - angle) / degPerS
      return Math.min(lastRise + lostAfterS, arrival)
    },
    view() {
      return {
        powered,
        holding,
        moving: holding && angle !== target,
        angleDeg: angle,
        targetDeg: target,
        degPerS,
        atS: at
      }
    }
  }
}
