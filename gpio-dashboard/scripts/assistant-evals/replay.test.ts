// Replays every recorded live run (SPEC 18): the assistant loop, the real SDK client, the Node
// context and the scores, with the API's recorded responses and no key or network. The scores
// must come out as they did live, so a change to the loop, the tools, ERC or the simulator that
// would have changed what the model's recorded calls do shows up here.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { FIXTURES, fixtureExists, loadFixture } from './files'
import { replay, seedFor, type Finished } from './main'
import { PythonRuntime } from './nodeContext'
import { PROMPTS } from './prompts'
import { canonical, sseUsage, type Exchange, type Json } from './tape'

let python: PythonRuntime
beforeAll(async () => {
  python = await PythonRuntime.load(`${import.meta.dirname}/../../node_modules/pyodide/`)
}, 60_000)

const recorded = PROMPTS.filter((p) => fixtureExists(p.id))

describe('the recorded runs', () => {
  it('cover at least 10 prompts', () => {
    expect(recorded.length).toBeGreaterThanOrEqual(10)
    expect(PROMPTS.filter((p) => !fixtureExists(p.id)).map((p) => p.id)).toEqual([])
  })

  it('hold no key, no header that carries one, and no opaque signature', () => {
    for (const file of readdirSync(FIXTURES)) {
      const text = readFileSync(join(FIXTURES, file), 'utf8')
      expect(text, file).not.toMatch(/sk-ant/i)
      expect(text, file).not.toMatch(/"(authorization|x-api-key)"\s*:/i)
      expect(text, file).not.toMatch(/bearer\s+[A-Za-z0-9._-]{20,}/i)
      // Signatures and encrypted content are replaced, not kept.
      expect(text, file).not.toMatch(
        /"(signature|encrypted_content|encrypted_index)":"(?!scrubbed")[^"]+/
      )
      expect(text, file).not.toMatch(
        /\\"(signature|encrypted_content|encrypted_index)\\":\\"(?!scrubbed\\")[^\\"]+/
      )
    }
  })
})

describe('replay', () => {
  const finished: Finished = new Map()
  for (const prompt of recorded) {
    it(`scores ${prompt.id} as it scored live`, async () => {
      const seed = await seedFor(prompt, finished, python)
      const result = await replay(prompt, seed, python)
      finished.set(prompt.id, result.outcome.run.final)
      const failed = result.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`)
      // Whatever failed live fails the same way now, and nothing else does.
      const live = loadFixture(prompt.id).run.expected
      expect(Object.fromEntries(result.checks.map((c) => [c.id, c.pass]))).toEqual(live)
      expect(result.drift).toEqual([])
      expect(result.unusedResponses).toBe(0)
      if (!Object.values(live).every(Boolean))
        console.log(`${prompt.id} fails live: ${failed.join(' | ')}`)
    }, 120_000)
  }
})

describe('the requests the loop sent', () => {
  const sentBy = (id: string): Exchange[] => loadFixture(id).exchanges
  const ok = (exchanges: Exchange[]) => exchanges.filter((e) => e.status === 200)

  it.each(recorded.map((p) => p.id))('%s: the shape the API needs (SPEC 12.1-12.3)', (id) => {
    const exchanges = sentBy(id)
    expect(exchanges.length).toBeGreaterThan(0)
    for (const e of exchanges) {
      const body = e.request
      expect(body.model).toBe('claude-opus-5-5')
      expect(body.max_tokens).toBe(64000)
      expect(body.stream).toBe(true)
      for (const sampling of ['temperature', 'top_p', 'top_k'])
        expect(body).not.toHaveProperty(sampling)
      expect(body.thinking).toBeUndefined()
      expect(body.cache_control).toEqual({ type: 'ephemeral' })
      expect(body.output_config).toMatchObject({
        effort: expect.stringMatching(/low|medium|high|xhigh|max/)
      })
      const system = body.system as { cache_control?: unknown }[]
      expect(system.at(-1)?.cache_control).toEqual({ type: 'ephemeral' })
      const tools = body.tools as {
        name: string
        strict?: boolean
        type?: string
        allowed_callers?: string[]
      }[]
      expect(tools.filter((t) => t.strict).length).toBeLessThanOrEqual(20)
      for (const t of tools.filter((x) => x.type?.startsWith('web_')))
        expect(t.allowed_callers).toEqual(['direct'])
    }
  })

  it.each(recorded.map((p) => p.id))(
    '%s: the system prompt, tools and earlier messages never change between accepted requests (ADR-0087)',
    (id) => {
      const accepted = ok(sentBy(id))
      for (const [i, e] of accepted.entries()) {
        if (i === 0) continue
        const before = accepted[i - 1]!.request
        expect(canonical(e.request.system as Json)).toBe(canonical(before.system as Json))
        expect(canonical(e.request.tools as Json)).toBe(canonical(before.tools as Json))
        const was = before.messages as Json[]
        const now = e.request.messages as Json[]
        expect(now.slice(0, was.length).map((m) => canonical(m))).toEqual(
          was.map((m) => canonical(m))
        )
      }
    }
  )

  it.each(recorded.map((p) => p.id))('%s: later requests read the cache', (id) => {
    const accepted = ok(sentBy(id))
    for (const e of accepted.slice(1)) expect(sseUsage(e.body).cacheReadTokens).toBeGreaterThan(0)
  })
})
