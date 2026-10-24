// The part catalog summary that goes into the cached system prompt (SPEC 12.3): one line per
// part, enough to pick one without a search. It is built once, when a conversation starts, and
// never rebuilt: changing the system prompt mid-conversation breaks the cache and the thinking
// blocks. Parts defined later are found with search_parts.
import type { PartDef } from '../core/model/types'

const MAX_PINS = 12

function footprintText(def: PartDef): string {
  const { footprint } = def
  if (footprint.kind === 'flex-2lead')
    return `two leads, ${footprint.minSpan}-${footprint.maxSpan} pitches apart`
  if (footprint.kind === 'offboard') return 'off-board module, wired with leads'
  return footprint.straddleTrench ? 'straddles the trench' : 'rigid, plugs into the board'
}

function line(def: PartDef, inventory: ReadonlySet<string>): string {
  const pins =
    def.pins.length > MAX_PINS
      ? `${def.pins.length} pins (see search_parts)`
      : def.pins.map((p) => `${p.id}=${p.label}`).join(', ')
  const props = Object.keys(def.properties)
  return `- ${def.id}: ${def.name}. ${inventory.has(def.id) ? 'In inventory' : 'Not in inventory'}; ${footprintText(def)}. Pins: ${pins}.${props.length ? ` Properties: ${props.join(', ')}.` : ''}`
}

export function partCatalog(defs: readonly PartDef[], inventory: ReadonlySet<string>): string {
  return [
    '# Part catalog',
    'Part ids you can place now. search_parts gives full pinouts, connectors and property ranges.',
    ...defs.map((d) => line(d, inventory))
  ].join('\n')
}
