// The physics worker (SPEC 4.3, 10.5): keeps the cable solver off the main thread. It steps on its
// own 60 Hz clock while anything is awake and stops when everything sleeps; a scene message that
// wakes something starts it again.
import { FRAME_DT } from '../physics'
import { PhysicsHost } from './physicsHost'
import { CableBuffer, type PhysicsRequest } from './physicsTransport'

const FRAME_MS = FRAME_DT * 1000

let host: PhysicsHost | null = null
let timer: ReturnType<typeof setTimeout> | null = null
/** When the next step is due; a late step resets it rather than stepping to catch up. */
let due = 0

function tick() {
  timer = null
  if (host?.step()) schedule()
}

function schedule() {
  if (timer !== null) return
  const now = performance.now()
  due = Math.max(due + FRAME_MS, now)
  timer = setTimeout(tick, due - now)
}

self.onmessage = (e: MessageEvent<PhysicsRequest>) => {
  const req = e.data
  if (req.type === 'init') {
    host = new PhysicsHost(new CableBuffer(req.buffer, req.maxParticles))
    return
  }
  host?.apply(req.id, req.scene, req.settle)
  if (host?.awake) schedule()
}
