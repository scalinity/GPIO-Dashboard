// DHT11 single-wire sensor (SPEC 9). One file serves the bare 4-pin part and the 3-pin module;
// the supply, ground and data pins are found by role. Protocol: Aosong DHT11 Product Manual
// section 7 (https://components101.com/sites/default/files/component_datasheet/DHT11-Temperature-Sensor.pdf)
// and the translated datasheet section 5 (https://pdf.direnc.net/upload/dht11-sicaklik-ve-nem-sensoru.pdf).
import type { PartDef } from '../../model/types'
import { logicLevel, param, type Behavior, type BehaviorFactory, type Load } from '../behavior'

// Neither datasheet gives DATA input thresholds or an output-low resistance: modelling
// assumptions. CMOS input levels as fractions of VDD, and an open-drain low of 100 Ω.
const VIL_OF_VDD = 0.3
const VIH_OF_VDD = 0.7
const LOW_OHM = 100
// The stated minimum supply is a specification limit, not a cliff, and a loaded rail sags a
// little: the sensor is taken to run down to this fraction of vccMinV (modelling assumption).
const SUPPLY_MARGIN = 0.9
// Comparing times that were sums of microsecond offsets.
const EPS_S = 1e-9

interface Edge {
  t: number
  low: boolean
}

interface Reading {
  humidity: number
  temperature: number
  at: number
}

function pinOf(def: PartDef, role: string): string {
  const pin = def.pins.find((p) => p.role === role)
  if (!pin) throw new Error(`${def.id}: no pin with role ${role}`)
  return pin.id
}

export const createDht11: BehaviorFactory = (def): Behavior => {
  const vdd = pinOf(def, 'power')
  const gnd = pinOf(def, 'ground')
  const data = pinOf(def, 'logic-io')
  const p = (key: string) => param(def, key)
  const US = 1e-6
  // Datasheet windows, each read at its middle: host release wait 20-40 us (translated
  // datasheet 5.2) and a '0' bit's high time 26-28 us (Aosong manual, step four).
  const releaseUs = (p('hostReleaseMinUs') + p('hostReleaseMaxUs')) / 2
  const zeroHighUs = (p('bitZeroHighMinUs') + p('bitZeroHighMaxUs')) / 2
  const pullupOhm = def.sim.params.dataPullupOhm
  const pullupTo = def.sim.params.dataPullupTo

  let supply = 0
  let powered = false
  let poweredSince = 0
  let high = true
  let lowSince: number | null = null
  let edges: Edge[] = []
  let next = 0
  let driving = false
  let reading: Reading | null = null

  const reset = () => {
    powered = false
    high = true
    lowSince = null
    edges = []
    next = 0
    driving = false
    reading = null
  }

  const envNumber = (env: Readonly<Record<string, unknown>>, key: string) => {
    const v = env[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`${def.id}: env ${key} is not a number`)
    }
    return v
  }

  const quantise = (v: number, min: number, max: number, res: number) =>
    Math.round(Math.min(max, Math.max(min, v)) / res) * res

  // Data sheet frame: humidity int, humidity decimal (always 0), temperature int, temperature
  // decimal (always 0), and the low 8 bits of their sum.
  const schedule = (r: Reading, from: number) => {
    const h = Math.trunc(r.humidity)
    const t = Math.trunc(r.temperature)
    const bytes = [h, 0, t, 0, (h + t) & 0xff]
    const list: Edge[] = []
    let offsetUs = releaseUs
    list.push({ t: from + offsetUs * US, low: true })
    offsetUs += p('responseLowUs')
    list.push({ t: from + offsetUs * US, low: false })
    offsetUs += p('responseHighUs')
    for (const byte of bytes) {
      for (let bit = 7; bit >= 0; bit--) {
        list.push({ t: from + offsetUs * US, low: true })
        offsetUs += p('bitStartLowUs')
        list.push({ t: from + offsetUs * US, low: false })
        offsetUs += (byte >> bit) & 1 ? p('bitOneHighUs') : zeroHighUs
      }
    }
    list.push({ t: from + offsetUs * US, low: true })
    offsetUs += p('endLowUs')
    list.push({ t: from + offsetUs * US, low: false })
    edges = list
    next = 0
  }

  return {
    update(io) {
      supply = io.v(vdd) - io.v(gnd)
      if (supply < p('vccMinV') * SUPPLY_MARGIN) {
        reset()
        return
      }
      if (!powered) {
        powered = true
        poweredSince = io.t
      }
      const idle = next >= edges.length
      const was = high
      high = logicLevel(io.v(data) - io.v(gnd), VIL_OF_VDD * supply, VIH_OF_VDD * supply, high)
      // Only the host's edges count; the sensor's own drive is ignored while it transmits.
      if (idle) {
        if (was && !high) lowSince = io.t
        else if (!was && high && lowSince !== null) {
          const lowS = io.t - lowSince
          lowSince = null
          const longEnough = lowS >= p('startLowMinMs') / 1000 - EPS_S
          const awake = io.t - poweredSince >= p('powerUpWaitS') - EPS_S
          if (longEnough && awake) {
            // A start inside the sampling period gets the previous reading again.
            if (!reading || io.t - reading.at >= p('samplePeriodMinS') - EPS_S) {
              reading = {
                humidity: quantise(
                  envNumber(io.env, 'humidityPct'),
                  p('humidityMinPct'),
                  p('humidityMaxPct'),
                  p('humidityResolutionPct')
                ),
                temperature: quantise(
                  envNumber(io.env, 'temperatureC'),
                  p('temperatureMinC'),
                  p('temperatureMaxC'),
                  p('temperatureResolutionC')
                ),
                at: io.t
              }
            }
            schedule(reading, io.t)
          }
        }
      }
      while (next < edges.length && edges[next]!.t <= io.t + EPS_S) {
        driving = edges[next]!.low
        next++
      }
      if (edges.length && next >= edges.length) {
        edges = []
        next = 0
      }
    },
    drives() {
      return powered && driving ? { [data]: { ref: gnd, volts: 0, ohms: LOW_OHM } } : {}
    },
    loads() {
      const list: Load[] = []
      if (typeof pullupOhm === 'number' && typeof pullupTo === 'string') {
        list.push({ a: data, b: pullupTo, ohms: pullupOhm })
      }
      if (powered) {
        const active = lowSince !== null || edges.length > 0
        const amps = active
          ? p('supplyCurrentMeasuringMa') / 1000
          : p('supplyCurrentStandbyUa') / 1e6
        list.push({ a: vdd, b: gnd, ohms: supply / amps })
      }
      return list
    },
    nextEvent() {
      return next < edges.length ? edges[next]!.t : Infinity
    },
    view() {
      return {
        powered,
        transmitting: edges.length > 0,
        humidityPct: reading?.humidity ?? null,
        temperatureC: reading?.temperature ?? null
      }
    }
  }
}
