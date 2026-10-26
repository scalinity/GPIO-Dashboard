// The single writer: validated transactions, exact undo, and nothing else mutates (SPEC 4.5).
import { describe, expect, it } from 'vitest'
import { at, CUSTOM_RES, emptyDoc, fixtureDefs, hole, part, wire } from '../core/testing/fixtures'
import { CircuitStore } from './circuitStore'

let tick = 0
const store = () =>
  new CircuitStore(emptyDoc(), fixtureDefs, () => `2026-10-24T00:00:0${tick++}.000Z`)

describe('CircuitStore', () => {
  it('commits a valid transaction, bumping the revision and notifying once', () => {
    const s = store()
    let notified = 0
    s.subscribe(() => notified++)
    const result = s.dispatch({
      author: 'user',
      label: 'Add a lead',
      ops: [{ type: 'AddWire', wire: wire('W1', at(6, 'a'), at(30, 'a')) }]
    })
    expect(result.ok).toBe(true)
    expect(s.getSnapshot().meta.revision).toBe(1)
    expect(s.getSnapshot().wires).toHaveLength(1)
    expect(notified).toBe(1)
  })

  it('refuses moving a board into the Pi, in a check as in a commit', () => {
    const s = store()
    const input = {
      author: 'user' as const,
      label: 'Move bb1',
      ops: [
        {
          type: 'MoveBoard' as const,
          id: 'bb1',
          transform: { position: [-60, 0] as const, rotationDeg: 0 }
        }
      ]
    }
    const checked = s.check(input)
    expect(!checked.ok && checked.problems.map((p) => p.code)).toEqual(['OVERLAP'])
    const result = s.dispatch(input)
    expect(!result.ok && result.problems.map((p) => p.message)).toEqual([
      "bb1 can't overlap the Pi"
    ])
    expect(s.getSnapshot().boards[0]!.transform.position).toEqual([0, 0])
  })

  it('rejects an invalid transaction and leaves the very same document in place', () => {
    const s = store()
    const before = s.getSnapshot()
    let notified = 0
    s.subscribe(() => notified++)
    const result = s.dispatch({
      author: 'assistant',
      label: 'Bad lead',
      ops: [
        { type: 'AddWire', wire: wire('W1', at(30, 'a'), at(31, 'a')) },
        { type: 'AddWire', wire: wire('W2', at(6, 'e'), at(32, 'a')) } // under the T-board
      ]
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.problems.map((p) => p.code)).toEqual(['HOLE_BLOCKED'])
    expect(s.getSnapshot()).toBe(before)
    expect(notified).toBe(0)
    expect(s.canUndo).toBe(false)
  })

  it('reports an op on a missing item as a rejected transaction, not a crash', () => {
    const result = store().dispatch({
      author: 'user',
      label: 'x',
      ops: [{ type: 'RemoveWire', id: 'nope' }]
    })
    expect(result.ok).toBe(false)
  })

  it('undoes and redoes to strictly equal documents, meta included', () => {
    const s = store()
    const original = s.getSnapshot()
    s.dispatch({
      author: 'user',
      label: 'Resistor',
      ops: [
        {
          type: 'AddPart',
          part: part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: hole(33, 'a') })
        }
      ]
    })
    const after = s.getSnapshot()
    s.undo()
    expect(s.getSnapshot()).toStrictEqual(original)
    s.redo()
    expect(s.getSnapshot()).toStrictEqual(after)
  })

  it('undoes a whole assistant turn back to a deep-equal document (SPEC 12.8)', () => {
    const s = store()
    s.dispatch({
      author: 'user',
      label: 'Mine',
      ops: [{ type: 'AddWire', wire: wire('W0', at(40, 'a'), at(41, 'a')) }]
    })
    const beforeTurn = s.getSnapshot()
    for (let i = 1; i <= 3; i++) {
      s.dispatch({
        author: 'assistant',
        label: `Step ${i}`,
        assistantTurnId: 'turn-1',
        ops: [{ type: 'AddWire', wire: wire(`W${i}`, at(30 + i, 'a'), at(50 + i, 'a')) }]
      })
    }
    expect(s.undoTurn('turn-1')).toBe(3)
    expect(s.getSnapshot()).toStrictEqual(beforeTurn)
    expect(s.canUndo).toBe(true) // the user's own edit is still there to undo
  })

  it.each([
    ['no customParts field', emptyDoc()],
    ['an empty customParts list', { ...emptyDoc(), customParts: [] }]
  ])('undoes an assistant turn that defines a custom part back to %s (acceptance 7)', (_, doc) => {
    const s = new CircuitStore(doc, fixtureDefs, () => `2026-10-24T00:00:0${tick++}.000Z`)
    const beforeTurn = s.getSnapshot()
    s.dispatch({
      author: 'assistant',
      label: 'Define a part',
      assistantTurnId: 'turn-1',
      ops: [{ type: 'AddCustomPart', def: CUSTOM_RES }]
    })
    const afterTurn = s.getSnapshot()
    expect(afterTurn.customParts).toEqual([CUSTOM_RES])
    expect(s.undoTurn('turn-1')).toBe(1)
    expect(s.getSnapshot()).toStrictEqual(beforeTurn)
    s.redo()
    expect(s.getSnapshot()).toStrictEqual(afterTurn)
  })

  it('keeps the connectivity engine in step with every change', () => {
    const s = store()
    s.dispatch({
      author: 'user',
      label: 'Lead',
      ops: [{ type: 'AddWire', wire: wire('W1', at(6, 'a'), at(30, 'a')) }]
    })
    expect(s.engine.state.netlist.netOfStrip.get('bb1:30a-e')).toBe('GPIO17')
    s.undo()
    expect(s.engine.state.netlist.netOfStrip.has('bb1:30a-e')).toBe(false)
    expect(s.changeCount).toBe(2)
  })

  it('opens another document only if it is valid, starting history afresh', () => {
    const s = store()
    const bad = emptyDoc()
    bad.wires.push(wire('W1', at(6, 'd'), at(30, 'a')))
    expect(s.open(bad).ok).toBe(false)
    const good = emptyDoc()
    good.meta.name = 'Opened'
    expect(s.open(good).ok).toBe(true)
    expect(s.getSnapshot().meta.name).toBe('Opened')
    expect(s.canUndo).toBe(false)
  })

  const turn = (s: CircuitStore, id: string, rows: number[]) => {
    for (const row of rows)
      s.dispatch({
        author: 'assistant',
        label: `Lead at ${row}`,
        assistantTurnId: id,
        ops: [{ type: 'AddWire', wire: wire(`W${row}`, at(row, 'a'), at(row + 20, 'a')) }]
      })
  }

  it('undoes and redoes an assistant turn as one group, in one change', () => {
    const s = store()
    s.dispatch({
      author: 'user',
      label: 'Mine',
      ops: [{ type: 'AddWire', wire: wire('W0', at(40, 'a'), at(41, 'a')) }]
    })
    const mine = s.getSnapshot()
    turn(s, 'turn-1', [30, 31, 32])
    const built = s.getSnapshot()
    let notified = 0
    s.subscribe(() => notified++)
    expect(s.lastTurnId).toBe('turn-1')
    expect(s.undo()?.label).toBe('Lead at 30')
    expect(s.getSnapshot()).toStrictEqual(mine)
    expect(notified).toBe(1)
    expect(s.redo()?.label).toBe('Lead at 32')
    expect(s.getSnapshot()).toStrictEqual(built)
    expect(notified).toBe(2)
    s.undo()
    s.undo()
    expect(s.getSnapshot().wires).toEqual([])
  })

  it('keeps two turns as two groups', () => {
    const s = store()
    turn(s, 'turn-1', [30])
    const first = s.getSnapshot()
    turn(s, 'turn-2', [31, 32])
    s.undo()
    expect(s.getSnapshot()).toStrictEqual(first)
    expect(s.lastTurnId).toBe('turn-1')
  })

  it('undoes a turn only while it is the latest change', () => {
    const s = store()
    turn(s, 'turn-1', [30, 31])
    s.dispatch({
      author: 'user',
      label: 'After',
      ops: [{ type: 'AddWire', wire: wire('W9', at(40, 'a'), at(41, 'a')) }]
    })
    const after = s.getSnapshot()
    expect(s.undoTurn('turn-1')).toBe(0)
    expect(s.getSnapshot()).toBe(after)
  })

  it('while locked to a turn, commits only that turn and refuses every other change', () => {
    const s = store()
    s.dispatch({
      author: 'user',
      label: 'Mine',
      ops: [{ type: 'AddWire', wire: wire('W0', at(40, 'a'), at(41, 'a')) }]
    })
    s.lock('turn-1')
    expect(s.locked).toBe(true)
    turn(s, 'turn-1', [30])
    const during = s.getSnapshot()
    const user = s.dispatch({
      author: 'user',
      label: 'By hand',
      ops: [{ type: 'AddWire', wire: wire('W8', at(55, 'a'), at(56, 'a')) }]
    })
    expect(!user.ok && user.problems[0]!.code).toBe('LOCKED')
    turn(s, 'turn-2', [33])
    expect(s.undo()).toBeNull()
    expect(s.redo()).toBeNull()
    expect(s.open(emptyDoc()).ok).toBe(false)
    expect(s.undoTurn('turn-2')).toBe(0)
    expect(s.getSnapshot()).toBe(during)
    s.unlock()
    expect(s.undoTurn('turn-1')).toBe(1)
    expect(s.getSnapshot().wires.map((w) => w.id)).toEqual(['W0'])
  })
})
