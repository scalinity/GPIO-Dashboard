// What a Studio frame costs, for the dev overlay (SPEC 10.8): the main thread's time in the render
// call, and the GPU's time over every render pass of the latest resolved frame (timestamp queries).
// Dev builds only: the renderer reports it every 30 frames.

export interface FrameCost {
  /** Mean main-thread time in the pipeline's render call, ms. */
  renderMs: number
  /** The GPU's summed pass time for one frame, ms; null where the backend has no timestamp queries. */
  gpuMs: number | null
}

let cost: FrameCost | null = null
const listeners = new Set<() => void>()

export function setFrameCost(next: FrameCost): void {
  cost = next
  listeners.forEach((notify) => notify())
}

export function subscribeFrameCost(notify: () => void): () => void {
  listeners.add(notify)
  return () => listeners.delete(notify)
}

export const getFrameCost = (): FrameCost | null => cost
