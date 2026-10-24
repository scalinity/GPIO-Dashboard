// ERC issues for the open document, netlist rules and simulated-current rules together (SPEC 8).
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { Issue } from '../core/erc/erc'

const STYLE = {
  error: { icon: AlertOctagon, tone: 'text-red-400', border: 'border-red-500/30' },
  warning: { icon: AlertTriangle, tone: 'text-amber-400', border: 'border-amber-500/30' },
  info: { icon: Info, tone: 'text-sky-400', border: 'border-sky-500/30' }
} as const

export default function ErcPanel({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-400">
        <CheckCircle2 className="w-4 h-4" /> No issues: the circuit passes every rule.
      </div>
    )
  }
  return (
    <ul className="space-y-2">
      {issues.map((issue, i) => {
        const { icon: Icon, tone, border } = STYLE[issue.severity]
        return (
          <li key={`${issue.code}-${i}`} className={`card border ${border} py-3`}>
            <div className={`flex items-center gap-2 text-xs font-mono ${tone}`}>
              <Icon className="w-4 h-4" />
              {issue.code}
              <span className="text-gray-500">{issue.refs.join(', ')}</span>
            </div>
            <p className="mt-1 text-sm text-gray-200">{issue.message}</p>
            <p className="mt-1 text-xs text-gray-400">{issue.fix}</p>
          </li>
        )
      })}
    </ul>
  )
}
