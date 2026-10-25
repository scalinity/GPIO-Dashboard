// Board Sense on the app side (SPEC 14.5): the agent's raw sweeps, read as bias classes and pair
// readings, reconciled per GPIO net against the probe-signature prediction from the document.
// The agent only measures (pi-agent/sense.py); all interpretation is here.
import type { BiasClass, PairReading, ProbeSignature } from '../sim/probe'

/** What the agent sends as `sense_sweep` data: raw levels, 0 or 1. */
export interface Sweep {
  t: number
  pins: number[]
  skipped: { bcm: number; reason: string }[]
  bias: Record<string, { up: 0 | 1; down: 0 | 1 }>
  pairs: Record<string, { up: Record<string, 0 | 1>; down: Record<string, 0 | 1> }>
}

/** A sweep read the way predictions are written. */
export interface Measured {
  bias: Record<number, BiasClass>
  /** pairs[a][bias][b], as in ProbeSignature. */
  pairs: Record<number, Record<'up' | 'down', Record<number, PairReading>>>
}

export function interpret(sweep: Sweep): Measured {
  const bias: Measured['bias'] = {}
  for (const [pin, { up, down }] of Object.entries(sweep.bias)) {
    bias[Number(pin)] =
      up === 1 && down === 0
        ? 'follows-bias'
        : up === 0 && down === 0
          ? 'tied-low'
          : up === 1 && down === 1
            ? 'tied-high'
            : 'ambiguous'
  }
  const pairs: Measured['pairs'] = {}
  for (const [a, byBias] of Object.entries(sweep.pairs)) {
    pairs[Number(a)] = { up: {}, down: {} }
    for (const drive of ['up', 'down'] as const) {
      const target = drive === 'up' ? 1 : 0
      for (const [b, level] of Object.entries(byBias[drive])) {
        // Every other pin was precharged to the opposite level, so reading the drive level
        // means b followed a.
        pairs[Number(a)]![drive][Number(b)] = level === target ? 'follows' : 'holds'
      }
    }
  }
  return { bias, pairs }
}

export type NetState =
  | { state: 'unobserved' }
  | { state: 'matched' }
  | { state: 'ambiguous' }
  | { state: 'skipped'; reason: string }
  | { state: 'settling' }
  | { state: 'diverged'; kind: DivergenceKind; detail: string }

export type DivergenceKind = 'missing-path' | 'extra-path' | 'wrong-level' | 'gpio-short'

/** How one pin's measurement compares with its prediction. */
export function compare(pin: number, expected: ProbeSignature, measured: Measured): NetState {
  const skip = expected.skipped.find((s) => s.bcm === pin)
  if (skip) return { state: 'skipped', reason: skip.reason }
  const want = expected.bias[pin]?.class
  const got = measured.bias[pin]
  if (!want || !got) return { state: 'unobserved' }
  if (got === 'ambiguous') return { state: 'ambiguous' }
  if (want !== 'ambiguous' && want !== got) {
    const tied = (c: BiasClass) => c === 'tied-low' || c === 'tied-high'
    const kind: DivergenceKind = !tied(got)
      ? 'missing-path'
      : !tied(want)
        ? 'extra-path'
        : 'wrong-level'
    return { state: 'diverged', kind, detail: `GPIO${pin} reads ${got}, expected ${want}` }
  }
  // Pair readings: another GPIO following this one, or not, where the twin says otherwise.
  for (const a of expected.probed) {
    for (const drive of ['up', 'down'] as const) {
      const w = expected.pairs[a]?.[drive][pin]
      const g = measured.pairs[a]?.[drive][pin]
      if (!w || !g || w === 'ambiguous' || w === g) continue
      if (a === pin) continue
      if (g === 'follows') {
        return {
          state: 'diverged',
          kind: 'gpio-short',
          detail: `GPIO${pin} follows GPIO${a}, which the twin does not join`
        }
      }
      return {
        state: 'diverged',
        kind: 'missing-path',
        detail: `GPIO${pin} no longer follows GPIO${a}`
      }
    }
  }
  return expected.observable[pin] ? { state: 'matched' } : { state: 'unobserved' }
}

/** A typed event for the log (SPEC 14.5 examples). */
export interface SenseEvent {
  pin: number
  text: string
}

const describe = (pin: number, m: Measured, previous: Measured | null): string | null => {
  const now = m.bias[pin]
  const before = previous?.bias[pin]
  if (now !== before) {
    if (now === 'tied-high') return `GPIO${pin} net gained a path to 3V3`
    if (now === 'tied-low') return `GPIO${pin} net gained a path to GND`
    if (now === 'follows-bias' && before)
      return `GPIO${pin} net lost its path to ${before === 'tied-high' ? '3V3' : 'GND'}`
  }
  for (const [a, byBias] of Object.entries(m.pairs)) {
    if (Number(a) === pin || Number(a) > pin) continue
    const joined = byBias.up[pin] === 'follows' && byBias.down[pin] === 'follows'
    const was = previous?.pairs[Number(a)]
    const wasJoined = was?.up[pin] === 'follows' && was?.down[pin] === 'follows'
    if (joined && !wasJoined) return `GPIO${a} and GPIO${pin} are now joined`
    if (!joined && wasJoined) return `GPIO${a} and GPIO${pin} are no longer joined`
  }
  return null
}

/** One pin's measurement as a comparable key, to tell whether it changed between sweeps. */
const key = (pin: number, m: Measured) =>
  JSON.stringify([
    m.bias[pin],
    Object.entries(m.pairs).map(([a, p]) => [a, p.up[pin], p.down[pin]])
  ])

/**
 * Per-net reconciliation over time: a change in what a pin measures is reported only once it
 * persists for two consecutive sweeps (settling meanwhile), then compared with the prediction.
 */
export class Reconciler {
  private confirmed: Measured | null = null
  private pending: Measured | null = null
  private states = new Map<number, NetState>()
  readonly events: SenseEvent[] = []

  constructor(private expected: ProbeSignature) {
    for (const pin of [...expected.probed, ...expected.skipped.map((s) => s.bcm)]) {
      this.states.set(pin, compare(pin, expected, { bias: {}, pairs: {} }))
    }
  }

  get netStates(): ReadonlyMap<number, NetState> {
    return this.states
  }

  /** The document changed: re-compare the last confirmed measurement with the new prediction. */
  setExpected(expected: ProbeSignature) {
    this.expected = expected
    this.recompare()
  }

  onSweep(sweep: Sweep) {
    const m = interpret(sweep)
    const next: Measured = {
      bias: { ...(this.confirmed?.bias ?? {}) },
      pairs: structuredClone(this.confirmed?.pairs ?? {})
    }
    for (const pin of this.expected.probed) {
      const now = key(pin, m)
      const confirmed = this.confirmed ? key(pin, this.confirmed) : null
      const previous = this.pending ? key(pin, this.pending) : null
      if (confirmed !== null && now !== confirmed && now !== previous) {
        // Seen once: wait for the next sweep before believing it.
        this.states.set(pin, { state: 'settling' })
        continue
      }
      if (confirmed !== null && now !== confirmed) {
        const text = describe(pin, m, this.confirmed)
        if (text) this.events.push({ pin, text })
      }
      next.bias[pin] = m.bias[pin]!
      for (const [a, byBias] of Object.entries(m.pairs)) {
        next.pairs[Number(a)] ??= { up: {}, down: {} }
        next.pairs[Number(a)]!.up[pin] = byBias.up[pin]!
        next.pairs[Number(a)]!.down[pin] = byBias.down[pin]!
      }
    }
    this.confirmed = next
    this.pending = m
    for (const pin of this.expected.probed) {
      if (this.states.get(pin)?.state !== 'settling' || key(pin, m) === key(pin, next)) {
        this.states.set(pin, compare(pin, this.expected, next))
      }
    }
  }

  /** Sensing switched off or paused for a run: nothing is known until sweeps resume. */
  reset() {
    this.confirmed = null
    this.pending = null
    this.recompare()
  }

  private recompare() {
    for (const pin of [...this.expected.probed, ...this.expected.skipped.map((s) => s.bcm)]) {
      this.states.set(pin, compare(pin, this.expected, this.confirmed ?? { bias: {}, pairs: {} }))
    }
  }
}
