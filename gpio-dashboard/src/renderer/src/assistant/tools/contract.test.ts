// What the API will be sent for each tool: strict, inside the supported JSON Schema subset,
// within the per-request complexity limits, and in agreement with the Zod schema that validates
// the same input at runtime (SPEC 12.4).
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { apiTools, TOOLS } from '.'
import { conforms, VALID_INPUT } from '../testing/samples'
import { complexity, strictSchema, subsetProblems, type JsonSchema } from './jsonSchema'

const SPEC_ORDER = [
  'get_circuit_state',
  'search_parts',
  'define_custom_part',
  'add_board',
  'place_tboard',
  'place_part',
  'move_part',
  'remove_part',
  'set_part_props',
  'connect',
  'set_wire_props',
  'remove_wire',
  'run_erc',
  'simulate',
  'write_code',
  'run_code_in_sim',
  'capture_view',
  'read_board_sense',
  'focus',
  'highlight',
  'annotate_build_steps',
  'ask_user'
]

describe('the tool set', () => {
  it('is the 22 tools of SPEC 12.5, in that order', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(SPEC_ORDER)
    expect(Object.keys(VALID_INPUT)).toEqual(SPEC_ORDER)
  })

  it('has no tool that touches hardware', () => {
    for (const tool of TOOLS)
      expect(`${tool.name} ${tool.description}`).not.toMatch(
        /\b(ssh|deploy|flash|run on pi|terminal)\b/i
      )
  })

  it('describes each tool in prose the model can act on', () => {
    for (const tool of TOOLS) expect(tool.description.length, tool.name).toBeGreaterThan(60)
  })
})

describe.each(TOOLS.map((t) => [t.name, t] as const))('%s', (name, tool) => {
  const schema = strictSchema(tool.schema)

  it('has a JSON schema inside the strict subset', () => {
    expect(schema.type).toBe('object')
    expect(subsetProblems(schema)).toEqual([])
  })

  it('has a JSON schema and a Zod schema that agree on a valid input', () => {
    const input = VALID_INPUT[name]
    expect(tool.schema.safeParse(input).success).toBe(true)
    expect(conforms(schema, input)).toBe(true)
  })

  it('rejects a key the schema does not have', () => {
    const input = { ...(VALID_INPUT[name] as object), surprise: 1 }
    expect(tool.schema.safeParse(input).success).toBe(false)
    expect(conforms(schema, input)).toBe(false)
  })

  it('rejects an empty input unless it has no required parameter', () => {
    const required = (schema.required as string[]).length
    expect(tool.schema.safeParse({}).success).toBe(required === 0)
  })
})

describe('what is sent to the API', () => {
  const sent = apiTools({ eager: true, strict: true })

  it('makes every tool with parameters strict, and only the two empty ones not', () => {
    const notStrict = sent.filter((t) => !t.strict).map((t) => t.name)
    expect(notStrict).toEqual(['run_erc', 'read_board_sense'])
    for (const t of sent) expect(t.input_schema.additionalProperties).toBe(false)
  })

  it('stays within the limits the API puts on all strict schemas of a request', () => {
    const strict = sent.filter((t) => t.strict)
    expect(strict.length).toBeLessThanOrEqual(20)
    const total = strict
      .map((t) => complexity(t.input_schema as JsonSchema))
      .reduce((a, b) => ({ optional: a.optional + b.optional, unions: a.unions + b.unions }))
    expect(total.optional).toBeLessThanOrEqual(24)
    expect(total.unions).toBeLessThanOrEqual(16)
  })

  it('streams exactly the mutation tools eagerly', () => {
    expect(sent.filter((t) => t.eager_input_streaming).map((t) => t.name)).toEqual([
      'define_custom_part',
      'add_board',
      'place_tboard',
      'place_part',
      'move_part',
      'remove_part',
      'set_part_props',
      'connect',
      'set_wire_props',
      'remove_wire',
      'write_code',
      'annotate_build_steps'
    ])
  })

  it('drops both flags in the plain-tools form', () => {
    for (const t of apiTools({ eager: false, strict: false }))
      expect(Object.keys(t)).toEqual(['name', 'description', 'input_schema'])
  })

  it('is identical each time it is built, since the cache depends on the bytes', () => {
    expect(JSON.stringify(apiTools({ eager: true, strict: true }))).toBe(JSON.stringify(sent))
  })
})

describe('strictSchema', () => {
  it('moves ranges into the description, which the grammar can not enforce', () => {
    const s = strictSchema(
      z
        .object({
          n: z.number().int().min(1).max(63),
          s: z.string().min(2).max(9),
          a: z.array(z.string()).min(3).max(5),
          e: z.union([z.string(), z.number()])
        })
        .strict()
    )
    expect(subsetProblems(s)).toEqual([])
    const props = s.properties as Record<string, JsonSchema>
    expect(props.n).toEqual({ type: 'integer', description: '(at least 1, at most 63)' })
    expect(props.s!.description).toBe('(at least 2 characters, at most 9 characters)')
    expect(props.a!.description).toBe('(at least 3 items, at most 5 items)')
    expect(props.a).not.toHaveProperty('minItems')
    expect(props.e).toEqual({ type: ['string', 'number'] })
  })

  it('turns oneOf into anyOf and closes every object', () => {
    const s = strictSchema(
      z.discriminatedUnion('k', [
        z.object({ k: z.literal('a'), x: z.number() }),
        z.object({ k: z.literal('b') })
      ])
    )
    expect(s.anyOf).toHaveLength(2)
    expect(
      subsetProblems({
        type: 'object',
        properties: { u: s },
        required: ['u'],
        additionalProperties: false
      })
    ).toEqual([])
  })

  it('flags what the subset forbids', () => {
    expect(subsetProblems({ type: 'object', properties: {} })).toHaveLength(1)
    expect(subsetProblems({ type: 'string', pattern: '^a' })).toHaveLength(1)
    expect(subsetProblems({ type: 'array', minItems: 2, items: { type: 'string' } })).toHaveLength(
      1
    )
  })
})
