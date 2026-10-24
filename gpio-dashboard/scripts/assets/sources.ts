// SPEC 10.3 stage 1: pinned inputs, downloaded once, verified by SHA-256 and cached outside git.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export interface Source {
  id: string
  url: string
  sha256: string
  retrieved: string
  license: string
  page: string
  author: string
  use: string
  /** Where the file is committed, when it ships as is. */
  shipped?: string
  /** Files read out of an archive, each pinned by its own hash. */
  extract?: { path: string; sha256: string }[]
}

export const ASSETS_DIR = import.meta.dirname
export const CACHE_DIR = join(homedir(), '.cache', 'gpio-dashboard-assets')

export const SOURCES: Source[] = JSON.parse(
  readFileSync(join(ASSETS_DIR, 'sources.json'), 'utf8')
).sources

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

export function source(id: string): Source {
  const s = SOURCES.find((s) => s.id === id)
  if (!s) throw new Error(`sources.json has no ${id}`)
  return s
}

/** The cached download of a source, fetched and verified first if it isn't cached yet. */
export async function fetchSource(id: string): Promise<string> {
  const s = source(id)
  const path = join(CACHE_DIR, decodeURIComponent(basename(new URL(s.url).pathname)))
  if (!existsSync(path)) {
    const response = await fetch(s.url)
    if (!response.ok) throw new Error(`${id}: HTTP ${response.status} from ${s.url}`)
    const data = new Uint8Array(await response.arrayBuffer())
    if (sha256(data) !== s.sha256) throw new Error(`${id}: download does not match its SHA-256`)
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(path, data)
  }
  if (sha256(readFileSync(path)) !== s.sha256) {
    throw new Error(`${id}: cached ${path} does not match its SHA-256; delete it to fetch again`)
  }
  return path
}

/** One pinned file out of a source's zip archive, verified against its own hash. */
export async function extractSource(id: string, file: string): Promise<Buffer> {
  const entry = source(id).extract?.find((e) => e.path === file)
  if (!entry) throw new Error(`${id}: sources.json pins no ${file}`)
  const data = execFileSync('unzip', ['-p', await fetchSource(id), file], {
    maxBuffer: 1 << 30
  })
  if (sha256(data) !== entry.sha256) throw new Error(`${id}: ${file} does not match its SHA-256`)
  return data
}
