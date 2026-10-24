import { describe, expect, it } from 'vitest'
import { createClient, DEFAULT_EFFORT, DEFAULT_MODEL, MAX_TOKENS, MODELS } from './client'
import { events, scriptedFetch, text } from './testing/sse'

describe('createClient', () => {
  it('speaks the 2026-10-21 API as SPEC 12.1 describes, with a placeholder key', async () => {
    const served = scriptedFetch([{ blocks: [text('hi')], stop: 'end_turn' }])
    const client = createClient(served.fetch)
    await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
      stream: true
    })
    const [request] = served.requests
    expect(request!.url).toMatch(/\/v1\/messages$/)
    expect(request!.headers.get('anthropic-version')).toBe('2026-10-21')
    // The real key is added in Rust, which strips this one first.
    expect(request!.headers.get('authorization')).toBe(
      'Bearer placeholder-the-proxy-adds-the-real-key'
    )
    expect(request!.headers.get('x-api-key')).toBeNull()
    expect(request!.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
    for (const key of ['temperature', 'top_p', 'top_k'])
      expect(request!.body).not.toHaveProperty(key)
  })

  it('defaults to Opus 5.5 at high effort with a 64k output limit', () => {
    expect([DEFAULT_MODEL, DEFAULT_EFFORT, MAX_TOKENS]).toEqual(['claude-opus-5-5', 'high', 64_000])
    expect(MODELS.map((m) => m.id)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-1'
    ])
  })

  it('reads the hand-written stream fixtures through the SDK parser, split at odd places', async () => {
    const reply = { blocks: [text('one two three', 3)], stop: 'end_turn' }
    const served = scriptedFetch([reply], 5)
    const stream = await createClient(served.fetch).messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 16,
      stream: true,
      messages: [{ role: 'user', content: 'hi' }]
    })
    const seen: string[] = []
    for await (const event of stream) seen.push(event.type)
    expect(seen).toEqual(
      events(reply)
        .map((e) => String(e.type))
        .filter((t) => t !== 'ping')
    )
  })
})
