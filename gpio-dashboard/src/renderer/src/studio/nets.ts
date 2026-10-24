// A net on the bench (SPEC 11.5): the markers that show it (every hole of its strips, every lead end
// on it) and the place its tag stands. The same geometry and netlist the hover uses (picking.ts).
import type { Color, Vector3 } from 'three/webgpu'
import { boardDef } from '../core/defs/boards'
import { boardHoles, stripKey } from '../core/geometry/breadboard'
import type { CircuitDoc, HoleRef } from '../core/model/types'
import type { Net } from '../core/netlist/netlist'
import { endpointInScene, holeInScene, modulePinInScene } from './coords'
import type { Marker } from './markers'

/** Every board's holes by the strip (or whole rail) they belong to. */
export function stripIndex(doc: CircuitDoc): Map<string, HoleRef[]> {
  const index = new Map<string, HoleRef[]>()
  for (const board of doc.boards) {
    const def = boardDef(board.defId)
    for (const hole of boardHoles(def, board.id)) {
      const key = stripKey(def, hole)
      index.set(key, [...(index.get(key) ?? []), hole])
    }
  }
  return index
}

/** Markers over a net's strips, and over its lead ends where `ends` is given. */
export function netMarkers(
  doc: CircuitDoc,
  index: Map<string, HoleRef[]>,
  net: Net,
  strips: { size: number; color: Color },
  ends?: { size: number; color: Color }
): Marker[] {
  const markers: Marker[] = []
  for (const key of net.strips)
    for (const hole of index.get(key) ?? []) {
      const at = endpointInScene(doc, { hole })
      if (at) markers.push({ at: at.at, turn: at.turn, ...strips })
    }
  if (ends)
    for (const m of net.members) {
      if (m.kind !== 'wire') continue
      const wire = doc.wires.find((w) => w.id === m.wire)
      const at = wire && endpointInScene(doc, m.end === 'a' ? wire.a : wire.b)
      if (at) markers.push({ at: at.at, turn: at.turn, ...ends })
    }
  return markers
}

/**
 * Where a net's tag stands: at the first part pin on it, else the first lead end, else the first
 * hole of its first strip; null for a net that is only the header.
 */
export function netAnchor(
  doc: CircuitDoc,
  index: Map<string, HoleRef[]>,
  net: Net
): Vector3 | null {
  for (const m of net.members) {
    if (m.kind !== 'part') continue
    const part = doc.parts.find((p) => p.id === m.part)
    const hole = part?.placement.pins[m.pin]
    const board = hole && doc.boards.find((b) => b.id === hole.board)
    const at = board ? holeInScene(board, hole) : part && modulePinInScene(part, m.pin)
    if (at) return at
  }
  for (const m of net.members) {
    if (m.kind !== 'wire') continue
    const wire = doc.wires.find((w) => w.id === m.wire)
    const at = wire && endpointInScene(doc, m.end === 'a' ? wire.a : wire.b)
    if (at) return at.at
  }
  const hole = net.strips.map((key) => index.get(key)?.[2]).find(Boolean)
  const board = hole && doc.boards.find((b) => b.id === hole.board)
  return board && hole ? holeInScene(board, hole) : null
}
