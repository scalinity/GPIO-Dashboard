// Where a hardware checkpoint hangs in a build (SPEC 11.7, 14.4), derived from the circuit.
//
// A checkpoint belongs on the first step after which the thing it checks is complete in the
// netlist of the board as built to that step:
//   - i2c-scan: an I2C module (a part whose definition gives `i2cAddress`) has SDA on GPIO2, SCL on
//     GPIO3, its supply on 3V3 or 5V and its ground on GND.
//   - press: a push button (a tact switch, or the joystick's SW pin with its module powered) has a
//     GPIO on one side and a supply or ground on the other.
//   - toggle-led: an LED, or a pin of an LED display, has a GPIO at one end of its current path and
//     a supply or ground at the other, through series resistors only, or through the contacts of
//     a relay module that the GPIO switches. At most three per build, the first to be completed,
//     and never on GPIO0 to GPIO3 (the ID EEPROM and the I2C bus).
// So the step that finishes the wiring offers the check, and a half-built circuit offers nothing.
// The rule reads the document, so a project, a fork and an assistant build get checkpoints exactly
// as a tutorial does.
import { partDef } from '../core/defs/parts'
import type { CircuitDoc, PartDef, PartInstance } from '../core/model/types'
import { netlist, type Netlist, type PartDefs } from '../core/netlist/netlist'
import { docUpTo } from '../core/sense/buildSteps'
import type { BuildStep } from '../core/steps/steps'
import type { TutorialMeta } from '../core/tutorials/tutorial'

export type Checkpoint = TutorialMeta['checkpoints'][number]

/** How many LED toggles a build offers: an RGB LED's three colours, not a bar's ten. */
export const MAX_LED_TOGGLES = 3
/** GPIO0 and GPIO1 are the HAT ID EEPROM's; GPIO2 and GPIO3 are the I2C bus, with board pull-ups. */
const NEVER_DRIVEN = new Set([0, 1, 2, 3])
const LED_MODELS = new Set(['led', 'rgb-led', 'bar-graph-10'])
const PUSH_BUTTON_MODELS = new Set(['tact-switch', 'switch'])
const SUPPLIES = ['3V3', '5V']

const gpioOf = (name: string): number | null => {
  const n = /^GPIO(\d+)$/.exec(name)?.[1]
  return n === undefined ? null : Number(n)
}

/** The expected addresses of an I2C module: its own, then the one it can be strapped to. */
export function i2cAddresses(def: PartDef): number[] {
  return ['i2cAddress', 'i2cAddressAlt']
    .map((key) => def.sim.params[key])
    .filter((v): v is string => typeof v === 'string')
    .map((v) => Number.parseInt(v, 16))
    .filter(Number.isInteger)
}

/** The board as built to one step, with its nets. */
interface Board {
  doc: CircuitDoc
  defs: PartDefs
  nl: Netlist
}

const netOf = (b: Board, part: PartInstance, pin: string): string | undefined =>
  b.nl.netOfPin.get(`${part.id}.${pin}`)

const namesOf = (b: Board, net: string | undefined): string[] =>
  (net && b.nl.byName.get(net)?.names) || []

interface Reach {
  /** Named nets (supplies, ground, GPIOs) at the end of a chain of series resistors. */
  names: Set<string>
  /** The GPIOs that switch the relays crossed on the way. */
  gates: Set<number>
}

/**
 * What a net reaches through series resistors and, if `relays`, through the contacts of relay
 * modules (normally open to common), which a GPIO on the module's signal pin closes.
 */
function reach(b: Board, start: string | undefined, relays: boolean): Reach {
  const out: Reach = { names: new Set(), gates: new Set() }
  if (!start) return out
  const seen = new Set([start])
  const queue = [start]
  const step = (from: string, to: string | undefined) => {
    if (to && !seen.has(to)) {
      seen.add(to)
      queue.push(to)
    }
    return from
  }
  while (queue.length) {
    const net = queue.shift()!
    namesOf(b, net).forEach((n) => out.names.add(n))
    for (const part of b.doc.parts) {
      const def = b.defs(part.defId)
      if (def.sim.model === 'resistor') {
        const ends = def.pins.map((p) => netOf(b, part, p.id))
        if (ends.includes(net)) ends.forEach((e) => step(net, e))
      } else if (relays && def.sim.model === 'relay-module') {
        const [no, com] = [netOf(b, part, 'NO'), netOf(b, part, 'COM')]
        if (net !== no && net !== com) continue
        step(net, net === no ? com : no)
        for (const name of namesOf(b, netOf(b, part, 'S'))) {
          const gpio = gpioOf(name)
          if (gpio !== null) out.gates.add(gpio)
        }
      }
    }
  }
  return out
}

/** The GPIOs whose current path through the LED part is complete, lowest first. */
function ledGpios(b: Board, part: PartInstance, def: PartDef): number[] {
  const pins = def.pins
    .filter((pin) => pin.role === 'anode' || pin.role === 'cathode')
    .map((pin) => ({
      role: pin.role,
      plain: reach(b, netOf(b, part, pin.id), false),
      switched: reach(b, netOf(b, part, pin.id), true)
    }))
  const gpios = new Set<number>()
  for (const near of pins) {
    // A high level turns an anode-side pin on, so the cathode side must reach ground; a low level
    // turns a cathode-side pin on, so the anode side must reach a supply.
    const far = pins.filter((p) => p.role !== near.role)
    const closes = (via: 'plain' | 'switched') =>
      far.some((p) =>
        near.role === 'anode' ? p[via].names.has('GND') : SUPPLIES.some((s) => p[via].names.has(s))
      )
    const sourced = (via: 'plain' | 'switched') =>
      near.role === 'anode'
        ? SUPPLIES.some((s) => near[via].names.has(s))
        : near[via].names.has('GND')
    if (closes('plain'))
      for (const n of near.plain.names) if (gpioOf(n) !== null) gpios.add(gpioOf(n)!)
    // The LED's own supply runs through a relay's contacts: the GPIO on the relay switches it.
    if (near.switched.gates.size && sourced('switched') && closes('switched'))
      near.switched.gates.forEach((g) => gpios.add(g))
  }
  return [...gpios].filter((g) => !NEVER_DRIVEN.has(g)).sort((a, c) => a - c)
}

/** The GPIO a push button reaches, once its other side is on a supply or ground. */
function buttonGpio(b: Board, part: PartInstance, def: PartDef): number | null {
  const supplied = (names: string[]) =>
    names.includes('GND') || SUPPLIES.some((s) => names.includes(s))
  if (PUSH_BUTTON_MODELS.has(def.sim.model)) {
    // The terminals are joined in pairs inside the part, so each pair is one side.
    const sides = def.internalConnections.length
      ? def.internalConnections
      : def.pins.map((p) => [p.id])
    const named = sides.map((side) => namesOf(b, netOf(b, part, side[0]!)))
    for (const side of named) {
      const gpio = side.map(gpioOf).find((g) => g !== null)
      if (gpio !== undefined && gpio !== null && named.some((o) => o !== side && supplied(o)))
        return gpio
    }
    return null
  }
  if (def.sim.model === 'joystick') {
    const at = (id: string) => namesOf(b, netOf(b, part, id))
    const gpio = at('SW')
      .map(gpioOf)
      .find((g) => g !== null)
    return gpio !== undefined && gpio !== null && at('GND').includes('GND') && supplied(at('VCC'))
      ? gpio
      : null
  }
  return null
}

function i2cComplete(b: Board, part: PartInstance, def: PartDef): boolean {
  const at = (label: string) => {
    const pin = def.pins.find((p) => p.label === label)
    return pin ? namesOf(b, netOf(b, part, pin.id)) : []
  }
  return (
    at('SDA').includes('GPIO2') &&
    at('SCL').includes('GPIO3') &&
    at('GND').includes('GND') &&
    SUPPLIES.some((s) => at('VCC').includes(s))
  )
}

const checkable = (def: PartDef) =>
  LED_MODELS.has(def.sim.model) ||
  PUSH_BUTTON_MODELS.has(def.sim.model) ||
  def.sim.model === 'joystick' ||
  i2cAddresses(def).length > 0

/** The checkpoints of a build, each on the step that completes what it checks, in step order. */
export function deriveCheckpoints(
  doc: CircuitDoc,
  steps: BuildStep[],
  defs: PartDefs = partDef
): Checkpoint[] {
  const parts = doc.parts.filter((p) => checkable(defs(p.defId)))
  if (!parts.length) return []
  const found: Checkpoint[] = []
  const have = new Set<string>()
  let toggles = 0
  steps.forEach((step, index) => {
    const built = docUpTo(doc, steps, index)
    const placed = new Set(built.parts.map((p) => p.id))
    if (!parts.some((p) => placed.has(p.id))) return
    const board: Board = { doc: built, defs, nl: netlist(built, defs) }
    const afterStep = step.refs[0]!
    for (const part of parts) {
      if (!placed.has(part.id)) continue
      const def = defs(part.defId)
      if (
        i2cAddresses(def).length &&
        !have.has(`i2c:${part.id}`) &&
        i2cComplete(board, part, def)
      ) {
        have.add(`i2c:${part.id}`)
        found.push({ kind: 'i2c-scan', afterStep, addresses: i2cAddresses(def) })
      }
      const button = buttonGpio(board, part, def)
      if (button !== null && !have.has(`press:${part.id}`)) {
        have.add(`press:${part.id}`)
        found.push({ kind: 'press', afterStep, part: part.id, gpio: button })
      }
      if (!LED_MODELS.has(def.sim.model)) continue
      for (const gpio of ledGpios(board, part, def)) {
        const key = `led:${part.id}:${gpio}`
        if (have.has(key) || toggles >= MAX_LED_TOGGLES) continue
        have.add(key)
        toggles += 1
        found.push({ kind: 'toggle-led', afterStep, part: part.id, gpio })
      }
    }
  })
  return found
}

/** The checkpoints that hang on a step. */
export const checkpointsAfter = (plan: Checkpoint[], step: BuildStep | undefined): Checkpoint[] =>
  step ? plan.filter((c) => step.refs.includes(c.afterStep)) : []
