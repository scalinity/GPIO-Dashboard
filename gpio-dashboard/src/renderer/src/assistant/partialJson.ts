// Snapshots of a tool input while it streams (SPEC 12.6). The SDK's own tolerant parser is used:
// it keeps only the keys and values that are complete, so a half-received string or number never
// shows up as a value, and a ghost never jumps. The snapshot is for previews only; a tool call
// commits from the strict parse of the finished input.
import { partialParse } from '@anthropic-ai/sdk/_vendor/partial-json-parser/parser'

/** The object a prefix of a tool input's JSON gives so far, or null when there is none yet. */
export function partialObject(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null
  try {
    const value: unknown = partialParse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
