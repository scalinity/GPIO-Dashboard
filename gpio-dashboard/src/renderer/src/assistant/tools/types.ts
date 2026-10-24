// What a tool is: a name, a Zod input schema that both generates the API schema and validates the
// model's input at runtime, and a handler that reaches the app only through the AssistantContext.
import type Anthropic from '@anthropic-ai/sdk'
import type { z } from 'zod'
import type { CircuitDoc, Op, Transaction } from '../../core/model/types'
import type { AssistantContext } from '../context'

export type ToolContent = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>

export interface ToolOutput {
  content: ToolContent
  isError?: boolean
  /** The transactions this call committed, for the turn's review strip. */
  committed?: Transaction[]
}

/** Documents the assistant has seen, by revision, so `get_circuit_state` can report changes. */
export class RevisionMemory {
  private docs = new Map<number, CircuitDoc>()
  remember(doc: CircuitDoc) {
    this.docs.set(doc.meta.revision, doc)
    for (const key of this.docs.keys()) {
      if (this.docs.size <= 50) break
      this.docs.delete(key)
    }
  }
  get(revision: number): CircuitDoc | undefined {
    return this.docs.get(revision)
  }
}

export interface ToolEnv {
  ctx: AssistantContext
  turnId: string
  signal: AbortSignal
  revisions: RevisionMemory
}

export interface Tool {
  name: string
  description: string
  schema: z.ZodType
  /** Changes the document or the part library, so its input streams eagerly (SPEC 12.4). */
  mutates: boolean
  /** Has parameters, so its schema is strict. The API allows 20 strict tools per request. */
  strict: boolean
  /** Partial inputs are worth parsing while they stream (chips, ghosts). */
  preview: boolean
  /** Validates `input`, runs the handler and never throws: failures come back as error output. */
  execute(input: unknown, env: ToolEnv): Promise<ToolOutput>
}

export const reply = (value: unknown): ToolOutput => ({
  content: typeof value === 'string' ? value : JSON.stringify(value)
})

export const failure = (code: string, detail: unknown): ToolOutput => ({
  content: JSON.stringify({ [code]: detail }),
  isError: true
})

/** Commits `ops` as one transaction of this turn, or says why the store refused them. */
export function commit(env: ToolEnv, label: string, ops: Op[]): Transaction | ToolOutput {
  const result = env.ctx.dispatch({
    author: 'assistant',
    label,
    ops,
    assistantTurnId: env.turnId
  })
  if (!result.ok) return failure('REJECTED', result.problems)
  env.revisions.remember(env.ctx.getSnapshot())
  return result.tx
}

export const isOutput = (value: Transaction | ToolOutput): value is ToolOutput => 'content' in value

interface Spec<S extends z.ZodType> {
  name: string
  description: string
  schema: S
  mutates?: boolean
  preview?: boolean
  /** Left strict-free: an empty schema gains nothing from a grammar. */
  strict?: boolean
  run(input: z.output<S>, env: ToolEnv): ToolOutput | Promise<ToolOutput>
}

export function defineTool<S extends z.ZodType>(spec: Spec<S>): Tool {
  return {
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    mutates: spec.mutates ?? false,
    strict: spec.strict ?? true,
    preview: spec.preview ?? false,
    async execute(input, env) {
      const parsed = spec.schema.safeParse(input)
      if (!parsed.success) {
        return failure(
          'INVALID_INPUT',
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        )
      }
      try {
        return await spec.run(parsed.data, env)
      } catch (e) {
        return failure('INTERNAL_ERROR', e instanceof Error ? e.message : String(e))
      }
    }
  }
}
