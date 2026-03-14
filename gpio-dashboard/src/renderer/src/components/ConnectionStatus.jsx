import useConnectionStore from '../store/connectionStore'
import useUiStore from '../store/uiStore'

const STATUS_CONFIG = {
  disconnected: { color: 'bg-gray-500', label: 'Disconnected' },
  connecting: { color: 'bg-amber-400 animate-pulse', label: 'Connecting...', glow: 'shadow-glow-warn' },
  connected: { color: 'bg-emerald-500', label: 'Connected', glow: 'shadow-glow-success' },
  error: { color: 'bg-red-500', label: 'Error', glow: 'shadow-glow-danger' }
}

const AGENT_LABELS = {
  unknown: null,
  stopped: 'Agent: stopped',
  starting: 'Agent: starting',
  running: 'Agent: running',
  error: 'Agent: error'
}

export default function ConnectionStatus() {
  const status = useConnectionStore((s) => s.status)
  const agentStatus = useConnectionStore((s) => s.agentStatus)
  const setActiveTab = useUiStore((s) => s.setActiveTab)

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.disconnected
  const agentLabel = status === 'connected' ? AGENT_LABELS[agentStatus] : null

  return (
    <button
      onClick={() => setActiveTab('connect')}
      className="flex items-center gap-2 px-3 py-1.5 rounded-btn hover:bg-white/[0.06] transition-colors text-sm"
    >
      <span className={`w-2 h-2 rounded-full ${cfg.color} ${cfg.glow || ''}`} />
      <span className="text-gray-400">{cfg.label}</span>
      {agentLabel && (
        <>
          <span className="text-white/[0.15]">|</span>
          <span className="text-gray-500 text-xs">{agentLabel}</span>
        </>
      )}
    </button>
  )
}
