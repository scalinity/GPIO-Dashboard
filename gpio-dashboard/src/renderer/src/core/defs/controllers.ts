// The Raspberry Pi 5 header and the T-board, from content/controllers.
import { z } from 'zod'
import piHeaderJson from '../../content/controllers/pi5-header.json'
import tboardJson from '../../content/controllers/tboard.json'

const PiHeaderSchema = z.object({
  id: z.literal('pi5-header'),
  pitchMm: z.literal(2.54),
  pins: z
    .array(
      z.object({
        physical: z.number().int(),
        name: z.string(),
        type: z.enum(['Power', 'Ground', 'GPIO']),
        bcm: z.number().int().nullable(),
        function: z.string()
      })
    )
    .length(40)
})

const rect = z.object({ xMin: z.number(), xMax: z.number(), yMin: z.number(), yMax: z.number() })

const TboardSchema = z.object({
  id: z.literal('tboard'),
  pitchMm: z.literal(2.54),
  rowSpacingPitches: z.literal(6),
  edgeColumnsUsable: z.boolean(),
  pins: z.array(z.object({ pin: z.number().int(), label: z.string() })).length(40),
  outline: z.object({
    stem: rect,
    topBar: rect,
    cornerRadiusMm: z.number(),
    pcbThicknessMm: z.number()
  }),
  header: z.object({
    centerXMm: z.number(),
    centerYMm: z.number(),
    lengthAlongYMm: z.number(),
    widthAlongXMm: z.number(),
    heightMm: z.number()
  }),
  dupontHousingMm: z.number().positive()
})

export type PiHeaderPin = z.infer<typeof PiHeaderSchema>['pins'][number]
export type TboardDef = z.infer<typeof TboardSchema>
export type Rect = z.infer<typeof rect>

export const PI_HEADER: readonly PiHeaderPin[] = PiHeaderSchema.parse(piHeaderJson).pins
export const TBOARD: TboardDef = TboardSchema.parse(tboardJson)

export function piPin(physical: number): PiHeaderPin {
  const pin = PI_HEADER[physical - 1]
  if (!pin || pin.physical !== physical) throw new Error(`No header pin ${physical}`)
  return pin
}

/** The canonical net a header pin belongs to: GND, 3V3, 5V or GPIOnn (SPEC 5). */
export function headerNetName(physical: number): string {
  const pin = piPin(physical)
  if (pin.type === 'Ground') return 'GND'
  if (pin.type === 'Power') return pin.name === '3V3' ? '3V3' : '5V'
  return `GPIO${pin.bcm}`
}
