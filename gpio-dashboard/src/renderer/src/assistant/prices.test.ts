import { describe, expect, it } from 'vitest'
import { MODELS } from './client'
import { addUsage, costUsd, emptyUsage, PRICES } from './prices'

const usage = (u: Partial<ReturnType<typeof emptyUsage>>) => ({ ...emptyUsage(), ...u })

describe('costUsd', () => {
  it('prices each kind of token at its own rate', () => {
    // 1M of each, Opus 5.5: 4 + 5 + 0.2 + 20.
    const million = usage({
      inputTokens: 1e6,
      cacheWriteTokens: 1e6,
      cacheReadTokens: 1e6,
      outputTokens: 1e6
    })
    expect(costUsd('claude-opus-5-5', million)).toBeCloseTo(29.2, 6)
    expect(costUsd('claude-sonnet-5-5', million)).toBeCloseTo(2 + 2.5 + 0.1 + 10, 6)
    expect(costUsd('claude-fable-5-1', million)).toBeCloseTo(10 + 12.5 + 0.25 + 50, 6)
  })

  it('adds web searches at a cent each', () => {
    expect(costUsd('claude-opus-5-5', usage({ webSearches: 3 }))).toBeCloseTo(0.03, 8)
  })

  it('charges Haiku 5.5 the long-prompt rates above 100k prompt tokens, cache reads included', () => {
    const short = usage({ inputTokens: 90_000, outputTokens: 1000 })
    const long = usage({ inputTokens: 10_000, cacheReadTokens: 100_001, outputTokens: 1000 })
    expect(costUsd('claude-haiku-5-5', short)).toBeCloseTo((90_000 * 0.1 + 1000 * 0.5) / 1e6, 8)
    expect(costUsd('claude-haiku-5-5', long)).toBeCloseTo(
      (10_000 * 0.5 + 100_001 * 0.05 + 1000 * 2.5) / 1e6,
      8
    )
  })

  it('has no price for a model it does not know', () => {
    expect(costUsd('claude-x-9', usage({ inputTokens: 5 }))).toBeNull()
  })

  it('prices every model in the picker', () => {
    for (const m of MODELS) expect(PRICES[m.id], m.id).toBeDefined()
  })
})

describe('addUsage', () => {
  it('sums every field', () => {
    const a = usage({
      inputTokens: 1,
      outputTokens: 2,
      cacheWriteTokens: 3,
      cacheReadTokens: 4,
      webSearches: 5
    })
    expect(addUsage(a, a)).toEqual(
      usage({
        inputTokens: 2,
        outputTokens: 4,
        cacheWriteTokens: 6,
        cacheReadTokens: 8,
        webSearches: 10
      })
    )
  })
})
