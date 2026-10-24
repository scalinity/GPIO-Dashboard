// Probe-signature mode (SPEC 9, 14.5): what Board Sense should read from each probed GPIO, from
// the document alone. Every probed GPIO is an input whose bias is pull-up, pull-down or none. The
// pull resistance and node capacitance are ranges carried through every prediction, so a reading
// that depends on where in the range the real pad sits comes out ambiguous.
import { RP1 } from '../constants/rp1'
import type { PinRole } from '../model/types'
import type { EnvValue } from './behavior'
import type { Circuit } from './circuit'
import { Capacitor, Resistor } from './devices'
import type { Device } from './solver'
import { solveTransient } from './solver'

export interface ProbeRange {
  pullUpOhm: readonly [number, number]
  pullDownOhm: readonly [number, number]
  /** Each GPIO net's capacitance to ground: pad, ribbon conductor, strip and leads (ADR-0013). */
  nodeCapF: readonly [number, number]
  /** How long the pair test waits after applying the driving pin's pull (ADR-0013). */
  settleS: number
}

export const PROBE_DEFAULTS: ProbeRange = {
  pullUpOhm: [RP1.pullUpOhm.min, RP1.pullUpOhm.max],
  pullDownOhm: [RP1.pullDownOhm.min, RP1.pullDownOhm.max],
  nodeCapF: [10e-12, 100e-12],
  settleS: 100e-6
}

export type Bias = 'up' | 'down'
export type Reading = 'low' | 'high' | 'ambiguous'
export type BiasClass = 'follows-bias' | 'tied-low' | 'tied-high' | 'ambiguous'
/** In the pair test, a pin took the driving pin's level, kept its precharge, or can't be told. */
export type PairReading = 'follows' | 'holds' | 'ambiguous'

export interface ProbeSignature {
  probed: number[]
  skipped: { bcm: number; reason: string }[]
  bias: Record<number, { up: Reading; down: Reading; class: BiasClass }>
  /** pairs[a][bias][b]: what b reads once a's pull is applied and every other pin released. */
  pairs: Record<number, Record<Bias, Record<number, PairReading>>>
  /** Whether the net's expected readings differ, for certain, from "nothing attached". */
  observable: Record<number, boolean>
}

/** Pin roles whose nets are never probed: bias edges would reach or fight them (SPEC 14.5). */
const SKIP: Partial<Record<PinRole, string>> = {
  base: 'a transistor base, which bias edges would switch',
  'logic-in': 'a logic input, which bias edges reach',
  'logic-out': 'a logic output, which drives the net',
  'logic-io': 'a logic input/output, which bias edges reach',
  'analog-in': 'an ADC input, which bias would load',
  'analog-out': 'a module output, which drives the net',
  'driver-out': 'a driver output, which drives the net',
  signal: 'a module signal input, which bias edges switch'
}

const classify = (v: number): Reading =>
  v <= RP1.vilMaxV ? 'low' : v >= RP1.vihMinV ? 'high' : 'ambiguous'

/** One answer if every corner of the ranges agrees, else ambiguous. */
function agree<T extends string>(readings: T[], ambiguous: T): T {
  return readings.every((r) => r === readings[0]) ? readings[0]! : ambiguous
}

export function probeSignature(
  circuit: Circuit,
  candidates: number[],
  env: Map<string, Record<string, EnvValue>> = circuit.defaultEnv(),
  range: ProbeRange = PROBE_DEFAULTS
): ProbeSignature {
  const envOf = (part: string) => env.get(part)!
  const v33 = circuit.nodeOfNet.get('3V3')!
  const none = new Map()

  const skipped: ProbeSignature['skipped'] = []
  const probed: number[] = []
  for (const bcm of candidates) {
    const net = circuit.nl.nets.find((n) => n.names.includes(`GPIO${bcm}`))
    const sensitive = net?.members.flatMap((m) => {
      if (m.kind !== 'part') return []
      const instance = circuit.doc.parts.find((p) => p.id === m.part)!
      const role = circuit.defs(instance.defId).pins.find((p) => p.id === m.pin)!.role
      return SKIP[role] ? [`${m.part}.${m.pin} is ${SKIP[role]}`] : []
    })
    if (!net) skipped.push({ bcm, reason: 'not on the header' })
    else if (sensitive?.length) skipped.push({ bcm, reason: sensitive[0]! })
    else probed.push(bcm)
  }

  const node = (bcm: number) => circuit.gpioNodes.get(bcm)!
  const at = (x: Float64Array, n: number) => (n === 0 ? 0 : x[n - 1]!)
  const pull = (bcm: number, bias: Bias, ohms: number) =>
    new Resistor(node(bcm), bias === 'up' ? v33 : 0, ohms)
  const ohmsRange = (bias: Bias) => (bias === 'up' ? range.pullUpOhm : range.pullDownOhm)

  // Bias test: every probed pin pulled the same way at once, at each end of the pull range.
  const biasReading = (bias: Bias): Map<number, Reading> => {
    const corners = ohmsRange(bias).map((ohms) => {
      const { x } = circuit.solve(
        none,
        envOf,
        undefined,
        new Map(),
        probed.map((b) => pull(b, bias, ohms))
      )
      return new Map(probed.map((b) => [b, classify(at(x, node(b)))]))
    })
    return new Map(
      probed.map((b) => [
        b,
        agree(
          corners.map((c) => c.get(b)!),
          'ambiguous'
        )
      ])
    )
  }
  const up = biasReading('up')
  const down = biasReading('down')
  const bias: ProbeSignature['bias'] = {}
  for (const b of probed) {
    const u = up.get(b)!
    const d = down.get(b)!
    const cls: BiasClass =
      u === 'high' && d === 'low'
        ? 'follows-bias'
        : u === 'low' && d === 'low'
          ? 'tied-low'
          : u === 'high' && d === 'high'
            ? 'tied-high'
            : 'ambiguous'
    bias[b] = { up: u, down: d, class: cls }
  }

  // Pair test: precharge every pin to the opposite level through its pull, release them all,
  // apply the driving pin's pull, and read after the settle time. Nets that only capacitance
  // holds keep their precharge; this is a transient, never a DC solve (gmin would discharge them).
  const nets = [...new Set(probed.map(node))]
  const pairs: ProbeSignature['pairs'] = {}
  for (const a of probed) {
    pairs[a] = { up: {}, down: {} }
    for (const drive of ['up', 'down'] as const) {
      const opposite: Bias = drive === 'up' ? 'down' : 'up'
      const target: Reading = drive === 'up' ? 'high' : 'low'
      const corners: Map<number, PairReading>[] = []
      for (const ohms of ohmsRange(drive)) {
        for (const farads of range.nodeCapF) {
          // The precharge settles through the pulls, so its level does not depend on capacitance.
          const pre = circuit.solve(
            none,
            envOf,
            undefined,
            new Map(),
            probed.map((b) => pull(b, opposite, ohmsRange(opposite)[0]))
          )
          const devices: Device[] = circuit.devices(none, envOf, new Map(), [
            pull(a, drive, ohms),
            ...nets.map((n) => new Capacitor(n, 0, farads))
          ])
          const run = solveTransient(
            circuit.nodes,
            devices,
            range.settleS,
            range.settleS / 100,
            {},
            pre.x
          )
          const end = run.solutions.at(-1)!
          corners.push(
            new Map(
              probed.map((b) => {
                const r = classify(at(end, node(b)))
                return [b, r === target ? 'follows' : r === 'ambiguous' ? 'ambiguous' : 'holds']
              })
            )
          )
        }
      }
      for (const b of probed)
        pairs[a][drive][b] = agree(
          corners.map((c) => c.get(b)!),
          'ambiguous'
        )
    }
  }

  // Observable: some reading is certain and differs from what an unattached pin would read
  // (follows its bias; follows its own pull; holds its precharge when another pin is driven).
  const observable: ProbeSignature['observable'] = {}
  for (const b of probed) {
    const tied = bias[b]!.class === 'tied-low' || bias[b]!.class === 'tied-high'
    const readings = probed.flatMap((a) =>
      (['up', 'down'] as const).map((d) => ({ self: a === b, r: pairs[a]![d][b]! }))
    )
    observable[b] = tied || readings.some(({ self, r }) => (self ? r === 'holds' : r === 'follows'))
  }

  return { probed, skipped, bias, pairs, observable }
}
