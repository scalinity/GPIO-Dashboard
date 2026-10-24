// Hole picking against the analytic board plane, and what a hover shows (SPEC 10.7, 11.3).
import { Ray, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { partDef } from '../core/defs/parts'
import { SAMPLES } from '../core/defs/samples'
import { holeKey } from '../core/geometry/breadboard'
import type { CircuitDoc, HoleRef } from '../core/model/types'
import { netlist } from '../core/netlist/netlist'
import { holeInScene } from './coords'
import { hoverInfo, pickHole } from './picking'

const blink = SAMPLES.find((s) => s.id === 'sample-blink')!.doc
const main = (row: number, col: 'a' | 'c' | 'e'): HoleRef => ({
  board: 'bb1',
  area: 'main',
  row,
  col
})

/** A ray at `hole` from `from` (a direction above the table). */
function rayAt(doc: CircuitDoc, hole: HoleRef, from = new Vector3(0, 1, 0)): Ray {
  const target = holeInScene(
    doc.boards.find((b) => b.id === hole.board)!,
    hole
  )
  const origin = target.clone().addScaledVector(from.normalize(), 400)
  return new Ray(origin, target.clone().sub(origin).normalize())
}

describe('pickHole', () => {
  it('finds the hole under a ray from above and from an angle', () => {
    expect(pickHole(blink, rayAt(blink, main(30, 'e')))).toEqual(main(30, 'e'))
    expect(pickHole(blink, rayAt(blink, main(12, 'c'), new Vector3(1, 1, 1)))).toEqual(
      main(12, 'c')
    )
  })

  it('follows a moved and turned board', () => {
    const doc: CircuitDoc = {
      ...blink,
      boards: [{ ...blink.boards[0]!, transform: { position: [50, 20], rotationDeg: 90 } }]
    }
    const hole = main(40, 'a')
    expect(pickHole(doc, rayAt(doc, hole, new Vector3(-1, 2, 1)))).toEqual(hole)
    // The same scene point on the unmoved board is a different hole, or none.
    const ray = rayAt(doc, hole)
    const elsewhere = pickHole(blink, ray)
    expect(elsewhere && holeKey(elsewhere)).not.toBe(holeKey(hole))
  })

  it('finds nothing off the board', () => {
    const ray = new Ray(new Vector3(400, 300, 400), new Vector3(0, -1, 0))
    expect(pickHole(blink, ray)).toBeNull()
  })
})

describe('hoverInfo', () => {
  const nets = netlist(blink, partDef)

  it("shows the hole's strip, its net and every wire end on the net", () => {
    const info = hoverInfo(blink, nets, main(30, 'e'))
    expect(info.text).toBe('Row 30 · column e · net GPIO17')
    expect(info.strip.map(holeKey)).toEqual(['bb1:30a', 'bb1:30b', 'bb1:30c', 'bb1:30d', 'bb1:30e'])
    // W1 runs from the T-board's GPIO17 strip (row 6) to row 30.
    expect(info.wireEnds).toEqual([
      { wire: 'W1', end: 'a' },
      { wire: 'W1', end: 'b' }
    ])
  })

  it('shows a whole rail', () => {
    const info = hoverInfo(blink, nets, { board: 'bb1', area: 'rail', rail: 'top+', index: 0 })
    expect(info.strip).toHaveLength(50)
    expect(info.text).toBe('Top + rail · row 3 · empty')
  })

  it('names an empty strip as empty', () => {
    const info = hoverInfo(blink, nets, main(50, 'a'))
    expect(info.text).toBe('Row 50 · column a · empty')
    expect(info.wireEnds).toEqual([])
  })
})
