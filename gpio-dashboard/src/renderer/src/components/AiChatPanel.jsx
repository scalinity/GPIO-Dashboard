import { useState, useEffect } from 'react'
import { Sparkles, ChevronDown, ChevronUp, Send, X, KeyRound } from 'lucide-react'
import useTutorialStore from '../store/tutorialStore'

const MODELS = [
  { id: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
  { id: 'openai/gpt-5.4', label: 'GPT-5.4' },
  { id: 'minimax/minimax-m2.5', label: 'MiniMax M2.5' },
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { id: 'x-ai/grok-4.20-multi-agent-beta', label: 'Grok 4.20' }
]

const THINKING_LEVELS = ['off', 'low', 'medium', 'high']

export default function AiChatPanel({ tutorial }) {
  const aiPanelOpen = useTutorialStore((s) => s.aiPanelOpen)
  const toggleAiPanel = useTutorialStore((s) => s.toggleAiPanel)
  const aiGenerating = useTutorialStore((s) => s.aiGenerating)
  const aiModel = useTutorialStore((s) => s.aiModel)
  const aiThinkingLevel = useTutorialStore((s) => s.aiThinkingLevel)
  const aiError = useTutorialStore((s) => s.aiError)
  const editorCode = useTutorialStore((s) => s.editorCode)
  const executionStatus = useTutorialStore((s) => s.executionStatus)
  const setAiModel = useTutorialStore((s) => s.setAiModel)
  const setAiThinkingLevel = useTutorialStore((s) => s.setAiThinkingLevel)
  const startAiGeneration = useTutorialStore((s) => s.startAiGeneration)
  const handleAiError = useTutorialStore((s) => s.handleAiError)

  const [prompt, setPrompt] = useState('')
  const [hasApiKey, setHasApiKey] = useState(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showKeyInput, setShowKeyInput] = useState(false)

  useEffect(() => {
    const result = window.api?.ai?.hasApiKey()
    if (result && typeof result.then === 'function') {
      result
        .then((res) => setHasApiKey(res?.hasKey ?? false))
        .catch(() => setHasApiKey(false))
    } else {
      setHasApiKey(false)
    }
  }, [])

  const isRunning = executionStatus === 'running' || executionStatus === 'deploying'
  const canSend = prompt.trim() && !aiGenerating && !isRunning && hasApiKey

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return
    try {
      const result = await window.api?.ai?.setApiKey(apiKeyInput.trim())
      if (result?.success) {
        setHasApiKey(true)
        setApiKeyInput('')
        setShowKeyInput(false)
      } else {
        handleAiError(result?.error || 'Failed to save API key')
      }
    } catch (err) {
      handleAiError(err.message || 'Failed to save API key')
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!canSend) return

    startAiGeneration()
    try {
      window.api?.ai?.generate({
        prompt: prompt.trim(),
        tutorialContext: {
          title: tutorial.title,
          description: tutorial.description,
          category: tutorial.category,
          difficulty: tutorial.difficulty,
          components: tutorial.components,
          wiring: tutorial.wiring,
          theory: tutorial.theory,
          currentCode: editorCode
        },
        model: aiModel,
        thinkingLevel: aiThinkingLevel
      })
    } catch (err) {
      handleAiError(err.message || 'Failed to start generation')
    }
    setPrompt('')
  }

  const handleAbort = () => {
    window.api?.ai?.abort()?.catch(() => {})
  }

  const dismissError = () => {
    useTutorialStore.getState().handleAiError(null)
  }

  return (
    <div className="mt-3">
      {/* Toggle bar */}
      <button
        onClick={toggleAiPanel}
        aria-expanded={aiPanelOpen}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-card bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] transition-colors text-sm"
      >
        <Sparkles className="w-3.5 h-3.5 text-accent-light" />
        <span className="text-gray-300 font-medium">AI Assistant</span>
        <span className="ml-auto text-gray-500">
          {aiPanelOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>

      {aiPanelOpen && (
        <div className="mt-2 rounded-card bg-white/[0.02] border border-white/[0.06] p-3 space-y-3">
          {/* Loading state */}
          {hasApiKey === null && (
            <p className="text-[11px] text-gray-500">Loading...</p>
          )}

          {/* No API key state */}
          {hasApiKey === false && !showKeyInput ? (
            <div className="space-y-2">
              <button
                onClick={() => setShowKeyInput(true)}
                className="btn-primary text-xs px-3 py-1.5"
              >
                Set API Key
              </button>
              <p className="text-[11px] text-gray-500">
                Requires an{' '}
                <a
                  href="https://openrouter.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-light hover:underline"
                >
                  OpenRouter
                </a>{' '}
                API key
              </p>
            </div>
          ) : showKeyInput || hasApiKey === false ? (
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                placeholder="sk-or-..."
                className="input-field flex-1 text-xs"
              />
              <button onClick={handleSaveKey} className="btn-primary text-xs px-3 py-1.5">
                Save
              </button>
              {hasApiKey && (
                <button onClick={() => setShowKeyInput(false)} className="btn-ghost text-xs px-2">
                  Cancel
                </button>
              )}
            </div>
          ) : null}

          {/* Settings row - only when key is set */}
          {hasApiKey && !showKeyInput && (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="input-field text-xs py-1 pr-6 min-w-0"
                  aria-label="AI Model"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-1" role="group" aria-label="Thinking level">
                  {THINKING_LEVELS.map((level) => (
                    <button
                      key={level}
                      onClick={() => setAiThinkingLevel(level)}
                      aria-pressed={aiThinkingLevel === level}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                        aiThinkingLevel === level
                          ? 'bg-accent text-white'
                          : 'bg-white/[0.04] text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setShowKeyInput(true)}
                  className="ml-auto p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] transition-colors"
                  title="Change API Key"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Error banner */}
              {aiError && (
                <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-card px-3 py-2" role="alert">
                  <span className="flex-1">{typeof aiError === 'string' ? aiError.slice(0, 300) : 'An error occurred'}</span>
                  <button onClick={dismissError} className="shrink-0 p-0.5 hover:text-red-300">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Prompt input */}
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe what code you want..."
                  disabled={aiGenerating}
                  className="input-field flex-1 text-xs"
                  aria-label="AI prompt"
                />
                {aiGenerating ? (
                  <button
                    type="button"
                    onClick={handleAbort}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-btn bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!canSend}
                    className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1"
                  >
                    <Send className="w-3 h-3" />
                    Send
                  </button>
                )}
              </form>
            </>
          )}
        </div>
      )}
    </div>
  )
}
