// The Claude drawer's store on the app's own CircuitStore (SPEC 11.8, 12.6, acceptance 5 and 7): a
// replayed "blink an LED on GPIO17" turn locks the document while it runs, shows ghosts before the
// tool inputs are whole, ends with a review of what it added, and Undo all restores the document
// it started from. The workers are replaced by the same code run in place.
import { describe, expect, it, vi } from 'vitest'
import { BLINK_SCRIPT } from '../assistant/testing/blinkScript'
import { scriptedFetch, text, toolUse, type Reply } from '../assistant/testing/sse'
import { newDoc } from '../core/model/defaults'
import type { CircuitDoc } from '../core/model/types'
import { ghostIds, withGhosts } from '../studio/ghosts'
import { SimHost } from '../workers/simHost'

vi.mock('./simClient', () => ({
  simChannel: () => {
    const host = new SimHost()
    return async (req: Parameters<SimHost['handle']>[0]) => host.handle(req)
  },
  simRequest: async () => ({ type: 'error', message: 'not in this test' })
}))
vi.mock('./assistantPython', () => ({
  checkPython: async () => [],
  runCodeInSim: async () => ({ stdout: '', stderr: '', error: null, events: [], truncated: false })
}))

const { circuit } = await import('./circuit')
const store = await import('./assistantStore')
const { useStudio } = await import('./studioStore')

/** A fetch that serves `script` slowly enough for the store to see each event. */
function replay(script: Reply[]) {
  const served = scriptedFetch(script, 7)
  store.replaceFetchForDev(served.fetch)
  return served
}

describe('the review strip', () => {
  const base = newDoc('T', '2026-10-24T00:00:00.000Z')

  it('counts what a turn added, defined and changed, and tints what it added or changed', () => {
    // The review compares definitions by id and content; this one needs no more than an id.
    const custom = { id: 'custom-sensor' } as NonNullable<CircuitDoc['customParts']>[number]
    const after: CircuitDoc = {
      ...base,
      parts: [
        { id: 'R1', defId: 'resistor', props: {}, placement: { pins: {} } },
        { id: 'D1', defId: 'led', props: {}, placement: { pins: {} } }
      ],
      wires: [
        {
          id: 'W1',
          a: { hole: { board: 'bb1', area: 'main', row: 1, col: 'a' } },
          b: { hole: { board: 'bb1', area: 'main', row: 2, col: 'a' } },
          color: 'red',
          kind: 'dupont-mm',
          lengthMm: 'auto'
        }
      ],
      customParts: [custom],
      buildStepAnnotations: { 'part:R1': { why: 'limits the current' } }
    }
    const review = store.reviewOf('turn-1', base, after)
    expect(review.added).toEqual({ parts: 2, wires: 1 })
    expect(review.defined).toBe(1)
    expect(review.tint).toEqual({ parts: ['R1', 'D1'], wires: ['W1'] })
    expect(store.reviewText(review)).toBe(
      'Claude added 2 parts, 1 wire; defined 1 custom part, updated the build-step notes'
    )
  })

  it('reads as the SPEC writes it for a plain build', () => {
    const review = {
      turnId: 't',
      added: { parts: 9, wires: 14 },
      defined: 0,
      changed: 0,
      removed: 0,
      other: [],
      tint: { parts: [], wires: [] }
    }
    expect(store.reviewText(review)).toBe('Claude added 9 parts, 14 wires')
    expect(
      store.reviewText({ ...review, added: { parts: 0, wires: 0 }, other: ['the code'] })
    ).toBe('Claude updated the code')
  })
})

describe('ghosts on the bench', () => {
  it('draw a ghost part and lead into the shown document, and leave the document alone', () => {
    const doc = newDoc('T', '2026-10-24T00:00:00.000Z')
    const hole = (row: number) => ({ board: 'bb1', area: 'main' as const, row, col: 'a' as const })
    const ghosted = withGhosts(doc, {
      t1: {
        kind: 'part',
        ref: 'R1',
        defId: 'resistor',
        placement: { pins: { 1: hole(30), 2: hole(34) } }
      },
      t2: {
        kind: 'wire',
        a: { hole: hole(31) },
        b: { hole: hole(40) },
        wireKind: 'dupont-mm',
        color: 'red'
      },
      t3: { kind: 'part', ref: 'X1', defId: 'custom-unknown', placement: { pins: {} } }
    })
    expect(ghostIds(doc, ghosted)).toEqual(['R1', 'ghost:t2'])
    expect(doc.parts).toEqual([])
    expect(withGhosts(doc, {})).toBe(doc)
  })
})

describe('a replayed turn through the store', () => {
  it('locks the document, ghosts before inputs complete, reviews, and undoes to deep-equal', async () => {
    const before = circuit.getSnapshot()
    const served = replay(BLINK_SCRIPT)
    const locked: boolean[] = []
    const unsubscribe = circuit.subscribe(() => locked.push(circuit.locked))
    const shownGhosts = new Set<string>()
    const unwatch = useStudio.subscribe((s) =>
      Object.keys(s.ghosts).forEach((id) => shownGhosts.add(id))
    )
    await store.send('blink an LED on GPIO17')
    unsubscribe()
    unwatch()

    expect(served.requests).toHaveLength(BLINK_SCRIPT.length)
    // Every commit of the turn happened while the store was locked to it, and it is unlocked now.
    expect(locked.length).toBeGreaterThan(0)
    expect(locked.every(Boolean)).toBe(true)
    expect(circuit.locked).toBe(false)

    const chips = store.useAssistant
      .getState()
      .items.filter((i): i is Extract<typeof i, { kind: 'tool' }> => i.kind === 'tool')
    const building = chips.filter((c) => c.name === 'place_part' || c.name === 'connect')
    expect(building.map((c) => c.id)).toEqual(['t3', 't4', 't5', 't6', 't7'])
    expect(building.every((c) => c.status === 'done')).toBe(true)
    for (const c of building.filter((c) => c.name === 'place_part')) expect(c.ghostEarly).toBe(true)
    expect([...shownGhosts]).toEqual(expect.arrayContaining(['t3', 't4']))
    expect(useStudio.getState().ghosts).toEqual({})

    const { review } = store.useAssistant.getState()
    expect(review && store.reviewText(review)).toBe(
      'Claude added 2 parts, 3 wires; updated the code'
    )
    expect(useStudio.getState().tinted?.parts.sort()).toEqual(['D1', 'R1'])

    store.undoAll()
    expect(circuit.getSnapshot()).toEqual(before)
    expect(store.useAssistant.getState().review).toBeNull()
    expect(useStudio.getState().tinted).toBeNull()
  })

  it('stopped mid-turn, keeps what it committed, undoable as one group', async () => {
    store.newConversation()
    const before = circuit.getSnapshot()
    replay([BLINK_SCRIPT[0]!, BLINK_SCRIPT[1]!, { hangAfter: [] } as unknown as Reply])
    const turn = store.send('blink an LED on GPIO17')
    await vi.waitUntil(() => circuit.getSnapshot().parts.length === 2, { timeout: 5000 })
    expect(circuit.locked).toBe(true)
    // Nothing else may edit while the turn runs.
    const byHand = circuit.dispatch({
      author: 'user',
      label: 'x',
      ops: [{ type: 'SetMeta', meta: { name: 'Mine' } }]
    })
    expect(byHand.ok).toBe(false)
    store.stop()
    await turn
    expect(circuit.locked).toBe(false)
    expect(
      circuit
        .getSnapshot()
        .parts.map((p) => p.id)
        .sort()
    ).toEqual(['D1', 'R1'])
    const { items, review } = store.useAssistant.getState()
    expect(items.at(-1)).toMatchObject({ kind: 'notice', text: expect.stringMatching(/^Stopped/) })
    expect(review?.added).toEqual({ parts: 2, wires: 0 })
    circuit.undo()
    expect(circuit.getSnapshot()).toEqual(before)
  })

  it('answers Claude’s question from the chat', async () => {
    store.newConversation()
    replay([
      {
        blocks: [
          toolUse('q1', 'ask_user', {
            question: 'Divider or level shifter?',
            options: ['Divider', 'Shifter']
          })
        ],
        stop: 'tool_use'
      },
      { blocks: [text('A divider it is.')], stop: 'end_turn' }
    ])
    const turn = store.send('protect ECHO')
    await vi.waitUntil(
      () => store.useAssistant.getState().items.some((i) => i.kind === 'question'),
      { timeout: 5000 }
    )
    await store.send('Divider')
    await turn
    const question = store.useAssistant.getState().items.find((i) => i.kind === 'question')
    expect(question).toMatchObject({ answer: 'Divider' })
    const result = store.useAssistant
      .getState()
      .items.find((i) => i.kind === 'tool' && i.id === 'q1')
    expect(result).toMatchObject({ status: 'done', result: '{"answer":"Divider"}' })
  })

  it('refuses to send what looks like an API key', async () => {
    store.newConversation()
    const served = replay([])
    await store.send('my key is sk-ant-api03-abcdefgh')
    expect(served.requests).toHaveLength(0)
    expect(store.useAssistant.getState().items).toEqual([
      expect.objectContaining({
        kind: 'notice',
        text: expect.stringMatching(/looks like an API key/)
      })
    ])
  })
})
