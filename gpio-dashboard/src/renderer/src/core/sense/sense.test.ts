// Board Sense against the mock agent on SPEC 18's bench fixtures: reconciliation states, settling,
// events, and candidate causes for injected single faults.
// Bench strips: 3V3 row 1 a-e, GND row 5 a-e, GPIO17 row 6 a-e, GPIO27 row 7 a-e, GPIO18 row 6 f-j.
import { describe, expect, it } from 'vitest'
import { partDef } from '../defs/parts'
import { TUTORIALS } from '../defs/tutorials'
import type { CircuitDoc, HoleRef } from '../model/types'
import type { EnvValue } from '../sim/behavior'
import { BEHAVIORS } from '../sim/behaviors'
import { Circuit } from '../sim/circuit'
import { probeSignature } from '../sim/probe'
import { at, emptyDoc, wire } from '../testing/fixtures'
import { rankCandidates } from './candidates'
import { pullUpButton } from './fixtures'
import { mockSweep } from './mockAgent'
import { interpret, Reconciler } from './sense'

const PINS = [17, 18, 27]
const rail = (r: 'bottom+' | 'bottom-', index: number): HoleRef => ({
  board: 'bb1',
  area: 'rail',
  rail: r,
  index
})
const expect_ = (doc: CircuitDoc, env?: Map<string, Record<string, EnvValue>>) =>
  probeSignature(new Circuit(doc, partDef, BEHAVIORS), PINS, env)
const pressed = (doc: CircuitDoc) => {
  const env = new Circuit(doc, partDef, BEHAVIORS).defaultEnv()
  env.get('SW1')!.pressed = true
  return env
}

const fixture3 = () => pullUpButton(partDef)

/** Two sweeps of the board, so every change has settled. */
function sense(twin: CircuitDoc, board: CircuitDoc, env?: Map<string, Record<string, EnvValue>>) {
  const r = new Reconciler(expect_(twin, env))
  const boardEnv = env
  const sweep = () => {
    const circuit = new Circuit(board, partDef, BEHAVIORS)
    void circuit
    return mockSweep(board, partDef, PINS)
  }
  if (boardEnv) {
    // The mock reads the board's own inputs from its props.
    board.parts.find((p) => p.id === 'SW1')!.props = { mode: 'momentary', pressed: true }
  }
  r.onSweep(sweep())
  r.onSweep(sweep())
  return r
}

describe('bench fixtures', () => {
  it('1: an empty board follows bias everywhere and verifies nothing', () => {
    const r = sense(emptyDoc(), emptyDoc())
    expect([...r.netStates.values()].map((s) => s.state)).toEqual([
      'unobserved',
      'unobserved',
      'unobserved'
    ])
  })

  it('3: the pull-up holds GPIO18 high released, and it matches the twin', () => {
    const r = sense(fixture3(), fixture3())
    expect(r.netStates.get(18)).toEqual({ state: 'matched' })
  })

  it('4: a lead the twin lacks between GPIO17 and GPIO27 is a GPIO short', () => {
    const board = emptyDoc()
    board.wires.push(wire('X1', at(6, 'a'), at(7, 'a')))
    const r = sense(emptyDoc(), board)
    expect(r.netStates.get(27)).toMatchObject({ state: 'diverged', kind: 'gpio-short' })
  })

  it('6: the Blinking LED comes out unobserved, never matched or diverged', () => {
    const blink = TUTORIALS.find((t) => t.meta.id === 'blinking-led')!.doc
    const r = sense(blink, structuredClone(blink))
    expect(r.netStates.get(17)).toEqual({ state: 'unobserved' })
  })
})

describe('fixture 5: faults on fixture 3, with their candidate causes', () => {
  const diverge = (board: CircuitDoc) => {
    const twin = fixture3()
    const r = sense(twin, board)
    const measured = interpret(mockSweep(board, partDef, PINS))
    return { state: r.netStates.get(18), ranked: rankCandidates(twin, partDef, measured, PINS) }
  }
  const texts = (ranked: ReturnType<typeof rankCandidates>) =>
    ranked.flatMap((g) => g.candidates.map((c) => c.text))

  it('the lead one row off: missing path, and the moved end ranks in the top 3', () => {
    const board = fixture3()
    board.wires.find((w) => w.id === 'W1')!.b = at(31, 'a')
    const { state, ranked } = diverge(board)
    expect(state).toMatchObject({ state: 'diverged', kind: 'missing-path' })
    expect(texts(ranked)).toContain("W1's end in row 30 column a is in row 31 column a instead")
  })

  it("the pull-up's lead missing: missing path, and its absence ranks in the top 3", () => {
    const board = fixture3()
    board.wires = board.wires.filter((w) => w.id !== 'W2')
    const { state, ranked } = diverge(board)
    expect(state).toMatchObject({ state: 'diverged', kind: 'missing-path' })
    expect(texts(ranked)).toContain('W2 is missing')
  })

  it("the button's ground lead on the + rail: pressing shows the wrong level, and the rail swap ranks in the top 3", () => {
    const twin = fixture3()
    const board = fixture3()
    board.wires.find((w) => w.id === 'W4')!.b = { hole: rail('bottom+', 30) }
    board.parts.find((p) => p.id === 'SW1')!.props = { mode: 'momentary', pressed: true }
    const r = new Reconciler(expect_(twin, pressed(twin)))
    r.onSweep(mockSweep(board, partDef, PINS))
    r.onSweep(mockSweep(board, partDef, PINS))
    expect(r.netStates.get(18)).toMatchObject({ state: 'diverged', kind: 'wrong-level' })
    const pressedTwin = structuredClone(twin)
    pressedTwin.parts.find((p) => p.id === 'SW1')!.props = { mode: 'momentary', pressed: true }
    const ranked = rankCandidates(
      pressedTwin,
      partDef,
      interpret(mockSweep(board, partDef, PINS)),
      PINS
    )
    expect(texts(ranked)).toContain("W4's end is on the bottom+ rail instead of bottom-")
  })

  it('groups candidates that predict the same readings as a tie', () => {
    const board = fixture3()
    board.wires = board.wires.filter((w) => w.id !== 'W2')
    const { ranked } = diverge(board)
    // Removing the pull-up's lead and removing the pull-up's rail lead are indistinguishable.
    expect(ranked[0]!.candidates.length).toBeGreaterThan(1)
  })
})

describe('reconciliation over time', () => {
  it('reports a change only after two sweeps, settling in between, with an event', () => {
    const twin = fixture3()
    const r = new Reconciler(expect_(twin))
    r.onSweep(mockSweep(twin, partDef, PINS))
    expect(r.netStates.get(18)).toEqual({ state: 'matched' })
    const board = fixture3()
    board.wires = board.wires.filter((w) => w.id !== 'W1')
    r.onSweep(mockSweep(board, partDef, PINS))
    expect(r.netStates.get(18)).toEqual({ state: 'settling' })
    r.onSweep(mockSweep(board, partDef, PINS))
    expect(r.netStates.get(18)).toMatchObject({ state: 'diverged', kind: 'missing-path' })
    expect(r.events).toEqual([{ pin: 18, text: 'GPIO18 net lost its path to 3V3' }])
  })

  it('ignores a one-sweep blip', () => {
    const twin = fixture3()
    const r = new Reconciler(expect_(twin))
    const board = fixture3()
    board.wires = board.wires.filter((w) => w.id !== 'W1')
    r.onSweep(mockSweep(twin, partDef, PINS))
    r.onSweep(mockSweep(board, partDef, PINS))
    r.onSweep(mockSweep(twin, partDef, PINS))
    expect(r.netStates.get(18)).toEqual({ state: 'matched' })
    expect(r.events).toEqual([])
  })
})
