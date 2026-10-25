// The seeded inventory (SPEC 7): its structure, its part ids, and the kit's list as transcribed.
import { describe, expect, it } from 'vitest'
import { PART_DEFS } from '../core/defs/parts'
import raw from './inventory.json'

interface Item {
  name: string
  quantity: number | null
  partId: string | null
  notes?: string
  leadKind?: string
  lengthMm?: number
}
interface Inventory {
  kit: {
    name: string
    source: { page: string; image: string; imageSha256: string; retrieved: string }
    items: Item[]
  }
  tboardKit: { name: string; source: { note: string }; items: Item[] }
  leads: { countsEnforced: boolean; note: string }
}

const inventory: Inventory = raw

const LEAD_KINDS = new Set(['dupont-mm', 'dupont-mf', 'dupont-ff', 'solid-arc', 'solid-flat'])

const allItems = [...inventory.kit.items, ...inventory.tboardKit.items]

describe('inventory structure', () => {
  it('names both kits and cites the kit image', () => {
    expect(inventory.kit.name).toBe('SunFounder Basic Starter Kit for Raspberry Pi')
    expect(inventory.tboardKit.name).toBe('40-pin T-type GPIO extension kit')
    const { source } = inventory.kit
    expect(source.page).toMatch(/^https:\/\/basic-starter-kit-for-raspberry-pi\.readthedocs\.io\//)
    expect(source.image).toMatch(/^https:\/\/.+\.(jpg|png)$/)
    expect(source.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('records the image hash as 64 hex characters', () => {
    expect(inventory.kit.source.imageSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gives every item a name, a quantity, a part id and optional extras of the right type', () => {
    for (const item of allItems) {
      expect(item.name.length, JSON.stringify(item)).toBeGreaterThan(0)
      expect(item).toHaveProperty('quantity')
      expect(item).toHaveProperty('partId')
      if (item.notes !== undefined) expect(typeof item.notes).toBe('string')
      if (item.lengthMm !== undefined) expect(item.lengthMm).toBeGreaterThan(0)
    }
  })

  it('uses only part ids the library defines, or null', () => {
    for (const item of allItems) {
      if (item.partId !== null) {
        expect(PART_DEFS.has(item.partId), `${item.name}: ${item.partId}`).toBe(true)
      }
    }
  })

  it('uses positive whole-number quantities, or null when the list shows none', () => {
    for (const item of allItems) {
      if (item.quantity !== null) {
        expect(Number.isInteger(item.quantity) && item.quantity > 0, item.name).toBe(true)
      }
    }
  })

  it('uses only known lead kinds', () => {
    for (const item of allItems) {
      if (item.leadKind !== undefined) {
        expect(LEAD_KINDS.has(item.leadKind), `${item.name}: ${item.leadKind}`).toBe(true)
      }
    }
  })

  it('lists no name twice within a kit', () => {
    for (const items of [inventory.kit.items, inventory.tboardKit.items]) {
      const names = items.map((item) => item.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('enforces no lead counts', () => {
    expect(inventory.leads.countsEnforced).toBe(false)
  })
})

describe('inventory contents as transcribed', () => {
  // [name, quantity, partId] exactly as read from the kit's component list image.
  const distinctive: [string, number | null, string | null][] = [
    ['ADS7830 Module', 1, 'ads7830-module'],
    ['20mm Dot Matrix Module', 1, 'led-matrix-8x8'],
    ['Relay Module', 1, 'relay-module-5v'],
    ['Resistor 10kΩ', 10, 'resistor'],
    ['Resistor 220Ω', 20, 'resistor'],
    ['Resistor 1kΩ', 10, 'resistor'],
    ['Slide Switch', 2, null],
    ['Photoresistor', 2, 'ldr'],
    ['LED-RGB', 1, 'rgb-led-cc'],
    ['LED-Red', null, 'led'],
    ['LED-Yellow', null, 'led'],
    ['LED-Green', null, 'led'],
    ['LED-White', null, 'led'],
    ['LED-Blue', null, 'led'],
    ['Thermistor', 1, 'ntc-10k'],
    ['Tilt Switch', 1, 'tilt-switch'],
    ['Capacitor 104', 4, 'ceramic-capacitor'],
    ['F-M DuPont Cable', 10, null],
    ['F-F DuPont Cable', 10, null],
    ['9V Battery Connector', 1, null],
    ['1N4007', 2, 'diode-1n4007'],
    ['L293D', 1, 'ic-l293d'],
    ['PN2222', 2, 'pn2222'],
    ['1 Dight 7-segment Display', 1, 'seven-segment-cc'],
    ['Potentiometer (10k)', 1, 'potentiometer-10k'],
    ['74HC595', 2, 'ic-74hc595'],
    ['Power Supply Module', 1, 'breadboard-power-module'],
    ['DHT11 Temperature and Humidity Module', 1, 'dht11-module'],
    ['65 Jumper Wire', 1, null],
    ['Button', 5, 'tact-switch-6mm']
  ]

  it.each(distinctive)('keeps %s', (name, quantity, partId) => {
    const item = inventory.kit.items.find((candidate) => candidate.name === name)
    expect(item, name).toBeDefined()
    expect(item?.quantity).toBe(quantity)
    expect(item?.partId).toBe(partId)
  })

  it('keeps the kit leads as female-male and female-female', () => {
    const kinds = Object.fromEntries(
      inventory.kit.items.filter((item) => item.leadKind).map((item) => [item.name, item.leadKind])
    )
    expect(kinds).toEqual({ 'F-M DuPont Cable': 'dupont-mf', 'F-F DuPont Cable': 'dupont-ff' })
  })

  it('keeps the T-board kit as listed', () => {
    expect(
      inventory.tboardKit.items.map((item) => [item.name, item.quantity, item.leadKind ?? null])
    ).toEqual([
      ['40-pin rainbow ribbon cable, 200 mm', 1, null],
      ['T-type GPIO extension board', 1, null],
      ['830-point breadboard', 1, null],
      ['Dupont lead, male-male, 200 mm', 10, 'dupont-mm'],
      ['Dupont lead, male-female, 200 mm', 10, 'dupont-mf']
    ])
  })
})
