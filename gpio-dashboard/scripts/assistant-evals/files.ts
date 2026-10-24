// Reading and writing the committed eval files: fixtures (what the API sent and said), transcripts
// (the same runs, readable) and live results. Nothing is written that contains a key, or anything
// shaped like one.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Check } from './checks'
import type { Exchange, FixtureRun, StoredRequest } from './tape'
import { fromStored, scrubExchange, toStored } from './tape'

const HERE = import.meta.dirname
export const FIXTURES = join(HERE, 'fixtures')
export const TRANSCRIPTS = join(HERE, 'transcripts')
export const RESULTS = join(HERE, 'results')

/** An Anthropic key, in any of the forms the API issues. */
export const KEY_SHAPE = /sk-ant-[A-Za-z0-9_-]{8,}/

/** Throws if `text` holds a key (the exact one, or anything shaped like one). */
export function assertNoSecret(text: string, label: string, exact: string | null) {
  if (KEY_SHAPE.test(text) || (exact && exact.length > 8 && text.includes(exact)))
    throw new Error(`Refusing to write ${label}: it contains something shaped like an API key`)
}

export function writeJson(path: string, value: unknown, exact: string | null = null) {
  const text = `${JSON.stringify(value, null, 1)}\n`
  assertNoSecret(text, path, exact)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

// --- Fixtures ---

/** A stream's frames as lines, so a fixture diffs by event; anything else as it is. */
function framed(body: string): string | string[] {
  if (!body.endsWith('\n\n')) return body
  const frames = body.slice(0, -2).split('\n\n')
  return frames.join('\n\n') + '\n\n' === body ? frames : body
}

const unframed = (body: string | string[]): string =>
  typeof body === 'string' ? body : body.map((f) => `${f}\n\n`).join('')

type OnDisk = Omit<FixtureRun, 'requests'> & {
  requests: (Omit<StoredRequest, 'body'> & { body: string | string[] })[]
}

export function saveFixture(
  id: string,
  run: Omit<FixtureRun, 'requests'>,
  exchanges: readonly Exchange[],
  exact: string | null
) {
  const stored = toStored(exchanges.map(scrubExchange))
  const file: OnDisk = {
    ...run,
    requests: stored.requests.map((r) => ({ ...r, body: framed(r.body) }))
  }
  writeJson(join(FIXTURES, `${id}.json`), file, exact)
}

/** Records today's scores as the ones replay must reproduce (after the scoring code changed). */
export function updateExpected(id: string, expected: Record<string, boolean>) {
  const path = join(FIXTURES, `${id}.json`)
  const file = JSON.parse(readFileSync(path, 'utf8')) as OnDisk
  writeJson(path, { ...file, expected })
}

export interface LoadedFixture {
  run: FixtureRun
  exchanges: Exchange[]
}

export function fixtureExists(id: string): boolean {
  return existsSync(join(FIXTURES, `${id}.json`))
}

export function loadFixture(id: string): LoadedFixture {
  const file = JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), 'utf8')) as OnDisk
  const run: FixtureRun = {
    ...file,
    requests: file.requests.map((r) => ({ ...r, body: unframed(r.body) }))
  }
  return { run, exchanges: fromStored(run) }
}

export const expectedOf = (checks: Check[]): Record<string, boolean> =>
  Object.fromEntries(checks.map((c) => [c.id, c.pass]))
