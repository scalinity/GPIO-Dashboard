// The single writer: validated transactions, exact undo, and nothing else mutates (SPEC 4.5).
import { describe, expect, it } from 'vitest'
import { at, emptyDoc, fixtureDefs, hole, part, wire } from '../core/testing/fixtures'
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
})
