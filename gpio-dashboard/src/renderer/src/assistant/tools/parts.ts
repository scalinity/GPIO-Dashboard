// The part library tools: finding a part, and defining one the library lacks (SPEC 7, 12.5).
import { z } from 'zod'
import { checkPartDef } from '../../core/defs/parts'
import type { ElectricalType, PartDef, PinDef, PinRole, SimModelId } from '../../core/model/types'
import { defineTool, failure, reply } from './types'

const PIN_ROLES = [
  'passive',
  'anode',
  'cathode',
  'positive',
  'negative',
  'base',
  'collector',
  'emitter',
  'wiper',
  'switch',
  'coil',
  'contact',
  'power',
  'ground',
  'logic-in',
  'logic-out',
  'logic-io',
  'analog-in',
  'analog-out',
  'driver-out',
  'signal',
  'nc'
] as const satisfies readonly PinRole[]

const ELECTRICAL_TYPES = [
  'passive',
  'input',
  'output',
  'bidirectional',
  'power-in',
  'power-out',
  'open-collector',
  'nc'
] as const satisfies readonly ElectricalType[]

const SIM_MODELS = [
  'resistor',
  'capacitor',
  'electrolytic',
  'diode',
  'led',
  'rgb-led',
  'npn',
  'pnp',
  'switch',
  'tact-switch',
  'tilt-switch',
  'potentiometer',
  'ldr',
  'ntc',
  'active-buzzer',
  'passive-buzzer',
  'dc-motor',
  'relay-module',
  'shift-register-595',
  'adc0834',
  'l293d',
  'seven-segment',
  'seven-segment-4digit',
  'led-matrix-8x8',
  'bar-graph-10',
  'dht11',
  'hc-sr04',
  'hc-sr501',
  'sg90',
  'lcd1602-i2c',
  'ads1115',
  'ads7830',
  'keypad-4x4',
  'joystick',
  'power-module',
  'none'
] as const satisfies readonly SimModelId[]

const MAX_RESULTS = 12

export const searchParts = defineTool({
  name: 'search_parts',
  description:
    'Find parts in the library by name, kind or pin function (for example "led", "ultrasonic", "transistor", "shift register"). Each result has the part id, whether it is in the user’s inventory, its footprint, its pins (id, label, role, connector gender for modules), its editable properties and its datasheet. Prefer inventory parts. An empty query lists every part id.',
  schema: z.object({ query: z.string() }).strict(),
  run({ query }, env) {
    const inventory = env.ctx.inventoryPartIds()
    const parts = env.ctx.partDefs()
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!tokens.length)
      return reply(parts.map((d) => ({ id: d.id, name: d.name, inInventory: inventory.has(d.id) })))
    const haystack = (d: PartDef) =>
      [
        d.id,
        d.name,
        d.category,
        d.sim.model,
        ...d.kitTags,
        ...d.pins.flatMap((p) => [p.label, p.role])
      ]
        .join(' ')
        .toLowerCase()
    const found = parts
      .filter((d) => tokens.every((t) => haystack(d).includes(t)))
      .sort((a, b) => Number(inventory.has(b.id)) - Number(inventory.has(a.id)))
      .slice(0, MAX_RESULTS)
    if (!found.length)
      return failure('NO_MATCH', `Nothing matches "${query}"; try one word, or define_custom_part`)
    return reply(
      found.map((d) => ({
        id: d.id,
        name: d.name,
        category: d.category,
        inInventory: inventory.has(d.id),
        tags: d.kitTags,
        footprint: d.footprint,
        pins: d.pins.map((p) => ({
          id: p.id,
          label: p.label,
          role: p.role,
          ...(p.connector ? { connector: p.connector } : {})
        })),
        properties: d.properties,
        sim: d.sim.model,
        datasheet: d.provenance.sources[0]
      }))
    )
  }
})

const TEMPLATES = ['2-lead', 'TO-92', 'DIP', 'SIP-header', 'module-with-header'] as const
type Template = (typeof TEMPLATES)[number]

const customPartInput = z
  .object({
    template: z
      .enum(TEMPLATES)
      .describe(
        '2-lead: axial or radial part with two leads. TO-92: three pins in a row. DIP: a dual in-line IC (pins 1..N down the left side, then up the right). SIP-header: a row of pins that plugs into the board. module-with-header: an off-board module with its own header, wired with leads.'
      ),
    name: z.string().describe('A short name, e.g. "VL53L0X distance sensor".'),
    pins: z
      .array(
        z
          .object({
            id: z.string().describe('Letters, digits, _ + or -. Datasheet order, pin 1 first.'),
            label: z.string(),
            role: z.enum(PIN_ROLES),
            electricalType: z.enum(ELECTRICAL_TYPES),
            connector: z
              .enum(['male-pin', 'female-socket', 'none'])
              .describe('For module-with-header, the connector at this pin. Otherwise "none".')
          })
          .strict()
      )
      .describe('The pins in datasheet order.'),
    internalConnections: z
      .array(z.array(z.string()))
      .describe(
        'Groups of pin ids that are joined inside the part, e.g. [["1","2"]]. Usually empty.'
      ),
    simModel: z
      .enum(SIM_MODELS)
      .describe(
        'The simulator model, or "none". A model reads specific pin ids, so use one only for a part that matches a built-in part’s pins (see search_parts).'
      ),
    datasheetUrl: z
      .string()
      .url()
      .optional()
      .describe(
        'The datasheet’s URL, found with web search. Without it the part is tagged "no datasheet".'
      )
  })
  .strict()

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** The footprint, pin offsets and body size a template fixes. */
function layout(
  template: Template,
  count: number
): Pick<PartDef, 'footprint' | 'bodyMm' | 'category'> & {
  offsets: PinDef['offsetPitch'][]
} {
  const row = Array.from({ length: count }, (_, i): PinDef['offsetPitch'] => [i, 0])
  switch (template) {
    case '2-lead':
      return {
        footprint: { kind: 'flex-2lead', minSpan: 1, maxSpan: 10 },
        bodyMm: [6, 2.4, 2.4],
        category: 'passive',
        offsets: row
      }
    case 'TO-92':
      return {
        footprint: { kind: 'rigid' },
        bodyMm: [5, 4.5, 5],
        category: 'semiconductor',
        offsets: row
      }
    case 'DIP': {
      const half = count / 2
      return {
        footprint: { kind: 'rigid', straddleTrench: true },
        bodyMm: [2.54 * half, 7.6, 4],
        category: 'ic',
        offsets: Array.from({ length: count }, (_, i): PinDef['offsetPitch'] =>
          i < half ? [i, 0] : [count - 1 - i, 3]
        )
      }
    }
    case 'SIP-header':
      return {
        footprint: { kind: 'rigid' },
        bodyMm: [2.54 * count, 2.5, 5],
        category: 'module',
        offsets: row
      }
    case 'module-with-header':
      return {
        footprint: { kind: 'offboard' },
        bodyMm: [30, 20, 10],
        category: 'module',
        offsets: row
      }
  }
}

const PIN_COUNTS: Record<Template, (n: number) => boolean> = {
  '2-lead': (n) => n === 2,
  'TO-92': (n) => n === 3,
  DIP: (n) => n >= 4 && n <= 40 && n % 2 === 0,
  'SIP-header': (n) => n >= 2 && n <= 20,
  'module-with-header': (n) => n >= 1 && n <= 40
}

const PIN_ID = /^[A-Za-z0-9_+-]+$/

/** The part a `define_custom_part` request describes, or what is wrong with it. */
export function buildCustomPart(
  input: z.infer<typeof customPartInput>,
  takenIds: ReadonlySet<string>
): { def: PartDef } | { problems: string[] } {
  const problems: string[] = []
  if (!PIN_COUNTS[input.template](input.pins.length))
    problems.push(`A ${input.template} part cannot have ${input.pins.length} pins`)
  for (const pin of input.pins) {
    if (!PIN_ID.test(pin.id))
      problems.push(`Pin id "${pin.id}" may use only letters, digits, _ + and -`)
    const offboard = input.template === 'module-with-header'
    if (offboard && pin.connector === 'none')
      problems.push(`Pin ${pin.id} needs a connector gender (male-pin or female-socket)`)
    if (!offboard && pin.connector !== 'none')
      problems.push(`Pin ${pin.id} plugs into the board, so its connector is "none"`)
  }
  const base = slug(input.name) || 'part'
  let id = `custom-${base}`
  for (let n = 2; takenIds.has(id); n++) id = `custom-${base}-${n}`
  const { offsets, ...shape } = layout(input.template, input.pins.length)
  const def: PartDef = {
    id,
    name: input.name,
    ...shape,
    kitTags: ['custom', 'not in kit', ...(input.datasheetUrl ? [] : ['no datasheet'])],
    pins: input.pins.map((p, i) => ({
      id: p.id,
      label: p.label,
      role: p.role,
      electricalType: p.electricalType,
      offsetPitch: offsets[i] ?? [i, 0],
      ...(p.connector !== 'none' ? { connector: p.connector } : {})
    })),
    internalConnections: input.internalConnections,
    sim: { model: input.simModel, params: {} },
    properties: {},
    geometry: { procedural: 'generic-body', params: { label: input.name } },
    provenance: {
      sources: input.datasheetUrl ? [input.datasheetUrl] : [],
      notes: 'Defined by the assistant'
    }
  }
  problems.push(...checkPartDef(def))
  return problems.length ? { problems } : { def }
}

export const defineCustomPart = defineTool({
  name: 'define_custom_part',
  description:
    'Define a part the library lacks, from a template and its datasheet pinout. First search_parts; then find the datasheet with web search and cite its URL. Take the pin order from that datasheet: TO-92 pin orders differ between parts. Returns the new part id to use with place_part.',
  schema: customPartInput,
  mutates: true,
  run(input, env) {
    const taken = new Set(env.ctx.partDefs().map((d) => d.id))
    const built = buildCustomPart(input, taken)
    if ('problems' in built) return failure('BAD_PART', built.problems)
    env.ctx.registerPartDef(built.def)
    return reply({
      id: built.def.id,
      footprint: built.def.footprint,
      pins: built.def.pins.map((p) => ({ id: p.id, role: p.role, connector: p.connector })),
      datasheet: built.def.provenance.sources[0] ?? null
    })
  }
})

export const partTools = [searchParts, defineCustomPart]
