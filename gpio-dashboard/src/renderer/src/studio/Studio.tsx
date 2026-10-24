// The 3D stage (SPEC 10, 11.2): R3F with WebGPURenderer from its async factory, rendering on demand.
// React owns what the document declares (the stage and the models); StudioView owns the camera,
// hover and frame loop.
import { Canvas, useFrame } from '@react-three/fiber'
import { useCallback, useRef, useState } from 'react'
import { AgXToneMapping, type WebGPURenderer } from 'three/webgpu'
import type { CircuitDoc } from '../core/model/types'
import { PRESETS } from './camera'
import Models from './Models'
import { createRenderer } from './renderer'
import Stage from './Stage'
import { StudioView } from './view'

declare global {
  interface Window {
    /** Dev builds only: the Studio's frame counter, hover record and hole projection, for tests. */
    __studio?: StudioView
  }
}

const PRESET_LABELS = { fit: 'Fit (F)', iso: 'Iso (2)', top: 'Top (3)', front: 'Front (4)' }

/** Drives every frame: R3F leaves rendering to a subscriber with a positive priority. */
function Frames({ view }: { view: StudioView }) {
  useFrame((state) => {
    if (view.frame(performance.now())) state.invalidate()
  }, 1)
  return null
}

export default function Studio({ doc }: { doc: CircuitDoc }) {
  const [view] = useState(() => new StudioView())
  const tooltip = useRef<HTMLDivElement>(null)
  const attach = useCallback(
    (element: HTMLDivElement) => {
      const detach = view.attach(element, tooltip.current!)
      if (import.meta.env.DEV) window.__studio = view
      return () => {
        detach()
        if (window.__studio === view) delete window.__studio
      }
    },
    [view]
  )
  // The toolbar sits outside the element the orbit controls listen on: their pointer capture
  // would otherwise take the buttons' clicks.
  return (
    <div className="relative flex-1 min-h-0">
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
          <Frames view={view} />
        </Canvas>
        <div
          ref={tooltip}
          hidden
          data-testid="studio-tooltip"
          className="absolute left-0 top-0 pointer-events-none rounded-btn bg-surface-900/90 border border-white/[0.06] px-2 py-1 text-xs text-gray-200 font-mono whitespace-nowrap"
        />
      </div>
      <div
        className="absolute top-3 right-3 flex gap-1 glass-panel rounded-btn p-1"
        role="toolbar"
        aria-label="Camera"
      >
        {PRESETS.map((preset) => (
          <button key={preset} className="btn-ghost text-xs" onClick={() => view.preset(preset)}>
            {PRESET_LABELS[preset]}
          </button>
        ))}
      </div>
    </div>
  )
}
