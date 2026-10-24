// The eased insertion: what a commit reseats drops into its holes over INSERT_MS, then stops.
import { describe, expect, it } from 'vitest'
import { newDoc } from '../core/model/defaults'
import type { CircuitDoc } from '../core/model/types'
import { INSERT_LIFT_MM, INSERT_MS, Insertion, reseated } from './insertion'

const hole = (row: number) => ({ board: 'bb1', area: 'main', row, col: 'b' }) as const

function withParts(rows: number[]): CircuitDoc {
  const doc = newDoc('t', '2026-10-24T00:00:00Z')
  doc.parts = rows.map((row, i) => ({
    id: `R${i + 1}`,
    defId: 'resistor',
    props: { resistance: 220, tolerance: '5%' },
    placement: { pins: { '1': hole(row), '2': hole(row + 4) } }
  }))
  doc.wires = [
    {
      id: 'W1',
      a: { hole: hole(40) },
      b: { hole: hole(50) },
      color: 'red',
      kind: 'dupont-mm',
      lengthMm: 'auto'
    }
  ]
  return doc
}

describe('reseated', () => {
  it('names new and moved parts and lead ends, not ones left in place', () => {
    const before = withParts([30])
    const after = withParts([30, 10])
    after.wires[0]!.b = { hole: hole(51) }
    expect(reseated(before, after)).toEqual(['R2', 'W1:b'])
  })
})

describe('Insertion', () => {
  it('drops from its lift to its seat, eased, and then is done', () => {
    const insertion = new Insertion()
    insertion.start(['R1'], 1000)
    expect(insertion.lift('R1', 1000)).toBe(INSERT_LIFT_MM)
    const half = insertion.lift('R1', 1000 + INSERT_MS / 2)
    expect(half).toBeGreaterThan(0)
    // Eased out: past halfway down at half time.
    expect(half).toBeLessThan(INSERT_LIFT_MM / 2)
    expect(insertion.settle(1000 + INSERT_MS)).toBe(true)
    expect(insertion.lift('R1', 1000 + INSERT_MS)).toBe(0)
    expect(insertion.settle(1000 + INSERT_MS + 16)).toBe(false)
  })

  it('holds what a drag previews at its lift', () => {
    const insertion = new Insertion()
    insertion.hover(['R1'])
    expect(insertion.lift('R1', 0)).toBe(INSERT_LIFT_MM)
    expect(insertion.settle(0)).toBe(false)
    insertion.hover([])
    expect(insertion.lift('R1', 0)).toBe(0)
  })
})
