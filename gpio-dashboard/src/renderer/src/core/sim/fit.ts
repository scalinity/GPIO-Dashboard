// Datasheet facts → model parameters (ADR-0012). A part's datasheet gives one typical operating
// point; the model fixes the emission coefficient and series resistance per family and solves IS
// so the curve passes exactly through that point. scripts/reference/ngspice_fixtures.py applies
// the same rules, and fit.test.ts checks the two agree.
import type { PartDef } from '../model/types'
import { VT } from './devices'

export interface DiodeParams {
  is: number
  n: number
  rs: number
}

export interface BjtParams {
  is: number
  bf: number
  br: number
  polarity: 1 | -1
}

/** Emission coefficient and series resistance, per family (ADR-0012). */
export const DIODE_FAMILY = {
  /** Red, orange, yellow and yellow-green dies (AlGaInP, GaAsP, GaP). */
  led: { n: 2, rs: 2 },
  /** Blue, white and true-green dies (InGaN), whose ideality factor runs well above 2. */
  ledInGaN: { n: 3, rs: 2 },
  rectifier: { n: 2, rs: 0.05 }
} as const

/** A die with a typical Vf at or above this is InGaN. */
export const INGAN_MIN_VF = 2.6

/** Ebers–Moll saturation current and reverse β for every BJT (ADR-0012). */
export const BJT_DEFAULTS = { is: 1e-14, br: 1 } as const

/** IS such that the diode carries `ifA` at `vfV` across it (series drop included). */
export function saturationCurrent(vfV: number, ifA: number, n: number, rs: number): number {
  return ifA / Math.expm1((vfV - ifA * rs) / (n * VT))
}

const num = (def: PartDef, key: string): number => {
  const v = def.sim.params[key]
  if (typeof v !== 'number') throw new Error(`${def.id}: sim param ${key} is missing`)
  return v
}

/**
 * An LED die. Single LEDs are keyed `<color>.<size>.*`, RGB LEDs `<color>.*`, and displays (one
 * die type throughout) have unprefixed params, key ''. The fit point is the datasheet's typical
 * Vf at its test current.
 */
export function ledParams(def: PartDef, key: string): DiodeParams {
  const at = (name: string) => num(def, key ? `${key}.${name}` : name)
  const vf = at('vfTypV')
  const { n, rs } = vf >= INGAN_MIN_VF ? DIODE_FAMILY.ledInGaN : DIODE_FAMILY.led
  const ifA = at('ifTestMa') / 1000
  return { is: saturationCurrent(vf, ifA, n, rs), n, rs }
}

/** A rectifier diode, fitted at the typical forward voltage from its characteristic curve. */
export function rectifierParams(def: PartDef): DiodeParams {
  const { n, rs } = DIODE_FAMILY.rectifier
  return { is: saturationCurrent(num(def, 'vfTypFig4V'), num(def, 'vfTestA'), n, rs), n, rs }
}

/** β is the geometric mean of the datasheet's hFE range at its test point. */
export function bjtParams(def: PartDef): BjtParams {
  if (def.sim.model !== 'npn' && def.sim.model !== 'pnp') {
    throw new Error(`${def.id} is not a BJT`)
  }
  return {
    ...BJT_DEFAULTS,
    bf: Math.sqrt(num(def, 'hfeMin') * num(def, 'hfeMax')),
    polarity: def.sim.model === 'npn' ? 1 : -1
  }
}
