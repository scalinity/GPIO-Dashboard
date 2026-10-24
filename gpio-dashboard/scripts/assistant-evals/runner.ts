// Runs one eval prompt: an AssistantSession over a client (live, recorded or replayed) and a Node
// context, then scores the result. The same code serves live runs and replays, so a replay scores
// exactly what a live run would have, given the same model output.
import type Anthropic from '@anthropic-ai/sdk'
import type { AssistantEvent } from '@renderer/assistant/loop'
import { AssistantSession } from '@renderer/assistant/loop'
import { addUsage, emptyUsage, type TokenUsage } from '@renderer/assistant/prices'
import { ghostFor } from '@renderer/assistant/tools'
import type { CircuitDoc } from '@renderer/core/model/types'
import { check, genericChecks, type Call, type Check, type Run, type TurnRecord } from './checks'
import { NodeContext, PythonRuntime, sameDoc, emptyEvalDoc } from './nodeContext'
import type { EvalPrompt, Seed } from './prompts'

const RESULT_CHARS = 1500

export interface Outcome {
  run: Run
  requests: number
  usage: TokenUsage
  /** Dollars, or null when a model has no price in prices.ts. */
  costUsd: number | null
  seconds: number
  /** The first request's fallback, if the API refused the tool schemas. */
  notices: { code: string; message: string }[]
  /**
   * Per tool, the snapshots of its input that arrived before the call was complete, and how many
   * of them were enough to draw a ghost. With eager input streaming this is what lets a preview
   * appear before the model has finished the call.
   */
  partialInputs: Record<string, { snapshots: number; ghosts: number }>
}

const asText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .map((b: { type?: string; text?: string }) =>
            b.type === 'text' ? (b.text ?? '') : `[${b.type ?? 'block'}]`
          )
          .join('')
      : JSON.stringify(content)

export interface ExecuteOptions {
  model?: string
  /** The session's web tools; the prompt's own setting when absent. */
  webTools?: boolean
  signal?: AbortSignal
  /** Called as the run goes: a line of progress per tool call. */
  progress?: (line: string) => void
}

/** Runs the prompt's turns in one session and returns what happened, unscored. */
export async function execute(
  prompt: EvalPrompt,
  seed: Seed | undefined,
  client: Anthropic,
  python: PythonRuntime,
  options: ExecuteOptions = {}
): Promise<Outcome> {
  const started = Date.now()
  const ctx = new NodeContext({
    doc: seed?.doc ?? emptyEvalDoc(),
    sense: seed?.sense,
    python,
    answer: prompt.answer
  })
  const start = structuredClone(ctx.getSnapshot())
  let turnNumber = 0
  const session = new AssistantSession({
    client,
    ctx,
    model: options.model,
    effort: prompt.effort,
    webTools: options.webTools ?? prompt.webTools,
    newTurnId: () => `turn-${(turnNumber += 1)}`
  })

  const turns: TurnRecord[] = []
  const calls: Call[] = []
  const afterTurn: CircuitDoc[] = []
  let usage = emptyUsage()
  let cost: number | null = 0
  let requests = 0
  const notices: Outcome['notices'] = []
  const partialInputs: Outcome['partialInputs'] = {}

  for (const [index, user] of prompt.turns.entries()) {
    const record: TurnRecord = {
      turnId: '',
      user,
      text: '',
      notices: [],
      result: undefined as never
    }
    const byId = new Map<string, Call>()
    const onEvent = (e: AssistantEvent) => {
      switch (e.type) {
        case 'turn-start':
          record.turnId = e.turnId
          break
        case 'text':
          record.text += e.delta
          break
        case 'tool-start': {
          const call: Call = {
            turn: index + 1,
            id: e.id,
            name: e.name,
            server: e.server,
            input: null,
            ok: false,
            result: '',
            committed: 0
          }
          byId.set(e.id, call)
          calls.push(call)
          break
        }
        case 'tool-input':
          if (e.complete) {
            const call = byId.get(e.id)
            if (call) call.input = e.input
          } else if (e.input) {
            const seen = (partialInputs[e.name] ??= { snapshots: 0, ghosts: 0 })
            seen.snapshots += 1
            if (ghostFor(e.name, e.input, ctx.getSnapshot(), ctx.partDef)) seen.ghosts += 1
          }
          break
        case 'tool-result': {
          const call = byId.get(e.id)
          if (call) {
            call.ok = e.ok
            call.result = asText(e.content).slice(0, RESULT_CHARS)
            call.committed = e.transactions.length
            options.progress?.(`${call.server ? 'web ' : ''}${call.name}${e.ok ? '' : ' (error)'}`)
          }
          break
        }
        case 'notice':
          record.notices.push({ code: e.code, message: e.message })
          notices.push({ code: e.code, message: e.message })
          break
        case 'error':
          options.progress?.(`error ${e.code}: ${e.message.slice(0, 200)}`)
          break
        default:
          break
      }
    }
    record.result = await session.runTurn(user, { onEvent, signal: options.signal })
    turns.push(record)
    afterTurn.push(structuredClone(ctx.getSnapshot()))
    requests += record.result.usage.requests
    usage = addUsage(usage, record.result.usage)
    cost =
      cost === null || record.result.usage.costUsd === null
        ? null
        : cost + record.result.usage.costUsd
  }

  const run: Run = {
    prompt,
    ctx,
    start,
    final: structuredClone(ctx.getSnapshot()),
    afterTurn,
    turns,
    calls
  }
  return {
    run,
    requests,
    usage,
    costUsd: cost,
    seconds: (Date.now() - started) / 1000,
    notices,
    partialInputs
  }
}

/**
 * Undo restores the document each turn started from (SPEC 20 item 7). Run last: it changes the
 * context's store.
 */
export function undoChecks(run: Run): Check[] {
  if (run.prompt.mutates === false) return []
  const out: Check[] = []
  for (let i = run.turns.length - 1; i >= 0; i--) {
    const turn = run.turns[i]!
    const undone = run.ctx.undoTurn(turn.turnId)
    const want = i === 0 ? run.start : run.afterTurn[i - 1]!
    const same = sameDoc(run.ctx.getSnapshot(), want)
    const all = i === 0
    out.push(
      check(
        all ? 'undo.all' : `undo.turn${i + 1}`,
        all
          ? 'Undo all restores the starting document exactly'
          : `Undoing turn ${i + 1} restores the document before it`,
        same && undone === turn.result.transactions.length,
        `${undone} of ${turn.result.transactions.length} transactions undone${same ? '' : '; the document differs'}`
      )
    )
  }
  return out
}

/** The prompt's checks: generic, its own, and undo (last). */
export function score(run: Run): Check[] {
  return [...genericChecks(run), ...run.prompt.extra(run), ...undoChecks(run)]
}
