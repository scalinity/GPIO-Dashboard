// A stand-in for pi-agent/sense.py (SPEC 14.5 "Mock"): sweeps of a physical board, simulated.
// The board is a document that may differ from the twin, which is how faults are injected. A
// real pad has one pull resistance and one node capacitance, so the mock uses one value of each;
// a reading in the threshold band comes out LOW, as a pad would latch it either way.
import { BEHAVIORS } from '../sim/behaviors'
import { Circuit } from '../sim/circuit'
import { probeSignature, PROBE_DEFAULTS } from '../sim/probe'
import type { CircuitDoc } from '../model/types'
import type { PartDefs } from '../netlist/netlist'
import type { Sweep } from './sense'

export const MOCK_PAD = { pullOhm: 55e3, nodeCapF: 33e-12 }

export function mockSweep(board: CircuitDoc, defs: PartDefs, pins: number[], t = 0): Sweep {
  const one = <T>(v: T) => [v, v] as const
  const sig = probeSignature(new Circuit(board, defs, BEHAVIORS), pins, undefined, {
    ...PROBE_DEFAULTS,
    pullUpOhm: one(MOCK_PAD.pullOhm),
    pullDownOhm: one(MOCK_PAD.pullOhm),
    nodeCapF: one(MOCK_PAD.nodeCapF)
  })
  const level = (r: string) => (r === 'high' ? 1 : 0) as 0 | 1
  const bias: Sweep['bias'] = {}
  const pairs: Sweep['pairs'] = {}
  for (const b of sig.probed) {
    bias[b] = { up: level(sig.bias[b]!.up), down: level(sig.bias[b]!.down) }
    pairs[b] = { up: {}, down: {} }
    for (const drive of ['up', 'down'] as const) {
      for (const [other, r] of Object.entries(sig.pairs[b]![drive])) {
        // follows: the drive level; holds: the opposite precharge.
        const followed = r === 'follows'
        pairs[b]![drive][other] = ((drive === 'up') === followed ? 1 : 0) as 0 | 1
      }
    }
  }
  return { t, pins: sig.probed, skipped: sig.skipped, bias, pairs }
}
