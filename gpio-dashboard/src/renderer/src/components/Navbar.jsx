import { Cpu, Plug, BookOpen, Activity, FlaskConical, Box } from 'lucide-react'
import useUiStore from '../store/uiStore'
import ConnectionStatus from './ConnectionStatus'

const TABS = [
  { id: 'connect', label: 'Connect', icon: Plug },
  { id: 'pinout', label: 'Pinout', icon: Cpu },
  { id: 'tutorials', label: 'Tutorials', icon: BookOpen },
  { id: 'workbench', label: 'Workbench', icon: FlaskConical },
  { id: 'studio', label: 'Studio', icon: Box },
  { id: 'monitor', label: 'Monitor', icon: Activity }
]

export default function Navbar() {
  const activeTab = useUiStore((s) => s.activeTab)
  const setActiveTab = useUiStore((s) => s.setActiveTab)

  return (
    <nav data-tauri-drag-region="deep" className="flex items-center bg-surface-900/80 backdrop-blur-xl border-b border-white/[0.04] pl-20 pr-4 h-12 shrink-0">
      {/* Left: App title */}
      <div className="flex items-center gap-2 mr-4">
        <Cpu className="w-5 h-5 text-accent-light" />
        <span className="text-sm font-semibold text-white">GPIO Dashboard</span>
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-white/[0.06] mr-4" />

      {/* Center: Tabs */}
      <div className="flex items-center gap-1 flex-1 justify-center" role="tablist" aria-label="Main navigation">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
            className={`tab-button ${activeTab === id ? 'active' : ''}`}
          >
            <Icon className="w-4 h-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Right: Connection status (the Studio carries it in its own top bar) */}
      {activeTab !== 'studio' && <ConnectionStatus />}
    </nav>
  )
}
