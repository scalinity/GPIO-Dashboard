import useConnectionStore from '../store/connectionStore'
import useUiStore from '../store/uiStore'

const STATUS_CONFIG = {
  disconnected: { color: 'bg-gray-500', label: 'Disconnected' },
  connecting: {
    color: 'bg-amber-400 animate-pulse motion-reduce:animate-none',
    label: 'Connecting...',
    glow: 'shadow-glow-warn'
  },
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

/**
 * The connection pill. `compact` (the Studio's top bar) shows the dot and one short phrase, the
 * agent's state once connected ("Agent running"), and below the `lg` width the dot alone; the
 * full text is in its title.
 */
export default function ConnectionStatus({ compact = false }) {
  const status = useConnectionStore((s) => s.status)
  const agentStatus = useConnectionStore((s) => s.agentStatus)
  const setActiveTab = useUiStore((s) => s.setActiveTab)

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.disconnected
  const agentLabel = status === 'connected' ? AGENT_LABELS[agentStatus] : null
  const full = agentLabel ? `${cfg.label} · ${agentLabel}` : cfg.label

  return (
    <button
      onClick={() => setActiveTab('connect')}
      className="flex items-center gap-2 whitespace-nowrap px-3 py-1.5 rounded-btn hover:bg-white/[0.06] transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      aria-label="Connection status"
      title={full}
    >
      <span className={`w-2 h-2 rounded-full ${cfg.color} ${cfg.glow || ''}`} />
      <span className={`text-gray-400 ${compact ? 'max-[1100px]:sr-only' : ''}`}>
        {compact && agentLabel ? agentLabel.replace(': ', ' ') : cfg.label}
      </span>
      {!compact && agentLabel && (
        <>
          <span className="text-white/[0.15]">|</span>
          <span className="text-gray-500 text-xs">{agentLabel}</span>
        </>
      )}
    </button>
  )
}
