// The connectivity engine (SPEC 8): the live state of every hole, strip and net, and a typed
// diff for every change. Consumers subscribe to the diffs instead of re-reading the document.
import type { CircuitDoc, HoleRef } from '../model/types'
import {
  netlist,
  type Netlist,
  type NetMember,
  occupancy,
  occupantKey,
  type Occupant,
  type PartDefs
} from './netlist'

export interface ConnectivityState {
  doc: CircuitDoc
  occupancy: Map<string, { hole: HoleRef; occupant: Occupant }>
  netlist: Netlist
}

export type ConnectivityEvent =
  | { type: 'HoleOccupied'; hole: HoleRef; occupant: Occupant }
  | { type: 'HoleVacated'; hole: HoleRef; occupant: Occupant }
  | { type: 'StripJoined'; strip: string; net: string | null }
  | { type: 'NetsMerged'; from: string[]; into: string }
  | { type: 'NetSplit'; from: string; into: string[] }
  | { type: 'PartPlaced'; part: string }
  | { type: 'LeadRouted'; wire: string }

export interface ConnectivityDiff {
  /** Ghost previews produce provisional diffs; commits produce final ones. */
  provisional: boolean
  events: ConnectivityEvent[]
}

export function computeState(doc: CircuitDoc, defs: PartDefs): ConnectivityState {
  return { doc, occupancy: occupancy(doc).holes, netlist: netlist(doc, defs) }
}

const memberKey = (m: NetMember) =>
  m.kind === 'header'
    ? `h${m.pin}`
    : m.kind === 'part'
      ? `p${m.part}.${m.pin}`
      : `w${m.wire}.${m.end}`

function netOfMember(state: ConnectivityState): Map<string, string> {
  const map = new Map<string, string>()
  for (const net of state.netlist.nets) for (const m of net.members) map.set(memberKey(m), net.name)
  return map
}

export function diffStates(prev: ConnectivityState, next: ConnectivityState): ConnectivityEvent[] {
  const events: ConnectivityEvent[] = []

  for (const [key, { hole, occupant }] of prev.occupancy) {
    const now = next.occupancy.get(key)
    if (!now || occupantKey(now.occupant) !== occupantKey(occupant))
      events.push({ type: 'HoleVacated', hole, occupant })
  }
  for (const [key, { hole, occupant }] of next.occupancy) {
    const before = prev.occupancy.get(key)
    if (!before || occupantKey(before.occupant) !== occupantKey(occupant))
      events.push({ type: 'HoleOccupied', hole, occupant })
  }

  const strips = new Set([...prev.netlist.netOfStrip.keys(), ...next.netlist.netOfStrip.keys()])
  for (const strip of [...strips].sort()) {
    const before = prev.netlist.netOfStrip.get(strip) ?? null
    const after = next.netlist.netOfStrip.get(strip) ?? null
    if (before !== after) events.push({ type: 'StripJoined', strip, net: after })
  }

  // Merges and splits, judged on members present in both states, so renames don't count.
  const prevNet = netOfMember(prev)
  const nextNet = netOfMember(next)
  const sourcesOf = new Map<string, Set<string>>()
  const targetsOf = new Map<string, Set<string>>()
  for (const [member, after] of nextNet) {
    const before = prevNet.get(member)
    if (before === undefined) continue
    sourcesOf.set(after, (sourcesOf.get(after) ?? new Set()).add(before))
    targetsOf.set(before, (targetsOf.get(before) ?? new Set()).add(after))
  }
  for (const [into, from] of sourcesOf) {
    if (from.size > 1) events.push({ type: 'NetsMerged', from: [...from].sort(), into })
  }
  for (const [from, into] of targetsOf) {
    if (into.size > 1) events.push({ type: 'NetSplit', from, into: [...into].sort() })
  }

  const placement = (doc: CircuitDoc) =>
    new Map(doc.parts.map((p) => [p.id, JSON.stringify(p.placement)]))
  const prevParts = placement(prev.doc)
  for (const [id, now] of placement(next.doc)) {
    if (prevParts.get(id) !== now) events.push({ type: 'PartPlaced', part: id })
  }
  const ends = (doc: CircuitDoc) =>
    new Map(doc.wires.map((w) => [w.id, JSON.stringify([w.a, w.b])]))
  const prevWires = ends(prev.doc)
  for (const [id, now] of ends(next.doc)) {
    if (prevWires.get(id) !== now) events.push({ type: 'LeadRouted', wire: id })
  }
  return events
}

type Listener = (diff: ConnectivityDiff, state: ConnectivityState) => void

/** Holds the committed state and an optional preview over it, and notifies on every change. */
export class ConnectivityEngine {
  private committed: ConnectivityState
  private previewed: ConnectivityState | null = null
  private listeners = new Set<Listener>()

  constructor(
    doc: CircuitDoc,
    private readonly defs: PartDefs
  ) {
    this.committed = computeState(doc, defs)
  }

  get state(): ConnectivityState {
    return this.previewed ?? this.committed
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** A committed transaction, undo or redo: final events against the committed state. */
  commit(doc: CircuitDoc): ConnectivityEvent[] {
    const next = computeState(doc, this.defs)
    const events = diffStates(this.previewed ?? this.committed, next)
    this.committed = next
    this.previewed = null
    this.emit({ provisional: false, events }, next)
    return events
  }

  /** A ghost: provisional events, against whatever is shown now. */
  preview(doc: CircuitDoc): ConnectivityEvent[] {
    const next = computeState(doc, this.defs)
    const events = diffStates(this.state, next)
    this.previewed = next
    this.emit({ provisional: true, events }, next)
    return events
  }

  /** Drops a preview (rejected or aborted), returning to the committed state. */
  clearPreview(): ConnectivityEvent[] {
    if (!this.previewed) return []
    const events = diffStates(this.previewed, this.committed)
    this.previewed = null
    this.emit({ provisional: true, events }, this.committed)
    return events
  }

  private emit(diff: ConnectivityDiff, state: ConnectivityState) {
    if (diff.events.length === 0) return
    for (const listener of this.listeners) listener(diff, state)
  }
}
