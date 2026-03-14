import { useEffect } from 'react'
import useUiStore from './store/uiStore'
import useConnectionStore from './store/connectionStore'
import useGpioStore from './store/gpioStore'
import Navbar from './components/Navbar'
import TerminalPanel from './components/TerminalPanel'
import ConnectPage from './pages/ConnectPage'
import PinoutPage from './pages/PinoutPage'
import BreadboardPage from './pages/BreadboardPage'
import TutorialsPage from './pages/TutorialsPage'
import MonitorPage from './pages/MonitorPage'

const PAGES = {
  connect: ConnectPage,
  pinout: PinoutPage,
  breadboard: BreadboardPage,
  tutorials: TutorialsPage,
  monitor: MonitorPage
}

function App() {
  const activeTab = useUiStore((s) => s.activeTab)
  const toggleTerminal = useUiStore((s) => s.toggleTerminal)

  // IPC listeners
  useEffect(() => {
    const cleanups = []

    if (window.api?.ssh?.onStatusChange) {
      cleanups.push(window.api.ssh.onStatusChange(useConnectionStore.getState().setStatus))
    }
    if (window.api?.gpio?.onState) {
      cleanups.push(window.api.gpio.onState(useGpioStore.getState().updatePinStates))
    }
    if (window.api?.gpio?.onSystemInfo) {
      cleanups.push(window.api.gpio.onSystemInfo(useGpioStore.getState().setSystemInfo))
    }

    return () => cleanups.forEach((fn) => typeof fn === 'function' && fn())
  }, [])

  // Prevent Electron's built-in ctrl+wheel zoom so pinch gestures reach our handlers
  useEffect(() => {
    const prevent = (e) => {
      if (e.ctrlKey) e.preventDefault()
    }
    document.addEventListener('wheel', prevent, { passive: false, capture: true })
    return () => document.removeEventListener('wheel', prevent, { capture: true })
  }, [])

  // Keyboard shortcut: Ctrl/Cmd + ` to toggle terminal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault()
        toggleTerminal()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleTerminal])

  const ActivePage = PAGES[activeTab] || ConnectPage

  return (
    <div className="flex flex-col h-screen bg-surface-950">
      <Navbar />
      <main className="flex-1 flex flex-col min-h-0">
        <ActivePage />
      </main>
      <TerminalPanel />
    </div>
  )
}

export default App
