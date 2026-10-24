// The Studio (SPEC 11.1, 11.2): the app's circuit document as a live 3D bench. The top bar holds
// the project, Simulate, Run on Pi and undo; the Part Library sits left, Properties and the view
// controls right, and the Workbench's panels in the drawer below.
import {
  Cable,
  ChevronDown,
  Cpu,
  FilePlus,
  FolderOpen,
  LayoutGrid,
  Play,
  Redo2,
  Save,
  Square,
  Undo2
} from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import ConnectionStatus from '../components/ConnectionStatus'
import Drawer from '../panels/Drawer'
import Inspect from '../panels/Inspect'
import PartLibrary from '../panels/PartLibrary'
import ProjectsGallery from '../panels/ProjectsGallery'
import Properties from '../panels/Properties'
import RunBlockedDialog from '../panels/RunBlockedDialog'
import { useAssistant } from '../state/assistantStore'
import { circuit } from '../state/circuit'
import { newProject, openFile, save, saveAs, showGallery, useProject } from '../state/projectStore'
import { runOnPi, useRun } from '../state/runStore'
import { edit, useStudio } from '../state/studioStore'
import { follow, useWorkbench } from '../state/workbenchStore'
import Studio from '../studio/Studio'
import { StudioView } from '../studio/view'

/** The drawer's panels read the Workbench's state, which follows the app's document. */
const followOnMount = (el: HTMLDivElement | null) => {
  if (el) void follow()
}

function ProjectMenu() {
  const [open, setOpen] = useState(false)
  const items: [string, typeof Save, () => Promise<void>][] = [
    ['New', FilePlus, newProject],
    ['Open…', FolderOpen, openFile],
    ['Save', Save, save],
    ['Save As…', Save, saveAs],
    ['Projects gallery', LayoutGrid, showGallery]
  ]
  return (
    <div className="relative">
      <button
        className="btn-ghost text-sm flex items-center gap-1"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Project <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1 z-40 card p-1 w-48">
          {items.map(([label, Icon, action]) => (
            <button
              key={label}
              role="menuitem"
              className="w-full flex items-center gap-2 rounded-btn px-2 py-1.5 text-sm text-gray-200 hover:bg-white/[0.06]"
              onClick={() => {
                setOpen(false)
                void action()
              }}
            >
              <Icon className="w-4 h-4 text-gray-400" /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TopBar() {
  const doc = useSyncExternalStore(circuit.subscribe, circuit.getSnapshot)
  const tool = useStudio((s) => s.tool)
  const { source, code, codeStatus, runInSim, stopCode } = useWorkbench()
  const runStatus = useRun((s) => s.status)
  // A running assistant turn owns the document (ADR-0094): its undo and redo wait for it.
  const assistantRunning = useAssistant((s) => s.running)
  const stopRun = useRun((s) => s.stop)
  const error = useProject((s) => s.error)
  const simulating = codeStatus === 'running'
  const onPi = runStatus === 'deploying' || runStatus === 'running'
  const rename = (name: string) => {
    if (name.trim() && name !== doc.meta.name)
      edit('Rename the project', [{ type: 'SetMeta', meta: { name: name.trim() } }])
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] shrink-0">
      <input
        key={doc.meta.name}
        aria-label="Project name"
        className="bg-transparent text-sm font-semibold text-gray-100 rounded px-1.5 py-1 w-56 hover:bg-white/[0.04] focus:bg-surface-800 focus:outline-none"
        defaultValue={doc.meta.name}
        onBlur={(e) => rename(e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <ProjectMenu />
      <div className="w-px h-5 bg-white/[0.06]" />
      <button
        className="btn-ghost text-sm"
        aria-label="Undo"
        title="Undo (⌘Z)"
        disabled={assistantRunning || !circuit.canUndo}
        onClick={() => circuit.undo()}
      >
        <Undo2 className="w-4 h-4" />
      </button>
      <button
        className="btn-ghost text-sm"
        aria-label="Redo"
        title="Redo (⌘⇧Z)"
        disabled={assistantRunning || !circuit.canRedo}
        onClick={() => circuit.redo()}
      >
        <Redo2 className="w-4 h-4" />
      </button>
      <button
        className={`btn-ghost text-sm flex items-center gap-1.5 ${tool === 'wire' ? 'bg-accent/20 text-accent-light' : ''}`}
        aria-pressed={tool === 'wire'}
        onClick={() => useStudio.setState({ tool: tool === 'wire' ? 'select' : 'wire' })}
      >
        <Cable className="w-4 h-4" /> Wire (W)
      </button>
      {error && <span className="text-xs text-red-400 truncate">{error}</span>}
      <div className="ml-auto flex items-center gap-2">
        {simulating ? (
          <button className="btn-danger text-sm flex items-center gap-1.5" onClick={stopCode}>
            <Square className="w-4 h-4" /> Stop
          </button>
        ) : (
          <button
            className="btn-success text-sm flex items-center gap-1.5"
            onClick={() => {
              useStudio.setState({ drawer: 'sim' })
              runInSim(1)
            }}
          >
            <Play className="w-4 h-4" /> Simulate
          </button>
        )}
        {onPi ? (
          <button className="btn-danger text-sm flex items-center gap-1.5" onClick={stopRun}>
            <Square className="w-4 h-4" /> Stop on Pi
          </button>
        ) : (
          <button
            className="btn-secondary text-sm flex items-center gap-1.5"
            onClick={() => void runOnPi(source, doc, code)}
          >
            <Cpu className="w-4 h-4" /> Run on Pi
          </button>
        )}
        <ConnectionStatus />
      </div>
    </div>
  )
}

export default function StudioPage() {
  const [view] = useState(() => new StudioView())
  const doc = useSyncExternalStore(circuit.subscribe, circuit.getSnapshot)
  const preview = useStudio((s) => s.preview)
  return (
    <div ref={followOnMount} className="relative flex-1 flex flex-col h-full overflow-hidden">
      <TopBar />
      <div className="relative flex-1 flex min-h-0">
        <PartLibrary view={view} />
        <Studio view={view} doc={preview ?? doc} />
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-white/[0.04] bg-surface-900/60 p-3 space-y-4">
          <Properties />
          <Inspect view={view} />
        </aside>
        <div className="absolute right-[17rem] top-3 z-20 w-96">
          <RunBlockedDialog />
        </div>
      </div>
      <Drawer doc={doc} />
      <ProjectsGallery />
    </div>
  )
}
