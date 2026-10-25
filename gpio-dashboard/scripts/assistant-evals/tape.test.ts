// The recording format: what is kept, what is scrubbed, and that a fixture rebuilds its requests.
import { text, thinking, toolUse, type Reply } from '@renderer/assistant/testing/sse'
import { events, scriptedFetch, toSse } from '@renderer/assistant/testing/sse'
import { describe, expect, it } from 'vitest'
import { assertNoSecret } from './files'
import {
  canonical,
  fromStored,
  inputDeltas,
  recordFetch,
  replayFetch,
  scrubExchange,
  sseUsage,
  toStored,
  type Exchange,
  type Json
} from './tape'

const reply = (blocks: Reply['blocks'], stop: string): Reply => ({ blocks, stop })

async function record(replies: Reply[], bodies: Record<string, Json>[]) {
  const server = scriptedFetch(replies)
  const tape = recordFetch(server.fetch)
  for (const body of bodies) {
    const response = await tape.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer not-a-real-key' },
      body: JSON.stringify(body)
    })
    await response.text()
  }
  await tape.settled()
  return tape.exchanges
}

describe('recordFetch', () => {
  it('keeps the request body and the response text, and nothing of the headers', async () => {
    const exchanges = await record(
      [reply([text('hi')], 'end_turn')],
      [{ model: 'm', messages: [{ role: 'user', content: 'hi' }] }]
    )
    expect(exchanges).toHaveLength(1)
    expect(exchanges[0]!.request).toEqual({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(exchanges[0]!.status).toBe(200)
    expect(exchanges[0]!.body).toBe(toSse(events(reply([text('hi')], 'end_turn'))))
    expect(JSON.stringify(exchanges)).not.toMatch(/authorization|not-a-real-key/i)
  })
})

describe('scrubbing', () => {
  it('replaces thinking signatures and encrypted content, in requests and streams', () => {
    const streamed = toSse(events(reply([thinking('hmm', 'SIGNATURE-123')], 'end_turn')))
    const exchange: Exchange = {
      request: {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'hmm', signature: 'SIGNATURE-123' }]
          },
          {
            role: 'assistant',
            content: [{ type: 'web_search_tool_result', content: [{ encrypted_content: 'ENC-9' }] }]
          }
        ]
      },
      status: 200,
      contentType: 'text/event-stream',
      body: streamed
    }
    const scrubbed = JSON.stringify(scrubExchange(exchange))
    expect(scrubbed).not.toMatch(/SIGNATURE-123|ENC-9/)
    expect(scrubbed).toContain('scrubbed')
    // The model's own words stay.
    expect(scrubbed).toContain('hmm')
  })

  it('scrubs a JSON error body too', () => {
    const e = scrubExchange({
      request: {},
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'x' }
      })
    })
    expect(JSON.parse(e.body)).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'x' }
    })
  })

  it('refuses to write anything shaped like an Anthropic key', () => {
    expect(() => assertNoSecret('{"a":"sk-ant-api03-abcdefghijklmnop"}', 'x', null)).toThrow()
    expect(() => assertNoSecret('{"a":"hello"}', 'x', 'hello-world-secret')).not.toThrow()
    expect(() =>
      assertNoSecret('has hello-world-secret in it', 'x', 'hello-world-secret')
    ).toThrow()
  })
})

describe('the stored form', () => {
  it('rebuilds each request: messages grow, and a changed tool list is stored once', async () => {
    const m1 = { role: 'user', content: 'hi' }
    const m2 = { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }
    const m3 = { role: 'user', content: 'again' }
    const base = { model: 'm', max_tokens: 5, system: [{ type: 'text', text: 's' }] }
    const exchanges = await record(
      [
        reply([text('a')], 'end_turn'),
        reply([text('b')], 'end_turn'),
        reply([text('c')], 'end_turn')
      ],
      [
        { ...base, tools: [{ name: 'strict', strict: true }], messages: [m1] },
        { ...base, tools: [{ name: 'plain' }], messages: [m1] },
        { ...base, tools: [{ name: 'plain' }], messages: [m1, m2, m3] }
      ]
    )
    const stored = toStored(exchanges)
    expect(stored.requests.map((r) => r.messages.length)).toEqual([1, 0, 2])
    expect(stored.requests.map((r) => 'prefix' in r)).toEqual([true, true, false])
    const rebuilt = fromStored(stored)
    expect(rebuilt.map((e) => canonical(e.request as Json))).toEqual(
      exchanges.map((e) => canonical(e.request as Json))
    )
  })

  it('starts the history again when a request does not extend the one before', () => {
    const request = (messages: Json[]): Exchange => ({
      request: { messages },
      status: 200,
      contentType: 'text/event-stream',
      body: ''
    })
    const a = { role: 'user', content: 'a' }
    const b = { role: 'user', content: 'b' }
    const stored = toStored([request([a]), request([b])])
    expect(stored.requests[1]).toMatchObject({ reset: true })
    expect(fromStored(stored).map((e) => e.request.messages)).toEqual([[a], [b]])
  })
})

describe('replayFetch', () => {
  it('serves the recorded responses in order, then says it has none', async () => {
    const exchanges = await record(
      [reply([toolUse('t1', 'run_erc', {})], 'tool_use'), reply([text('done')], 'end_turn')],
      [{ n: 1 }, { n: 2 }]
    )
    const server = replayFetch(exchanges)
    const first = await server.fetch('x', { method: 'POST', body: '{"n":1}' })
    expect(sseUsage(await first.text()).stopReason).toBe('tool_use')
    const second = await server.fetch('x', { method: 'POST', body: '{"n":2}' })
    expect(sseUsage(await second.text()).stopReason).toBe('end_turn')
    expect(server.remaining()).toBe(0)
    await expect(server.fetch('x', { method: 'POST', body: '{}' })).rejects.toThrow(/re-record/)
  })
})

describe('inputDeltas', () => {
  it('counts the calls of each client tool and the input_json_delta events they took', () => {
    const body = (events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}`).join('\n\n')
    const start = (index: number, name: string, type = 'tool_use') => ({
      type: 'content_block_start',
      index,
      content_block: { type, name }
    })
    const delta = (index: number, type = 'input_json_delta') => ({
      type: 'content_block_delta',
      index,
      delta: { type }
    })
    const exchange = (status: number, events: object[]): Exchange => ({
      request: {},
      status,
      contentType: status === 200 ? 'text/event-stream' : 'application/json',
      body: body(events)
    })
    expect(
      inputDeltas([
        exchange(200, [
          start(0, 'place_part'),
          delta(0),
          delta(0),
          delta(0),
          start(1, 'web_search', 'server_tool_use'),
          delta(1),
          start(2, 'connect'),
          delta(2),
          delta(2, 'text_delta')
        ]),
        exchange(200, [start(0, 'place_part'), delta(0)]),
        exchange(400, [start(0, 'place_part'), delta(0)])
      ])
    ).toEqual({ place_part: { calls: 2, deltas: 4 }, connect: { calls: 1, deltas: 1 } })
  })
})
