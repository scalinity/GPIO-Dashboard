// The connectivity engine's typed diffs and its 1 ms budget (SPEC 8, 18).
import { describe, expect, it } from 'vitest'
import type { CircuitDoc } from '../model/types'
import { applyOps } from '../ops/apply'
import { at, emptyDoc, fixtureDefs, hole, part, wire } from '../testing/fixtures'
import { computeState, ConnectivityEngine, diffStates, type ConnectivityEvent } from './engine'

const types = (events: ConnectivityEvent[]) => events.map((e) => e.type)
const diff = (a: CircuitDoc, b: CircuitDoc) =>
  diffStates(computeState(a, fixtureDefs), computeState(b, fixtureDefs))

describe('connectivity diffs', () => {
  it('reports a lead plugged in: two holes occupied, a strip joining GPIO17, the lead routed', () => {
    const before = emptyDoc()
    const after = applyOps(before, [
      { type: 'AddWire', wire: wire('W1', at(6, 'a'), at(30, 'a')) }
    ]).doc
    const events = diff(before, after)
    expect(types(events)).toEqual(['HoleOccupied', 'HoleOccupied', 'StripJoined', 'LeadRouted'])
    expect(events).toContainEqual({ type: 'StripJoined', strip: 'bb1:30a-e', net: 'GPIO17' })
  })

  it('reports a part placed, and the hole-exact occupancy of each pin', () => {
    const before = emptyDoc()
    const after = applyOps(before, [
      { type: 'AddPart', part: part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: hole(33, 'a') }) }
    ]).doc
    const events = diff(before, after)
    expect(events).toContainEqual({ type: 'PartPlaced', part: 'R1' })
    expect(events).toContainEqual({
      type: 'HoleOccupied',
      hole: hole(33, 'a'),
      occupant: { kind: 'part', part: 'R1', pin: '2' }
    })
  })

  it('reports a merge when a lead joins two nets, and a split when it is pulled', () => {
    const base = emptyDoc()
    base.parts.push(part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: hole(33, 'a') }))
    const joined = applyOps(base, [
      { type: 'AddWire', wire: wire('W1', at(6, 'a'), at(30, 'b')) }
    ]).doc
    expect(diff(base, joined)).toContainEqual({
      type: 'NetsMerged',
      from: ['GPIO17', 'N1'],
      into: 'GPIO17'
    })
    const pulled = applyOps(joined, [{ type: 'RemoveWire', id: 'W1' }]).doc
    expect(diff(joined, pulled)).toContainEqual({
      type: 'NetSplit',
      from: 'GPIO17',
      into: ['GPIO17', 'N1']
    })
  })

  it('mirrors every commit on undo', () => {
    const before = emptyDoc()
    const { doc: after, inverse } = applyOps(before, [
      { type: 'AddWire', wire: wire('W1', at(6, 'a'), at(30, 'a')) },
      { type: 'AddPart', part: part('D1', 'test-led', { A: hole(30, 'c'), K: hole(31, 'c') }) }
    ])
    const forward = diff(before, after)
    const back = diff(after, applyOps(after, inverse).doc)
    const swap: Record<string, string> = {
      HoleOccupied: 'HoleVacated',
      HoleVacated: 'HoleOccupied'
    }
    const holes = (events: ConnectivityEvent[], flip = false) =>
      events
        .filter((e) => e.type === 'HoleOccupied' || e.type === 'HoleVacated')
        .map(
          (e) => `${flip ? swap[e.type] : e.type}:${JSON.stringify((e as { hole: unknown }).hole)}`
        )
        .sort()
    expect(holes(back, true)).toEqual(holes(forward))
  })

  it('sends provisional events for a ghost and returns to the committed state when it clears', () => {
    const doc = emptyDoc()
    const engine = new ConnectivityEngine(doc, fixtureDefs)
    const seen: boolean[] = []
    engine.subscribe((d) => seen.push(d.provisional))
    const ghost = applyOps(doc, [
      { type: 'AddWire', wire: wire('W1', at(6, 'a'), at(30, 'a')) }
    ]).doc
    expect(types(engine.preview(ghost))).toContain('StripJoined')
    expect(engine.state.netlist.netOfStrip.get('bb1:30a-e')).toBe('GPIO17')
    expect(types(engine.clearPreview())).toContain('HoleVacated')
    expect(engine.state.netlist.netOfStrip.has('bb1:30a-e')).toBe(false)
    expect(seen).toEqual([true, true])
  })

  it('stays silent when nothing connective changes', () => {
    const doc = emptyDoc()
    const renamed = applyOps(doc, [{ type: 'SetMeta', meta: { name: 'Other' } }]).doc
    expect(diff(doc, renamed)).toEqual([])
  })
})

describe('connectivity budget (SPEC 8: at most 1 ms per diff on a full bb-830 scene)', () => {
  // T-board on rows 1-20, a resistor in every free row and a lead from each to a GPIO strip.
  const full = emptyDoc()
  for (let row = 24; row <= 63; row++) {
    full.parts.push(part(`R${row}`, 'test-resistor', { 1: hole(row, 'a'), 2: hole(row, 'j') }))
    full.wires.push(wire(`W${row}`, at(row, 'b'), at(1 + ((row - 24) % 20), row % 2 ? 'a' : 'j')))
  }

  it('recomputes and diffs a net-splitting removal in under a millisecond (median of warm runs)', () => {
    const engine = new ConnectivityEngine(full, fixtureDefs)
    const removed = applyOps(full, [{ type: 'RemoveWire', id: 'W40' }]).doc
    const times: number[] = []
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now()
      engine.commit(i % 2 ? full : removed)
      times.push(performance.now() - t0)
    }
    const warm = times.slice(20).sort((a, b) => a - b)
    const median = warm[Math.floor(warm.length / 2)]!
    expect(engine.state.doc.parts).toHaveLength(40)
    expect(median).toBeLessThan(1)
  })
})
