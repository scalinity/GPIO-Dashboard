// Build Mode (SPEC 11.7): the open document's generated steps, played one at a time. The stage
// draws the document as built so far with the step in hand as a pulsing ghost, frames it, and
// shows its text; with Board Sense on, each step checks itself against what the sweeps measure
// (core/sense's checkStep, split in buildCheck.ts) and ticks off when the change is sensed. Build
// Mode reads Board Sense and never starts, stops or configures it. The document is never changed
// here: what the stage shows is derived from it, so a tutorial stays a read-only template.
import { create } from 'zustand'
import { partDef } from '../core/defs/parts'
import type { CircuitDoc } from '../core/model/types'
import type { Ranked } from '../core/sense/candidates'
import { compare, interpret, type Sweep } from '../core/sense/sense'
import { buildSteps, type BuildStep } from '../core/steps/steps'
import { type StepScene, stepScene } from '../studio/build'
import { judge } from './buildCheck'
import { StepChecker } from './buildSense'
import { circuit } from './circuit'
import { type Checkpoint, checkpointsAfter, deriveCheckpoints } from './checkpoints'
import { useProject } from './projectStore'
import { useSense } from './senseStore'

/**
 * A hardware checkpoint after a step (SPEC 14.4): an I2C scan, "press the button", "toggle the
 * LED". They are derived from the circuit (state/checkpoints.ts) and run from the step card
 * (state/checkpointStore.ts); Build Mode itself never runs one.
 */
export type { Checkpoint }

/** What Board Sense says of the step in hand. */
export type StepStatus =
  /** Board Sense is off: the step waits for the Done button. */
  | { state: 'off' }
  /** Sensing is on and no verdict has held for two sweeps yet. */
  | { state: 'checking' }
  /** The board as built to this step does not simulate, so Board Sense cannot be compared with it. */
  | { state: 'unavailable' }
  | { state: 'waiting'; pins: number[] }
  | {
      state: 'diverged'
      pins: number[]
      /** What each differing pin reads against what the step should leave. */
      details: string[]
      causes: Ranked[] | 'working' | 'unavailable'
    }
  | { state: 'not electrically verifiable' }

interface BuildState {
  on: boolean
  /** The document the steps come from, as Build Mode last read it. */
  doc: CircuitDoc | null
  steps: BuildStep[]
  /** The step in hand; `steps.length` once the last is passed. */
  index: number
  /** Keys of the steps marked done, by the Done button or by Board Sense. */
  done: string[]
  /** Keys of the steps Board Sense confirmed in this session. */
  sensed: string[]
  /** Keys of the steps whose hardware checkpoints passed in this session. */
  checked: string[]
  scene: StepScene | null
  status: StepStatus
  /** The build's hardware checkpoints, each on the step that completes what it checks. */
  plan: Checkpoint[]
  /** The checkpoints that hang on the step in hand. */
  checkpoints: Checkpoint[]
  /** Depth of field on the step's target (SPEC 10.7). */
  blur: boolean
  /** Bumped whenever the camera should frame the step again. */
  frameSeq: number
  start(): void
  stop(): void
  next(): void
  back(): void
  /** Marks the step in hand done and moves on. */
  markDone(): void
  /** Marks the step in hand done because its hardware checkpoints passed; stays on it. */
  markChecked(): void
  goTo(index: number): void
  showAgain(): void
  restart(): void
  setBlur(blur: boolean): void
}

interface Progress {
  /** The step in hand, by key; null once the build is finished. */
  current: string | null
  done: string[]
}

const PROGRESS_PREFIX = 'gpio.build.progress.'
const BLUR_KEY = 'gpio.build.blur'

/** Browser storage, which may be missing or full: Build Mode then forgets between runs. */
function stored<T>(key: string, write?: T): T | null {
  try {
    if (write !== undefined) localStorage.setItem(key, JSON.stringify(write))
    else return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    /* storage unavailable */
  }
  return null
}

/** Progress is kept per project: its file once saved, else the tutorial it is a template of. */
function progressKey(doc: CircuitDoc): string | null {
  const project = useProject.getState().id
  if (project) return `${PROGRESS_PREFIX}project:${project}`
  const tutorial = doc.meta.sourceTutorialId
  return tutorial ? `${PROGRESS_PREFIX}tutorial:${tutorial}` : null
}

/** The same document across edits and saves; another project or tutorial is another one. */
const identityOf = (doc: CircuitDoc) => `${doc.meta.created}|${doc.meta.sourceTutorialId ?? ''}`

const stepsOf = (doc: CircuitDoc) => buildSteps(doc, partDef).steps

/** The build's checkpoints; a circuit the rule cannot read offers none rather than breaking the build. */
function planOf(doc: CircuitDoc, steps: BuildStep[]): Checkpoint[] {
  try {
    return deriveCheckpoints(doc, steps)
  } catch {
    return []
  }
}

/** Simulates the board at each step, off the page's thread; replaced when the steps change. */
let checker: StepChecker | null = null
let watching: (() => void)[] = []
/** Which evaluation is the latest; an older one that finishes late is dropped. */
let latest = 0
/** The verdict the newest sweeps gave for one step: shown once two sweeps in a row agree. */
let streak: { sweep: Sweep; step: string; verdict: string; count: number } | null = null
/** The ranked causes of a diverged step, by step and pins, and the requests still out. */
let found = { ranked: new Map<string, Ranked[] | 'unavailable'>(), asking: new Set<string>() }

export const useBuild = create<BuildState>((set, get) => {
  /** Moves to a step: the stage redraws, the camera frames it, Board Sense is asked again. */
  const go = (index: number, extra: Partial<BuildState> = {}) => {
    const { doc, steps } = get()
    if (!doc) return
    const at = Math.max(0, Math.min(index, steps.length))
    streak = null
    found = { ranked: new Map(), asking: new Set() }
    set({
      ...extra,
      index: at,
      scene: stepScene(doc, steps, at),
      status: { state: 'off' },
      checkpoints: checkpointsAfter(get().plan, steps[at]),
      frameSeq: get().frameSeq + 1
    })
    const key = progressKey(doc)
    if (key) stored<Progress>(key, { current: steps[at]?.key ?? null, done: get().done })
    void evaluate()
  }

  return {
    on: false,
    doc: null,
    steps: [],
    index: 0,
    done: [],
    sensed: [],
    checked: [],
    scene: null,
    status: { state: 'off' },
    plan: [],
    checkpoints: [],
    blur: stored<boolean>(BLUR_KEY) ?? false,
    frameSeq: 0,
    start() {
      const doc = circuit.getSnapshot()
      const steps = stepsOf(doc)
      const key = progressKey(doc)
      const saved = key ? stored<Progress>(key) : null
      const done = (saved?.done ?? []).filter((k) => steps.some((s) => s.key === k))
      // Where it was left: the step in hand, or the end; else the first step not done.
      const left = !saved
        ? 0
        : saved.current === null
          ? steps.length
          : steps.findIndex((s) => s.key === saved.current)
      const first = steps.findIndex((s) => !done.includes(s.key))
      checker = new StepChecker(doc, steps)
      for (const stopWatching of watching) stopWatching()
      watching = [
        useSense.subscribe((now, before) => {
          if (now.sweep !== before.sweep || now.mode !== before.mode) void evaluate()
        })
      ]
      set({ on: true, doc, steps, done, sensed: [], checked: [], plan: planOf(doc, steps) })
      go(left >= 0 ? left : first < 0 ? steps.length : first)
    },
    stop() {
      for (const stopWatching of watching) stopWatching()
      watching = []
      checker = null
      latest += 1
      set({
        on: false,
        doc: null,
        steps: [],
        sensed: [],
        checked: [],
        scene: null,
        status: { state: 'off' },
        plan: [],
        checkpoints: []
      })
    },
    next: () => go(get().index + 1),
    back: () => go(get().index - 1),
    goTo: (index) => go(index),
    markDone() {
      const { steps, index, done } = get()
      const step = steps[index]
      if (step) go(index + 1, { done: done.includes(step.key) ? done : [...done, step.key] })
    },
    markChecked() {
      const { doc, steps, index, done, checked } = get()
      const step = steps[index]
      if (!doc || !step) return
      const now = done.includes(step.key) ? done : [...done, step.key]
      set({ done: now, checked: checked.includes(step.key) ? checked : [...checked, step.key] })
      const key = progressKey(doc)
      if (key) stored<Progress>(key, { current: step.key, done: now })
    },
    showAgain: () => set({ frameSeq: get().frameSeq + 1 }),
    restart() {
      set({ done: [], sensed: [], checked: [] })
      go(0)
    },
    setBlur(blur) {
      stored(BLUR_KEY, blur)
      set({ blur })
    }
  }
})

/**
 * Judges the step in hand against the newest sweep. The two signatures it compares come from a
 * worker, once per step. A verdict shows once two sweeps in a row give it (a change counts once
 * it persists, SPEC 14.5); a confirmed step ticks off and the build moves on.
 */
async function evaluate(): Promise<void> {
  const mine = ++latest
  const { on, steps, index, status } = useBuild.getState()
  const step = steps[index]
  const sense = useSense.getState()
  // A verdict that has not changed leaves the status as it is: the stage redraws only on change.
  const show = (next: StepStatus) => {
    if (mine === latest && JSON.stringify(next) !== JSON.stringify(useBuild.getState().status))
      useBuild.setState({ status: next })
  }
  // A step already done is a step revisited: sweeps do not move the build on from it.
  const revisited = !!step && useBuild.getState().done.includes(step.key)
  if (!on || !step || revisited || sense.mode === 'off') return show({ state: 'off' })
  const sweep = sense.sweep
  if (!sweep || !checker) return show({ state: 'checking' })
  if (status.state === 'off') show({ state: 'checking' })
  const used = checker
  const measured = interpret(sweep)
  let verdict
  let details: string[] = []
  try {
    const [before, after] = await Promise.all([
      used.signature(index - 1, sweep.pins),
      used.signature(index, sweep.pins)
    ])
    verdict = judge(before, after, measured, sweep.pins)
    if (verdict.state === 'diverged')
      details = verdict.pins.map((pin) => {
        const net = compare(pin, after, measured)
        return net.state === 'diverged'
          ? net.detail
          : `GPIO${pin} reads neither as before this step nor as after it`
      })
  } catch {
    // A partly built circuit the simulator cannot solve (four-digit-seven-segment, steps 45 to 51).
    return show({ state: 'unavailable' })
  }
  if (mine !== latest) return

  const text = JSON.stringify(verdict)
  if (!streak || streak.step !== step.key || streak.verdict !== text)
    streak = { sweep, step: step.key, verdict: text, count: 1 }
  else if (streak.sweep !== sweep) streak = { ...streak, sweep, count: streak.count + 1 }
  if (streak.count < 2) return show(status.state === 'off' ? { state: 'checking' } : status)

  if (verdict.state === 'confirmed') {
    const { sensed } = useBuild.getState()
    useBuild.setState({ sensed: sensed.includes(step.key) ? sensed : [...sensed, step.key] })
    return useBuild.getState().markDone()
  }
  if (verdict.state !== 'diverged') return show(verdict)

  // Done differently: show the divergence, and rank the single-fault edits that would explain it.
  const key = `${index}:${verdict.pins.join()}`
  const asked = found
  show({
    state: 'diverged',
    pins: verdict.pins,
    details,
    causes: found.ranked.get(key) ?? 'working'
  })
  if (found.ranked.has(key) || found.asking.has(key)) return
  found.asking.add(key)
  const ranked = await used
    .causes(index, measured, sweep.pins)
    .catch((): 'unavailable' => 'unavailable')
  if (asked !== found) return
  found.ranked.set(key, ranked)
  const now = useBuild.getState().status
  if (now.state === 'diverged' && now.pins.join() === verdict.pins.join())
    useBuild.setState({ status: { ...now, causes: ranked } })
}

// Another project or tutorial ends Build Mode. An edit of the same one (an undo, the assistant)
// regenerates the steps and keeps the step in hand where it still exists.
circuit.subscribe(() => {
  const state = useBuild.getState()
  if (!state.on || !state.doc) return
  const doc = circuit.getSnapshot()
  if (identityOf(doc) !== identityOf(state.doc)) return state.stop()
  const steps = stepsOf(doc)
  if (JSON.stringify(steps) === JSON.stringify(state.steps)) return useBuild.setState({ doc })
  const key = state.steps[state.index]?.key
  const at = key ? steps.findIndex((s) => s.key === key) : -1
  checker = new StepChecker(doc, steps)
  useBuild.setState({
    doc,
    steps,
    plan: planOf(doc, steps),
    done: state.done.filter((k) => steps.some((s) => s.key === k))
  })
  state.goTo(at < 0 ? Math.min(state.index, steps.length) : at)
})
