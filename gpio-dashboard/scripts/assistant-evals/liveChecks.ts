// The questions only the real API can answer (ADR-0084, ADR-0085, ADR-0086, ADR-0087). Each check
// sends the smallest request that settles it, records every exchange, and reports the API's own
// words when it refuses something.
import type Anthropic from '@anthropic-ai/sdk'
import { createClient, DEFAULT_MODEL } from '@renderer/assistant/client'
import { AssistantSession } from '@renderer/assistant/loop'
import { costUsd } from '@renderer/assistant/prices'
import { readMessage } from '@renderer/assistant/stream'
import { apiTools, STRICT_TOOLS, TOOLS, webTools } from '@renderer/assistant/tools'
import { NodeContext, type PythonRuntime } from './nodeContext'
import { recordFetch, sseUsage, type Exchange } from './tape'

export interface Row {
  n: number
  status: number
  /** Tools in the request: strict, eager, plain client tools and server tools. */
  strict: number
  eager: number
  client: number
  server: number
  topLevelCacheControl: boolean
  /** The API's message when it refused the request. */
  error: string | null
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  stop: string | null
  seconds: number
}

export interface LiveCheck {
  id: string
  question: string
  /** True: yes. False: no. Null: could not be settled. */
  answer: boolean | null
  summary: string
  rows: Row[]
  costUsd: number
}

type Tool = { type?: string; strict?: boolean; eager_input_streaming?: boolean }

const toolName = (t: Anthropic.ToolUnion) => (t as { name?: string }).name

function errorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string; message?: string } }
    return parsed.error ? `${parsed.error.type ?? 'error'}: ${parsed.error.message ?? ''}` : null
  } catch {
    return body.slice(0, 500)
  }
}

export function rows(exchanges: Exchange[], seconds: number[]): Row[] {
  return exchanges.map((e, i) => {
    const tools = (e.request.tools ?? []) as unknown as Tool[]
    const usage = e.status === 200 ? sseUsage(e.body) : null
    return {
      n: i + 1,
      status: e.status,
      strict: tools.filter((t) => t.strict).length,
      eager: tools.filter((t) => t.eager_input_streaming).length,
      client: tools.filter((t) => !t.type || t.type === 'custom').length,
      server: tools.filter((t) => t.type && t.type !== 'custom').length,
      topLevelCacheControl: 'cache_control' in e.request,
      error: e.status === 200 ? null : errorMessage(e.body),
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      stop: usage?.stopReason ?? null,
      seconds: seconds[i] ?? 0
    }
  })
}

export function exchangeCost(e: Exchange): number {
  if (e.status !== 200) return 0
  const u = sseUsage(e.body)
  return costUsd(String(e.request.model ?? DEFAULT_MODEL), u) ?? 0
}

/** A fetch that times each call, for the rows. */
function timed(real: typeof fetch) {
  const seconds: number[] = []
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = Date.now()
    const response = await real(input, init)
    seconds.push((Date.now() - started) / 1000)
    return response
  }) as typeof fetch
  return { fetch: wrapped, seconds }
}

const firstRefusal = (r: Row[]) => r.find((row) => row.status !== 200)

/**
 * Checks 1-3 in one two-turn conversation with the app's own tool set: is strict plus eager
 * accepted (and if not, which fallback ran), is the top-level cache_control accepted, and do
 * cache reads appear on the second request.
 */
export async function toolsAndCaching(
  live: typeof fetch,
  python: PythonRuntime,
  model: string
): Promise<LiveCheck[]> {
  const tape = recordFetch(live)
  const clock = timed(tape.fetch)
  const client = createClient(clock.fetch)
  const ctx = new NodeContext({ python })
  const session = new AssistantSession({
    client,
    ctx,
    model,
    effort: 'low',
    webTools: false,
    newTurnId: () => `check-${Date.now()}`
  })
  const notices: string[] = []
  for (const text of ['Reply with the single word: ready.', 'Reply with the single word: again.']) {
    const result = await session.runTurn(text, {
      onEvent: (e) => {
        if (e.type === 'notice') notices.push(`${e.code}: ${e.message}`)
      }
    })
    if (result.reason !== 'end_turn') notices.push(`turn ended ${result.reason}`)
  }
  await tape.settled()
  const table = rows(tape.exchanges, clock.seconds)
  const cost = tape.exchanges.reduce((sum, e) => sum + exchangeCost(e), 0)
  const first = table[0]
  const refused = firstRefusal(table)
  const ok = table.filter((r) => r.status === 200)
  const eagerAccepted = !!first && first.status === 200 && first.eager > 0 && first.strict > 0
  const chain = table
    .map((r) => `#${r.n}: ${r.status}, ${r.strict} strict, ${r.eager} eager`)
    .join('; ')
  const second = ok[1]
  const prefixTokens = ok[0] ? ok[0].cacheWriteTokens + ok[0].inputTokens : 0

  return [
    {
      id: 'strict-eager',
      question: 'Is the strict-plus-eager tool set accepted?',
      answer: eagerAccepted,
      summary: eagerAccepted
        ? `Yes: the first request (${first!.strict} strict tools, ${first!.eager} with eager_input_streaming) returned 200 and no fallback ran.`
        : `No. Requests: ${chain}. ${refused ? `First refusal, exactly: ${refused.error}` : ''} Fallback notices: ${notices.join(' | ') || 'none'}.`,
      rows: table,
      costUsd: cost
    },
    {
      id: 'strict-set',
      question: `Does the first request, with ${STRICT_TOOLS.size} strict tools and eager streaming, compile?`,
      answer: eagerAccepted,
      summary: eagerAccepted
        ? `Yes: request 1 carried ${first!.strict} strict tools and ${first!.eager} with eager_input_streaming and returned 200.`
        : `No. Requests: ${chain}. ${refused ? `Exactly: ${refused.error}` : ''}`,
      rows: table,
      costUsd: 0
    },
    {
      id: 'cache-control',
      question: 'Is the top-level cache_control accepted?',
      answer: ok.some((r) => r.topLevelCacheControl),
      summary: ok.some((r) => r.topLevelCacheControl)
        ? 'Yes: requests carrying a top-level cache_control (and one on the last system block) returned 200.'
        : `No. ${refused ? `Exactly: ${refused.error}` : ''}`,
      rows: table,
      costUsd: 0
    },
    {
      id: 'cache-reads',
      question: 'Do cache reads appear on a later request?',
      answer: second ? second.cacheReadTokens > 0 : null,
      summary: second
        ? `Request 2 read ${second.cacheReadTokens} tokens from the cache (request 1 wrote ${ok[0]?.cacheWriteTokens ?? 0} and read ${ok[0]?.cacheReadTokens ?? 0}; its prefix was about ${prefixTokens} tokens). Request 2 wrote ${second.cacheWriteTokens} and billed ${second.inputTokens} uncached input tokens.`
        : 'Fewer than two requests succeeded.',
      rows: table,
      costUsd: 0
    }
  ]
}

/**
 * Check 4: the web tools declared with allowed_callers ["direct"], in one conversation that
 * searches and then fetches, resumed through pause_turn as the loop does.
 */
export async function serverTools(
  live: typeof fetch,
  model: string,
  available: { search: boolean; fetch: boolean }
): Promise<LiveCheck> {
  const question =
    'Do web_search_20260318 and web_fetch_20260318 run with allowed_callers ["direct"]?'
  if (!available.search && !available.fetch)
    return {
      id: 'server-tools',
      question,
      answer: null,
      summary: 'Not run: the organization has neither tool (see web-tools-enabled).',
      rows: [],
      costUsd: 0
    }
  const datasheet =
    'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmp280-ds001.pdf'
  const search = webTools().filter((t) => toolName(t) === 'web_search')
  const fetchOnly = webTools().filter((t) => toolName(t) === 'web_fetch')
  const scenarios: {
    label: string
    prompt: string
    tools: Anthropic.ToolUnion[]
    needs: string[]
  }[] = [
    ...(available.search
      ? [
          {
            label: 'search alone',
            prompt:
              'Your first action must be a web_search call for "Bosch Sensortec BMP280 datasheet" (do not answer from memory). Then tell me the URL of the datasheet PDF that it found.',
            tools: search,
            needs: ['web_search results']
          }
        ]
      : []),
    ...(available.fetch && !available.search
      ? [
          {
            label: 'fetch alone',
            prompt: `Call web_fetch on ${datasheet} and say, in one sentence, how the SDO pin sets the I2C address.`,
            tools: fetchOnly,
            needs: ['web_fetch ok']
          }
        ]
      : []),
    ...(available.search && available.fetch
      ? [
          {
            label: 'search then fetch',
            prompt:
              'Your first action must be a web_search call for "Bosch Sensortec BMP280 datasheet" (do not answer from memory). Then call web_fetch on the datasheet PDF URL that the search returned (do not guess a URL), and say, in one sentence, how the SDO pin sets the I2C address.',
            tools: webTools(),
            needs: ['web_search results', 'web_fetch ok']
          }
        ]
      : [])
  ]
  const tape = recordFetch(live)
  const clock = timed(tape.fetch)
  const client = createClient(clock.fetch)
  const report: string[] = []
  let all = true
  for (const scenario of scenarios) {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: scenario.prompt }]
    const seen: string[] = []
    let stop: string | null = null
    try {
      for (let round = 0; round < 6; round++) {
        const stream = await client.messages.create({
          model,
          max_tokens: 8000,
          stream: true,
          system: [{ type: 'text', text: 'You are a terse electronics assistant.' }],
          tools: scenario.tools,
          messages,
          output_config: { effort: 'low' }
        })
        const message = await readMessage(stream)
        for (const block of message.content) {
          if (block.type === 'server_tool_use')
            seen.push(`${block.name} ${JSON.stringify(block.input).slice(0, 120)}`)
          else if (block.type === 'web_search_tool_result')
            seen.push(
              Array.isArray(block.content)
                ? `web_search results: ${block.content.length}`
                : `web_search error: ${block.content.error_code}`
            )
          else if (block.type === 'web_fetch_tool_result')
            seen.push(
              block.content.type === 'web_fetch_result'
                ? `web_fetch ok: ${block.content.url}`
                : `web_fetch error: ${block.content.error_code}`
            )
        }
        stop = message.stopReason
        if (message.stopReason !== 'pause_turn') break
        messages.push({
          role: 'assistant',
          content: message.content as Anthropic.ContentBlockParam[]
        })
      }
    } catch (e) {
      seen.push(`request failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    const ok = scenario.needs.every((n) => seen.some((s) => s.startsWith(n)))
    all &&= ok
    report.push(
      `${scenario.label}: ${ok ? 'ran' : 'did not complete'} (stop ${stop}) [${seen.join(' | ')}]`
    )
  }
  await tape.settled()
  const table = rows(tape.exchanges, clock.seconds)
  return {
    id: 'server-tools',
    question,
    answer: scenarios.length ? all && table.every((r) => r.status === 200) : null,
    summary: report.join('. ') || 'Nothing to run.',
    rows: table,
    costUsd: tape.exchanges.reduce((sum, e) => sum + exchangeCost(e), 0)
  }
}

// --- Which tool sets the API accepts ---

type ApiTool = Anthropic.Tool & { strict?: boolean; eager_input_streaming?: boolean }

interface Probe {
  ok: boolean
  /** The API's own words when it refused: `type: message`. */
  message: string | null
  costUsd: number
}

/** The smallest request that carries `tools`: the grammar of a strict tool compiles up front. */
export async function probe(
  client: Anthropic,
  model: string,
  tools: Anthropic.ToolUnion[]
): Promise<Probe> {
  try {
    const message = await client.messages.create({
      model,
      max_tokens: 16,
      system: 'Reply with the single word ok.',
      messages: [{ role: 'user', content: 'ok?' }],
      tools,
      output_config: { effort: 'low' }
    })
    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      webSearches: 0
    }
    return { ok: true, message: null, costUsd: costUsd(model, usage) ?? 0 }
  } catch (e) {
    const body = (e as { error?: { error?: { type?: string; message?: string } } }).error?.error
    return {
      ok: false,
      message: body ? `${body.type}: ${body.message}` : e instanceof Error ? e.message : String(e),
      costUsd: 0
    }
  }
}

/**
 * What compiles. Strict tools are limited by the size of their compiled grammar, which no
 * documentation gives: this finds, for the app's own schemas, whether eager streaming works
 * without strict, how each strict tool does alone, and which strict tools fit together.
 */
export async function toolAcceptance(
  live: typeof fetch,
  model: string
): Promise<{ checks: LiveCheck[]; web: { search: boolean; fetch: boolean } }> {
  const client = createClient(live).withOptions({ maxRetries: 0 })
  // Every tool that takes parameters, strict: what the app sent before ADR-0105.
  const eligible = new Set(TOOLS.filter((t) => t.strict).map((t) => t.name))
  const asStrict = (names: ReadonlySet<string> | string[], eager: boolean) =>
    apiTools({ eager, strict: false }).map((t): Anthropic.ToolUnion => {
      const tool = t as ApiTool
      return [...names].includes(tool.name) ? { ...tool, strict: true } : tool
    })
  const mutates = TOOLS.filter((t) => t.mutates).map((t) => t.name)
  const checks: LiveCheck[] = []

  // Eager streaming with no strict tool at all.
  const plainEager = apiTools({ eager: true, strict: false })
  const eager = await probe(client, model, plainEager)
  checks.push({
    id: 'eager-plain',
    question: 'Are eager_input_streaming tools accepted when none is strict?',
    answer: eager.ok,
    summary: eager.ok
      ? `Yes: 22 plain tools, ${plainEager.filter((t) => t.eager_input_streaming).length} with eager_input_streaming, returned 200.`
      : `No. Exactly: ${eager.message}`,
    rows: [],
    costUsd: eager.costUsd
  })

  // Each strict tool alone.
  const alone: { name: string; result: Probe }[] = []
  for (const name of eligible) {
    const tool = asStrict([name], false).find((t) => (t as ApiTool).name === name)!
    alone.push({ name, result: await probe(client, model, [tool]) })
  }
  const aloneCost = alone.reduce((sum, a) => sum + a.result.costUsd, 0)
  const refused = alone.filter((a) => !a.result.ok)
  checks.push({
    id: 'strict-alone',
    question: 'Does each strict tool compile on its own?',
    answer: refused.length === 0,
    summary: refused.length
      ? `No: ${refused.map((a) => `${a.name} (${a.result.message})`).join('; ')}. The others compile alone: ${alone
          .filter((a) => a.result.ok)
          .map((a) => a.name)
          .join(', ')}.`
      : `Yes: all ${alone.length} compile alone.`,
    rows: [],
    costUsd: aloneCost
  })

  // All of them together, as the app sent them before: the whole 22-tool request.
  const all = await probe(client, model, asStrict(eligible, true))
  checks.push({
    id: 'strict-all',
    question: `Does the whole request compile with all ${eligible.size} parameterised tools strict?`,
    answer: all.ok,
    summary: all.ok
      ? `Yes: ${eligible.size} strict tools and eager streaming on the ${mutates.length} mutation tools returned 200.`
      : `No. Exactly: ${all.message}`,
    rows: [],
    costUsd: all.costUsd
  })

  // The app's set, then each remaining tool added to it in the whole request: is there room for
  // more than the set the app sends? A refused probe costs nothing.
  const set = await probe(client, model, asStrict(STRICT_TOOLS, true))
  let roomCost = set.costUsd
  const fits: string[] = []
  for (const name of [...eligible].filter((n) => !STRICT_TOOLS.has(n))) {
    const grown = await probe(client, model, asStrict([...STRICT_TOOLS, ...fits, name], true))
    roomCost += grown.costUsd
    if (grown.ok) fits.push(name)
  }
  checks.push({
    id: 'strict-room',
    question: `Is there room beyond the ${STRICT_TOOLS.size} strict tools the app sends?`,
    answer: fits.length > 0,
    summary: `The app's set (${[...STRICT_TOOLS].join(', ')}) with eager streaming on the ${mutates.length} mutation tools ${set.ok ? 'returned 200' : `was refused, exactly: ${set.message}`}. Added one at a time to the whole request, ${fits.length ? `these also fit: ${fits.join(', ')}` : 'none of the other tools fit'}.`,
    rows: [],
    costUsd: roomCost
  })

  // The web tools, one at a time, called directly and with the default callers.
  const web: { name: string; tools: Anthropic.ToolUnion[] }[] = [
    { name: 'web_search, direct', tools: webTools().filter((t) => toolName(t) === 'web_search') },
    { name: 'web_fetch, direct', tools: webTools().filter((t) => toolName(t) === 'web_fetch') },
    {
      name: 'web_search, default callers',
      tools: [{ type: 'web_search_20260318', name: 'web_search', max_uses: 1 }]
    },
    {
      name: 'web_fetch, default callers',
      tools: [{ type: 'web_fetch_20260318', name: 'web_fetch', max_uses: 1 }]
    }
  ]
  const results: { name: string; result: Probe }[] = []
  for (const w of web) results.push({ name: w.name, result: await probe(client, model, w.tools) })
  checks.push({
    id: 'web-tools-enabled',
    question: 'Does the organization have web search and web fetch?',
    answer: results.every((r) => r.result.ok),
    summary: results
      .map(
        (r) => `${r.name}: ${r.result.ok ? 'accepted' : `refused, exactly: ${r.result.message}`}`
      )
      .join('. '),
    rows: [],
    costUsd: results.reduce((sum, r) => sum + r.result.costUsd, 0)
  })
  const ok = (name: string) => results.find((r) => r.name === name)?.result.ok ?? false
  return { checks, web: { search: ok('web_search, direct'), fetch: ok('web_fetch, direct') } }
}

/** Whether a request that carries web_search is accepted right now (a refused one costs nothing). */
export async function webSearchAccepted(live: typeof fetch, model: string): Promise<boolean> {
  const client = createClient(live).withOptions({ maxRetries: 0 })
  const found = await probe(
    client,
    model,
    webTools().filter((t) => toolName(t) === 'web_search')
  )
  return found.ok
}
