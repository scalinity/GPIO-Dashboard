// Wiring text, hole-by-hole wiring tables and build steps, generated from a circuit document
// (SPEC 1.4, 11.7, 16.1). Nothing here is written per tutorial: every hole, value and colour comes
// from the document and the part definitions.
import { boardDef } from '../defs/boards'
import { railHoleRow, stripKey } from '../geometry/breadboard'
import type { CircuitDoc, Endpoint, HoleRef, PartDef, PartInstance, Wire } from '../model/types'
import { netlist, type PartDefs } from '../netlist/netlist'
import { leadReach } from '../reach/reach'

const COLOURS = [
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'violet',
  'grey',
  'white'
]
const TOLERANCE_BAND: Record<string, string> = {
  '1%': 'brown',
  '2%': 'red',
  '5%': 'gold',
  '10%': 'silver'
}

/** Resistor colour bands: 4 bands for 5% and wider, 5 bands (three digits) for 1% and 2%. */
export function resistorBands(ohms: number, tolerance: string): string[] {
  const digits = tolerance === '1%' || tolerance === '2%' ? 3 : 2
  let exponent = Math.floor(Math.log10(ohms)) - (digits - 1)
  let significant = Math.round(ohms / 10 ** exponent)
  if (significant >= 10 ** digits) {
    significant /= 10
    exponent += 1
  }
  const bands = String(significant)
    .padStart(digits, '0')
    .split('')
    .map((d) => COLOURS[Number(d)]!)
  const multiplier = exponent >= 0 ? COLOURS[exponent]! : exponent === -1 ? 'gold' : 'silver'
  return [...bands, multiplier, TOLERANCE_BAND[tolerance] ?? 'gold']
}

/** 220 → "220 Ω", 4700 → "4.7 kΩ", 1e6 → "1 MΩ". */
export function ohmsText(ohms: number): string {
  const [scale, unit] = ohms >= 1e6 ? [1e6, 'MΩ'] : ohms >= 1e3 ? [1e3, 'kΩ'] : [1, 'Ω']
  return `${+(ohms / scale).toPrecision(3)} ${unit}`
}

/** 1e-7 → "100 nF", 2.2e-4 → "220 µF". */
export function faradsText(farads: number): string {
  const [scale, unit] =
    farads >= 1e-6 ? [1e-6, 'µF'] : farads >= 1e-9 ? [1e-9, 'nF'] : [1e-12, 'pF']
  return `${+(farads / scale).toPrecision(3)} ${unit}`
}

const KIND: Record<Wire['kind'], string> = {
  'dupont-mm': 'male–male jumper',
  'dupont-mf': 'male–female jumper',
  'dupont-ff': 'female–female jumper',
  'solid-arc': 'solid arched jumper',
  'solid-flat': 'solid flat jumper'
}

/** Words for a part pin's role where polarity matters. */
const POLARITY: Record<string, string> = {
  anode: 'anode (longer leg)',
  cathode: 'cathode (shorter leg, flat side)',
  positive: '+ (longer leg)',
  negative: '− (shorter leg)'
}

export interface TableRow {
  ref: string
  what: string
  /** A part pin's label, or "end a" / "end b" for a lead. */
  pin: string
  at: string
  net: string
}

export interface BuildStep {
  kind: 'tboard' | 'rails' | 'passive' | 'component' | 'signal' | 'ground'
  refs: string[]
  holes: HoleRef[]
  text: string
  why?: string
  mistake?: string
}

export interface Steps {
  table: TableRow[]
  steps: BuildStep[]
}

export function holeText(doc: CircuitDoc, hole: HoleRef): string {
  const board = doc.boards.length > 1 ? `board ${hole.board}, ` : ''
  if (hole.area === 'main') return `${board}row ${hole.row} column ${hole.col}`
  const instance = doc.boards.find((b) => b.id === hole.board)
  const row = instance ? railHoleRow(boardDef(instance.defId), hole.index) : hole.index
  const [side, sign] = [
    hole.rail.startsWith('top') ? 'top' : 'bottom',
    hole.rail.endsWith('+') ? '+' : '−'
  ]
  return `${board}the ${side} ${sign} rail at row ${Math.round(row * 10) / 10}`
}

function endpointText(doc: CircuitDoc, defs: PartDefs, end: Endpoint): string {
  if ('hole' in end) return holeText(doc, end.hole)
  const part = doc.parts.find((p) => p.id === end.pin.part)!
  const label = defs(part.defId).pins.find((p) => p.id === end.pin.pin)!.label
  return `${part.id}'s ${label} pin`
}

/** "220 Ω resistor (red, red, brown, gold)", "red 5 mm LED", or the part's name. */
export function partText(part: PartInstance, def: PartDef): string {
  const prop = (key: string) => part.props[key] ?? def.properties[key]?.default
  switch (def.sim.model) {
    case 'resistor': {
      const ohms = Number(prop('resistance'))
      return `${ohmsText(ohms)} resistor (${resistorBands(ohms, String(prop('tolerance'))).join(', ')})`
    }
    case 'capacitor':
    case 'electrolytic':
      return `${faradsText(Number(prop('capacitance')))} ${def.name.toLowerCase()}`
    case 'led':
      return `${String(prop('color'))} ${String(prop('size')).replace('mm', ' mm')} LED`
    default:
      return def.name
  }
}

function placedPins(part: PartInstance, def: PartDef) {
  return def.pins.flatMap((pin) => {
    const hole = part.placement.pins[pin.id]
    return hole ? [{ pin, hole }] : []
  })
}

function partStep(doc: CircuitDoc, part: PartInstance, def: PartDef): BuildStep {
  const pins = placedPins(part, def)
  const what = partText(part, def)
  const at = (h: HoleRef) => holeText(doc, h)
  let text: string
  if (def.footprint.kind === 'offboard') {
    text = `Place ${part.id}, the ${what}, beside the board; leads connect it in later steps.`
  } else if (pins.length === 2 && pins.some((p) => POLARITY[p.pin.role])) {
    text = `Insert ${part.id}, the ${what}: ${pins.map((p) => `${POLARITY[p.pin.role] ?? p.pin.label} in ${at(p.hole)}`).join(', ')}.`
  } else if (pins.length === 2) {
    text = `Insert ${part.id}, the ${what}, from ${at(pins[0]!.hole)} to ${at(pins[1]!.hole)}.`
  } else {
    const first = pins[0]!
    const last = pins.at(-1)!
    const across =
      def.footprint.kind === 'rigid' && def.footprint.straddleTrench ? ' across the trench' : ''
    text = `Insert ${part.id}, the ${what},${across} with pin ${first.pin.id} (${first.pin.label}) in ${at(first.hole)} and pin ${last.pin.id} (${last.pin.label}) in ${at(last.hole)}.`
  }
  return {
    kind: def.category === 'passive' ? 'passive' : 'component',
    refs: [part.id],
    holes: pins.map((p) => p.hole),
    text
  }
}

function wireStep(
  doc: CircuitDoc,
  defs: PartDefs,
  wire: Wire,
  lengthMm: number,
  kind: BuildStep['kind']
): BuildStep {
  const [a, b] = [wire.a, wire.b]
  // Name the female end first on a male–female lead: it goes on the module pin.
  const [first, second] = wire.kind === 'dupont-mf' && 'hole' in a && 'pin' in b ? [b, a] : [a, b]
  const ends =
    wire.kind === 'dupont-mf'
      ? `with its female end on ${endpointText(doc, defs, first)} and its male end in ${endpointText(doc, defs, second)}`
      : `from ${endpointText(doc, defs, first)} to ${endpointText(doc, defs, second)}`
  return {
    kind,
    refs: [wire.id],
    holes: [a, b].flatMap((e) => ('hole' in e ? [e.hole] : [])),
    text: `Use a ${wire.color} ${lengthMm / 10} cm ${KIND[wire.kind]} (${wire.id}) ${ends}.`
  }
}

export function buildSteps(doc: CircuitDoc, defs: PartDefs): Steps {
  const nl = netlist(doc, defs)
  const pinNet = (part: string, pin: string) => nl.netOfPin.get(`${part}.${pin}`) ?? ''
  const holeNet = (hole: HoleRef) => {
    const board = doc.boards.find((b) => b.id === hole.board)
    return board ? (nl.netOfStrip.get(stripKey(boardDef(board.defId), hole)) ?? '') : ''
  }
  const endNet = (end: Endpoint) =>
    'hole' in end ? holeNet(end.hole) : pinNet(end.pin.part, end.pin.pin)

  const table: TableRow[] = []
  for (const part of doc.parts) {
    const def = defs(part.defId)
    const what = partText(part, def)
    for (const pin of def.pins) {
      const hole = part.placement.pins[pin.id]
      table.push({
        ref: part.id,
        what,
        pin: pin.label,
        at: hole
          ? holeText(doc, hole)
          : def.footprint.kind === 'offboard'
            ? 'module pin'
            : 'not placed',
        net: pinNet(part.id, pin.id)
      })
    }
  }
  const reach = new Map(leadReach(doc, defs).map((r) => [r.wire, r.lengthMm]))
  for (const wire of doc.wires) {
    const what = `${wire.color} ${KIND[wire.kind]}`
    for (const [end, label] of [
      [wire.a, 'end a'],
      [wire.b, 'end b']
    ] as const) {
      table.push({
        ref: wire.id,
        what,
        pin: label,
        at: endpointText(doc, defs, end),
        net: endNet(end)
      })
    }
  }

  const tb = doc.controller.tboard
  const steps: BuildStep[] = [
    {
      kind: 'tboard',
      refs: ['tboard'],
      holes: [],
      text: `Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row ${tb.pin1Row}, its two pin rows in columns ${tb.colPair.replace('/', ' and ')}, header toward row ${tb.orientation === 'header-toward-row-0' ? 0 : 'the far end'}.`
    }
  ]
  const isRail = (e: Endpoint) => 'hole' in e && e.hole.area === 'rail'
  const isSupply = (e: Endpoint) => ['3V3', '5V', 'GND'].includes(endNet(e))
  const rows = (s: BuildStep) =>
    Math.min(...s.holes.map((h) => (h.area === 'main' ? h.row : 0)), Infinity)
  const byRow = (a: BuildStep, b: BuildStep) => rows(a) - rows(b)

  const rails = doc.wires.filter(
    (w) => (isRail(w.a) || isRail(w.b)) && (isSupply(w.a) || isSupply(w.b))
  )
  const parts = doc.parts.map((p) => partStep(doc, p, defs(p.defId)))
  const others = doc.wires.filter((w) => !rails.includes(w))
  const ground = others.filter((w) => endNet(w.a) === 'GND' || endNet(w.b) === 'GND')
  const signal = others.filter((w) => !ground.includes(w))
  const wireSteps = (ws: Wire[], kind: BuildStep['kind']) =>
    ws.map((w) => wireStep(doc, defs, w, reach.get(w.id) ?? 200, kind)).sort(byRow)

  steps.push(
    ...wireSteps(rails, 'rails'),
    ...parts.filter((s) => s.kind === 'passive').sort(byRow),
    ...parts.filter((s) => s.kind === 'component').sort(byRow),
    ...wireSteps(signal, 'signal'),
    ...wireSteps(ground, 'ground')
  )
  for (const step of steps) {
    const note = doc.buildStepAnnotations?.[step.refs[0]!]
    if (note?.why) step.why = note.why
    if (note?.mistake) step.mistake = note.mistake
  }
  return { table, steps }
}
