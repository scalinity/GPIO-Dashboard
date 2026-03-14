import { Activity } from 'lucide-react'
import useConnectionStore from '../store/connectionStore'
import LiveMonitor from '../components/LiveMonitor'
import SystemInfo from '../components/SystemInfo'

export default function MonitorPage() {
  const status = useConnectionStore((s) => s.status)
  const agentStatus = useConnectionStore((s) => s.agentStatus)
  const isConnected = status === 'connected'
  const agentRunning = agentStatus === 'running'

  if (!isConnected) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <Activity className="w-16 h-16 mx-auto mb-4 opacity-40" />
          <p className="text-lg">Connect to your Pi to monitor GPIO states</p>
          <p className="text-sm mt-2 text-gray-600">
            Use the Connect tab to establish an SSH connection
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04] shrink-0">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-accent-light" />
          <h1 className="text-lg font-semibold text-gray-200">GPIO Monitor</h1>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${
              agentRunning
                ? 'bg-emerald-500 animate-pulse shadow-glow-success'
                : 'bg-gray-600'
            }`}
          />
          <span className={agentRunning ? 'text-emerald-400' : 'text-gray-500'}>
            {agentRunning ? 'Agent Running' : 'Agent Stopped'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Live Monitor */}
        <div className="flex-1 p-4 overflow-hidden">
          <LiveMonitor />
        </div>

        {/* Right: System Info */}
        <div className="w-72 p-4 border-l border-white/[0.04] overflow-y-auto">
          <SystemInfo />
        </div>
      </div>
    </div>
  )
}
