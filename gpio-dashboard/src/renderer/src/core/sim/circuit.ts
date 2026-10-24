// A CircuitDoc as an MNA circuit (SPEC 9): one node per net (GND is node 0), the Pi's supplies
// and GPIOs as sources, each part as its device models, and behavioural parts stamped through
// their drives and loads. Device objects persist across solves so nonlinear devices keep their
// junction-limiting state; only their parameters change.
import { RP1, outputResistanceOhm, type DriveMa } from '../constants/rp1'
import type { CircuitDoc, PartDef, PartInstance } from '../model/types'
import { netlist, type Netlist, type PartDefs } from '../netlist/netlist'
import type { Behavior, BehaviorFactory, EnvValue } from './behavior'
import { Bjt, Capacitor, Diode, Resistor, Switch, TheveninSource, VoltageSource } from './devices'
import { bjtParams, ledParams, rectifierParams, type DiodeParams } from './fit'
import type { Device, SolveOptions } from './solver'
import { solveDc } from './solver'

/** A PWM output toggles at frequencyHz, high for `duty` of each period from startS. */
export interface Pwm {
  frequencyHz: number
  duty: number
  startS: number
}

export type GpioState =
  | { mode: 'out'; level: boolean; driveMa?: DriveMa; pwm?: Pwm }
  | { mode: 'in'; pull: 'up' | 'down' | 'off' }

/** An LED die: its anode and cathode nodes, its junction node, and its datasheet test current. */
export interface Die {
  part: string
  die: string
  ifTestA: number
  device: Diode
  series: Resistor
}

interface BehaviorSlot {
  part: string
  behavior: Behavior
  pinNode: Map<string, number>
}

/** Below this the two ends of a potentiometer track are joined by a numerical floor, not 0 Ω. */
const MIN_TRACK_OHMS = 0.1
const OPEN_OHMS = 1e12

export class Circuit {
  readonly nl: Netlist
  readonly nodeOfNet = new Map<string, number>()
  nodes = 1
  readonly dies: Die[] = []
  readonly behaviors: BehaviorSlot[] = []
  readonly supplies = new Map<'3V3' | '5V', VoltageSource>()
  private readonly fixed: Device[] = []
  /** Re-reads part inputs (switch state, wiper, lux, temperature) before each solve. */
  private readonly inputs: ((env: (part: string) => Record<string, EnvValue>) => void)[] = []
  readonly gpioNodes = new Map<number, number>()

  constructor(
    readonly doc: CircuitDoc,
    readonly defs: PartDefs,
    factories: Partial<Record<PartDef['sim']['model'], BehaviorFactory>>
  ) {
    this.nl = netlist(doc, defs)
    for (const net of this.nl.nets) {
      this.nodeOfNet.set(net.name, net.name === 'GND' ? 0 : this.nodes++)
    }
    for (const name of ['3V3', '5V'] as const) {
      const node = this.nodeOfNet.get(name)
      if (node === undefined) continue
      const source = new VoltageSource(node, 0, name === '3V3' ? 3.3 : 5)
      this.supplies.set(name, source)
      this.fixed.push(source)
    }
    for (const net of this.nl.nets) {
      const bcm = /^GPIO(\d+)$/.exec(net.name)
      if (bcm) this.gpioNodes.set(Number(bcm[1]), this.nodeOfNet.get(net.name)!)
    }
    // The board's fixed 1.8 kΩ pull-ups on GPIO2/3 (ADR-0009).
    const v33 = this.nodeOfNet.get('3V3')
    for (const bcm of RP1.i2cBoardPullupPins) {
      const node = this.gpioNodes.get(bcm)
      if (node !== undefined && v33 !== undefined) {
        this.fixed.push(new Resistor(node, v33, RP1.i2cBoardPullupOhm))
      }
    }
    for (const part of doc.parts) this.addPart(part, defs(part.defId), factories)
  }

  pinNode(part: string, pin: string): number {
    const net = this.nl.netOfPin.get(`${part}.${pin}`)
    const node = net === undefined ? undefined : this.nodeOfNet.get(net)
    if (node === undefined) throw new Error(`${part}.${pin} has no net`)
    return node
  }

  private internalNode(): number {
    return this.nodes++
  }

  private addDie(part: string, die: string, a: number, k: number, p: DiodeParams, ifTestA: number) {
    const junction = this.internalNode()
    const series = new Resistor(a, junction, p.rs)
    const device = new Diode(junction, k, p.is, p.n)
    this.dies.push({ part, die, ifTestA, device, series })
    this.fixed.push(series, device)
  }

  private addPart(
    part: PartInstance,
    def: PartDef,
    factories: Partial<Record<PartDef['sim']['model'], BehaviorFactory>>
  ) {
    const node = (pin: string) => this.pinNode(part.id, pin)
    const byRole = (role: string) => def.pins.find((p) => p.role === role)!.id
    const prop = <T>(key: string): T => (part.props[key] ?? def.properties[key]?.default) as T
    const p = def.sim.params
    const factory = factories[def.sim.model]
    if (factory) {
      const pinNode = new Map(def.pins.map((pin) => [pin.id, node(pin.id)]))
      this.behaviors.push({ part: part.id, behavior: factory(def, part.props), pinNode })
      return
    }
    switch (def.sim.model) {
      case 'resistor':
        this.fixed.push(new Resistor(node('1'), node('2'), prop<number>('resistance')))
        return
      case 'capacitor':
      case 'electrolytic': {
        const [a, b] = def.pins.map((pin) => node(pin.id)) as [number, number]
        this.fixed.push(new Capacitor(a, b, prop<number>('capacitance')))
        return
      }
      case 'diode': {
        const d = rectifierParams(def)
        this.addDie(
          part.id,
          'D',
          node(byRole('anode')),
          node(byRole('cathode')),
          d,
          Number(p.vfTestA)
        )
        return
      }
      case 'led': {
        const key = `${prop<string>('color')}.${prop<string>('size')}`
        const ifTestA = Number(p[`${key}.ifTestMa`]) / 1000
        this.addDie(part.id, 'D', node('A'), node('K'), ledParams(def, key), ifTestA)
        return
      }
      case 'rgb-led': {
        const common = String(p.commonPin)
        for (const colour of ['R', 'G', 'B']) {
          const key = { R: 'red', G: 'green', B: 'blue' }[colour]!
          const [a, k] =
            p.commonType === 'anode' ? [node(common), node(colour)] : [node(colour), node(common)]
          this.addDie(
            part.id,
            colour,
            a,
            k,
            ledParams(def, key),
            Number(p[`${key}.ifTestMa`]) / 1000
          )
        }
        return
      }
      case 'seven-segment':
      case 'seven-segment-4digit':
      case 'led-matrix-8x8':
      case 'bar-graph-10':
        this.addLedArray(part.id, def)
        return
      case 'npn':
      case 'pnp': {
        const b = bjtParams(def)
        const [c, base, e] = ['collector', 'base', 'emitter'].map((r) => node(byRole(r)))
        this.fixed.push(new Bjt(c!, base!, e!, b.is, b.bf, b.br, b.polarity))
        return
      }
      case 'tact-switch': {
        const [a, b] = def.internalConnections.length
          ? def.internalConnections.map((group) => group[0]!)
          : def.pins.map((pin) => pin.id)
        const sw = new Switch(node(a!), node(b!), false, Number(p.contactMaxOhm ?? 0.1))
        this.fixed.push(sw)
        this.inputs.push((env) => (sw.closed = env(part.id).pressed === true))
        return
      }
      case 'tilt-switch': {
        const sw = new Switch(node('1'), node('2'), true, Number(p.contactMaxOhm))
        this.fixed.push(sw)
        this.inputs.push((env) => (sw.closed = env(part.id).tilted !== true))
        return
      }
      case 'potentiometer': {
        const total = Number(p.totalResistanceOhm)
        const lower = new Resistor(node('1'), node('2'), total / 2)
        const upper = new Resistor(node('2'), node('3'), total / 2)
        this.fixed.push(lower, upper)
        this.inputs.push((env) => {
          const f = Math.min(Math.max(Number(env(part.id).wiper) / 100, 0), 1)
          lower.ohms = Math.max(total * f, MIN_TRACK_OHMS)
          upper.ohms = Math.max(total * (1 - f), MIN_TRACK_OHMS)
        })
        return
      }
      case 'ldr': {
        // Datasheet resistance at 10 lux and its gamma: R = R10 · (lux / 10)^-γ.
        const r = new Resistor(node('1'), node('2'), Number(p.r10LuxOhm))
        this.fixed.push(r)
        this.inputs.push((env) => {
          const lux = Math.max(Number(env(part.id).lux), 1e-3)
          r.ohms = Number(p.r10LuxOhm) * (lux / 10) ** -Number(p.gamma)
        })
        return
      }
      case 'ntc': {
        // Beta equation from the datasheet's R25 and B25/50.
        const r = new Resistor(node('1'), node('2'), Number(p.r25Ohm))
        this.fixed.push(r)
        this.inputs.push((env) => {
          const kelvin = Number(env(part.id).temperatureC) + 273.15
          r.ohms = Number(p.r25Ohm) * Math.exp(Number(p.betaK) * (1 / kelvin - 1 / 298.15))
        })
        return
      }
      case 'passive-buzzer':
        this.fixed.push(new Resistor(node('+'), node('-'), Number(p.coilOhm)))
        return
      case 'power-module': {
        const on = prop<boolean>('switchOn')
        if (!on) return
        this.fixed.push(
          new VoltageSource(node('1'), node('2'), Number(p.out33V)),
          new VoltageSource(node('5'), node('2'), Number(p.out5V))
        )
        return
      }
      default:
        throw new Error(`${def.id}: no simulation model for ${def.sim.model}`)
    }
  }

  /** Displays and bar graphs: one die per labelled anode–cathode pair. */
  private addLedArray(part: string, def: PartDef) {
    const node = (pin: string) => this.pinNode(part, pin)
    const die = ledParams(def, '')
    const ifTestA = Number(def.sim.params.ifTestMa) / 1000
    const anodes = def.pins.filter((pin) => pin.role === 'anode')
    const cathodes = def.pins.filter((pin) => pin.role === 'cathode')
    const label = (pin: { label: string }) => pin.label
    const add = (
      a: { id: string; label: string },
      k: { id: string; label: string },
      name: string
    ) => this.addDie(part, name, node(a.id), node(k.id), die, ifTestA)
    switch (def.sim.model) {
      case 'seven-segment': {
        const common = def.pins.find((pin) => pin.label === 'COM')!
        const segments = def.pins.filter((pin) => pin.label !== 'COM')
        for (const s of segments) {
          if (def.sim.params.commonType === 'anode') add(common, s, label(s))
          else add(s, common, label(s))
        }
        return
      }
      case 'seven-segment-4digit':
        // Common anode per digit; segment cathodes shared across digits.
        for (const digit of anodes)
          for (const s of cathodes) add(digit, s, `${digit.label}.${s.label}`)
        return
      case 'led-matrix-8x8':
        for (const row of anodes)
          for (const col of cathodes) add(row, col, `${row.label}.${col.label}`)
        return
      case 'bar-graph-10':
        for (const a of anodes) {
          const k = cathodes.find((c) => c.label === `K${a.label.slice(1)}`)!
          add(a, k, a.label)
        }
        return
    }
  }

  /** GPIO drives and pulls for one stimulus. */
  private gpioDevices(
    gpio: ReadonlyMap<number, GpioState>,
    averaged: Map<number, number>
  ): Device[] {
    const v33 = this.nodeOfNet.get('3V3')!
    const out: Device[] = []
    for (const [bcm, node] of this.gpioNodes) {
      const state = gpio.get(bcm) ?? { mode: 'in', pull: 'off' }
      if (state.mode === 'out') {
        const level = averaged.get(bcm)
        const high = level ?? (state.level ? 1 : 0)
        const ohms = outputResistanceOhm(high >= 0.5 ? 'high' : 'low', state.driveMa)
        out.push(new TheveninSource(node, 0, RP1.vddioV * high, ohms))
      } else if (state.pull === 'up') {
        out.push(new Resistor(node, v33, RP1.pullUpOhm.typ))
      } else if (state.pull === 'down') {
        out.push(new Resistor(node, 0, RP1.pullDownOhm.typ))
      }
    }
    return out
  }

  private behaviorDevices(): Device[] {
    const out: Device[] = []
    for (const { behavior, pinNode } of this.behaviors) {
      for (const [pin, drive] of Object.entries(behavior.drives())) {
        out.push(
          new TheveninSource(pinNode.get(pin)!, pinNode.get(drive.ref)!, drive.volts, drive.ohms)
        )
      }
      for (const load of behavior.loads()) {
        if (load.ohms < OPEN_OHMS)
          out.push(new Resistor(pinNode.get(load.a)!, pinNode.get(load.b)!, load.ohms))
      }
    }
    return out
  }

  /**
   * One DC solve at a stimulus. `averaged` overrides output pins with a level between 0 and 1
   * (a PWM pin's duty while the display is averaged). Behaviours are not updated here.
   */
  solve(
    gpio: ReadonlyMap<number, GpioState>,
    env: (part: string) => Record<string, EnvValue>,
    guess?: Float64Array,
    averaged: Map<number, number> = new Map(),
    extra: Device[] = [],
    options?: SolveOptions
  ): { x: Float64Array; devices: Device[] } {
    for (const read of this.inputs) read(env)
    const devices = [
      ...this.fixed,
      ...this.gpioDevices(gpio, averaged),
      ...this.behaviorDevices(),
      ...extra
    ]
    const branches = devices.reduce((n, d) => n + d.branchCount, 0)
    const start = guess && guess.length === this.nodes - 1 + branches ? guess : undefined
    return { x: solveDc(this.nodes, devices, options, start), devices }
  }
}
