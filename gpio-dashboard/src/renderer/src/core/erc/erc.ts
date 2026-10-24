// Electrical rule checks (SPEC 8). Each rule has a code, a severity, the refs involved, a plain
// explanation and a fix. This is v1: rules decided from the netlist, the code and geometry.
// Rules that need simulated currents (PIN_OVERCURRENT, RAIL_BUDGET, and LED_NO_LIMIT's current
// check) are added with the simulator (M3).
import { codePins, type PinUse } from '../code/pins'
import type { CircuitDoc, PartDef, PartInstance, Vec2 } from '../model/types'
import { boardDef } from '../defs/boards'
import { holeKey, holePosition, stripKey } from '../geometry/breadboard'
import type { Net, Netlist, PartDefs } from '../netlist/netlist'
import { netlist as buildNetlist, occupancy } from '../netlist/netlist'
import { leadReach, ribbonReach } from '../reach/reach'

export type Severity = 'error' | 'warning' | 'info'

export interface Issue {
  code: string
  severity: Severity
  refs: string[]
  message: string
  fix: string
}

const SUPPLIES = ['GND', '3V3', '5V']
const SOURCES = ['3V3', '5V']
const isGpio = (name: string) => /^GPIO\d+$/.test(name)
const gpioNames = (net: Net) => net.names.filter(isGpio)
const supplyNames = (net: Net) => net.names.filter((n) => SUPPLIES.includes(n))
/** A net driven by the Pi: a supply, GND, or a GPIO. */
const driven = (net: Net | undefined) => !!net && net.names.length > 0

/** Resistive two-terminal parts a signal passes through (for pulls, dividers and series limits). */
const RESISTIVE = new Set(['resistor', 'potentiometer', 'ldr', 'ntc'])

interface Ctx {
  doc: CircuitDoc
  nl: Netlist
  defs: PartDefs
  uses: PinUse[]
  netOf: (part: string, pin: string) => Net | undefined
}

/** Named nets reachable from `start` through resistive parts (at least one resistor crossed). */
function throughResistors(ctx: Ctx, start: string): Set<string> {
  const reached = new Set<string>()
  const seen = new Set([start])
  const queue = [start]
  while (queue.length) {
    const net = queue.shift()!
    for (const part of ctx.doc.parts) {
      const def = ctx.defs(part.defId)
      if (!RESISTIVE.has(def.sim.model)) continue
      const nets = def.pins
        .map((p) => ctx.nl.netOfPin.get(`${part.id}.${p.id}`))
        .filter((n): n is string => !!n)
      if (!nets.includes(net)) continue
      for (const other of nets) {
        if (seen.has(other)) continue
        seen.add(other)
        const n = ctx.nl.byName.get(other)
        if (n?.names.length) n.names.forEach((name) => reached.add(name))
        else queue.push(other)
      }
    }
  }
  return reached
}

const pinsWithModel = (ctx: Ctx, models: string[]) =>
  ctx.doc.parts.flatMap((part) => {
    const def = ctx.defs(part.defId)
    return models.includes(def.sim.model) ? [{ part, def }] : []
  })

/** Leads bend and LEDs splay, so bodies may touch this much before they count as colliding. */
const COLLISION_TOLERANCE_MM = 0.3

/** A body in plan view: its centre, a unit vector along the part's x axis, and half its size. */
interface Outline {
  part: string
  board: string
  c: Vec2
  u: Vec2
  half: Vec2
}

/**
 * The body sits centred on its pins (for a part whose body overhangs to one side, such as the
 * potentiometer, this is an approximation). bodyMm[0] runs along the pin-offset x axis: the lead
 * direction for two-lead parts, the board's rows for rigid ones unless turned 90°.
 */
function outline(ctx: Ctx, part: PartInstance): Outline | null {
  const def = ctx.defs(part.defId)
  if (def.footprint.kind === 'offboard') return null
  const holes = def.pins.map((p) => part.placement.pins[p.id] ?? null)
  const board = holes[0]?.board
  const instance = ctx.doc.boards.find((b) => b.id === board)
  if (!instance || holes.some((h) => !h || h.board !== board)) return null
  const points = holes.map((h) => holePosition(boardDef(instance.defId), h!))
  const c: Vec2 = [
    points.reduce((sum, p) => sum + p[0], 0) / points.length,
    points.reduce((sum, p) => sum + p[1], 0) / points.length
  ]
  let u: Vec2 = [1, 0]
  if (def.footprint.kind === 'flex-2lead') {
    const [a, b] = points as [Vec2, Vec2]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
  } else if (part.placement.rotationDeg === 90 || part.placement.rotationDeg === 270) {
    u = [0, 1]
  }
  return { part: part.id, board: board!, c, u, half: [def.bodyMm[0] / 2, def.bodyMm[1] / 2] }
}

/** How far two outlines overlap along their least-overlapping axis (separating-axis test). */
function overlapMm(a: Outline, b: Outline): number {
  const radius = (o: Outline, axis: Vec2) =>
    o.half[0] * Math.abs(o.u[0] * axis[0] + o.u[1] * axis[1]) +
    o.half[1] * Math.abs(-o.u[1] * axis[0] + o.u[0] * axis[1])
  const axes: Vec2[] = [a.u, [-a.u[1], a.u[0]], b.u, [-b.u[1], b.u[0]]]
  return Math.min(
    ...axes.map((axis) => {
      const gap = Math.abs((b.c[0] - a.c[0]) * axis[0] + (b.c[1] - a.c[1]) * axis[1])
      return radius(a, axis) + radius(b, axis) - gap
    })
  )
}

type Rule = (ctx: Ctx) => Issue[]

const RULES: Rule[] = [
  function shortSupply({ nl }) {
    return nl.nets
      .filter((n) => supplyNames(n).length > 1)
      .map((n) => ({
        code: 'SHORT_SUPPLY',
        severity: 'error' as const,
        refs: [n.name],
        message: `${supplyNames(n).join(' and ')} are joined: a direct short across the Pi's supply.`,
        fix: 'Remove the lead or part that connects them; a supply and GND must never touch.'
      }))
  },

  function gpioToSupply({ nl, uses }) {
    return nl.nets.flatMap((n) =>
      gpioNames(n)
        .filter(
          (g) => supplyNames(n).length && uses.some((u) => `GPIO${u.bcm}` === g && u.mode !== 'in')
        )
        .map((g) => ({
          code: 'GPIO_TO_SUPPLY_DIRECT',
          severity: 'error' as const,
          refs: [g],
          message: `${g} is an output wired straight to ${supplyNames(n).join('/')}. Driving it the other way shorts the pin.`,
          fix: `Put the load (with its resistor) between ${g} and the supply, never a bare lead.`
        }))
    )
  },

  function overvoltage(ctx) {
    const issues: Issue[] = []
    for (const n of ctx.nl.nets) {
      for (const g of gpioNames(n)) {
        if (n.names.includes('5V')) {
          issues.push({
            code: 'OVERVOLTAGE_GPIO',
            severity: 'error',
            refs: [g],
            message: `${g} is wired straight to 5V. Pi GPIOs are 3.3 V and not 5 V tolerant.`,
            fix: 'Remove the lead; feed 5 V signals through a divider or level shifter.'
          })
          continue
        }
        const pulled = throughResistors(ctx, n.name)
        if (pulled.has('5V') && !pulled.has('GND')) {
          issues.push({
            code: 'OVERVOLTAGE_GPIO',
            severity: 'error',
            refs: [g],
            message: `${g} is pulled up to 5V through a resistor, with nothing to bring it down to 3.3 V.`,
            fix: 'Pull up to 3V3 instead, or add the lower resistor of a divider to GND.'
          })
        }
      }
    }
    // Module outputs at more than 3.6 V, or I2C pull-ups to a 5 V supply.
    for (const part of ctx.doc.parts) {
      const def = ctx.defs(part.defId)
      // A module output's high level: the pin's own figure, the part's, or else its supply,
      // since a logic output swings to the rail that powers the module.
      const supplyPin = def.pins.find((p) => p.role === 'power')
      const supplyNet = supplyPin && ctx.netOf(part.id, supplyPin.id)
      const supplyV = supplyNet?.names.includes('5V')
        ? 5
        : supplyNet?.names.includes('3V3')
          ? 3.3
          : NaN
      for (const pin of def.pins) {
        const net = ctx.netOf(part.id, pin.id)
        if (!net || !gpioNames(net).length) continue
        const high = Number(
          def.sim.params[`${pin.id.toLowerCase()}OutputHighV`] ??
            def.sim.params.outputHighV ??
            supplyV
        )
        if (pin.electricalType === 'output' && def.footprint.kind === 'offboard' && high > 3.6) {
          issues.push({
            code: 'OVERVOLTAGE_GPIO',
            severity: 'error',
            refs: [part.id, gpioNames(net)[0]!],
            message: `${part.id} ${pin.label} drives ${high} V straight into ${gpioNames(net)[0]}, a 3.3 V pin.`,
            fix: `Add a divider (for example 1 kΩ over 2 kΩ) between ${part.id} ${pin.label} and the GPIO.`
          })
        }
      }
      // i2cPullupTo names the module's own supply pin that its I2C pull-ups go to.
      const pullTo = def.sim.params.i2cPullupTo
      const vcc = typeof pullTo === 'string' ? def.pins.find((p) => p.id === pullTo) : undefined
      if (vcc && ctx.netOf(part.id, vcc.id)?.names.includes('5V')) {
        const bus = def.pins.filter(
          (p) =>
            /^(SDA|SCL)$/i.test(p.id) &&
            gpioNames(ctx.netOf(part.id, p.id) ?? ({ names: [] } as unknown as Net)).length
        )
        if (bus.length) {
          issues.push({
            code: 'OVERVOLTAGE_GPIO',
            severity: 'warning',
            refs: [part.id],
            message: `${part.id} pulls its I2C lines up to its 5 V supply, so SDA/SCL reach the Pi at 5 V.`,
            fix: `Power ${part.id} from 3V3 if it supports it, remove its pull-ups, or use a level shifter.`
          })
        }
      }
    }
    return issues
  },

  function ledLimit(ctx) {
    return pinsWithModel(ctx, ['led', 'rgb-led']).flatMap(({ part, def }) => {
      const anodes = def.pins.filter((p) => p.role === 'anode')
      const cathodes = def.pins.filter((p) => p.role === 'cathode')
      return anodes.flatMap((a) =>
        cathodes
          .filter((k) => driven(ctx.netOf(part.id, a.id)) && driven(ctx.netOf(part.id, k.id)))
          .filter((k) => ctx.netOf(part.id, a.id)!.name !== ctx.netOf(part.id, k.id)!.name)
          .map((k) => ({
            code: 'LED_NO_LIMIT',
            severity: 'error' as const,
            refs: [part.id],
            message: `${part.id} (${a.label} to ${k.label}) sits between ${ctx.netOf(part.id, a.id)!.name} and ${ctx.netOf(part.id, k.id)!.name} with no resistor in series.`,
            fix: `Add a series resistor (220 Ω in the kit) on one side of ${part.id}.`
          }))
      )
    })
  },

  function ledReversed(ctx) {
    return pinsWithModel(ctx, ['led', 'rgb-led', 'diode']).flatMap(({ part, def }) => {
      const bad = def.pins.some(
        (p) =>
          (p.role === 'anode' && ctx.netOf(part.id, p.id)?.names.includes('GND')) ||
          (p.role === 'cathode' && SOURCES.some((s) => ctx.netOf(part.id, p.id)?.names.includes(s)))
      )
      if (!bad || def.sim.model === 'diode') return []
      return [
        {
          code: 'LED_REVERSED',
          severity: 'error' as const,
          refs: [part.id],
          message: `${part.id} is in backwards: its anode faces GND or its cathode faces the supply.`,
          fix: `Turn ${part.id} round: the longer leg (anode, +) goes toward the supply.`
        }
      ]
    })
  },

  function shorted(ctx) {
    return ctx.doc.parts.flatMap((part) => {
      const def = ctx.defs(part.defId)
      if (def.pins.length !== 2) return []
      const [a, b] = def.pins.map((p) => ctx.netOf(part.id, p.id)?.name)
      if (!a || a !== b) return []
      return [
        {
          code: 'COMPONENT_SHORTED',
          severity: 'warning' as const,
          refs: [part.id],
          message: `Both leads of ${part.id} are on net ${a}, so it does nothing.`,
          fix: `Move one lead of ${part.id} to another strip; the five holes of a strip are one node.`
        }
      ]
    })
  },

  function floatingInput(ctx) {
    return ctx.uses
      .filter((u) => u.mode === 'in' && (u.pull === undefined || u.pull === 'none'))
      .flatMap((u) => {
        const net = ctx.nl.byName.get(`GPIO${u.bcm}`)
        if (!net || net.members.every((m) => m.kind === 'header')) return []
        const pulled = throughResistors(ctx, net.name)
        if (supplyNames(net).length || [...pulled].some((n) => SUPPLIES.includes(n))) return []
        return [
          {
            code: 'FLOATING_INPUT',
            severity: 'warning' as const,
            refs: [`GPIO${u.bcm}`],
            message: `GPIO${u.bcm} is read as an input with no pull-up or pull-down, so it floats when the switch is open.`,
            fix: `Add pull_up_down=GPIO.PUD_UP (or PUD_DOWN) to its setup, or a 10 kΩ resistor to 3V3 or GND.`
          }
        ]
      })
  },

  function inductiveNoDriver(ctx) {
    return pinsWithModel(ctx, ['dc-motor', 'active-buzzer', 'passive-buzzer']).flatMap(
      ({ part, def }) => {
        const onGpio = def.pins.find(
          (p) => gpioNames(ctx.netOf(part.id, p.id) ?? ({ names: [] } as unknown as Net)).length
        )
        if (!onGpio) return []
        return [
          {
            code: 'INDUCTIVE_NO_DRIVER',
            severity: 'error' as const,
            refs: [part.id],
            message: `${part.id} (${def.name}) is driven straight from a GPIO. It draws more than a pin can supply, and coils kick back.`,
            fix: `Drive ${part.id} through a transistor (the kit's PN2222 with a 1 kΩ base resistor), with a flyback diode on coils.`
          }
        ]
      }
    )
  },

  function bjtBase(ctx) {
    return pinsWithModel(ctx, ['npn', 'pnp']).flatMap(({ part, def }) => {
      const base = def.pins.find((p) => p.role === 'base')
      const net = base && ctx.netOf(part.id, base.id)
      if (!net || !driven(net)) return []
      return [
        {
          code: 'BJT_NO_BASE_RESISTOR',
          severity: 'error' as const,
          refs: [part.id],
          message: `${part.id}'s base is wired straight to ${net.name}; the base-emitter junction will draw unlimited current.`,
          fix: `Add a base resistor (1 kΩ in the kit's designs) between ${net.name} and the base of ${part.id}.`
        }
      ]
    })
  },

  function dangling(ctx) {
    const issues: Issue[] = []
    // A lead end is dangling when nothing else is in its strip: the five holes are one node.
    const occupantsOfStrip = new Map<string, number>()
    for (const { hole } of occupancy(ctx.doc).holes.values()) {
      const board = ctx.doc.boards.find((b) => b.id === hole.board)
      if (!board) continue
      const key = stripKey(boardDef(board.defId), hole)
      occupantsOfStrip.set(key, (occupantsOfStrip.get(key) ?? 0) + 1)
    }
    for (const wire of ctx.doc.wires) {
      for (const end of [wire.a, wire.b]) {
        if (!('hole' in end)) continue
        const board = ctx.doc.boards.find((b) => b.id === end.hole.board)
        if (!board || occupantsOfStrip.get(stripKey(boardDef(board.defId), end.hole)) !== 1)
          continue
        issues.push({
          code: 'DANGLING',
          severity: 'warning',
          refs: [wire.id],
          message: `${wire.id} ends in ${holeKey(end.hole)}, a strip with nothing else in it.`,
          fix: 'Move that end into the strip of the part or rail it should reach.'
        })
      }
    }
    for (const part of ctx.doc.parts) {
      if (ctx.defs(part.defId).footprint.kind === 'offboard') continue
      for (const [pin, hole] of Object.entries(part.placement.pins)) {
        if (!hole) {
          issues.push({
            code: 'DANGLING',
            severity: 'warning',
            refs: [part.id],
            message: `${part.id} pin ${pin} is not placed in a hole.`,
            fix: `Place ${part.id} pin ${pin} on the board.`
          })
        }
      }
    }
    return issues
  },

  function railUnpowered({ nl }) {
    return nl.nets
      .filter((n) => !n.names.length && n.strips.some((s) => /:(top|bottom)[+-]/.test(s)))
      .map((n) => ({
        code: 'RAIL_UNPOWERED',
        severity: 'warning' as const,
        refs: n.strips.filter((s) => /:(top|bottom)[+-]/.test(s)),
        message: `A rail is in use but is not connected to 3V3, 5V or GND.`,
        fix: 'Run a male-male lead from the T-board 3V3, 5V or GND strip to the rail.'
      }))
  },

  function codePinMismatch({ nl, uses }) {
    const issues: Issue[] = []
    const configured = new Set(uses.map((u) => u.bcm))
    for (const bcm of configured) {
      const net = nl.byName.get(`GPIO${bcm}`)
      if (net && net.members.every((m) => m.kind === 'header')) {
        issues.push({
          code: 'CODE_PIN_MISMATCH',
          severity: 'warning',
          refs: [`GPIO${bcm}`],
          message: `The code sets up GPIO${bcm}, but nothing is wired to it.`,
          fix: `Wire GPIO${bcm}'s T-board strip to the circuit, or change the pin number in the code.`
        })
      }
    }
    for (const net of nl.nets) {
      for (const g of gpioNames(net)) {
        const wired = net.members.some((m) => m.kind !== 'header')
        if (wired && !configured.has(Number(g.slice(4)))) {
          issues.push({
            code: 'CODE_PIN_MISMATCH',
            severity: 'warning',
            refs: [g],
            message: `${g} is wired to the circuit, but the code never sets it up.`,
            fix: `Set up ${g} in the code, or move the lead to the pin the code uses.`
          })
        }
      }
    }
    return issues
  },

  function leadTooShort(ctx) {
    const issues: Issue[] = leadReach(ctx.doc, ctx.defs)
      .filter((r) => !r.ok)
      .map((r) => ({
        code: 'LEAD_TOO_SHORT',
        severity: 'warning' as const,
        refs: [r.wire],
        message: `${r.wire} needs about ${Math.ceil(r.requiredMm)} mm but is ${r.lengthMm} mm long.`,
        fix: `Use a longer lead, or move its ends closer together.`
      }))
    const ribbon = ribbonReach(ctx.doc)
    if (ribbon && !ribbon.ok) {
      issues.push({
        code: 'LEAD_TOO_SHORT',
        severity: 'warning',
        refs: ['ribbon'],
        message: `The ribbon needs about ${Math.ceil(ribbon.requiredMm)} mm between its sockets but is ${ribbon.lengthMm} mm long.`,
        fix: 'Move the Pi closer to the breadboard.'
      })
    }
    return issues
  },

  function collision(ctx) {
    const bodies = ctx.doc.parts.flatMap((part) => outline(ctx, part) ?? [])
    const issues: Issue[] = []
    for (const [i, a] of bodies.entries()) {
      for (const b of bodies.slice(i + 1)) {
        const depth = a.board === b.board ? overlapMm(a, b) : 0
        if (depth <= COLLISION_TOLERANCE_MM) continue
        issues.push({
          code: 'PHYSICAL_COLLISION',
          severity: 'warning',
          refs: [a.part, b.part],
          message: `${a.part} and ${b.part} overlap by about ${depth.toFixed(1)} mm, so they cannot both sit straight on the board.`,
          fix: `Move ${b.part} along the board, or leave an empty row between them.`
        })
      }
    }
    return issues
  },

  function noDatasheet(ctx) {
    const seen = new Set<string>()
    return ctx.doc.parts.flatMap((part) => {
      const def: PartDef = ctx.defs(part.defId)
      if (
        seen.has(def.id) ||
        (def.provenance.sources.length && !def.kitTags.includes('no datasheet'))
      )
        return []
      seen.add(def.id)
      return [
        {
          code: 'PART_WITHOUT_DATASHEET',
          severity: 'info' as const,
          refs: [part.id],
          message: `${def.name} has no datasheet, so its pin roles are only hints.`,
          fix: 'Find the datasheet and add it to the part.'
        }
      ]
    })
  }
]

export function erc(
  doc: CircuitDoc,
  defs: PartDefs,
  nl: Netlist = buildNetlist(doc, defs)
): Issue[] {
  const ctx: Ctx = {
    doc,
    nl,
    defs,
    uses: codePins(doc.code.source).uses,
    netOf: (part, pin) => {
      const name = nl.netOfPin.get(`${part}.${pin}`)
      return name ? nl.byName.get(name) : undefined
    }
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
  return RULES.flatMap((rule) => rule(ctx)).sort((a, b) => order[a.severity] - order[b.severity])
}
