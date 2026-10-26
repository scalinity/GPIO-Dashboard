// The side panels' room beside the stage (ADR-0148). When a panel shows or hides, the stage's
// visible region eases to its new width while the canvas holds still over the union of the old
// region and the new: one resize at a change's start or end instead of one a frame, and a lens
// shift keeps the picture centred in what is visible, so the bench neither jumps nor stretches.
import type { PerspectiveCamera } from 'three/webgpu'

/** How far in from the row's left and right edges a region starts, in px. */
export interface Insets {
  left: number
  right: number
}

export const DOCK_MS = 280

const ease = (t: number) => 1 - (1 - t) ** 3
const same = (a: Insets, b: Insets) => a.left === b.left && a.right === b.right

export class Dock {
  /** The visible region now. */
  now: Insets = { left: 0, right: 0 }
  /** The canvas's region: the union of where the visible one was and is going while it moves. */
  span: Insets = { left: 0, right: 0 }
  private from: Insets = { left: 0, right: 0 }
  private to: Insets | null = null
  private start = 0

  /** Whether the visible region is still on its way. */
  get active(): boolean {
    return this.to !== null
  }

  /** Sets off toward `target` from where the region is; `instant` puts it there at once. */
  aim(target: Insets, now: number, instant = false): void {
    if (same(target, this.to ?? this.now)) return
    if (instant) {
      this.now = this.span = target
      this.to = null
      return
    }
    this.from = this.now
    this.to = target
    this.start = now
    this.span = {
      left: Math.min(this.now.left, target.left),
      right: Math.min(this.now.right, target.right)
    }
  }

  /** Moves the region to where it is at `now`; true while it has further to go. */
  step(now: number): boolean {
    const to = this.to
    if (!to) return false
    const t = Math.min(1, (now - this.start) / DOCK_MS)
    if (t >= 1) {
      this.now = this.span = to
      this.to = null
      return false
    }
    const k = ease(t)
    this.now = {
      left: this.from.left + (to.left - this.from.left) * k,
      right: this.from.right + (to.right - this.from.right) * k
    }
    return true
  }

  /** How far right of the canvas's centre the visible region's centre is, in px. */
  get shift(): number {
    return (this.now.left - this.span.left - (this.now.right - this.span.right)) / 2
  }
}

/**
 * Shifts the lens so the camera's centre lands `px` right of the centre of a canvas `width` px
 * wide, keeping the field of view. three's `filmOffset` is the one shift TRAA's jitter leaves
 * alone: it sets the view offset itself on every frame.
 */
export function shiftLens(camera: PerspectiveCamera, px: number, width: number): void {
  const across = (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) / camera.zoom
  const offset = px && width > 0 ? (-px * across * camera.getFilmWidth()) / width : 0
  if (offset === camera.filmOffset) return
  camera.filmOffset = offset
  camera.updateProjectionMatrix()
}
