// Hand-written Messages API streams and a fetch that serves them, so the loop runs through the
// real SDK client with no network and no key. The event shapes follow
// https://platform.claude.com/docs/en/build-with-claude/streaming
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '../client'

export type Ev = Record<string, unknown>

/** One content block as events: its start, and the deltas that fill it. */
export interface BlockSpec {
  start: Ev
  deltas: Ev[]
}

export const text = (value: string, chunk = 5): BlockSpec => ({
  start: { type: 'text', text: '' },
  deltas: split(value, chunk).map((t) => ({ type: 'text_delta', text: t }))
})

export const thinking = (value: string, signature: string): BlockSpec => ({
  start: { type: 'thinking', thinking: '', signature: '' },
  deltas: [
    ...(value ? [{ type: 'thinking_delta', thinking: value }] : []),
    { type: 'signature_delta', signature }
  ]
})

function split(value: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size))
  return out
}

/** A tool call; `input` is an object (sent as JSON) or a string (sent as given, for bad JSON). */
export const toolUse = (id: string, name: string, input: unknown, chunk = 9): BlockSpec => ({
  start: { type: 'tool_use', id, name, input: {} },
  deltas: [
    { type: 'input_json_delta', partial_json: '' },
    ...split(typeof input === 'string' ? input : JSON.stringify(input), chunk).map((p) => ({
      type: 'input_json_delta',
      partial_json: p
    }))
  ]
})

export const serverToolUse = (id: string, name: string, input: unknown): BlockSpec => ({
  start: { type: 'server_tool_use', id, name, input: {} },
  deltas: split(JSON.stringify(input), 11).map((p) => ({
    type: 'input_json_delta',
    partial_json: p
  }))
})

/** A result block arrives whole, in its start event. */
export const whole = (block: Ev): BlockSpec => ({ start: block, deltas: [] })

export interface Reply {
  blocks: BlockSpec[]
  stop: string | null
  id?: string
  model?: string
  usage?: Partial<Record<'input' | 'output' | 'cacheWrite' | 'cacheRead' | 'searches', number>>
  stopDetails?: Ev
}

const usageOf = (u: Reply['usage'] = {}) => ({
  input_tokens: u.input ?? 100,
  cache_creation_input_tokens: u.cacheWrite ?? 0,
  cache_read_input_tokens: u.cacheRead ?? 0,
  output_tokens: u.output ?? 10,
  ...(u.searches ? { server_tool_use: { web_search_requests: u.searches } } : {})
})

/** The events of one streamed message, in the order the API sends them. */
export function events(reply: Reply): Ev[] {
  const out: Ev[] = [
    {
      type: 'message_start',
      message: {
        id: reply.id ?? 'msg_test',
        type: 'message',
        role: 'assistant',
        model: reply.model ?? 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { ...usageOf({ ...reply.usage, output: 1 }) }
      }
    }
  ]
  reply.blocks.forEach((block, index) => {
    out.push({ type: 'content_block_start', index, content_block: block.start })
    if (index === 0) out.push({ type: 'ping' })
    for (const delta of block.deltas) out.push({ type: 'content_block_delta', index, delta })
    out.push({ type: 'content_block_stop', index })
  })
  if (reply.stop !== null)
    out.push({
      type: 'message_delta',
      delta: {
        stop_reason: reply.stop,
        stop_sequence: null,
        ...(reply.stopDetails ? { stop_details: reply.stopDetails } : {})
      },
      usage: usageOf(reply.usage)
    })
  out.push({ type: 'message_stop' })
  return out
}

export const toSse = (list: Ev[]): string =>
  list.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join('')

export interface Recorded {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

/** One scripted reply: events, a ready Response, or events that stop and wait for an abort. */
export type Scripted = Reply | Ev[] | Response | { hangAfter: Ev[] }

const isReply = (s: Scripted): s is Reply => typeof s === 'object' && 'blocks' in s

function body(text: string, signal: AbortSignal | null | undefined, hang: boolean, size: number) {
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
        controller.enqueue(bytes.slice(at, at + size))
        at += size
      } else if (!hang) controller.close()
      else return new Promise<void>(() => {})
    }
  })
}

/**
 * A fetch that answers each request with the next scripted item and records what it was sent.
 * `bytesPerChunk` splits the body into small pieces, so SSE events straddle chunk boundaries.
 */
export function scriptedFetch(script: Scripted[], bytesPerChunk = 16 * 1024) {
  const requests: Recorded[] = []
  let next = 0
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : undefined
    const headers = new Headers(init?.headers ?? req?.headers)
    const raw = typeof init?.body === 'string' ? init.body : '{}'
    requests.push({ url: String(input), headers, body: JSON.parse(raw) as Record<string, unknown> })
    const item = script[next++]
    if (!item) throw new Error(`No scripted reply for request ${next}`)
    if (item instanceof Response) return item
    const hang = !Array.isArray(item) && 'hangAfter' in item
    const list = hang ? item.hangAfter : Array.isArray(item) ? item : events(item as Reply)
    return new Response(body(toSse(list), init?.signal, hang, bytesPerChunk), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })
  }
  return { fetch: fetchImpl as typeof fetch, requests, replies: () => script.filter(isReply) }
}

/** The client the app uses, on a scripted fetch, with no retries so errors show at once. */
export function testClient(fetchImpl: typeof fetch): Anthropic {
  const client = createClient(fetchImpl)
  return client.withOptions({ maxRetries: 0 })
}

export const jsonError = (status: number, type: string, message: string) =>
  new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json' }
  })
