// What the assistant's Python worker runs (SPEC 12.5 run_code_in_sim): the project's program in
// virtual time, as fast as the solver allows, for a set number of virtual seconds, with every
// change it makes to a pin written down. Kept apart from the worker so tests run it on Pyodide in
// Node.
import type { PyodideInterface } from 'pyodide'
import { partDef } from '../core/defs/parts'
import type { CircuitDoc } from '../core/model/types'
import { BEHAVIORS } from '../core/sim/behaviors'
import { Circuit } from '../core/sim/circuit'
import { SimSession } from '../core/sim/session'
import { Bridge } from './bridge'
import { type Diagnostic, runProgram } from './python'

export type AssistantPyRequest =
  | { type: 'check'; id: number; source: string }
  | {
      type: 'run'
      id: number
      doc: CircuitDoc
      seconds: number
      /** Word 0 is Pyodide's interrupt flag: 2 raises KeyboardInterrupt (Stop, or the time limit). */
      control: SharedArrayBuffer
    }

export interface PinEvent {
  /** Virtual seconds since the program started. */
  t: number
  bcm: number
  /** high, low, `pwm 50 Hz 25%`, input, `input, pull-up`, released. */
  event: string
}

export interface RunResult {
  stdout: string
  stderr: string
  /** The error that ended the program; null when it finished or reached its time. */
  error: string | null
  events: PinEvent[]
  truncated: boolean
}

export type AssistantPyResponse =
  | { type: 'diagnostics'; id: number; diagnostics: Diagnostic[] }
  | ({ type: 'run'; id: number } & RunResult)

/** Pin events kept per run; the tool reports the first 200. */
const MAX_EVENTS = 2000
/** Characters of output kept per stream. */
const MAX_OUTPUT = 20_000

/** A bridge that writes down what the program does to each pin, when it changes. */
export class RecordingBridge extends Bridge {
  readonly events: PinEvent[] = []
  truncated = false
  /**
   * The run's end in virtual seconds. The interpreter notices the interrupt a few statements
   * late; nothing the program does after the end is recorded.
   */
  until = Infinity
  private readonly last = new Map<number, string>()

  private note(bcm: number, event: string) {
    if (this.now() > this.until || this.last.get(bcm) === event) return
    this.last.set(bcm, event)
    if (this.events.length >= MAX_EVENTS) this.truncated = true
    else this.events.push({ t: Math.round(this.now() * 1e6) / 1e6, bcm, event })
  }

  override setup(
    bcm: number,
    mode: 'in' | 'out',
    pull: 'up' | 'down' | 'off' = 'off',
    initial = false
  ) {
    super.setup(bcm, mode, pull, initial)
    if (mode === 'out') this.note(bcm, initial ? 'high' : 'low')
    else this.note(bcm, pull === 'off' ? 'input' : `input, pull-${pull}`)
  }

  override output(bcm: number, level: boolean) {
    super.output(bcm, level)
    this.note(bcm, level ? 'high' : 'low')
  }

  override pwm(bcm: number, frequencyHz: number, duty: number) {
    super.pwm(bcm, frequencyHz, duty)
    this.note(bcm, `pwm ${frequencyHz} Hz ${Math.round(Math.min(Math.max(duty, 0), 1) * 100)}%`)
  }

  override pwmStop(bcm: number) {
    super.pwmStop(bcm)
    this.note(bcm, 'low')
  }

  override cleanup(bcm?: number) {
    const pins = bcm === undefined ? [...this.last.keys()] : [bcm]
    super.cleanup(bcm)
    for (const pin of pins) this.note(pin, 'released')
  }
}

/** Where Pyodide's stdout and stderr go during a run; set up by whoever created it. */
export class Output {
  stdout = ''
  stderr = ''
  write(stream: 'stdout' | 'stderr', text: string) {
    if (this[stream].length < MAX_OUTPUT)
      this[stream] = (this[stream] + text + '\n').slice(0, MAX_OUTPUT)
  }
}

/** Runs the document's program for `seconds` of virtual time, or until it ends or is stopped. */
export function runFor(
  py: PyodideInterface,
  output: Output,
  doc: CircuitDoc,
  seconds: number,
  interrupt: Int32Array
): RunResult {
  output.stdout = output.stderr = ''
  const bridge = new RecordingBridge(new SimSession(new Circuit(doc, partDef, BEHAVIORS)))
  bridge.until = seconds
  const stopIfDone = () => {
    if (bridge.now() >= seconds) Atomics.store(interrupt, 0, 2)
  }
  bridge.onCall = stopIfDone
  // A sleep past the end only runs to it, so a long sleep does not solve time nobody asked for.
  const sleep = (s: number) => {
    bridge.sleep(Math.min(s, Math.max(seconds - bridge.now(), 0) + 1e-6))
    stopIfDone()
  }
  let error: string | null = null
  try {
    runProgram(py, bridge, doc.code.source, sleep, interrupt)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Ctrl+C is how a run that reached its time (or was stopped) ends.
    if (!/KeyboardInterrupt/.test(message)) error = message
  }
  return {
    stdout: output.stdout,
    stderr: output.stderr,
    error,
    events: bridge.events,
    truncated: bridge.truncated
  }
}
