// Regressions for the baseline's content defects D6–D13 (SPEC 16.2), checked on the rebuilt
// tutorials: each test states the defect it guards against.
import { describe, expect, it } from 'vitest'
import { partDef } from '../../core/defs/parts'
import { TUTORIALS } from '../../core/defs/tutorials'
import { erc } from '../../core/erc/erc'
import type { CircuitDoc } from '../../core/model/types'
import { netlist } from '../../core/netlist/netlist'
import { buildSteps } from '../../core/steps/steps'
import inventory from '../inventory.json'

const tutorial = (id: string) => TUTORIALS.find((t) => t.meta.id === id)!
const pages = import.meta.glob('../../pages/*', { eager: true, query: '?raw', import: 'default' })

/** The net of a part's pin, by the pin's role or id. */
function nets(doc: CircuitDoc) {
  const nl = netlist(doc, partDef)
  const net = (part: string, pin: string) => nl.byName.get(nl.netOfPin.get(`${part}.${pin}`)!)!
  const pinWithRole = (part: string, role: string) => {
    const p = doc.parts.find((x) => x.id === part)!
    return partDef(p.defId).pins.find((q) => q.role === role)!.id
  }
  return { nl, net, pinWithRole }
}

/** Parts of a model whose pins sit on the given net. */
const onNet = (doc: CircuitDoc, n: ReturnType<typeof nets>, net: string, model: string) =>
  doc.parts.filter(
    (p) =>
      partDef(p.defId).sim.model === model &&
      partDef(p.defId).pins.some((pin) => n.nl.netOfPin.get(`${p.id}.${pin.id}`) === net)
  )

describe('baseline content defects', () => {
  it('D6: no page names a tutorial by a literal id, and the Breadboard page with its led_blink fallback is gone', () => {
    expect(Object.keys(pages).some((f) => f.includes('BreadboardPage'))).toBe(false)
    for (const [file, text] of Object.entries(pages)) {
      for (const t of TUTORIALS)
        expect(String(text), `${file} names ${t.meta.id}`).not.toContain(`'${t.meta.id}'`)
      expect(String(text)).not.toContain('led_blink')
    }
    expect(TUTORIALS[0]!.meta.id).toBe('blinking-led')
  })

  it.each(TUTORIALS.map((t) => [t.meta.id, t] as const))(
    'D7: %s places every part and draws its leads',
    (_id, t) => {
      const { table, steps } = buildSteps(t.doc, partDef)
      expect(t.doc.parts.length).toBeGreaterThan(0)
      expect(t.doc.wires.length).toBeGreaterThan(0)
      expect(table.filter((r) => r.at === 'not placed')).toEqual([])
      expect(steps.length).toBeGreaterThan(t.doc.parts.length)
    }
  )

  it('D8: the active buzzer is switched by a transistor on a closed path, not driven from a GPIO', () => {
    const { doc } = tutorial('active-buzzer')
    const n = nets(doc)
    const buzzer = doc.parts.find((p) => partDef(p.defId).sim.model === 'active-buzzer')!
    const low = n.net(buzzer.id, '-')
    const [q] = onNet(doc, n, low.name, 'npn')
    expect(q, 'a transistor on the buzzer’s negative lead').toBeDefined()
    expect(n.net(q!.id, n.pinWithRole(q!.id, 'collector')).name).toBe(low.name)
    expect(n.net(q!.id, n.pinWithRole(q!.id, 'emitter')).name).toBe('GND')
    expect(n.net(buzzer.id, '+').names.some((x) => x.startsWith('GPIO'))).toBe(false)
    expect(erc(doc, partDef).filter((i) => i.code === 'INDUCTIVE_NO_DRIVER')).toEqual([])
  })

  it('D9: the button input is held by its own resistor, proven with the internal pull off', () => {
    const { doc, meta } = tutorial('button')
    const proofs = meta.assertions.filter((a) =>
      Object.values(a.gpio).some((g) => g.mode === 'in' && g.pull === 'off')
    )
    const reads = proofs.flatMap((a) =>
      a.expect.filter((e) => 'read' in e).map((e) => ('is' in e ? e.is : ''))
    )
    expect(reads.sort()).toEqual(['high', 'low'])
    const n = nets(doc)
    const gpio = n.nl.nets.find((x) => x.names.includes('GPIO18'))!
    expect(onNet(doc, n, gpio.name, 'resistor').length).toBeGreaterThan(0)
  })

  it('D10: the RGB LED is one part on adjacent rows, each colour lit by its own GPIO', () => {
    const { doc, meta } = tutorial('rgb-led')
    const rgb = doc.parts.filter((p) => partDef(p.defId).sim.model === 'rgb-led')
    expect(rgb).toHaveLength(1)
    const rows = Object.values(rgb[0]!.placement.pins).map((h) => (h?.area === 'main' ? h.row : -1))
    expect(Math.max(...rows) - Math.min(...rows)).toBe(3)
    const lit = new Set(
      meta.assertions.flatMap((a) =>
        a.expect.flatMap((e) => ('die' in e && (e.currentA.min ?? 0) > 0 ? [e.die] : []))
      )
    )
    for (const c of ['R', 'G', 'B'])
      expect(
        [...lit].some((d) => d.endsWith(`.${c}`)),
        c
      ).toBe(true)
  })

  it('D11: the 4-digit display has a switched common line for every digit', () => {
    const { doc } = tutorial('four-digit-seven-segment')
    const n = nets(doc)
    const display = doc.parts.find((p) => partDef(p.defId).sim.model === 'seven-segment-4digit')!
    const digits = partDef(display.defId).pins.filter((p) => /^D\d$/.test(p.label))
    expect(digits).toHaveLength(4)
    const switches = digits.map((d) => {
      const net = n.net(display.id, d.id).name
      return [...onNet(doc, n, net, 'pnp'), ...onNet(doc, n, net, 'npn')].map((q) => q.id)
    })
    expect(switches.every((s) => s.length === 1)).toBe(true)
    expect(new Set(switches.flat()).size).toBe(4)
  })

  it('D12: the HC-SR04 is wired, and ECHO reaches its GPIO only through a divider', () => {
    const { doc } = tutorial('ultrasonic')
    const n = nets(doc)
    const sonar = doc.parts.find((p) => p.defId === 'hc-sr04')!
    for (const pin of ['VCC', 'TRIG', 'ECHO', 'GND']) {
      expect(n.net(sonar.id, pin).members.length, pin).toBeGreaterThan(1)
    }
    expect(n.net(sonar.id, 'ECHO').names.some((x) => x.startsWith('GPIO'))).toBe(false)
    expect(erc(doc, partDef).filter((i) => i.code === 'OVERVOLTAGE_GPIO')).toEqual([])
  })

  it('D13: the kit’s 17 projects come first in the kit’s order, and extras that need other parts say so', () => {
    const kit = TUTORIALS.filter((t) => t.meta.kitProject)
    expect(kit.map((t) => t.meta.kitProject)).toEqual([
      '1.1.1',
      '1.1.2',
      '1.1.3',
      '1.1.4',
      '1.2.1',
      '1.2.2',
      '1.3.1',
      '1.3.2',
      '1.3.3',
      '2.1.1',
      '2.1.2',
      '2.1.3',
      '2.2.1',
      '2.2.2',
      '2.2.3',
      '3.1.1',
      '3.1.2'
    ])
    expect(TUTORIALS.slice(0, 17)).toEqual(kit)
    const owned = new Set(
      [...inventory.kit.items, ...inventory.tboardKit.items].flatMap((i) =>
        i.partId ? [i.partId] : []
      )
    )
    for (const t of TUTORIALS) {
      const missing = t.doc.parts.filter((p) => !owned.has(p.defId)).map((p) => p.defId)
      expect(
        t.meta.tags.includes('needs parts not in the kit'),
        `${t.meta.id}: ${missing.join(', ')}`
      ).toBe(missing.length > 0)
    }
  })
})
