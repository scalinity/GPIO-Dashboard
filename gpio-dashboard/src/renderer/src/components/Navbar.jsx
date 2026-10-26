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
    <nav
      data-tauri-drag-region="deep"
      className="flex items-center bg-surface-900/80 backdrop-blur-xl border-b border-white/[0.04] pl-20 pr-4 h-12 shrink-0"
    >
      {/* Left: App title, on one line at any width */}
      <div className="flex items-center gap-2 mr-4 shrink-0 whitespace-nowrap">
        <Cpu className="w-5 h-5 text-accent" />
        <span className="text-[13px] font-extrabold uppercase tracking-[0.4px] text-gray-100">
          <span className="text-accent">GPIO</span> Dashboard
        </span>
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-white/[0.06] mr-4" />

      {/* Center: Tabs. Below 1100 px they show their icons only, keeping their names (as the
          Studio's top bar does). */}
      <div className="flex flex-1 justify-center">
        <div className="seg-track" role="tablist" aria-label="Main navigation">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              title={label}
              className={`tab-button ${activeTab === id ? 'active' : ''}`}
            >
              <Icon className="w-4 h-4" />
              <span className="max-[1100px]:sr-only">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Connection status (the Studio carries it in its own top bar) */}
      {activeTab !== 'studio' && <ConnectionStatus />}
    </nav>
  )
}
