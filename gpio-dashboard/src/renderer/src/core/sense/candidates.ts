// Candidate causes for a diverged net (SPEC 14.5): single-fault edits of the twin near that net,
// each simulated and ranked by how well its predicted signature matches the measurement.
// Candidates whose signatures cannot be told apart are reported together as a tie.
import { BEHAVIORS } from '../sim/behaviors'
import { Circuit } from '../sim/circuit'
import { probeSignature, type ProbeSignature } from '../sim/probe'
import { holeText } from '../steps/steps'
import { validateDoc } from '../ops/validate'
import type { CircuitDoc, Endpoint, HoleRef, MainColumn } from '../model/types'
import { MAIN_COLUMNS } from '../model/types'
import type { PartDefs } from '../netlist/netlist'
import type { Measured } from './sense'

export interface Candidate {
  /** What changed, in words. */
  text: string
  /** The holes involved, for the twin to highlight. */
  holes: HoleRef[]
  doc: CircuitDoc
}

export interface Ranked {
  /** Candidates whose signatures are identical on the probed pins: a tie. */
  candidates: Omit<Candidate, 'doc'>[]
  /** Readings that agree with the measurement, out of `of`. */
  score: number
  of: number
}

const ACROSS: Record<MainColumn, MainColumn> = {
  a: 'j',
  b: 'i',
  c: 'h',
  d: 'g',
  e: 'f',
  f: 'e',
  g: 'd',
  h: 'c',
  i: 'b',
  j: 'a'
}

function moved(hole: HoleRef, rows: number): HoleRef | null {
  if (hole.area !== 'main') return null
  return { ...hole, row: hole.row + rows }
}

/** Every single-fault edit of the document that is still a valid placement. */
export function candidates(doc: CircuitDoc, defs: PartDefs): Candidate[] {
  const out: Candidate[] = []
  const add = (text: string, holes: HoleRef[], edit: (d: CircuitDoc) => void) => {
    const d = structuredClone(doc)
    edit(d)
    if (validateDoc(d, defs).length === 0) out.push({ text, holes, doc: d })
  }
  doc.wires.forEach((w, i) => {
    add(
      `${w.id} is missing`,
      [w.a, w.b].flatMap((e) => ('hole' in e ? [e.hole] : [])),
      (d) => {
        d.wires.splice(i, 1)
      }
    )
    for (const end of ['a', 'b'] as const) {
      const e: Endpoint = w[end]
      if ('hole' in e) {
        for (const rows of [-1, 1]) {
          const to = moved(e.hole, rows)
          if (to) {
            add(
              `${w.id}'s end in ${holeText(doc, e.hole)} is in ${holeText(doc, to)} instead`,
              [e.hole, to],
              (d) => {
                d.wires[i]![end] = { hole: to }
              }
            )
          }
        }
        if (e.hole.area === 'main') {
          const to: HoleRef = { ...e.hole, col: ACROSS[e.hole.col] }
          add(
            `${w.id}'s end in ${holeText(doc, e.hole)} is across the trench, in ${holeText(doc, to)}`,
            [e.hole, to],
            (d) => {
              d.wires[i]![end] = { hole: to }
            }
          )
        }
        if (e.hole.area === 'rail') {
          const rail = e.hole.rail
          const other = (
            rail.endsWith('+') ? rail.replace('+', '-') : rail.replace('-', '+')
          ) as typeof rail
          const to: HoleRef = { ...e.hole, rail: other }
          add(`${w.id}'s end is on the ${other} rail instead of ${rail}`, [e.hole, to], (d) => {
            d.wires[i]![end] = { hole: to }
          })
        }
      } else {
        const pins = defs(doc.parts.find((p) => p.id === e.pin.part)!.defId).pins
        const at = pins.findIndex((p) => p.id === e.pin.pin)
        for (const step of [-1, 1]) {
          const neighbour = pins[at + step]
          if (!neighbour?.connector) continue
          add(
            `${w.id} is on ${e.pin.part}'s ${neighbour.label} pin instead of ${pins[at]!.label}`,
            [],
            (d) => {
              d.wires[i]![end] = { pin: { part: e.pin.part, pin: neighbour.id } }
            }
          )
        }
      }
    }
  })
  doc.parts.forEach((p, i) => {
    const def = defs(p.defId)
    if (def.footprint.kind === 'offboard') return
    const holes = Object.values(p.placement.pins).filter((h): h is HoleRef => !!h)
    const polar =
      def.pins.length === 2 &&
      def.pins.some((q) => ['anode', 'cathode', 'positive', 'negative'].includes(q.role))
    if (polar) {
      const [x, y] = def.pins.map((q) => q.id) as [string, string]
      add(`${p.id} is reversed`, holes, (d) => {
        const pins = d.parts[i]!.placement.pins
        ;[pins[x], pins[y]] = [pins[y]!, pins[x]!]
      })
    }
    for (const rows of [-1, 1]) {
      add(`${p.id} sits one row ${rows < 0 ? 'up' : 'down'}`, holes, (d) => {
        const pins = d.parts[i]!.placement.pins
        for (const id of Object.keys(pins)) pins[id] = pins[id] ? moved(pins[id]!, rows) : null
      })
    }
  })
  return out
}

/** Readings of a signature on the given pins, as a list (bias class, then pair readings). */
function readings(s: ProbeSignature | Measured, pins: number[]): string[] {
  const out: string[] = []
  for (const b of pins) {
    const bias = s.bias[b]
    out.push(typeof bias === 'string' ? bias : (bias?.class ?? '?'))
    for (const a of pins) {
      for (const drive of ['up', 'down'] as const) out.push(s.pairs[a]?.[drive][b] ?? '?')
    }
  }
  return out
}

/** The candidates ranked by agreement with the measurement on `pins`; ties grouped. */
export function rankCandidates(
  doc: CircuitDoc,
  defs: PartDefs,
  measured: Measured,
  pins: number[],
  top = 3
): Ranked[] {
  const want = readings(measured, pins)
  const groups = new Map<string, Ranked>()
  for (const c of candidates(doc, defs)) {
    const sig = probeSignature(new Circuit(c.doc, defs, BEHAVIORS), pins)
    const got = readings(sig, pins)
    const score = got.filter((r, i) => r !== 'ambiguous' && r === want[i]).length
    const tie = got.join('|')
    const group = groups.get(tie)
    if (group) group.candidates.push({ text: c.text, holes: c.holes })
    else groups.set(tie, { candidates: [{ text: c.text, holes: c.holes }], score, of: want.length })
  }
  return [...groups.values()].sort((a, b) => b.score - a.score).slice(0, top)
}
