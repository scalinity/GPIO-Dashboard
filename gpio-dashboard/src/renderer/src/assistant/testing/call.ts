// Calls one tool the way the loop does, for tests.
import { RevisionMemory, type ToolOutput } from '../tools/types'
import { toolByName } from '../tools'
import type { FakeContext } from './fakeContext'

export interface Called {
  output: ToolOutput
  isError: boolean
  /** The reply text, parsed as JSON when it is. */
  json: unknown
  text: string
}

export async function call(
  ctx: FakeContext,
  name: string,
  input: unknown,
  extra: { turnId?: string; revisions?: RevisionMemory; signal?: AbortSignal } = {}
): Promise<Called> {
  const tool = toolByName(name)
  if (!tool) throw new Error(`No tool ${name}`)
  const output = await tool.execute(input, {
    ctx,
    turnId: extra.turnId ?? 'turn-test',
    signal: extra.signal ?? new AbortController().signal,
    revisions: extra.revisions ?? new RevisionMemory()
  })
  const text =
    typeof output.content === 'string'
      ? output.content
      : output.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  let json: unknown = text
  try {
    json = JSON.parse(text)
  } catch {
    // Some replies are a line of text followed by JSON.
    const rest = text.slice(text.indexOf('\n') + 1)
    try {
      json = JSON.parse(rest)
    } catch {
      json = text
    }
  }
  return { output, isError: !!output.isError, json, text }
}
