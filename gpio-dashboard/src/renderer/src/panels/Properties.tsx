// Properties (SPEC 11.3, 11.4): schema-driven from each part definition's `properties`, with the
// resistor's E12/E24 picker and its bands, plus a lead's kind, colour, length and height, and the
// T-board's column pair, start row and orientation. Every change is one undoable transaction.
import { type ReactNode, useState, useSyncExternalStore } from 'react'
import { partDef } from '../core/defs/parts'
import type {
  CircuitDoc,
  PartInstance,
  PropertySchema,
  TboardPlacement,
  Wire
} from '../core/model/types'
import { COL_PAIRS } from '../core/model/types'
import { leadReach } from '../core/reach/reach'
import { ohmsText, resistorBands } from '../core/steps/steps'
import { circuit } from '../state/circuit'
import { edit, useStudio } from '../state/studioStore'
import { useWorkbench } from '../state/workbenchStore'
import { suggestedColor } from '../studio/placement'
import { INPUT_PROPS } from './inputs'

const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82]
const E24 = [...E12, 11, 13, 16, 20, 24, 30, 36, 43, 51, 62, 75, 91].sort((a, b) => a - b)

/** Every value of a series between min and max, decade by decade. */
function series(steps: number[], min: number, max: number): number[] {
  const values: number[] = []
  for (let decade = -1; decade <= 6; decade++) {
    for (const step of steps) {
      const v = Number((step * 10 ** decade).toPrecision(2))
      if (v >= min && v <= max) values.push(v)
    }
  }
  return values
}

const BAND_HEX: Record<string, string> = {
  black: '#111111',
  brown: '#7c4a21',
  red: '#d42a2a',
  orange: '#f07c1c',
  yellow: '#f5d01c',
  green: '#2f9e44',
  blue: '#2563eb',
  violet: '#7c3aed',
  grey: '#9ca3af',
  white: '#f8fafc',
  gold: '#c9a227',
  silver: '#c0c0c0'
}

const WIRE_KINDS: [Wire['kind'], string][] = [
  ['dupont-mm', 'Dupont M–M'],
  ['dupont-mf', 'Dupont M–F'],
  ['dupont-ff', 'Dupont F–F'],
  ['solid-arc', 'Solid, arched'],
  ['solid-flat', 'Solid, flat']
]

const WIRE_COLORS = [
  'red',
  'black',
  'yellow',
  'green',
  'blue',
  'orange',
  'brown',
  'violet',
  'white',
  'grey'
]

const field = 'bg-surface-800 text-gray-200 text-xs rounded px-1.5 py-1'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-gray-400">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** A number typed in and committed on Enter or when the field is left. */
function NumberField({
  label,
  value,
  onCommit
}: {
  label: string
  value: number | null
  onCommit: (v: number) => void
}) {
  const commit = (el: HTMLInputElement) => {
    const v = Number(el.value)
    if (el.value !== '' && Number.isFinite(v) && v !== value) onCommit(v)
  }
  return (
    <input
      key={value}
      aria-label={label}
      type="number"
      className={`${field} w-24`}
      defaultValue={value ?? ''}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget)}
    />
  )
}

function ResistorValue({
  part,
  set
}: {
  part: PartInstance
  set: (key: string, v: unknown) => void
}) {
  const [e24, setE24] = useState(false)
  const schema = partDef(part.defId).properties.resistance!
  const ohms = Number(part.props.resistance ?? schema.default)
  const values = series(
    e24 ? E24 : E12,
    schema.type === 'number' ? (schema.min ?? 1) : 1,
    schema.type === 'number' ? (schema.max ?? 1e7) : 1e7
  )
  if (!values.includes(ohms)) values.push(ohms)
  const bands = resistorBands(ohms, String(part.props.tolerance ?? '5%'))
  return (
    <div className="space-y-1.5">
      <Row label="Resistance">
        <span className="flex gap-1">
          <select
            aria-label="Series"
            className={field}
            value={e24 ? 'E24' : 'E12'}
            onChange={(e) => setE24(e.target.value === 'E24')}
          >
            <option>E12</option>
            <option>E24</option>
          </select>
          <select
            aria-label="Resistance"
            className={field}
            value={ohms}
            onChange={(e) => set('resistance', Number(e.target.value))}
          >
            {values
              .sort((a, b) => a - b)
              .map((v) => (
                <option key={v} value={v}>
                  {ohmsText(v)}
                </option>
              ))}
          </select>
        </span>
      </Row>
      <div className="flex items-center gap-2" aria-label={`Bands: ${bands.join(', ')}`}>
        <span className="flex h-4 items-center rounded-sm bg-[#d8c7a3] px-1.5 gap-1">
          {bands.map((band, i) => (
            <span
              key={i}
              title={band}
              className="block h-4 w-1.5"
              style={{ background: BAND_HEX[band] }}
            />
          ))}
        </span>
        <span className="text-[11px] text-gray-500">{bands.join(', ')}</span>
      </div>
    </div>
  )
}

function Prop({
  name,
  schema,
  value,
  set,
  live
}: {
  name: string
  schema: PropertySchema
  value: unknown
  set: (key: string, v: unknown) => void
  /** While a program runs, an environment input goes to the simulation as it is dragged. */
  live?: (key: string, v: unknown) => void
}) {
  if (schema.type === 'enum')
    return (
      <Row label={schema.label}>
        <select
          aria-label={schema.label}
          className={field}
          value={String(value)}
          onChange={(e) => set(name, e.target.value)}
        >
          {schema.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </Row>
    )
  if (schema.type === 'boolean')
    return (
      <Row label={schema.label}>
        <input
          aria-label={schema.label}
          type="checkbox"
          checked={value === true}
          onChange={(e) => (INPUT_PROPS.has(name) && live ? live : set)(name, e.target.checked)}
        />
      </Row>
    )
  const unit = schema.unit ? ` (${schema.unit})` : ''
  if (INPUT_PROPS.has(name)) {
    const range = {
      'aria-label': schema.label,
      type: 'range',
      className: 'w-28',
      min: schema.min ?? 0,
      max: schema.max ?? 100,
      step: ((schema.max ?? 100) - (schema.min ?? 0)) / 200
    } as const
    // Simulating: the slider is an input to the running circuit, applied as it moves.
    if (live)
      return (
        <Row label={`${schema.label}${unit}: ${Number(value).toFixed(1)}`}>
          <input
            {...range}
            value={Number(value)}
            onChange={(e) => live(name, Number(e.target.value))}
          />
        </Row>
      )
    // Otherwise it is a build choice, committed once when it is let go.
    const commit = (el: HTMLInputElement) =>
      Number(el.value) !== value && set(name, Number(el.value))
    return (
      <Row label={`${schema.label}${unit}: ${Number(value).toFixed(1)}`}>
        <input
          {...range}
          key={String(value)}
          defaultValue={Number(value)}
          onPointerUp={(e) => commit(e.currentTarget)}
          onKeyUp={(e) => commit(e.currentTarget)}
        />
      </Row>
    )
  }
  return (
    <Row label={`${schema.label}${unit}`}>
      <NumberField label={schema.label} value={Number(value)} onCommit={(v) => set(name, v)} />
    </Row>
  )
}

/** The ERC issues that name a part (a halo's reasons), with a way to the ERC tab. */
function PartIssues({ part }: { part: PartInstance }) {
  const issues = useWorkbench((s) => s.sim?.issues)
  const mine = issues?.filter((i) => i.refs.includes(part.id)) ?? []
  if (!mine.length) return null
  return (
    <div className="space-y-1 rounded-btn border border-red-500/30 p-2">
      {mine.map((issue, i) => (
        <p key={i} className="text-xs text-red-300">
          <span className="font-mono">{issue.code}</span> {issue.message}
        </p>
      ))}
      <button className="btn-ghost text-xs" onClick={() => useStudio.setState({ drawer: 'erc' })}>
        Show in ERC
      </button>
    </div>
  )
}

function PartProps({ part }: { part: PartInstance }) {
  const def = partDef(part.defId)
  const running = useWorkbench((s) => s.codeStatus === 'running')
  const env = useWorkbench((s) => s.env[part.id])
  const setInput = useWorkbench((s) => s.setInput)
  const set = (key: string, value: unknown) =>
    edit(`Set ${part.id} ${def.properties[key]?.label ?? key}`, [
      { type: 'SetPartProps', id: part.id, props: { ...part.props, [key]: value } }
    ])
  const live = running
    ? (key: string, value: unknown) => void setInput(part.id, key, value as number | boolean)
    : undefined
  return (
    <div className="space-y-2">
      <h3 className="text-sm text-gray-200">
        {part.id} · {def.name}
      </h3>
      <PartIssues part={part} />
      {Object.entries(def.properties).map(([name, schema]) =>
        name === 'resistance' && def.sim.model === 'resistor' ? (
          <ResistorValue key={name} part={part} set={set} />
        ) : (
          <Prop
            key={name}
            name={name}
            schema={schema}
            value={
              (running && INPUT_PROPS.has(name) ? env?.[name] : undefined) ??
              part.props[name] ??
              schema.default
            }
            set={set}
            live={live}
          />
        )
      )}
    </div>
  )
}

function WireProps({ doc, wire }: { doc: CircuitDoc; wire: Wire }) {
  const set = (label: string, props: Partial<Omit<Wire, 'id' | 'a' | 'b'>>) =>
    edit(`Set ${wire.id} ${label}`, [{ type: 'SetWireProps', id: wire.id, props }])
  const suggestion = suggestedColor(doc, [wire.a, wire.b])
  const reach = leadReach(doc, partDef).find((r) => r.wire === wire.id)
  const solid = wire.kind === 'solid-arc' || wire.kind === 'solid-flat'
  return (
    <div className="space-y-2">
      <h3 className="text-sm text-gray-200">{wire.id} · lead</h3>
      <Row label="Kind">
        <select
          aria-label="Kind"
          className={field}
          value={wire.kind}
          onChange={(e) => set('kind', { kind: e.target.value as Wire['kind'] })}
        >
          {WIRE_KINDS.map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Colour">
        <select
          aria-label="Colour"
          className={field}
          value={wire.color}
          onChange={(e) => set('colour', { color: e.target.value })}
        >
          {[...new Set([...WIRE_COLORS, wire.color])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Row>
      {suggestion && suggestion !== wire.color && (
        <button className="btn-ghost text-xs" onClick={() => set('colour', { color: suggestion })}>
          Use {suggestion}: this lead carries {suggestion === 'red' ? 'a supply' : 'ground'}
        </button>
      )}
      <Row label={solid ? 'Cut length (mm)' : 'Length (mm)'}>
        <span className="flex items-center gap-1.5">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={wire.lengthMm === 'auto'}
              onChange={(e) =>
                set('length', {
                  lengthMm: e.target.checked ? 'auto' : Math.round(reach?.lengthMm ?? 200)
                })
              }
            />
            auto
          </label>
          {wire.lengthMm === 'auto' ? (
            <span className="text-gray-500">{reach ? `${Math.round(reach.lengthMm)}` : ''}</span>
          ) : (
            <NumberField
              label="Length"
              value={wire.lengthMm}
              onCommit={(v) => set('length', { lengthMm: v })}
            />
          )}
        </span>
      </Row>
      {wire.kind === 'solid-arc' && (
        <Row label="Height (mm)">
          <NumberField
            label="Height"
            value={wire.heightMm ?? null}
            onCommit={(v) => set('height', { heightMm: v })}
          />
        </Row>
      )}
    </div>
  )
}

function TboardProps({ doc }: { doc: CircuitDoc }) {
  const tb = doc.controller.tboard
  const set = (label: string, change: Partial<TboardPlacement>) =>
    edit(`Set the T-board's ${label}`, [
      {
        type: 'SetControllerPlacement',
        controller: { ...doc.controller, tboard: { ...tb, ...change } }
      }
    ])
  return (
    <div className="space-y-2">
      <h3 className="text-sm text-gray-200">T-board</h3>
      <Row label="Column pair">
        <select
          aria-label="Column pair"
          className={field}
          value={tb.colPair}
          onChange={(e) =>
            set('column pair', { colPair: e.target.value as TboardPlacement['colPair'] })
          }
        >
          {COL_PAIRS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </Row>
      <Row label="Pin 1 row">
        <NumberField
          label="Pin 1 row"
          value={tb.pin1Row}
          onCommit={(v) => set('start row', { pin1Row: Math.round(v) })}
        />
      </Row>
      <Row label="Orientation">
        <select
          aria-label="Orientation"
          className={field}
          value={tb.orientation}
          onChange={(e) =>
            set('orientation', { orientation: e.target.value as TboardPlacement['orientation'] })
          }
        >
          <option value="header-toward-row-0">Header at row 0</option>
          <option value="header-toward-last-row">Header at last row</option>
        </select>
      </Row>
    </div>
  )
}

export default function Properties() {
  const doc = useSyncExternalStore(circuit.subscribe, circuit.getSnapshot)
  const selection = useStudio((s) => s.selection)
  const part = selection?.kind === 'part' && doc.parts.find((p) => p.id === selection.id)
  const wire = selection?.kind === 'wire' && doc.wires.find((w) => w.id === selection.id)
  return (
    <section aria-label="Properties" className="space-y-2">
      <h2 className="section-title">Properties</h2>
      {part ? (
        <PartProps part={part} />
      ) : wire ? (
        <WireProps doc={doc} wire={wire} />
      ) : selection?.kind === 'tboard' ? (
        <TboardProps doc={doc} />
      ) : selection?.kind === 'board' ? (
        <p className="text-xs text-gray-400">
          {selection.id}: drag it to move it and all it holds.
        </p>
      ) : selection?.kind === 'pi' ? (
        <p className="text-xs text-gray-400">Raspberry Pi 5: drag it to move it.</p>
      ) : (
        <p className="text-xs text-gray-500">
          Select a part, a lead, a board, the T-board or the Pi.
        </p>
      )}
    </section>
  )
}
