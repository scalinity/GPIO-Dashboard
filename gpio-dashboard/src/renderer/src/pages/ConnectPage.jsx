import { useEffect } from 'react'
import { Plug, Play, Square, Upload } from 'lucide-react'
import useConnectionStore from '../store/connectionStore'

export default function ConnectPage() {
  const config = useConnectionStore((s) => s.config)
  const status = useConnectionStore((s) => s.status)
  const error = useConnectionStore((s) => s.error)
  const agentStatus = useConnectionStore((s) => s.agentStatus)
  const setConfig = useConnectionStore((s) => s.setConfig)
  const connect = useConnectionStore((s) => s.connect)
  const disconnect = useConnectionStore((s) => s.disconnect)
  const deployAgent = useConnectionStore((s) => s.deployAgent)
  const startAgent = useConnectionStore((s) => s.startAgent)
  const stopAgent = useConnectionStore((s) => s.stopAgent)
  const clearError = useConnectionStore((s) => s.clearError)

  useEffect(() => {
    async function loadSaved() {
      try {
        const saved = await window.api.settings.get('sshConfig')
        if (saved) setConfig(saved)
      } catch {
        // no saved config
      }
    }
    loadSaved()
  }, [setConfig])

  const isConnecting = status === 'connecting'
  const isConnected = status === 'connected'
  const inputDisabled = isConnecting || isConnected

  const handleConnect = async () => {
    clearError()
    try {
      await window.api.settings.set('sshConfig', {
        host: config.host,
        port: config.port,
        username: config.username
      })
    } catch {
      // ignore save error
    }
    connect()
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8 relative">
      {/* Subtle radial accent glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-96 h-96 rounded-full bg-accent/[0.06] blur-3xl" />
      </div>

      <div className="w-full max-w-md space-y-6 relative">
        <div className="card">
          <div className="flex items-center gap-3 mb-6">
            <Plug className="w-6 h-6 text-accent-light" />
            <h2 className="text-xl font-semibold text-white">Connect to Raspberry Pi</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="section-title block mb-1.5">Hostname / IP Address</label>
              <input
                type="text"
                value={config.host}
                onChange={(e) => setConfig({ host: e.target.value })}
                disabled={inputDisabled}
                placeholder="192.168.1.100"
                className="input-field"
              />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="section-title block mb-1.5">Username</label>
                <input
                  type="text"
                  value={config.username}
                  onChange={(e) => setConfig({ username: e.target.value })}
                  disabled={inputDisabled}
                  className="input-field"
                />
              </div>
              <div className="w-24">
                <label className="section-title block mb-1.5">Port</label>
                <input
                  type="number"
                  value={config.port}
                  onChange={(e) => setConfig({ port: parseInt(e.target.value, 10) || 22 })}
                  disabled={inputDisabled}
                  className="input-field"
                />
              </div>
            </div>

            <div>
              <label className="section-title block mb-1.5">Password</label>
              <input
                type="password"
                value={config.password}
                onChange={(e) => setConfig({ password: e.target.value })}
                disabled={inputDisabled}
                placeholder="Enter password"
                className="input-field"
              />
            </div>

            {!isConnected && (
              <button
                onClick={handleConnect}
                disabled={isConnecting || !config.host}
                className="w-full btn-primary py-2.5"
              >
                {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
            )}

            {isConnected && (
              <button
                onClick={disconnect}
                className="w-full btn-secondary py-2.5"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-500/[0.08] border border-red-500/20 rounded-card px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {isConnected && (
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-white">GPIO Agent</h3>

            <div className="flex items-center gap-2 mb-4">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  agentStatus === 'running'
                    ? 'bg-emerald-500 shadow-glow-success'
                    : agentStatus === 'starting'
                      ? 'bg-amber-400 animate-pulse shadow-glow-warn'
                      : agentStatus === 'error'
                        ? 'bg-red-500 shadow-glow-danger'
                        : 'bg-gray-500'
                }`}
              />
              <span className="text-sm text-gray-400 capitalize">{agentStatus}</span>
            </div>

            <div className="flex gap-3">
              <button
                onClick={deployAgent}
                disabled={agentStatus === 'starting'}
                className="flex items-center gap-2 btn-success"
              >
                <Upload className="w-4 h-4" />
                Deploy & Start Agent
              </button>

              {agentStatus === 'running' ? (
                <button
                  onClick={stopAgent}
                  className="flex items-center gap-2 btn-secondary"
                >
                  <Square className="w-4 h-4" />
                  Stop Agent
                </button>
              ) : (
                agentStatus === 'stopped' && (
                  <button
                    onClick={startAgent}
                    className="flex items-center gap-2 btn-secondary"
                  >
                    <Play className="w-4 h-4" />
                    Start Agent
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {status === 'disconnected' && (
          <div className="bg-accent/[0.06] border border-accent/10 rounded-card px-4 py-3 text-accent-light text-sm">
            Enter your Pi's IP address (find it with{' '}
            <code className="bg-surface-800 px-1.5 py-0.5 rounded text-accent-light/80">hostname -I</code>{' '}
            on the Pi)
          </div>
        )}
      </div>
    </div>
  )
}
