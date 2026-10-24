// The assistant's tools, in the order SPEC 12.5 lists them. The order and the definitions stay
// fixed for a whole conversation: the cache and the thinking blocks are tied to the tools array.
import type Anthropic from '@anthropic-ai/sdk'
import type { CircuitDoc } from '../../core/model/types'
import type { PartDefs } from '../../core/netlist/netlist'
import type { Ghost } from '../context'
import { analysisTools } from './analysis'
import { circuitTools, connectInput, placePartInput, planConnect, planPlacePart } from './circuit'
import { strictSchema } from './jsonSchema'
import { partTools } from './parts'
import { studioTools } from './studio'
import type { Tool } from './types'

const byName = new Map<string, Tool>(
  [...circuitTools, ...partTools, ...analysisTools, ...studioTools].map((t) => [t.name, t])
)

const ORDER = [
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

export const TOOLS: readonly Tool[] = ORDER.map((name) => {
  const tool = byName.get(name)
  if (!tool) throw new Error(`Tool ${name} is not defined`)
  return tool
})

export const toolByName = (name: string): Tool | undefined => TOOLS.find((t) => t.name === name)

/**
 * The tools sent with `strict: true` (ADR-X9-1). The API compiles the schemas of all of a
 * request's strict tools into one grammar and refuses the request when it is too large ("The
 * compiled grammar is too large, which would cause performance issues. Simplify your tool schemas
 * or reduce the number of strict tools."). The 20 tools that take parameters do not fit together
 * and the limit is not a count, so strict goes to the tools that change the document and are the
 * most structured, and to `get_circuit_state`. Every tool's input is validated here whether or
 * not it is strict. These 11 were measured live, with eager streaming on the 12 mutation tools
 * (docs/v2/EVALS.md).
 */
export const STRICT_TOOLS: ReadonlySet<string> = new Set([
  'get_circuit_state',
  'add_board',
  'place_tboard',
  'place_part',
  'move_part',
  'remove_part',
  'set_part_props',
  'connect',
  'set_wire_props',
  'remove_wire',
  'write_code'
])

export interface ApiToolOptions {
  /** Stream mutation tools' input as it is generated, so ghosts appear early (SPEC 12.4). */
  eager: boolean
  /** Send STRICT_TOOLS with `strict: true`. Off only in the fallback for an API that refuses them. */
  strict: boolean
}

/** The client tools as the API takes them. */
export function apiTools({ eager, strict }: ApiToolOptions): Anthropic.Tool[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: strictSchema(tool.schema) as Anthropic.Tool.InputSchema,
    ...(strict && STRICT_TOOLS.has(tool.name) ? { strict: true } : {}),
    ...(eager && tool.mutates ? { eager_input_streaming: true } : {})
  }))
}

/**
 * Web search and web fetch, called directly: the _20260318 versions default to running inside
 * code execution, which needs a container and is not eligible for zero data retention. A
 * datasheet lookup does not need it, and `max_content_tokens` bounds a fetched page instead.
 */
export function webTools(): Anthropic.ToolUnion[] {
  return [
    { type: 'web_search_20260318', name: 'web_search', max_uses: 6, allowed_callers: ['direct'] },
    {
      type: 'web_fetch_20260318',
      name: 'web_fetch',
      max_uses: 4,
      max_content_tokens: 30000,
      allowed_callers: ['direct']
    }
  ]
}

/** The ghost a streaming tool call would leave if it committed now (SPEC 12.6), or null. */
export function ghostFor(
  name: string,
  partial: Record<string, unknown>,
  doc: CircuitDoc,
  defs: PartDefs
): Ghost | null {
  if (name === 'place_part') {
    const parsed = placePartInput.safeParse({ orientation: 0, props: [], ...partial })
    if (!parsed.success) return null
    const plan = planPlacePart(doc, defs, parsed.data)
    if ('error' in plan) return null
    return {
      kind: 'part',
      ref: plan.part.id,
      defId: plan.part.defId,
      props: plan.part.props,
      placement: plan.part.placement
    }
  }
  if (name === 'connect') {
    const parsed = connectInput.safeParse(partial)
    if (!parsed.success) return null
    const plan = planConnect(doc, defs, parsed.data)
    if ('error' in plan) return null
    return {
      kind: 'wire',
      a: plan.wire.a,
      b: plan.wire.b,
      wireKind: plan.wire.kind,
      color: plan.wire.color
    }
  }
  return null
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function endLabel(v: unknown): string {
  if (typeof v !== 'object' || v === null) return '…'
  const e = v as Record<string, unknown>
  const pin = e.partPin as Record<string, unknown> | undefined
  return str(e.net) ?? str(e.hole) ?? (pin ? `${str(pin.ref) ?? '?'}.${str(pin.pin) ?? '?'}` : '…')
}

const CHIPS: Record<string, string> = {
  get_circuit_state: 'Reading the circuit…',
  search_parts: 'Searching the parts library…',
  define_custom_part: 'Defining a part…',
  add_board: 'Adding a breadboard…',
  place_tboard: 'Placing the T-board…',
  set_part_props: 'Setting part properties…',
  set_wire_props: 'Editing a lead…',
  run_erc: 'Running ERC…',
  simulate: 'Simulating…',
  write_code: 'Writing code…',
  run_code_in_sim: 'Running the code in the simulator…',
  capture_view: 'Capturing the view…',
  read_board_sense: 'Reading Board Sense…',
  focus: 'Moving the camera…',
  highlight: 'Highlighting…',
  annotate_build_steps: 'Annotating build steps…',
  ask_user: 'Asking you…',
  web_search: 'Searching the web…',
  web_fetch: 'Fetching a page…'
}

/** The chip text for a tool call, from whatever of its input has streamed so far. */
export function chipLabel(name: string, partial: Record<string, unknown> = {}): string {
  switch (name) {
    case 'place_part':
      return `Placing ${str(partial.ref) ?? str(partial.defId) ?? 'a part'}…`
    case 'move_part':
      return `Moving ${str(partial.ref) ?? 'a part'}…`
    case 'remove_part':
      return `Removing ${str(partial.ref) ?? 'a part'}…`
    case 'remove_wire':
      return `Removing ${str(partial.id) ?? 'a lead'}…`
    case 'connect':
      return `Wiring ${endLabel(partial.from)} to ${endLabel(partial.to)}…`
    default:
      return CHIPS[name] ?? `${name}…`
  }
}
