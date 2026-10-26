// The Studio's title column (SPEC 11.2): the project's name, three live readouts and a sentence on
// what the bench is doing, over the stage's top left. It reads the snapshot the bench shows (the
// Pi's while Live Pi state follows it, else the simulation's, none while a build is part-way) and
// takes no pointer input but for its children, so the bench under it stays live.
import type { ReactNode } from 'react'
import type { CircuitDoc } from '../core/model/types'
import { useBuild } from '../state/buildStore'
import { useLive } from '../state/liveStore'
import { useRun } from '../state/runStore'
import { useStudio } from '../state/studioStore'
import { useWorkbench } from '../state/workbenchStore'
import { captionOf, readoutsOf } from './readouts'

export default function Hud({ doc, children }: { doc: CircuitDoc; children?: ReactNode }) {
  const bench = useWorkbench((s) => s.sim)
  const simulating = useWorkbench((s) => s.codeStatus === 'running')
  const real = useLive((s) => (s.online ? s.sim : undefined))
  const live = useStudio((s) => s.live) && real !== undefined
  const onPi = useRun((s) => s.status === 'deploying' || s.status === 'running')
  const build = useBuild((s) =>
    s.on && s.index < s.steps.length ? `${s.index + 1}/${s.steps.length}` : null
  )
  const shown = live ? real : bench
  const snapshot = build ? null : (shown?.snapshot ?? null)
  const issues = shown?.issues ?? []
  const [step, of] = build?.split('/').map(Number) ?? []
  const caption = captionOf({
    parts: doc.parts.length,
    build: build ? { step: step!, of: of! } : null,
    snapshot,
    issues,
    live,
    onPi,
    simulating
  })
  return (
    <div className="hud-layer">
      <section className="hud-side" aria-label="Bench readouts">
        <h1 className="hud-brand">
          <span>Breadboard Studio</span>
          <b>{doc.meta.name}</b>
        </h1>
        <dl className="hud-stats">
          {readoutsOf(snapshot, issues).map((r) => (
            <div key={r.label.split(' ')[0]} className="hud-stat" data-tone={r.tone}>
              <dt>{r.label}</dt>
              <dd>
                {r.value}
                {r.unit && <i>{r.unit}</i>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="hud-why" aria-live="polite" aria-atomic="true">
          {caption.map((g, i) =>
            g.tone === 'b' ? (
              <b key={i}>{g.text}</b>
            ) : g.tone ? (
              <span key={i} className={`hud-${g.tone}`}>
                {g.text}
              </span>
            ) : (
              g.text
            )
          )}
        </p>
        {children}
      </section>
    </div>
  )
}
