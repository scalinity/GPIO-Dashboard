// Part definitions from content/parts/*.part.json, validated when loaded.
import { PartDefSchema } from '../model/schema'
import type { PartDef } from '../model/types'

/** Problems the schema cannot express; an empty list means the definition is sound. */
export function checkPartDef(def: PartDef): string[] {
  const problems: string[] = []
  const ids = def.pins.map((p) => p.id)
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i)
  if (duplicate) problems.push(`pin id ${duplicate} is repeated`)
  for (const group of def.internalConnections) {
    for (const id of group) {
      if (!ids.includes(id)) problems.push(`internal connection names unknown pin ${id}`)
    }
  }
  const { footprint } = def
  if (footprint.kind === 'flex-2lead') {
    if (def.pins.length !== 2) problems.push('a flex-2lead part has exactly 2 pins')
    if (footprint.minSpan > footprint.maxSpan) problems.push('minSpan exceeds maxSpan')
  }
  if (footprint.kind === 'rigid') {
    const first = def.pins[0]?.offsetPitch
    if (!first || first[0] !== 0 || first[1] !== 0)
      problems.push('pin 1 of a rigid part is at [0, 0]')
    const seen = new Set<string>()
    for (const pin of def.pins) {
      const [x, y] = pin.offsetPitch
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        problems.push(`pin ${pin.id} is off the 2.54 mm grid`)
      }
      const key = `${x},${y}`
      if (seen.has(key)) problems.push(`pins share the offset [${key}]`)
      seen.add(key)
    }
    if (footprint.straddleTrench) {
      // 0.3" packages (DIPs) span e/f; 0.6" ones (displays) span b/f, c/g, d/h or e/i.
      const across = [...new Set(def.pins.map((p) => p.offsetPitch[1]))].sort((m, n) => m - n)
      if (across.length !== 2 || across[0] !== 0 || (across[1] !== 3 && across[1] !== 6)) {
        problems.push(
          'a part that straddles the trench has two pin rows, at 0 and 3 (0.3") or 0 and 6 (0.6")'
        )
      }
    }
  }
  for (const pin of def.pins) {
    if (footprint.kind === 'offboard' && !pin.connector) {
      problems.push(`off-board pin ${pin.id} needs a connector gender`)
    }
    if (footprint.kind !== 'offboard' && pin.connector) {
      problems.push(`pin ${pin.id} has a connector gender but the part plugs into the board`)
    }
  }
  for (const [name, prop] of Object.entries(def.properties)) {
    if (prop.type === 'enum' && !prop.options.includes(prop.default)) {
      problems.push(`property ${name}: default is not one of its options`)
    }
  }
  if (def.bodyMm.some((d) => !(d > 0))) problems.push('bodyMm dimensions are positive')
  return problems
}

/** Why `value` is not allowed for property `name` of `def`, or null when it is. */
export function propProblem(def: PartDef, name: string, value: unknown): string | null {
  const schema = def.properties[name]
  if (!schema) {
    const known = Object.keys(def.properties)
    return `${def.id} has no property ${name}; ${known.length ? `its properties are ${known.join(', ')}` : 'it has none'}`
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value))
      return `${name} must be a number${schema.unit ? ` in ${schema.unit}` : ''}`
    if (
      (schema.min !== undefined && value < schema.min) ||
      (schema.max !== undefined && value > schema.max)
    )
      return `${name} must be between ${schema.min ?? '-∞'} and ${schema.max ?? '∞'}`
  } else if (schema.type === 'enum') {
    if (typeof value !== 'string' || !schema.options.includes(value))
      return `${name} must be one of ${schema.options.join(', ')}`
  } else if (typeof value !== 'boolean') {
    return `${name} must be true or false`
  }
  return null
}

/** Parses and checks one definition, naming the file in any error. */
export function loadPartDef(file: string, raw: unknown): PartDef {
  const parsed = PartDefSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`)
  const problems = checkPartDef(parsed.data)
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`)
  if (!file.endsWith(`/${parsed.data.id}.part.json`)) {
    throw new Error(`${file}: the file name must be ${parsed.data.id}.part.json`)
  }
  return parsed.data
}

const files = import.meta.glob<unknown>('../../content/parts/*.part.json', {
  eager: true,
  import: 'default'
})

/** Every part definition, by id. */
export const PART_DEFS: ReadonlyMap<string, PartDef> = new Map(
  Object.entries(files).map(([file, raw]) => {
    const def = loadPartDef(file, raw)
    return [def.id, def]
  })
)

export function partDef(id: string): PartDef {
  const def = PART_DEFS.get(id)
  if (!def) throw new Error(`Unknown part definition ${id}`)
  return def
}
