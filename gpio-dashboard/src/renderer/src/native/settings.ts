// Typed access to the plain settings (src-tauri/src/settings.rs through commands.rs). Only the keys
// on the Rust allowlist are readable or writable; secrets never come back through here.
import { bridge, unwrap } from './bridge'

export async function getSetting(key: string): Promise<unknown> {
  return bridge().settings.get(key)
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  unwrap(await bridge().settings.set(key, value))
}
