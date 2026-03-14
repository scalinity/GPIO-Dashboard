import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { CircuitBoard, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { PIN_TYPES, ALL_PIN_TYPES } from '../data/pins'
import useTutorialStore from '../store/tutorialStore'
import Breadboard from '../components/Breadboard'
import TCobbler from '../components/TCobbler'
import WiringOverlay from '../components/WiringOverlay'
import TUTORIALS from '../data/tutorials'

export default function BreadboardPage() {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const containerRef = useRef(null)

  const showWiringOverlay = useTutorialStore((s) => s.showWiringOverlay)
  const overlayTutorialId = useTutorialStore((s) => s.overlayTutorialId)
  const showWiring = useTutorialStore((s) => s.showWiring)
  const hideWiring = useTutorialStore((s) => s.hideWiring)

  const toggleWiring = () => {
    if (showWiringOverlay) {
      hideWiring()
    } else {
      showWiring(overlayTutorialId || 'led_blink')
    }
  }

  const wiringDiagram = useMemo(() => {
    if (!showWiringOverlay || !overlayTutorialId) return null
    const tutorial = TUTORIALS?.find((t) => t.id === overlayTutorialId)
    return tutorial?.wiringDiagram || null
  }, [showWiringOverlay, overlayTutorialId])

  // Trackpad pinch-to-zoom (wheel with ctrlKey on macOS)
  const handleWheel = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = -e.deltaY * 0.01
      setZoom((z) => Math.min(Math.max(z + delta, 0.3), 4))
    } else {
      // Regular scroll = pan
      setPan((p) => ({
        x: p.x - e.deltaX,
        y: p.y - e.deltaY
      }))
    }
  }, [])

  // Attach wheel listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // Click-and-drag to pan
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    setDragging(true)
    setPan((currentPan) => {
      dragStart.current = { x: e.clientX, y: e.clientY, panX: currentPan.x, panY: currentPan.y }
      return currentPan
    })
  }, [])

  const onMouseMove = useCallback((e) => {
    if (!dragging) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy })
  }, [dragging])

  const onMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
      return () => {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }
    }
  }, [dragging, onMouseMove, onMouseUp])

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-4 px-4 py-2 bg-surface-900/80 backdrop-blur-xl border-b border-white/[0.04] flex-shrink-0">
        <CircuitBoard className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-300 font-medium">Breadboard</span>

        {/* Pin type legend */}
        <div className="flex items-center gap-2 ml-4">
          {ALL_PIN_TYPES.map((type) => (
            <div key={type} className="flex items-center gap-1">
              <span
                className="w-2.5 h-2.5 rounded-full inline-block"
                style={{ backgroundColor: PIN_TYPES[type].color }}
              />
              <span className="text-[10px] text-gray-400">{PIN_TYPES[type].label}</span>
            </div>
          ))}
        </div>

        <div className="flex-1" />

        {/* Wiring overlay toggle */}
        <button
          onClick={toggleWiring}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-btn transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            showWiringOverlay
              ? 'bg-accent text-white shadow-glow-accent hover:bg-accent-dim'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.06]'
          }`}
        >
          {showWiringOverlay ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showWiringOverlay ? 'Hide Wiring' : 'Show Wiring'}
        </button>

        {/* Reset view */}
        <button
          onClick={resetView}
          className="btn-ghost flex items-center gap-1.5 text-xs"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>

        <span className="text-[11px] font-mono text-gray-500 tabular-nums">{Math.round(zoom * 100)}%</span>
      </div>

      {/* Breadboard pan/zoom area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-surface-950 relative"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown}
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              pointerEvents: 'auto'
            }}
          >
            <Breadboard>
              <TCobbler />
              {showWiringOverlay && wiringDiagram && (
                <WiringOverlay diagram={wiringDiagram} />
              )}
            </Breadboard>
          </div>
        </div>
      </div>
    </div>
  )
}
