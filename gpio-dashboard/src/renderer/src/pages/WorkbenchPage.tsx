// The interim Workbench (SPEC 11.1, M3–M6): open a sample or a project file, then check it with
// the ERC and Sim/Probes panels. Its panels move into the Studio's drawer in M7.
import { FlaskConical, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { partDef } from '../core/defs/parts'
import { SAMPLES } from '../core/defs/samples'
import { netlist } from '../core/netlist/netlist'
import { migrate } from '../core/serialize/gpiob'
import { importProject } from '../native/projects'
import BoardPanel from '../panels/BoardPanel'
import CodePanel from '../panels/CodePanel'
import ErcPanel from '../panels/ErcPanel'
import SimPanel from '../panels/SimPanel'
import { USER_GPIOS, useWorkbench } from '../state/workbenchStore'

/** GPIOs whose nets reach anything besides the header. */
function usedGpios(doc: Parameters<typeof netlist>[0]): number[] {
  const nets = netlist(doc, partDef).nets
  return USER_GPIOS.filter((bcm) =>
    nets.some((n) => n.names.includes(`GPIO${bcm}`) && n.members.some((m) => m.kind !== 'header'))
  )
}

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
          className="ml-4 bg-surface-800 text-gray-200 text-sm rounded px-2 py-1"
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
          <div className="flex gap-1 px-4 pt-3" role="tablist">
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
            {tab === 'sim' && <SimPanel doc={doc} gpios={usedGpios(doc)} />}
            {tab === 'code' && <CodePanel doc={doc} />}
            {tab === 'board' && <BoardPanel doc={doc} />}
          </div>
        </>
      )}
    </div>
  )
}
