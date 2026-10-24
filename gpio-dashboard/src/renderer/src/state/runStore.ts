// Run on Pi for any project or tutorial (SPEC 14.3): upload, run, stream, stop. ERC errors block a
// run unless the user overrides them in the dialog; only UI handlers call run().
import { create } from 'zustand'
import type { Issue } from '../core/erc/erc'
import { killScript, runScript, scriptName, uploadScript } from '../native/ssh'

export type RunStatus = 'idle' | 'deploying' | 'running' | 'done' | 'error'

interface Line {
  stream: 'stdout' | 'stderr'
  data: string
}

interface RunState {
  status: RunStatus
  filename: string | null
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
    set({ blocked: null, status: 'deploying', filename: null, output: [] })
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
    }
  },
  cancelBlocked() {
    set({ blocked: null })
  },
  async stop() {
    const filename = get().filename
    if (filename) await killScript(filename)
    set({ status: 'done' })
  }
}))
