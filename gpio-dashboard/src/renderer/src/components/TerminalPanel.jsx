import { useRef, useCallback, useEffect } from 'react'
import { ChevronDown, X } from 'lucide-react'
import useUiStore from '../store/uiStore'
import Terminal from './Terminal'

const MIN_HEIGHT = 150
const MAX_HEIGHT = 500

export default function TerminalPanel() {
  const terminalOpen = useUiStore((s) => s.terminalOpen)
  const terminalHeight = useUiStore((s) => s.terminalHeight)
  const setTerminalHeight = useUiStore((s) => s.setTerminalHeight)
  const setTerminalOpen = useUiStore((s) => s.setTerminalOpen)
  const createdRef = useRef(false)
  const termRef = useRef(null)
  const dragging = useRef(false)

  useEffect(() => {
    if (terminalOpen && !createdRef.current) {
      createdRef.current = true
      window.api.terminal.create('global').catch(() => {})
    }
  }, [terminalOpen])

  // Destroy the remote shell session on component unmount
  useEffect(() => {
    return () => {
      if (createdRef.current) {
        window.api.terminal.destroy('global').catch(() => {})
      }
    }
  }, [])

  const onDragStart = useCallback(
    (e) => {
      e.preventDefault()
      dragging.current = true
      const startY = e.clientY
      const startHeight = terminalHeight

      const onMouseMove = (ev) => {
        const delta = startY - ev.clientY
        const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta))
        setTerminalHeight(newHeight)
      }

      const onMouseUp = () => {
        dragging.current = false
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [terminalHeight, setTerminalHeight]
  )

  if (!terminalOpen) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-surface-950 border-t border-white/[0.06] animate-slide-up flex flex-col"
      style={{ height: terminalHeight }}
    >
      {/* Drag handle */}
      <div
        className="h-0.5 cursor-ns-resize bg-white/[0.06] hover:bg-accent transition-colors shrink-0"
        onMouseDown={onDragStart}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 glass-bg border-b border-white/[0.06] shrink-0">
        <span className="section-title select-none">Terminal</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTerminalOpen(false)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
            aria-label="Minimize terminal"
            title="Minimize"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setTerminalOpen(false)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
            aria-label="Close terminal"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div className="flex-1 min-h-0 p-1">
        <Terminal ref={termRef} sessionId="global" className="h-full" />
      </div>
    </div>
  )
}
