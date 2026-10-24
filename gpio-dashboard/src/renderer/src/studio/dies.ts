// The LED dies of a part, as the simulation names them (core/sim/circuit.ts addPart and addLedArray):
// each die's anode and cathode pins, and the model nodes that light with it (SPEC 10.6, 11.5).
import type { PartDef } from '../core/model/types'

export interface DieEnds {
  /** The pin ids the die's current enters and leaves by. */
  a: string
  k: string
  /** What lights with it: nodes and materials of the part's model, by name. */
  nodes: string[]
}

const COLOUR_OF: Record<string, string> = { R: 'red', G: 'green', B: 'blue' }

/** Die key (as in `Snapshot.dies`, without the part id) → its pins and nodes. */
export function dieEnds(def: PartDef): Record<string, DieEnds> {
  const pins = def.pins
  const byRole = (role: string) => pins.filter((p) => p.role === role)
  const out: Record<string, DieEnds> = {}
  switch (def.sim.model) {
    case 'led':
      out.D = { a: 'A', k: 'K', nodes: ['lens', 'die'] }
      break
    case 'diode':
      out.D = { a: byRole('anode')[0]!.id, k: byRole('cathode')[0]!.id, nodes: [] }
      break
    case 'rgb-led': {
      const common = String(def.sim.params.commonPin)
      const anode = def.sim.params.commonType === 'anode'
      for (const c of ['R', 'G', 'B'])
        out[c] = {
          a: anode ? common : c,
          k: anode ? c : common,
          nodes: [`die-${c.toLowerCase()}`]
        }
      break
    }
    case 'seven-segment': {
      const common = pins.find((p) => p.label === 'COM')!
      const anode = def.sim.params.commonType === 'anode'
      for (const s of pins.filter((p) => p.label !== 'COM'))
        out[s.label] = {
          a: anode ? common.id : s.id,
          k: anode ? s.id : common.id,
          nodes: [`seg-${s.label}`]
        }
      break
    }
    case 'seven-segment-4digit':
      for (const d of byRole('anode'))
        for (const s of byRole('cathode'))
          out[`${d.label}.${s.label}`] = {
            a: d.id,
            k: s.id,
            nodes: [`seg-${d.label.slice(1)}-${s.label}`]
          }
      break
    case 'led-matrix-8x8':
      for (const row of byRole('anode'))
        for (const col of byRole('cathode'))
          out[`${row.label}.${col.label}`] = {
            a: row.id,
            k: col.id,
            nodes: [`dot-${row.label.slice(3)}-${col.label.slice(3)}`]
          }
      break
    case 'bar-graph-10':
      for (const a of byRole('anode')) {
        const n = a.label.slice(1)
        out[a.label] = {
          a: a.id,
          k: pins.find((p) => p.label === `K${n}`)!.id,
          nodes: [`bar-${n}`]
        }
      }
      break
  }
  return out
}

/** The sRGB hue a die lights with. */
export function dieHue(def: PartDef, props: Record<string, unknown>, die: string): string {
  if (def.sim.model === 'led') return String(props.color ?? def.properties.color?.default)
  if (def.sim.model === 'rgb-led') return COLOUR_OF[die]!
  return 'red'
}
