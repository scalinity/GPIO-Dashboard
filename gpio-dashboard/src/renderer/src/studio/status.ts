// What the dev overlay shows of the Studio (SPEC 10.2, 10.8): the backend WebGPURenderer chose,
// how many frames it has drawn, the frame rate of the last continuous run of frames, and the
// physics worker's step times.

export type Backend = 'WebGPU' | 'WebGL2 (fallback)'

export interface StudioStatus {
  /** Null until the Studio first opens. */
  backend: Backend | null
  frames: number
  fps: number | null
  /** The worker's last step, and the mean and longest of its current run of awake steps, in ms. */
  physics: { last: number; mean: number; max: number } | null
}

let status: StudioStatus = { backend: null, frames: 0, fps: null, physics: null }
const listeners = new Set<() => void>()

export function setStatus(patch: Partial<StudioStatus>): void {
  status = { ...status, ...patch }
  listeners.forEach((notify) => notify())
}

export function subscribeStatus(notify: () => void): () => void {
  listeners.add(notify)
  return () => listeners.delete(notify)
}

export const getStatus = (): StudioStatus => status
