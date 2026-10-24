// The edits the Studio's gestures propose (SPEC 6.6, 11.3, 11.4): new parts and leads with their
// ids and defaults, parts seated by an anchor hole, rotations and removals. Each is a list of ops
// for circuitStore.check() and dispatch(), which decide whether it is legal. Pure: core in, ops out.
import { boardDef } from '../core/defs/boards'
import { TBOARD } from '../core/defs/controllers'
import { partDef } from '../core/defs/parts'
import { defOf } from './coords'
import { holeKey, holePosition, nearestHole, stripKey } from '../core/geometry/breadboard'
import { tboardBlockedHoles } from '../core/geometry/tboard'
import type {
  CircuitDoc,
  Endpoint,
  HoleRef,
  Op,
  PartInstance,
  SimModelId,
  Transform2D,
  Vec2,
  Wire
} from '../core/model/types'
import { netlist, occupancy } from '../core/netlist/netlist'
import type { Problem } from '../core/ops/validate'

const PITCH_MM = 2.54

/** Reference designator prefixes, as the tutorials use them; anything else is U. */
const PREFIX: Partial<Record<SimModelId, string>> = {
  resistor: 'R',
  potentiometer: 'R',
  ldr: 'R',
  ntc: 'RT',
  capacitor: 'C',
  electrolytic: 'C',
  diode: 'D',
  led: 'D',
  'rgb-led': 'D',
  npn: 'Q',
  pnp: 'Q',
  switch: 'SW',
  'tact-switch': 'SW',
  'tilt-switch': 'S',
  'active-buzzer': 'BZ',
  'passive-buzzer': 'BZ',
  'dc-motor': 'M',
  'relay-module': 'K',
  'seven-segment': 'DS',
  'seven-segment-4digit': 'DS',
  'bar-graph-10': 'B',
  'led-matrix-8x8': 'M',
  'keypad-4x4': 'KP',
  sg90: 'SV',
  joystick: 'J',
  dht11: 'DHT',
  'hc-sr04': 'HC',
  'power-module': 'PM'
}

/** The first `prefix`n not yet taken, from 1. */
export function nextId(taken: string[], prefix: string): string {
  let n = 1
  while (taken.includes(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

export type Rotation = 0 | 90 | 180 | 270

export const turned = (rotation: number, by: number) =>
  ((((rotation + by) % 360) + 360) % 360) as Rotation

/** A footprint offset turned as core/ops/validate turns it: [along rows, across columns]. */
export function turn([x, y]: Vec2, rotation: number): Vec2 {
  switch (turned(rotation, 0)) {
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

/** A hole's position in its board's frame. */
function at(doc: CircuitDoc, hole: HoleRef): Vec2 {
  const board = doc.boards.find((b) => b.id === hole.board)!
  return holePosition(boardDef(board.defId), hole)
}

/** Each pin in the hole `vectors[pin]` mm from `anchor`, on the anchor's board; null off the board. */
export function seat(
  doc: CircuitDoc,
  anchor: HoleRef,
  vectors: Record<string, Vec2>
): Record<string, HoleRef | null> {
  const board = doc.boards.find((b) => b.id === anchor.board)!
  const def = boardDef(board.defId)
  const [x, y] = holePosition(def, anchor)
  return Object.fromEntries(
    Object.entries(vectors).map(([pin, [dx, dy]]) => [
      pin,
      nearestHole(def, board.id, [x + dx, y + dy], 0.3)
    ])
  )
}

/** Whether every pin of a placement found a hole. */
export const seated = (pins: Record<string, HoleRef | null>) =>
  Object.values(pins).every((h) => h !== null)

/** Each placed pin's offset from pin 1, in mm in the board's frame. */
function vectorsOf(doc: CircuitDoc, part: PartInstance): Record<string, Vec2> | null {
  const def = defOf(doc, part.defId)
  const first = part.placement.pins[def.pins[0]!.id]
  if (!first) return null
  const [x, y] = at(doc, first)
  const vectors: Record<string, Vec2> = {}
  for (const pin of def.pins) {
    const hole = part.placement.pins[pin.id]
    if (!hole || hole.board !== first.board) return null
    const [px, py] = at(doc, hole)
    vectors[pin.id] = [px - x, py - y]
  }
  return vectors
}

/**
 * A new part from the library. On a board, pin 1 goes in `anchor` and the others follow the
 * definition's pin offsets turned by `rotation` (a flexible part's span starts at its native
 * pitch); an off-board module sits on the table at `pose` with no pins in holes.
 */
export function newPart(
  doc: CircuitDoc,
  defId: string,
  where: { anchor: HoleRef; rotation: Rotation } | { pose: Transform2D }
): PartInstance {
  const def = defOf(doc, defId)
  const id = nextId(
    doc.parts.map((p) => p.id),
    PREFIX[def.sim.model] ?? 'U'
  )
  const props = Object.fromEntries(Object.entries(def.properties).map(([k, p]) => [k, p.default]))
  if ('pose' in where) {
    const pins = Object.fromEntries(def.pins.map((p) => [p.id, null]))
    return { id, defId, props, placement: { pins, offboardPose: where.pose } }
  }
  const vectors = Object.fromEntries(
    def.pins.map((p) => {
      const [x, y] = turn(p.offsetPitch, where.rotation)
      return [p.id, [x * PITCH_MM, y * PITCH_MM] as Vec2]
    })
  )
  const pins = seat(doc, where.anchor, vectors)
  const rigid = def.footprint.kind === 'rigid' && where.rotation !== 0
  return {
    id,
    defId,
    props,
    placement: { pins, ...(rigid ? { rotationDeg: where.rotation } : {}) }
  }
}

/** A placed part moved so its pin 1 lands in `anchor`, keeping its layout. */
export function movedPart(doc: CircuitDoc, part: PartInstance, anchor: HoleRef): PartInstance {
  const vectors = vectorsOf(doc, part)
  if (!vectors) return part
  return { ...part, placement: { ...part.placement, pins: seat(doc, anchor, vectors) } }
}

/** A placed part turned by `by` degrees about its pin 1 (off-board modules about their pose). */
export function turnedPart(doc: CircuitDoc, part: PartInstance, by: 90 | -90): PartInstance {
  const pose = part.placement.offboardPose
  if (pose) {
    const offboardPose = { ...pose, rotationDeg: turned(pose.rotationDeg, by) }
    return { ...part, placement: { ...part.placement, offboardPose } }
  }
  const def = defOf(doc, part.defId)
  const vectors = vectorsOf(doc, part)
  const anchor = part.placement.pins[def.pins[0]!.id]
  if (!vectors || !anchor) return part
  const quarter = by === 90 ? 90 : 270
  const pins = seat(
    doc,
    anchor,
    Object.fromEntries(Object.entries(vectors).map(([pin, v]) => [pin, turn(v, quarter)]))
  )
  const rotation =
    def.footprint.kind === 'rigid'
      ? { rotationDeg: turned(part.placement.rotationDeg ?? 0, by) }
      : {}
  return { ...part, placement: { ...part.placement, pins, ...rotation } }
}

/** Removing a part takes the leads on its connector pins with it (they would end nowhere). */
export function removePartOps(doc: CircuitDoc, id: string): Op[] {
  const onIt = (e: Endpoint) => 'pin' in e && e.pin.part === id
  return [
    ...doc.wires
      .filter((w) => onIt(w.a) || onIt(w.b))
      .map((w): Op => ({ type: 'RemoveWire', id: w.id })),
    { type: 'RemovePart', id }
  ]
}

/** The colour convention (SPEC 11.3): red for a 3V3 or 5V net, black for GND. */
export function suggestedColor(doc: CircuitDoc, ends: Endpoint[]): 'red' | 'black' | null {
  const nl = netlist(doc, partDef)
  for (const end of ends) {
    let name: string | undefined
    if ('hole' in end) {
      const board = doc.boards.find((b) => b.id === end.hole.board)
      name = board && nl.netOfStrip.get(stripKey(boardDef(board.defId), end.hole))
    } else name = nl.netOfPin.get(`${end.pin.part}.${end.pin.pin}`)
    const names = (name && nl.byName.get(name)?.names) || []
    if (names.includes('3V3') || names.includes('5V')) return 'red'
    if (names.includes('GND')) return 'black'
  }
  return null
}

/** The colour a new signal lead gets when the convention suggests none. */
export const SIGNAL_COLOR = 'yellow'

/**
 * A new lead from the inventory's default (SPEC 6.5, 11.3): male–male Dupont with length 'auto',
 * or male–female when one end goes on a module's male header pin.
 */
export function newWire(doc: CircuitDoc, a: Endpoint, b: Endpoint): Wire {
  const onMalePin = [a, b].some((e) => {
    if (!('pin' in e)) return false
    const part = doc.parts.find((p) => p.id === e.pin.part)
    const pin = part && defOf(doc, part.defId).pins.find((p) => p.id === e.pin.pin)
    return pin?.connector === 'male-pin'
  })
  return {
    id: nextId(
      doc.wires.map((w) => w.id),
      'W'
    ),
    a,
    b,
    color: suggestedColor(doc, [a, b]) ?? SIGNAL_COLOR,
    kind: onMalePin ? 'dupont-mf' : 'dupont-mm',
    lengthMm: 'auto'
  }
}

/** Whether a lead may start in this hole: nothing in it yet, and not under the T-board. */
export function holeFree(doc: CircuitDoc, hole: HoleRef): boolean {
  const key = holeKey(hole)
  if (occupancy(doc).holes.has(key)) return false
  const tb = doc.controller.tboard
  const board = doc.boards.find((b) => b.id === tb.board)
  if (!board) return true
  return !tboardBlockedHoles(boardDef(board.defId), TBOARD, tb).some((h) => holeKey(h) === key)
}

/**
 * Which of a ghost's holes glow green: all of them when the edit passes. Otherwise a hole a
 * problem names is red, and every hole is red when a problem concerns the edit as a whole.
 */
export function holeLegality(holes: HoleRef[], problems: Problem[] | null): boolean[] {
  if (!problems) return holes.map(() => true)
  const keys = holes.map(holeKey)
  const named = new Set(problems.flatMap((p) => p.refs))
  const whole = problems.some((p) => !p.refs.some((r) => keys.includes(r)))
  return keys.map((k) => !whole && !named.has(k))
}
