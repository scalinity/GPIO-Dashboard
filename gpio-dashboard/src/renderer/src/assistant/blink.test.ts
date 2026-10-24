// "Blink an LED on GPIO17", scripted as Claude would do it: the whole path from streamed tool
// calls through the loop, the tools, the placer and the store, ending in a clean document.
import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { newDoc } from '../core/model/defaults'
import { netlist } from '../core/netlist/netlist'
import { validateDoc } from '../core/ops/validate'
import { erc } from '../core/erc/erc'
import type { CircuitDoc } from '../core/model/types'
import { AssistantSession } from './loop'
import { FakeContext } from './testing/fakeContext'
import { BLINK_CODE, BLINK_SCRIPT } from './testing/blinkScript'
import { scriptedFetch, testClient, text, toolUse } from './testing/sse'

async function build() {
  const initial = newDoc('Test', '2026-10-24T00:00:00.000Z')
  const ctx = new FakeContext({ doc: initial })
  const served = scriptedFetch(BLINK_SCRIPT, 23)
  const session = new AssistantSession({ client: testClient(served.fetch), ctx })
  const result = await session.runTurn('blink an LED on GPIO17')
  return { ctx, session, result, requests: served.requests, initial }
}

/** The results of one request's tool calls, parsed. */
function resultsFor(requests: { body: Record<string, unknown> }[], round: number) {
  const messages = requests[round]!.body.messages as Anthropic.MessageParam[]
  return (messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]).map((r) => ({
    id: r.tool_use_id,
    error: !!r.is_error,
    text: String(r.content)
  }))
}

describe('blink an LED on GPIO17', () => {
  it('ends ERC-clean with every call accepted', async () => {
    const { ctx, result, requests } = await build()
    expect(result.reason).toBe('end_turn')
    expect(result.toolCalls).toBe(10)
    for (let round = 1; round < requests.length; round++)
      expect(resultsFor(requests, round).filter((r) => r.error)).toEqual([])
    const doc = ctx.getSnapshot()
    expect(validateDoc(doc, ctx.partDef)).toEqual([])
    const issues = erc(doc, ctx.partDef)
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([])
    const reply = resultsFor(requests, 5).find((r) => r.id === 't9')!
    expect(JSON.parse(reply.text)).toMatchObject({ errors: 0, warnings: 0 })
  })

  it('wires GPIO17 through R1 and the LED to GND, by the bench convention', async () => {
    const { ctx } = await build()
    const doc = ctx.getSnapshot()
    const nl = netlist(doc, ctx.partDef)
    expect(nl.netOfPin.get('R1.1')).toBe('GPIO17')
    expect(nl.netOfPin.get('D1.K')).toBe('GND')
    expect(nl.netOfPin.get('R1.2')).toBe(nl.netOfPin.get('D1.A'))
    expect(doc.wires).toHaveLength(3)
    for (const wire of doc.wires) {
      // Breadboard holes only, male-male, from the T-board's strips: nothing on the Pi header.
      expect(wire.kind).toBe('dupont-mm')
      expect('hole' in wire.a && 'hole' in wire.b).toBe(true)
      expect(wire.lengthMm).toBe(200)
    }
    const tboardNet = (n: string) => nl.byName.get(n)!.headerPins.length > 0
    expect(tboardNet('GPIO17') && tboardNet('GND')).toBe(true)
    // R1 and D1 sit in rows below the T-board and in strips of their own.
    for (const part of doc.parts)
      for (const hole of Object.values(part.placement.pins))
        expect(hole && hole.area === 'main' && hole.row).toBeGreaterThanOrEqual(24)
  })

  it('stores the code and quotes real simulation numbers', async () => {
    const { ctx, requests } = await build()
    expect(ctx.getSnapshot().code).toEqual({
      language: 'python',
      library: 'gpiozero',
      source: BLINK_CODE
    })
    const sim = JSON.parse(resultsFor(requests, 5).find((r) => r.id === 't10')!.text)
    // 3.3 V through 220 ohm and a red LED: a few milliamps, well under the 16 mA pin limit.
    expect(sim.leds[0].mA).toBeGreaterThan(3)
    expect(sim.leds[0].mA).toBeLessThan(10)
    expect(sim.resistors[0]).toMatchObject({ ref: 'R1', ohms: 220 })
    expect(sim.errors).toBe(0)
    const write = JSON.parse(resultsFor(requests, 4).find((r) => r.id === 't8')!.text)
    expect(write).toMatchObject({ syntax: 'ok', crossCheck: 'matches the wiring' })
  })

  it('is one undo group: undoing the turn restores a deep-equal empty document', async () => {
    const { ctx, result, initial } = await build()
    expect(result.transactions.map((t) => t.assistantTurnId)).toEqual(Array(6).fill(result.turnId))
    expect(ctx.getSnapshot()).not.toEqual(initial)
    expect(ctx.undoTurn(result.turnId)).toBe(6)
    expect(ctx.getSnapshot()).toEqual(initial)
  })

  it('lets a later turn read the build back', async () => {
    const { ctx } = await build()
    const second = scriptedFetch([
      { blocks: [toolUse('u1', 'get_circuit_state', { detail: 'summary' })], stop: 'tool_use' },
      { blocks: [text('Fine.')], stop: 'end_turn' }
    ])
    const again = new AssistantSession({ client: testClient(second.fetch), ctx })
    await again.runTurn('what do we have?')
    const state = resultsFor(second.requests, 1)[0]!.text
    expect(state).toMatch(
      /^Revision 6: 1 board\(s\), 2 part\(s\), 3 wire\(s\)\. ERC: 0 error\(s\), 0 warning\(s\)\./
    )
    expect(state).toContain('"ref":"R1"')
  })
})

describe('undo restores whatever came before', () => {
  it('leaves an earlier user edit alone', async () => {
    const ctx = new FakeContext()
    const edit = ctx.dispatch({
      author: 'user',
      label: 'Rename',
      ops: [{ type: 'SetMeta', meta: { name: 'Mine' } }]
    })
    expect(edit.ok).toBe(true)
    const before: CircuitDoc = ctx.getSnapshot()
    const served = scriptedFetch(
      BLINK_SCRIPT.slice(1, 3).concat({ blocks: [text('ok')], stop: 'end_turn' })
    )
    const session = new AssistantSession({ client: testClient(served.fetch), ctx })
    const result = await session.runTurn('add them')
    expect(ctx.getSnapshot().parts.length).toBeGreaterThan(0)
    ctx.undoTurn(result.turnId)
    expect(ctx.getSnapshot()).toEqual(before)
  })
})
