// The tools that read and change the circuit document (SPEC 12.5). Each mutation is one
// transaction of the turn, so "Undo all" takes the whole turn back. The planning functions are
// pure: the same ones turn a streaming tool call into a ghost before it commits.
import { z } from 'zod'
import { boardDef } from '../../core/defs/boards'
import {
  COL_PAIRS,
  type CircuitDoc,
  type HoleRef,
  type PartInstance,
  type Wire
} from '../../core/model/types'
import { holeKey } from '../../core/geometry/breadboard'
import { tboardPinHole } from '../../core/geometry/tboard'
import { headerNetName } from '../../core/defs/controllers'
import {
  docPartDefs,
  netlist,
  occupancy,
  occupantKey,
  type PartDefs
} from '../../core/netlist/netlist'
import { leadReach } from '../../core/reach/reach'
import {
  free,
  freeInStrip,
  netPins,
  placeAuto,
  placementAt,
  planLead,
  tablePosition,
  stripHoles,
  type EndpointSpec,
  type Placement
} from '../../core/placer/placer'
import { circuitState, changesSince, endpointText } from './state'
import {
  defaultProps,
  hole,
  holeOrAuto,
  mergeProps,
  NET_NAMES,
  nextId,
  parseHole,
  propList,
  REF_PATTERN,
  refPrefix
} from './shared'
import { commit, defineTool, failure, isOutput, reply, type ToolEnv } from './types'
import { erc } from '../../core/erc/erc'

const rotation = z
  .literal([0, 90, 180, 270])
  .describe(
    'Degrees. Rigid parts turn in 90 degree steps. A two-lead part runs 0 = toward higher rows, 180 = toward lower rows, 90/270 = across the columns.'
  )

// --- Parts ---

export const placePartInput = z
  .object({
    defId: z.string().describe('A part id from search_parts, e.g. "resistor".'),
    at: holeOrAuto(
      'Where pin 1 (or the first lead) goes, as "board:rowColumn" like "bb1:30b", or "auto" to let the placer pick free strips. Parts that plug into the board go in the main area.'
    ),
    orientation: rotation,
    props: propList.describe(
      'Property values to set, e.g. [{"name":"resistance","value":220}]. Empty keeps the defaults.'
    ),
    ref: z
      .string()
      .optional()
      .describe('Reference designator like R1. Leave out to take the next free one.'),
    span: z
      .number()
      .int()
      .optional()
      .describe(
        'Pitches between a two-lead part’s leads. Leave out for a span that fits the body.'
      ),
    near: z
      .string()
      .optional()
      .describe('With at "auto": a part ref or a net (GPIO17, GND) whose rows to stay near.')
  })
  .strict()
export type PlacePartInput = z.infer<typeof placePartInput>

/** The hole a `near` hint points at: a net's T-board strip, or a placed part's first pin. */
function nearHole(doc: CircuitDoc, near: string | undefined): HoleRef | undefined {
  if (!near) return undefined
  const pin = netPins(near)[0]
  if (pin) return tboardPinHole(doc.controller.tboard, pin)
  const part = doc.parts.find((p) => p.id === near)
  return part && Object.values(part.placement.pins).find((h): h is HoleRef => h !== null)
}

export interface PartPlan {
  part: PartInstance
}

/** The part `place_part` would add, or why it can not be added. */
export function planPlacePart(
  doc: CircuitDoc,
  defs: PartDefs,
  input: PlacePartInput
): PartPlan | { error: string; code: string } {
  let def
  try {
    def = docPartDefs(doc, defs)(input.defId)
  } catch {
    return { code: 'UNKNOWN_PART', error: `No part ${input.defId}; find one with search_parts` }
  }
  const merged = mergeProps(def, defaultProps(def), input.props)
  if ('error' in merged) return { code: 'BAD_PROPS', error: merged.error }
  const ids = doc.parts.map((p) => p.id)
  if (input.ref !== undefined) {
    if (!REF_PATTERN.test(input.ref))
      return { code: 'BAD_REF', error: 'A ref starts with a letter and has letters, digits or _' }
    if (ids.includes(input.ref)) return { code: 'REF_TAKEN', error: `${input.ref} is already used` }
  }
  const ref = input.ref ?? nextId(refPrefix(def), ids)
  let placement: Placement | null
  if (input.at === 'auto') {
    placement = placeAuto(doc, defs, def, {
      near: nearHole(doc, input.near),
      span: input.span,
      orientation: input.orientation
    })
    if (!placement)
      return { code: 'NO_ROOM', error: 'No free strips left; add another board with add_board' }
  } else {
    const at = parseHole(input.at)
    const made = placementAt(doc, defs, def, at, input.orientation, input.span)
    if ('error' in made) return { code: 'BAD_PLACEMENT', error: made.error }
    placement = made.placement
  }
  return { part: { id: ref, defId: def.id, props: merged.props, placement } }
}

/** The leads, part pins and T-board pins that share a strip with `hole`, besides `except`'s own. */
function neighbours(doc: CircuitDoc, hole: HoleRef, except: string): string[] {
  const taken = occupancy(doc).holes
  return stripHoles(doc, hole).flatMap((h) => {
    const entry = taken.get(holeKey(h))
    if (!entry || occupantKey(entry.occupant).startsWith(`part:${except}.`)) return []
    const o = entry.occupant
    return [
      o.kind === 'part'
        ? `${o.part}.${o.pin}`
        : o.kind === 'wire'
          ? `${o.wire}.${o.end}`
          : `T-board pin ${o.pin}`
    ]
  })
}

function partReport(doc: CircuitDoc, defs: PartDefs, ref: string) {
  const part = doc.parts.find((p) => p.id === ref)!
  const nl = netlist(doc, defs)
  const f = free(doc)
  const warnings: string[] = []
  const pins = Object.fromEntries(
    Object.entries(part.placement.pins).map(([pin, seat]) => {
      const net = nl.netOfPin.get(`${ref}.${pin}`)
      if (seat) {
        const shared = neighbours(doc, seat, ref)
        if (shared.length)
          warnings.push(
            `${ref}.${pin} shares its strip with ${shared.join(', ')}, so it joins their net`
          )
      }
      return [
        pin,
        {
          hole: seat ? holeKey(seat) : 'off-board',
          ...(net ? { net } : {}),
          ...(seat ? { freeInStrip: freeInStrip(doc, seat, f).map(holeKey) } : {})
        }
      ]
    })
  )
  return { ref, pins, ...(warnings.length ? { warnings } : {}) }
}

export const placePart = defineTool({
  name: 'place_part',
  description:
    'Place one part. Use "auto" for `at` unless you need an exact spot: the placer picks free strips that do not join anything by accident, keeps DIPs across the trench and stays out of the T-board rows. To put two parts in the same net (for example a resistor feeding an LED), give an exact `at` in a strip the first part already uses; the reply lists each pin’s free holes. Off-board modules (sensors, servos) get no holes: wire them with connect. Returns each pin’s hole and net, and warnings when a pin shares a strip with something.',
  schema: placePartInput,
  mutates: true,
  preview: true,
  run(input, env) {
    const doc = env.ctx.getSnapshot()
    const plan = planPlacePart(doc, env.ctx.partDef, input)
    if ('error' in plan) return failure(plan.code, plan.error)
    const tx = commit(env, `Place ${plan.part.id}`, [{ type: 'AddPart', part: plan.part }])
    if (isOutput(tx)) return tx
    return {
      ...reply(partReport(env.ctx.getSnapshot(), env.ctx.partDef, plan.part.id)),
      committed: [tx]
    }
  }
})

/** How many pitches apart a placed two-lead part’s leads are. */
function currentSpan(doc: CircuitDoc, part: PartInstance): number | undefined {
  const [a, b] = Object.values(part.placement.pins)
  if (!a || !b) return undefined
  const [ax, ay] = tablePosition(doc, a)
  const [bx, by] = tablePosition(doc, b)
  return Math.round(Math.hypot(ax - bx, ay - by) / 2.54)
}

export const movePart = defineTool({
  name: 'move_part',
  description:
    'Move a placed part to another spot. Leads that ended in the strips the part left stay where they are; the reply lists them so you can move or remove them.',
  schema: z
    .object({
      ref: z.string().describe('The part’s reference designator.'),
      at: holeOrAuto('"board:rowColumn" for pin 1, or "auto".'),
      orientation: rotation,
      span: z
        .number()
        .int()
        .optional()
        .describe('Leads’ span for a two-lead part. Leave out to keep it.')
    })
    .strict(),
  mutates: true,
  preview: true,
  run(input, env) {
    const doc = env.ctx.getSnapshot()
    const part = doc.parts.find((p) => p.id === input.ref)
    if (!part) return failure('NO_SUCH_PART', `No part ${input.ref}`)
    const def = docPartDefs(doc, env.ctx.partDef)(part.defId)
    const span = input.span ?? currentSpan(doc, part)
    let placement: Placement | null
    if (input.at === 'auto') {
      const without = { ...doc, parts: doc.parts.filter((p) => p.id !== part.id) }
      placement = placeAuto(without, env.ctx.partDef, def, { span, orientation: input.orientation })
      if (!placement)
        return failure('NO_ROOM', 'No free strips left; add another board with add_board')
    } else {
      const made = placementAt(
        doc,
        env.ctx.partDef,
        def,
        parseHole(input.at),
        input.orientation,
        span
      )
      if ('error' in made) return failure('BAD_PLACEMENT', made.error)
      placement = made.placement
    }
    const oldStrips = new Set(
      Object.values(part.placement.pins).flatMap((h) => (h ? stripHoles(doc, h).map(holeKey) : []))
    )
    const left = doc.wires
      .filter((w) => [w.a, w.b].some((e) => 'hole' in e && oldStrips.has(holeKey(e.hole))))
      .map((w) => w.id)
    const tx = commit(env, `Move ${part.id}`, [{ type: 'MovePart', id: part.id, placement }])
    if (isOutput(tx)) return tx
    const report = partReport(env.ctx.getSnapshot(), env.ctx.partDef, part.id)
    return {
      ...reply({ ...report, ...(left.length ? { leadsLeftBehind: left } : {}) }),
      committed: [tx]
    }
  }
})

export const removePart = defineTool({
  name: 'remove_part',
  description:
    'Remove a part. Leads that end on an off-board module’s pins go with it; leads in the strips it occupied stay and are listed.',
  schema: z.object({ ref: z.string().describe('The part’s reference designator.') }).strict(),
  mutates: true,
  run({ ref }, env) {
    const doc = env.ctx.getSnapshot()
    const part = doc.parts.find((p) => p.id === ref)
    if (!part) return failure('NO_SUCH_PART', `No part ${ref}`)
    const attached = doc.wires.filter((w) =>
      [w.a, w.b].some((e) => 'pin' in e && e.pin.part === ref)
    )
    const strips = new Set(
      Object.values(part.placement.pins).flatMap((h) => (h ? stripHoles(doc, h).map(holeKey) : []))
    )
    const left = doc.wires
      .filter((w) => !attached.includes(w))
      .filter((w) => [w.a, w.b].some((e) => 'hole' in e && strips.has(holeKey(e.hole))))
      .map((w) => w.id)
    const tx = commit(env, `Remove ${ref}`, [
      ...attached.map((w) => ({ type: 'RemoveWire' as const, id: w.id })),
      { type: 'RemovePart', id: ref }
    ])
    if (isOutput(tx)) return tx
    return {
      ...reply({
        removed: ref,
        removedLeads: attached.map((w) => w.id),
        ...(left.length ? { leadsLeftBehind: left } : {})
      }),
      committed: [tx]
    }
  }
})

export const setPartProps = defineTool({
  name: 'set_part_props',
  description:
    'Change a placed part’s properties, such as a resistor’s value or an LED’s colour. Only the properties you list change.',
  schema: z
    .object({ ref: z.string().describe('The part’s reference designator.'), props: propList })
    .strict(),
  mutates: true,
  run({ ref, props }, env) {
    const doc = env.ctx.getSnapshot()
    const part = doc.parts.find((p) => p.id === ref)
    if (!part) return failure('NO_SUCH_PART', `No part ${ref}`)
    const merged = mergeProps(docPartDefs(doc, env.ctx.partDef)(part.defId), part.props, props)
    if ('error' in merged) return failure('BAD_PROPS', merged.error)
    const tx = commit(env, `Set ${ref} properties`, [
      { type: 'SetPartProps', id: ref, props: merged.props }
    ])
    if (isOutput(tx)) return tx
    return { ...reply({ ref, props: merged.props }), committed: [tx] }
  }
})

// --- Boards and the T-board ---

export const addBoard = defineTool({
  name: 'add_board',
  description:
    'Add a breadboard when the build will not fit. A new project has one bb-830. Returns the new board’s id.',
  schema: z
    .object({
      defId: z.enum(['bb-830', 'bb-400']).describe('bb-830 is the full-size board on the bench.'),
      position: z
        .object({ x: z.number(), y: z.number() })
        .strict()
        .optional()
        .describe('Table position in mm. Leave out to put it beside the others.')
    })
    .strict(),
  mutates: true,
  run({ defId, position }, env) {
    const doc = env.ctx.getSnapshot()
    const id = nextId(
      'bb',
      doc.boards.map((b) => b.id)
    )
    const below = Math.max(
      0,
      ...doc.boards.map((b) => b.transform.position[1] + boardDef(b.defId).body.widthMm + 20)
    )
    const at: [number, number] = position
      ? [position.x, position.y]
      : [doc.boards[0]?.transform.position[0] ?? 0, below]
    const tx = commit(env, `Add board ${id}`, [
      { type: 'AddBoard', board: { id, defId, transform: { position: at, rotationDeg: 0 } } }
    ])
    if (isOutput(tx)) return tx
    return { ...reply({ board: id, defId, position: at }), committed: [tx] }
  }
})

export const placeTboard = defineTool({
  name: 'place_tboard',
  description:
    'Set where the T-board sits on a breadboard. Almost every build keeps the bench placement (bb1, pin1Row 1, d/h, header toward row 0): only call this to move it, for example to a second board. Returns the 40-pin map from T-board pin to hole and net.',
  schema: z
    .object({
      board: z.string().describe('Board id such as bb1.'),
      pin1Row: z.number().int().describe('The row pin 1 sits in.'),
      colPair: z
        .enum(COL_PAIRS)
        .describe('The two columns the pin rows land in; the bench uses d/h.'),
      orientation: z.enum(['header-toward-row-0', 'header-toward-last-row'])
    })
    .strict(),
  mutates: true,
  preview: true,
  run(input, env) {
    const doc = env.ctx.getSnapshot()
    const tx = commit(env, 'Place T-board', [
      { type: 'SetControllerPlacement', controller: { ...doc.controller, tboard: input } }
    ])
    if (isOutput(tx)) return tx
    const placed = env.ctx.getSnapshot().controller.tboard
    const pins = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => i + 1).map((pin) => [
        pin,
        `${holeKey(tboardPinHole(placed, pin))} ${headerNetName(pin)}`
      ])
    )
    return { ...reply({ tboard: placed, pins }), committed: [tx] }
  }
})

// --- Leads ---

const endpointSpec = z.union([
  z
    .object({ hole: hole('A hole such as "bb1:23e", or a rail hole such as "bb1:top-.4".') })
    .strict(),
  z
    .object({
      partPin: z
        .object({ ref: z.string(), pin: z.string() })
        .strict()
        .describe(
          'A placed part’s pin. On the breadboard this becomes a free hole in the pin’s strip.'
        )
    })
    .strict(),
  z
    .object({ net: z.enum(NET_NAMES).describe('A T-board net; becomes a free hole in its strip.') })
    .strict()
])

export const connectInput = z
  .object({
    from: endpointSpec,
    to: endpointSpec,
    kind: z
      .enum(['dupont-mm', 'dupont-mf', 'dupont-ff', 'solid-arc', 'solid-flat'])
      .optional()
      .describe('Leave out: the kind follows the connectors at both ends.'),
    color: z
      .string()
      .optional()
      .describe('Leave out for black GND, red supplies, others in rotation.'),
    lengthMm: z
      .number()
      .optional()
      .describe('Leave out for the shortest inventory length that reaches.')
  })
  .strict()
export type ConnectInput = z.infer<typeof connectInput>

type Endpoints = z.infer<typeof endpointSpec>

function toSpec(e: Endpoints): EndpointSpec {
  if ('hole' in e) return { hole: parseHole(e.hole) }
  return e
}

/** The wire `connect` would add (without an id), or why it can not. */
export function planConnect(
  doc: CircuitDoc,
  defs: PartDefs,
  input: ConnectInput
): { wire: Omit<Wire, 'id'> } | { error: string } {
  return planLead(doc, defs, toSpec(input.from), toSpec(input.to), {
    kind: input.kind,
    color: input.color,
    lengthMm: input.lengthMm
  })
}

export const connect = defineTool({
  name: 'connect',
  description:
    'Run one jumper lead between two ends. An end is a hole, a part pin, or a T-board net (GND, 3V3, 5V, GPIOnn). You never pick holes or lead lengths yourself: nets resolve to a free hole in the net’s T-board strip, a pin on the breadboard to a free hole in its own strip, and the length to the shortest inventory lead that reaches. Reach the Pi only through nets, never a header. The lead kind follows the connectors: male-male between holes, male-female onto a module’s male header pin, male-male into a female socket. Returns the concrete wire.',
  schema: connectInput,
  mutates: true,
  preview: true,
  run(input, env) {
    const doc = env.ctx.getSnapshot()
    const planned = planConnect(doc, env.ctx.partDef, input)
    if ('error' in planned) return failure('CANNOT_CONNECT', planned.error)
    const wire: Wire = {
      id: nextId(
        'W',
        doc.wires.map((w) => w.id)
      ),
      ...planned.wire
    }
    const tx = commit(env, `Connect ${wire.id}`, [{ type: 'AddWire', wire }])
    if (isOutput(tx)) return tx
    const after = env.ctx.getSnapshot()
    const nl = netlist(after, env.ctx.partDef)
    const member = nl.nets.find((n) =>
      n.members.some((m) => m.kind === 'wire' && m.wire === wire.id)
    )
    const reach = leadReach(after, env.ctx.partDef).find((r) => r.wire === wire.id)
    return {
      ...reply({
        wire: {
          id: wire.id,
          kind: wire.kind,
          color: wire.color,
          lengthMm: wire.lengthMm,
          a: endpointText(wire.a),
          b: endpointText(wire.b)
        },
        net: member?.name,
        ...(reach && !reach.ok
          ? {
              warning: `The lead needs about ${Math.ceil(reach.requiredMm)} mm to reach; only ${reach.lengthMm} mm is available`
            }
          : {})
      }),
      committed: [tx]
    }
  }
})

export const setWireProps = defineTool({
  name: 'set_wire_props',
  description:
    'Change a placed lead’s kind, colour, length or arc height, for example to recolour a lead or to give a short jumper a longer length. Only the fields you give change; a kind must match the connectors at both ends.',
  schema: z
    .object({
      id: z.string().describe('The wire id, such as W3.'),
      kind: z.enum(['dupont-mm', 'dupont-mf', 'dupont-ff', 'solid-arc', 'solid-flat']).optional(),
      color: z.string().optional(),
      lengthMm: z.number().optional(),
      heightMm: z.number().optional().describe('Bend height of a solid-arc jumper.')
    })
    .strict(),
  mutates: true,
  run({ id, ...changes }, env) {
    const wire = env.ctx.getSnapshot().wires.find((w) => w.id === id)
    if (!wire) return failure('NO_SUCH_WIRE', `No wire ${id}`)
    const props = Object.fromEntries(
      Object.entries(changes).filter(([, v]) => v !== undefined)
    ) as Partial<Omit<Wire, 'id' | 'a' | 'b'>>
    if (!Object.keys(props).length) return failure('NOTHING_TO_CHANGE', 'Give at least one field')
    const tx = commit(env, `Edit ${id}`, [{ type: 'SetWireProps', id, props }])
    if (isOutput(tx)) return tx
    return { ...reply({ id, ...props }), committed: [tx] }
  }
})

export const removeWire = defineTool({
  name: 'remove_wire',
  description:
    'Remove one jumper lead by its id (W1, W2…), for example to undo a wrong connection. The ids are in get_circuit_state. Removing a lead can leave a part pin unconnected, which ERC reports as dangling.',
  schema: z.object({ id: z.string().describe('The wire id, such as W3.') }).strict(),
  mutates: true,
  run({ id }, env) {
    if (!env.ctx.getSnapshot().wires.some((w) => w.id === id))
      return failure('NO_SUCH_WIRE', `No wire ${id}`)
    const tx = commit(env, `Remove ${id}`, [{ type: 'RemoveWire', id }])
    if (isOutput(tx)) return tx
    return { ...reply({ removed: id }), committed: [tx] }
  }
})

// --- Reading ---

export const getCircuitState = defineTool({
  name: 'get_circuit_state',
  description:
    'Read the circuit: boards and their free rows, the T-board placement, every part with pin → hole → net, every wire, the nets, the ERC issues and the pins the code uses. Call it before editing an existing project, and after a batch of edits to see the result. `summary` is enough for most work; `full` adds properties, the 40 T-board pins and the code. With `since` (a revision you saw earlier) it returns only what changed.',
  schema: z
    .object({
      detail: z.enum(['summary', 'full']),
      since: z.number().int().optional().describe('A revision number from an earlier reply.')
    })
    .strict(),
  run({ detail, since }, env: ToolEnv) {
    const doc = env.ctx.getSnapshot()
    const defs = env.ctx.partDef
    const before = since === undefined ? undefined : env.revisions.get(since)
    env.revisions.remember(doc)
    if (before && before.meta.revision !== doc.meta.revision) {
      const issues = erc(doc, defs).map((i) => ({
        code: i.code,
        severity: i.severity,
        refs: i.refs,
        message: i.message
      }))
      return reply(`${changesSince(before, doc, defs)}\nERC now: ${JSON.stringify(issues)}`)
    }
    if (before) return reply(`No changes since revision ${since}.`)
    const note =
      since === undefined
        ? ''
        : `Revision ${since} is no longer remembered; the full state follows.\n`
    return reply(note + circuitState(doc, defs, { detail }))
  }
})

export const circuitTools = [
  getCircuitState,
  addBoard,
  placeTboard,
  placePart,
  movePart,
  removePart,
  setPartProps,
  connect,
  setWireProps,
  removeWire
]
