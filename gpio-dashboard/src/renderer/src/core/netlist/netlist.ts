// Occupancy and nets of a circuit document (SPEC 5, 8). Pure and deterministic.
import { boardDef } from '../defs/boards'
import { headerNetName } from '../defs/controllers'
import { holeKey, stripKey } from '../geometry/breadboard'
import { tboardPinHole } from '../geometry/tboard'
import type { CircuitDoc, Endpoint, HoleRef, PartDef } from '../model/types'

export type PartDefs = (id: string) => PartDef

/** What sits in a hole. */
export type Occupant =
  | { kind: 'tboard'; pin: number }
  | { kind: 'part'; part: string; pin: string }
  | { kind: 'wire'; wire: string; end: 'a' | 'b' }

export function occupantKey(o: Occupant): string {
  if (o.kind === 'tboard') return `tboard.${o.pin}`
  if (o.kind === 'part') return `part:${o.part}.${o.pin}`
  return `wire:${o.wire}.${o.end}`
}

export interface Occupancy {
  /** Hole key → the one occupant. */
  holes: Map<string, { hole: HoleRef; occupant: Occupant }>
  /** Holes claimed by more than one lead; a valid document has none (SPEC 6.6). */
  conflicts: { hole: HoleRef; occupants: Occupant[] }[]
}

/** Every lead in a hole: T-board pins, placed part pins and wire ends. */
export function occupancy(doc: CircuitDoc): Occupancy {
  const holes = new Map<string, { hole: HoleRef; occupant: Occupant }>()
  const clashes = new Map<string, { hole: HoleRef; occupants: Occupant[] }>()
  const put = (hole: HoleRef, occupant: Occupant) => {
    const key = holeKey(hole)
    const existing = holes.get(key)
    if (!existing) {
      holes.set(key, { hole, occupant })
      return
    }
    const clash = clashes.get(key) ?? { hole, occupants: [existing.occupant] }
    clash.occupants.push(occupant)
    clashes.set(key, clash)
  }
  for (let pin = 1; pin <= 40; pin++)
    put(tboardPinHole(doc.controller.tboard, pin), { kind: 'tboard', pin })
  for (const part of doc.parts) {
    for (const [pin, hole] of Object.entries(part.placement.pins)) {
      if (hole) put(hole, { kind: 'part', part: part.id, pin })
    }
  }
  for (const wire of doc.wires) {
    if ('hole' in wire.a) put(wire.a.hole, { kind: 'wire', wire: wire.id, end: 'a' })
    if ('hole' in wire.b) put(wire.b.hole, { kind: 'wire', wire: wire.id, end: 'b' })
  }
  return { holes, conflicts: [...clashes.values()] }
}

/** A thing that belongs to a net. */
export type NetMember =
  | { kind: 'header'; pin: number }
  | { kind: 'part'; part: string; pin: string }
  | { kind: 'wire'; wire: string; end: 'a' | 'b' }

export interface Net {
  name: string
  members: NetMember[]
  /** Strips (and rails) the net runs through. */
  strips: string[]
  /** Pi header pins on this net (through the T-board and ribbon). */
  headerPins: number[]
  /** Named nets that were joined: more than one name means a short (e.g. GPIO17 and GND). */
  names: string[]
}

export interface Netlist {
  nets: Net[]
  byName: Map<string, Net>
  netOfStrip: Map<string, string>
  /** "R1.1" → net name. */
  netOfPin: Map<string, string>
  netOfHeaderPin: Map<number, string>
}

class UnionFind {
  private parent = new Map<string, string>()
  add(x: string) {
    if (!this.parent.has(x)) this.parent.set(x, x)
  }
  find(x: string): string {
    this.add(x)
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    let node = x
    while (node !== root) {
      const next = this.parent.get(node)!
      this.parent.set(node, root)
      node = next
    }
    return root
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb)
  }
  nodes(): string[] {
    return [...this.parent.keys()]
  }
}

const NAMED_ORDER = ['GND', '3V3', '5V']

function preferredName(names: string[]): string {
  const sorted = [...names].sort((a, b) => {
    const ia = NAMED_ORDER.indexOf(a)
    const ib = NAMED_ORDER.indexOf(b)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    return Number(a.slice(4)) - Number(b.slice(4))
  })
  return sorted[0]!
}

/** Union-find over strips, the header, part pins and wires (SPEC 8). */
export function netlist(doc: CircuitDoc, defs: PartDefs): Netlist {
  const uf = new UnionFind()
  const boards = new Map(doc.boards.map((b) => [b.id, b]))
  const strip = (hole: HoleRef) => {
    const board = boards.get(hole.board)
    if (!board) throw new Error(`Hole on unknown board ${hole.board}`)
    return `strip:${stripKey(boardDef(board.defId), hole)}`
  }
  const endpointNode = (end: Endpoint) =>
    'hole' in end ? strip(end.hole) : `pin:${end.pin.part}.${end.pin.pin}`

  // (e) T-board pin n ↔ Pi header pin n through the straight-through ribbon; shared supplies.
  const supply = new Map<string, number>()
  for (let pin = 1; pin <= 40; pin++) {
    uf.union(`hdr:${pin}`, strip(tboardPinHole(doc.controller.tboard, pin)))
    const name = headerNetName(pin)
    if (!name.startsWith('GPIO')) {
      const first = supply.get(name)
      if (first === undefined) supply.set(name, pin)
      else uf.union(`hdr:${first}`, `hdr:${pin}`)
    }
  }
  // (a, b) parts in holes join their strip; (d) internal connections.
  for (const part of doc.parts) {
    const def = defs(part.defId)
    for (const pin of def.pins) {
      const node = `pin:${part.id}.${pin.id}`
      uf.add(node)
      const hole = part.placement.pins[pin.id]
      if (hole) uf.union(node, strip(hole))
    }
    for (const group of def.internalConnections) {
      for (const pin of group.slice(1))
        uf.union(`pin:${part.id}.${group[0]}`, `pin:${part.id}.${pin}`)
    }
  }
  // (c) wires join their two ends.
  for (const wire of doc.wires) {
    uf.add(`wire:${wire.id}.a`)
    uf.add(`wire:${wire.id}.b`)
    uf.union(`wire:${wire.id}.a`, `wire:${wire.id}.b`)
    uf.union(`wire:${wire.id}.a`, endpointNode(wire.a))
    uf.union(`wire:${wire.id}.b`, endpointNode(wire.b))
  }

  const groups = new Map<string, string[]>()
  for (const node of uf.nodes()) {
    const root = uf.find(node)
    groups.set(root, [...(groups.get(root) ?? []), node])
  }

  const built: Net[] = []
  for (const nodes of groups.values()) {
    const members: NetMember[] = []
    const strips: string[] = []
    const headerPins: number[] = []
    for (const node of nodes.sort()) {
      const [kind, rest] = [node.slice(0, node.indexOf(':')), node.slice(node.indexOf(':') + 1)]
      if (kind === 'strip') strips.push(rest)
      else if (kind === 'hdr') {
        headerPins.push(Number(rest))
        members.push({ kind: 'header', pin: Number(rest) })
      } else if (kind === 'pin') {
        const dot = rest.lastIndexOf('.')
        members.push({ kind: 'part', part: rest.slice(0, dot), pin: rest.slice(dot + 1) })
      } else {
        const dot = rest.lastIndexOf('.')
        members.push({
          kind: 'wire',
          wire: rest.slice(0, dot),
          end: rest.slice(dot + 1) as 'a' | 'b'
        })
      }
    }
    // A strip with nothing in it is not a net.
    if (members.length === 0) continue
    headerPins.sort((a, b) => a - b)
    const names = [...new Set(headerPins.map(headerNetName))]
    built.push({
      name: names.length ? preferredName(names) : '',
      members,
      strips,
      headerPins,
      names
    })
  }

  // Unnamed nets are numbered in a stable order: by their smallest member.
  const memberKey = (m: NetMember) =>
    m.kind === 'part'
      ? `1:${m.part}.${m.pin}`
      : m.kind === 'wire'
        ? `2:${m.wire}.${m.end}`
        : `0:${m.pin}`
  const unnamed = built
    .filter((n) => !n.name)
    .sort((a, b) => (memberKey(a.members[0]!) < memberKey(b.members[0]!) ? -1 : 1))
  unnamed.forEach((n, i) => (n.name = `N${i + 1}`))

  const nets = built.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  const byName = new Map(nets.map((n) => [n.name, n]))
  const netOfStrip = new Map<string, string>()
  const netOfPin = new Map<string, string>()
  const netOfHeaderPin = new Map<number, string>()
  for (const net of nets) {
    for (const s of net.strips) netOfStrip.set(s, net.name)
    for (const m of net.members) {
      if (m.kind === 'part') netOfPin.set(`${m.part}.${m.pin}`, net.name)
      if (m.kind === 'header') netOfHeaderPin.set(m.pin, net.name)
    }
  }
  return { nets, byName, netOfStrip, netOfPin, netOfHeaderPin }
}
