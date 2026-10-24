// The right column's view controls (SPEC 11.2, 11.5): the Inspect toggles (Labels, Voltages, Current
// flow, Nets, and Board Sense's tint; Live Pi state comes with the Pi link), the Nets list, camera
// presets, and turning the selection a quarter either way.
import { RotateCcw, RotateCw } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { circuit } from '../state/circuit'
import { useSense } from '../state/senseStore'
import { useStudio } from '../state/studioStore'
import { useWorkbench } from '../state/workbenchStore'
import { PRESETS } from '../studio/camera'
import type { StudioView } from '../studio/view'

const PRESET_LABELS = { fit: 'Fit (F)', iso: 'Iso (2)', top: 'Top (3)', front: 'Front (4)' }

type Toggle = 'labels' | 'voltages' | 'current' | 'nets' | 'sense'

function Check({ name, label, note }: { name: Toggle; label: string; note?: string }) {
  const on = useStudio((s) => s[name])
  return (
    <label className="flex items-center gap-2 text-xs text-gray-300">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => useStudio.setState({ [name]: e.target.checked })}
      />
      {label}
      {note && <span className="text-gray-500">{note}</span>}
    </label>
  )
}

/** Every net with something on it, by name; hovering a row shows it on the bench. */
function NetList({ view }: { view: StudioView }) {
  // The engine's netlist follows the document the Studio draws.
  useSyncExternalStore(circuit.subscribe, circuit.getSnapshot)
  const volts = useWorkbench((s) => s.sim?.snapshot.nets)
  const nets = circuit.engine.state.netlist.nets.filter((n) =>
    n.members.some((m) => m.kind !== 'header')
  )
  return (
    <ul
      aria-label="Nets"
      className="max-h-48 overflow-y-auto text-xs font-mono"
      onPointerLeave={() => view.highlightNet(null)}
    >
      {nets.map((net) => (
        <li
          key={net.name}
          className="flex justify-between gap-2 rounded px-1.5 py-0.5 text-gray-300 hover:bg-white/[0.06]"
          onPointerEnter={() => view.highlightNet(net.name)}
        >
          <span>{net.name}</span>
          <span className="text-gray-500">
            {net.members.filter((m) => m.kind === 'part').length} pins
            {volts?.[net.name] !== undefined && ` · ${volts[net.name]!.toFixed(2)} V`}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function Inspect({ view }: { view: StudioView }) {
  const nets = useStudio((s) => s.nets)
  const sensing = useSense((s) => s.mode !== 'off')
  const selection = useStudio((s) => s.selection)
  const turnable =
    selection?.kind === 'part' || selection?.kind === 'board' || selection?.kind === 'pi'
  return (
    <>
      <section aria-label="Inspect" className="space-y-2">
        <h2 className="section-title">Inspect</h2>
        <Check name="labels" label="Labels" />
        <Check name="voltages" label="Voltages" />
        <Check name="current" label="Current flow" />
        <Check name="nets" label="Nets" />
        <Check name="sense" label="Board Sense" note={sensing ? undefined : ' (off)'} />
        {nets && <NetList view={view} />}
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
