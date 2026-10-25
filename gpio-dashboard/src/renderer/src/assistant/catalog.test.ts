import { describe, expect, it } from 'vitest'
import { PART_DEFS } from '../core/defs/parts'
import { partCatalog } from './catalog'
import systemPrompt from './system-prompt.md?raw'
import { TOOLS } from './tools'

describe('the part catalog', () => {
  const defs = [...PART_DEFS.values()]
  const text = partCatalog(defs, new Set(['resistor']))

  it('has a line per part with its pins, and marks the inventory', () => {
    const lines = text.split('\n')
    expect(lines.filter((l) => l.startsWith('- '))).toHaveLength(defs.length)
    expect(lines.find((l) => l.startsWith('- resistor:'))).toContain('In inventory')
    expect(lines.find((l) => l.startsWith('- led:'))).toContain('Not in inventory')
    expect(lines.find((l) => l.startsWith('- led:'))).toContain('A=Anode')
  })

  it('is the same every time, since it sits in the cached prompt', () => {
    expect(partCatalog(defs, new Set(['resistor']))).toBe(text)
  })

  it('stays a size worth caching but not huge', () => {
    expect(text.length).toBeGreaterThan(2000)
    expect(text.length).toBeLessThan(20_000)
  })
})

describe('the system prompt', () => {
  it('names only tools that exist, and the ones its rules depend on', () => {
    const names = new Set(TOOLS.map((t) => t.name))
    const mentioned = [...systemPrompt.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)].map((m) => m[1]!)
    const looksLikeTool =
      /^(get|run|read|write|search|define|place|move|remove|set|add|capture|annotate|ask)_/
    for (const word of mentioned)
      if (looksLikeTool.test(word)) expect(names.has(word), word).toBe(true)
    for (const must of [
      'get_circuit_state',
      'run_erc',
      'simulate',
      'write_code',
      'run_code_in_sim',
      'read_board_sense',
      'search_parts',
      'define_custom_part',
      'ask_user',
      'capture_view'
    ])
      expect(systemPrompt, must).toContain(must)
  })

  it('states the rules of SPEC 12.7', () => {
    expect(systemPrompt).toMatch(/Never say a circuit is correct/)
    expect(systemPrompt).toMatch(/male-male/)
    expect(systemPrompt).toMatch(/male-female/)
    expect(systemPrompt).toMatch(/Nothing attaches to the Pi's header/)
    expect(systemPrompt).toMatch(/Call read_board_sense first/)
    expect(systemPrompt).toMatch(/flyback diode/)
    expect(systemPrompt).toMatch(/what you built, how it works, and what to check/)
  })

  it('has nothing in it that changes between conversations', () => {
    expect(systemPrompt).not.toMatch(/\b20\d\d-\d\d-\d\d\b/)
  })
})
