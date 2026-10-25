// Build Mode's reading of Board Sense (SPEC 11.7, 14.5): the probe signature of the board once a
// step is done, and the ranked likely causes when a step was done differently. Both are simulated
// in a sim worker of Build Mode's own, one request at a time, so the Sim panel's worker and the
// Workbench's document are untouched and the page never waits on a simulation. Build Mode only
// reads the sweeps; it never starts, stops or configures sensing. A board the simulator cannot
// solve comes back as a signature with `unsolved` set and no observable net, never as an error, so
// its step reads "not electrically verifiable" (core/sense/buildSteps).
import type { CircuitDoc } from '../core/model/types'
import { docUpTo } from '../core/sense/buildSteps'
import type { Ranked } from '../core/sense/candidates'
import type { Measured } from '../core/sense/sense'
import type { ProbeSignature } from '../core/sim/probe'
import type { BuildStep } from '../core/steps/steps'
import { simChannel } from './simClient'

const channel = simChannel()
let queue: Promise<unknown> = Promise.resolve()

/** Runs `job` after every earlier job, so a load and the request that reads it stay together. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

export class StepChecker {
  private readonly signatures = new Map<string, Promise<ProbeSignature>>()

  constructor(
    private readonly doc: CircuitDoc,
    private readonly steps: BuildStep[]
  ) {}

  /** The signature of the board with steps 0 to `index` done (−1: nothing built yet). */
  signature(index: number, pins: number[]): Promise<ProbeSignature> {
    const key = `${index}:${pins.join()}`
    let found = this.signatures.get(key)
    if (!found) {
      found = enqueue(async () => {
        const loaded = await channel({ type: 'load', doc: docUpTo(this.doc, this.steps, index) })
        if (loaded.type === 'error') throw new Error(loaded.message)
        const res = await channel({ type: 'probe', pins })
        if (res.type !== 'probe')
          throw new Error(res.type === 'error' ? res.message : 'no signature')
        return res.signature
      })
      this.signatures.set(key, found)
    }
    return found
  }

  /** Single-fault edits of the board as step `index` leaves it, ranked by the measurement. */
  causes(index: number, measured: Measured, pins: number[]): Promise<Ranked[]> {
    return enqueue(async () => {
      const loaded = await channel({ type: 'load', doc: docUpTo(this.doc, this.steps, index) })
      if (loaded.type === 'error') throw new Error(loaded.message)
      const res = await channel({ type: 'candidates', measured, pins })
      if (res.type !== 'candidates')
        throw new Error(res.type === 'error' ? res.message : 'no candidates')
      return res.ranked
    })
  }
}
