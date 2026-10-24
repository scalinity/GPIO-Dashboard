// Shared plumbing for the typed wrappers over `window.api` (src/renderer/src/api.js).

export type Failure = { success: false; error: string }
export type Canceled = { canceled: true }

/** One request for the Rust proxy (src-tauri/src/anthropic.rs). */
export interface ProxyRequest {
  id: string
  method: string
  path: string
  headers: [string, string][]
  body?: string
}

/** What the proxy sends back over the channel, in order. */
export type ProxyMessage =
  | { status: number; headers: [string, string][] }
  | ArrayBuffer
  | { end: true }
  | { error: { code: string; message: string } }

/** The `window.api` namespaces the wrappers use, as api.js builds them. */
export interface Bridge {
  ssh: {
    i2cScan(bus: number): Promise<{ success: true; devices: unknown[] } | Failure>
    scpBuffer(content: string, remotePath: string): Promise<{ success: true } | Failure>
    /** Streams `tutorial:output` events until the script exits, Stop, or the time limit. */
    runTutorialScript(filename: string): Promise<{ error?: string } & Record<string, unknown>>
    killProcess(filename: string): Promise<{ error?: string } & Record<string, unknown>>
    gpioCleanup(pins: number[]): Promise<{ error?: string } & Record<string, unknown>>
  }
  anthropic: {
    request(req: ProxyRequest, onMessage: (message: ProxyMessage) => void): Promise<unknown>
    abort(id: string): Promise<boolean>
    setKey(value: string): Promise<{ success: true } | Failure>
    hasKey(): Promise<boolean>
    clearKey(): Promise<{ success: true } | Failure>
  }
  projects: {
    list(): Promise<{ success: true; projects: unknown[] } | Failure>
    read(id: string): Promise<{ success: true; doc: unknown } | Failure>
    write(id: string, doc: unknown): Promise<{ success: true } | Failure>
    delete(id: string): Promise<{ success: true } | Failure>
    export(doc: unknown): Promise<{ success: true; path: string } | Canceled | Failure>
    import(): Promise<{ success: true; doc: unknown } | Canceled | Failure>
  }
}

/** The bridge, or an error outside the Tauri window (a plain-browser preview has none). */
export function bridge(): Bridge {
  const api = (globalThis as { window?: { api?: Bridge } }).window?.api
  if (!api) throw new Error('The native bridge is only available in the app window')
  return api
}

/** Unwraps a structured command result, turning `{ success: false }` into an exception. */
export function unwrap<T extends object>(result: T | Failure): Exclude<T, Failure> {
  if ('success' in result && result.success === false) throw new Error(result.error)
  return result as Exclude<T, Failure>
}
