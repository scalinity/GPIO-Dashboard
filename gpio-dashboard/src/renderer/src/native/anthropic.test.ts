import { afterEach, describe, expect, it } from 'vitest'
import type { ProxyMessage, ProxyRequest } from './bridge'
import { nativeAnthropicFetch } from './anthropic'

interface Fake {
  requests: ProxyRequest[]
  aborted: string[]
}

/** Installs a fake bridge whose proxy plays `script` back for each request. */
function install(script: (send: (m: ProxyMessage) => void, req: ProxyRequest) => void): Fake {
  const fake: Fake = { requests: [], aborted: [] }
  ;(globalThis as { window?: unknown }).window = {
    api: {
      anthropic: {
        request: async (req: ProxyRequest, onMessage: (m: ProxyMessage) => void) => {
          fake.requests.push(req)
          script(onMessage, req)
        },
        abort: async (id: string) => {
          fake.aborted.push(id)
          return true
        }
      }
    }
  }
  return fake
}

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer
const tick = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('nativeAnthropicFetch', () => {
  it('sends the path, method, headers and body, and streams the response', async () => {
    const fake = install((send) => {
      send({ status: 200, headers: [['content-type', 'text/event-stream']] })
      send(bytes('event: a\n'))
      send(bytes('event: b\n'))
      send({ end: true })
    })
    const response = await nativeAnthropicFetch('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST',
      headers: { 'anthropic-version': '2026-10-21', authorization: 'Bearer placeholder' },
      body: '{"model":"m"}'
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toBe('event: a\nevent: b\n')
    const req = fake.requests[0]!
    expect(req.method).toBe('POST')
    expect(req.path).toBe('/v1/messages?beta=true')
    expect(req.body).toBe('{"model":"m"}')
    expect(req.headers).toContainEqual(['anthropic-version', '2026-10-21'])
  })

  it('resolves on the head while the body is still arriving', async () => {
    let send!: (m: ProxyMessage) => void
    install((s) => {
      send = s
      s({ status: 200, headers: [] })
    })
    const response = await nativeAnthropicFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{}'
    })
    const reader = response.body!.getReader()
    send(bytes('first'))
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
    send({ end: true })
    expect((await reader.read()).done).toBe(true)
  })

  it('forwards an API error status as a normal response', async () => {
    install((send) => {
      send({ status: 400, headers: [['content-type', 'application/json']] })
      send(bytes('{"type":"error"}'))
      send({ end: true })
    })
    const response = await nativeAnthropicFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{}'
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ type: 'error' })
  })

  it('rejects with a TypeError when the proxy fails before a response', async () => {
    install((send) => send({ error: { code: 'no_api_key', message: 'No key' } }))
    await expect(nativeAnthropicFetch('https://api.anthropic.com/v1/models')).rejects.toThrow(
      new TypeError('no_api_key: No key')
    )
  })

  it('errors the stream when the transfer breaks after the head', async () => {
    install((send) => {
      send({ status: 200, headers: [] })
      send(bytes('partial'))
      send({ error: { code: 'network', message: 'reset' } })
    })
    const response = await nativeAnthropicFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{}'
    })
    await expect(response.text()).rejects.toThrow('network: reset')
  })

  it('aborts through the proxy and rejects with an AbortError', async () => {
    let send!: (m: ProxyMessage) => void
    const fake = install((s) => (send = s))
    const controller = new AbortController()
    const pending = nativeAnthropicFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{}',
      signal: controller.signal
    })
    await tick()
    controller.abort()
    expect(fake.aborted).toEqual([fake.requests[0]!.id])
    send({ error: { code: 'aborted', message: 'Request aborted' } })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stops the transfer when the reader cancels', async () => {
    const fake = install((send) => send({ status: 200, headers: [] }))
    const response = await nativeAnthropicFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{}'
    })
    await response.body!.cancel()
    expect(fake.aborted).toEqual([fake.requests[0]!.id])
  })

  it('gives a body-less status a null body and unique ids per request', async () => {
    const fake = install((send) => {
      send({ status: 204, headers: [] })
      send({ end: true })
    })
    const a = await nativeAnthropicFetch('https://api.anthropic.com/v1/models')
    await nativeAnthropicFetch('https://api.anthropic.com/v1/models')
    expect(a.body).toBeNull()
    expect(fake.requests[0]!.id).not.toBe(fake.requests[1]!.id)
  })
})
