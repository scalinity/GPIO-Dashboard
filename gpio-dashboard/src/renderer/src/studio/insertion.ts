// The eased insertion (SPEC 10.6, 11.3): a part or lead end that a commit puts in new holes drops
// its last few millimetres into them over INSERT_MS. While a drag previews it, it hovers at the top
// of that drop. Parts are keyed by id, lead ends by `<wire>:<a|b>`.
import type { CircuitDoc } from '../core/model/types'

export const INSERT_MS = 150
export const INSERT_LIFT_MM = 4

/** Where each part and lead end is seated, as text to compare. */
function seats(doc: CircuitDoc): Map<string, string> {
  const m = new Map<string, string>()
  for (const p of doc.parts) m.set(p.id, JSON.stringify(p.placement))
  for (const w of doc.wires) {
    m.set(`${w.id}:a`, JSON.stringify(w.a))
    m.set(`${w.id}:b`, JSON.stringify(w.b))
  }
  return m
}

/** The keys `after` seats somewhere `before` does not. */
export function reseated(before: CircuitDoc, after: CircuitDoc): string[] {
  const was = seats(before)
  return [...seats(after)].flatMap(([key, seat]) => (was.get(key) === seat ? [] : [key]))
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

export class Insertion {
  private hovering = new Set<string>()
  private started = new Map<string, number>()

  /**
   * Whether anything was still seating at `now`. What has finished is dropped, so the frame that
   * asks draws it at its seat.
   */
  settle(now: number): boolean {
    const any = this.started.size > 0
    for (const [key, start] of this.started) if (now - start >= INSERT_MS) this.started.delete(key)
    return any
  }

  /** What a drag previews hovers until it is committed or dropped. */
  hover(keys: string[]): void {
    this.hovering = new Set(keys)
  }

  /** What was just committed seats from now. */
  start(keys: string[], now: number): void {
    for (const key of keys) this.started.set(key, now)
  }

  /** How far above its seat `key` is at `now`, in mm. */
  lift(key: string, now: number): number {
    if (this.hovering.has(key)) return INSERT_LIFT_MM
    const start = this.started.get(key)
    if (start === undefined) return 0
    const t = Math.min(1, Math.max(0, (now - start) / INSERT_MS))
    return INSERT_LIFT_MM * (1 - easeOut(t))
  }
}
