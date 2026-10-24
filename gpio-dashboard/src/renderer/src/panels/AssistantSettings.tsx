// The assistant's settings (SPEC 12.2): the API key, which goes to the Keychain and never comes
// back (only whether one is saved), the model, the effort, and the web tools.
import { KeyRound } from 'lucide-react'
import { useRef, useState } from 'react'
import { MODELS, type Effort } from '../assistant/client'
import {
  EFFORTS,
  removeKey,
  saveKey,
  setEffort,
  setModel,
  setWebTools,
  useAssistant
} from '../state/assistantStore'

const OTHER = '__other__'
const label = 'block text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1'
const select = 'w-full bg-surface-950 border border-white/[0.06] rounded-btn px-2 py-1.5 text-sm'

function KeyField() {
  const has = useAssistant((s) => s.hasKey)
  const message = useAssistant((s) => s.keyMessage)
  // The key is read from the field once, on Save, and the field is cleared at once: it is never
  // kept in state.
  const field = useRef<HTMLInputElement>(null)
  const submit = () => {
    const input = field.current
    if (!input?.value.trim()) return
    const value = input.value
    input.value = ''
    void saveKey(value)
  }
  return (
    <div>
      <span className={label}>Anthropic API key</span>
      <p
        data-testid="key-status"
        className={`flex items-center gap-1.5 text-xs mb-1.5 ${has ? 'text-emerald-400' : 'text-amber-300'}`}
      >
        <KeyRound className="w-3.5 h-3.5" />
        {has === null
          ? 'Not checked'
          : has
            ? 'A key is saved in the macOS Keychain'
            : 'No key saved'}
      </p>
      <div className="flex gap-1.5">
        <input
          ref={field}
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label="API key"
          placeholder={has ? 'Replace the key' : 'sk-ant-…'}
          className="input-field py-1.5"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="btn-secondary px-3 py-1.5" onClick={submit}>
          Save
        </button>
        {has && (
          <button className="btn-ghost px-2" onClick={() => void removeKey()}>
            Remove
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="mt-1 text-xs text-gray-400">
          {message}
        </p>
      )}
    </div>
  )
}

function ModelField() {
  const model = useAssistant((s) => s.model)
  const listed = MODELS.some((m) => m.id === model)
  const [picked, setOther] = useState(false)
  const other = picked || !listed
  return (
    <div>
      <label className={label} htmlFor="assistant-model">
        Model
      </label>
      <select
        id="assistant-model"
        className={select}
        value={other ? OTHER : model}
        onChange={(e) => {
          if (e.target.value === OTHER) setOther(true)
          else {
            setOther(false)
            setModel(e.target.value)
          }
        }}
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} ({m.use})
          </option>
        ))}
        <option value={OTHER}>Another model ID…</option>
      </select>
      {other && (
        <input
          key={model}
          aria-label="Model ID"
          className="input-field py-1.5 mt-1.5 font-mono text-xs"
          defaultValue={listed ? '' : model}
          placeholder="claude-…"
          onBlur={(e) => setModel(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      )}
    </div>
  )
}

export default function AssistantSettings() {
  const effort = useAssistant((s) => s.effort)
  const webTools = useAssistant((s) => s.webTools)
  const started = useAssistant((s) => s.conversationWebTools)
  const error = useAssistant((s) => s.settingsError)
  return (
    <section aria-label="Claude settings" className="space-y-3 text-sm text-gray-200">
      <KeyField />
      <ModelField />
      <div>
        <label className={label} htmlFor="assistant-effort">
          Effort
        </label>
        <select
          id="assistant-effort"
          className={select}
          value={effort}
          onChange={(e) => setEffort(e.target.value as Effort)}
        >
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-start gap-2 text-xs text-gray-300">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={webTools}
          onChange={(e) => setWebTools(e.target.checked)}
        />
        <span>
          Web search and fetch, for datasheets
          {started !== null && started !== webTools && (
            <span className="block text-gray-500">Applies from the next conversation.</span>
          )}
        </span>
      </label>
      {error && <p className="text-xs text-amber-300">{error}</p>}
    </section>
  )
}
