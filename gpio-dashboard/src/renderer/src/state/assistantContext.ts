// The AssistantContext over the app (SPEC 4.5, 12.8): the assistant's only way in. The document is
// the app's CircuitStore (locked to the running turn, so nothing else edits it); simulation and
// Python run in workers of the assistant's own, so its checks never disturb the Sim and Code
// panels; the stage hooks reach the Studio while it is open; Board Sense is a read-only copy of
// what the Board tab measured. Nothing here can reach the Pi, SSH, GPIO, the terminal or the
// project files: no member does, and the assistant imports nothing else.
import inventoryJson from '../content/inventory.json'
import type {
  AssistantContext,
  BoardSenseSnapshot,
  CapturedView,
  Ghost,
  SimRequest,
  SimResponse,
  ViewPreset
} from '../assistant/context'
import { PART_DEFS, partDef } from '../core/defs/parts'
import type { Ranked } from '../core/sense/candidates'
import { checkPython, runCodeInSim } from './assistantPython'
import { circuit } from './circuit'
import { useSense } from './senseStore'
import { simChannel } from './simClient'
import { useStudio } from './studioStore'

const INVENTORY: ReadonlySet<string> = new Set(
  inventoryJson.kit.items.flatMap((item) => item.partId ?? [])
)

/** What the Claude panel and the Studio supply: the chat, and the 3D stage while it is open. */
export interface ContextUi {
  /** The open Studio's capture; null while the Studio is not shown. */
  capture: ((preset: ViewPreset) => Promise<CapturedView>) | null
  /** The open Studio's camera; null while the Studio is not shown. */
  focus: ((refs: string[]) => void) | null
  askUser(question: string, options: string[], signal?: AbortSignal): Promise<string>
  /** The tool call `id`'s ghost has changed. */
  ghostChanged(id: string, ghost: Ghost | null): void
}

/** The assistant's own simulator: the same worker code as the Sim panel's, its own instance. */
const assistantSim = simChannel()

export function createAppContext(ui: () => ContextUi): AssistantContext {
  return {
    getSnapshot: circuit.getSnapshot,
    dispatch: (input) => circuit.dispatch(input),
    check: (input) => circuit.check(input),
    undoTurn: (id) => circuit.undoTurn(id),

    // The library; a project's own parts are in its document, and the tools read them there.
    partDef,
    partDefs: () => [...PART_DEFS.values()],
    inventoryPartIds: () => INVENTORY,

    async sim(request: SimRequest): Promise<SimResponse> {
      const res = await assistantSim(request)
      if (res.type === 'state' || res.type === 'error') return res
      return { type: 'error', message: `The simulator answered ${res.type} to ${request.type}` }
    },
    checkPython,
    runCodeInSim,

    async captureView(preset) {
      const capture = ui().capture
      if (!capture) throw new Error('The Studio is not open, so there is no view to capture.')
      return capture(preset)
    },
    focus(refs, note) {
      ui().focus?.(refs)
      if (note) useStudio.setState({ cue: { refs, note, marks: false } })
    },
    highlight(refs, note) {
      useStudio.setState({ cue: { refs, note, marks: true } })
    },
    setGhost(id, ghost) {
      const now = useStudio.getState().ghosts
      // Most deltas leave the ghost as it was (a prop still streaming); those redraw nothing.
      if (JSON.stringify(now[id] ?? null) !== JSON.stringify(ghost)) {
        const ghosts = { ...now }
        if (ghost) ghosts[id] = ghost
        else delete ghosts[id]
        useStudio.setState({ ghosts })
      }
      ui().ghostChanged(id, ghost)
    },

    boardSense(): BoardSenseSnapshot {
      const { mode, states, events, candidates } = useSense.getState()
      return {
        on: mode !== 'off',
        states: structuredClone(states),
        events: structuredClone(events),
        candidates: structuredClone(
          Object.fromEntries(
            Object.entries(candidates).filter((e): e is [string, Ranked[]] => Array.isArray(e[1]))
          )
        )
      }
    },

    askUser: (question, options, signal) => ui().askUser(question, options, signal)
  }
}
