// Pieces several tools share: the shapes of holes, nets and property lists in tool input, and
// the checks that keep model-supplied values inside what a part definition allows.
import { z } from 'zod'
import { parseHoleKey } from '../../core/geometry/breadboard'
import type { HoleRef, PartDef, SimModelId } from '../../core/model/types'

/** A hole as text: "bb1:23e" (main area) or "bb1:top+.7" (rail). */
export const holeKeyText = z
  .string()
  .refine((v) => parseHoleKey(v) !== null, 'not a hole such as "bb1:23e" or "bb1:top+.7"')

export const hole = (description: string) => holeKeyText.describe(description)

/** A hole as text, or "auto" to let the placer choose. */
export const holeOrAuto = (description: string) =>
  z
    .string()
    .refine(
      (v) => v === 'auto' || parseHoleKey(v) !== null,
      'not "auto" or a hole such as "bb1:23e"'
    )
    .describe(description)

export const parseHole = (text: string): HoleRef => {
  const parsed = parseHoleKey(text)
  if (!parsed) throw new Error(`Not a hole: ${text}`)
  return parsed
}

export const NET_NAMES = [
  'GND',
  '3V3',
  '5V',
  ...Array.from({ length: 28 }, (_, i) => `GPIO${i}`)
] as const

const propValue = z.union([z.string(), z.number(), z.boolean()])

/** Property values as a list: strict schemas can not describe a map with arbitrary keys. */
export const propList = z.array(z.object({ name: z.string(), value: propValue }).strict())

export type PropList = z.infer<typeof propList>

/** `given` laid over `base`, or why a value does not fit the part's property schema. */
export function mergeProps(
  def: PartDef,
  base: Record<string, unknown>,
  given: PropList
): { props: Record<string, unknown> } | { error: string } {
  const props = { ...base }
  for (const { name, value } of given) {
    const schema = def.properties[name]
    if (!schema) {
      const known = Object.keys(def.properties)
      return {
        error: `${def.id} has no property ${name}; ${known.length ? `its properties are ${known.join(', ')}` : 'it has none'}`
      }
    }
    if (schema.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return { error: `${name} must be a number${schema.unit ? ` in ${schema.unit}` : ''}` }
      if (
        (schema.min !== undefined && value < schema.min) ||
        (schema.max !== undefined && value > schema.max)
      )
        return { error: `${name} must be between ${schema.min ?? '-∞'} and ${schema.max ?? '∞'}` }
    } else if (schema.type === 'enum') {
      if (typeof value !== 'string' || !schema.options.includes(value))
        return { error: `${name} must be one of ${schema.options.join(', ')}` }
    } else if (typeof value !== 'boolean') {
      return { error: `${name} must be true or false` }
    }
    props[name] = value
  }
  return { props }
}

export const defaultProps = (def: PartDef): Record<string, unknown> =>
  Object.fromEntries(Object.entries(def.properties).map(([k, p]) => [k, p.default]))

const PREFIX: Partial<Record<SimModelId, string>> = {
  resistor: 'R',
  potentiometer: 'R',
  ldr: 'R',
  ntc: 'RT',
  capacitor: 'C',
  electrolytic: 'C',
  diode: 'D',
  led: 'D',
  'rgb-led': 'D',
  npn: 'Q',
  pnp: 'Q',
  switch: 'SW',
  'tact-switch': 'SW',
  'tilt-switch': 'S',
  'active-buzzer': 'BZ',
  'passive-buzzer': 'BZ',
  'dc-motor': 'M',
  'relay-module': 'K',
  'shift-register-595': 'U',
  adc0834: 'U',
  l293d: 'U',
  'seven-segment': 'DS',
  'seven-segment-4digit': 'DS',
  'led-matrix-8x8': 'M',
  'bar-graph-10': 'B',
  dht11: 'DHT',
  'hc-sr04': 'HC',
  'hc-sr501': 'U',
  sg90: 'SV',
  'lcd1602-i2c': 'LCD',
  ads1115: 'U',
  ads7830: 'U',
  'keypad-4x4': 'KP',
  joystick: 'J',
  'power-module': 'PM'
}

const CATEGORY_PREFIX: Record<PartDef['category'], string> = {
  passive: 'R',
  led: 'D',
  switch: 'SW',
  sensor: 'S',
  semiconductor: 'Q',
  ic: 'U',
  display: 'DS',
  actuator: 'M',
  audio: 'BZ',
  module: 'U',
  power: 'PM'
}

/** The reference designator letters for a part: R for resistors, D for LEDs, U for ICs. */
export const refPrefix = (def: PartDef): string =>
  PREFIX[def.sim.model] ?? CATEGORY_PREFIX[def.category]

/** The first `<prefix><n>` that no id in `used` takes. */
export function nextId(prefix: string, used: readonly string[]): string {
  const taken = new Set(used)
  for (let n = 1; ; n++) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`
}

export const REF_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,15}$/
