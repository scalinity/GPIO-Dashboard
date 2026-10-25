// SPEC 18's Board Sense bench fixtures as documents: the Board tab's walkthrough shows their holes
// and checks them, the tests run them against the mock agent, and HIL_CHECKLIST.md lists their
// generated wiring. Bench strips: 3V3 row 1 a-e, GND row 5 a-e, GPIO17 row 6 a-e, GPIO27 row 7
// a-e, GPIO18 row 6 f-j.
import { newDoc } from '../model/defaults'
import type { CircuitDoc, Endpoint, HoleRef, MainColumn } from '../model/types'
import type { PartDefs } from '../netlist/netlist'

const T = '2026-10-24T00:00:00.000Z'
const hole = (row: number, col: MainColumn): HoleRef => ({ board: 'bb1', area: 'main', row, col })
const at = (row: number, col: MainColumn): Endpoint => ({ hole: hole(row, col) })
const rail = (r: 'bottom+' | 'bottom-', index: number): Endpoint => ({
  hole: { board: 'bb1', area: 'rail', rail: r, index }
})
const lead = (id: string, a: Endpoint, b: Endpoint, color: string) => ({
  id,
  a,
  b,
  color,
  kind: 'dupont-mm' as const,
  lengthMm: 'auto' as const
})

export interface BenchFixture {
  id: string
  title: string
  /** What to do, and what Board Sense should show. */
  expect: string
  /** The GPIOs this fixture is about. */
  pins: number[]
  doc: (defs: PartDefs) => CircuitDoc
}

/** Fixture 3's circuit: GPIO18 to row 30, a 10 kΩ pull-up to the + rail, a button to the − rail. */
export function pullUpButton(defs: PartDefs): CircuitDoc {
  const d = newDoc('Bench fixture 3: pull-up and button on GPIO18', T)
  const sw = Object.fromEntries(
    defs('tact-switch-6mm').pins.map((p) => [
      p.id,
      hole(40 + p.offsetPitch[0], p.offsetPitch[1] === 0 ? 'e' : 'f')
    ])
  )
  d.parts.push(
    {
      id: 'R1',
      defId: 'resistor',
      props: { resistance: 10_000, tolerance: '5%' },
      placement: { pins: { 1: hole(30, 'b'), 2: hole(34, 'b') } }
    },
    { id: 'SW1', defId: 'tact-switch-6mm', props: { mode: 'momentary' }, placement: { pins: sw } }
  )
  d.wires.push(
    lead('P1', at(1, 'a'), rail('bottom+', 0), 'red'),
    lead('P2', at(5, 'a'), rail('bottom-', 1), 'black'),
    lead('W1', at(6, 'j'), at(30, 'a'), 'yellow'),
    lead('W2', at(34, 'a'), rail('bottom+', 25), 'red'),
    lead('W3', at(30, 'c'), at(40, 'a'), 'yellow'),
    lead('W4', at(42, 'a'), rail('bottom-', 30), 'black')
  )
  return d
}

/** Fixture 2: GPIO17 to GND through one resistor of the calibration series. */
function calibration(ohms: number): (defs: PartDefs) => CircuitDoc {
  return () => {
    const d = newDoc(`Bench fixture 2: GPIO17 to GND through ${ohms / 1000} kΩ`, T)
    d.parts.push({
      id: 'R1',
      defId: 'resistor',
      props: { resistance: ohms, tolerance: '5%' },
      placement: { pins: { 1: hole(30, 'b'), 2: hole(34, 'b') } }
    })
    d.wires.push(
      lead('W1', at(6, 'a'), at(30, 'a'), 'yellow'),
      lead('W2', at(34, 'a'), at(5, 'b'), 'black')
    )
    return d
  }
}

export const BENCH_FIXTURES: BenchFixture[] = [
  {
    id: 'empty',
    title: '1. An empty board',
    expect: 'Every probed net follows its bias; nothing is verified.',
    pins: [17, 18, 27],
    doc: () => newDoc('Bench fixture 1: empty board', T)
  },
  ...[10_000, 47_000, 100_000, 220_000].map((ohms) => ({
    id: `calibration-${ohms / 1000}k`,
    title: `2. Calibration: GPIO17 to GND through ${ohms / 1000} kΩ`,
    expect:
      'Record what GPIO17 reads under each bias. The series narrows the pull-to-threshold ratio on this Pi (SPEC 9).',
    pins: [17],
    doc: calibration(ohms)
  })),
  {
    id: 'pull-up-button',
    title: '3. GPIO18 with a 10 kΩ pull-up and a button',
    expect: 'Released: GPIO18 tied high and matched. Pressed: tied low and matched.',
    pins: [18],
    doc: pullUpButton
  },
  {
    id: 'gpio-short',
    title: '4. A lead between GPIO17 and GPIO27',
    expect:
      'GPIO17 and GPIO27 are joined: matched against this fixture, a gpio-short against an empty twin.',
    pins: [17, 27],
    doc: () => {
      const d = newDoc('Bench fixture 4: GPIO17 joined to GPIO27', T)
      d.wires.push(lead('W1', at(6, 'a'), at(7, 'a'), 'yellow'))
      return d
    }
  }
]
