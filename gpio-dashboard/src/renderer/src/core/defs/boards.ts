// Breadboard definitions from content/boards/*.board.json.
import { z } from 'zod'
import type { BoardDefId } from '../model/types'

const polarity = z.object({ inner: z.enum(['+', '-']), outer: z.enum(['+', '-']) }).strict()

const BoardDefSchema = z
  .object({
    id: z.enum(['bb-830', 'bb-400']),
    name: z.string(),
    pitchMm: z.literal(2.54),
    body: z.object({ lengthMm: z.number(), widthMm: z.number(), heightMm: z.number() }).strict(),
    rows: z.number().int().positive(),
    trenchPitches: z.number().int().positive(),
    rails: z
      .object({
        holesPerRail: z.number().int().positive(),
        groupSize: z.number().int().positive(),
        firstRow: z.number().int().positive(),
        groupStride: z.number().int().positive(),
        rowOffsetPitches: z.number(),
        innerOffsetPitches: z.number().positive(),
        outerOffsetPitches: z.number().positive(),
        splitAvailable: z.boolean(),
        polarity: z.object({ top: polarity, bottom: polarity }).strict()
      })
      .strict(),
    layout: z
      .object({
        row1FromEndMm: z.number().positive(),
        columnAFromBottomEdgeMm: z.number().positive()
      })
      .strict(),
    electrical: z
      .object({
        ratingV: z.number(),
        ratingA: z.number(),
        wireAwg: z.tuple([z.number(), z.number()]),
        wireDiameterMm: z.tuple([z.number(), z.number()])
      })
      .strict(),
    material: z.string(),
    provenance: z
      .object({
        sources: z.array(z.string().url()).min(1),
        values: z.record(z.string(), z.string())
      })
      .strict()
  })
  .strict()

export type BoardDef = z.infer<typeof BoardDefSchema>

const files = import.meta.glob<unknown>('../../content/boards/*.board.json', {
  eager: true,
  import: 'default'
})

export const BOARD_DEFS: ReadonlyMap<BoardDefId, BoardDef> = new Map(
  Object.entries(files).map(([file, raw]) => {
    const parsed = BoardDefSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`)
    return [parsed.data.id, parsed.data]
  })
)

export function boardDef(id: BoardDefId): BoardDef {
  const def = BOARD_DEFS.get(id)
  if (!def) throw new Error(`No definition for board ${id}`)
  return def
}
