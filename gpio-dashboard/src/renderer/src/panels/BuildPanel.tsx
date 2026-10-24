// Build Mode's panel (SPEC 11.7), in the Part Library's place: the step in hand with its text, its
// "why" note and common mistake, what Board Sense says of it, and Back, Next and Done; below, every
// step with a tick for those done. The stage frames the step and pulses its holes.
import { Check, ChevronLeft, ChevronRight, Crosshair, RotateCcw, X } from 'lucide-react'
import { holeText } from '../core/steps/steps'
import { type StepStatus, useBuild } from '../state/buildStore'
import { useSense } from '../state/senseStore'

const pinsText = (pins: number[]) => pins.map((p) => `GPIO${p}`).join(', ')

/** What Board Sense says of the step in hand. */
function Status({ status }: { status: StepStatus }) {
  const doc = useBuild((s) => s.scene?.shown)
  const mode = useSense((s) => s.mode)
  switch (status.state) {
    case 'off':
      return (
        <p className="text-xs text-gray-400">
          {mode === 'off'
            ? 'Board Sense is off. Click Done when this step is built.'
            : 'Waiting for Board Sense.'}
        </p>
      )
    case 'checking':
      return <p className="text-xs text-gray-400">Checking with Board Sense…</p>
    case 'waiting':
      return (
        <p role="status" className="text-xs text-amber-300">
          Waiting for the change on {pinsText(status.pins)}
        </p>
      )
    case 'not electrically verifiable':
      return (
        <div role="status" className="space-y-1">
          <span className="inline-block rounded-pill bg-white/[0.08] px-2 py-0.5 text-xs text-gray-200">
            not electrically verifiable
          </span>
          <p className="text-xs text-gray-400">
            Board Sense cannot see this step. Click Done when it is built.
          </p>
        </div>
      )
    case 'diverged':
      return (
        <div role="status" aria-label="Board Sense divergence" className="space-y-1 text-xs">
          <p className="text-red-300">Not as expected: {pinsText(status.pins)}</p>
          {status.details.map((d) => (
            <p key={d} className="text-gray-300">
              {d}
            </p>
          ))}
          {status.causes === 'working' && <p className="text-gray-400">Finding likely causes…</p>}
          {status.causes === 'unavailable' && (
            <p className="text-gray-400">Likely causes could not be worked out.</p>
          )}
          {Array.isArray(status.causes) && (
            <ol aria-label="Likely causes" className="list-decimal space-y-1 pl-5 text-gray-300">
              {status.causes.map((group, i) => (
                <li key={i}>
                  {group.candidates.length > 1 && <span className="text-amber-400">tie: </span>}
                  {group.candidates.map((c) => c.text).join('; or ')}
                  {doc && group.candidates[0]!.holes.length > 0 && (
                    <span className="text-gray-500">
                      {' '}
                      ({group.candidates[0]!.holes.map((h) => holeText(doc, h)).join(' → ')})
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )
  }
}

export default function BuildPanel() {
  const { doc, steps, index, done, sensed, status, checkpoint, blur } = useBuild()
  const { stop, back, next, markDone, goTo, showAgain, restart, setBlur } = useBuild.getState()
  const step = steps[index]
  const finished = index >= steps.length
  const template = !!doc?.meta.sourceTutorialId
  return (
    <aside
      aria-label="Build Mode"
      className="w-72 shrink-0 flex flex-col border-r border-white/[0.04] bg-surface-900/60 min-h-0"
    >
      <div className="flex items-center gap-2 border-b border-white/[0.04] p-3">
        <h2 className="text-sm font-semibold text-gray-100">Build Mode</h2>
        <span className="text-xs text-gray-500">
          {finished ? `${steps.length} steps` : `Step ${index + 1} of ${steps.length}`}
        </span>
        <button className="btn-ghost ml-auto px-2 py-1 text-xs" onClick={stop}>
          <X className="mr-1 inline h-3.5 w-3.5" />
          Exit
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div
          role="progressbar"
          aria-label="Build progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done.length}
          className="h-1 rounded-full bg-white/[0.08]"
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${steps.length ? (done.length / steps.length) * 100 : 0}%` }}
          />
        </div>

        {finished ? (
          <section className="card space-y-2 text-sm" aria-label="Build complete">
            <p className="font-medium text-gray-100">
              {done.length === steps.length
                ? 'The build is complete.'
                : `You have reached the end; ${steps.length - done.length} steps are not marked done.`}
            </p>
            <p className="text-xs text-gray-400">
              {template
                ? 'Fork this tutorial to my projects to change it, or run its code from the Code tab.'
                : 'Run its code from the Code tab, or simulate it.'}
            </p>
            <button className="btn-secondary text-xs" onClick={restart}>
              <RotateCcw className="mr-1 inline h-3.5 w-3.5" />
              Start over
            </button>
          </section>
        ) : (
          step && (
            <section className="card space-y-2" aria-label={`Step ${index + 1}`}>
              <p className="text-sm text-gray-100">{step.text}</p>
              {step.why && <p className="text-xs text-gray-400">Why: {step.why}</p>}
              {step.mistake && (
                <p className="text-xs text-amber-300/90">Watch out: {step.mistake}</p>
              )}
              <Status status={status} />
              {checkpoint && <p data-testid="checkpoint-slot">{checkpoint.kind}</p>}
            </section>
          )
        )}

        <div className="flex items-center gap-1.5">
          <button className="btn-secondary px-2 py-1 text-xs" disabled={index === 0} onClick={back}>
            <ChevronLeft className="mr-0.5 inline h-3.5 w-3.5" />
            Back
          </button>
          <button className="btn-success px-3 py-1 text-xs" disabled={finished} onClick={markDone}>
            <Check className="mr-1 inline h-3.5 w-3.5" />
            Done
          </button>
          <button className="btn-secondary px-2 py-1 text-xs" disabled={finished} onClick={next}>
            Next
            <ChevronRight className="ml-0.5 inline h-3.5 w-3.5" />
          </button>
          <button
            className="btn-ghost ml-auto px-2 py-1 text-xs"
            title="Frame this step again"
            onClick={showAgain}
          >
            <Crosshair className="mr-1 inline h-3.5 w-3.5" />
            Show me
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={blur} onChange={(e) => setBlur(e.target.checked)} />
          Blur what is not the step
        </label>

        <ol aria-label="Steps" className="space-y-0.5 text-xs">
          {steps.map((s, i) => (
            <li key={s.key}>
              <button
                aria-current={i === index ? 'step' : undefined}
                className={`flex w-full items-start gap-2 rounded-btn px-2 py-1 text-left hover:bg-white/[0.06] ${i === index ? 'bg-white/[0.08] text-white' : 'text-gray-400'}`}
                onClick={() => goTo(i)}
              >
                <span className="w-4 shrink-0 text-right tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{s.text}</span>
                {done.includes(s.key) && (
                  <Check
                    aria-label={sensed.includes(s.key) ? 'done, sensed' : 'done'}
                    className={`h-3.5 w-3.5 shrink-0 ${sensed.includes(s.key) ? 'text-emerald-400' : 'text-gray-300'}`}
                  />
                )}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}
