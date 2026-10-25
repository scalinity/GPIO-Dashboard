// The Board tab (SPEC 14.5): Board Sense's toggle, per-net states, the event log, divergences with
// their likely causes, and the bench fixture walkthrough. Sensing starts only from these buttons.
import { Activity, ClipboardCopy, Radar, Search, Square } from 'lucide-react'
import { useState } from 'react'
import { partDef } from '../core/defs/parts'
import { BENCH_FIXTURES } from '../core/sense/fixtures'
import type { NetState } from '../core/sense/sense'
import { buildSteps, holeText } from '../core/steps/steps'
import type { CircuitDoc } from '../core/model/types'
import useConnectionStore from '../store/connectionStore'
import { useSense } from '../state/senseStore'
import { useWorkbench } from '../state/workbenchStore'

const TONE: Record<NetState['state'], string> = {
  matched: 'text-emerald-400',
  diverged: 'text-red-400',
  settling: 'text-amber-300',
  ambiguous: 'text-amber-400',
  unobserved: 'text-gray-500',
  skipped: 'text-gray-500'
}

const describe = (s: NetState) =>
  s.state === 'diverged'
    ? `diverged (${s.kind}): ${s.detail}`
    : s.state === 'skipped'
      ? `skipped: ${s.reason}`
      : s.state === 'unobserved'
        ? 'unobserved (not electrically verifiable)'
        : s.state

function Causes({ doc, pin }: { doc: CircuitDoc; pin: number }) {
  const ranked = useSense((s) => s.candidates[pin])
  if (!ranked) return null
  if (ranked === 'working')
    return <p className="text-xs text-gray-400 pl-20">Simulating candidates…</p>
  return (
    <ol className="text-xs text-gray-300 pl-24 list-decimal space-y-1">
      {ranked.map((group, i) => (
        <li key={i}>
          {group.candidates.length > 1 && <span className="text-amber-400">tie: </span>}
          {group.candidates.map((c) => c.text).join('; or ')}
          {group.candidates[0]!.holes.length > 0 && (
            <span className="text-gray-500">
              {' '}
              ({group.candidates[0]!.holes.map((h) => holeText(doc, h)).join(' → ')})
            </span>
          )}
          <span className="text-gray-500">
            {' '}
            · {group.score}/{group.of} readings agree
          </span>
        </li>
      ))}
    </ol>
  )
}

function Walkthrough() {
  const [selected, setSelected] = useState(BENCH_FIXTURES[0]!.id)
  const [results, setResults] = useState<string[]>([])
  const fixture = BENCH_FIXTURES.find((f) => f.id === selected)!
  const doc = fixture.doc(partDef)
  const steps = buildSteps(doc, partDef).steps
  const states = useSense((s) => s.states)
  const mode = useSense((s) => s.mode)
  const record = () => {
    const line = `${new Date().toISOString()} ${fixture.title} [${mode}]: ${fixture.pins
      .map(
        (p) => `GPIO${p} ${describe(states.find(([q]) => q === p)?.[1] ?? { state: 'unobserved' })}`
      )
      .join('; ')}`
    setResults([...results, line])
  }
  return (
    <section className="card space-y-2">
      <h3 className="text-sm font-semibold text-gray-200">Fixture check</h3>
      <select
        aria-label="Bench fixture"
        className="bg-surface-800 text-gray-200 text-xs rounded px-1.5 py-1"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        {BENCH_FIXTURES.map((f) => (
          <option key={f.id} value={f.id}>
            {f.title}
          </option>
        ))}
      </select>
      <p className="text-xs text-gray-400">Expect: {fixture.expect}</p>
      <ol className="text-xs text-gray-300 list-decimal pl-5 space-y-0.5">
        {steps.map((s, i) => (
          <li key={i}>{s.text}</li>
        ))}
      </ol>
      <div className="flex gap-2">
        <button
          className="btn-secondary text-xs"
          onClick={() => useWorkbench.getState().open(fixture.id, doc)}
        >
          Use as the twin
        </button>
        <button className="btn-secondary text-xs" disabled={mode === 'off'} onClick={record}>
          It is built: record what Board Sense sees
        </button>
        {results.length > 0 && (
          <button
            className="btn-ghost text-xs flex items-center gap-1"
            onClick={() => void navigator.clipboard.writeText(results.join('\n'))}
          >
            <ClipboardCopy className="w-3.5 h-3.5" /> Copy results
          </button>
        )}
      </div>
      {results.length > 0 && (
        <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap">
          {results.join('\n')}
        </pre>
      )}
    </section>
  )
}

export default function BoardPanel({ doc }: { doc: CircuitDoc }) {
  const { mode, states, events, errors, start, stop, findCauses } = useSense()
  const probe = useWorkbench((s) => s.probe)
  const connected = useConnectionStore((s) => s.status === 'connected')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {mode === 'off' ? (
          <>
            <button
              className="btn-success text-sm flex items-center gap-1.5"
              disabled={!connected}
              onClick={() => void start('pi')}
            >
              <Radar className="w-4 h-4" /> Sense the Pi&apos;s board
            </button>
            <button
              className="btn-secondary text-sm flex items-center gap-1.5"
              onClick={() => void start('mock')}
            >
              <Activity className="w-4 h-4" /> Use the simulated board
            </button>
          </>
        ) : (
          <button
            className="btn-danger text-sm flex items-center gap-1.5"
            onClick={() => void stop()}
          >
            <Square className="w-4 h-4" /> Stop sensing
          </button>
        )}
        <span className="text-xs text-gray-500">
          {mode === 'pi'
            ? 'Sensing changes only the pull on input pins, between your runs.'
            : mode === 'mock'
              ? 'Simulated: sweeps of this document as if it were built.'
              : 'Off.'}
        </span>
      </div>
      <p className="text-xs text-amber-300/80">
        Parts on your bench that this document does not show still see the bias changes.
      </p>
      {errors.map((e, i) => (
        <p key={i} className="text-xs text-red-400">
          {e}
        </p>
      ))}
      {states.length > 0 && (
        <section className="card space-y-1 text-xs">
          {states.map(([pin, s]) => (
            <div key={pin}>
              <div className="flex items-center gap-3">
                <span className="w-16 font-mono text-gray-300">GPIO{pin}</span>
                <span className={TONE[s.state]}>{describe(s)}</span>
                {s.state === 'diverged' && (
                  <button
                    className="btn-ghost text-xs flex items-center gap-1"
                    onClick={() => void findCauses(pin)}
                  >
                    <Search className="w-3.5 h-3.5" /> Find likely causes
                  </button>
                )}
              </div>
              <Causes doc={doc} pin={pin} />
            </div>
          ))}
        </section>
      )}
      {probe && probe.skipped.length > 0 && mode !== 'off' && (
        <details className="text-xs text-gray-500">
          <summary>{probe.skipped.length} pins skipped</summary>
          {probe.skipped.map((s) => (
            <div key={s.bcm}>
              GPIO{s.bcm}: {s.reason}
            </div>
          ))}
        </details>
      )}
      {events.length > 0 && (
        <section className="text-xs text-gray-300 space-y-0.5">
          <h3 className="font-semibold text-gray-200">Events</h3>
          {events.map((e, i) => (
            <div key={i}>{e.text}</div>
          ))}
        </section>
      )}
      <Walkthrough />
    </div>
  )
}
