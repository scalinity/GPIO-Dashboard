// Placement and wiring rules every committed document satisfies (SPEC 6.5, 6.6). A transaction
// that breaks one is rejected and leaves the document unchanged; ERC (core/erc) reports
// electrical problems in documents that are physically valid.
import { boardDef, type BoardDef } from '../defs/boards'
import { TBOARD, type TboardDef } from '../defs/controllers'
import { checkPartDef, propProblem } from '../defs/parts'
import { columnAt, columnPitches, holeKey, holePosition, isValidHole } from '../geometry/breadboard'
import { tboardBlockedHoles, tboardPlacementProblems } from '../geometry/tboard'
import type { CircuitDoc, Endpoint, HoleRef, PartDef, PartInstance, Wire } from '../model/types'
import { PartDefSchema } from '../model/schema'
import { CUSTOM_PART_PREFIX, MAIN_COLUMNS } from '../model/types'
import { docPartDefs, occupancy, occupantKey, type PartDefs } from '../netlist/netlist'
import { standingOverlaps } from '../reach/reach'

export interface Problem {
  code: string
  message: string
  /** Ids of the parts, wires or boards involved, or hole keys. */
  refs: string[]
}

type Gender = 'male' | 'female'

/** The two ends each lead kind has (SPEC 6.5). Solid jumpers end in bare wire, used as a pin. */
const LEAD_ENDS: Record<Wire['kind'], [Gender, Gender]> = {
  'dupont-mm': ['male', 'male'],
  'dupont-mf': ['male', 'female'],
  'dupont-ff': ['female', 'female'],
  'solid-arc': ['male', 'male'],
  'solid-flat': ['male', 'male']
}

const ROTATIONS = [0, 90, 180, 270] as const

/** A rigid footprint offset turned by the part's rotation: [along rows, across columns]. */
function rotate([x, y]: readonly [number, number], deg: number): [number, number] {
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

/** What is wrong with one of a project's own part definitions; empty when it is sound. */
function customPartProblems(def: PartDef): string[] {
  const parsed = PartDefSchema.safeParse(def)
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  return [
    ...(def.id.startsWith(CUSTOM_PART_PREFIX) ? [] : [`its id must start "${CUSTOM_PART_PREFIX}"`]),
    ...checkPartDef(def)
  ]
}

/**
 * The boards and the Pi standing on one another that an edit makes: a board moved into the Pi,
 * say. Only new overlaps count, so a project saved with one still opens and takes other edits.
 */
export function newOverlaps(before: CircuitDoc, after: CircuitDoc): Problem[] {
  const had = new Set(standingOverlaps(before).map((pair) => pair.join()))
  const name = (id: string) => (id === 'pi' ? 'the Pi' : id)
  return standingOverlaps(after)
    .filter((pair) => !had.has(pair.join()))
    .map(([a, b]) => ({
      code: 'OVERLAP',
      message: `${name(a)} can't overlap ${name(b)}`,
      refs: [a, b].filter((id) => id !== 'pi')
    }))
}

export function validateDoc(
  doc: CircuitDoc,
  defs: PartDefs,
  tboard: TboardDef = TBOARD
): Problem[] {
  defs = docPartDefs(doc, defs)
  const problems: Problem[] = []
  const add = (code: string, message: string, refs: string[] = []) =>
    problems.push({ code, message, refs })

  // Ids are unique, boards are known.
  const boards = new Map<string, BoardDef>()
  for (const b of doc.boards) {
    if (boards.has(b.id)) add('DUPLICATE_ID', `Board id ${b.id} is used twice`, [b.id])
    boards.set(b.id, boardDef(b.defId))
  }
  for (const list of [doc.parts, doc.wires]) {
    const seen = new Set<string>()
    for (const { id } of list) {
      if (seen.has(id)) add('DUPLICATE_ID', `Id ${id} is used twice`, [id])
      seen.add(id)
    }
  }
  const customIds = new Set<string>()
  for (const def of doc.customParts ?? []) {
    if (customIds.has(def.id))
      add('DUPLICATE_ID', `Custom part ${def.id} is defined twice`, [def.id])
    customIds.add(def.id)
    for (const message of customPartProblems(def))
      add('CUSTOM_PART', `Custom part ${def.id}: ${message}`, [def.id])
  }
  const holeOk = (hole: HoleRef, owner: string): boolean => {
    const def = boards.get(hole.board)
    if (!def) {
      add('UNKNOWN_BOARD', `${owner} is on board ${hole.board}, which is not in the project`, [
        owner
      ])
      return false
    }
    if (!isValidHole(def, hole)) {
      add('INVALID_HOLE', `${owner} is in ${holeKey(hole)}, which is not a hole on that board`, [
        owner
      ])
      return false
    }
    return true
  }

  // The T-board.
  const tb = doc.controller.tboard
  const tbBoard = boards.get(tb.board)
  if (!tbBoard)
    add('UNKNOWN_BOARD', `The T-board is on board ${tb.board}, which is not in the project`, [
      'tboard'
    ])
  else
    for (const message of tboardPlacementProblems(tbBoard, tb))
      add('TBOARD_PLACEMENT', message, ['tboard'])
  if (problems.length) return problems // geometry below needs a valid board and T-board

  // Parts.
  const partById = new Map<string, { part: PartInstance; def: PartDef }>()
  for (const part of doc.parts) {
    let def: PartDef
    try {
      def = defs(part.defId)
    } catch {
      add('UNKNOWN_DEF', `${part.id} uses unknown part ${part.defId}`, [part.id])
      continue
    }
    partById.set(part.id, { part, def })
    for (const [name, value] of Object.entries(part.props)) {
      const problem = propProblem(def, name, value)
      if (problem) add('BAD_PROP', `${part.id}: ${problem}`, [part.id])
    }
    validatePart(part, def, boards, holeOk, add)
  }

  // Wires.
  for (const wire of doc.wires) {
    const needs: Gender[] = []
    for (const end of [wire.a, wire.b]) {
      const need = endpointNeeds(end, wire.id, partById, holeOk, add)
      if (need) needs.push(need)
    }
    if (needs.length === 2) {
      const have = [...LEAD_ENDS[wire.kind]].sort()
      if (needs.sort().join() !== have.join()) {
        add(
          'GENDER',
          `${wire.id} is a ${wire.kind} lead, but its ends need ${needs.join(' and ')} connectors`,
          [wire.id]
        )
      }
    }
    if (JSON.stringify(wire.a) === JSON.stringify(wire.b)) {
      add('SAME_ENDS', `Both ends of ${wire.id} are in the same place`, [wire.id])
    }
    if ((wire.routeHints?.length ?? 0) > 3)
      add('ROUTE_HINTS', `${wire.id} has more than 3 route hints`, [wire.id])
    if (wire.lengthMm !== 'auto' && !(wire.lengthMm > 0))
      add('LENGTH', `${wire.id} has no usable length`, [wire.id])
  }
  if (problems.length) return problems

  // One lead per hole, and none under the T-board body.
  const occ = occupancy(doc)
  for (const { hole, occupants } of occ.conflicts) {
    add(
      'HOLE_TAKEN',
      `${holeKey(hole)} holds more than one lead: ${occupants.map(occupantKey).join(', ')}`,
      [holeKey(hole)]
    )
  }
  const blocked = new Set(tboardBlockedHoles(tbBoard!, tboard, tb).map(holeKey))
  for (const [key, { occupant }] of occ.holes) {
    if (blocked.has(key)) {
      add(
        'HOLE_BLOCKED',
        `${key} is under the T-board, so ${occupantKey(occupant)} cannot go there`,
        [key]
      )
    }
  }
  return problems
}

function validatePart(
  part: PartInstance,
  def: PartDef,
  boards: Map<string, BoardDef>,
  holeOk: (hole: HoleRef, owner: string) => boolean,
  add: (code: string, message: string, refs?: string[]) => void
) {
  const pinIds = def.pins.map((p) => p.id)
  const keys = Object.keys(part.placement.pins)
  if (keys.length !== pinIds.length || !pinIds.every((id) => keys.includes(id))) {
    add('PIN_SET', `${part.id} must list exactly the pins ${pinIds.join(', ')}`, [part.id])
    return
  }
  const holes = pinIds.map((id) => part.placement.pins[id] ?? null)
  if (holes.some((h) => h && !holeOk(h, part.id))) return
  const placed = holes.filter((h): h is HoleRef => h !== null)
  const { footprint } = def

  if (footprint.kind === 'offboard') {
    if (placed.length)
      add('OFFBOARD_IN_HOLE', `${part.id} is an off-board module; its pins connect through leads`, [
        part.id
      ])
    return
  }
  if (footprint.kind === 'flex-2lead') {
    const [a, b] = holes
    if (a && b) {
      if (a.board !== b.board) {
        add('SPAN', `${part.id}'s two leads are on different boards`, [part.id])
        return
      }
      const bb = boards.get(a.board)!
      const [ax, ay] = holePosition(bb, a)
      const [bx, by] = holePosition(bb, b)
      const span = Math.hypot(bx - ax, by - ay) / bb.pitchMm
      if (span < footprint.minSpan - 1e-6 || span > footprint.maxSpan + 1e-6) {
        add(
          'SPAN',
          `${part.id}'s leads are ${span.toFixed(1)} pitches apart; it needs ${footprint.minSpan}–${footprint.maxSpan}`,
          [part.id]
        )
      }
    }
    return
  }
  // Rigid: all pins in, on one board, matching the footprint turned in a 90° step.
  if (placed.length === 0) return
  if (placed.length !== holes.length) {
    add('FOOTPRINT', `${part.id} is a rigid part; place all of its pins or none`, [part.id])
    return
  }
  const first = placed[0]!
  if (placed.some((h) => h.area !== 'main' || h.board !== first.board) || first.area !== 'main') {
    add('FOOTPRINT', `${part.id}'s pins must all be in the main area of one board`, [part.id])
    return
  }
  const bb = boards.get(first.board)!
  const rotation = part.placement.rotationDeg ?? 0
  if (!ROTATIONS.includes(rotation)) {
    add('FOOTPRINT', `${part.id} turns in 90° steps`, [part.id])
    return
  }
  const pin1Across = columnPitches(bb, first.col)
  def.pins.forEach((pin, i) => {
    const [dx, dy] = rotate(pin.offsetPitch, rotation)
    const expected = columnAt(bb, pin1Across + dy)
    const actual = holes[i]!
    if (
      actual.area !== 'main' ||
      !expected ||
      actual.row !== first.row + dx ||
      actual.col !== expected
    ) {
      add('FOOTPRINT', `${part.id} pin ${pin.id} is not where the footprint puts it`, [part.id])
    }
  })
  if (footprint.straddleTrench) {
    const sides = new Set(
      placed.map((h) => (h.area === 'main' && MAIN_COLUMNS.indexOf(h.col) < 5 ? 'a-e' : 'f-j'))
    )
    if (sides.size !== 2) add('TRENCH', `${part.id} must straddle the centre trench`, [part.id])
  }
}

function endpointNeeds(
  end: Endpoint,
  wire: string,
  parts: Map<string, { part: PartInstance; def: PartDef }>,
  holeOk: (hole: HoleRef, owner: string) => boolean,
  add: (code: string, message: string, refs?: string[]) => void
): Gender | null {
  if ('hole' in end) return holeOk(end.hole, wire) ? 'male' : null
  const target = parts.get(end.pin.part)
  const pin = target?.def.pins.find((p) => p.id === end.pin.pin)
  if (!target || !pin) {
    add('BAD_ENDPOINT', `${wire} ends on ${end.pin.part}.${end.pin.pin}, which does not exist`, [
      wire
    ])
    return null
  }
  if (target.def.footprint.kind !== 'offboard' || !pin.connector) {
    add('BAD_ENDPOINT', `${wire} may end on a pin only of an off-board module's connector`, [wire])
    return null
  }
  // A male pin takes a female end; a female socket takes a male end.
  return pin.connector === 'male-pin' ? 'female' : 'male'
}
