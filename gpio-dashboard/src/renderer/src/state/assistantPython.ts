// The main thread's side of the assistant's Pyodide worker: a syntax check, and a run of the
// project's code in the simulator for some virtual seconds with its pin events. A run that is
// stopped, or that runs past REAL_LIMIT_MS of real time, is interrupted as Ctrl+C would; a worker
// that does not answer even then is replaced.
import type { PythonDiagnostic, SimRun } from '../assistant/context'
import type { CircuitDoc } from '../core/model/types'
import type { AssistantPyRequest, AssistantPyResponse } from '../workers/assistantRun'

/** Real time a run may take before it is interrupted. */
const REAL_LIMIT_MS = 30_000
/** After an interrupt, how long the worker has to answer before it is replaced. */
const GRACE_MS = 5_000

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, (res: AssistantPyResponse | null) => void>()

/** Python requests run one at a time in the worker; each waits its turn here too. */
let queue: Promise<unknown> = Promise.resolve()

function start(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/assistantPython.worker.ts', import.meta.url), {
    type: 'module'
  })
  worker.onmessage = (e: MessageEvent<AssistantPyResponse>) => {
    pending.get(e.data.id)?.(e.data)
    pending.delete(e.data.id)
  }
  return worker
}

/** A worker that stopped answering: drop it and every request waiting on it. */
function replace() {
  worker?.terminate()
  worker = null
  for (const resolve of pending.values()) resolve(null)
  pending.clear()
}

type Request =
  | Omit<Extract<AssistantPyRequest, { type: 'check' }>, 'id'>
  | Omit<Extract<AssistantPyRequest, { type: 'run' }>, 'id'>

function send(req: Request): { id: number; answer: Promise<AssistantPyResponse | null> } {
  const id = nextId++
  const answer = new Promise<AssistantPyResponse | null>((resolve) => pending.set(id, resolve))
  start().postMessage({ ...req, id })
  return { id, answer }
}

function serially<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

export function checkPython(source: string): Promise<PythonDiagnostic[]> {
  return serially(async () => {
    const res = await send({ type: 'check', source }).answer
    if (res?.type !== 'diagnostics') throw new Error('Python stopped answering')
    return res.diagnostics
  })
}

export function runCodeInSim(
  doc: CircuitDoc,
  seconds: number,
  signal?: AbortSignal
): Promise<SimRun> {
  return serially(async () => {
    if (signal?.aborted) throw new DOMException('The run was stopped.', 'AbortError')
    const control = new SharedArrayBuffer(4)
    const flag = new Int32Array(control)
    const ended: { why: 'stopped' | 'time' | null } = { why: null }
    let grace: ReturnType<typeof setTimeout> | undefined
    const interrupt = (reason: 'stopped' | 'time') => {
      if (ended.why) return
      ended.why = reason
      Atomics.store(flag, 0, 2)
      grace = setTimeout(replace, GRACE_MS)
    }
    const onAbort = () => interrupt('stopped')
    signal?.addEventListener('abort', onAbort, { once: true })
    const limit = setTimeout(() => interrupt('time'), REAL_LIMIT_MS)
    try {
      const res = await send({ type: 'run', doc, seconds, control }).answer
      if (ended.why === 'stopped') throw new DOMException('The run was stopped.', 'AbortError')
      if (res?.type !== 'run') throw new Error('Python stopped answering and was restarted')
      const { stdout, stderr, error, events, truncated } = res
      return {
        stdout,
        stderr,
        error:
          error ??
          (ended.why === 'time'
            ? `The run took more than ${REAL_LIMIT_MS / 1000} s of real time and was interrupted.`
            : null),
        events,
        truncated
      }
    } finally {
      clearTimeout(limit)
      clearTimeout(grace)
      signal?.removeEventListener('abort', onAbort)
    }
  })
}
