// Render on demand (SPEC 10.2): frames run while something moves, then up to SETTLE_FRAMES more so
// TRAA converges, then none. A frame nobody scheduled (a change: hover, a document edit, a resize)
// starts the same settling run.

export const SETTLE_FRAMES = 16

/** Frames further apart than this belong to separate runs. */
const RUN_GAP_MS = 100

export class FrameLoop {
  /** Frames rendered since the Studio mounted; tests read it. */
  frames = 0
  private remaining = 0
  private run = { start: 0, last: -Infinity, frames: 0 }

  /** Something changed while still: the next frames settle it. */
  changed(): void {
    this.remaining = SETTLE_FRAMES
  }

  /** Call once per rendered frame, at time `now` (ms). Returns whether another frame is needed. */
  tick(moving: boolean, now: number): boolean {
    this.frames += 1
    if (now - this.run.last > RUN_GAP_MS) this.run = { start: now, last: now, frames: 0 }
    this.run.frames += 1
    this.run.last = now
    if (moving) this.remaining = SETTLE_FRAMES
    else if (this.remaining > 0) this.remaining -= 1
    else this.remaining = SETTLE_FRAMES - 1
    return moving || this.remaining > 0
  }

  /** When the last frame was drawn (ms, the clock `tick` was given); tests time the stop with it. */
  get lastAt(): number {
    return this.run.last
  }

  /** Frames per second over the current (or last) run of consecutive frames, once it has some. */
  get fps(): number | null {
    const { start, last, frames } = this.run
    return frames > SETTLE_FRAMES ? ((frames - 1) * 1000) / (last - start) : null
  }
}
