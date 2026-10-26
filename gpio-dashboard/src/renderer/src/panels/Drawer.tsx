// The Studio's bottom drawer (SPEC 11.2): Claude, then the Workbench's panels as tabs, on the app's
// document. Choosing the open tab again folds the drawer.
import type { CircuitDoc } from '../core/model/types'
import { useAssistant } from '../state/assistantStore'
import { type DrawerTab, useStudio } from '../state/studioStore'
import { useWorkbench } from '../state/workbenchStore'
import BoardPanel from './BoardPanel'
import ClaudePanel from './ClaudePanel'
import CodePanel from './CodePanel'
import ErcPanel from './ErcPanel'
import SimPanel from './SimPanel'
import StepsPanel from './StepsPanel'

export default function Drawer({ doc }: { doc: CircuitDoc }) {
  const tab = useStudio((s) => s.drawer)
  const issues = useWorkbench((s) => s.sim?.issues)
  const working = useAssistant((s) => s.running)
  const errors = issues?.filter((i) => i.severity === 'error').length ?? 0
  const tabs: [DrawerTab, string][] = [
    ['claude', 'Claude'],
    ['code', 'Code'],
    ['erc', issues ? `ERC (${errors} error${errors === 1 ? '' : 's'})` : 'ERC'],
    ['sim', 'Sim/Probes'],
    ['steps', 'Build Steps'],
    ['board', 'Board']
  ]
  return (
    <div className="glass-bg shrink-0 border-t border-white/[0.06]">
      <div className="seg-track mx-3 my-1.5 w-fit" role="tablist" aria-label="Drawer">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab-button ${tab === id ? 'active' : ''}`}
            onClick={() => useStudio.setState({ drawer: tab === id ? null : id })}
          >
            {label}
            {id === 'claude' && working && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400 motion-reduce:animate-none"
              />
            )}
          </button>
        ))}
      </div>
      {tab && (
        <div
          role="tabpanel"
          aria-label={tab}
          className={`h-72 p-4 ${tab === 'claude' ? 'overflow-hidden' : 'overflow-y-auto'}`}
        >
          {tab === 'claude' && <ClaudePanel />}
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
