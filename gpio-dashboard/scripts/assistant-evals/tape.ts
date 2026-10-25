// Recording and replaying the API's side of a conversation (SPEC 18). A live run wraps fetch and
// keeps, for every request the SDK makes, the JSON body it sent and the status and body it got
// back (the SSE text of a stream). Headers are never read, so the key (an Authorization header) can
// not reach a fixture. Replay serves those responses in order with no network and no key.
//
// A fixture stores each request's `messages` as what was added since the request before: the
// history only grows (ADR-0087), so the full body is rebuilt on load and the file stays linear in
// the length of the conversation instead of quadratic.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export interface Exchange {
  /** The request body as sent. */
  request: Record<string, Json>
  status: number
  contentType: string
  /** The response body: SSE text for a stream, JSON for an error. */
  body: string
}

/** The keys whose values are opaque account-bound tokens: kept out of a public repository. */
const OPAQUE_KEYS = new Set(['signature', 'encrypted_content', 'encrypted_index'])
export const SCRUBBED = 'scrubbed'

export function scrubValue(value: Json): Json {
  if (Array.isArray(value)) return value.map(scrubValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        OPAQUE_KEYS.has(k) && typeof v === 'string' && v !== '' ? SCRUBBED : scrubValue(v)
      ])
    )
  }
  return value
}

/** Scrubs the JSON of every `data:` line of an SSE body, leaving everything else as it was. */
export function scrubSse(sse: string): string {
  return sse
    .split('\n')
    .map((line) => {
      if (!line.startsWith('data: ')) return line
      try {
        return `data: ${JSON.stringify(scrubValue(JSON.parse(line.slice(6)) as Json))}`
      } catch {
        return line
      }
    })
    .join('\n')
}

export function scrubExchange(e: Exchange): Exchange {
  const streamed = e.contentType.includes('text/event-stream')
  return {
    request: scrubValue(e.request) as Exchange['request'],
    status: e.status,
    contentType: e.contentType,
    body: streamed ? scrubSse(e.body) : JSON.stringify(scrubValue(parseOr(e.body)))
  }
}

const parseOr = (text: string): Json => {
  try {
    return JSON.parse(text) as Json
  } catch {
    return text
  }
}

// --- Recording ---

export interface Tape {
  fetch: typeof fetch
  exchanges: Exchange[]
  /** Resolves when every response body has been read to its end. */
  settled(): Promise<void>
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
  } catch {
    // An aborted request ends its body early; the tape keeps what arrived.
  }
  return text + decoder.decode()
}

/** Wraps `real`, keeping each request body and response, and nothing of any header. */
export function recordFetch(real: typeof fetch, onExchange?: (e: Exchange) => void): Tape {
  const exchanges: Exchange[] = []
  const reading: Promise<void>[] = []
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof init?.body === 'string' ? init.body : '{}'
    const response = await real(input, init)
    const entry: Exchange = {
      request: JSON.parse(raw) as Exchange['request'],
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: ''
    }
    exchanges.push(entry)
    if (!response.body) return response
    const [forCaller, forTape] = response.body.tee()
    reading.push(
      drain(forTape).then((text) => {
        entry.body = text
        onExchange?.(entry)
      })
    )
    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    return new Response(forCaller, { status: response.status, headers })
  }
  return {
    fetch: wrapped as typeof fetch,
    exchanges,
    settled: async () => void (await Promise.all(reading))
  }
}

// --- Replay ---

const CHUNK_BYTES = 4096

function bodyStream(text: string, signal: AbortSignal | null | undefined) {
  const bytes = new TextEncoder().encode(text)
  let at = 0
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () =>
        controller.error(new DOMException('The operation was aborted.', 'AbortError'))
      )
    },
    pull(controller) {
      if (at < bytes.length) {
        controller.enqueue(bytes.slice(at, at + CHUNK_BYTES))
        at += CHUNK_BYTES
      } else controller.close()
    }
  })
}

export interface Replay {
  fetch: typeof fetch
  /** The request bodies the loop sent, in order. */
  sent: Record<string, Json>[]
  /** Recorded responses not asked for. */
  remaining(): number
}

export function replayFetch(exchanges: readonly Exchange[]): Replay {
  const sent: Record<string, Json>[] = []
  let next = 0
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sent.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, Json>)
    const exchange = exchanges[next++]
    if (!exchange)
      throw new Error(`Replay has no recorded response for request ${next}; re-record this prompt`)
    return new Response(bodyStream(exchange.body, init?.signal), {
      status: exchange.status,
      headers: { 'content-type': exchange.contentType }
    })
  }
  return {
    fetch: fetchImpl as typeof fetch,
    sent,
    remaining: () => exchanges.length - next
  }
}

// --- Fixture files ---

export interface FixtureRun {
  /** The user messages of the conversation, in order. */
  turns: string[]
  model: string
  effort: string
  webTools: boolean
  /** The date of the live run (US Eastern, ISO date). */
  recorded: string
  sdk: string
  /** What the live run scored, check id to pass flag: replay must reproduce it. */
  expected: Record<string, boolean>
  /** Anything about how the run was made that a reader of the fixture needs to know. */
  notes?: string[]
  requests: StoredRequest[]
}

export interface StoredRequest {
  /** The request body without `system`, `tools` and `messages`. */
  rest: Record<string, Json>
  /** The `system` and `tools` when they differ from the request before (always on the first). */
  prefix?: { system: Json; tools: Json }
  /** Messages added since the previous request (all of them, when `reset`). */
  messages: Json[]
  reset?: boolean
  status: number
  contentType: string
  body: string
}

const same = (a: Json, b: Json) => canonical(a) === canonical(b)

/** JSON with every object's keys in order, to compare two bodies that were built differently. */
export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k] as Json)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

export function toStored(exchanges: readonly Exchange[]): Pick<FixtureRun, 'requests'> {
  let previous: Json[] = []
  let prefix: { system: Json; tools: Json } | null = null
  const requests = exchanges.map((e): StoredRequest => {
    const { system, tools, messages, ...rest } = e.request
    const list = (messages ?? []) as Json[]
    const grows =
      list.length >= previous.length && previous.every((m, i) => same(m, list[i] as Json))
    const here = { system: (system ?? null) as Json, tools: (tools ?? null) as Json }
    const changed = !prefix || !same(here as unknown as Json, prefix as unknown as Json)
    const stored: StoredRequest = {
      rest,
      ...(changed ? { prefix: here } : {}),
      messages: grows ? list.slice(previous.length) : list,
      ...(grows ? {} : { reset: true }),
      status: e.status,
      contentType: e.contentType,
      body: e.body
    }
    previous = list
    prefix = here
    return stored
  })
  return { requests }
}

/** The full request bodies and responses of a fixture, rebuilt from its stored form. */
export function fromStored(run: Pick<FixtureRun, 'requests'>): Exchange[] {
  let messages: Json[] = []
  let prefix: { system: Json; tools: Json } = { system: null, tools: null }
  return run.requests.map((r) => {
    messages = r.reset ? [...r.messages] : [...messages, ...r.messages]
    if (r.prefix) prefix = r.prefix
    const { system, tools } = prefix
    return {
      request: {
        ...r.rest,
        ...(system !== null ? { system } : {}),
        ...(tools !== null ? { tools } : {}),
        messages
      },
      status: r.status,
      contentType: r.contentType,
      body: r.body
    }
  })
}

// --- What a response reports ---

export interface ResponseUsage {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  webSearches: number
  stopReason: string | null
}

/** The token counts and stop reason of one streamed response, from its SSE text. */
export function sseUsage(sse: string): ResponseUsage {
  const usage: ResponseUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    webSearches: 0,
    stopReason: null
  }
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data: ')) continue
    let event: {
      type?: string
      message?: { usage?: Record<string, unknown> }
      usage?: Record<string, unknown>
      delta?: { stop_reason?: string }
    }
    try {
      event = JSON.parse(line.slice(6))
    } catch {
      continue
    }
    const u = event.type === 'message_start' ? event.message?.usage : event.usage
    if (u) {
      const n = (key: string, fallback: number) =>
        typeof u[key] === 'number' ? (u[key] as number) : fallback
      usage.inputTokens = n('input_tokens', usage.inputTokens)
      usage.outputTokens = n('output_tokens', usage.outputTokens)
      usage.cacheWriteTokens = n('cache_creation_input_tokens', usage.cacheWriteTokens)
      usage.cacheReadTokens = n('cache_read_input_tokens', usage.cacheReadTokens)
      const server = u.server_tool_use as { web_search_requests?: number } | undefined
      if (server?.web_search_requests) usage.webSearches = server.web_search_requests
    }
    if (event.type === 'message_delta' && event.delta?.stop_reason)
      usage.stopReason = event.delta.stop_reason
  }
  return usage
}

/** How a tool's input arrived: the calls the model made and the `input_json_delta` events they took. */
export interface InputDeltas {
  calls: number
  deltas: number
}

/**
 * Per client tool, the calls in the accepted responses and the input_json_delta events each took.
 * A tool streamed eagerly (eager_input_streaming) arrives in many small deltas, so the first
 * ghost can be drawn before the call is complete; without it the API holds the input back and
 * sends it whole, in one or two.
 */
export function inputDeltas(exchanges: readonly Exchange[]): Record<string, InputDeltas> {
  const out: Record<string, InputDeltas> = {}
  for (const e of exchanges) {
    if (e.status !== 200 || !e.contentType.includes('text/event-stream')) continue
    const names = new Map<number, string>()
    for (const line of e.body.split('\n')) {
      if (!line.startsWith('data: ')) continue
      let event: {
        type?: string
        index?: number
        content_block?: { type?: string; name?: string }
        delta?: { type?: string }
      }
      try {
        event = JSON.parse(line.slice(6))
      } catch {
        continue
      }
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        names.set(event.index ?? -1, event.content_block.name ?? '')
        const entry = (out[event.content_block.name ?? ''] ??= { calls: 0, deltas: 0 })
        entry.calls += 1
      } else if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'input_json_delta' &&
        names.has(event.index ?? -1)
      ) {
        out[names.get(event.index ?? -1)!]!.deltas += 1
      }
    }
  }
  return out
}
