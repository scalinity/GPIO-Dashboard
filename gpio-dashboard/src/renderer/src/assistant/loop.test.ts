import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { AssistantSession, type AssistantEvent, type SessionOptions } from './loop'
import { FakeContext } from './testing/fakeContext'
import { THINKING_TOOL_STREAM, WEB_SEARCH_STREAM } from './testing/fixtures'
import {
  events as eventsOf,
  jsonError,
  scriptedFetch,
  serverToolUse,
  testClient,
  text,
  thinking,
  toolUse,
  whole,
  type Ev,
  type Reply,
  type Scripted
} from './testing/sse'

function setup(script: Scripted[], options: Partial<SessionOptions> = {}, bytesPerChunk?: number) {
  const ctx = new FakeContext()
  const served = scriptedFetch(script, bytesPerChunk)
  const session = new AssistantSession({ client: testClient(served.fetch), ctx, ...options })
  const log: AssistantEvent[] = []
  const run = (message: string, signal?: AbortSignal) =>
    session.runTurn(message, { onEvent: (e) => log.push(e), signal })
  return { ctx, session, requests: served.requests, log, run }
}

const end = (...blocks: Reply['blocks']): Reply => ({ blocks, stop: 'end_turn' })
const tools = (...blocks: Reply['blocks']): Reply => ({ blocks, stop: 'tool_use' })

/** The tool_result blocks of the last user message in a recorded request. */
function resultsOf(request: { body: Record<string, unknown> }) {
  const messages = request.body.messages as Anthropic.MessageParam[]
  return (messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]).filter(
    (b) => b.type === 'tool_result'
  )
}

describe('the request', () => {
  it('goes through the SDK as SPEC 12.1 and 12.3 describe', async () => {
    const t = setup([end(text('Hello there'))])
    const result = await t.run('hi')
    expect(result.reason).toBe('end_turn')

    const [request] = t.requests
    expect(request!.headers.get('anthropic-version')).toBe('2026-10-21')
    expect(request!.headers.get('authorization')).toMatch(/^Bearer /)
    expect(request!.headers.get('x-api-key')).toBeNull()

    const body = request!.body
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      stream: true,
      output_config: { effort: 'high' },
      cache_control: { type: 'ephemeral' }
    })
    // No sampling parameters and no thinking switch: Opus 5.5 thinks adaptively by itself.
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking'])
      expect(body).not.toHaveProperty(key)
    const system = body.system as Anthropic.TextBlockParam[]
    expect(system).toHaveLength(2)
    expect(system[0]!.cache_control).toBeUndefined()
    expect(system[1]).toMatchObject({ cache_control: { type: 'ephemeral' } })
    expect(system[1]!.text).toContain('resistor')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('declares 22 strict client tools plus the web tools, called directly', async () => {
    const t = setup([end(text('ok'))])
    await t.run('hi')
    const list = t.requests[0]!.body.tools as Record<string, unknown>[]
    expect(list.filter((x) => !('type' in x))).toHaveLength(22)
    expect(list.slice(-2)).toEqual([
      { type: 'web_search_20260318', name: 'web_search', max_uses: 6, allowed_callers: ['direct'] },
      {
        type: 'web_fetch_20260318',
        name: 'web_fetch',
        max_uses: 4,
        max_content_tokens: 30000,
        allowed_callers: ['direct']
      }
    ])
  })

  it('leaves the web tools out when they are off', async () => {
    const t = setup([end(text('ok'))], { webTools: false })
    await t.run('hi')
    const list = t.requests[0]!.body.tools as Record<string, unknown>[]
    expect(list).toHaveLength(22)
    expect(list.some((x) => 'type' in x)).toBe(false)
  })

  it('takes model and effort from the session and per turn', async () => {
    const t = setup([end(text('a')), end(text('b'))], {
      model: 'claude-sonnet-5-5',
      effort: 'medium'
    })
    await t.run('one')
    await t.session.runTurn('two', { model: 'claude-fable-5-1', effort: 'xhigh' })
    expect(t.requests[0]!.body).toMatchObject({
      model: 'claude-sonnet-5-5',
      output_config: { effort: 'medium' }
    })
    expect(t.requests[1]!.body).toMatchObject({
      model: 'claude-fable-5-1',
      output_config: { effort: 'xhigh' }
    })
  })

  it('keeps the system prompt and tools byte-identical across turns and appends only', async () => {
    const t = setup([end(text('a')), end(text('b'))])
    await t.run('one')
    await t.run('two')
    const [first, second] = t.requests
    expect(JSON.stringify(second!.body.system)).toBe(JSON.stringify(first!.body.system))
    expect(JSON.stringify(second!.body.tools)).toBe(JSON.stringify(first!.body.tools))
    const before = first!.body.messages as unknown[]
    expect((second!.body.messages as unknown[]).slice(0, before.length)).toEqual(before)
    expect((second!.body.messages as unknown[]).length).toBe(before.length + 2)
  })
})

describe('stop reasons', () => {
  it('end_turn ends the turn with the text streamed', async () => {
    const t = setup([end(text('Hello there, friend'))], {}, 7)
    const result = await t.run('hi')
    expect(result).toMatchObject({ reason: 'end_turn', toolCalls: 0 })
    const streamed = t.log.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('')
    expect(streamed).toBe('Hello there, friend')
    expect(t.session.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello there, friend' }] }
    ])
  })

  it('tool_use runs the tools and sends every result in one user message', async () => {
    const t = setup([
      tools(
        text('Looking.'),
        toolUse('toolu_1', 'search_parts', { query: 'led' }),
        toolUse('toolu_2', 'get_circuit_state', { detail: 'summary' })
      ),
      end(text('Done.'))
    ])
    const result = await t.run('find an LED')
    expect(result).toMatchObject({ reason: 'end_turn', toolCalls: 2 })
    const results = resultsOf(t.requests[1]!)
    expect(results.map((r) => r.tool_use_id)).toEqual(['toolu_1', 'toolu_2'])
    expect(String(results[0]!.content)).toContain('"id":"led"')
    expect(results.every((r) => !r.is_error)).toBe(true)
  })

  it('max_tokens never runs a tool, keeps the history valid and says so', async () => {
    const cut: Ev[] = eventsOf(tools(toolUse('toolu_1', 'remove_part', { ref: 'R1' }))).filter(
      (e) => e.type !== 'message_delta' && e.type !== 'message_stop'
    )
    // A second call begins and the output limit hits before it closes.
    cut.push(
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_2', name: 'place_part', input: {} }
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"defId":"resi' }
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'max_tokens', stop_sequence: null },
        usage: { output_tokens: 64000 }
      },
      { type: 'message_stop' }
    )
    const t = setup([cut])
    const result = await t.run('build')
    expect(result.reason).toBe('max_tokens')
    expect(t.log.some((e) => e.type === 'notice' && e.code === 'max_tokens')).toBe(true)
    const [, assistant, user] = t.session.messages as [
      unknown,
      Anthropic.MessageParam,
      Anthropic.MessageParam
    ]
    // The block that never closed is dropped; the complete call is answered, not run.
    expect((assistant.content as Anthropic.ContentBlockParam[]).map((b) => b.type)).toEqual([
      'tool_use'
    ])
    expect(user.content).toMatchObject([{ tool_use_id: 'toolu_1', is_error: true }])
    expect(String((user.content as Anthropic.ToolResultBlockParam[])[0]!.content)).toContain(
      'TRUNCATED'
    )
    expect(result.toolCalls).toBe(0)
  })

  it('max_tokens with plain text keeps the text', async () => {
    const t = setup([{ blocks: [text('Partial answ')], stop: 'max_tokens' }])
    const result = await t.run('explain')
    expect(result.reason).toBe('max_tokens')
    expect(t.session.messages.at(-1)).toMatchObject({ role: 'assistant' })
  })

  it('a thinking block cut off mid-stream is not sent back', async () => {
    const half: Ev[] = [
      eventsOf({ blocks: [], stop: null })[0]!,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' }
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me' }
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'max_tokens', stop_sequence: null },
        usage: { output_tokens: 64000 }
      },
      { type: 'message_stop' }
    ]
    const t = setup([half])
    const result = await t.run('hard one')
    expect(result.reason).toBe('max_tokens')
    expect(t.session.messages).toEqual([{ role: 'user', content: 'hard one' }])
  })

  it('pause_turn sends the paused content back as it was, with no new user message', async () => {
    const search = serverToolUse('srvtoolu_1', 'web_search', { query: 'vl53l0x datasheet' })
    const t = setup([
      { blocks: [text('Searching.'), search], stop: 'pause_turn' },
      end(text('Found it.'))
    ])
    const result = await t.run('add a VL53L0X')
    expect(result.reason).toBe('end_turn')
    const messages = t.requests[1]!.body.messages as Anthropic.MessageParam[]
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[1]!.content).toMatchObject([
      { type: 'text', text: 'Searching.' },
      { type: 'server_tool_use', id: 'srvtoolu_1', input: { query: 'vl53l0x datasheet' } }
    ])
  })

  it('gives up on a turn that pauses without end, and leaves the history valid', async () => {
    const pause: Reply = {
      blocks: [serverToolUse('srvtoolu_1', 'web_search', { query: 'x' })],
      stop: 'pause_turn'
    }
    const t = setup(Array.from({ length: 12 }, () => pause))
    const result = await t.run('search forever')
    expect(result.reason).toBe('pause-limit')
    expect(t.session.messages.at(-1)).toMatchObject({ role: 'assistant' })
    expect(t.requests.length).toBeLessThanOrEqual(10)
  })

  it('refusal is reported with its category and is not kept in the history', async () => {
    const t = setup([
      {
        blocks: [text('I can')],
        stop: 'refusal',
        stopDetails: { type: 'refusal', category: 'cyber', explanation: 'Declined.' }
      }
    ])
    const result = await t.run('something')
    expect(result).toMatchObject({
      reason: 'refusal',
      refusal: { category: 'cyber', explanation: 'Declined.' }
    })
    expect(t.session.messages).toEqual([{ role: 'user', content: 'something' }])
  })

  it('a stream that ends with no stop reason is an error, not a hang', async () => {
    const t = setup([{ blocks: [text('Partial')], stop: null }])
    const result = await t.run('hi')
    expect(result.reason).toBe('error')
    expect(t.log.some((e) => e.type === 'error')).toBe(true)
    expect(t.session.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('reports an HTTP error and an error event in the stream', async () => {
    const http = setup([jsonError(400, 'invalid_request_error', 'messages: bad')])
    expect(await http.run('hi')).toMatchObject({ reason: 'error', error: { code: '400' } })

    const overloaded = setup([
      [
        ...eventsOf({ blocks: [text('Hel')], stop: null }).slice(0, 3),
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
      ]
    ])
    const result = await overloaded.run('hi')
    expect(result.reason).toBe('error')
    expect(result.error?.message).toMatch(/overloaded/i)
  })

  it('ignores event types it does not know', async () => {
    const list = eventsOf(end(text('fine')))
    list.splice(2, 0, { type: 'a_new_event', data: 1 })
    const t = setup([list])
    expect((await t.run('hi')).reason).toBe('end_turn')
  })
})

describe('content blocks', () => {
  it('are sent back exactly as received: thinking, server tools, results, text, tool calls', async () => {
    const results = [
      {
        type: 'web_search_result',
        title: 'VL53L0X',
        url: 'https://www.st.com/resource/en/datasheet/vl53l0x.pdf',
        encrypted_content: 'Ev0DCioIAxgCIiQ3NmU4ZmI4OC1k',
        page_age: null
      }
    ]
    const blocks = [
      thinking('Plan the pins.', 'EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxB'),
      text('I will check the datasheet.'),
      serverToolUse('srvtoolu_01', 'web_search', { query: 'vl53l0x pinout' }),
      whole({ type: 'web_search_tool_result', tool_use_id: 'srvtoolu_01', content: results }),
      toolUse('toolu_01', 'get_circuit_state', { detail: 'summary' })
    ]
    const t = setup([tools(...blocks), end(text('Done'))], {}, 11)
    await t.run('add a distance sensor')
    const sent = (t.requests[1]!.body.messages as Anthropic.MessageParam[])[1]!.content
    expect(JSON.stringify(sent)).toBe(
      JSON.stringify([
        {
          type: 'thinking',
          thinking: 'Plan the pins.',
          signature: 'EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxB'
        },
        { type: 'text', text: 'I will check the datasheet.' },
        {
          type: 'server_tool_use',
          id: 'srvtoolu_01',
          name: 'web_search',
          input: { query: 'vl53l0x pinout' }
        },
        { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_01', content: results },
        {
          type: 'tool_use',
          id: 'toolu_01',
          name: 'get_circuit_state',
          input: { detail: 'summary' }
        }
      ])
    )
  })

  it('keep text citations', async () => {
    const citation = {
      type: 'web_search_result_location',
      cited_text: 'x',
      url: 'https://a.example',
      title: 'A',
      encrypted_index: 'e'
    }
    const block = text('Cited.')
    block.deltas.push({ type: 'citations_delta', citation })
    const t = setup([end(block)])
    await t.run('hi')
    expect(t.session.messages[1]).toMatchObject({
      content: [{ type: 'text', text: 'Cited.', citations: [citation] }]
    })
  })

  it('a turn that mixes a server tool and a client tool answers only the client tool', async () => {
    const t = setup([
      // The fetch has not run: no result block follows it (SPEC: mixing server and client tools).
      tools(
        serverToolUse('srvtoolu_9', 'web_fetch', { url: 'https://a.example/ds.pdf' }),
        toolUse('toolu_9', 'run_erc', {})
      ),
      end(text('Both done.'))
    ])
    await t.run('check it')
    const results = resultsOf(t.requests[1]!)
    expect(results).toHaveLength(1)
    expect(results[0]!.tool_use_id).toBe('toolu_9')
    expect(JSON.stringify(t.requests[1]!.body.tools)).toBe(
      JSON.stringify(t.requests[0]!.body.tools)
    )
    expect((t.requests[1]!.body.messages as unknown[]).length).toBe(3)
  })

  it('a tool input that is not JSON comes back as INVALID_JSON with the raw text', async () => {
    const raw = '{"query": "led'
    const t = setup([tools(toolUse('toolu_1', 'search_parts', raw)), end(text('Sorry.'))])
    const result = await t.run('find')
    expect(result.reason).toBe('end_turn')
    const [r] = resultsOf(t.requests[1]!)
    expect(r).toMatchObject({ tool_use_id: 'toolu_1', is_error: true })
    expect(r!.content).toBe(JSON.stringify({ INVALID_JSON: raw }))
    // The block goes back with an empty object, since the API needs one.
    const sent = (t.requests[1]!.body.messages as Anthropic.MessageParam[])[1]!.content
    expect(sent).toMatchObject([{ type: 'tool_use', input: {} }])
  })

  it('a tool input that is JSON but not an object is invalid too', async () => {
    const t = setup([tools(toolUse('toolu_1', 'search_parts', '[1,2]')), end(text('Hm.'))])
    await t.run('find')
    expect(resultsOf(t.requests[1]!)[0]!.content).toBe(JSON.stringify({ INVALID_JSON: '[1,2]' }))
  })

  it('an unknown tool or bad input is an error result, not a crash', async () => {
    const t = setup([
      tools(
        toolUse('toolu_1', 'launch_missiles', {}),
        toolUse('toolu_2', 'search_parts', { wrong: 1 })
      ),
      end(text('Oops.'))
    ])
    expect((await t.run('go')).reason).toBe('end_turn')
    const [a, b] = resultsOf(t.requests[1]!)
    expect(a).toMatchObject({
      is_error: true,
      content: JSON.stringify({ UNKNOWN_TOOL: 'launch_missiles' })
    })
    expect(b).toMatchObject({ is_error: true })
    expect(String(b!.content)).toContain('INVALID_INPUT')
  })
})

describe('events', () => {
  it('report chips, partial inputs, committed results and usage', async () => {
    const place = toolUse(
      'toolu_1',
      'place_part',
      {
        defId: 'resistor',
        at: 'bb1:30b',
        orientation: 0,
        props: [{ name: 'resistance', value: 330 }]
      },
      6
    )
    const t = setup([tools(place), end(text('Placed.'))])
    const result = await t.run('place a resistor')
    const types = t.log.map((e) => e.type)
    expect(types[0]).toBe('turn-start')
    expect(types.at(-1)).toBe('turn-end')
    expect(t.log.find((e) => e.type === 'tool-start')).toMatchObject({
      id: 'toolu_1',
      name: 'place_part',
      server: false
    })
    const inputs = t.log.filter((e) => e.type === 'tool-input')
    expect(inputs.length).toBeGreaterThan(3)
    // Snapshots grow; the first has no `at`, a later one has it before the input completes.
    const partials = inputs.filter((e) => e.type === 'tool-input' && !e.complete)
    expect(partials.some((e) => e.type === 'tool-input' && e.input && 'at' in e.input)).toBe(true)
    expect(inputs.at(-1)).toMatchObject({ complete: true, label: 'Placing resistor…' })
    const committed = t.log.find((e) => e.type === 'tool-result' && !e.server)
    expect(committed).toMatchObject({
      ok: true,
      transactions: [{ assistantTurnId: result.turnId }]
    })
    expect(result.transactions).toHaveLength(1)
    expect(t.log.find((e) => e.type === 'usage')).toMatchObject({ usage: { requests: 2 } })
  })

  it('show a ghost before the call completes and clear it once it is committed', async () => {
    const place = toolUse(
      'toolu_1',
      'place_part',
      { defId: 'resistor', at: 'bb1:30b', orientation: 0, props: [] },
      4
    )
    const t = setup([tools(place), end(text('Placed.'))])
    await t.run('place')
    const log = t.ctx.ghostLog.filter((g) => g.id === 'toolu_1')
    expect(log.length).toBeGreaterThanOrEqual(2)
    expect(log[0]!.ghost).toMatchObject({ kind: 'part', defId: 'resistor', ref: 'R1' })
    expect(log.at(-1)!.ghost).toBeNull()
    // The ghost was up while the real part did not exist yet; afterwards the part does.
    expect(t.ctx.getSnapshot().parts.map((p) => p.id)).toEqual(['R1'])
  })

  it('show server tool chips and their results', async () => {
    const t = setup([
      {
        blocks: [
          serverToolUse('srvtoolu_1', 'web_search', { query: 'q' }),
          whole({
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_1',
            content: [
              {
                type: 'web_search_result',
                title: 'a',
                url: 'https://a.example',
                encrypted_content: 'x',
                page_age: null
              }
            ]
          }),
          text('Found.')
        ],
        stop: 'end_turn',
        usage: { searches: 1 }
      }
    ])
    const result = await t.run('look it up')
    expect(t.log.find((e) => e.type === 'tool-start')).toMatchObject({
      server: true,
      label: 'Searching the web…'
    })
    expect(t.log.find((e) => e.type === 'tool-result')).toMatchObject({
      server: true,
      ok: true,
      content: '1 results'
    })
    expect(result.usage.webSearches).toBe(1)
  })

  it('survive a listener that throws', async () => {
    const t = setup([end(text('fine'))])
    const result = await t.session.runTurn('hi', {
      onEvent: () => {
        throw new Error('ui bug')
      }
    })
    expect(result.reason).toBe('end_turn')
  })
})

describe('usage and cost', () => {
  it('sums every request of the turn and prices it', async () => {
    const t = setup([
      {
        ...tools(toolUse('toolu_1', 'run_erc', {})),
        usage: { input: 1000, output: 500, cacheWrite: 2000 }
      },
      { ...end(text('ok')), usage: { input: 200, output: 100, cacheRead: 3000 } }
    ])
    const { usage } = await t.run('check')
    expect(usage).toMatchObject({
      requests: 2,
      inputTokens: 1200,
      outputTokens: 600,
      cacheWriteTokens: 2000,
      cacheReadTokens: 3000
    })
    // Opus 5.5: $4 in, $5 cache write, $0.20 cache read, $20 out, per million tokens.
    expect(usage.costUsd).toBeCloseTo((1200 * 4 + 2000 * 5 + 3000 * 0.2 + 600 * 20) / 1e6, 8)
  })

  it('leaves the cost unknown for a model without a price', async () => {
    const t = setup([{ ...end(text('ok')), model: 'claude-x-9' }], { model: 'claude-x-9' })
    expect((await t.run('hi')).usage.costUsd).toBeNull()
  })
})

describe('the tool-call cap', () => {
  it('stops running tools at the cap and asks the model to summarize without tools', async () => {
    const state = (id: string) => toolUse(id, 'get_circuit_state', { detail: 'summary' })
    const t = setup(
      [tools(state('a'), state('b'), state('c')), end(text('I did two things. Continue?'))],
      {
        toolCallCap: 2
      }
    )
    const result = await t.run('go')
    expect(result).toMatchObject({ reason: 'tool-cap', toolCalls: 2 })
    const results = resultsOf(t.requests[1]!)
    expect(results.map((r) => !!r.is_error)).toEqual([false, false, true])
    expect(String(results[2]!.content)).toContain('TOOL_CALL_CAP')
    expect(t.requests[0]!.body).not.toHaveProperty('tool_choice')
    expect(t.requests[1]!.body.tool_choice).toEqual({ type: 'none' })
  })

  it('counts calls across the whole turn, and starts afresh the next turn', async () => {
    const one = (id: string) => tools(toolUse(id, 'run_erc', {}))
    const t = setup([one('a'), one('b'), end(text('ok')), end(text('again'))], { toolCallCap: 2 })
    const first = await t.run('go')
    expect(first.reason).toBe('end_turn')
    expect(first.toolCalls).toBe(2)
    const second = await t.run('more')
    expect(second.toolCalls).toBe(0)
  })
})

describe('abort', () => {
  it('stops mid-stream, keeps what was committed, and leaves a valid history', async () => {
    const place = tools(
      toolUse('toolu_1', 'place_part', {
        defId: 'resistor',
        at: 'bb1:30b',
        orientation: 0,
        props: []
      })
    )
    const partial = eventsOf({ blocks: [text('Now the LED')], stop: null }).slice(0, 4)
    const t = setup([place, { hangAfter: partial }])
    const controller = new AbortController()
    t.log.push = (e: AssistantEvent) => {
      if (e.type === 'text') controller.abort()
      return 0
    }
    const result = await t.run('build', controller.signal)
    expect(result.reason).toBe('aborted')
    expect(result.toolCalls).toBe(1)
    expect(t.ctx.getSnapshot().parts.map((p) => p.id)).toEqual(['R1'])
    // Ends with the tool result; the half-received reply was dropped.
    expect(t.session.messages.at(-1)).toMatchObject({ role: 'user' })
    expect(t.session.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('clears the ghost of a call that never finished streaming', async () => {
    const place = toolUse(
      'toolu_1',
      'place_part',
      { defId: 'resistor', at: 'bb1:30b', orientation: 0, props: [] },
      3
    )
    const cut = eventsOf({ blocks: [place], stop: null }).filter(
      (e) => e.type !== 'content_block_stop' && e.type !== 'message_stop'
    )
    const t = setup([{ hangAfter: cut }])
    const controller = new AbortController()
    const original = t.ctx.setGhost
    t.ctx.setGhost = (id, ghost) => {
      original(id, ghost)
      if (ghost) controller.abort()
    }
    const result = await t.run('place', controller.signal)
    expect(result.reason).toBe('aborted')
    expect(t.ctx.ghostLog.at(0)!.ghost).not.toBeNull()
    expect(t.ctx.ghostLog.at(-1)).toMatchObject({ id: 'toolu_1', ghost: null })
    expect(t.ctx.getSnapshot().parts).toHaveLength(0)
  })

  it('stops while a tool waits for the user, and answers the calls it skipped', async () => {
    const t = setup([
      tools(
        toolUse('toolu_1', 'ask_user', { question: 'Which?', options: ['a', 'b'] }),
        toolUse('toolu_2', 'run_erc', {})
      )
    ])
    const controller = new AbortController()
    t.ctx.askUser = (_q, _o, signal) =>
      new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('stopped')))
        controller.abort()
      })
    const result = await t.run('ask', controller.signal)
    expect(result.reason).toBe('aborted')
    const results = t.session.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]
    expect(results.map((r) => r.tool_use_id)).toEqual(['toolu_1', 'toolu_2'])
    expect(results.every((r) => r.is_error)).toBe(true)
  })

  it('does not start when already aborted', async () => {
    const t = setup([])
    const controller = new AbortController()
    controller.abort()
    const result = await t.run('hi', controller.signal)
    expect(result.reason).toBe('aborted')
    expect(t.requests).toHaveLength(0)
  })
})

describe('plain tools fallback', () => {
  const tooComplex = () =>
    jsonError(400, 'invalid_request_error', 'tools: Schema is too complex for compilation.')

  it('first drops eager streaming and keeps strict (SPEC 12.4)', async () => {
    const t = setup([tooComplex(), end(text('Working.'))])
    const result = await t.run('hi')
    expect(result.reason).toBe('end_turn')
    const [first, second] = t.requests.map((r) => r.body.tools as Record<string, unknown>[])
    expect(first!.some((x) => x.strict === true)).toBe(true)
    expect(first!.some((x) => x.eager_input_streaming === true)).toBe(true)
    expect(second!.some((x) => x.strict === true)).toBe(true)
    expect(second!.some((x) => 'eager_input_streaming' in x)).toBe(false)
    expect(t.log.some((e) => e.type === 'notice' && e.code === 'plain-tools')).toBe(true)
  })

  it('drops strict only when the API refuses the strict schemas too', async () => {
    const t = setup([tooComplex(), tooComplex(), end(text('Working.'))])
    const result = await t.run('hi')
    expect(result.reason).toBe('end_turn')
    const third = t.requests[2]!.body.tools as Record<string, unknown>[]
    expect(third.some((x) => 'strict' in x || 'eager_input_streaming' in x)).toBe(false)
    expect(t.requests).toHaveLength(3)
  })

  it('does not retry once a thinking block could be bound to the tools', async () => {
    const t = setup([end(text('first')), tooComplex()])
    await t.run('one')
    const result = await t.run('two')
    expect(result.reason).toBe('error')
    expect(t.requests).toHaveLength(2)
  })
})

describe('the documented wire format', () => {
  const served = (stream: string) =>
    new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })

  it('reads the web search stream, ping included, and keeps its blocks', async () => {
    const t = setup([served(WEB_SEARCH_STREAM), end(text('Next.'))], {}, 13)
    const result = await t.run('look up the HC-SR04')
    expect(result.reason).toBe('end_turn')
    expect(result.usage).toMatchObject({ inputTokens: 10682, outputTokens: 510, webSearches: 1 })
    expect(t.log.find((e) => e.type === 'tool-start')).toMatchObject({
      id: 'srvtoolu_014hJH82Qum7Td6UV8gDXThB',
      server: true
    })
    const kept = t.session.messages[1]!.content as Anthropic.ContentBlockParam[]
    expect(kept.map((b) => b.type)).toEqual([
      'text',
      'server_tool_use',
      'web_search_tool_result',
      'text'
    ])
    expect(kept[1]).toMatchObject({ input: { query: 'HC-SR04 datasheet' } })
    expect(kept[2]).toMatchObject({
      content: [{ encrypted_content: 'Ev0DCioIAxgCIiQ3NmU4ZmI4OC1k...' }]
    })
    // The next turn sends them back untouched.
    await t.run('and the pinout?')
    expect((t.requests[1]!.body.messages as unknown[])[1]).toEqual({
      role: 'assistant',
      content: kept
    })
  })

  it('reads a thinking block and a tool call whose input arrives in pieces', async () => {
    const t = setup([served(THINKING_TOOL_STREAM), end(text('Fine.'))])
    await t.run('what is on the board?')
    const [, assistant] = t.requests[1]!.body.messages as Anthropic.MessageParam[]
    expect(assistant!.content).toEqual([
      {
        type: 'thinking',
        thinking: 'I need the circuit first.',
        signature: 'EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pkiMOYds'
      },
      { type: 'tool_use', id: 'toolu_01T', name: 'get_circuit_state', input: { detail: 'summary' } }
    ])
    expect(resultsOf(t.requests[1]!)[0]).toMatchObject({ tool_use_id: 'toolu_01T' })
  })
})

describe('resuming a saved conversation', () => {
  it('continues from the saved history', async () => {
    const t = setup([end(text('hello again'))], {
      history: [
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: [{ type: 'text', text: 'earlier reply' }] }
      ]
    })
    await t.run('now')
    const sent = t.requests[0]!.body.messages as unknown[]
    expect(sent).toHaveLength(3)
    expect(sent[0]).toEqual({ role: 'user', content: 'earlier' })
  })
})
