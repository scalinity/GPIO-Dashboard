// The Anthropic SDK, pointed at the Rust proxy (SPEC 4.2, 12.1). The key never exists in the
// webview: the client is built with a placeholder, and nativeAnthropicFetch sends every request
// through the `anthropic_request` command, which strips the SDK's Authorization header and adds
// the real key from the Keychain. SDK 1.x sends `anthropic-version: 2026-10-21` and the key as
// `Authorization: Bearer`, and its request types have no temperature, top_p or top_k.
import Anthropic from '@anthropic-ai/sdk'
import { nativeAnthropicFetch } from '../native/anthropic'

/** The model list in Settings (SPEC 12.2); any other id may be typed in. */
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', use: 'default' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', use: 'fast edits' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', use: 'explanations' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', use: 'hardest builds' }
] as const

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const DEFAULT_MODEL = 'claude-opus-5-5'
/** High for builds, medium for explanations (SPEC 12.2). */
export const DEFAULT_EFFORT: Effort = 'high'
export const EXPLAIN_EFFORT: Effort = 'medium'
/** Thinking counts toward it. */
export const MAX_TOKENS = 64_000

export function createClient(fetch: typeof globalThis.fetch = nativeAnthropicFetch): Anthropic {
  return new Anthropic({
    apiKey: 'placeholder-the-proxy-adds-the-real-key',
    dangerouslyAllowBrowser: true,
    fetch
  })
}
