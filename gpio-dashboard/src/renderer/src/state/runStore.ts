// Run on Pi for any project or tutorial (SPEC 14.3): upload, run, stream, stop. ERC errors block a
// run unless the user overrides them in the dialog; only UI handlers call run().
import { create } from 'zustand'
import type { Issue } from '../core/erc/erc'
import { codePins } from '../core/code/pins'
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
    try {
      const filename = scriptName(projectId)
      set({ filename })
      await uploadScript(filename, source)
      set({ status: 'running' })
      await runScript(filename)
      set({ status: 'done' })
    } catch (e) {
      get().addOutput({ stream: 'stderr', data: e instanceof Error ? e.message : String(e) })
      set({ status: 'error' })
    } finally {
      await useSense.getState().resumeAfterRun()
    }
  },
  cancelBlocked() {
    set({ blocked: null })
  },
  async stop() {
    const { filename, pins } = get()
    if (filename) await killScript(filename)
    // A killed program never runs its own cleanup; return its pins to unpulled inputs.
    await cleanupPins(pins.filter((p) => p >= 2 && p <= 27))
    set({ status: 'done' })
  }
}))
