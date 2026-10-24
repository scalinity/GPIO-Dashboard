// Run in Sim (SPEC 13.2, ADR-0017): Pyodide and the simulated circuit in one worker, so every shim
// call is a direct call. Python blocks this worker while it runs, so the UI reaches it through
// shared memory: `control` holds the interrupt flag Pyodide polls (Stop raises KeyboardInterrupt),
// a wake word for paced sleeps, and a counter bumped when `inputs` (part inputs as JSON) changes.
import type { PyodideInterface } from 'pyodide'
import { partDef } from '../core/defs/parts'
import type { CircuitDoc } from '../core/model/types'
import type { EnvValue } from '../core/sim/behavior'
import { BEHAVIORS } from '../core/sim/behaviors'
import { Circuit } from '../core/sim/circuit'
import { SimSession, type Snapshot } from '../core/sim/session'
import { Bridge } from './bridge'
import { compileCheck, createPython, runProgram, type Diagnostic } from './python'
import type { ReadLevel } from './simHost'

export const CONTROL = { interrupt: 0, wake: 1, inputs: 2 } as const

export type PyRequest =
  | { type: 'check'; source: string }
  | {
      type: 'run'
      doc: CircuitDoc
      /** Virtual seconds per real second; Infinity runs as fast as the solver allows. */
      timeScale: number
      control: SharedArrayBuffer
      inputs: SharedArrayBuffer
    }

export type PyResponse =
  | { type: 'diagnostics'; diagnostics: Diagnostic[] }
  | { type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'state'; snapshot: Snapshot; reads: Record<number, ReadLevel> }
  | { type: 'exit'; error: string | null }

/** Snapshots go to the UI at most this often, in real time. */
const POST_EVERY_MS = 33
/** A paced sleep waits in slices of at most this long, so Stop and inputs act promptly. */
const SLICE_MS = 20

const post = (r: PyResponse) => self.postMessage(r)
let python: Promise<PyodideInterface> | null = null
const pyodide = () =>
  (python ??= createPython({
    indexURL: '/pyodide/',
    stdout: (text) => post({ type: 'output', stream: 'stdout', text }),
    stderr: (text) => post({ type: 'output', stream: 'stderr', text })
  }))

function run(py: PyodideInterface, req: Extract<PyRequest, { type: 'run' }>) {
  const control = new Int32Array(req.control)
  const inputBytes = new Uint8Array(req.inputs)
  const session = new SimSession(new Circuit(req.doc, partDef, BEHAVIORS))
  let inputsSeen = -1
  const drainInputs = () => {
    const seq = Atomics.load(control, CONTROL.inputs)
    if (seq === inputsSeen) return
    inputsSeen = seq
    const length = new DataView(req.inputs).getUint32(0)
    const json = new TextDecoder().decode(inputBytes.slice(4, 4 + length))
    const env = JSON.parse(json || '{}') as Record<string, Record<string, EnvValue>>
    for (const [part, values] of Object.entries(env)) {
      for (const [key, value] of Object.entries(values)) session.setInput(part, key, value)
    }
  }
  const bridge = new Bridge(session, drainInputs)
  let lastPost = 0
  const publish = (force = false) => {
    const now = performance.now()
    if (!force && now - lastPost < POST_EVERY_MS) return
    lastPost = now
    post({
      type: 'state',
      snapshot: session.snapshot(),
      reads: Object.fromEntries(bridge.inputPins().map((bcm) => [bcm, session.read(bcm)]))
    })
  }
  const sleep = (s: number) => {
    let left = s
    while (left > 0 && control[CONTROL.interrupt] === 0) {
      const slice = Number.isFinite(req.timeScale)
        ? Math.min(left, (SLICE_MS / 1000) * req.timeScale)
        : left
      if (Number.isFinite(req.timeScale)) {
        Atomics.wait(control, CONTROL.wake, 0, (slice / req.timeScale) * 1000)
      }
      bridge.sleep(slice)
      left -= slice
      publish()
    }
  }
  try {
    runProgram(py, bridge, req.doc.code.source, sleep, control.subarray(0, 1))
    publish(true)
    post({ type: 'exit', error: null })
  } catch (e) {
    publish(true)
    const message = e instanceof Error ? e.message : String(e)
    post({ type: 'exit', error: /KeyboardInterrupt/.test(message) ? null : message })
  }
}

self.onmessage = async (e: MessageEvent<PyRequest>) => {
  const py = await pyodide()
  if (e.data.type === 'check') {
    post({ type: 'diagnostics', diagnostics: compileCheck(py, e.data.source) })
  } else {
    run(py, e.data)
  }
}
