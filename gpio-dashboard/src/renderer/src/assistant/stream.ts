// Reads one streamed assistant message into the content blocks the API expects back. The loop
// accumulates the events itself instead of using the SDK's message helper, for two reasons: a tool
// input that is not valid JSON must come back to the model as a tool_result with the raw text
// (the helper would reject the whole stream), and every block must be kept as it was received,
// including thinking signatures and server-tool results (SPEC 12.3).
import type Anthropic from '@anthropic-ai/sdk'
import { partialObject } from './partialJson'
import { emptyUsage, type TokenUsage } from './prices'

type Block = Anthropic.ContentBlock
type ToolBlock = Anthropic.ToolUseBlock | Anthropic.ServerToolUseBlock

export interface StreamedMessage {
  id: string
  model: string
  content: Block[]
  stopReason: Anthropic.StopReason | null
  stopDetails: Anthropic.RefusalStopDetails | null
  usage: TokenUsage
  /** Tool-use ids whose streamed input was not a JSON object, with the raw text. */
  invalidInput: Map<string, string>
  /** Indexes of blocks the stream ended without closing (a cut-off response). */
  unfinished: Set<number>
}

export interface StreamHandlers {
  onBlockStart?(block: Block): void
  onText?(delta: string): void
  /** A thinking block has text to show (empty with the default display setting). */
  onThinking?(delta: string): void
  /**
   * A tool call's input so far (a snapshot while it streams, for the tools that preview) or, with
   * `complete`, once the block closes: the parsed input, or null if it was not a JSON object.
   */
  onToolInput?(block: ToolBlock, input: Record<string, unknown> | null, complete: boolean): void
  onBlockStop?(block: Block): void
}

const isToolBlock = (b: Block | undefined): b is ToolBlock =>
  b?.type === 'tool_use' || b?.type === 'server_tool_use'

const count = (n: number | null | undefined) => n ?? 0

function readUsage(
  usage: Anthropic.Usage | Anthropic.MessageDeltaUsage,
  into: TokenUsage
): TokenUsage {
  return {
    inputTokens: usage.input_tokens ?? into.inputTokens,
    outputTokens: usage.output_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? into.cacheWriteTokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? into.cacheReadTokens,
    webSearches: count(usage.server_tool_use?.web_search_requests) || into.webSearches
  }
}

/** Parses a finished tool input: a JSON object, or null when it is anything else. */
function parseInput(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {}
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export async function readMessage(
  events: AsyncIterable<Anthropic.RawMessageStreamEvent>,
  handlers: StreamHandlers = {},
  /** Which tool names are worth parsing partial input for while it streams. */
  previews: ReadonlySet<string> = new Set()
): Promise<StreamedMessage> {
  const message: StreamedMessage = {
    id: '',
    model: '',
    content: [],
    stopReason: null,
    stopDetails: null,
    usage: emptyUsage(),
    invalidInput: new Map(),
    unfinished: new Set()
  }
  const raw = new Map<number, string>()

  for await (const event of events) {
    switch (event.type) {
      case 'message_start':
        message.id = event.message.id
        message.model = event.message.model
        message.usage = readUsage(event.message.usage, message.usage)
        break
      case 'content_block_start': {
        const block = structuredClone(event.content_block)
        message.content[event.index] = block
        message.unfinished.add(event.index)
        if (isToolBlock(block)) raw.set(event.index, '')
        handlers.onBlockStart?.(block)
        break
      }
      case 'content_block_delta': {
        const block = message.content[event.index]
        const delta = event.delta
        if (!block) break
        if (delta.type === 'text_delta' && block.type === 'text') {
          block.text += delta.text
          handlers.onText?.(delta.text)
        } else if (delta.type === 'citations_delta' && block.type === 'text') {
          block.citations = [...(block.citations ?? []), delta.citation]
        } else if (delta.type === 'thinking_delta' && block.type === 'thinking') {
          block.thinking += delta.thinking
          handlers.onThinking?.(delta.thinking)
        } else if (delta.type === 'signature_delta' && block.type === 'thinking') {
          block.signature = delta.signature
        } else if (delta.type === 'input_json_delta' && isToolBlock(block)) {
          const text = (raw.get(event.index) ?? '') + delta.partial_json
          raw.set(event.index, text)
          if (previews.has(block.name)) handlers.onToolInput?.(block, partialObject(text), false)
        }
        break
      }
      case 'content_block_stop': {
        const block = message.content[event.index]
        message.unfinished.delete(event.index)
        if (isToolBlock(block)) {
          const text = raw.get(event.index) ?? ''
          const input = parseInput(text)
          if (input) block.input = input
          else {
            // Kept as an empty object, since the API needs one; the raw text goes back to the
            // model in the tool_result.
            block.input = {}
            message.invalidInput.set(block.id, text)
          }
          handlers.onToolInput?.(block, input, true)
        }
        if (block) handlers.onBlockStop?.(block)
        break
      }
      case 'message_delta':
        message.stopReason = event.delta.stop_reason ?? message.stopReason
        message.stopDetails = event.delta.stop_details ?? message.stopDetails
        message.usage = readUsage(event.usage, message.usage)
        break
      default:
        // message_stop, ping, and event types added since: nothing to keep.
        break
    }
  }
  return message
}
