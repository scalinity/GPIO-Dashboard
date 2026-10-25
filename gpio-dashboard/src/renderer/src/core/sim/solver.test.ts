// Solver and device models against closed-form answers (SPEC 9).
import { describe, expect, it } from 'vitest'
import {
  Bjt,
  Capacitor,
  Diode,
  Inductor,
  Resistor,
  Switch,
  TheveninSource,
  VoltageSource,
  VT,
  pnjlim
} from './devices'
import { SingularMatrixError, solveDc, solveDense, solveTransient } from './solver'

describe('dense LU', () => {
  it('solves a pivoting system exactly', () => {
    // [0 2; 3 1] x = [4; 5] → x = [1, 2]
    const x = solveDense(2, Float64Array.from([0, 2, 3, 1]), Float64Array.from([4, 5]))
    expect([...x]).toEqual([1, 2])
  })

  it('reports a singular matrix', () => {
    expect(() => solveDense(2, Float64Array.from([1, 2, 2, 4]), Float64Array.from([1, 1]))).toThrow(
      SingularMatrixError
    )
  })
})

describe('DC operating point', () => {
  it('solves a divider', () => {
    const x = solveDc(3, [
      new VoltageSource(1, 0, 5),
      new Resistor(1, 2, 1000),
      new Resistor(2, 0, 2000)
    ])
    // gmin (1e-12 S from every node to ground) moves it by nanovolts.
    expect(x[1]).toBeCloseTo(10 / 3, 7)
    // The source supplies 5 V / 3 kΩ; its branch current flows into the + terminal.
    expect(x[2]).toBeCloseTo(-5 / 3000, 10)
  })

  it('stamps a Thévenin source as its Norton equivalent', () => {
    const x = solveDc(2, [new TheveninSource(1, 0, 3.3, 100), new Resistor(1, 0, 900)])
    expect(x[0]).toBeCloseTo(3.3 * 0.9, 9)
  })

  it('opens and closes a switch', () => {
    const sw = new Switch(1, 2, false)
    const devices = [new VoltageSource(1, 0, 3.3), sw, new Resistor(2, 0, 10_000)]
    expect(solveDc(3, devices)[1]).toBeLessThan(1e-3)
    sw.closed = true
    expect(solveDc(3, devices)[1]).toBeCloseTo(3.3 * (10_000 / 10_000.1), 6)
  })

  it('refuses two ideal sources that disagree across the same nodes', () => {
    expect(() => solveDc(2, [new VoltageSource(1, 0, 5), new VoltageSource(1, 0, 3.3)])).toThrow(
      SingularMatrixError
    )
  })

  it('puts a diode and resistor on a point that satisfies both equations', () => {
    const is = 1e-14
    const n = 1
    const r = 1000
    const x = solveDc(3, [
      new VoltageSource(1, 0, 5),
      new Resistor(1, 2, r),
      new Diode(2, 0, is, n)
    ])
    const vd = x[1]!
    const iR = (5 - vd) / r
    const iD = is * (Math.exp(vd / (n * VT)) - 1)
    expect(Math.abs(iR - iD) / iR).toBeLessThan(1e-6)
    expect(vd).toBeGreaterThan(0.6)
    expect(vd).toBeLessThan(0.75)
  })

  it('blocks reverse current through a diode', () => {
    const x = solveDc(3, [
      new VoltageSource(1, 0, -5),
      new Resistor(1, 2, 1000),
      new Diode(2, 0, 1e-14, 1)
    ])
    expect(x[1]).toBeCloseTo(-5, 3)
  })

  it('saturates an NPN switch driven hard', () => {
    // 3.3 V → 1 kΩ → base; 5 V → 220 Ω → collector; emitter to ground. β = 100.
    const q = new Bjt(3, 2, 0, 1e-14, 100, 1, 1)
    const x = solveDc(5, [
      new VoltageSource(1, 0, 3.3),
      new Resistor(1, 2, 1000),
      new VoltageSource(4, 0, 5),
      new Resistor(4, 3, 220),
      q
    ])
    const vb = x[1]!
    const vc = x[2]!
    expect(vb).toBeGreaterThan(0.6)
    expect(vb).toBeLessThan(0.85)
    expect(vc).toBeLessThan(0.2)
  })

  it('amplifies with the datasheet β in the active region', () => {
    // Base current set by 2.3 V / 1 MΩ ≈ 1.6 µA → Ic ≈ β Ib, far from saturation.
    const q = new Bjt(3, 2, 0, 1e-14, 150, 1, 1)
    const x = solveDc(5, [
      new VoltageSource(1, 0, 2.3),
      new Resistor(1, 2, 1e6),
      new VoltageSource(4, 0, 5),
      new Resistor(4, 3, 1000),
      q
    ])
    const ib = (2.3 - x[1]!) / 1e6
    const ic = (5 - x[2]!) / 1000
    expect(ic / ib).toBeCloseTo(150, 0)
  })

  it('mirrors NPN with PNP', () => {
    // PNP high-side switch: emitter 5 V, base pulled to 0 through 10 kΩ, collector load 1 kΩ.
    const q = new Bjt(3, 2, 1, 1e-14, 100, 1, -1)
    const x = solveDc(4, [
      new VoltageSource(1, 0, 5),
      new Resistor(2, 0, 10_000),
      new Resistor(3, 0, 1000),
      q
    ])
    expect(5 - x[1]!).toBeGreaterThan(0.6)
    expect(x[2]).toBeGreaterThan(4.7)
  })

  it('treats an inductor as a short in DC and a capacitor as an open', () => {
    const x = solveDc(4, [
      new VoltageSource(1, 0, 5),
      new Inductor(1, 2, 1e-3),
      new Resistor(2, 0, 100),
      new Capacitor(2, 3, 1e-6),
      new Resistor(3, 0, 1000)
    ])
    expect(x[1]).toBeCloseTo(5, 9)
    expect(x[2]).toBeCloseTo(0, 6)
  })
})

describe('transient', () => {
  it('charges an RC to within 0.1% of the analytic curve', () => {
    const r = 1000
    const c = 1e-6
    const src = new VoltageSource(1, 0, 0)
    const devices = [src, new Resistor(1, 2, r), new Capacitor(2, 0, c)]
    const x0 = solveDc(3, devices)
    src.volts = 3.3
    const tau = r * c
    const run = solveTransient(3, devices, 5 * tau, tau / 200, {}, x0)
    for (const [i, t] of run.times.entries()) {
      if (i === 0) continue
      const want = 3.3 * (1 - Math.exp(-t / tau))
      expect(Math.abs(run.solutions[i]![1]! - want)).toBeLessThan(3.3e-3)
    }
  })

  it('ramps current through an RL to within 0.1% of the analytic curve', () => {
    const r = 10
    const l = 10e-3
    const src = new VoltageSource(1, 0, 0)
    const coil = new Inductor(2, 0, l)
    const devices = [src, new Resistor(1, 2, r), coil]
    const x0 = solveDc(3, devices)
    src.volts = 5
    const tau = l / r
    const run = solveTransient(3, devices, 5 * tau, tau / 200, {}, x0)
    const last = run.solutions.at(-1)!
    // Branch 0 is the source, branch 1 the coil.
    const iL = last[2 + coil.branchBase]!
    expect(iL).toBeCloseTo(0.5 * (1 - Math.exp(-5)), 3)
  })
})

describe('junction limiting', () => {
  it('passes small steps and compresses large forward ones logarithmically', () => {
    expect(pnjlim(0.65, 0.64, VT, 0.6)).toBe(0.65)
    const limited = pnjlim(5, 0.6, VT, 0.6)
    expect(limited).toBeGreaterThan(0.6)
    expect(limited).toBeLessThan(0.8)
  })

  it('converges a diode driven straight from 12 V through 10 Ω', () => {
    const x = solveDc(3, [
      new VoltageSource(1, 0, 12),
      new Resistor(1, 2, 10),
      new Diode(2, 0, 1e-14, 1)
    ])
    const vd = x[1]!
    expect(Math.abs((12 - vd) / 10 - 1e-14 * (Math.exp(vd / VT) - 1))).toBeLessThan(1e-6)
  })
})
