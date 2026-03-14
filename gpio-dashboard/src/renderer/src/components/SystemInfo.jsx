import { Thermometer, Cpu, HardDrive, Clock, Wifi, Server } from 'lucide-react'
import useGpioStore from '../store/gpioStore'

function UsageBar({ value, color }) {
  return (
    <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${Math.min(100, value)}%`, backgroundColor: color }}
      />
    </div>
  )
}

function InfoCard({ icon: Icon, label, children }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.04] rounded-btn p-3 shadow-inner-highlight">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-gray-500" />
        <span className="section-title">{label}</span>
      </div>
      {children}
    </div>
  )
}

function tempColor(temp) {
  if (temp < 60) return '#22C55E'
  if (temp < 75) return '#EAB308'
  return '#EF4444'
}

function formatUptime(seconds) {
  if (!seconds) return '--'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

export default function SystemInfo() {
  const systemInfo = useGpioStore((s) => s.systemInfo)

  if (!systemInfo) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm px-4 text-center">
        <Server className="w-10 h-10 mb-3 opacity-30" />
        <p>Connect to Pi to see system info</p>
      </div>
    )
  }

  const temp = systemInfo.cpuTemp ?? 0
  const memPercent = systemInfo.memUsed && systemInfo.memTotal
    ? Math.round((systemInfo.memUsed / systemInfo.memTotal) * 100)
    : 0
  const diskPercent = systemInfo.diskUsed && systemInfo.diskTotal
    ? Math.round((systemInfo.diskUsed / systemInfo.diskTotal) * 100)
    : 0

  return (
    <div className="flex flex-col gap-3">
      {/* CPU Temperature */}
      <InfoCard icon={Thermometer} label="CPU Temp">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums" style={{ color: tempColor(temp) }}>
            {temp.toFixed(1)}
          </span>
          <span className="text-sm text-gray-500">&deg;C</span>
        </div>
      </InfoCard>

      {/* Memory */}
      <InfoCard icon={Cpu} label="Memory">
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300 tabular-nums">{memPercent}%</span>
            <span className="text-gray-500 tabular-nums">
              {systemInfo.memUsed ? `${Math.round(systemInfo.memUsed)}MB` : '--'}
              {' / '}
              {systemInfo.memTotal ? `${Math.round(systemInfo.memTotal)}MB` : '--'}
            </span>
          </div>
          <UsageBar value={memPercent} color={memPercent > 80 ? '#EF4444' : '#3B82F6'} />
        </div>
      </InfoCard>

      {/* Uptime */}
      <InfoCard icon={Clock} label="Uptime">
        <span className="text-sm text-gray-300 tabular-nums">{formatUptime(systemInfo.uptime)}</span>
      </InfoCard>

      {/* Model */}
      <InfoCard icon={Server} label="Model">
        <span className="text-sm text-gray-300">{systemInfo.model || '--'}</span>
      </InfoCard>

      {/* IP Address */}
      <InfoCard icon={Wifi} label="IP Address">
        <span className="text-sm text-gray-300 font-mono tabular-nums">{systemInfo.ip || '--'}</span>
      </InfoCard>

      {/* Disk */}
      <InfoCard icon={HardDrive} label="Disk">
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300 tabular-nums">{diskPercent}%</span>
            <span className="text-gray-500 tabular-nums">
              {systemInfo.diskUsed ? `${(systemInfo.diskUsed / 1024).toFixed(1)}GB` : '--'}
              {' / '}
              {systemInfo.diskTotal ? `${(systemInfo.diskTotal / 1024).toFixed(1)}GB` : '--'}
            </span>
          </div>
          <UsageBar value={diskPercent} color={diskPercent > 90 ? '#EF4444' : '#22C55E'} />
        </div>
      </InfoCard>
    </div>
  )
}
