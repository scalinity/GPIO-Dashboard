// The Studio's UI state (SPEC 11.2–11.5, 11.8): the selection, the tool, the Inspect toggles, the
// drawer, the document a drag would leave (drawn instead of the committed one), what the assistant
// shows on the stage (ghosts, tints, a teaching cue), and the Studio's one path to change the
// document: edit(), a single transaction through circuitStore.dispatch.
import { create } from 'zustand'
import type { Ghost } from '../assistant/context'
import type { CircuitDoc, Op } from '../core/model/types'
import { useBuild } from './buildStore'
import { circuit } from './circuit'
import { isTemplate } from './projectStore'

export type Selection =
  { kind: 'part' | 'wire' | 'board'; id: string } | { kind: 'tboard' } | { kind: 'pi' }

export type Tool = 'select' | 'wire'

export type DrawerTab = 'claude' | 'code' | 'erc' | 'sim' | 'steps' | 'board'

/** A right click on a T-board GPIO pin: the pin and where the menu opens (client pixels). */
export interface PinMenu {
  bcm: number
  x: number
  y: number
}

/** The assistant's teaching cue (focus, highlight): a caption, and marks on what it names. */
export interface Cue {
  refs: string[]
  note: string
  /** Highlight marks the refs on the bench; focus only moves the camera. */
  marks: boolean
}

interface StudioState {
  selection: Selection | null
  tool: Tool
  /** The Inspect toggles (SPEC 11.5); `sense` shows Board Sense's tint once sensing runs. */
  labels: boolean
  voltages: boolean
  current: boolean
  nets: boolean
  sense: boolean
  /** Live Pi state (SPEC 11.5): the Pi's pins, painted and simulated, and where they diverge. */
  live: boolean
  /** The divergence badge whose explanation is open (state/badges.ts), by id. */
  badge: string | null
  pinMenu: PinMenu | null
  /** The open drawer tab; null while the drawer is folded. */
  drawer: DrawerTab | null
  /** The document as the current drag would leave it, while that is legal. */
  preview: CircuitDoc | null
  /** Why the last edit was refused, until the next one. */
  notice: string | null
  /** The assistant's streaming tool calls, drawn as non-committing ghosts (SPEC 12.6), by call. */
  ghosts: Record<string, Ghost>
  /** What the assistant's last turn added or changed, tinted until kept (SPEC 11.8). */
  tinted: { parts: string[]; wires: string[] } | null
  cue: Cue | null
}

export const useStudio = create<StudioState>(() => ({
  selection: null,
  tool: 'select',
  labels: false,
  voltages: false,
  current: false,
  nets: false,
  sense: true,
  live: false,
  badge: null,
  pinMenu: null,
  drawer: null,
  preview: null,
  notice: null,
  ghosts: {},
  tinted: null,
  cue: null
}))

export const BUILDING_MESSAGE = 'Leave Build Mode to change the circuit.'

/** What a name, a program and its notes change; the steps Build Mode plays do not depend on them. */
const OUTSIDE_THE_BUILD = new Set<Op['type']>(['SetCode', 'SetMeta'])

/** One user edit as one transaction. Returns whether it was committed. */
export function edit(label: string, ops: Op[]): boolean {
  if (isTemplate()) {
    useStudio.setState({ notice: 'Tutorials are read-only templates.' })
    return false
  }
  // Build Mode draws the circuit as built so far, so a gesture on the bench would act unseen.
  if (useBuild.getState().on && ops.some((op) => !OUTSIDE_THE_BUILD.has(op.type))) {
    useStudio.setState({ notice: BUILDING_MESSAGE })
    return false
  }
  const result = circuit.dispatch({ author: 'user', label, ops })
  useStudio.setState({ notice: result.ok ? null : result.problems[0]!.message })
  return result.ok
}

// A selection that no longer exists (after an undo, say) is dropped.
circuit.subscribe(() => {
  const { selection } = useStudio.getState()
  if (!selection || !('id' in selection)) return
  const doc = circuit.getSnapshot()
  const list = { part: doc.parts, wire: doc.wires, board: doc.boards }[selection.kind]
  if (!list.some((x) => x.id === selection.id)) useStudio.setState({ selection: null })
})
