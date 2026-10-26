// The interim Workbench (SPEC 11.1, M3–M6): open a sample or a project file, then check it with
// the ERC and Sim/Probes panels. The same panels make up the Studio's drawer (M7), and both pages
// show the app's one document.
import { FlaskConical, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { SAMPLES } from '../core/defs/samples'
import { migrate } from '../core/serialize/gpiob'
import { importProject } from '../native/projects'
import BoardPanel from '../panels/BoardPanel'
import CodePanel from '../panels/CodePanel'
import ErcPanel from '../panels/ErcPanel'
import RunBlockedDialog from '../panels/RunBlockedDialog'
import SimPanel from '../panels/SimPanel'
import { useWorkbench } from '../state/workbenchStore'

export default function WorkbenchPage() {
  const { source, doc, problems, sim, error, open } = useWorkbench()
  const [tab, setTab] = useState<'erc' | 'sim' | 'code' | 'board'>('sim')
  const openFile = async () => {
    try {
      const raw = await importProject()
      if (raw) await open('Project file', migrate(raw))
    } catch (e) {
      useWorkbench.setState({ error: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] shrink-0">
        <FlaskConical className="w-5 h-5 text-accent-light" />
        <h1 className="text-lg font-semibold text-gray-200">Workbench</h1>
        <select
          aria-label="Open a sample"
          className="input-field ml-4 w-auto py-1.5"
          value={SAMPLES.some((s) => s.id === source) ? source! : ''}
          onChange={(e) => {
            const sample = SAMPLES.find((s) => s.id === e.target.value)
            if (sample) open(sample.id, sample.doc)
          }}
        >
          <option value="" disabled>
            Open a sample…
          </option>
          {SAMPLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.doc.meta.name}
            </option>
          ))}
        </select>
        <button className="btn-secondary text-sm flex items-center gap-1.5" onClick={openFile}>
          <FolderOpen className="w-4 h-4" /> Open file…
        </button>
        {doc && <span className="text-sm text-gray-400">{doc.meta.name}</span>}
      </div>

      {error && <p className="px-4 pt-3 text-sm text-red-400">{error}</p>}
      {!doc && (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Open a sample or a project file to check and simulate it.
        </div>
      )}
      {doc && problems.length > 0 && (
        <div className="p-4 text-sm text-red-300 space-y-1">
          <p>This document breaks placement rules, so it cannot be simulated:</p>
          {problems.map((p, i) => (
            <p key={i} className="font-mono text-xs">
              {p.code}: {p.message}
            </p>
          ))}
        </div>
      )}
      {doc && problems.length === 0 && (
        <>
          <div className="seg-track mx-4 mt-3 w-fit" role="tablist">
            {(
              [
                ['sim', 'Sim/Probes'],
                ['code', 'Code'],
                ['board', 'Board'],
                ['erc', `ERC${sim ? ` (${sim.issues.length})` : ''}`]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={`tab-button ${tab === id ? 'active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {tab === 'erc' && <ErcPanel issues={sim?.issues ?? []} />}
            {tab === 'sim' && <SimPanel doc={doc} />}
            {tab === 'code' && (
              <div className="space-y-3">
                <RunBlockedDialog />
                <CodePanel doc={doc} />
              </div>
            )}
            {tab === 'board' && <BoardPanel doc={doc} />}
          </div>
        </>
      )}
    </div>
  )
}
