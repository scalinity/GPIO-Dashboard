// A new project matches the bench (SPEC 6.1, 6.3, 6.4): one full-size breadboard, the T-board
// on columns d/h with its header toward row 0 and pin 1 at row 1, and the 200 mm ribbon.
import type { CircuitDoc } from './types'

export const SCHEMA_VERSION = 1

export const BENCH_TBOARD = {
  board: 'bb1',
  pin1Row: 1,
  colPair: 'd/h',
  orientation: 'header-toward-row-0'
} as const

export function newDoc(name: string, now: string): CircuitDoc {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { name, created: now, updated: now, revision: 0 },
    boards: [{ id: 'bb1', defId: 'bb-830', transform: { position: [0, 0], rotationDeg: 0 } }],
    controller: {
      pi: { transform: { position: [-120, 0], rotationDeg: 0 } },
      tboard: { ...BENCH_TBOARD },
      ribbon: { lengthMm: 200 }
    },
    parts: [],
    wires: [],
    code: { language: 'python', library: 'RPi.GPIO', source: '' }
  }
}
