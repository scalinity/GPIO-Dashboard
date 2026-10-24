// The Claude tab (SPEC 11.8, 12): the chat with streamed text, a chip per tool call with a compact
// card for its result, Claude's questions, a composer with a visible Stop while a turn runs, and a
// quiet footer with the turn's tokens and cost. Settings open beside the chat.
import {
  Check,
  Globe,
  Loader2,
  MessageSquarePlus,
  SendHorizontal,
  Settings2,
  Square,
  X
} from 'lucide-react'
import { useRef } from 'react'
import { MODELS } from '../assistant/client'
import {
  type ChatItem,
  loadSettings,
  newConversation,
  send,
  setDraft,
  stop,
  useAssistant
} from '../state/assistantStore'
import AssistantSettings from './AssistantSettings'
import Markdown from './Markdown'
import ToolCard from './ToolCards'

const onMount = (el: HTMLElement | null) => {
  if (el) void loadSettings()
}

const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
const dollars = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)

function Chip({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const Icon =
    item.status === 'done' ? Check : item.status === 'failed' ? X : item.server ? Globe : Loader2
  const tone =
    item.status === 'done'
      ? 'text-emerald-400'
      : item.status === 'failed'
        ? 'text-red-400'
        : 'text-accent-light'
  const spinning = item.status === 'streaming' || item.status === 'running'
  return (
    <div>
      <div
        data-testid="tool-chip"
        data-tool={item.name}
        data-status={item.status}
        className="inline-flex items-center gap-1.5 rounded-pill bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 text-xs text-gray-300"
      >
        <Icon className={`w-3.5 h-3.5 ${tone} ${spinning && !item.server ? 'animate-spin' : ''}`} />
        {item.label}
      </div>
      <ToolCard tool={item} />
    </div>
  )
}

function Question({ item }: { item: Extract<ChatItem, { kind: 'question' }> }) {
  return (
    <div
      role="group"
      aria-label="Claude asks"
      className="rounded-btn border border-accent/30 bg-accent/[0.06] px-3 py-2 text-sm"
    >
      <p className="text-gray-100">{item.question}</p>
      {item.answer === null ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.options.map((option) => (
            <button
              key={option}
              className="btn-secondary px-2.5 py-1 text-xs"
              onClick={() => void send(option)}
            >
              {option}
            </button>
          ))}
          <span className="self-center text-[11px] text-gray-500">or answer below</span>
        </div>
      ) : (
        <p className="mt-1 text-xs text-gray-400">You: {item.answer}</p>
      )}
    </div>
  )
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="flex justify-end">
          <p className="max-w-[80%] whitespace-pre-wrap rounded-btn bg-accent/15 px-3 py-1.5 text-sm text-gray-100">
            {item.text}
          </p>
        </div>
      )
    case 'text':
      return <Markdown text={item.text} />
    case 'tool':
      return <Chip item={item} />
    case 'question':
      return <Question item={item} />
    case 'notice':
      return <p className="text-xs text-amber-300">{item.text}</p>
    case 'error':
      return (
        <p role="alert" className="text-xs text-red-400">
          {item.text}
        </p>
      )
  }
}

function Footer() {
  const model = useAssistant((s) => s.model)
  const effort = useAssistant((s) => s.effort)
  const usage = useAssistant((s) => s.lastUsage)
  const total = useAssistant((s) => s.totalCost)
  const name = MODELS.find((m) => m.id === model)?.label ?? model
  return (
    <p data-testid="assistant-usage" className="truncate text-[11px] text-gray-500">
      {name} · {effort}
      {usage && (
        <>
          {' · last turn '}
          {tokens(usage.inputTokens + usage.cacheWriteTokens)} in · {tokens(usage.cacheReadTokens)}{' '}
          cached · {tokens(usage.outputTokens)} out
          {usage.webSearches ? ` · ${usage.webSearches} searches` : ''} ·{' '}
          {usage.costUsd === null ? 'no price for this model' : dollars(usage.costUsd)}
          {total !== null && ` · conversation ${dollars(total)}`}
        </>
      )}
    </p>
  )
}

function Composer() {
  const draft = useAssistant((s) => s.draft)
  const draftKey = useAssistant((s) => s.draftKey)
  const running = useAssistant((s) => s.running)
  const asking = useAssistant((s) =>
    s.items.some((i) => i.kind === 'question' && i.answer === null)
  )
  const submit = () => void send(useAssistant.getState().draft)
  return (
    <div className="flex items-end gap-2">
      <textarea
        key={draftKey}
        autoFocus={draftKey > 0}
        aria-label="Message Claude"
        rows={2}
        className="input-field resize-none py-1.5"
        placeholder={
          asking
            ? 'Answer Claude…'
            : running
              ? 'Claude is working…'
              : 'Ask Claude to build, check or explain'
        }
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      {running && !asking ? (
        <button className="btn-danger flex items-center gap-1.5 py-1.5" onClick={stop}>
          <Square className="w-4 h-4" /> Stop
        </button>
      ) : (
        <button
          className="btn-primary flex items-center gap-1.5 py-1.5"
          disabled={!draft.trim()}
          onClick={submit}
        >
          <SendHorizontal className="w-4 h-4" /> Send
        </button>
      )}
    </div>
  )
}

export default function ClaudePanel() {
  const items = useAssistant((s) => s.items)
  const running = useAssistant((s) => s.running)
  const thinking = useAssistant((s) => s.thinking)
  const settingsOpen = useAssistant((s) => s.settingsOpen)
  // Keeps the newest message in view while the reader is at the bottom.
  const pinned = useRef(true)
  const follow = (el: HTMLDivElement | null) => {
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }
  return (
    <div ref={onMount} className="flex h-full gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="section-title">Claude</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              className="btn-ghost flex items-center gap-1 px-2 py-1 text-xs"
              disabled={running}
              onClick={newConversation}
            >
              <MessageSquarePlus className="w-3.5 h-3.5" /> New conversation
            </button>
            <button
              className={`btn-ghost flex items-center gap-1 px-2 py-1 text-xs ${settingsOpen ? 'text-gray-100 bg-white/[0.06]' : ''}`}
              aria-pressed={settingsOpen}
              onClick={() => useAssistant.setState({ settingsOpen: !settingsOpen })}
            >
              <Settings2 className="w-3.5 h-3.5" /> Settings
            </button>
          </div>
        </div>
        <div
          ref={follow}
          role="log"
          aria-label="Conversation"
          className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
          onScroll={(e) => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
        >
          {items.length === 0 && (
            <p className="text-sm text-gray-500">
              Ask for a circuit (“blink an LED on GPIO17”), a check, or an explanation. Claude
              builds on the bench as you watch; every change it makes is one undo.
            </p>
          )}
          {items.map((item) => (
            <Item key={item.id} item={item} />
          ))}
          {running && thinking && (
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
            </p>
          )}
        </div>
        <Composer />
        <Footer />
      </div>
      {settingsOpen && (
        <div className="w-72 shrink-0 overflow-y-auto border-l border-white/[0.04] pl-4">
          <AssistantSettings />
        </div>
      )}
    </div>
  )
}
