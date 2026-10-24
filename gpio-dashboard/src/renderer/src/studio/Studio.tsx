// The 3D stage (SPEC 10, 11.2): R3F with WebGPURenderer from its async factory, rendering on demand.
// React owns the stage and the boards' and Pi's models; StudioView owns the camera, hover,
// gestures, the T-board, sockets, ribbon, parts, leads, footprints, labels and the frame loop.
import { Canvas, useFrame } from '@react-three/fiber'
import { useCallback, useRef } from 'react'
import { AgXToneMapping, type WebGPURenderer } from 'three/webgpu'
import type { GpioState } from '../core/sim/circuit'
import type { CircuitDoc } from '../core/model/types'
import { useStudio } from '../state/studioStore'
import { useWorkbench } from '../state/workbenchStore'
import Models from './Models'
import { createRenderer } from './renderer'
import Stage from './Stage'
import type { StudioView } from './view'

declare global {
  interface Window {
    /** Dev builds only: the Studio's frame counter, hover and ghost records, hole projection. */
    __studio?: StudioView
  }
}

/** Drives every frame: R3F leaves rendering to a subscriber with a positive priority. */
function Frames({ view }: { view: StudioView }) {
  useFrame((state) => {
    if (view.frame(performance.now())) state.invalidate()
  }, 1)
  return null
}

const PIN_CHOICES: [string, GpioState][] = [
  ['Output HIGH', { mode: 'out', level: true }],
  ['Output LOW', { mode: 'out', level: false }],
  ['Input, pull-up', { mode: 'in', pull: 'up' }],
  ['Input, pull-down', { mode: 'in', pull: 'down' }],
  ['Input, no pull', { mode: 'in', pull: 'off' }]
]

const sameState = (a: GpioState | undefined, b: GpioState) =>
  !!a &&
  a.mode === b.mode &&
  (a.mode === 'out' ? a.level === (b as typeof a).level && !a.pwm : a.pull === (b as typeof a).pull)

/**
 * A T-board GPIO pin's menu (SPEC 11.5): drive or release the pin by hand while no program runs.
 * It sits outside the element the orbit controls listen on, so its clicks reach it.
 */
function PinMenu() {
  const menu = useStudio((s) => s.pinMenu)
  const state = useWorkbench((s) => (menu ? s.gpio[menu.bcm] : undefined))
  const running = useWorkbench((s) => s.codeStatus === 'running')
  const setGpio = useWorkbench((s) => s.setGpio)
  if (!menu) return null
  const close = () => useStudio.setState({ pinMenu: null })
  return (
    <>
      <div
        className="fixed inset-0 z-30"
        onPointerDown={close}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        role="menu"
        aria-label={`GPIO${menu.bcm}`}
        className="fixed z-40 card p-1 w-44"
        style={{ left: menu.x, top: menu.y }}
      >
        <div className="px-2 py-1 text-xs font-mono text-gray-400">GPIO{menu.bcm}</div>
        {running ? (
          <p className="px-2 py-1 text-xs text-amber-300">
            A program is running and owns the pins.
          </p>
        ) : (
          PIN_CHOICES.map(([label, choice]) => (
            <button
              key={label}
              role="menuitemradio"
              aria-checked={sameState(state, choice)}
              className={`w-full text-left rounded-btn px-2 py-1 text-xs text-gray-200 hover:bg-white/[0.06] ${sameState(state, choice) ? 'text-accent-light' : ''}`}
              onClick={() => {
                void setGpio(menu.bcm, choice)
                close()
              }}
            >
              {label}
            </button>
          ))
        )}
      </div>
    </>
  )
}

export default function Studio({ view, doc }: { view: StudioView; doc: CircuitDoc }) {
  const tooltip = useRef<HTMLDivElement>(null)
  const labels = useRef<HTMLDivElement>(null)
  const tags = useRef<HTMLDivElement>(null)
  const notice = useStudio((s) => s.notice)
  const attach = useCallback(
    (element: HTMLDivElement) => {
      const detach = view.attach(element, tooltip.current!, labels.current!, tags.current!)
      if (import.meta.env.DEV) window.__studio = view
      return () => {
        detach()
        if (window.__studio === view) delete window.__studio
      }
    },
    [view]
  )
  // Anything clickable sits outside the element the orbit controls listen on: their pointer
  // capture would otherwise take its clicks.
  return (
    <div className="relative flex-1 min-h-0 min-w-0">
      <div ref={attach} className="absolute inset-0" data-testid="studio">
        <Canvas
          gl={createRenderer}
          camera={view.camera}
          frameloop="demand"
          shadows="percentage"
          scene={{ environmentIntensity: 0.6 }}
          onCreated={(state) => {
            // R3F sets ACES Filmic while configuring a renderer; the Studio uses AgX (SPEC 10.1).
            state.gl.toneMapping = AgXToneMapping
            view.bind(state.gl as unknown as WebGPURenderer, state.scene, state.invalidate)
          }}
        >
          <Stage />
          <Models doc={doc} />
          <primitive object={view.overlay} />
          <primitive object={view.layers} />
          <Frames view={view} />
        </Canvas>
        <div ref={labels} className="absolute inset-0 overflow-hidden pointer-events-none" />
        <div ref={tags} className="absolute inset-0 overflow-hidden pointer-events-none" />
        <div
          ref={tooltip}
          hidden
          data-testid="studio-tooltip"
          className="absolute left-0 top-0 pointer-events-none rounded-btn bg-surface-900/90 border border-white/[0.06] px-2 py-1 text-xs text-gray-200 font-mono whitespace-nowrap"
        />
      </div>
      <PinMenu />
      {notice && (
        <div
          role="status"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[80%] glass-panel rounded-btn px-3 py-1.5 text-xs text-amber-300"
        >
          {notice}
        </div>
      )}
    </div>
  )
}
