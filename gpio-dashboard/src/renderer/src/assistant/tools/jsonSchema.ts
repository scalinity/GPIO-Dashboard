// Zod schema → the JSON Schema subset strict tools accept (SPEC 12.4). Strict tools compile the
// schema into a grammar, which allows only types, enums, consts, anyOf, nested objects with
// additionalProperties: false, and arrays with minItems 0 or 1. Everything else a Zod schema can
// say (ranges, lengths, patterns) is dropped here and moved into the description; the same Zod
// schema still enforces it at runtime, because the grammar does not.
import { z } from 'zod'

export type JsonSchema = { [key: string]: unknown }

const isSchema = (v: unknown): v is JsonSchema => typeof v === 'object' && v !== null
const asSchemas = (v: unknown): JsonSchema[] => (Array.isArray(v) ? v.filter(isSchema) : [])

/** The constraints that become words in the description, with how they read. */
const CONSTRAINT_NOTES: Record<string, (v: unknown) => string> = {
  minimum: (v) => `at least ${v}`,
  maximum: (v) => `at most ${v}`,
  exclusiveMinimum: (v) => `greater than ${v}`,
  exclusiveMaximum: (v) => `less than ${v}`,
  minLength: (v) => `at least ${v} characters`,
  maxLength: (v) => `at most ${v} characters`,
  maxItems: (v) => `at most ${v} items`
}

function clean(node: JsonSchema): JsonSchema {
  const out: JsonSchema = {}
  const notes: string[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'enum' || key === 'const' || key === 'required') out[key] = value
    else if (key === 'description') out.description = value
    else if (key === 'properties' && isSchema(value))
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, clean(isSchema(child) ? child : {})])
      )
    else if (key === 'items' && isSchema(value)) out.items = clean(value)
    else if (key === 'anyOf' || key === 'oneOf') out.anyOf = asSchemas(value).map(clean)
    else if (key === 'minItems') {
      if (value === 0 || value === 1) out.minItems = value
      else notes.push(`at least ${value} items`)
    } else if (key in CONSTRAINT_NOTES) notes.push(CONSTRAINT_NOTES[key]!(value))
  }
  if (out.type === 'object') {
    out.properties ??= {}
    out.required ??= []
    out.additionalProperties = false
  }
  if (notes.length)
    out.description = [out.description, `(${notes.join(', ')})`].filter(Boolean).join(' ')
  return out
}

/** The strict JSON Schema for a Zod schema. */
export function strictSchema(schema: z.ZodType): JsonSchema {
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' })
  return clean(raw as JsonSchema)
}

const ALLOWED_KEYS = new Set([
  'type',
  'enum',
  'const',
  'required',
  'description',
  'properties',
  'items',
  'anyOf',
  'minItems',
  'additionalProperties'
])

/** Everything in a schema that strict mode would reject. Empty means the schema is within the subset. */
export function subsetProblems(schema: JsonSchema, path = '$'): string[] {
  const problems: string[] = []
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_KEYS.has(key))
      problems.push(`${path}: keyword ${key} is outside the strict subset`)
  }
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false)
      problems.push(`${path}: an object needs additionalProperties: false`)
    const names = Object.keys(isSchema(schema.properties) ? schema.properties : {})
    for (const name of (schema.required as string[] | undefined) ?? []) {
      if (!names.includes(name)) problems.push(`${path}: required ${name} is not a property`)
    }
  }
  if (typeof schema.minItems === 'number' && schema.minItems > 1)
    problems.push(`${path}: minItems above 1`)
  if (isSchema(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties))
      if (isSchema(child)) problems.push(...subsetProblems(child, `${path}.${name}`))
  }
  if (isSchema(schema.items)) problems.push(...subsetProblems(schema.items, `${path}[]`))
  asSchemas(schema.anyOf).forEach((child, i) =>
    problems.push(...subsetProblems(child, `${path}|${i}`))
  )
  return problems
}

export interface Complexity {
  /** Parameters not listed in `required`. */
  optional: number
  /** Parameters that use anyOf or a type array. */
  unions: number
}

/** The two counts the API limits across every strict schema in a request (24 and 16). */
export function complexity(schema: JsonSchema): Complexity {
  const total: Complexity = { optional: 0, unions: 0 }
  const add = (c: Complexity) => {
    total.optional += c.optional
    total.unions += c.unions
  }
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.type)) total.unions += 1
  if (isSchema(schema.properties)) {
    const required = new Set((schema.required as string[] | undefined) ?? [])
    for (const [name, child] of Object.entries(schema.properties)) {
      if (!required.has(name)) total.optional += 1
      if (isSchema(child)) add(complexity(child))
    }
  }
  if (isSchema(schema.items)) add(complexity(schema.items))
  for (const child of asSchemas(schema.anyOf)) add(complexity(child))
  return total
}
