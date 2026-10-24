// Current in each lead (SPEC 11.5), from a simulation snapshot. The simulator solves one node per
// net, so a lead has no current of its own: it is found here by Kirchhoff's current law on the
// graph of rigid clusters (a strip with what stands in it, a module pin, the header's supply pins)
// joined by leads, each lead counted as the same small resistance. What each cluster takes from
// or gives to its net comes from the snapshot where it names it: LED dies, GPIOs and the 3V3 and
// 5V supplies, and from Ohm's law for the resistive parts. A part the snapshot has no current
// for (an IC, a motor, a relay, a transistor) takes the rest of its net, shared between its
// clusters; a net with nothing like that leaves the rest unassigned.
import { boardDef } from '../core/defs/boards'
import { headerNetName, PI_HEADER } from '../core/defs/controllers'
import { stripKey } from '../core/geometry/breadboard'
import { tboardPinHole } from '../core/geometry/tboard'
import type { CircuitDoc, Endpoint, HoleRef, PartDef } from '../core/model/types'
import { netlist, type PartDefs } from '../core/netlist/netlist'
import type { EnvValue } from '../core/sim/behavior'
import type { Snapshot } from '../core/sim/session'
import { dieEnds } from './dies'

/** Below this a lead carries nothing worth drawing. */
const NEGLIGIBLE_A = 1e-9

type Env = Record<string, Record<string, EnvValue>>

/** Union-find over node ids. */
class Clusters {
  private parent = new Map<string, string>()
  find(x: string): string {
    const p = this.parent.get(x)
    if (p === undefined) return (this.parent.set(x, x), x)
    if (p === x) return x
    const root = this.find(p)
    this.parent.set(x, root)
    return root
  }
  union(a: string, b: string): void {
    this.parent.set(this.find(a), this.find(b))
  }
}

/** A resistive part's resistance(s) between its pins, or null when it is not one. */
function resistances(
  def: PartDef,
  value: (key: string) => unknown
): { a: string; b: string; ohms: number }[] | null {
  const p = def.sim.params
  const [first, second, third] = def.pins.map((x) => x.id)
  const num = (v: unknown) => Number(v)
  switch (def.sim.model) {
    case 'resistor':
      return [{ a: first!, b: second!, ohms: num(value('resistance')) }]
    case 'passive-buzzer':
      return [{ a: first!, b: second!, ohms: num(p.coilOhm) }]
    case 'ldr':
      return [
        {
          a: first!,
          b: second!,
          ohms: num(p.r10LuxOhm) * (Math.max(num(value('lux')), 1e-3) / 10) ** -num(p.gamma)
        }
      ]
    case 'ntc': {
      const kelvin = num(value('temperatureC')) + 273.15
      return [
        {
          a: first!,
          b: second!,
          ohms: num(p.r25Ohm) * Math.exp(num(p.betaK) * (1 / kelvin - 1 / 298.15))
        }
      ]
    }
    case 'potentiometer': {
      const total = num(p.totalResistanceOhm)
      const f = Math.min(Math.max(num(value('wiper')) / 100, 0), 1)
      return [
        { a: first!, b: second!, ohms: Math.max(total * f, 0.1) },
        { a: second!, b: third!, ohms: Math.max(total * (1 - f), 0.1) }
      ]
    }
    case 'capacitor':
    case 'electrolytic':
      return []
    default:
      return null
  }
}

/** Solves L v = b with node 0 held at 0 (Gaussian elimination; the graphs here are tiny). */
function potentials(n: number, edges: [number, number][], b: number[]): number[] {
  const m = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0))
  for (const [i, j] of edges) {
    m[i]![i]! += 1
    m[j]![j]! += 1
    m[i]![j]! -= 1
    m[j]![i]! -= 1
  }
  b.forEach((x, i) => (m[i]![n] = x))
  const v = new Array<number>(n).fill(0)
  // Rows and columns 1..n-1 (node 0 is the reference).
  for (let c = 1; c < n; c++) {
    let pivot = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r
    ;[m[c], m[pivot]] = [m[pivot]!, m[c]!]
    if (Math.abs(m[c]![c]!) < 1e-12) continue
    for (let r = c + 1; r < n; r++) {
      const k = m[r]![c]! / m[c]![c]!
      for (let q = c; q <= n; q++) m[r]![q]! -= k * m[c]![q]!
    }
  }
  for (let c = n - 1; c >= 1; c--) {
    let s = m[c]![n]!
    for (let q = c + 1; q < n; q++) s -= m[c]![q]! * v[q]!
    v[c] = Math.abs(m[c]![c]!) < 1e-12 ? 0 : s / m[c]![c]!
  }
  return v
}

/**
 * Each lead's current in amps, positive from its end `a` to its end `b` (conventional current).
 * `env` holds the part inputs set since the document loaded.
 */
export function wireCurrents(
  doc: CircuitDoc,
  snapshot: Snapshot,
  defs: PartDefs,
  env: Env
): Record<string, number> {
  if (snapshot.error) return {}
  const nl = netlist(doc, defs)
  const boards = new Map(doc.boards.map((b) => [b.id, b]))
  const strip = (hole: HoleRef) =>
    `strip:${stripKey(boardDef(boards.get(hole.board)!.defId), hole)}`
  const at = (end: Endpoint) =>
    'hole' in end ? strip(end.hole) : `pin:${end.pin.part}.${end.pin.pin}`

  // Rigid clusters, joined as the netlist joins them except for the leads.
  const rigid = new Clusters()
  const supply = new Map<string, number>()
  for (let pin = 1; pin <= 40; pin++) {
    rigid.union(`hdr:${pin}`, strip(tboardPinHole(doc.controller.tboard, pin)))
    const name = headerNetName(pin)
    if (name.startsWith('GPIO')) continue
    const first = supply.get(name)
    if (first === undefined) supply.set(name, pin)
    else rigid.union(`hdr:${first}`, `hdr:${pin}`)
  }
  const parts = doc.parts.map((part) => ({ part, def: defs(part.defId) }))
  for (const { part, def } of parts) {
    for (const pin of def.pins) {
      const hole = part.placement.pins[pin.id]
      if (hole) rigid.union(`pin:${part.id}.${pin.id}`, strip(hole))
    }
    for (const group of def.internalConnections)
      for (const pin of group.slice(1))
        rigid.union(`pin:${part.id}.${group[0]}`, `pin:${part.id}.${pin}`)
  }

  // What each cluster takes in from outside (amps), and the clusters of parts nothing is known for.
  const inflow = new Map<string, number>()
  const add = (node: string, amps: number) => {
    const root = rigid.find(node)
    inflow.set(root, (inflow.get(root) ?? 0) + amps)
  }
  const unknown = new Set<string>()
  const volts = (part: string, pin: string) =>
    snapshot.nets[nl.netOfPin.get(`${part}.${pin}`) ?? ''] ?? 0
  for (const { part, def } of parts) {
    const pinNode = (pin: string) => `pin:${part.id}.${pin}`
    const value = (key: string) =>
      env[part.id]?.[key] ?? part.props[key] ?? def.properties[key]?.default
    const dies = dieEnds(def)
    if (Object.keys(dies).length) {
      for (const [key, d] of Object.entries(dies)) {
        const amps = snapshot.dies[`${part.id}.${key}`]?.currentA ?? 0
        add(pinNode(d.a), -amps)
        add(pinNode(d.k), amps)
      }
      continue
    }
    const resistive = resistances(def, value)
    if (resistive) {
      for (const { a, b, ohms } of resistive) {
        const amps = (volts(part.id, a) - volts(part.id, b)) / ohms
        add(pinNode(a), -amps)
        add(pinNode(b), amps)
      }
      continue
    }
    for (const pin of def.pins) unknown.add(rigid.find(pinNode(pin.id)))
  }
  for (const [bcm, { currentA }] of Object.entries(snapshot.gpio)) {
    const pin = PI_HEADER.findIndex((p) => p.bcm === Number(bcm)) + 1
    if (pin > 0) add(`hdr:${pin}`, currentA)
  }
  for (const name of ['3V3', '5V'] as const) {
    const pin = supply.get(name)
    if (pin !== undefined) add(`hdr:${pin}`, snapshot.rails[name])
  }

  // The leads as edges between clusters, grouped into connected components.
  const roots = new Map<string, number>()
  const index = (node: string) => {
    const root = rigid.find(node)
    if (!roots.has(root)) roots.set(root, roots.size)
    return roots.get(root)!
  }
  const edges = doc.wires.map((w) => [index(at(w.a)), index(at(w.b))] as [number, number])
  const names = [...roots.keys()]
  const component = new Clusters()
  edges.forEach(([i, j]) => component.union(String(i), String(j)))
  const grounds = new Set(
    PI_HEADER.flatMap((p, i) =>
      headerNetName(i + 1) === 'GND' ? [rigid.find(`hdr:${i + 1}`)] : []
    )
  )

  const currents: Record<string, number> = {}
  const members = new Map<string, number[]>()
  edges.forEach(([i, j]) => {
    for (const x of [i, j]) {
      const list = members.get(component.find(String(x))) ?? []
      if (!list.includes(x)) members.set(component.find(String(x)), [...list, x])
    }
  })
  for (const nodes of members.values()) {
    const local = new Map(nodes.map((n, k) => [n, k]))
    const b = nodes.map((n) => inflow.get(names[n]!) ?? 0)
    // The rest of the net goes to its parts with no current of their own, else to ground.
    const rest = -b.reduce((s, x) => s + x, 0)
    let sinks = nodes.filter((n) => unknown.has(names[n]!))
    if (!sinks.length) sinks = nodes.filter((n) => grounds.has(names[n]!))
    sinks.forEach((n) => (b[local.get(n)!]! += rest / sinks.length))
    const v = potentials(
      nodes.length,
      edges.flatMap(([i, j]) =>
        local.has(i) && local.has(j) && i !== j
          ? [[local.get(i)!, local.get(j)!] as [number, number]]
          : []
      ),
      b
    )
    doc.wires.forEach((w, k) => {
      const [i, j] = edges[k]!
      if (!local.has(i) || !local.has(j) || i === j) return
      const amps = v[local.get(i)!]! - v[local.get(j)!]!
      currents[w.id] = Math.abs(amps) < NEGLIGIBLE_A ? 0 : amps
    })
  }
  for (const w of doc.wires) currents[w.id] ??= 0
  return currents
}
