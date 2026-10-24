// Messages between the main thread and pyodide.worker (ADR-0017), and the layout of the shared
// control words. Kept apart from the worker so the main thread never loads the worker's code.
import type { CircuitDoc } from '../core/model/types'
import type { Snapshot } from '../core/sim/session'
import type { Diagnostic } from './python'
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
