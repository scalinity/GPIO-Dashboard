// The Studio (SPEC 11.1, 11.2): the app's circuit document as a live 3D bench. The top bar holds
// the project, Simulate, Run on Pi and undo; the Part Library sits left, Properties and the view
// controls right, and the Workbench's panels in the drawer below. The top bar stays one row: a
// narrower window takes width from the project name first, then shows Wire, Build and Fork, and
// below that Simulate, Run on Pi and the pill, as icons alone (their names stay for screen readers).
import {
  Cable,
  ChevronDown,
  Cpu,
  FilePlus,
  FolderOpen,
  GitFork,
  LayoutGrid,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Redo2,
  Save,
  Square,
  Undo2
} from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import ConnectionStatus from '../components/ConnectionStatus'
import BuildPanel from '../panels/BuildPanel'
import Drawer from '../panels/Drawer'
import Inspect from '../panels/Inspect'
import PartLibrary from '../panels/PartLibrary'
import ProjectsGallery from '../panels/ProjectsGallery'
import Properties from '../panels/Properties'
import RunBlockedDialog from '../panels/RunBlockedDialog'
import { useAssistant } from '../state/assistantStore'
import { useBuild } from '../state/buildStore'
import { circuit } from '../state/circuit'
import {
  forkTemplate,
  newProject,
  openFile,
  save,
  saveAs,
  showGallery,
  useProject
} from '../state/projectStore'
import { runOnPi, useRun } from '../state/runStore'
import { edit, togglePanels, useStudio } from '../state/studioStore'
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
    <div className="relative shrink-0">
      <button
        className="btn-ghost text-sm flex items-center gap-1"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Project <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div role="menu" className="hud-dialog absolute left-0 top-full mt-1 z-40 p-1 w-48">
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
  // A tutorial that is not one of my projects is a read-only template (SPEC 11.9).
  const template = useProject((s) => s.id === null) && !!doc.meta.sourceTutorialId
  const building = useBuild((s) => s.on)
  const simulating = codeStatus === 'running'
  const onPi = runStatus === 'deploying' || runStatus === 'running'
  const rename = (name: string) => {
    if (name.trim() && name !== doc.meta.name)
      edit('Rename the project', [{ type: 'SetMeta', meta: { name: name.trim() } }])
  }
  return (
    <div
      data-testid="studio-topbar"
      className="flex h-12 shrink-0 flex-nowrap items-center gap-2 border-b border-white/[0.06] px-3 [&>*]:shrink-0"
    >
      <PanelToggle side="library" />
      <input
        key={doc.meta.name}
        aria-label="Project name"
        className="!shrink min-w-[6rem] basis-56 bg-transparent text-sm font-semibold text-gray-100 rounded px-1.5 py-1 hover:bg-white/[0.04] focus:bg-surface-800 focus:outline-none"
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
        title="Wire (W)"
        onClick={() => useStudio.setState({ tool: tool === 'wire' ? 'select' : 'wire' })}
      >
        <Cable className="w-4 h-4" /> <span className="max-xl:sr-only">Wire (W)</span>
      </button>
      <button
        className={`btn-ghost text-sm flex items-center gap-1.5 ${building ? 'bg-accent/20 text-accent-light' : ''}`}
        aria-pressed={building}
        title="Play the build steps one at a time"
        onClick={() => (building ? useBuild.getState().stop() : useBuild.getState().start())}
      >
        <ListChecks className="w-4 h-4" /> <span className="max-xl:sr-only">Build</span>
      </button>
      {template && (
        <>
          <span className="whitespace-nowrap rounded-pill bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
            Template · read-only
          </span>
          <button
            className="btn-secondary text-sm flex items-center gap-1.5"
            title="Fork to my projects"
            onClick={() => void forkTemplate(circuit.getSnapshot())}
          >
            <GitFork className="w-4 h-4" />{' '}
            <span className="max-xl:sr-only">Fork to my projects</span>
          </button>
        </>
      )}
      {error && <span className="!shrink min-w-0 truncate text-xs text-red-400">{error}</span>}
      <div className="ml-auto flex items-center gap-2">
        {simulating ? (
          <button className="btn-danger text-sm flex items-center gap-1.5" onClick={stopCode}>
            <Square className="w-4 h-4" /> <span className="max-lg:sr-only">Stop</span>
          </button>
        ) : (
          <button
            className="btn-success text-sm flex items-center gap-1.5"
            title="Simulate"
            onClick={() => {
              useStudio.setState({ drawer: 'sim' })
              runInSim(1)
            }}
          >
            <Play className="w-4 h-4" /> <span className="max-lg:sr-only">Simulate</span>
          </button>
        )}
        {onPi ? (
          <button className="btn-danger text-sm flex items-center gap-1.5" onClick={stopRun}>
            <Square className="w-4 h-4" /> <span className="max-lg:sr-only">Stop on Pi</span>
          </button>
        ) : (
          <button
            className="btn-secondary text-sm flex items-center gap-1.5"
            title="Run on Pi"
            onClick={() => void runOnPi(source, doc, code)}
          >
            <Cpu className="w-4 h-4" /> <span className="max-lg:sr-only">Run on Pi</span>
          </button>
        )}
        <ConnectionStatus compact />
        <PanelToggle side="properties" />
      </div>
    </div>
  )
}

/** Shows or hides a side panel; with both hidden the bench fills the window. */
function PanelToggle({ side }: { side: 'library' | 'properties' }) {
  const open = useStudio((s) => s[side])
  const [Icon, label, key] =
    side === 'library'
      ? [open ? PanelLeftClose : PanelLeftOpen, 'part library', '[']
      : [open ? PanelRightClose : PanelRightOpen, 'properties', ']']
  return (
    <button
      className="p-1.5 rounded-btn text-gray-400 hover:text-gray-200 hover:bg-white/[0.06]"
      aria-label={`${open ? 'Hide' : 'Show'} the ${label}`}
      aria-pressed={open}
      title={`${open ? 'Hide' : 'Show'} the ${label} (${key}); \\ hides or shows both`}
      onClick={() => togglePanels(side)}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}

export default function StudioPage() {
  const [view] = useState(() => new StudioView())
  const doc = useSyncExternalStore(circuit.subscribe, circuit.getSnapshot)
  const preview = useStudio((s) => s.preview)
  const building = useBuild((s) => s.on)
  const library = useStudio((s) => s.library)
  const properties = useStudio((s) => s.properties)
  return (
    <div ref={followOnMount} className="relative flex-1 flex flex-col h-full overflow-hidden">
      <TopBar />
      <div className="relative flex-1 flex min-h-0">
        {building ? <BuildPanel /> : library && <PartLibrary view={view} />}
        <Studio view={view} doc={preview ?? doc} />
        {properties && (
          <aside className="w-64 shrink-0 overflow-y-auto border-l border-white/[0.06] bg-surface-950 p-2">
            {/* The HUD's control card. */}
            <div className="card space-y-4 px-2.5 pb-2.5 pt-2">
              <Properties />
              <Inspect view={view} />
            </div>
          </aside>
        )}
        <div className={`absolute ${properties ? 'right-[17rem]' : 'right-3'} top-3 z-20 w-96`}>
          <RunBlockedDialog />
        </div>
      </div>
      <Drawer doc={doc} />
      <ProjectsGallery />
    </div>
  )
}
