// What sim.worker runs (SPEC 4.1, 9): one document's simulation, driven by messages. A pure class,
// so tests drive it without a Worker.
import { partDef } from '../core/defs/parts'
import { erc, type Issue } from '../core/erc/erc'
import type { CircuitDoc } from '../core/model/types'
import type { EnvValue } from '../core/sim/behavior'
import { BEHAVIORS } from '../core/sim/behaviors'
import { simChecks } from '../core/sim/checks'
import { Circuit, type GpioState } from '../core/sim/circuit'
import { rankCandidates, type Ranked } from '../core/sense/candidates'
import { mockSweep } from '../core/sense/mockAgent'
import type { Measured, Sweep } from '../core/sense/sense'
import { probeSignature, type ProbeSignature } from '../core/sim/probe'
import { SimSession, type Snapshot } from '../core/sim/session'

export type SimRequest =
  | { type: 'load'; doc: CircuitDoc }
  | { type: 'gpio'; bcm: number; state: GpioState }
  | { type: 'input'; part: string; key: string; value: EnvValue }
  | { type: 'advance'; t: number }
  | { type: 'probe'; pins: number[] }
  /** A simulated sweep of a physical board document (the mock sense agent). */
  | { type: 'mockSweep'; board: CircuitDoc; pins: number[]; t: number }
  /** Candidate causes for a measurement that diverged from the loaded document. */
  | { type: 'candidates'; measured: Measured; pins: number[] }

export type ReadLevel = ReturnType<SimSession['read']>

export type SimResponse =
  | {
      type: 'state'
      snapshot: Snapshot
      /** Netlist ERC plus the sim-based rules, errors first. */
      issues: Issue[]
      /** What each GPIO configured as an input reads. */
      reads: Record<number, ReadLevel>
    }
  | { type: 'probe'; signature: ProbeSignature }
  | { type: 'sweep'; sweep: Sweep }
  | { type: 'candidates'; ranked: Ranked[] }
  | { type: 'error'; message: string }

export class SimHost {
  private doc: CircuitDoc | null = null
  private session: SimSession | null = null
  private inputs = new Set<number>()

  handle(req: SimRequest): SimResponse {
    try {
      if (req.type === 'load') {
        this.doc = req.doc
        this.session = new SimSession(new Circuit(req.doc, partDef, BEHAVIORS))
        this.inputs.clear()
        return this.state()
      }
      if (req.type === 'mockSweep') {
        return { type: 'sweep', sweep: mockSweep(req.board, partDef, req.pins, req.t) }
      }
      const session = this.session
      if (!session) return { type: 'error', message: 'No circuit is loaded' }
      switch (req.type) {
        case 'gpio':
          session.setGpio(req.bcm, req.state)
          if (req.state.mode === 'in') this.inputs.add(req.bcm)
          else this.inputs.delete(req.bcm)
          return this.state()
        case 'input':
          session.setInput(req.part, req.key, req.value)
          return this.state()
        case 'advance':
          session.advanceTo(req.t)
          return this.state()
        case 'probe':
          return { type: 'probe', signature: probeSignature(session.circuit, req.pins) }
        case 'candidates':
          return {
            type: 'candidates',
            ranked: rankCandidates(this.doc!, partDef, req.measured, req.pins)
          }
      }
    } catch (e) {
      return { type: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }

  private state(): SimResponse {
    const session = this.session!
    const snapshot = session.snapshot()
    const order = { error: 0, warning: 1, info: 2 }
    const issues = [...erc(this.doc!, partDef), ...simChecks(this.doc!, partDef, snapshot)].sort(
      (a, b) => order[a.severity] - order[b.severity]
    )
    const reads = Object.fromEntries([...this.inputs].map((bcm) => [bcm, session.read(bcm)]))
    return { type: 'state', snapshot, issues, reads }
  }
}
