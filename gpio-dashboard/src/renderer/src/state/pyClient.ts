// The main thread's side of pyodide.worker (ADR-0017): one worker, started on first use. Stop and
// part inputs reach a running program through shared memory, since Python blocks the worker.
import type { EnvValue } from '../core/sim/behavior'
import type { CircuitDoc } from '../core/model/types'
import { CONTROL, type PyRequest, type PyResponse } from '../workers/pyProtocol'

const INPUT_BYTES = 64 * 1024
let worker: Worker | null = null
let listener: ((r: PyResponse) => void) | null = null
const control = new Int32Array(new SharedArrayBuffer(4 * 3))
const inputs = new SharedArrayBuffer(INPUT_BYTES)

function send(req: PyRequest) {
  if (!worker) {
    worker = new Worker(new URL('../workers/pyodide.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = (e: MessageEvent<PyResponse>) => listener?.(e.data)
  }
  worker.postMessage(req)
}

/** Receives every response from the worker. */
export function onPython(f: (r: PyResponse) => void) {
  listener = f
}

export function checkCode(source: string) {
  send({ type: 'check', source })
}

export function runCode(doc: CircuitDoc, timeScale: number) {
  Atomics.store(control, CONTROL.interrupt, 0)
  send({ type: 'run', doc, timeScale, control: control.buffer as SharedArrayBuffer, inputs })
}

/** Raises KeyboardInterrupt in the running program, as Ctrl+C does on the Pi. */
export function stopCode() {
  Atomics.store(control, CONTROL.interrupt, 2)
  Atomics.notify(control, CONTROL.wake)
}

/** Hands the running program the current part inputs (switches, sliders). */
export function sendInputs(env: Record<string, Record<string, EnvValue>>) {
  const bytes = new TextEncoder().encode(JSON.stringify(env))
  if (bytes.length > INPUT_BYTES - 4) throw new Error('Too many part inputs to send')
  new Uint8Array(inputs).set(bytes, 4)
  new DataView(inputs).setUint32(0, bytes.length)
  Atomics.add(control, CONTROL.inputs, 1)
  Atomics.notify(control, CONTROL.wake)
}
