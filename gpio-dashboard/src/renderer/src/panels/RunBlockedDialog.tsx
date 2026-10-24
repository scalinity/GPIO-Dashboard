// Run on Pi refuses a circuit with ERC errors unless the user overrides them here (SPEC 14.3).
import { AlertOctagon } from 'lucide-react'
import { useRun } from '../state/runStore'

export default function RunBlockedDialog() {
  const blocked = useRun((s) => s.blocked)
  const run = useRun((s) => s.run)
  const cancel = useRun((s) => s.cancelBlocked)
  if (!blocked) return null
  return (
    <div
      role="alertdialog"
      aria-label="ERC errors block this run"
      className="card border border-red-500/40 space-y-2"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-red-300">
        <AlertOctagon className="w-4 h-4" />
        This circuit has {blocked.errors.length} ERC error{blocked.errors.length === 1 ? '' : 's'}.
        Running it on the Pi may damage the Pi or a part.
      </div>
      <ul className="text-xs text-gray-300 list-disc pl-5">
        {blocked.errors.map((e, i) => (
          <li key={i}>
            <span className="font-mono">{e.code}</span>: {e.message}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button className="btn-secondary text-sm" onClick={cancel}>
          Cancel
        </button>
        <button
          className="btn-danger text-sm"
          onClick={() => run(blocked.projectId, blocked.source, blocked.errors, true)}
        >
          Run anyway
        </button>
      </div>
    </div>
  )
}
