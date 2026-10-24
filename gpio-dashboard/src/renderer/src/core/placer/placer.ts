// Where things go when nobody names a hole (SPEC 6.5, 6.6, 12.5): the free holes of a document,
// the T-board strip that carries a net, a free spot for a part, and the lead that joins two ends.
// Pure and deterministic: the same document and request always give the same answer, and every
// result is a placement that validateDoc accepts.
import { boardDef } from '../defs/boards'
import { headerNetName, TBOARD } from '../defs/controllers'
import { columnPitches, holeKey, holePosition, isValidHole } from '../geometry/breadboard'
import { tboardBlockedHoles, tboardPinHole } from '../geometry/tboard'
import type {
  BoardInstance,
  CircuitDoc,
  Endpoint,
  HoleRef,
  MainColumn,
  PartDef,
  PartInstance,
  Transform2D,
  Vec2,
  Wire
} from '../model/types'
import { MAIN_COLUMNS } from '../model/types'
import { occupancy, type PartDefs } from '../netlist/netlist'
import { autoLength, exitPoint, leadReach, toTable } from '../reach/reach'

export type Rotation = 0 | 90 | 180 | 270
export type Placement = Pick<PartInstance['placement'], 'pins' | 'rotationDeg' | 'offboardPose'>

const PITCH_MM = 2.54
/** Pin 1's column when the placer picks one: the middle of a half leaves room for leads. */
const FLEX_COLUMNS: MainColumn[] = ['b', 'c', 'd', 'a', 'e', 'i', 'h', 'g', 'j', 'f']
const RIGID_COLUMNS: MainColumn[] = ['e', 'd', 'c', 'b', 'a', 'f', 'g', 'h', 'i', 'j']
/** The order leads take holes in a strip: the outer holes first, the ones near the trench last. */
const LEAD_ORDER_LOW: MainColumn[] = ['a', 'b', 'c', 'd', 'e']
const LEAD_ORDER_HIGH: MainColumn[] = ['j', 'i', 'h', 'g', 'f']

function boardOf(doc: CircuitDoc, id: string): BoardInstance | undefined {
  return doc.boards.find((b) => b.id === id)
}

/** The column `pitches` from column a, if a hole column is there (the trench has none). */
function columnAt(board: string, doc: CircuitDoc, pitches: number): MainColumn | undefined {
  const instance = boardOf(doc, board)
  if (!instance) return undefined
  const def = boardDef(instance.defId)
  return MAIN_COLUMNS.find((c) => columnPitches(def, c) === pitches)
}

/** A hole's position in the table frame, in mm. */
export function tablePosition(doc: CircuitDoc, hole: HoleRef): Vec2 {
  const board = boardOf(doc, hole.board)
  if (!board) throw new Error(`No board ${hole.board}`)
  return toTable(board.transform, holePosition(boardDef(board.defId), hole))
}

export interface Free {
  /** A real hole that nothing occupies and the T-board does not cover. */
  has(hole: HoleRef): boolean
  /** The hole holds a part pin, a T-board pin or a lead end. */
  occupied(hole: HoleRef): boolean
}

export function free(doc: CircuitDoc): Free {
  const taken = occupancy(doc).holes
  const tb = doc.controller.tboard
  const tbBoard = boardOf(doc, tb.board)
  const blocked = new Set(
    tbBoard ? tboardBlockedHoles(boardDef(tbBoard.defId), TBOARD, tb).map(holeKey) : []
  )
  return {
    has: (hole) => {
      const board = boardOf(doc, hole.board)
      return (
        !!board &&
        isValidHole(boardDef(board.defId), hole) &&
        !taken.has(holeKey(hole)) &&
        !blocked.has(holeKey(hole))
      )
    },
    occupied: (hole) => taken.has(holeKey(hole))
  }
}

/** Every hole of the strip `hole` belongs to: its half-row, or its whole rail. */
export function stripHoles(doc: CircuitDoc, hole: HoleRef): HoleRef[] {
  if (hole.area === 'main') {
    const low = MAIN_COLUMNS.indexOf(hole.col) < 5
    return (low ? LEAD_ORDER_LOW : LEAD_ORDER_HIGH).map((col) => ({
      board: hole.board,
      area: 'main',
      row: hole.row,
      col
    }))
  }
  const board = boardOf(doc, hole.board)
  const count = board ? boardDef(board.defId).rails.holesPerRail : 0
  return Array.from({ length: count }, (_, index) => ({
    board: hole.board,
    area: 'rail',
    rail: hole.rail,
    index
  }))
}

/** The free holes of `hole`'s strip, in the order leads should take them. */
export function freeInStrip(doc: CircuitDoc, hole: HoleRef, f: Free = free(doc)): HoleRef[] {
  return stripHoles(doc, hole).filter((h) => f.has(h))
}

export const NET_NAME = /^(GND|3V3|5V|GPIO\d{1,2})$/

/** The T-board pins (1-40) that sit on `net`. */
export function netPins(net: string): number[] {
  return Array.from({ length: 40 }, (_, i) => i + 1).filter((pin) => headerNetName(pin) === net)
}

const distance = ([ax, ay]: Vec2, [bx, by]: Vec2) => Math.hypot(ax - bx, ay - by)

/**
 * A free hole in a T-board strip that carries `net` (SPEC 6.5: a GPIO, 3V3, 5V or GND is reached
 * from its T-board pin's strip). Of several strips (GND has eight) the one nearest `near` wins.
 */
export function netHole(
  doc: CircuitDoc,
  net: string,
  near?: Vec2,
  f: Free = free(doc)
): HoleRef | null {
  const tb = doc.controller.tboard
  const options = netPins(net).flatMap((pin) => {
    const hole = freeInStrip(doc, tboardPinHole(tb, pin), f)[0]
    return hole ? [{ pin, hole }] : []
  })
  if (!options.length) return null
  if (!near) return options[0]!.hole
  const ranked = options
    .map((o) => ({ ...o, d: distance(tablePosition(doc, o.hole), near) }))
    .sort((a, b) => a.d - b.d || a.pin - b.pin)
  return ranked[0]!.hole
}

function rotate([x, y]: readonly [number, number], deg: Rotation): [number, number] {
  switch (deg) {
    case 90:
      return [-y, x]
    case 180:
      return [-x, -y]
    case 270:
      return [y, -x]
    default:
      return [x, y]
  }
}

/** Pitches between a flexible part's leads when the caller gives none: the body fits between. */
export function defaultSpan(def: PartDef): number {
  if (def.footprint.kind !== 'flex-2lead') return 0
  const { minSpan, maxSpan } = def.footprint
  return Math.min(maxSpan, Math.max(minSpan, Math.ceil(def.bodyMm[0] / PITCH_MM)))
}

const nullPins = (def: PartDef): Placement['pins'] =>
  Object.fromEntries(def.pins.map((p) => [p.id, null]))

/** Where an off-board module sits by default: beside the board's j side, in rows of three. */
function offboardPose(doc: CircuitDoc, defs: PartDefs, near?: HoleRef): Transform2D {
  const board =
    (near && boardOf(doc, near.board)) ?? boardOf(doc, doc.controller.tboard.board) ?? doc.boards[0]
  if (!board) return { position: [0, 0], rotationDeg: 0 }
  const def = boardDef(board.defId)
  const slot = doc.parts.filter((p) => defs(p.defId).footprint.kind === 'offboard').length
  const x = near?.area === 'main' ? holePosition(def, near)[0] : 20 + (slot % 3) * 55
  const y = def.body.widthMm + 25 + 30 * Math.floor(slot / 3)
  return { position: toTable(board.transform, [x, y]), rotationDeg: board.transform.rotationDeg }
}

/**
 * The pins of `def` anchored at `at`: pin 1 there, the others where the footprint puts them.
 * A flexible part's second lead sits `span` pitches away along `orientation`: 0 toward higher
 * rows, 180 toward lower rows, 90 and 270 across the columns.
 */
export function placementAt(
  doc: CircuitDoc,
  defs: PartDefs,
  def: PartDef,
  at: HoleRef,
  orientation: Rotation = 0,
  span?: number
): { placement: Placement } | { error: string } {
  const { footprint } = def
  if (footprint.kind === 'offboard') {
    return {
      placement: { pins: nullPins(def), offboardPose: offboardPose(doc, defs, at) }
    }
  }
  if (at.area !== 'main') return { error: `${def.name} goes in the main area, not on a rail` }
  const board = boardOf(doc, at.board)
  if (!board) return { error: `No board ${at.board}` }
  const from = columnPitches(boardDef(board.defId), at.col)
  const target = (dx: number, dy: number): HoleRef | string => {
    const col = columnAt(at.board, doc, from + dy)
    if (!col)
      return `pin ${dy > 0 ? 'across' : 'back'} ${Math.abs(dy)} pitches from column ${at.col} has no hole`
    return { board: at.board, area: 'main', row: at.row + dx, col }
  }
  if (footprint.kind === 'flex-2lead') {
    const s = span ?? defaultSpan(def)
    if (s < footprint.minSpan || s > footprint.maxSpan)
      return {
        error: `${def.name} spans ${footprint.minSpan}-${footprint.maxSpan} pitches, not ${s}`
      }
    const [dx, dy] = rotate([s, 0], orientation)
    const second = target(dx, dy)
    if (typeof second === 'string') return { error: second }
    return {
      placement: { pins: { [def.pins[0]!.id]: at, [def.pins[1]!.id]: second } }
    }
  }
  const pins: Placement['pins'] = {}
  for (const pin of def.pins) {
    const [dx, dy] = rotate(pin.offsetPitch, orientation)
    const hole = target(dx, dy)
    if (typeof hole === 'string') return { error: `${pin.id}: ${hole}` }
    pins[pin.id] = hole
  }
  return { placement: { pins, rotationDeg: orientation } }
}

/** The first row a part may use on a board: past the T-board's pins and everything under it. */
function firstFreeRow(doc: CircuitDoc, board: BoardInstance): number {
  const tb = doc.controller.tboard
  if (tb.board !== board.id) return 1
  const def = boardDef(board.defId)
  const rows = [
    ...tboardBlockedHoles(def, TBOARD, tb),
    ...Array.from({ length: 40 }, (_, i) => tboardPinHole(tb, i + 1))
  ].flatMap((h) => (h.area === 'main' ? [h.row] : []))
  return Math.max(0, ...rows) + 1
}

export interface AutoOptions {
  /** Start the search near this hole's row (the part's related nets). */
  near?: HoleRef
  span?: number
  orientation?: Rotation
}

/**
 * A free spot for `def`: the first position, scanning outward from the search row, where every
 * pin has a free hole in a strip nothing else uses, so the part joins no net by accident. Rows
 * the T-board covers are skipped. Null when the boards are full: add another board.
 */
export function placeAuto(
  doc: CircuitDoc,
  defs: PartDefs,
  def: PartDef,
  options: AutoOptions = {}
): Placement | null {
  const orientation = options.orientation ?? 0
  if (def.footprint.kind === 'offboard') {
    return { pins: nullPins(def), offboardPose: offboardPose(doc, defs, options.near) }
  }
  const f = free(doc)
  // The board of the related nets first, else the T-board's board, then the rest in order.
  const lead =
    (options.near && boardOf(doc, options.near.board)) ?? boardOf(doc, doc.controller.tboard.board)
  const order = lead ? [lead, ...doc.boards.filter((b) => b.id !== lead.id)] : doc.boards
  for (const board of order) {
    const rows = boardDef(board.defId).rows
    const start = firstFreeRow(doc, board)
    const target =
      options.near?.board === board.id && options.near.area === 'main'
        ? Math.max(start, options.near.row)
        : start
    const anchors = Array.from({ length: rows }, (_, i) => i + 1)
      .filter((r) => r >= start)
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)
    const columns = def.footprint.kind === 'flex-2lead' ? FLEX_COLUMNS : RIGID_COLUMNS
    for (const row of anchors) {
      for (const col of columns) {
        const at: HoleRef = { board: board.id, area: 'main', row, col }
        // Auto-placed flexible parts run along the rows, so their leads sit in different strips.
        const turn = def.footprint.kind === 'flex-2lead' && orientation !== 180 ? 0 : orientation
        const made = placementAt(doc, defs, def, at, turn, options.span)
        if ('error' in made) continue
        const holes = Object.values(made.placement.pins).filter((h): h is HoleRef => h !== null)
        const halves = new Set(
          holes.map((h) => h.area === 'main' && MAIN_COLUMNS.indexOf(h.col) < 5)
        )
        if (def.footprint.kind === 'rigid' && def.footprint.straddleTrench && halves.size !== 2)
          continue
        const fits = holes.every(
          (h) =>
            h.area === 'main' &&
            f.has(h) &&
            h.row >= start &&
            stripHoles(doc, h).every((s) => !f.occupied(s))
        )
        if (fits) return made.placement
      }
    }
  }
  return null
}

// --- Leads ---

export type Gender = 'male' | 'female'

/** The connector a lead end needs where it lands (SPEC 6.5): a hole or a female socket takes a male end. */
export function endNeeds(doc: CircuitDoc, defs: PartDefs, end: Endpoint): Gender | null {
  if ('hole' in end) return 'male'
  const part = doc.parts.find((p) => p.id === end.pin.part)
  const pin = part && defs(part.defId).pins.find((p) => p.id === end.pin.pin)
  if (!pin?.connector) return null
  return pin.connector === 'male-pin' ? 'female' : 'male'
}

/** The Dupont kind whose two ends mate with the connectors the ends need. */
export function leadKindFor(a: Gender, b: Gender): Wire['kind'] {
  if (a === 'male' && b === 'male') return 'dupont-mm'
  if (a === 'female' && b === 'female') return 'dupont-ff'
  return 'dupont-mf'
}

/** The wire's length with 'auto' resolved through the inventory (core/reach autoLength). */
export function resolvedLength(doc: CircuitDoc, defs: PartDefs, wire: Wire): number {
  if (wire.lengthMm !== 'auto') return wire.lengthMm
  const probe: CircuitDoc = { ...doc, wires: [...doc.wires, { ...wire, id: '__probe__' }] }
  const reach = leadReach(probe, defs).find((r) => r.wire === '__probe__')
  return reach ? reach.lengthMm : autoLength(0, wire.kind)
}

export type EndpointSpec =
  { hole: HoleRef } | { partPin: { ref: string; pin: string } } | { net: string }

export interface LeadOptions {
  kind?: Wire['kind']
  color?: string
  lengthMm?: number
}

const NET_COLORS: Record<string, string> = { GND: 'black', '3V3': 'red', '5V': 'red' }
const SIGNAL_COLORS = ['yellow', 'orange', 'green', 'blue', 'purple', 'white', 'brown', 'grey']

/** Black for GND, red for the supplies, and a rotation of signal colours for the rest. */
function defaultColor(doc: CircuitDoc, specs: EndpointSpec[]): string {
  for (const spec of specs) if ('net' in spec && NET_COLORS[spec.net]) return NET_COLORS[spec.net]!
  return SIGNAL_COLORS[doc.wires.length % SIGNAL_COLORS.length]!
}

/** Where an endpoint spec points, for choosing the nearest hole at the other end. */
function anchor(doc: CircuitDoc, defs: PartDefs, spec: EndpointSpec): Vec2 | null {
  if ('hole' in spec) {
    const board = boardOf(doc, spec.hole.board)
    return board && isValidHole(boardDef(board.defId), spec.hole)
      ? tablePosition(doc, spec.hole)
      : null
  }
  if ('net' in spec) return null
  const part = doc.parts.find((p) => p.id === spec.partPin.ref)
  if (!part) return null
  const hole = part.placement.pins[spec.partPin.pin]
  if (hole) return tablePosition(doc, hole)
  const point = exitPoint(doc, defs, { pin: { part: part.id, pin: spec.partPin.pin } })
  return point ? [point[0], point[1]] : null
}

const stripOf = (doc: CircuitDoc, e: Endpoint): string | null => {
  if (!('hole' in e)) return null
  return stripHoles(doc, e.hole).map(holeKey).sort().join()
}

/**
 * The lead a `connect` request describes, with concrete ends: a net becomes a free hole in a
 * T-board strip, a part pin on the breadboard becomes a free hole in the strip it sits in, an
 * off-board module's pin stays a pin. The kind follows the ends' genders unless given; the
 * length is the shortest inventory length that reaches. The wire has no id yet.
 */
export function planLead(
  doc: CircuitDoc,
  defs: PartDefs,
  from: EndpointSpec,
  to: EndpointSpec,
  options: LeadOptions = {}
): { wire: Omit<Wire, 'id'> } | { error: string } {
  if ('net' in from && 'net' in to)
    return { error: 'Both ends are T-board nets; a lead between them would short them' }
  const f = free(doc)
  const chosen = new Set<string>()
  const resolve = (spec: EndpointSpec, other: EndpointSpec): Endpoint | string => {
    const near = anchor(doc, defs, other) ?? undefined
    if ('hole' in spec) {
      const board = boardOf(doc, spec.hole.board)
      if (!board || !isValidHole(boardDef(board.defId), spec.hole))
        return `${holeKey(spec.hole)} is not a hole on any board`
      if (!f.has(spec.hole) || chosen.has(holeKey(spec.hole)))
        return `${holeKey(spec.hole)} is taken or under the T-board`
      return spec
    }
    if ('net' in spec) {
      if (!NET_NAME.test(spec.net)) return `${spec.net} is not GND, 3V3, 5V or a GPIOnn net`
      const hole = netHole(doc, spec.net, near, {
        ...f,
        has: (h) => f.has(h) && !chosen.has(holeKey(h))
      })
      return hole ? { hole } : `${spec.net} has no free hole in its T-board strips`
    }
    const part = doc.parts.find((p) => p.id === spec.partPin.ref)
    if (!part) return `No part ${spec.partPin.ref}`
    const def = defs(part.defId)
    const pin = def.pins.find((p) => p.id === spec.partPin.pin)
    if (!pin)
      return `${part.id} has no pin ${spec.partPin.pin}; its pins are ${def.pins.map((p) => p.id).join(', ')}`
    if (def.footprint.kind === 'offboard') return { pin: { part: part.id, pin: pin.id } }
    const seat = part.placement.pins[pin.id]
    if (!seat) return `${part.id}.${pin.id} is not placed yet`
    const holes = freeInStrip(doc, seat, f).filter((h) => !chosen.has(holeKey(h)))
    if (!holes.length) return `The strip holding ${part.id}.${pin.id} has no free hole`
    if (!near) return { hole: holes[0]! }
    const ranked = holes
      .map((hole) => ({ hole, d: distance(tablePosition(doc, hole), near) }))
      .sort((a, b) => a.d - b.d)
    return { hole: ranked[0]!.hole }
  }

  const a = resolve(from, to)
  if (typeof a === 'string') return { error: a }
  if ('hole' in a) chosen.add(holeKey(a.hole))
  const b = resolve(to, from)
  if (typeof b === 'string') return { error: b }
  const stripA = stripOf(doc, a)
  if (stripA && stripA === stripOf(doc, b))
    return { error: 'Both ends land in the same strip, so the lead would join nothing new' }
  const needsA = endNeeds(doc, defs, a)
  const needsB = endNeeds(doc, defs, b)
  if (!needsA || !needsB) return { error: 'A module pin has no connector gender' }
  const kind = options.kind ?? leadKindFor(needsA, needsB)
  const wire: Omit<Wire, 'id'> = {
    a,
    b,
    color: options.color ?? defaultColor(doc, [from, to]),
    kind,
    lengthMm: options.lengthMm ?? 'auto'
  }
  return { wire: { ...wire, lengthMm: resolvedLength(doc, defs, { ...wire, id: '' }) } }
}
