// The Studio's bottom drawer (SPEC 11.2): the Workbench's panels as tabs, on the app's document.
// Choosing the open tab again folds the drawer.
import type { CircuitDoc } from '../core/model/types'
import { type DrawerTab, useStudio } from '../state/studioStore'
import { useWorkbench } from '../state/workbenchStore'
import BoardPanel from './BoardPanel'
import CodePanel from './CodePanel'
import ErcPanel from './ErcPanel'
import SimPanel from './SimPanel'
import StepsPanel from './StepsPanel'

export default function Drawer({ doc }: { doc: CircuitDoc }) {
  const tab = useStudio((s) => s.drawer)
  const issues = useWorkbench((s) => s.sim?.issues)
  const errors = issues?.filter((i) => i.severity === 'error').length ?? 0
  const tabs: [DrawerTab, string][] = [
    ['code', 'Code'],
    ['erc', issues ? `ERC (${errors} error${errors === 1 ? '' : 's'})` : 'ERC'],
    ['sim', 'Sim/Probes'],
    ['steps', 'Build Steps'],
    ['board', 'Board']
  ]
  return (
    <div className="shrink-0 border-t border-white/[0.04] bg-surface-900/60">
      <div className="flex gap-1 px-3 pt-1" role="tablist" aria-label="Drawer">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab-button ${tab === id ? 'active' : ''}`}
            onClick={() => useStudio.setState({ drawer: tab === id ? null : id })}
          >
            {label}
          </button>
        ))}
      </div>
      {tab && (
        <div role="tabpanel" aria-label={tab} className="h-72 overflow-y-auto p-4">
          {tab === 'code' && <CodePanel doc={doc} />}
          {tab === 'erc' && <ErcPanel issues={issues ?? []} />}
          {tab === 'sim' && <SimPanel doc={doc} />}
          {tab === 'steps' && <StepsPanel doc={doc} />}
          {tab === 'board' && <BoardPanel doc={doc} />}
        </div>
      )}
    </div>
  )
}
