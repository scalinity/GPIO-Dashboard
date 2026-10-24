// What a turn costs, from the token counts the API reports (SPEC 12.2). Edit the numbers here
// when prices change. US dollars per million tokens, from
// https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-24).

export interface Price {
  input: number
  /** Writing to the cache for the default 5 minutes. */
  cacheWrite: number
  cacheRead: number
  output: number
}

export interface ModelPrice extends Price {
  /** A request whose prompt is longer than this pays `long` instead. */
  longPromptAbove?: number
  long?: Price
}

export const PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  'claude-haiku-5-5': {
    input: 0.1,
    cacheWrite: 0.125,
    cacheRead: 0.01,
    output: 0.5,
    longPromptAbove: 100_000,
    long: { input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 }
  },
  'claude-fable-5-1': { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 }
}

/** Web search is billed per search on top of tokens. */
export const WEB_SEARCH_USD = 0.01

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  webSearches: number
}

export const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  webSearches: 0
})

export function addUsage(total: TokenUsage, more: TokenUsage): TokenUsage {
  return {
    inputTokens: total.inputTokens + more.inputTokens,
    outputTokens: total.outputTokens + more.outputTokens,
    cacheWriteTokens: total.cacheWriteTokens + more.cacheWriteTokens,
    cacheReadTokens: total.cacheReadTokens + more.cacheReadTokens,
    webSearches: total.webSearches + more.webSearches
  }
}

/** Dollars for one request, or null for a model without a price. */
export function costUsd(model: string, usage: TokenUsage): number | null {
  const entry = PRICES[model]
  if (!entry) return null
  const prompt = usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens
  const price =
    entry.long && entry.longPromptAbove && prompt > entry.longPromptAbove ? entry.long : entry
  return (
    (usage.inputTokens * price.input +
      usage.cacheWriteTokens * price.cacheWrite +
      usage.cacheReadTokens * price.cacheRead +
      usage.outputTokens * price.output) /
      1e6 +
    usage.webSearches * WEB_SEARCH_USD
  )
}
