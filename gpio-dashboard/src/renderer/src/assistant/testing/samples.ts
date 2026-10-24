// Inputs for tests: one valid input per tool, and a validator for the strict JSON Schema subset.
import type { JsonSchema } from '../tools/jsonSchema'

/** One input per tool that its Zod schema accepts. */
export const VALID_INPUT: Record<string, unknown> = {
  get_circuit_state: { detail: 'summary' },
  search_parts: { query: 'led' },
  define_custom_part: {
    template: 'TO-92',
    name: 'Test transistor',
    pins: [
      { id: 'E', label: 'Emitter', role: 'emitter', electricalType: 'passive', connector: 'none' },
      { id: 'B', label: 'Base', role: 'base', electricalType: 'input', connector: 'none' },
      {
        id: 'C',
        label: 'Collector',
        role: 'collector',
        electricalType: 'passive',
        connector: 'none'
      }
    ],
    internalConnections: [],
    simModel: 'none'
  },
  add_board: { defId: 'bb-830' },
  place_tboard: { board: 'bb1', pin1Row: 1, colPair: 'd/h', orientation: 'header-toward-row-0' },
  place_part: { defId: 'resistor', at: 'auto', orientation: 0, props: [] },
  move_part: { ref: 'R1', at: 'auto', orientation: 0 },
  remove_part: { ref: 'R1' },
  set_part_props: { ref: 'R1', props: [{ name: 'resistance', value: 330 }] },
  connect: { from: { net: 'GPIO17' }, to: { partPin: { ref: 'R1', pin: '1' } } },
  set_wire_props: { id: 'W1', color: 'green' },
  remove_wire: { id: 'W1' },
  run_erc: {},
  simulate: { mode: 'op', durationMs: 0, stimulus: { gpio: [], inputs: [] } },
  write_code: { library: 'gpiozero', source: 'print(1)' },
  run_code_in_sim: { seconds: 2 },
  capture_view: { preset: 'top' },
  read_board_sense: {},
  focus: { refs: ['R1'] },
  highlight: { refs: ['R1'], note: 'this one' },
  annotate_build_steps: { annotations: [{ step: 'R1', why: 'limits current', mistake: '' }] },
  ask_user: { question: 'Which?', options: ['a', 'b'] }
}

/** A small validator for the strict subset, so the generated schemas can be checked against inputs. */
export function conforms(schema: JsonSchema, value: unknown): boolean {
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some((s) => conforms(s as JsonSchema, value))
  if ('const' in schema && value !== schema.const) return false
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false
  const types = ([] as unknown[]).concat(schema.type ?? [])
  const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (
    types.length &&
    !types.some(
      (t) =>
        t === kind ||
        (t === 'integer' && Number.isInteger(value)) ||
        (t === 'number' && kind === 'number')
    )
  )
    return false
  if (kind === 'object') {
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>
    const given = value as Record<string, unknown>
    if (((schema.required ?? []) as string[]).some((k) => !(k in given))) return false
    return Object.entries(given).every(([k, v]) => k in props && conforms(props[k]!, v))
  }
  if (kind === 'array')
    return (value as unknown[]).every((v) => conforms((schema.items ?? {}) as JsonSchema, v))
  return true
}
