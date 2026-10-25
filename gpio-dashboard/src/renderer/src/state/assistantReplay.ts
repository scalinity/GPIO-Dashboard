// Dev only: replays the recorded "blink an LED on GPIO17" turn in the running app, through the
// Claude drawer, with no key and no network, and ends it with a look at the bench (capture_view).
// `VITE_ASSISTANT_REPLAY=blink npm run dev` opens the Studio with the Claude tab and runs it,
// streamed slowly enough to watch the ghosts arrive. The recorded replies stand in for the Rust
// proxy's fetch; everything above it is the app's own.
import { BLINK_SCRIPT } from '../assistant/testing/blinkScript'
import { events, toSse, toolUse, type Reply } from '../assistant/testing/sse'
import { replaceFetchForDev, send, useAssistant } from './assistantStore'
import { useStudio } from './studioStore'

const CHUNK = 48
const DELAY_MS = 12

const SCRIPT: Reply[] = [
  ...BLINK_SCRIPT.slice(0, -1),
  { blocks: [toolUse('look', 'capture_view', { preset: 'iso' })], stop: 'tool_use' },
  BLINK_SCRIPT.at(-1)!
]

function slowFetch(): typeof fetch {
  const replies = SCRIPT.map((reply) => new TextEncoder().encode(toSse(events(reply))))
  let next = 0
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const bytes = replies[next++]
    if (!bytes) throw new TypeError('The replay has no more replies')
    let at = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (init?.signal?.aborted) {
          controller.error(new DOMException('The operation was aborted.', 'AbortError'))
          return
        }
        if (at >= bytes.length) {
          controller.close()
          return
        }
        await new Promise((r) => setTimeout(r, DELAY_MS))
        controller.enqueue(bytes.slice(at, (at += CHUNK)))
      }
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
}

/** Opens the Claude tab and its settings, and replays the turn once the bench has loaded. */
export function replayOnLoad(): void {
  useStudio.setState({ drawer: 'claude' })
  useAssistant.setState({ settingsOpen: true })
  replaceFetchForDev(slowFetch())
  setTimeout(() => void send('blink an LED on GPIO17'), 4000)
}
