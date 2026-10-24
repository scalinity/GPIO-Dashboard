// Regression tests for the baseline defects that circuit-core fixes (SPEC 16.2, 18).
// D1-D4 and D15 lived in components/breadboardCoords.js, Breadboard.jsx and the absence of any
// connectivity model at 52639d9.
import { describe, expect, it } from 'vitest'
import { boardDef } from './defs/boards'
import { TBOARD } from './defs/controllers'
import { boardHoles, holeKey, holePosition, isValidHole, nearestHole } from './geometry/breadboard'
import { tboardBlockedHoles, tboardPinHoles } from './geometry/tboard'
import { BENCH_TBOARD } from './model/defaults'
import { netlist } from './netlist/netlist'
import { at, emptyDoc, fixtureDefs, hole, part, wire } from './testing/fixtures'

const bb = boardDef('bb-830')

describe('baseline defect regressions', () => {
  it('D1: the board has 63 rows, and 40 rows are fully free beside the T-board (the baseline had 30 and 10)', () => {
    expect(bb.rows).toBe(63)
    const blocked = new Set(tboardBlockedHoles(bb, TBOARD, BENCH_TBOARD).map(holeKey))
    const occupied = new Set(tboardPinHoles(BENCH_TBOARD).map(holeKey))
    const free = Array.from({ length: 63 }, (_, i) => i + 1).filter((row) =>
      boardHoles(bb, 'bb1')
        .filter((h) => h.area === 'main' && h.row === row)
        .every((h) => !blocked.has(holeKey(h)) && !occupied.has(holeKey(h)))
    )
    expect(free).toHaveLength(40)
  })

  it('D2: every T-board pin is in a hole, never between columns (the baseline put GPIO17 between d and e)', () => {
    for (const h of tboardPinHoles(BENCH_TBOARD)) {
      expect(isValidHole(bb, h)).toBe(true)
      expect(nearestHole(bb, 'bb1', holePosition(bb, h), 0.01)).toEqual(h)
    }
  })

  it('D3: every rail hole is on the board body and on its rail line (the baseline resolved rails off the drawn rails)', () => {
    for (const h of boardHoles(bb, 'bb1').filter((x) => x.area === 'rail')) {
      const [x, y] = holePosition(bb, h)
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(bb.body.lengthMm)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(bb.body.widthMm)
      expect(nearestHole(bb, 'bb1', [x, y], 0.01)).toEqual(h)
    }
  })

  it('D4: rails and the circuit area share one coordinate frame (the baseline mixed a rotated and an unrotated one)', () => {
    // The rail holes line up with circuit rows on the same x, as the datasheet says.
    const rail = holePosition(bb, { board: 'bb1', area: 'rail', rail: 'bottom+', index: 0 })
    const row3 = holePosition(bb, hole(3, 'a'))
    expect(rail[0]).toBeCloseTo(row3[0], 9)
    expect(rail[1]).toBeLessThan(row3[1])
  })

  it('D15: a circuit has a netlist: the kit blink circuit connects 3V3, the resistor, the LED and GPIO17', () => {
    const doc = emptyDoc()
    doc.parts.push(
      part('R1', 'test-resistor', { 1: hole(30, 'a'), 2: hole(34, 'a') }),
      part('D1', 'test-led', { A: hole(34, 'c'), K: hole(35, 'c') })
    )
    doc.wires.push(wire('W1', at(1, 'a'), at(30, 'c')), wire('W2', at(35, 'a'), at(6, 'a')))
    const n = netlist(doc, fixtureDefs)
    expect(n.netOfPin.get('R1.1')).toBe('3V3')
    expect(n.netOfPin.get('R1.2')).toBe(n.netOfPin.get('D1.A'))
    expect(n.netOfPin.get('D1.K')).toBe('GPIO17')
  })
})
