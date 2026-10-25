// The simulator against ngspice (SPEC 9 validation): every fixture within the recorded tolerance.
// fixtures/ngspice.json comes from scripts/reference/ngspice_fixtures.py.
import { describe, expect, it } from 'vitest'
import { outputResistanceOhm } from '../constants/rp1'
import { partDef } from '../defs/parts'
import reference from './fixtures/ngspice.json'
import { Bjt, Capacitor, Diode, Resistor, VoltageSource } from './devices'
import { bjtParams, ledParams, rectifierParams } from './fit'
import type { Device } from './solver'
import { solveDc, solveTransient } from './solver'

type Element =
  | { type: 'V'; name: string; p: number; n: number; volts: number }
  | { type: 'R'; p: number; n: number; ohms: number }
  | { type: 'C'; p: number; n: number; farads: number }
  | { type: 'D'; a: number; k: number; is: number; n: number; rs: number; fit: Fit }
  | {
      type: 'Q'
      c: number
      b: number
      e: number
      is: number
      bf: number
      br: number
      polarity: number
      fit: Fit
    }
interface Fit {
  part: string
  key?: string
}
interface Fixture {
  id: string
  analysis: string
  step?: number
  stop?: number
  elements: Element[]
  results: Record<string, number>
}

// The JSON import infers a union of each fixture's literal keys; the shape is checked at runtime by use.
const fixtures = reference.fixtures as unknown as Fixture[]

function build(elements: Element[]) {
  let nodes =
    1 +
    Math.max(
      ...elements.flatMap((e) => ('p' in e ? [e.p, e.n] : 'a' in e ? [e.a, e.k] : [e.c, e.b, e.e]))
    )
  const devices: Device[] = []
  const sources = new Map<string, VoltageSource>()
  for (const e of elements) {
    if (e.type === 'V') {
      const v = new VoltageSource(e.p, e.n, e.volts)
      sources.set(e.name, v)
      devices.push(v)
    } else if (e.type === 'R') devices.push(new Resistor(e.p, e.n, e.ohms))
    else if (e.type === 'C') devices.push(new Capacitor(e.p, e.n, e.farads))
    else if (e.type === 'D') {
      // Series resistance on an internal node between the anode and the junction.
      const junction = nodes++
      devices.push(new Resistor(e.a, junction, e.rs), new Diode(junction, e.k, e.is, e.n))
    } else devices.push(new Bjt(e.c, e.b, e.e, e.is, e.bf, e.br, e.polarity === 1 ? 1 : -1))
  }
  return { nodes, devices, sources }
}

function probe(key: string, x: Float64Array, nodes: number, sources: Map<string, VoltageSource>) {
  const v = /^v\((\d+)\)/.exec(key)
  if (v) return x[Number(v[1]) - 1]!
  const i = /^i\((\w+)\)$/.exec(key)
  const source = i && sources.get(i[1]!)
  if (!source) throw new Error(`Unknown probe ${key}`)
  return x[nodes - 1 + source.branchBase]!
}

describe('fixtures match ngspice', () => {
  it('cover the fixtures SPEC 9 names', () => {
    const ids = fixtures.map((f) => f.id)
    for (const prefix of ['divider', 'led-', 'rc-step', 'bjt-switch', 'button-pulldown']) {
      expect(
        ids.some((id) => id.startsWith(prefix)),
        prefix
      ).toBe(true)
    }
    expect(reference.tolerance).toBe(0.02)
  })

  it.each(fixtures.map((f) => [f.id, f] as const))('%s', (_id, fx) => {
    const { nodes, devices, sources } = build(fx.elements)
    const within = (key: string, got: number) => {
      const want = fx.results[key]!
      expect(Math.abs(got - want), `${key}: ${got} vs ngspice ${want}`).toBeLessThanOrEqual(
        reference.tolerance * Math.abs(want) + 1e-9
      )
    }
    if (fx.analysis === 'op') {
      const x = solveDc(nodes, devices)
      for (const key of Object.keys(fx.results)) within(key, probe(key, x, nodes, sources))
      return
    }
    // ngspice's "uic": every capacitor starts at 0 V with the sources already at their values.
    const run = solveTransient(
      nodes,
      devices,
      fx.stop!,
      fx.step!,
      {},
      new Float64Array(nodes - 1 + sources.size)
    )
    for (const key of Object.keys(fx.results)) {
      const [expr, at] = key.split('@')
      const index = run.times.findIndex((t) => Math.abs(t - Number(at)) < fx.step! / 2)
      expect(index, key).toBeGreaterThan(0)
      within(key, probe(expr!, run.solutions[index]!, nodes, sources))
    }
  })
})

describe('the fixtures were fitted with the same rules as fit.ts', () => {
  const fitted = fixtures.flatMap((f) => f.elements).filter((e) => e.type === 'D' || e.type === 'Q')

  it.each(fitted.map((e) => [`${e.fit.part} ${e.fit.key ?? ''}`, e] as const))(
    '%s',
    (_label, e) => {
      const def = partDef(e.fit.part)
      if (e.type === 'Q') {
        const p = bjtParams(def)
        expect(p.bf).toBeCloseTo(e.bf, 9)
        expect([p.is, p.br, p.polarity]).toEqual([e.is, e.br, e.polarity])
        return
      }
      const p = e.fit.key ? ledParams(def, e.fit.key) : rectifierParams(def)
      expect(Math.abs(p.is - e.is) / e.is).toBeLessThan(1e-9)
      expect([p.n, p.rs]).toEqual([e.n, e.rs])
    }
  )

  it('drives LEDs through the RP1 output resistance at the default drive', () => {
    const gpio = fixtures.find((f) => f.id === 'led-red-5mm')!.elements[1]!
    expect(gpio.type === 'R' && gpio.ohms).toBeCloseTo(outputResistanceOhm('high'), 9)
  })
})
