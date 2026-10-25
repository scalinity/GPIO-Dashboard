// Run on Pi for any project or tutorial (SPEC 14.3): upload, run, stream, stop. ERC errors block a
// run unless the user overrides them in the dialog; only UI handlers call run().
import { create } from 'zustand'
import { codePins } from '../core/code/pins'
import { partDef } from '../core/defs/parts'
import { erc, type Issue } from '../core/erc/erc'
import type { CircuitDoc } from '../core/model/types'
import { driveChecks } from '../core/sim/checks'
import { cleanupPins, killScript, runScript, scriptName, uploadScript } from '../native/ssh'
import { useSense } from './senseStore'

export type RunStatus = 'idle' | 'deploying' | 'running' | 'done' | 'error'

interface Line {
  stream: 'stdout' | 'stderr'
  data: string
}

interface RunState {
  status: RunStatus
  filename: string | null
  /** GPIOs the running program sets up (read from its code), reset after Stop. */
  pins: number[]
  output: Line[]
  /** ERC errors waiting for the user's override before a run. */
  blocked: { projectId: string; source: string; errors: Issue[] } | null
  addOutput(line: Line): void
  run(projectId: string, source: string, issues: Issue[], override?: boolean): Promise<void>
  cancelBlocked(): void
  stop(): Promise<void>
}

const MAX_LINES = 1000

/** Bumped by every run and every Stop, so a run can tell that a Stop came after it began. */
let latest = 0
/** Runs that paused Board Sense and have not ended; the last of them to end resumes it. */
let holders = 0

export const useRun = create<RunState>((set, get) => ({
  status: 'idle',
  filename: null,
  pins: [],
  output: [],
  blocked: null,
  addOutput(line) {
    const output = get().output
    set({
      output:
        output.length >= MAX_LINES ? [...output.slice(-MAX_LINES / 2), line] : [...output, line]
    })
  },
  async run(projectId, source, issues, override = false) {
    const errors = issues.filter((i) => i.severity === 'error')
    if (errors.length && !override) {
      set({ blocked: { projectId, source, errors } })
      return
    }
    const pins = [
      ...new Set(
        codePins(source)
          .uses.filter((u) => u.mode !== 'i2c')
          .map((u) => u.bcm)
      )
    ]
    const mine = (latest += 1)
    set({ blocked: null, status: 'deploying', filename: null, pins, output: [] })
    // Board Sense holds GPIO lines during a sweep; the program needs them (SPEC 14.5).
    if (!(await useSense.getState().pauseForRun())) {
      get().addOutput({
        stream: 'stderr',
        data: 'Board Sense did not confirm within 1 s that it had released the pins, so the run did not start.'
      })
      set({ status: 'error' })
      return
    }
    holders += 1
    try {
      // A Stop that lands during the pause or the upload ends this run before the program starts.
      if (mine !== latest) return
      const filename = scriptName(projectId)
      set({ filename })
      await uploadScript(filename, source)
      if (mine !== latest) return
      set({ status: 'running' })
      await runScript(filename)
      set({ status: 'done' })
    } catch (e) {
      get().addOutput({ stream: 'stderr', data: e instanceof Error ? e.message : String(e) })
      set({ status: 'error' })
    } finally {
      // Another run may still be using the pins: the last one to end resumes sensing.
      holders -= 1
      if (holders === 0) await useSense.getState().resumeAfterRun()
    }
  },
  cancelBlocked() {
    set({ blocked: null })
  },
  async stop() {
    latest += 1
    const { filename, pins } = get()
    if (filename) await killScript(filename)
    // A killed program never runs its own cleanup; return its pins to unpulled inputs.
    await cleanupPins(pins.filter((p) => p >= 2 && p <= 27))
    set({ status: 'done' })
  }
}))

/** A project id for Run on Pi: [a-zA-Z0-9_-] only (SPEC 14.3). */
const projectId = (source: string | null, doc: CircuitDoc) =>
  (source && /^[\w-]+$/.test(source) ? source : doc.meta.name)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .slice(0, 48) || 'project'

/**
 * Run on Pi for a document with the code being edited, gated by ERC over both. The gate includes
 * the simulated-current rules (PIN_OVERCURRENT, RAIL_BUDGET, LED_NO_LIMIT) with the program's
 * output pins driven HIGH and LOW, since the program decides which level it ends up holding.
 */
export function runOnPi(source: string | null, doc: CircuitDoc, code: string): Promise<void> {
  const withCode = { ...doc, code: { ...doc.code, source: code } }
  const outputs = codePins(code)
    .uses.filter((u) => u.mode === 'out' || u.mode === 'pwm')
    .map((u) => u.bcm)
  const issues = [
    ...erc(withCode, partDef),
    ...driveChecks(withCode, partDef, [...new Set(outputs)])
  ]
  return useRun.getState().run(projectId(source, doc), code, issues)
}
