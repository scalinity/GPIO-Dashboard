// The Anthropic SDK's `fetch`: every request goes through the Rust proxy, which adds the API
// key (SPEC 4.2, 12.1). The key never exists in the webview; the SDK is built with a
// placeholder and this function.
import { bridge, type ProxyMessage } from './bridge'

// Statuses whose Response may not carry a body (the Response constructor throws otherwise).
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

let nextId = 0

function requestId(): string {
  nextId += 1
  return `anthropic-${Date.now().toString(36)}-${nextId}`
}

async function bodyText(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body === null || body === undefined) return undefined
  return typeof body === 'string' ? body : new Response(body).text()
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

/** A `fetch` that streams through the proxy. Resolves when the response head arrives. */
export async function nativeAnthropicFetch(
  input: string | URL | Request,
  init: RequestInit = {}
): Promise<Response> {
  const fromRequest = input instanceof Request ? input : undefined
  const url = new URL(fromRequest ? fromRequest.url : input.toString())
  const method = (init.method ?? fromRequest?.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers ?? fromRequest?.headers)
  const body = await bodyText(init.body ?? (fromRequest ? await fromRequest.text() : undefined))
  const signal = init.signal ?? fromRequest?.signal
  if (signal?.aborted) throw abortError()

  const api = bridge()
  const id = requestId()
  return new Promise<Response>((resolve, reject) => {
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined
    let headArrived = false
    const onAbort = () => void api.anthropic.abort(id)
    signal?.addEventListener('abort', onAbort, { once: true })

    const fail = (error: Error) => {
      signal?.removeEventListener('abort', onAbort)
      if (headArrived) stream?.error(error)
      else reject(error)
    }

    const onMessage = (message: ProxyMessage) => {
      if (message instanceof ArrayBuffer) {
        stream?.enqueue(new Uint8Array(message))
      } else if ('status' in message) {
        headArrived = true
        const responseBody = NULL_BODY_STATUSES.has(message.status)
          ? null
          : new ReadableStream<Uint8Array>({
              start: (controller) => {
                stream = controller
              },
              // The reader stopped early; stop the transfer too.
              cancel: onAbort
            })
        resolve(new Response(responseBody, { status: message.status, headers: message.headers }))
      } else if ('end' in message) {
        signal?.removeEventListener('abort', onAbort)
        stream?.close()
      } else {
        const { code, message: text } = message.error
        // fetch() rejects network failures with a TypeError and aborts with an AbortError.
        fail(code === 'aborted' ? abortError() : new TypeError(`${code}: ${text}`))
      }
    }

    api.anthropic
      .request(
        { id, method, path: url.pathname + url.search, headers: [...headers], body },
        onMessage
      )
      .catch((error: unknown) => fail(new TypeError(String(error))))
  })
}
