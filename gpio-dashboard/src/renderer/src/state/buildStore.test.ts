// Build Mode's store: the steps played one at a time, progress kept per project, and each step
// checked against the sweeps Board Sense publishes. The worker that simulates the board is
// stood in for by the same core functions it runs.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import type { CircuitDoc } from '../core/model/types'
import { checkStep, docUpTo } from '../core/sense/buildSteps'
import { rankCandidates } from '../core/sense/candidates'
import { mockSweep } from '../core/sense/mockAgent'
import { interpret, type Measured } from '../core/sense/sense'
import { BEHAVIORS } from '../core/sim/behaviors'
import { Circuit } from '../core/sim/circuit'
import { probeSignature } from '../core/sim/probe'
import type { BuildStep } from '../core/steps/steps'
import { useBuild } from './buildStore'
import { circuit } from './circuit'
import { useProject } from './projectStore'
import { useSense } from './senseStore'

const PINS = [17, 18, 27]

vi.mock('./buildSense', () => ({
  StepChecker: class {
    constructor(
      private readonly doc: CircuitDoc,
      private readonly steps: BuildStep[]
    ) {}
    async signature(index: number, pins: number[]) {
      const doc = docUpTo(this.doc, this.steps, index)
      return probeSignature(new Circuit(doc, partDef, BEHAVIORS), pins)
    }
    async causes(index: number, measured: Measured, pins: number[]) {
      return rankCandidates(docUpTo(this.doc, this.steps, index), partDef, measured, pins)
    }
  }
}))

// The app's own simulation worker has nothing to do here; the Workbench just must not fail on it.
vi.mock('./simClient', () => ({
  simChannel: () => async () => ({ type: 'error', message: 'no worker in tests' }),
  simRequest: async () => ({ type: 'error', message: 'no worker in tests' })
}))

const memory = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v)
})

const tutorial = (id: string) => TUTORIALS.find((t) => t.meta.id === id)!.doc

/** Opens a tutorial as a template and starts Build Mode on it. */
function begin(id: string) {
  useBuild.getState().stop()
  circuit.open(tutorial(id))
  useProject.setState({ id: null })
  useBuild.getState().start()
}

/** Publishes sweeps of `board` as Board Sense would, one after another. */
let t = 0
async function sweeps(board: CircuitDoc, count: number) {
  for (let i = 0; i < count; i++) {
    useSense.setState({ sweep: mockSweep(board, partDef, PINS, (t += 0.25)) })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  memory.clear()
  useBuild.getState().stop()
  useSense.setState({ mode: 'off', sweep: null })
})

describe('playing the steps', () => {
  it('starts on the T-board step with nothing on the bench, and ends on the whole tutorial', () => {
    begin('button')
    const { steps, scene, done } = useBuild.getState()
    expect(useBuild.getState().index).toBe(0)
    expect(steps[0]!.kind).toBe('tboard')
    expect(scene!.shown.parts).toEqual([])
    expect(done).toEqual([])
    for (let i = 0; i < steps.length; i++) useBuild.getState().markDone()
    const end = useBuild.getState()
    expect(end.index).toBe(steps.length)
    expect(end.done).toEqual(steps.map((s) => s.key))
    expect(end.scene!.shown).toEqual(tutorial('button'))
    // The circuit itself was never touched.
    expect(circuit.getSnapshot()).toEqual(tutorial('button'))
  })

  it('goes back and forth without marking anything done, and stays within the steps', () => {
    begin('button')
    const { next, back, goTo } = useBuild.getState()
    next()
    next()
    expect(useBuild.getState().index).toBe(2)
    expect(useBuild.getState().done).toEqual([])
    back()
    expect(useBuild.getState().index).toBe(1)
    back()
    back()
    expect(useBuild.getState().index).toBe(0)
    goTo(999)
    expect(useBuild.getState().index).toBe(useBuild.getState().steps.length)
  })

  it('leaves the slot for a hardware checkpoint empty', () => {
    begin('button')
    useBuild.getState().next()
    expect(useBuild.getState().checkpoint).toBeNull()
  })
})

describe('progress', () => {
  it('survives leaving Build Mode and reopening the tutorial', () => {
    begin('button')
    const { markDone } = useBuild.getState()
    markDone()
    markDone()
    markDone()
    const before = useBuild.getState()
    begin('button')
    const after = useBuild.getState()
    expect(after.index).toBe(3)
    expect(after.done).toEqual(before.done)
  })

  it('is kept apart for each tutorial, and a finished build reopens finished', () => {
    begin('button')
    useBuild.getState().markDone()
    begin('blinking-led')
    expect(useBuild.getState().index).toBe(0)
    expect(useBuild.getState().done).toEqual([])
    const n = useBuild.getState().steps.length
    for (let i = 0; i < n; i++) useBuild.getState().markDone()
    begin('blinking-led')
    expect(useBuild.getState().index).toBe(n)
    begin('button')
    expect(useBuild.getState().index).toBe(1)
  })

  it('is kept under the project once the document is one of my projects', () => {
    begin('button')
    useBuild.getState().markDone()
    useProject.setState({ id: 'my-button' })
    useBuild.getState().markDone()
    useBuild.getState().stop()
    // A project of that name has its own progress, and the template's is untouched.
    useBuild.getState().start()
    expect(useBuild.getState().index).toBe(2)
    useBuild.getState().stop()
    useProject.setState({ id: null })
    useBuild.getState().start()
    expect(useBuild.getState().index).toBe(1)
  })

  it('ends when another project is opened', () => {
    begin('button')
    circuit.open(tutorial('blinking-led'))
    expect(useBuild.getState().on).toBe(false)
  })
})

describe('with Board Sense on the simulated board', () => {
  it('confirms the observable steps by itself and leaves the others for Done', async () => {
    useSense.setState({ mode: 'mock' })
    begin('button')
    const doc = tutorial('button')
    const { steps } = useBuild.getState()
    let confirmed = 0
    let unobservable = 0
    for (let i = 0; i < steps.length; i++) {
      expect(useBuild.getState().index).toBe(i)
      // Before the step is built the board shows what it did.
      await sweeps(docUpTo(doc, steps, i - 1), 2)
      const want = checkStep(
        doc,
        steps,
        i,
        interpret(mockSweep(docUpTo(doc, steps, i - 1), partDef, PINS)),
        PINS,
        partDef
      ).state
      await vi.waitFor(() => expect(useBuild.getState().status.state).toBe(want))
      expect(useBuild.getState().index).toBe(i)
      // Then it is built.
      await sweeps(docUpTo(doc, steps, i), 2)
      const built = interpret(mockSweep(docUpTo(doc, steps, i), partDef, PINS))
      if (checkStep(doc, steps, i, built, PINS, partDef).state === 'confirmed') {
        await vi.waitFor(() => expect(useBuild.getState().index).toBe(i + 1))
        expect(useBuild.getState().sensed).toContain(steps[i]!.key)
        confirmed++
      } else {
        await vi.waitFor(() =>
          expect(useBuild.getState().status.state).toBe('not electrically verifiable')
        )
        expect(useBuild.getState().index).toBe(i)
        useBuild.getState().markDone()
        unobservable++
      }
    }
    expect(useBuild.getState().index).toBe(steps.length)
    expect(useBuild.getState().done).toHaveLength(steps.length)
    expect(confirmed).toBeGreaterThan(0)
    expect(unobservable).toBeGreaterThan(0)
  })

  // On the Button, W3 (GPIO18 to its pull-up) is the one step Board Sense can see.
  const seen = (steps: BuildStep[]) => steps.findIndex((s) => s.key === 'wire:W3')

  it('shows a step done differently as a divergence with ranked causes, and waits for two sweeps', async () => {
    useSense.setState({ mode: 'mock' })
    begin('button')
    const doc = tutorial('button')
    const { steps } = useBuild.getState()
    const index = seen(steps)
    useBuild.getState().goTo(index)
    // W3 brings 3V3 to the pull-up. Its 3V3 end went to the ground row (5) instead: the pull-up now
    // pulls GPIO18 low, which is neither how it read before the step nor how it should read after.
    const wrong = structuredClone(docUpTo(doc, steps, index))
    wrong.wires.find((w) => w.id === 'W3')!.a = {
      hole: { board: 'bb1', area: 'main', row: 5, col: 'b' }
    }
    // One sweep is not believed.
    await sweeps(wrong, 1)
    expect(useBuild.getState().status.state).toBe('checking')
    await sweeps(wrong, 1)
    // Ranking the single-fault edits is a simulation of each; the worker does it off the page.
    await vi.waitFor(
      () => {
        const status = useBuild.getState().status
        expect(status.state === 'diverged' && Array.isArray(status.causes)).toBe(true)
      },
      { timeout: 30_000, interval: 200 }
    )
    const status = useBuild.getState().status
    if (status.state !== 'diverged') throw new Error('not diverged')
    expect(status.pins).toEqual([18])
    expect(status.details[0]).toMatch(/GPIO18/)
    expect(status.causes).not.toEqual([])
    expect(useBuild.getState().index).toBe(index)
  })

  it('does not move on from a step already done when Back revisits it', async () => {
    useSense.setState({ mode: 'mock' })
    begin('button')
    const doc = tutorial('button')
    const { steps } = useBuild.getState()
    const index = seen(steps)
    useBuild.getState().goTo(index)
    useBuild.getState().markDone()
    useBuild.getState().back()
    expect(useBuild.getState().index).toBe(index)
    // The board shows the step built, which would confirm it were it not done already.
    await sweeps(docUpTo(doc, steps, index), 3)
    expect(useBuild.getState().index).toBe(index)
  })
})
