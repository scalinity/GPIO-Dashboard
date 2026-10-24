// The 3D stage (SPEC 10, 11.2): R3F with WebGPURenderer from its async factory, rendering on demand.
// React owns what the document declares (the stage and the models); StudioView owns the camera,
// hover, gestures, leads, footprints, labels and the frame loop.
import { Canvas, useFrame } from '@react-three/fiber'
import { useCallback, useRef } from 'react'
import { AgXToneMapping, type WebGPURenderer } from 'three/webgpu'
import type { CircuitDoc } from '../core/model/types'
import { useStudio } from '../state/studioStore'
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

export default function Studio({ view, doc }: { view: StudioView; doc: CircuitDoc }) {
  const tooltip = useRef<HTMLDivElement>(null)
  const labels = useRef<HTMLDivElement>(null)
  const notice = useStudio((s) => s.notice)
  const attach = useCallback(
    (element: HTMLDivElement) => {
      const detach = view.attach(element, tooltip.current!, labels.current!)
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
        <div
          ref={tooltip}
          hidden
          data-testid="studio-tooltip"
          className="absolute left-0 top-0 pointer-events-none rounded-btn bg-surface-900/90 border border-white/[0.06] px-2 py-1 text-xs text-gray-200 font-mono whitespace-nowrap"
        />
      </div>
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
