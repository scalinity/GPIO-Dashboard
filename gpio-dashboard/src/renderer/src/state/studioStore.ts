// The Studio's UI state (SPEC 11.2–11.5): the selection, the tool, the Inspect toggles, the drawer,
// the document a drag would leave (drawn instead of the committed one), and the Studio's one path
// to change the document: edit(), a single transaction through circuitStore.dispatch.
import { create } from 'zustand'
import type { CircuitDoc, Op } from '../core/model/types'
import { circuit } from './circuit'
import { isTemplate } from './projectStore'

export type Selection =
  { kind: 'part' | 'wire' | 'board'; id: string } | { kind: 'tboard' } | { kind: 'pi' }

export type Tool = 'select' | 'wire'

export type DrawerTab = 'code' | 'erc' | 'sim' | 'steps' | 'board'

interface StudioState {
  selection: Selection | null
  tool: Tool
  labels: boolean
  /** The open drawer tab; null while the drawer is folded. */
  drawer: DrawerTab | null
  /** The document as the current drag would leave it, while that is legal. */
  preview: CircuitDoc | null
  /** Why the last edit was refused, until the next one. */
  notice: string | null
}

export const useStudio = create<StudioState>(() => ({
  selection: null,
  tool: 'select',
  labels: false,
  drawer: null,
  preview: null,
  notice: null
}))

/** One user edit as one transaction. Returns whether it was committed. */
export function edit(label: string, ops: Op[]): boolean {
  if (isTemplate()) {
    useStudio.setState({ notice: 'Tutorials are read-only templates.' })
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
