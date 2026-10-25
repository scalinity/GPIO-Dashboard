// The Claude drawer's state (SPEC 11.8, 12): one conversation with the assistant, its chat as it
// streams (text, tool chips, result cards, questions), the turn's usage and cost, the review strip,
// and the assistant's settings. A turn locks the circuit store to itself, so the canvas is
// read-only until it ends; Stop aborts it, and what it already committed stays, one undo group.
// The transcript is saved beside the project after every turn.
import type Anthropic from '@anthropic-ai/sdk'
import { create } from 'zustand'
import { createClient, DEFAULT_EFFORT, DEFAULT_MODEL, type Effort } from '../assistant/client'
import type { CapturedView, ViewPreset } from '../assistant/context'
import {
  AssistantSession,
  type AssistantEvent,
  type TurnResult,
  type TurnUsage
} from '../assistant/loop'
import type { ToolContent } from '../assistant/tools/types'
import type { CircuitDoc } from '../core/model/types'
import { clearKey, hasKey, setKey } from '../native/anthropic'
import { writeTranscript } from '../native/projects'
import { getSetting, setSetting } from '../native/settings'
import { createAppContext } from './assistantContext'
import { circuit } from './circuit'
import { LOCKED_MESSAGE } from './circuitStore'
import { useProject } from './projectStore'
import { useStudio } from './studioStore'

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export type ChipStatus = 'streaming' | 'running' | 'done' | 'failed'

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      name: string
      label: string
      server: boolean
      status: ChipStatus
      /** The call's input has arrived whole. */
      complete: boolean
      /** Its ghost was on the bench before its input was whole (SPEC 12.6, acceptance 5). */
      ghostEarly?: boolean
      /** The result as text (JSON for most client tools). */
      result?: string
      /** A captured view, base64 PNG. */
      image?: string
    }
  | { kind: 'question'; id: string; question: string; options: string[]; answer: string | null }
  | { kind: 'notice'; id: string; text: string }
  | { kind: 'error'; id: string; text: string }

/** What one turn changed, for the review strip (SPEC 11.8). */
export interface Review {
  turnId: string
  added: { parts: number; wires: number }
  /** Parts the turn defined for this project (AddCustomPart). */
  defined: number
  changed: number
  removed: number
  /** Other things the turn changed: the code, build-step notes, boards, the T-board and Pi, the name. */
  other: string[]
  tint: { parts: string[]; wires: string[] }
}

interface AssistantState {
  items: ChatItem[]
  running: boolean
  /** Claude is thinking and has said nothing yet this request. */
  thinking: boolean
  lastUsage: TurnUsage | null
  /** The conversation's cost so far; null once a turn used a model without a price. */
  totalCost: number | null
  review: Review | null
  draft: string
  /** Bumped when something else sets the draft, so the composer takes focus. */
  draftKey: number
  settingsOpen: boolean
  model: string
  effort: Effort
  webTools: boolean
  /** Whether the Keychain holds a key; null until asked, or outside the app window. */
  hasKey: boolean | null
  keyMessage: string | null
  settingsError: string | null
  /** The web tools setting the current conversation was started with (fixed for it). */
  conversationWebTools: boolean | null
}

export const useAssistant = create<AssistantState>(() => ({
  items: [],
  running: false,
  thinking: false,
  lastUsage: null,
  totalCost: 0,
  review: null,
  draft: '',
  draftKey: 0,
  settingsOpen: false,
  model: DEFAULT_MODEL,
  effort: DEFAULT_EFFORT,
  webTools: true,
  hasKey: null,
  keyMessage: null,
  settingsError: null,
  conversationWebTools: null
}))

const set = useAssistant.setState
const get = useAssistant.getState

/** Something shaped like an Anthropic API key; it belongs in Settings, never in the chat. */
const KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{6,}/

let session: AssistantSession | null = null
let controller: AbortController | null = null
/** The document when the running turn began, for its review. */
let turnStart: CircuitDoc | null = null
let nextItem = 0
const itemId = () => `i${(nextItem += 1)}`
/** ask_user calls waiting for an answer, by question item. */
const waiting = new Map<string, (answer: string) => void>()

/** The open Studio, which captures views and moves the camera for the assistant. */
interface Stage {
  capture(preset: ViewPreset): Promise<CapturedView>
  focusOn(refs: string[]): void
}
let stage: Stage | null = null

/** The Studio registers itself while it is shown. */
export function bindStage(next: Stage | null): void {
  stage = next
}

/** A fetch other than the Rust proxy's (a dev replay). Set before the conversation starts. */
let fetchOverride: typeof fetch | null = null
export function replaceFetchForDev(fetchImpl: typeof fetch | null): void {
  fetchOverride = fetchImpl
  session = null
}

const push = (item: ChatItem) => set({ items: [...get().items, item] })

function update<K extends ChatItem['kind']>(
  id: string,
  kind: K,
  change: (item: Extract<ChatItem, { kind: K }>) => Extract<ChatItem, { kind: K }>
) {
  set({
    items: get().items.map((item) =>
      item.id === id && item.kind === kind ? change(item as Extract<ChatItem, { kind: K }>) : item
    )
  })
}

const context = createAppContext(() => ({
  capture: stage ? (preset) => stage!.capture(preset) : null,
  focus: stage ? (refs) => stage!.focusOn(refs) : null,
  askUser,
  ghostChanged(id, ghost) {
    if (!ghost) return
    const chip = get().items.find((i) => i.id === id && i.kind === 'tool')
    if (chip?.kind === 'tool' && !chip.complete && !chip.ghostEarly)
      update(id, 'tool', (t) => ({ ...t, ghostEarly: true }))
  }
}))

function askUser(question: string, options: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = itemId()
    push({ kind: 'question', id, question, options, answer: null })
    const answered = (answer: string) => {
      waiting.delete(id)
      update(id, 'question', (q) => ({ ...q, answer }))
      resolve(answer)
    }
    waiting.set(id, answered)
    signal?.addEventListener(
      'abort',
      () => {
        if (!waiting.delete(id)) return
        update(id, 'question', (q) => ({ ...q, answer: '(stopped)' }))
        reject(new DOMException('The turn was stopped.', 'AbortError'))
      },
      { once: true }
    )
  })
}

function textOf(content: ToolContent): string {
  if (typeof content === 'string') return content
  return content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
}

function imageOf(content: ToolContent): string | undefined {
  if (typeof content === 'string') return undefined
  for (const block of content)
    if (block.type === 'image' && block.source.type === 'base64') return block.source.data
  return undefined
}

function onEvent(e: AssistantEvent) {
  switch (e.type) {
    case 'turn-start':
      circuit.lock(e.turnId)
      break
    case 'text': {
      const items = get().items
      const last = items.at(-1)
      if (last?.kind === 'text')
        set({ items: [...items.slice(0, -1), { ...last, text: last.text + e.delta }] })
      else push({ kind: 'text', id: itemId(), text: e.delta })
      set({ thinking: false })
      break
    }
    case 'thinking':
      if (!get().thinking) set({ thinking: true })
      break
    case 'tool-start':
      set({ thinking: false })
      push({
        kind: 'tool',
        id: e.id,
        name: e.name,
        label: e.label,
        server: e.server,
        status: 'streaming',
        complete: false
      })
      break
    case 'tool-input':
      update(e.id, 'tool', (t) => ({
        ...t,
        label: e.label,
        complete: e.complete,
        status: e.complete ? 'running' : 'streaming'
      }))
      break
    case 'tool-result':
      update(e.id, 'tool', (t) => ({
        ...t,
        complete: true,
        status: e.ok ? 'done' : 'failed',
        result: textOf(e.content),
        image: imageOf(e.content)
      }))
      break
    case 'notice':
      push({ kind: 'notice', id: itemId(), text: e.message })
      break
    case 'error':
      push({ kind: 'error', id: itemId(), text: e.message })
      break
    case 'usage': {
      const total = get().totalCost
      set({
        lastUsage: e.usage,
        totalCost: total === null || e.usage.costUsd === null ? null : total + e.usage.costUsd
      })
      break
    }
    case 'turn-end':
      break
  }
}

function session_(): AssistantSession {
  if (!session) {
    const { model, effort, webTools } = get()
    const client: Anthropic = fetchOverride ? createClient(fetchOverride) : createClient()
    session = new AssistantSession({ client, ctx: context, model, effort, webTools })
    set({ conversationWebTools: webTools })
  }
  return session
}

/** What one turn changed between two documents, and what to tint until it is kept. */
export function reviewOf(turnId: string, before: CircuitDoc, after: CircuitDoc): Review {
  const diff = <T extends { id: string }>(was: T[], now: T[]) => {
    const old = new Map(was.map((x) => [x.id, JSON.stringify(x)]))
    const ids = new Set(now.map((x) => x.id))
    return {
      added: now.filter((x) => !old.has(x.id)).map((x) => x.id),
      changed: now
        .filter((x) => old.has(x.id) && old.get(x.id) !== JSON.stringify(x))
        .map((x) => x.id),
      removed: was.filter((x) => !ids.has(x.id)).length
    }
  }
  const parts = diff(before.parts, after.parts)
  const wires = diff(before.wires, after.wires)
  const custom = diff(before.customParts ?? [], after.customParts ?? [])
  const other: string[] = []
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  if (!same(before.code, after.code)) other.push('the code')
  if (!same(before.buildStepAnnotations, after.buildStepAnnotations))
    other.push('the build-step notes')
  if (!same(before.boards, after.boards)) other.push('the boards')
  if (!same(before.controller, after.controller)) other.push('the T-board and Pi')
  if (before.meta.name !== after.meta.name) other.push('the name')
  return {
    turnId,
    added: { parts: parts.added.length, wires: wires.added.length },
    defined: custom.added.length,
    changed: parts.changed.length + wires.changed.length + custom.changed.length,
    removed: parts.removed + wires.removed + custom.removed,
    other,
    tint: { parts: [...parts.added, ...parts.changed], wires: [...wires.added, ...wires.changed] }
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "Claude added 9 parts, 14 wires" and anything else it changed. */
export function reviewText(r: Review): string {
  const added = r.added.parts || r.added.wires
  const clauses = [
    ...(added ? [`added ${plural(r.added.parts, 'part')}, ${plural(r.added.wires, 'wire')}`] : []),
    ...(r.defined ? [`defined ${plural(r.defined, 'custom part')}`] : []),
    ...(r.changed ? [`changed ${r.changed}`] : []),
    ...(r.removed ? [`removed ${r.removed}`] : []),
    ...(r.other.length ? [`updated ${r.other.join(', ')}`] : [])
  ]
  if (!clauses.length) return 'Claude changed the project'
  // The added counts lead, as the strip reads in SPEC 11.8; the rest follow after a semicolon.
  const [first, ...rest] = clauses
  return `Claude ${first}${rest.length ? `${added ? ';' : ','} ${rest.join(', ')}` : ''}`
}

/** The chat as saved beside the project: what was said and done, never a key or an image. */
export function transcriptOf(state: AssistantState, project: { id: string; name: string }) {
  return {
    version: 1,
    project,
    savedAt: new Date().toISOString(),
    model: state.model,
    effort: state.effort,
    webTools: state.conversationWebTools ?? state.webTools,
    totalCostUsd: state.totalCost,
    items: state.items.map((item) => {
      if (item.kind !== 'tool') return item
      const { image, result, ...rest } = item
      return {
        ...rest,
        ...(result !== undefined ? { result: result.slice(0, 4000) } : {}),
        ...(image ? { image: '(a captured view)' } : {})
      }
    })
  }
}

async function saveTranscript() {
  const id = useProject.getState().id
  const state = get()
  if (!id || !state.items.length) return
  try {
    await writeTranscript(id, transcriptOf(state, { id, name: circuit.getSnapshot().meta.name }))
  } catch (e) {
    push({
      kind: 'notice',
      id: itemId(),
      text: `The transcript was not saved: ${e instanceof Error ? e.message : String(e)}`
    })
  }
}

function finishTurn(result: TurnResult) {
  const before = turnStart
  turnStart = null
  if (result.transactions.length && before && circuit.lastTurnId === result.turnId) {
    const review = reviewOf(result.turnId, before, circuit.getSnapshot())
    set({ review })
    useStudio.setState({ tinted: review.tint })
  }
  if (result.reason === 'aborted')
    push({
      kind: 'notice',
      id: itemId(),
      text: result.transactions.length
        ? 'Stopped. What Claude already built stays; Undo all takes it back.'
        : 'Stopped.'
    })
  else if (result.reason === 'pause-limit')
    push({
      kind: 'notice',
      id: itemId(),
      text: 'Claude’s web lookups kept pausing, so the turn ended. Say “continue” to go on.'
    })
  void saveTranscript()
}

function clearReview() {
  set({ review: null })
  useStudio.setState({ tinted: null })
}

/** Sends a message, or answers the question Claude is waiting on. */
export async function send(text: string): Promise<void> {
  const message = text.trim()
  if (!message) return
  if (KEY_PATTERN.test(message)) {
    // Not sent, not kept in the composer, and not in the transcript.
    set({ draft: '' })
    push({
      kind: 'notice',
      id: itemId(),
      text: 'That looks like an API key. Put it in Settings, where it goes straight to the Keychain; it was not sent.'
    })
    return
  }
  const question = [...waiting.values()].at(-1)
  if (question) {
    set({ draft: '' })
    question(message)
    return
  }
  if (get().running) return
  // Claim the turn before the first await: `running` covers the key check, so a second send is
  // refused as one during a turn is, and the turn that locked the document is the one that unlocks.
  // The controller exists from the claim too, so a Stop during the key check ends the send.
  set({ running: true })
  const turn = (controller = new AbortController())
  let result: TurnResult | null = null
  try {
    if (!fetchOverride) {
      let ready: boolean
      try {
        ready = await hasKey()
      } catch {
        push({ kind: 'error', id: itemId(), text: 'The assistant works in the app window only.' })
        return
      }
      set({ hasKey: ready })
      if (!ready) {
        push({
          kind: 'notice',
          id: itemId(),
          text: 'Add your Anthropic API key in Settings first. It is kept in the macOS Keychain.'
        })
        set({ settingsOpen: true })
        return
      }
    }
    if (turn.signal.aborted) return
    const s = session_()
    turnStart = circuit.getSnapshot()
    clearReview()
    useStudio.setState({ cue: null })
    push({ kind: 'user', id: itemId(), text: message })
    set({ thinking: true, draft: '' })
    const { model, effort } = get()
    result = await s.runTurn(message, { onEvent, signal: turn.signal, model, effort })
  } catch (e) {
    push({ kind: 'error', id: itemId(), text: e instanceof Error ? e.message : String(e) })
  } finally {
    circuit.unlock()
    controller = null
    // A refusal said while the turn ran no longer holds.
    if (useStudio.getState().notice === LOCKED_MESSAGE) useStudio.setState({ notice: null })
    useStudio.setState({ ghosts: {} })
    set({ running: false, thinking: false })
  }
  if (result) finishTurn(result)
}

/** Stop (SPEC 11.8): aborts the request; what the turn committed stays, and stays undoable. */
export function stop(): void {
  controller?.abort()
}

export function keep(): void {
  clearReview()
}

/** Undo all: the turn's transactions, back to the document it started from. */
export function undoAll(): void {
  const review = get().review
  if (review) circuit.undoTurn(review.turnId)
  clearReview()
}

export function answer(text: string): void {
  void send(text)
}

/** A fresh conversation: the chat, history and usage start over; the document is untouched. */
export function newConversation(): void {
  if (get().running) return
  session = null
  for (const id of [...waiting.keys()]) waiting.delete(id)
  set({
    items: [],
    lastUsage: null,
    totalCost: 0,
    conversationWebTools: null
  })
}

/** Opens the Claude tab with `text` in the composer ("Create custom part…", SPEC 11.2). */
export function openWithDraft(text: string): void {
  set({ draft: text, draftKey: get().draftKey + 1 })
  useStudio.setState({ drawer: 'claude' })
}

export const setDraft = (draft: string) => set({ draft })

let settingsLoaded = false

/** Reads the assistant's settings and whether a key is saved, once. */
export async function loadSettings(): Promise<void> {
  if (settingsLoaded) return
  settingsLoaded = true
  try {
    const [model, effort, webTools] = await Promise.all([
      getSetting('assistant.model'),
      getSetting('assistant.effort'),
      getSetting('assistant.webTools')
    ])
    set({
      model: typeof model === 'string' && model.trim() ? model : DEFAULT_MODEL,
      effort: EFFORTS.includes(effort as Effort) ? (effort as Effort) : DEFAULT_EFFORT,
      webTools: typeof webTools === 'boolean' ? webTools : true
    })
    // A dev replay uses no key, so it does not ask the Keychain.
    if (!fetchOverride) set({ hasKey: await hasKey() })
  } catch {
    set({ settingsError: 'Settings are kept by the app window; this preview uses the defaults.' })
  }
}

async function persist(key: string, value: unknown) {
  try {
    await setSetting(key, value)
    set({ settingsError: null })
  } catch (e) {
    set({ settingsError: `Not saved: ${e instanceof Error ? e.message : String(e)}` })
  }
}

export function setModel(model: string): void {
  const id = model.trim()
  if (!id) return
  set({ model: id })
  void persist('assistant.model', id)
}

export function setEffort(effort: Effort): void {
  set({ effort })
  void persist('assistant.effort', effort)
}

/** Web search and fetch; a conversation keeps what it started with (ADR-0087). */
export function setWebTools(on: boolean): void {
  set({ webTools: on })
  void persist('assistant.webTools', on)
}

/** Hands the key to the Keychain; only whether that worked comes back. */
export async function saveKey(value: string): Promise<void> {
  try {
    const saved = await setKey(value)
    set({
      hasKey: saved ? true : get().hasKey,
      keyMessage: saved ? 'Saved in the Keychain.' : 'The key was not saved.'
    })
  } catch {
    set({ keyMessage: 'The key can be saved from the app window only.' })
  }
}

export async function removeKey(): Promise<void> {
  try {
    const cleared = await clearKey()
    set({
      hasKey: cleared ? false : get().hasKey,
      keyMessage: cleared ? 'Removed from the Keychain.' : 'The key was not removed.'
    })
  } catch {
    set({ keyMessage: 'The key can be removed from the app window only.' })
  }
}

// The review strip lasts while the turn is the latest change: Undo all, an undo, or the next
// edit by hand ends it (the next edit keeps the turn).
circuit.subscribe(() => {
  const review = get().review
  if (review && circuit.lastTurnId !== review.turnId) clearReview()
})

// Another project is another conversation; a first save takes the transcript along.
useProject.subscribe((now, before) => {
  if (now.id === before.id) return
  if (before.id === null && now.id !== null) void saveTranscript()
  else newConversation()
})
