// The simulation worker (SPEC 4.1): keeps solves off the main thread.
import { SimHost, type SimRequest } from './simHost'

const host = new SimHost()
self.onmessage = (e: MessageEvent<{ id: number; req: SimRequest }>) => {
  self.postMessage({ id: e.data.id, res: host.handle(e.data.req) })
}
