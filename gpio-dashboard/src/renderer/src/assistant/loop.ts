// The assistant's turn loop (SPEC 12.3): streaming Messages API with a manual tool loop.
//
// One conversation is one AssistantSession. Its system prompt, catalog and tools are fixed when
// it is created and its history is only ever appended to: the API ties the cache and the
// thinking blocks to exactly those bytes, so a conversation that edits them loses both. A turn
// is one user message and everything Claude does in answer; each mutation it makes is committed
// with the turn's id, so the circuit store can undo the turn as a group.
import Anthropic from '@anthropic-ai/sdk'
import type { Transaction } from '../core/model/types'
import { partCatalog } from './catalog'
import { DEFAULT_EFFORT, DEFAULT_MODEL, MAX_TOKENS, type Effort } from './client'
import type { AssistantContext } from './context'
import { addUsage, costUsd, emptyUsage, type TokenUsage } from './prices'
import { readMessage, type StreamedMessage } from './stream'
import systemPrompt from './system-prompt.md?raw'
import { apiTools, chipLabel, ghostFor, toolByName, TOOLS, webTools } from './tools'
import { RevisionMemory, type ToolContent, type ToolOutput } from './tools/types'

/** Client tool calls Claude may make in one turn before it is asked to summarize. */
export const TOOL_CALL_CAP = 60
/** Paused server-tool turns resumed back to back before the turn gives up. */
const MAX_PAUSES = 8

export interface TurnUsage extends TokenUsage {
  requests: number
  /** Dollars, or null when the model has no price in prices.ts. */
  costUsd: number | null
}

export type TurnEnd =
  'end_turn' | 'max_tokens' | 'refusal' | 'tool-cap' | 'pause-limit' | 'aborted' | 'error'

export interface TurnResult {
  turnId: string
  reason: TurnEnd
  toolCalls: number
  /** Every transaction the turn committed, in order. */
  transactions: Transaction[]
  usage: TurnUsage
  error?: { code: string; message: string }
  refusal?: { category: string | null; explanation: string | null }
}

export type AssistantEvent =
  | { type: 'turn-start'; turnId: string }
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  /** A tool call began: show its chip. */
  | { type: 'tool-start'; id: string; name: string; server: boolean; label: string }
  /** Its input so far, for ghosts; `complete` once the block closed (null if it was not JSON). */
  | {
      type: 'tool-input'
      id: string
      name: string
      label: string
      input: Record<string, unknown> | null
      complete: boolean
    }
  /** A tool call finished; `transactions` is what it committed. */
  | {
      type: 'tool-result'
      id: string
      name: string
      server: boolean
      ok: boolean
      content: ToolContent
      transactions: Transaction[]
    }
  | { type: 'notice'; code: string; message: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'usage'; usage: TurnUsage }
  | { type: 'turn-end'; result: TurnResult }

export interface SessionOptions {
  client: Anthropic
  ctx: AssistantContext
  model?: string
  effort?: Effort
  /** Server-side web search and fetch for datasheet lookups. Fixed for the conversation. */
  webTools?: boolean
  maxTokens?: number
  toolCallCap?: number
  /** Stream mutation tools' input eagerly (default true). */
  eagerInput?: boolean
  newTurnId?: () => string
  /** A saved conversation to continue. It must come from a session with the same settings. */
  history?: Anthropic.MessageParam[]
}

export interface TurnOptions {
  onEvent?: (event: AssistantEvent) => void
  signal?: AbortSignal
  /** Overrides for this turn. Neither breaks the thinking blocks; each costs a cache write. */
  model?: string
  effort?: Effort
}

const toolNameOf = (tool: Anthropic.ToolUnion) => (tool as { name?: string }).name ?? ''

/** What the API said was wrong: the message inside its error body, else the SDK's own text. */
function apiMessage(e: { message: string; error?: unknown }): string {
  const body = e.error as { error?: { message?: unknown } } | undefined
  return typeof body?.error?.message === 'string' ? body.error.message : e.message
}

/** The web tools a 400 says this organization does not have ("Web search is not enabled…"). */
function refusedWebTools(detail: string): string[] {
  return ['web_search', 'web_fetch'].filter((name) =>
    new RegExp(`${name.replace('_', '[ _]?')} is not enabled`, 'i').test(detail)
  )
}

const plainResult = (id: string, message: unknown): Anthropic.ToolResultBlockParam => ({
  type: 'tool_result',
  tool_use_id: id,
  is_error: true,
  content: typeof message === 'string' ? message : JSON.stringify(message)
})

/** What a server-tool result block says, for its chip. */
function serverResultSummary(
  block: Anthropic.ContentBlock
): { name: string; ok: boolean; text: string } | null {
  if (block.type === 'web_search_tool_result') {
    const ok = Array.isArray(block.content)
    return {
      name: 'web_search',
      ok,
      text: Array.isArray(block.content)
        ? `${block.content.length} results`
        : block.content.error_code
    }
  }
  if (block.type === 'web_fetch_tool_result') {
    const ok = block.content.type === 'web_fetch_result'
    return {
      name: 'web_fetch',
      ok,
      text: block.content.type === 'web_fetch_result' ? block.content.url : block.content.error_code
    }
  }
  return null
}

export class AssistantSession {
  readonly messages: Anthropic.MessageParam[]
  model: string
  effort: Effort

  private readonly client: Anthropic
  private readonly ctx: AssistantContext
  private readonly maxTokens: number
  private readonly cap: number
  private readonly newTurnId: () => string
  private readonly system: Anthropic.TextBlockParam[]
  private readonly web: boolean
  private tools: Anthropic.ToolUnion[]
  /**
   * What the first request may fall back from (ADR-0105): strict tools and eager input streaming
   * both start on, and are dropped one at a time, strict first, if the API refuses the request.
   */
  private strict = true
  private eager: boolean
  /** Web tools the API refused for this account; dropped from the first request (ADR-0106). */
  private readonly webOff = new Set<string>()
  private readonly revisions = new RevisionMemory()
  private readonly previews = new Set(TOOLS.filter((t) => t.preview).map((t) => t.name))
  private turns = 0

  constructor(options: SessionOptions) {
    this.client = options.client
    this.ctx = options.ctx
    this.model = options.model ?? DEFAULT_MODEL
    this.effort = options.effort ?? DEFAULT_EFFORT
    this.maxTokens = options.maxTokens ?? MAX_TOKENS
    this.cap = options.toolCallCap ?? TOOL_CALL_CAP
    this.eager = options.eagerInput ?? true
    this.web = options.webTools ?? true
    this.newTurnId =
      options.newTurnId ?? (() => `turn-${Date.now().toString(36)}-${(this.turns += 1)}`)
    this.messages = options.history ?? []
    // The catalog is the last system block, and carries the breakpoint that caches tools and
    // system together.
    this.system = [
      { type: 'text', text: systemPrompt },
      {
        type: 'text',
        text: partCatalog(
          [...this.ctx.partDefs(), ...(this.ctx.getSnapshot().customParts ?? [])],
          this.ctx.inventoryPartIds()
        ),
        cache_control: { type: 'ephemeral' }
      }
    ]
    this.tools = this.buildTools()
  }

  private buildTools(): Anthropic.ToolUnion[] {
    return [
      ...apiTools({ eager: this.eager, strict: this.strict }),
      ...(this.web ? webTools().filter((t) => !this.webOff.has(toolNameOf(t))) : [])
    ]
  }

  /**
   * The tools the API refused, which would leave the assistant unusable, answered on the first
   * request only: before any thinking block exists to bind the tools, the request is sent again
   * without what the API named, and the user is told why. Strict schemas and eager streaming are
   * not checkable offline (ADR-0105), and the account may not have web search (ADR-0106). Runtime
   * validation does not depend on any of them. Returns false when there is nothing left to drop.
   */
  private dropRefused(e: unknown, emit: (event: AssistantEvent) => void): boolean {
    if (!(e instanceof Anthropic.BadRequestError)) return false
    if (this.messages.some((m) => m.role === 'assistant')) return false
    const detail = apiMessage(e)

    const web = this.web ? refusedWebTools(detail).filter((name) => !this.webOff.has(name)) : []
    if (web.length) {
      for (const name of web) this.webOff.add(name)
      this.tools = this.buildTools()
      emit({
        type: 'notice',
        code: 'web-tools-refused',
        message: `The API refused ${web.map((n) => n.replace('_', ' ')).join(' and ')} (“${detail}”), so this conversation runs without ${web.length > 1 ? 'them' : 'it'}. The “Web search and fetch, for datasheets” setting turns the web tools off for new conversations.`
      })
      return true
    }

    if (!/strict|eager|grammar|too complex|schema/i.test(detail)) return false
    // A message that names eager streaming drops it; any other tool refusal drops strict first.
    const eagerNamed = /eager|input.stream/i.test(detail) && this.eager
    if (this.strict && !eagerNamed) {
      this.strict = false
      this.tools = this.buildTools()
      emit({
        type: 'notice',
        code: 'strict-refused',
        message: `The API refused the strict tool schemas (“${detail}”), so tools run without them. Their input is still checked in the app.`
      })
      return true
    }
    if (this.eager) {
      this.eager = false
      this.tools = this.buildTools()
      emit({
        type: 'notice',
        code: 'eager-refused',
        message: `The API refused eager tool input streaming (“${detail}”), so tool input arrives only once it is complete and previews appear later.`
      })
      return true
    }
    return false
  }

  async runTurn(userText: string, options: TurnOptions = {}): Promise<TurnResult> {
    const turnId = this.newTurnId()
    const signal = options.signal ?? new AbortController().signal
    const emit = (event: AssistantEvent) => {
      try {
        options.onEvent?.(event)
      } catch {
        // A faulty listener must not stop the turn.
      }
    }
    const model = options.model ?? this.model
    const effort = options.effort ?? this.effort
    const transactions: Transaction[] = []
    const ghosts = new Set<string>()
    let usage = emptyUsage()
    let cost: number | null = 0
    let requests = 0
    let toolCalls = 0
    let pauses = 0
    let capped = false

    const clearGhost = (id: string) => {
      if (!ghosts.delete(id)) return
      try {
        this.ctx.setGhost(id, null)
      } catch {
        // Ghosts are cosmetic.
      }
    }
    const finish = (
      reason: TurnEnd,
      extra: Pick<TurnResult, 'error' | 'refusal'> = {}
    ): TurnResult => {
      for (const id of [...ghosts]) clearGhost(id)
      const total: TurnUsage = { ...usage, requests, costUsd: cost }
      const result: TurnResult = {
        turnId,
        reason,
        toolCalls,
        transactions,
        usage: total,
        ...extra
      }
      emit({ type: 'usage', usage: total })
      emit({ type: 'turn-end', result })
      return result
    }

    this.messages.push({ role: 'user', content: userText })
    emit({ type: 'turn-start', turnId })

    const ghostCache = new Map<string, string>()
    for (;;) {
      if (signal.aborted) return finish('aborted')
      let message: StreamedMessage
      try {
        const stream = await this.client.messages.create(
          {
            model,
            max_tokens: this.maxTokens,
            stream: true,
            system: this.system,
            tools: this.tools,
            messages: this.messages,
            output_config: { effort },
            cache_control: { type: 'ephemeral' },
            ...(capped ? { tool_choice: { type: 'none' as const } } : {})
          },
          { signal }
        )
        message = await readMessage(
          stream,
          {
            onBlockStart: (block) => {
              if (block.type === 'tool_use' || block.type === 'server_tool_use') {
                emit({
                  type: 'tool-start',
                  id: block.id,
                  name: block.name,
                  server: block.type === 'server_tool_use',
                  label: chipLabel(block.name)
                })
              } else {
                const done = serverResultSummary(block)
                if (done && 'tool_use_id' in block)
                  emit({
                    type: 'tool-result',
                    id: block.tool_use_id,
                    name: done.name,
                    server: true,
                    ok: done.ok,
                    content: done.text,
                    transactions: []
                  })
              }
            },
            onText: (delta) => emit({ type: 'text', delta }),
            onThinking: (delta) => emit({ type: 'thinking', delta }),
            onToolInput: (block, input, complete) => {
              emit({
                type: 'tool-input',
                id: block.id,
                name: block.name,
                label: chipLabel(block.name, input ?? {}),
                input,
                complete
              })
              if (block.type !== 'tool_use' || !input) return
              const key = JSON.stringify(input)
              if (ghostCache.get(block.id) === key) return
              ghostCache.set(block.id, key)
              try {
                const ghost = ghostFor(block.name, input, this.ctx.getSnapshot(), this.ctx.partDef)
                if (ghost || ghosts.has(block.id)) this.ctx.setGhost(block.id, ghost)
                if (ghost) ghosts.add(block.id)
                else ghosts.delete(block.id)
              } catch {
                // Ghosts are cosmetic.
              }
            }
          },
          this.previews
        )
      } catch (e) {
        if (signal.aborted) return finish('aborted')
        if (this.dropRefused(e, emit)) continue
        const code = e instanceof Anthropic.APIError ? String(e.status ?? e.name) : 'stream'
        const text = e instanceof Error ? e.message : String(e)
        emit({ type: 'error', code, message: text })
        return finish('error', { error: { code, message: text } })
      }

      // The SDK ends an aborted stream quietly, so the response above may be half a message.
      if (signal.aborted) return finish('aborted')

      requests += 1
      usage = addUsage(usage, message.usage)
      const price = costUsd(model, message.usage)
      cost = cost === null || price === null ? null : cost + price

      // A block the stream never closed (a response cut off mid-block) can not be sent back:
      // a thinking block without its signature, or a tool call with half an input.
      const blocks = message.content.filter((_, i) => !message.unfinished.has(i))
      const keep = () => {
        if (blocks.length)
          this.messages.push({
            role: 'assistant',
            content: blocks as Anthropic.ContentBlockParam[]
          })
      }
      const uses = blocks.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

      switch (message.stopReason) {
        case 'end_turn':
        case 'stop_sequence':
          keep()
          return finish(capped ? 'tool-cap' : 'end_turn')

        case 'refusal': {
          // The refused response is not kept: a refusal in the history would colour what follows.
          const details = message.stopDetails
          emit({
            type: 'notice',
            code: 'refusal',
            message: details?.explanation ?? 'Claude declined to answer this request.'
          })
          return finish('refusal', {
            refusal: {
              category: details?.category ?? null,
              explanation: details?.explanation ?? null
            }
          })
        }

        case 'max_tokens':
        case 'model_context_window_exceeded': {
          // A tool input cut off here can parse as a valid partial object, so nothing runs.
          keep()
          if (uses.length)
            this.messages.push({
              role: 'user',
              content: uses.map((u) =>
                plainResult(u.id, {
                  TRUNCATED: 'The response hit its length limit; this call was not run.'
                })
              )
            })
          emit({
            type: 'notice',
            code: 'max_tokens',
            message:
              message.stopReason === 'max_tokens'
                ? 'Claude’s reply reached the output limit and was cut off.'
                : 'The conversation filled the model’s context window.'
          })
          return finish('max_tokens')
        }

        case 'pause_turn':
          pauses += 1
          if (pauses > MAX_PAUSES) return finish('pause-limit')
          keep()
          continue

        case 'tool_use': {
          keep()
          if (!uses.length) {
            // Only a server tool is waiting; the API runs it when the content comes back.
            pauses += 1
            if (pauses > MAX_PAUSES) return finish('pause-limit')
            continue
          }
          pauses = 0
          const results: Anthropic.ToolResultBlockParam[] = []
          const env = {
            ctx: this.ctx,
            turnId,
            signal,
            revisions: this.revisions
          }
          for (const use of uses) {
            clearGhost(use.id)
            const name = use.name
            let output: ToolOutput
            if (signal.aborted) {
              output = {
                content: JSON.stringify({ ABORTED: 'The user stopped the turn.' }),
                isError: true
              }
            } else if (toolCalls >= this.cap) {
              capped = true
              output = {
                content: JSON.stringify({
                  TOOL_CALL_CAP: `This turn has used its ${this.cap} tool calls. Make no more calls: summarize what you have done and ask the user whether to continue.`
                }),
                isError: true
              }
            } else {
              toolCalls += 1
              const raw = message.invalidInput.get(use.id)
              const tool = toolByName(name)
              if (raw !== undefined)
                output = { content: JSON.stringify({ INVALID_JSON: raw }), isError: true }
              else if (!tool)
                output = { content: JSON.stringify({ UNKNOWN_TOOL: name }), isError: true }
              else output = await tool.execute(use.input, env)
            }
            transactions.push(...(output.committed ?? []))
            results.push({
              type: 'tool_result',
              tool_use_id: use.id,
              content: output.content,
              ...(output.isError ? { is_error: true } : {})
            })
            emit({
              type: 'tool-result',
              id: use.id,
              name,
              server: false,
              ok: !output.isError,
              content: output.content,
              transactions: output.committed ?? []
            })
          }
          this.messages.push({ role: 'user', content: results })
          if (signal.aborted) return finish('aborted')
          continue
        }

        default: {
          const text = `The API ended the response with ${message.stopReason ?? 'no stop reason'}`
          emit({ type: 'error', code: 'stop-reason', message: text })
          return finish('error', { error: { code: 'stop-reason', message: text } })
        }
      }
    }
  }
}
