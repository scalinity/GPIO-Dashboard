// The main thread's side of sim.worker: a worker created on first use, answering requests in the
// order they were sent. The app's simulation has one; the assistant has its own, so its tool
// calls never disturb what the Sim panel shows.
import type { SimRequest, SimResponse } from '../workers/simHost'

export function simChannel(): (req: SimRequest) => Promise<SimResponse> {
  let worker: Worker | null = null
  let nextId = 0
  const pending = new Map<number, (res: SimResponse) => void>()
  return (req) => {
    if (!worker) {
      worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<{ id: number; res: SimResponse }>) => {
        pending.get(e.data.id)?.(e.data.res)
        pending.delete(e.data.id)
      }
    }
    const id = nextId++
    return new Promise((resolve) => {
      pending.set(id, resolve)
      worker!.postMessage({ id, req })
    })
  }
}

/** The app's simulation: the Workbench, the Studio's visuals and Board Sense use it. */
export const simRequest = simChannel()
