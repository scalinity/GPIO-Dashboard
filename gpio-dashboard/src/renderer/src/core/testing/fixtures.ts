// Small part definitions and document builders for core tests. They stand in for the content
// library so the engine can be tested without depending on any particular datasheet.
import { newDoc } from '../model/defaults'
import type {
  CircuitDoc,
  Endpoint,
  HoleRef,
  MainColumn,
  PartDef,
  PartInstance,
  Wire
} from '../model/types'

const base = {
  kitTags: ['test'],
  sim: { model: 'none', params: {} },
  properties: {},
  bodyMm: [6, 2.5, 2.5],
  geometry: { family: 'test', params: {} },
  provenance: { sources: ['https://example.com/test-fixture'] }
} satisfies Partial<PartDef>

export const RES: PartDef = {
  ...base,
  id: 'test-resistor',
  name: 'Test resistor',
  category: 'passive',
  pins: [
    { id: '1', label: '1', role: 'passive', electricalType: 'passive', offsetPitch: [0, 0] },
    { id: '2', label: '2', role: 'passive', electricalType: 'passive', offsetPitch: [1, 0] }
  ],
  internalConnections: [],
  footprint: { kind: 'flex-2lead', minSpan: 1, maxSpan: 10 },
  sim: { model: 'resistor', params: {} },
  properties: { resistance: { type: 'number', label: 'Resistance', unit: 'Ω', default: 220 } }
}

export const LED: PartDef = {
  ...base,
  id: 'test-led',
  name: 'Test LED',
  category: 'led',
  pins: [
    { id: 'A', label: 'Anode (+)', role: 'anode', electricalType: 'passive', offsetPitch: [0, 0] },
    {
      id: 'K',
      label: 'Cathode (−)',
      role: 'cathode',
      electricalType: 'passive',
      offsetPitch: [1, 0]
    }
  ],
  internalConnections: [],
  footprint: { kind: 'flex-2lead', minSpan: 1, maxSpan: 4 },
  sim: { model: 'led', params: {} }
}

/** A 4-pin tact switch whose pins 1–2 and 3–4 are always connected. */
export const BUTTON: PartDef = {
  ...base,
  id: 'test-button',
  name: 'Test button',
  category: 'switch',
  pins: [
    { id: '1', label: '1', role: 'switch', electricalType: 'passive', offsetPitch: [0, 0] },
    { id: '2', label: '2', role: 'switch', electricalType: 'passive', offsetPitch: [0, 3] },
    { id: '3', label: '3', role: 'switch', electricalType: 'passive', offsetPitch: [2, 0] },
    { id: '4', label: '4', role: 'switch', electricalType: 'passive', offsetPitch: [2, 3] }
  ],
  internalConnections: [
    ['1', '2'],
    ['3', '4']
  ],
  footprint: { kind: 'rigid', straddleTrench: true },
  sim: { model: 'tact-switch', params: {} }
}

/** An off-board module with male header pins (e.g. a sensor breakout). */
export const MODULE: PartDef = {
  ...base,
  id: 'test-module',
  name: 'Test module',
  category: 'module',
  pins: [
    {
      id: 'VCC',
      label: 'VCC',
      role: 'power',
      electricalType: 'power-in',
      offsetPitch: [0, 0],
      connector: 'male-pin'
    },
    {
      id: 'OUT',
      label: 'OUT',
      role: 'signal',
      electricalType: 'output',
      offsetPitch: [1, 0],
      connector: 'male-pin'
    },
    {
      id: 'GND',
      label: 'GND',
      role: 'ground',
      electricalType: 'power-in',
      offsetPitch: [2, 0],
      connector: 'male-pin'
    }
  ],
  internalConnections: [],
  footprint: { kind: 'offboard' }
}

/** An off-board part with a female socket (e.g. a servo connector). */
export const SOCKETED: PartDef = {
  ...MODULE,
  id: 'test-socketed',
  name: 'Test socketed module',
  pins: MODULE.pins.map((p) => ({ ...p, connector: 'female-socket' as const }))
}

const FIXTURE_DEFS = new Map([RES, LED, BUTTON, MODULE, SOCKETED].map((d) => [d.id, d]))

export const fixtureDefs = (id: string): PartDef => {
  const def = FIXTURE_DEFS.get(id)
  if (!def) throw new Error(`No fixture part ${id}`)
  return def
}

export const T0 = '2026-10-24T00:00:00.000Z'

export function emptyDoc(): CircuitDoc {
  return newDoc('Test', T0)
}

export function hole(row: number, col: MainColumn, board = 'bb1'): HoleRef {
  return { board, area: 'main', row, col }
}

export function at(row: number, col: MainColumn): Endpoint {
  return { hole: hole(row, col) }
}

export function part(
  id: string,
  defId: string,
  pins: Record<string, HoleRef | null>,
  props = {}
): PartInstance {
  return { id, defId, props, placement: { pins } }
}

export function wire(id: string, a: Endpoint, b: Endpoint, kind: Wire['kind'] = 'dupont-mm'): Wire {
  return { id, a, b, kind, color: 'red', lengthMm: 200 }
}
