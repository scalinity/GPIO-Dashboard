// The right column's view controls (SPEC 11.2, 11.5): the Inspect toggles (Labels for now; the
// Voltages, Current and Board Sense overlays come with their renderers), camera presets, and
// turning the selection a quarter either way.
import { RotateCcw, RotateCw } from 'lucide-react'
import { useStudio } from '../state/studioStore'
import { PRESETS } from '../studio/camera'
import type { StudioView } from '../studio/view'

const PRESET_LABELS = { fit: 'Fit (F)', iso: 'Iso (2)', top: 'Top (3)', front: 'Front (4)' }

export default function Inspect({ view }: { view: StudioView }) {
  const labels = useStudio((s) => s.labels)
  const selection = useStudio((s) => s.selection)
  const turnable =
    selection?.kind === 'part' || selection?.kind === 'board' || selection?.kind === 'pi'
  return (
    <>
      <section aria-label="Inspect" className="space-y-2">
        <h2 className="section-title">Inspect</h2>
        <label className="flex items-center gap-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={labels}
            onChange={(e) => useStudio.setState({ labels: e.target.checked })}
          />
          Labels
        </label>
      </section>
      <section aria-label="Camera" className="space-y-2">
        <h2 className="section-title">Camera</h2>
        <div className="grid grid-cols-2 gap-1" role="toolbar" aria-label="Camera presets">
          {PRESETS.map((preset) => (
            <button key={preset} className="btn-ghost text-xs" onClick={() => view.preset(preset)}>
              {PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
      </section>
      <section aria-label="Rotate" className="flex gap-1">
        <button
          className="btn-ghost text-xs flex items-center gap-1"
          disabled={!turnable}
          onClick={() => view.rotate(90)}
        >
          <RotateCcw className="w-3.5 h-3.5" /> +90° (R)
        </button>
        <button
          className="btn-ghost text-xs flex items-center gap-1"
          disabled={!turnable}
          onClick={() => view.rotate(-90)}
        >
          <RotateCw className="w-3.5 h-3.5" /> −90°
        </button>
      </section>
    </>
  )
}
