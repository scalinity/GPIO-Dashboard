// The assistant's only way into the app (SPEC 4.5, 12.8). The Claude panel implements this
// interface over the circuit store, the sim worker, Pyodide and the 3D stage, and injects it; the
// assistant imports nothing else from the app. There are no hardware members: the assistant can
// not reach the Pi, SSH, GPIO, the terminal or the project files by any path.
import type { Issue } from '../core/erc/erc'
import type {
  Author,
  CircuitDoc,
  Endpoint,
  Op,
  PartDef,
  PartInstance,
  Transaction,
  Wire
} from '../core/model/types'
import type { PartDefs } from '../core/netlist/netlist'
import type { Problem } from '../core/ops/validate'
import type { Ranked } from '../core/sense/candidates'
import type { NetState, SenseEvent } from '../core/sense/sense'
import type { EnvValue } from '../core/sim/behavior'
import type { GpioState } from '../core/sim/circuit'
import type { Snapshot } from '../core/sim/session'

// --- The document (circuitStore: the single writer) ---

export interface TransactionInput {
  author: Author
  label: string
  ops: Op[]
  assistantTurnId?: string
}
export type DispatchResult = { ok: true; tx: Transaction } | { ok: false; problems: Problem[] }
export type CheckResult = { ok: true; doc: CircuitDoc } | { ok: false; problems: Problem[] }

// --- The simulator (workers/simHost) ---

export type SimRequest =
  | { type: 'load'; doc: CircuitDoc }
  | { type: 'gpio'; bcm: number; state: GpioState }
  | { type: 'input'; part: string; key: string; value: EnvValue }
  | { type: 'advance'; t: number }

export type SimResponse =
  | {
      type: 'state'
      snapshot: Snapshot
      /** Netlist ERC plus the sim-based rules, errors first. */
      issues: Issue[]
      reads: Record<number, 'low' | 'high' | 'ambiguous' | 'floating'>
    }
  | { type: 'error'; message: string }

// --- Python (Pyodide) ---

export interface PythonDiagnostic {
  line: number
  column: number
  message: string
}

export interface SimRun {
  stdout: string
  stderr: string
  /** The error that ended the program, if it did not finish. */
  error: string | null
  /** What the program did to the pins, in order: `{t: 0.5, bcm: 17, event: 'high'}`. */
  events: { t: number; bcm: number; event: string }[]
  /** More events happened than were kept. */
  truncated: boolean
}

// --- The 3D stage ---

export type ViewPreset = 'top' | 'iso'
export interface CapturedView {
  mediaType: 'image/png'
  /** Base64, no data: prefix. */
  data: string
}

/** A non-committing preview shown while a tool call streams in (SPEC 12.6). */
export type Ghost =
  | { kind: 'part'; ref: string; defId: string; placement: PartInstance['placement'] }
  | { kind: 'wire'; a: Endpoint; b: Endpoint; wireKind: Wire['kind']; color: string }

export interface BuildStepAnnotation {
  /** A part ref or wire id the step is about. */
  step: string
  why: string
  mistake: string
}

// --- Board Sense: read only. The assistant can not start, stop or configure sensing. ---

export interface BoardSenseSnapshot {
  on: boolean
  /** Per GPIO net, by BCM number. */
  states: [number, NetState][]
  events: SenseEvent[]
  /** Ranked candidate causes of each diverged net. */
  candidates: Record<number, Ranked[]>
}

export interface AssistantContext {
  getSnapshot(): CircuitDoc
  dispatch(input: TransactionInput): DispatchResult
  /** Validates a transaction without committing it. */
  check(input: TransactionInput): CheckResult
  /** Undoes every transaction of one assistant turn. */
  undoTurn(assistantTurnId: string): number

  /** Built-in and custom part definitions. Throws for an unknown id. */
  partDef: PartDefs
  partDefs(): PartDef[]
  /** Adds a custom part to the project's library. */
  registerPartDef(def: PartDef): void
  /** The part ids in "My inventory" (content/inventory.json). */
  inventoryPartIds(): ReadonlySet<string>

  sim(request: SimRequest): Promise<SimResponse>
  /** Compiles `source` with Pyodide. Never runs it. */
  checkPython(source: string): Promise<PythonDiagnostic[]>
  /** Runs the project's code in the simulator's Pyodide. Never touches hardware. */
  runCodeInSim(doc: CircuitDoc, seconds: number, signal?: AbortSignal): Promise<SimRun>

  /** Waits for physics to sleep (at most 2 s), then captures the stage. */
  captureView(preset: ViewPreset): Promise<CapturedView>
  focus(refs: string[], note?: string): void
  highlight(refs: string[], note: string): void
  /** Shows, replaces or (null) clears the ghost of one streaming tool call. */
  setGhost(id: string, ghost: Ghost | null): void
  annotateBuildSteps(annotations: BuildStepAnnotation[]): void

  boardSense(): BoardSenseSnapshot

  /** Blocks until the user answers in the chat. */
  askUser(question: string, options: string[], signal?: AbortSignal): Promise<string>
}
