// An off-board module laid on the bench rests on the board under its footprint, else on the table.
import { describe, expect, it } from 'vitest'
import { boardDef } from '../defs/boards'
import { newDoc } from '../model/defaults'
import { restHeightMm, toTable } from './reach'

const doc = newDoc('rest', '2026-10-25T00:00:00Z')
const board = doc.boards[0]!
const body = boardDef(board.defId).body

describe('restHeightMm', () => {
  it('is the board top for a point on the board, and 0 beside it', () => {
    const middle = toTable(board.transform, [body.lengthMm / 2, body.widthMm / 2])
    const beside = toTable(board.transform, [body.lengthMm / 2, body.widthMm + 20])
    expect(restHeightMm(doc, [middle])).toBe(body.heightMm)
    expect(restHeightMm(doc, [beside])).toBe(0)
  })

  it('rests on the board when any corner of the footprint is over it', () => {
    const over = toTable(board.transform, [10, body.widthMm - 1])
    const off = toTable(board.transform, [10, body.widthMm + 30])
    expect(restHeightMm(doc, [off, over])).toBe(body.heightMm)
  })

  it('rests on the board when the footprint spans it with every corner off it', () => {
    // A keypad's pad and tail laid across the board, 163 mm long against its 54.6 mm width.
    const across = [
      [60, -50],
      [80, -50],
      [80, body.widthMm + 50],
      [60, body.widthMm + 50]
    ].map((c) => toTable(board.transform, c as [number, number]))
    expect(restHeightMm(doc, across)).toBe(body.heightMm)
  })

  it('follows a board turned a quarter', () => {
    const turned = {
      ...doc,
      boards: [{ ...board, transform: { position: [0, 0] as [number, number], rotationDeg: 90 } }]
    }
    // Turned 90°, the board's length runs along +y and its width along -x.
    expect(restHeightMm(turned, [[-body.widthMm / 2, body.lengthMm / 2]])).toBe(body.heightMm)
    expect(restHeightMm(turned, [[body.widthMm / 2, body.lengthMm / 2]])).toBe(0)
  })
})
