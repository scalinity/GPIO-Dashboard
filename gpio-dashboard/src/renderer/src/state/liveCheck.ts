// Where the Pi's real pins contradict the document (SPEC 14.4): a pure comparison of telemetry with
// what the document and its code expect, and the plain-language reason and likely cause for each
// contradiction. It reads; it never touches a pin. Four kinds:
//   - drives-input: a pin is driven as an output where the circuit reads it (a button, a sensor).
//   - not-driven: a program is running, yet a pin its code drives as an output is still an input.
//   - wrong-function: a pin has an alternate function (or none) where the document needs the other.
//   - impossible-level: an input reads a level its circuit cannot produce (nothing on the net can
//     change, and the simulation reads the other level).
// The press and LED checkpoints cover what telemetry alone cannot: a button's orientation.
import { INPUT_PROPS } from '../panels/inputs'
import type { PinUse } from '../core/code/pins'
import { PI_HEADER } from '../core/defs/controllers'
import type { CircuitDoc, PartDef } from '../core/model/types'
import type { Netlist, PartDefs } from '../core/netlist/netlist'
import type { ReadLevel } from '../workers/simHost'
import { i2cAddresses } from './checkpoints'
import type { LivePin } from './liveStore'

export type DivergenceKind = 'drives-input' | 'not-driven' | 'wrong-function' | 'impossible-level'

export interface LiveDivergence {
  /** `kind:bcm`, stable while the contradiction holds. */
  id: string
  bcm: number
  kind: DivergenceKind
  severity: 'error' | 'warning'
  title: string
  /** What telemetry shows against what the document expects. */
  why: string
  /** The likeliest reason, and what to look at. */
  cause: string
  /** The parts of the document involved. */
  refs: string[]
}

/** What a pin should be doing, by the code if it names the pin, else by what is wired to it. */
export interface Expectation {
  use: 'input' | 'output' | 'pwm' | 'i2c'
  why: string
  refs: string[]
}

/** How long a program may run before a pin it should drive counts as missed (ms). */
export const SETUP_GRACE_MS = 3000

const PASSES = new Set([
  'resistor',
  'led',
  'diode',
  'capacitor',
  'electrolytic',
  'tact-switch',
  'switch',
  'tilt-switch'
])

interface Around {
  /** Every part pin on the pin's net or on the nets joined to it through passive parts. */
  pins: { part: string; def: PartDef; role: string; type: string }[]
  /** Something on the way can change what the pin reads: a switch, a sensor, a driven output. */
  varies: boolean
}

/** Walks from a GPIO net through passive two-terminal parts, stopping at supplies and other GPIOs. */
function around(doc: CircuitDoc, nl: Netlist, defs: PartDefs, bcm: number): Around {
  const start = nl.byName.get(`GPIO${bcm}`)
  const out: Around = { pins: [], varies: false }
  if (!start) return out
  const seen = new Set([start.name])
  const queue = [start.name]
  while (queue.length) {
    const net = queue.shift()!
    for (const part of doc.parts) {
      const def = defs(part.defId)
      const mine = def.pins.filter((p) => nl.netOfPin.get(`${part.id}.${p.id}`) === net)
      if (!mine.length) continue
      for (const pin of mine) {
        out.pins.push({ part: part.id, def, role: pin.role, type: pin.electricalType })
        if (pin.electricalType === 'output') out.varies = true
      }
      if (Object.keys(def.properties).some((k) => INPUT_PROPS.has(k))) out.varies = true
      if (!PASSES.has(def.sim.model)) continue
      for (const pin of def.pins) {
        const other = nl.netOfPin.get(`${part.id}.${pin.id}`)
        if (other && !seen.has(other) && !nl.byName.get(other)?.names.length) {
          seen.add(other)
          queue.push(other)
        }
      }
    }
  }
  return out
}

/** What the document, then the code, expects of a pin; null where nothing is wired to it. */
export function expectedUse(
  doc: CircuitDoc,
  nl: Netlist,
  defs: PartDefs,
  uses: PinUse[],
  bcm: number
): Expectation | null {
  const net = nl.byName.get(`GPIO${bcm}`)
  const wired = !!net && net.members.some((m) => m.kind !== 'header')
  if (!wired) return null
  const found = around(doc, nl, defs, bcm)
  const coded = uses.filter((u) => u.bcm === bcm)
  const modes = new Set(coded.map((u) => u.mode))
  const refs = [...new Set(found.pins.map((p) => p.part))]
  const module = found.pins.find((p) => i2cAddresses(p.def).length > 0)
  if (modes.has('i2c') || (module && (bcm === 2 || bcm === 3)))
    return {
      use: 'i2c',
      why: module
        ? `${module.part} (${module.def.name}) is an I2C part on GPIO${bcm}`
        : `the code uses GPIO${bcm} as an I2C pin`,
      refs
    }
  if (modes.has('pwm'))
    return { use: 'pwm', why: `the code drives GPIO${bcm} with PWM (line ${coded[0]!.line})`, refs }
  if (modes.has('out'))
    return {
      use: 'output',
      why: `the code sets up GPIO${bcm} as an output (line ${coded[0]!.line})`,
      refs
    }
  if (modes.has('in'))
    return {
      use: 'input',
      why: `the code sets up GPIO${bcm} as an input (line ${coded[0]!.line})`,
      refs
    }
  const reads = found.pins.filter((p) => p.type === 'output' || p.role === 'switch')
  const drives = found.pins.filter(
    (p) => p.type === 'input' || p.role === 'base' || p.role === 'anode' || p.role === 'cathode'
  )
  if (reads.length && !drives.length)
    return {
      use: 'input',
      why: `${reads[0]!.part} (${reads[0]!.def.name}) is wired to GPIO${bcm} as something to read`,
      refs
    }
  if (drives.length && !reads.length)
    return {
      use: 'output',
      why: `${drives[0]!.part} (${drives[0]!.def.name}) is wired to GPIO${bcm} as something to drive`,
      refs
    }
  return null
}

export interface LiveCheckInput {
  doc: CircuitDoc
  nl: Netlist
  defs: PartDefs
  pins: Record<number, LivePin>
  /** The program's GPIO use, read from its code. */
  uses: PinUse[]
  /** How long a program has been running on the Pi (ms); null when none is. */
  runningMs: number | null
  /** What each input reads in the simulation of the document with the real pins applied. */
  reads: Record<number, ReadLevel>
}

const gp = (n: number) => `GPIO${n}`
const alt = (pin: LivePin) =>
  pin.function ? `its alternate function ${pin.function}` : 'an alternate function'
const levelText = (l: string) => l.toUpperCase()

/** Every contradiction between the Pi's pins and the document as of now. */
export function liveDivergences(i: LiveCheckInput): LiveDivergence[] {
  const out: LiveDivergence[] = []
  for (const pin of Object.values(i.pins)) {
    if (pin.bcm < 2 || pin.bcm > 27) continue
    // A pin with nothing wired to it has no document to differ from.
    const net = i.nl.byName.get(gp(pin.bcm))
    if (!net?.members.some((m) => m.kind !== 'header')) continue
    const expect = expectedUse(i.doc, i.nl, i.defs, i.uses, pin.bcm)
    const near = around(i.doc, i.nl, i.defs, pin.bcm)
    const refs = expect?.refs ?? [...new Set(near.pins.map((p) => p.part))]
    const mk = (
      kind: DivergenceKind,
      severity: LiveDivergence['severity'],
      title: string,
      why: string,
      cause: string
    ): void => {
      out.push({ id: `${kind}:${pin.bcm}`, bcm: pin.bcm, kind, severity, title, why, cause, refs })
    }

    if (expect?.use === 'input' && pin.direction === 'out')
      mk(
        'drives-input',
        'error',
        `${gp(pin.bcm)} is driven as an output`,
        `The Pi drives ${gp(pin.bcm)} ${levelText(pin.level)}, but ${expect.why}, so the circuit reads it.`,
        `A program may still be running, or an earlier run left the pin as an output. An output facing a button or a sensor can short the two together: stop the program and check that the pin returns to an input.`
      )
    else if (
      (expect?.use === 'output' || expect?.use === 'pwm') &&
      pin.direction === 'in' &&
      i.runningMs !== null &&
      i.runningMs >= SETUP_GRACE_MS
    )
      mk(
        'not-driven',
        'warning',
        `${gp(pin.bcm)} should be driven`,
        `The program has been running for ${Math.round(i.runningMs / 1000)} s, but ${gp(pin.bcm)} is still an input, and ${expect.why}.`,
        `The program has not reached the line that sets the pin up, has given the pin back, or has stopped. Read its output in the Code tab.`
      )

    if (expect?.use === 'i2c') {
      if (!(pin.direction === 'alt' && /SDA|SCL/.test(pin.function ?? '')))
        mk(
          'wrong-function',
          'warning',
          `${gp(pin.bcm)} is not an I2C pin right now`,
          `An I2C part is wired to ${gp(pin.bcm)}, but pinctrl reports ${pin.direction === 'alt' ? alt(pin) : `a plain ${pin.direction === 'in' ? 'input' : 'GPIO'}`}.`,
          `I2C is probably off on the Pi (sudo raspi-config, Interface Options, I2C), or another function has the pin.`
        )
    } else if (expect && pin.direction === 'alt' && expect.use !== 'pwm')
      mk(
        'wrong-function',
        'warning',
        `${gp(pin.bcm)} has an alternate function`,
        `The document uses ${gp(pin.bcm)} as a plain ${expect.use}, but pinctrl reports ${alt(pin)}.`,
        `Something else has the pin: a serial console, an SPI or I2C overlay, or hardware PWM. A plain GPIO there will not behave as the circuit expects.`
      )

    // A pin read as an input whose circuit holds one level and cannot change.
    const sim = i.reads[pin.bcm]
    if (
      pin.direction === 'in' &&
      (sim === 'high' || sim === 'low') &&
      sim !== pin.level &&
      !near.varies
    )
      mk(
        'impossible-level',
        'warning',
        `${gp(pin.bcm)} reads ${levelText(pin.level)}, the circuit holds it ${levelText(sim)}`,
        `With the pin as the Pi has it (${pin.pull === 'none' ? 'no pull' : `pull-${pin.pull}`}), the simulation of this document reads ${gp(pin.bcm)} ${levelText(sim)}, and nothing on its net is a switch or a sensor.`,
        `A lead may be missing or a row off, or something on the bench is not in the document. Switch Board Sense on in the Board tab to rank the likely causes.`
      )
  }
  return out
}

/** The header's physical pin number for a BCM GPIO, or null. */
export const physicalPin = (bcm: number): number | null =>
  PI_HEADER.find((p) => p.bcm === bcm)?.physical ?? null
