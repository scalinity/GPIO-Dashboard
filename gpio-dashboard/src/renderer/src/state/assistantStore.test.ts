// The assistant's tests run on an in-memory stand-in for the circuit store, because assistant/ may
// not import state/ (SPEC 4.5). This test, outside assistant/, runs the same scripted build on
// the real CircuitStore and checks the two agree, and that undoTurn restores the document.
import { describe, expect, it } from 'vitest'
import { AssistantSession } from '../assistant/loop'
import { FakeContext, MemoryStore } from '../assistant/testing/fakeContext'
import { BLINK_SCRIPT } from '../assistant/testing/blinkScript'
import { scriptedFetch, testClient } from '../assistant/testing/sse'
import type { AssistantContext } from '../assistant/context'
import { partDef } from '../core/defs/parts'
import { erc } from '../core/erc/erc'
import { newDoc } from '../core/model/defaults'
import type { CircuitDoc } from '../core/model/types'
import { CircuitStore } from './circuitStore'

const initial = () => newDoc('Test', '2026-10-24T00:00:00.000Z')

async function build(store: CircuitStore | MemoryStore) {
  const ctx = new FakeContext({ store })
  const served = scriptedFetch(BLINK_SCRIPT, 31)
  const session = new AssistantSession({ client: testClient(served.fetch), ctx })
  const result = await session.runTurn('blink an LED on GPIO17')
  return { ctx, result }
}

const withoutClock = (doc: CircuitDoc): CircuitDoc => ({
  ...doc,
  meta: { ...doc.meta, updated: '' }
})

describe('the assistant on the real circuit store', () => {
  it('has a store that satisfies the AssistantContext members it needs', () => {
    const store = new CircuitStore(initial())
    const members: Pick<AssistantContext, 'getSnapshot' | 'dispatch' | 'check' | 'undoTurn'> = store
    expect(typeof members.dispatch).toBe('function')
  })

  it('builds the same circuit as the in-memory store, ERC-clean', async () => {
    const real = new CircuitStore(initial())
    const { ctx, result } = await build(real)
    const memory = await build(new MemoryStore(initial()))
    expect(result.reason).toBe('end_turn')
    expect(withoutClock(ctx.getSnapshot())).toEqual(withoutClock(memory.ctx.getSnapshot()))
    expect(erc(real.getSnapshot(), partDef).filter((i) => i.severity !== 'info')).toEqual([])
    expect(result.transactions).toHaveLength(6)
  })

  it('undoes the whole turn as one group, to a deep-equal empty document', async () => {
    const real = new CircuitStore(initial())
    const { result } = await build(real)
    expect(real.getSnapshot().parts).toHaveLength(2)
    expect(real.undoTurn(result.turnId)).toBe(6)
    expect(real.getSnapshot()).toEqual(initial())
    expect(real.canUndo).toBe(false)
  })

  it('keeps the connectivity engine in step, so the UI sees the build', async () => {
    const real = new CircuitStore(initial())
    const events: string[] = []
    real.engine.subscribe((diff) => events.push(...diff.events.map((e) => e.type)))
    await build(real)
    expect(events).toContain('PartPlaced')
    expect(events).toContain('LeadRouted')
    expect(real.engine.state.netlist.netOfPin.get('R1.1')).toBe('GPIO17')
  })
})
