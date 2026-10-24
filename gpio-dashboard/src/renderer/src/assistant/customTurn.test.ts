// SPEC 12.8 and 20 item 7 for the tools that change the part library and the build steps: a turn
// that defines a custom part and annotates steps is one undo group, and undoing it restores a
// deep-equal document. The project it builds also saves and reopens (SPEC 5, 7).
import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { erc } from '../core/erc/erc'
import { newDoc } from '../core/model/defaults'
import { validateDoc } from '../core/ops/validate'
import { parse, serialize } from '../core/serialize/gpiob'
import { AssistantSession } from './loop'
import { FakeContext } from './testing/fakeContext'
import { scriptedFetch, testClient, text, toolUse, type Reply } from './testing/sse'

const tools = (...blocks: Reply['blocks']): Reply => ({ blocks, stop: 'tool_use' })

const pin = (id: string) => ({
  id,
  label: `P${id}`,
  role: 'passive',
  electricalType: 'passive',
  connector: 'none'
})

const SCRIPT: Reply[] = [
  tools(
    text('The part is not in the library, so I define it and note how it goes in.'),
    toolUse('t1', 'define_custom_part', {
      template: '2-lead',
      name: 'Mystery sensor',
      pins: [pin('1'), pin('2')],
      internalConnections: [],
      simModel: 'none'
    }),
    toolUse('t2', 'place_part', {
      defId: 'custom-mystery-sensor',
      at: 'auto',
      orientation: 0,
      props: []
    }),
    toolUse('t3', 'place_part', { defId: 'resistor', at: 'auto', orientation: 0, props: [] }),
    toolUse('t4', 'annotate_build_steps', {
      annotations: [
        { step: 'R1', why: 'The sensor’s pins are only hints.', mistake: 'Pin 1 is not marked.' },
        { step: 'part:R2', why: 'It limits the current.', mistake: '' }
      ]
    })
  ),
  { blocks: [text('Defined, placed and annotated.')], stop: 'end_turn' }
]

async function run() {
  const initial = newDoc('Test', '2026-10-24T00:00:00.000Z')
  const ctx = new FakeContext({ doc: initial })
  const served = scriptedFetch(SCRIPT)
  const session = new AssistantSession({ client: testClient(served.fetch), ctx })
  const result = await session.runTurn('add the mystery sensor')
  return { ctx, result, initial, requests: served.requests }
}

describe('a turn that defines a custom part and annotates steps', () => {
  it('is accepted whole, and leaves the part, its use and the notes in the document', async () => {
    const { ctx, requests } = await run()
    const results = (requests[1]!.body.messages as Anthropic.MessageParam[]).at(-1)!
      .content as Anthropic.ToolResultBlockParam[]
    expect(results.filter((r) => r.is_error)).toEqual([])
    const doc = ctx.getSnapshot()
    expect(doc.customParts?.map((d) => d.id)).toEqual(['custom-mystery-sensor'])
    expect(doc.parts.map((p) => [p.id, p.defId])).toEqual([
      ['R1', 'custom-mystery-sensor'],
      ['R2', 'resistor']
    ])
    expect(doc.buildStepAnnotations).toEqual({
      'part:R1': { why: 'The sensor’s pins are only hints.', mistake: 'Pin 1 is not marked.' },
      'part:R2': { why: 'It limits the current.' }
    })
    expect(validateDoc(doc, ctx.partDef)).toEqual([])
    expect(erc(doc, ctx.partDef).map((i) => i.code)).toContain('PART_WITHOUT_DATASHEET')
  })

  it('is undone by undoTurn to a deep-equal document', async () => {
    const { ctx, result, initial } = await run()
    expect(result.transactions).toHaveLength(4)
    expect(result.transactions.every((t) => t.assistantTurnId === result.turnId)).toBe(true)
    expect(ctx.getSnapshot()).not.toEqual(initial)
    expect(ctx.undoTurn(result.turnId)).toBe(4)
    expect(ctx.getSnapshot()).toStrictEqual(initial)
  })

  it('saves and reopens deep-equal, with the same ERC result', async () => {
    const { ctx } = await run()
    const doc = ctx.getSnapshot()
    const reopened = parse(serialize(doc))
    expect(reopened).toStrictEqual(doc)
    expect(validateDoc(reopened, ctx.partDef)).toEqual([])
    expect(erc(reopened, ctx.partDef)).toEqual(erc(doc, ctx.partDef))
  })
})
