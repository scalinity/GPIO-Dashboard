// The assistant's e2e seam: a stand-in for the native commands the Claude drawer uses. The
// Anthropic proxy plays back recorded Messages API streams (SSE) in small chunks, the way the Rust
// proxy forwards them; the Keychain commands keep a flag and log their calls, and never hand a
// key back; settings and projects live in memory. Everything above the bridge is the app's own:
// nativeAnthropicFetch, the SDK, the loop, the tools, the store and the Studio.
import type { Page } from '@playwright/test'
import { events, toSse, type Reply } from '../src/renderer/src/assistant/testing/sse'
import type { CircuitDoc } from '../src/renderer/src/core/model/types'

/** One recorded reply: an SSE body, and whether the stream then stops and waits (for Stop). */
export interface Recorded {
  sse: string
  hang: boolean
}

export const record = (reply: Reply): Recorded => ({ sse: toSse(events(reply)), hang: false })

/** A reply cut off partway through, that waits there until the request is aborted. */
export const hanging = (reply: Reply, keepEvents: number): Recorded => ({
  sse: toSse(events(reply).slice(0, keepEvents)),
  hang: true
})

export interface FakeOptions {
  hasKey?: boolean
  /** Bytes per chunk and the pause between chunks, ms. */
  chunk?: number
  delayMs?: number
}

/** Installs the fake bridge before the app loads. Call before page.goto. */
export async function installFakeApi(page: Page, options: FakeOptions = {}) {
  await page.addInitScript(
    ({ hasKey, chunk, delayMs }) => {
      type Message = { status: number; headers: [string, string][] } | ArrayBuffer | object
      const w = window as unknown as Record<string, unknown> & {
        __replies: { sse: string; hang: boolean }[]
        __requests: unknown[]
        __keychain: { saved: boolean; calls: string[] }
        __settings: Record<string, unknown>
        __files: Map<string, unknown>
      }
      w.__replies = []
      w.__requests = []
      w.__keychain = { saved: hasKey, calls: [] }
      w.__settings = {}
      w.__files = new Map()
      const aborted = new Set<string>()
      const wake = new Map<string, () => void>()
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const copy = <T>(x: T): T => structuredClone(x)
      const meta = (d: unknown) => (d as { meta: { name: string; updated: string } }).meta
      w.api = {
        anthropic: {
          request: async (
            req: { id: string; path: string; body?: string },
            onMessage: (m: Message) => void
          ) => {
            w.__requests.push({ path: req.path, body: JSON.parse(req.body ?? '{}') })
            const reply = w.__replies.shift()
            if (!reply) {
              onMessage({ error: { code: 'network', message: 'No recorded reply left' } })
              return
            }
            onMessage({ status: 200, headers: [['content-type', 'text/event-stream']] })
            const bytes = new TextEncoder().encode(reply.sse)
            for (let at = 0; at < bytes.length; at += chunk) {
              if (aborted.has(req.id)) {
                onMessage({ error: { code: 'aborted', message: 'The request was aborted' } })
                return
              }
              onMessage(bytes.slice(at, at + chunk).buffer)
              await sleep(delayMs)
            }
            if (reply.hang) {
              if (!aborted.has(req.id)) await new Promise<void>((r) => wake.set(req.id, r))
              onMessage({ error: { code: 'aborted', message: 'The request was aborted' } })
              return
            }
            onMessage({ end: true })
          },
          abort: async (id: string) => {
            aborted.add(id)
            wake.get(id)?.()
            return true
          },
          // The Keychain seam: the calls it got and the value that reached it (a test key).
          setKey: async (value: string) => {
            w.__keychain.calls.push(`set:${value}`)
            if (!value.trim()) return { success: false, error: 'Enter an API key' }
            w.__keychain.saved = true
            return { success: true }
          },
          hasKey: async () => (w.__keychain.calls.push('has'), w.__keychain.saved),
          clearKey: async () => {
            w.__keychain.calls.push('clear')
            w.__keychain.saved = false
            return { success: true }
          }
        },
        settings: {
          get: async (key: string) => w.__settings[key] ?? null,
          set: async (key: string, value: unknown) => (
            (w.__settings[key] = value),
            { success: true }
          )
        },
        projects: {
          list: async () => ({
            success: true,
            projects: [...w.__files]
              .filter(([id]) => !id.endsWith('.transcript'))
              .map(([id, d]) => ({ id, ...meta(d) }))
          }),
          read: async (id: string) =>
            w.__files.has(id)
              ? { success: true, doc: copy(w.__files.get(id)) }
              : { success: false, error: 'Project not found' },
          write: async (id: string, d: unknown) => (w.__files.set(id, copy(d)), { success: true }),
          writeTranscript: async (id: string, t: unknown) => (
            w.__files.set(`${id}.transcript`, copy(t)),
            { success: true }
          ),
          delete: async (id: string) => (w.__files.delete(id), { success: true }),
          export: async () => ({ canceled: true }),
          import: async () => ({ canceled: true })
        }
      }
    },
    { hasKey: options.hasKey ?? true, chunk: options.chunk ?? 48, delayMs: options.delayMs ?? 4 }
  )
}

/** Queues recorded replies for the next requests, in order. */
export const queueReplies = (page: Page, replies: Recorded[]) =>
  page.evaluate((list) => {
    ;(window as unknown as { __replies: Recorded[] }).__replies.push(...list)
  }, replies)

/** The app's document, as the circuit store holds it. */
export const appDoc = (page: Page) =>
  page.evaluate(
    "import('/src/state/circuit.ts').then((m) => m.circuit.getSnapshot())"
  ) as Promise<CircuitDoc>

/** Opens the Claude tab and sends `text` from the composer. */
export async function sendToClaude(page: Page, text: string) {
  const tab = page.getByRole('tab', { name: 'Claude' })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  const box = page.getByLabel('Message Claude')
  await box.fill(text)
  await box.press('Enter')
}
