// npm run evals [-- --only a,b]          replay the recorded runs: no key, no network
// npm run evals:live [-- --only a,b]     run against the API with the key from .env, record fixtures
//
// Loaded by cli.ts through Vite's module runner, which gives the app's modules the ?raw imports
// and import.meta.glob they use. See docs/v2/EVALS.md.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, DEFAULT_MODEL } from '@renderer/assistant/client'
import { costUsd } from '@renderer/assistant/prices'
import { TOOLS } from '@renderer/assistant/tools'
import { partDef } from '@renderer/core/defs/parts'
import type { CircuitDoc } from '@renderer/core/model/types'
import type { Check } from './checks'
import {
  expectedOf,
  fixtureExists,
  loadFixture,
  RESULTS,
  saveFixture,
  updateExpected,
  TRANSCRIPTS,
  writeJson
} from './files'
import {
  serverTools,
  toolAcceptance,
  toolsAndCaching,
  webSearchAccepted,
  type LiveCheck
} from './liveChecks'
import { PythonRuntime } from './nodeContext'
import { PROMPTS, promptById, type EvalPrompt, type Seed } from './prompts'
import { execute, score, type Outcome } from './runner'
import {
  canonical,
  inputDeltas,
  recordFetch,
  replayFetch,
  sseUsage,
  type Exchange,
  type InputDeltas,
  type Json
} from './tape'

export interface Args {
  argv: string[]
  /** Reads the API key; null when there is none. The key is never held anywhere else. */
  key: (() => string) | null
  /** The repository's gpio-dashboard folder. */
  root: string
}

interface Flags {
  live: boolean
  only: string[] | null
  checksOnly: boolean
  /** Minutes to wait for the organization to accept web search before running; 0 for none. */
  waitForSearch: number
  /** Assume web search is available, and send refused requests again. */
  search: boolean
  /** Take web search out of the request: only web fetch is offered. */
  noSearch: boolean
  skipChecks: boolean
  rescore: boolean
  budgetUsd: number
  model: string
}

function parseFlags(argv: string[]): Flags {
  const flag = (name: string) => argv.includes(`--${name}`)
  const value = (name: string) => {
    const at = argv.indexOf(`--${name}`)
    return at >= 0 ? argv[at + 1] : undefined
  }
  return {
    live: flag('live'),
    only: value('only')?.split(',').filter(Boolean) ?? null,
    checksOnly: flag('checks-only'),
    waitForSearch: Number(value('wait-for-search') ?? 0),
    search: flag('search'),
    noSearch: flag('no-search'),
    skipChecks: flag('skip-checks'),
    rescore: flag('rescore'),
    budgetUsd: Number(value('budget') ?? 60),
    model: value('model') ?? DEFAULT_MODEL
  }
}

const money = (n: number | null) => (n === null ? 'n/a' : `$${n.toFixed(2)}`)

/** Today's date in US Eastern, for a fixture's record. */
const easternDate = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export interface Replayed {
  outcome: Outcome
  checks: Check[]
  /** Checks whose result differs from what the live run scored. */
  drift: string[]
  /** Requests whose body differs from the recorded one. */
  changedRequests: number
  unusedResponses: number
}

/** Runs a prompt against its recorded responses. */
export async function replay(
  prompt: EvalPrompt,
  seed: Seed | undefined,
  python: PythonRuntime,
  progress?: (line: string) => void
): Promise<Replayed> {
  const { run: recorded, exchanges } = loadFixture(prompt.id)
  const server = replayFetch(exchanges)
  const outcome = await execute(prompt, seed, createClient(server.fetch), python, {
    model: recorded.model,
    webTools: recorded.webTools,
    progress
  })
  const checks = score(outcome.run)
  const drift = checks
    .filter((c) => recorded.expected[c.id] !== undefined && recorded.expected[c.id] !== c.pass)
    .map(
      (c) =>
        `${c.id}: recorded ${recorded.expected[c.id] ? 'pass' : 'fail'}, now ${c.pass ? 'pass' : 'fail'}`
    )
  for (const id of Object.keys(recorded.expected))
    if (!checks.some((c) => c.id === id)) drift.push(`${id}: recorded but no longer scored`)
  const changed = server.sent.filter(
    (body, i) => canonical(body) !== canonical((exchanges[i]?.request ?? null) as Json)
  ).length
  return { outcome, checks, drift, changedRequests: changed, unusedResponses: server.remaining() }
}

function describeChecks(checks: Check[]): string {
  const failed = checks.filter((c) => !c.pass)
  return `${checks.length - failed.length}/${checks.length}${failed.length ? `  FAILED: ${failed.map((c) => c.id).join(', ')}` : ''}`
}

// --- Seeds ---

/** The document each prompt ended with, for the prompts that start from it. */
export type Finished = Map<string, CircuitDoc>

export async function seedFor(
  prompt: EvalPrompt,
  finished: Finished,
  python: PythonRuntime
): Promise<Seed | undefined> {
  if (prompt.seed) return prompt.seed(partDef)
  if (!prompt.after) return undefined
  const done = finished.get(prompt.after)
  if (done) return { doc: structuredClone(done) }
  const dependency = promptById(prompt.after)
  if (!dependency || !fixtureExists(dependency.id))
    throw new Error(`${prompt.id} starts from ${prompt.after}, which has no fixture`)
  const earlier = await replay(dependency, await seedFor(dependency, finished, python), python)
  finished.set(dependency.id, earlier.outcome.run.final)
  return { doc: structuredClone(earlier.outcome.run.final) }
}

// --- Output ---

interface ResultRow {
  id: string
  title: string
  pass: boolean
  checks: Check[]
  model: string
  effort: string
  turns: number
  requests: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  webSearches: number
  costUsd: number | null
  seconds: number
  notices: string[]
  /** Per tool, its calls and the input_json_delta events they took. */
  inputDeltas: Record<string, InputDeltas>
  /** Per tool, the partial inputs that arrived before a call completed, and the ghosts they drew. */
  partialInputs: Outcome['partialInputs']
}

function resultRow(
  prompt: EvalPrompt,
  outcome: Outcome,
  checks: Check[],
  model: string,
  exchanges: readonly Exchange[]
): ResultRow {
  return {
    id: prompt.id,
    title: prompt.title,
    pass: checks.every((c) => c.pass),
    checks,
    model,
    effort: prompt.effort,
    turns: outcome.run.turns.length,
    requests: outcome.requests,
    toolCalls: outcome.run.calls.filter((c) => !c.server).length,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
    cacheWriteTokens: outcome.usage.cacheWriteTokens,
    cacheReadTokens: outcome.usage.cacheReadTokens,
    webSearches: outcome.usage.webSearches,
    costUsd: outcome.costUsd,
    seconds: Math.round(outcome.seconds),
    notices: outcome.notices.map((n) => `${n.code}: ${n.message}`),
    inputDeltas: inputDeltas(exchanges),
    partialInputs: outcome.partialInputs
  }
}

/** What simulate was told to press or move, and how far run_code_in_sim let the program run. */
function describeObservations(ctx: Outcome['run']['ctx']): string {
  const inputs = ctx.inputLog.map((i) => `${i.part}.${i.key}=${i.value}`)
  const runs = ctx.runLog.map(
    (r) => `${r.endedAt.toFixed(2)} of ${r.seconds} s${r.error ? ' (error)' : ''}`
  )
  return `simulate inputs: ${inputs.join(', ') || 'none'}; run_code_in_sim reached: ${runs.join(', ') || 'not run'}`
}

/** The partial inputs that came before a call was complete, as `place_part 7 (5 ghosts)`. */
function describePartials(partials: Outcome['partialInputs']): string {
  return (
    Object.entries(partials)
      .map(([name, p]) => `${name} ${p.snapshots} (${p.ghosts} ghost${p.ghosts === 1 ? '' : 's'})`)
      .join(', ') || 'none'
  )
}

/** The mutation tools' input deltas as one line: `place_part 12×9.4` is 12 calls of 9.4 deltas. */
function describeDeltas(deltas: Record<string, InputDeltas>): string {
  const mutating = new Set(TOOLS.filter((t) => t.mutates).map((t) => t.name))
  return Object.entries(deltas)
    .filter(([name]) => mutating.has(name))
    .map(([name, d]) => `${name} ${d.calls}×${(d.deltas / d.calls).toFixed(1)}`)
    .join(', ')
}

function writeTranscript(
  prompt: EvalPrompt,
  outcome: Outcome,
  checks: Check[],
  exact: string | null,
  model: string
) {
  const { run } = outcome
  writeJson(
    join(TRANSCRIPTS, `${prompt.id}.json`),
    {
      id: prompt.id,
      title: prompt.title,
      model,
      effort: prompt.effort,
      recorded: easternDate(),
      turns: run.turns.map((t, i) => ({
        user: t.user,
        assistant: t.text,
        end: t.result.reason,
        notices: t.notices,
        usage: t.result.usage,
        toolCalls: run.calls
          .filter((c) => c.turn === i + 1)
          .map((c) => ({
            tool: c.name,
            server: c.server || undefined,
            input: c.input,
            ok: c.ok,
            result: c.result,
            committed: c.committed || undefined
          })),
        transactions: t.result.transactions.length
      })),
      questions: run.ctx.questions,
      partialInputs: outcome.partialInputs,
      simulatedInputs: run.ctx.inputLog,
      codeRuns: run.ctx.runLog,
      custom: (run.final.customParts ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        datasheet: d.provenance.sources
      })),
      final: {
        parts: run.final.parts.map((p) => `${p.id} ${p.defId}`),
        wires: run.final.wires.length,
        code: run.final.code.source
      },
      checks
    },
    exact
  )
}

// --- Live ---

interface Web {
  search: boolean
  fetch: boolean
}

/** Runs of a prompt allowed while the organization refuses web search. */
const WEB_RETRIES = 12

/** Milliseconds to wait before running a prompt again: the refusals last minutes, not moments. */
const retryDelayMs = (attempt: number) => Math.min(60_000, 15_000 * attempt)

const LIVE_CHECKS_FILE = join(RESULTS, 'live-checks.json')

/** Runs the questions only the API can answer, and saves the answers. */
async function runLiveChecks(
  live: typeof fetch,
  python: PythonRuntime,
  model: string,
  exact: string | null
): Promise<{ web: Web; spent: number }> {
  console.log('\nLive checks')
  const checks: LiveCheck[] = []
  let web: Web = { search: false, fetch: false }
  const attempt = async (label: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (e) {
      console.log(`  ${label} failed to run: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  await attempt('tools and caching', async () => {
    checks.push(...(await toolsAndCaching(live, python, model)))
  })
  await attempt('tool acceptance', async () => {
    const found = await toolAcceptance(live, model)
    checks.push(...found.checks)
    web = found.web
  })
  await attempt('server tools', async () => {
    checks.push(await serverTools(live, model, web))
  })
  for (const c of checks)
    console.log(
      `  ${c.answer === null ? 'UNKNOWN' : c.answer ? 'YES' : 'NO'}  ${c.question}\n        ${c.summary}`
    )
  const spent = checks.reduce((sum, c) => sum + c.costUsd, 0)
  console.log(`  The checks cost ${money(spent)}.`)
  writeJson(LIVE_CHECKS_FILE, { date: easternDate(), model, web, spentUsd: spent, checks }, exact)
  return { web, spent }
}

/** Polls until a request that carries web_search is accepted, for at most `minutes`. */
async function waitForSearch(live: typeof fetch, model: string, minutes: number): Promise<boolean> {
  const deadline = Date.now() + minutes * 60_000
  console.log(`\nWaiting up to ${minutes} min for the organization to accept web search`)
  for (;;) {
    if (await webSearchAccepted(live, model)) {
      console.log('  web search is accepted now')
      return true
    }
    if (Date.now() >= deadline) {
      console.log('  web search was refused throughout')
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000))
  }
}

/** Puts one check's new result into the saved live checks. */
function replaceSavedCheck(check: LiveCheck, exact: string | null) {
  if (!existsSync(LIVE_CHECKS_FILE)) return
  const saved = JSON.parse(readFileSync(LIVE_CHECKS_FILE, 'utf8')) as {
    checks: LiveCheck[]
    web: Web
    spentUsd?: number
  }
  saved.checks = saved.checks.map((c) => (c.id === check.id ? check : c))
  saved.web = { ...saved.web, search: true }
  saved.spentUsd = (saved.spentUsd ?? 0) + check.costUsd
  writeJson(LIVE_CHECKS_FILE, saved, exact)
}

/** How often a request is sent again when the organization refuses web search. */
const SEARCH_RESENDS = 15

/** What the organization says when it refuses web search. */
const SEARCH_REFUSED = /Web search is not enabled for this organization/

/**
 * The SDK's placeholder bearer, replaced by the real key as the Rust proxy does in the app.
 * With `--no-search`, or after `--wait-for-search` found search refused throughout, the search
 * tool is taken out in transit, after the tape has recorded the request as the loop built it.
 * Otherwise the loop meets the organization's refusal itself and drops the tool (ADR-X9-2).
 *
 * With `--search`, a request carrying web search that is refused is sent again, unchanged, as an
 * HTTP proxy would, so a run can record the search path; the loop and the tape see only the
 * answer that stuck. `resent` counts the repeats.
 */
function liveFetch(
  key: () => string,
  options: { dropSearch: () => boolean; resend: boolean },
  resent: { count: number }
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.delete('x-api-key')
    headers.set('authorization', `Bearer ${key()}`)
    let body = init?.body
    let carriesSearch = false
    if (typeof body === 'string') {
      const request = JSON.parse(body) as { tools?: { name?: string }[] }
      carriesSearch = !!request.tools?.some((t) => t.name === 'web_search')
      if (carriesSearch && options.dropSearch()) {
        request.tools = request.tools!.filter((t) => t.name !== 'web_search')
        body = JSON.stringify(request)
        carriesSearch = false
      }
    }
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(input, { ...init, headers, body })
      if (!carriesSearch || !options.resend || response.status !== 400 || attempt >= SEARCH_RESENDS)
        return response
      if (!SEARCH_REFUSED.test(await response.clone().text())) return response
      resent.count += 1
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
}

async function runLive(
  flags: Flags,
  key: () => string,
  python: PythonRuntime,
  selected: EvalPrompt[]
): Promise<number> {
  const exact = key()
  let web: Web = { search: true, fetch: true }
  if (flags.noSearch) web = { search: false, fetch: true }
  const resent = { count: 0 }
  const live = liveFetch(
    key,
    {
      dropSearch: () => web.fetch && !web.search && (flags.noSearch || flags.waitForSearch > 0),
      resend: flags.search || flags.waitForSearch > 0
    },
    resent
  )
  let spent = 0
  console.log(`Live mode: ${flags.model}, budget ${money(flags.budgetUsd)}.`)

  if (!flags.skipChecks) {
    const found = await runLiveChecks(live, python, flags.model, exact)
    web = found.web
    spent += found.spent
  }
  if (flags.waitForSearch > 0 || flags.search) {
    const open = flags.search ? true : await waitForSearch(live, flags.model, flags.waitForSearch)
    if (open) {
      web = { search: true, fetch: true }
      const check = await serverTools(live, flags.model, web)
      spent += check.costUsd
      console.log(`  ${check.answer ? 'YES' : 'NO'}  ${check.question}\n        ${check.summary}`)
      replaceSavedCheck(check, exact)
    } else {
      // Still refused: the datasheet prompt then runs with web fetch alone.
      web = { ...web, search: false }
    }
  }
  if (flags.checksOnly) return 0

  const finished: Finished = new Map()
  const rowsOut: ResultRow[] = []
  console.log(
    `\nPrompts (web search ${web.search ? 'on' : 'unavailable'}, web fetch ${web.fetch ? 'on' : 'unavailable'})`
  )
  for (const prompt of selected) {
    if (spent >= flags.budgetUsd) {
      console.log(`  stopping before ${prompt.id}: the ${money(flags.budgetUsd)} budget is spent`)
      break
    }
    const seed = await seedFor(prompt, finished, python)
    const useWeb = prompt.webTools && (web.search || web.fetch)
    console.log(`  ${prompt.id}`)
    resent.count = 0
    // This organization's web search comes and goes: a request that carries the tool is sometimes
    // refused with 400 "Web search is not enabled for this organization" (docs/v2/EVALS.md). The
    // loop has no answer to that, so a run it ended that way is made again. A refused request
    // costs nothing.
    let tape = recordFetch(live)
    let outcome: Outcome | undefined
    let promptSpend = 0
    for (let attempt = 1; attempt <= WEB_RETRIES; attempt++) {
      const abort = new AbortController()
      promptSpend = 0
      tape = recordFetch(live, (e: Exchange) => {
        if (e.status !== 200) return
        promptSpend += costUsd(String(e.request.model), sseUsage(e.body)) ?? 0
        if (promptSpend > prompt.maxCostUsd) {
          console.log(`  ${prompt.id}: over its ${money(prompt.maxCostUsd)} cap, aborting`)
          abort.abort()
        }
      })
      outcome = await execute(prompt, seed, createClient(tape.fetch), python, {
        model: flags.model,
        webTools: useWeb,
        signal: abort.signal,
        progress: (line) => console.log(`      ${line}`)
      })
      await tape.settled()
      const refused = outcome.run.turns.some((t) =>
        /Web search is not enabled/.test(t.result.error?.message ?? '')
      )
      if (!refused) break
      spent += outcome.costUsd ?? promptSpend
      if (attempt === WEB_RETRIES) break
      const wait = retryDelayMs(attempt)
      console.log(
        `    web search refused (attempt ${attempt} of ${WEB_RETRIES}); running it again in ${wait / 1000} s`
      )
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
    if (!outcome) throw new Error('no attempt was made')
    const checks = score(outcome.run)
    spent += outcome.costUsd ?? promptSpend
    finished.set(prompt.id, outcome.run.final)
    saveFixture(
      prompt.id,
      {
        turns: prompt.turns,
        model: flags.model,
        effort: prompt.effort,
        webTools: useWeb,
        recorded: easternDate(),
        sdk: '1.3.0',
        expected: expectedOf(checks),
        notes: [
          ...(useWeb && !web.search && (flags.noSearch || flags.waitForSearch > 0)
            ? [
                'web_search was removed from the tool list in transit: the organization has no web search'
              ]
            : []),
          ...(resent.count
            ? [
                `The organization refused web search for ${resent.count} request(s), 400 "Web search is not enabled for this organization"; each was sent again unchanged until one was accepted, and the exchanges here are the accepted ones.`
              ]
            : [])
        ]
      },
      tape.exchanges,
      exact
    )
    writeTranscript(prompt, outcome, checks, exact, flags.model)
    const row = resultRow(prompt, outcome, checks, flags.model, tape.exchanges)
    rowsOut.push(row)
    console.log(
      `    ${describeChecks(checks)}  ${outcome.requests} requests, ${row.toolCalls} tool calls, ${money(outcome.costUsd)}, ${row.seconds} s`
    )
    console.log(`    input deltas per call (calls×deltas): ${describeDeltas(row.inputDeltas)}`)
    console.log(`    partial inputs before completion: ${describePartials(row.partialInputs)}`)
    console.log(`    ${describeObservations(outcome.run.ctx)}`)
    for (const n of row.notices) console.log(`    notice ${n}`)
    for (const c of checks.filter((x) => !x.pass)) console.log(`      FAIL ${c.id}: ${c.detail}`)
  }
  console.log(`\nSpent ${money(spent)} of ${money(flags.budgetUsd)}.`)
  if (rowsOut.length) {
    // A run of some prompts keeps the rows of the others.
    const file = join(RESULTS, 'live.json')
    const before = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as { prompts: ResultRow[]; spentUsd?: number })
      : { prompts: [] as ResultRow[], spentUsd: 0 }
    const prompts = PROMPTS.flatMap((p) => {
      const row = rowsOut.find((r) => r.id === p.id) ?? before.prompts.find((r) => r.id === p.id)
      return row ? [row] : []
    })
    writeJson(
      file,
      {
        date: easternDate(),
        model: flags.model,
        spentUsd: prompts.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
        prompts
      },
      exact
    )
  }
  return 0
}

// --- Replay ---

async function runReplay(
  python: PythonRuntime,
  selected: EvalPrompt[],
  rescore: boolean
): Promise<number> {
  console.log('Replay mode: recorded responses, no key, no network.')
  const finished: Finished = new Map()
  const rowsOut: ResultRow[] = []
  const drifted: string[] = []
  let missing = 0
  for (const prompt of selected) {
    if (!fixtureExists(prompt.id)) {
      console.log(`  ${prompt.id}  NO FIXTURE (run npm run evals:live)`)
      missing += 1
      continue
    }
    const seed = await seedFor(prompt, finished, python)
    const result = await replay(prompt, seed, python)
    if (rescore) {
      updateExpected(prompt.id, expectedOf(result.checks))
      result.drift.length = 0
    }
    finished.set(prompt.id, result.outcome.run.final)
    const recorded = loadFixture(prompt.id)
    rowsOut.push(
      resultRow(prompt, result.outcome, result.checks, recorded.run.model, recorded.exchanges)
    )
    drifted.push(...result.drift.map((d) => `${prompt.id} ${d}`))
    console.log(
      `  ${prompt.id.padEnd(24)} ${describeChecks(result.checks)}  ${result.outcome.requests} requests${result.changedRequests ? `, ${result.changedRequests} request(s) differ from the recording` : ''}${result.unusedResponses ? `, ${result.unusedResponses} recorded response(s) unused` : ''}`
    )
    for (const c of result.checks.filter((x) => !x.pass))
      console.log(`      fail ${c.id}: ${c.detail}`)
    console.log(`      input deltas (calls×deltas): ${describeDeltas(rowsOut.at(-1)!.inputDeltas)}`)
    console.log(
      `      partial inputs before completion: ${describePartials(rowsOut.at(-1)!.partialInputs)}`
    )
    console.log(`      ${describeObservations(result.outcome.run.ctx)}`)
  }
  if (rowsOut.length) writeJson(join(RESULTS, 'replay.json'), { prompts: rowsOut })
  if (drifted.length) {
    console.log('\nScores that differ from the live run:')
    for (const d of drifted) console.log(`  ${d}`)
  }
  return drifted.length || missing ? 1 : 0
}

export async function main(args: Args): Promise<number> {
  const flags = parseFlags(args.argv)
  const selected = (flags.only ?? PROMPTS.map((p) => p.id)).map((id) => {
    const prompt = promptById(id)
    if (!prompt)
      throw new Error(`No prompt "${id}"; the prompts are ${PROMPTS.map((q) => q.id).join(', ')}`)
    return prompt
  })
  if (flags.live && !args.key) {
    console.log('No ANTHROPIC_API_KEY was found, so live mode cannot run. Replaying instead.')
    flags.live = false
  }
  const python = await PythonRuntime.load(join(args.root, 'node_modules/pyodide/'))
  return flags.live && args.key
    ? runLive(flags, args.key, python, selected)
    : runReplay(python, selected, flags.rescore)
}
