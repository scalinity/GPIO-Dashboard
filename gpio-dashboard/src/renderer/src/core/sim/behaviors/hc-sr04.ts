// HC-SR04 ultrasonic module (SPEC 9). A TRIG pulse of at least 10 us starts a measurement on its
// falling edge; the module sends an 8-cycle 40 kHz burst, then raises ECHO for distance x 58 us.
// Elecfreaks datasheet, "Timing diagram" (https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf).
import {
  logicLevel,
  param,
  type Behavior,
  type BehaviorFactory,
  type Drive,
  type Load
} from '../behavior'

// With no echo the module holds ECHO high for 38 ms: ITead HC-SR04 datasheet, page 2 "Sequence
// chart" (https://iarduino.ru/lib/HC-SR04.pdf); also Rapid Electronics guide 74-1109, "about
// 150uS-25ms, 38ms if no obstacle" (https://static.rapidonline.com/pdf/74-1109_v1.pdf).
const NO_ECHO_S = 0.038
// The datasheet gives no TRIG threshold, only "TTL pulse"; the 7400-series TTL levels are
// assumed (VIL 0.8 V, VIH 2.0 V), which a 3.3 V GPIO satisfies, as it does on hardware.
const TRIG_VIL = 0.8
const TRIG_VIH = 2.0
// The datasheet gives no ECHO output impedance: a push-pull MCU pin of about 100 ohms is
// assumed. ECHO is driven in both states, as the module's MCU drives it.
const ECHO_OHM = 100
// The datasheet gives a 5 V supply with no tolerance, so the module is taken to run down to
// 90 % of it (modelling assumption); an exact 5 V cutoff would drop out on any rail sag.
const SUPPLY_MARGIN = 0.9
// Comparing times that were sums of microsecond offsets.
const EPS_S = 1e-9

interface Edge {
  t: number
  high: boolean
}

export const createHcSr04: BehaviorFactory = (def): Behavior => {
  const p = (key: string) => param(def, key)
  const burstS = p('burstCycles') / (p('burstFrequencyKHz') * 1000)

  let supply = 0
  let powered = false
  let trigHigh = false
  let trigRise: number | null = null
  let lastStart: number | null = null
  let edges: Edge[] = []
  let next = 0
  let echoHigh = false
  let distanceCm: number | null = null

  const reset = () => {
    powered = false
    trigHigh = false
    trigRise = null
    lastStart = null
    edges = []
    next = 0
    echoHigh = false
  }

  return {
    update(io) {
      supply = io.v('VCC') - io.v('GND')
      if (supply < p('vccMinV') * SUPPLY_MARGIN) {
        reset()
        return
      }
      powered = true
      const was = trigHigh
      trigHigh = logicLevel(io.v('TRIG') - io.v('GND'), TRIG_VIL, TRIG_VIH, trigHigh)
      if (!was && trigHigh) trigRise = io.t
      else if (was && !trigHigh && trigRise !== null) {
        const wide = io.t - trigRise >= p('trigPulseMinUs') * 1e-6 - EPS_S
        const rested =
          lastStart === null || io.t - lastStart >= p('measurementCycleMinMs') / 1000 - EPS_S
        trigRise = null
        if (wide && rested) {
          const asked = io.env.distanceCm
          if (typeof asked !== 'number' || !Number.isFinite(asked)) {
            throw new Error(`${def.id}: env distanceCm is not a number`)
          }
          distanceCm = Math.max(p('rangeMinCm'), asked)
          const echoS =
            distanceCm > p('rangeMaxCm') ? NO_ECHO_S : distanceCm * p('echoUsPerCm') * 1e-6
          lastStart = io.t
          edges = [
            { t: io.t + burstS, high: true },
            { t: io.t + burstS + echoS, high: false }
          ]
          next = 0
        }
      }
      while (next < edges.length && edges[next]!.t <= io.t + EPS_S) {
        echoHigh = edges[next]!.high
        next++
      }
      if (edges.length && next >= edges.length) {
        edges = []
        next = 0
      }
    },
    drives(): Record<string, Drive> {
      return powered ? { ECHO: { ref: 'GND', volts: echoHigh ? supply : 0, ohms: ECHO_OHM } } : {}
    },
    loads() {
      const list: Load[] = []
      if (powered) list.push({ a: 'VCC', b: 'GND', ohms: supply / (p('workingCurrentMa') / 1000) })
      return list
    },
    nextEvent() {
      return next < edges.length ? edges[next]!.t : Infinity
    },
    view() {
      return { powered, measuring: edges.length > 0, echo: echoHigh, distanceCm }
    }
  }
}
