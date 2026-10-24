// The main thread's side of sim.worker: one worker, created on first use, answering requests in
// the order they were sent.
import type { SimRequest, SimResponse } from '../workers/simHost'

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, (res: SimResponse) => void>()

export function simRequest(req: SimRequest): Promise<SimResponse> {
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
