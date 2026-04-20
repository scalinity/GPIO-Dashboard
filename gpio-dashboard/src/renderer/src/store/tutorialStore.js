import { create } from 'zustand'

const useTutorialStore = create((set, get) => ({
  selectedTutorialId: null,
  activeStep: 0,
  editorCode: '',
  isCodeModified: false,
  executionStatus: 'idle', // idle | deploying | running | completed | error
  executionOutput: [],
  completedTutorials: [],
  showWiringOverlay: false,
  overlayTutorialId: null,
  aiGenerating: false,
  aiStreamedCode: '',
  aiModel: 'anthropic/claude-opus-4.6',
  aiThinkingLevel: 'medium',
  aiError: null,
  aiPanelOpen: false,

  selectTutorial: (id, defaultCode) => {
    set({
      selectedTutorialId: id,
      activeStep: 0,
      editorCode: defaultCode || '',
      isCodeModified: false,
      executionStatus: 'idle',
      executionOutput: [],
      aiGenerating: false,
      aiStreamedCode: '',
      aiError: null,
      aiPanelOpen: false
    })
  },

  clearTutorial: () =>
    set({
      selectedTutorialId: null,
      activeStep: 0,
      editorCode: '',
      isCodeModified: false,
      executionStatus: 'idle',
      executionOutput: [],
      aiGenerating: false,
      aiStreamedCode: '',
      aiError: null,
      aiPanelOpen: false
    }),

  setActiveStep: (step) => set({ activeStep: step }),
  setEditorCode: (code) => set({ editorCode: code, isCodeModified: true }),
  resetCode: (defaultCode) => set({ editorCode: defaultCode, isCodeModified: false }),
  setExecutionStatus: (status) => set({ executionStatus: status }),

  addOutput: (line) =>
    set((state) => {
      const output = state.executionOutput
      if (output.length >= 1000) {
        return { executionOutput: [...output.slice(-500), line] }
      }
      return { executionOutput: [...output, line] }
    }),

  clearOutput: () => set({ executionOutput: [] }),

  markCompleted: (id) =>
    set((state) => {
      if (state.completedTutorials.includes(id)) return state
      const updated = [...state.completedTutorials, id]
      try {
        window.api.settings.set('ui.completedTutorials', updated)
      } catch {
        // ignore if settings not available
      }
      return { completedTutorials: updated }
    }),

  loadCompleted: async () => {
    try {
      const saved = await window.api.settings.get('ui.completedTutorials')
      if (Array.isArray(saved)) set({ completedTutorials: saved })
    } catch {
      // ignore
    }
  },

  setAiModel: (model) => {
    set({ aiModel: model })
    try { window.api.settings.set('ai.model', model) } catch {}
  },

  setAiThinkingLevel: (level) => {
    set({ aiThinkingLevel: level })
    try { window.api.settings.set('ai.thinkingLevel', level) } catch {}
  },

  toggleAiPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),

  startAiGeneration: () => set({ aiGenerating: true, aiStreamedCode: '', aiError: null }),

  appendAiChunk: (content) =>
    set((state) => {
      const newCode = state.aiStreamedCode + content
      return { aiStreamedCode: newCode, editorCode: newCode, isCodeModified: true }
    }),

  finishAiGeneration: () => set({ aiGenerating: false }),

  handleAiError: (error) => set({ aiGenerating: false, aiError: error }),

  loadAiSettings: async () => {
    try {
      const [model, thinkingLevel] = await Promise.all([
        window.api.settings.get('ai.model'),
        window.api.settings.get('ai.thinkingLevel')
      ])
      const updates = {}
      if (model) updates.aiModel = model
      if (thinkingLevel) updates.aiThinkingLevel = thinkingLevel
      if (Object.keys(updates).length) set(updates)
    } catch {}
  },

  showWiring: (tutorialId) =>
    set({
      showWiringOverlay: true,
      overlayTutorialId: tutorialId
    }),

  hideWiring: () =>
    set({
      showWiringOverlay: false,
      overlayTutorialId: null
    }),

  deployAndRun: async () => {
    const { editorCode, selectedTutorialId } = get()
    if (!editorCode || !selectedTutorialId) return

    set({ executionStatus: 'deploying', executionOutput: [] })
    try {
      const filename = `tutorial_${selectedTutorialId}.py`
      const upload = await window.api.ssh.scpBuffer(editorCode, `/tmp/gpio_dashboard/${filename}`)
      if (!upload?.success) {
        get().addOutput({ stream: 'stderr', data: upload?.error || 'Failed to upload script' })
        set({ executionStatus: 'error' })
        return
      }
      set({ executionStatus: 'running' })
      // Output streams in real-time via tutorial:output IPC events
      const result = await window.api.ssh.runTutorialScript(filename)
      if (result?.error) {
        get().addOutput({ stream: 'stderr', data: result.error })
        set({ executionStatus: 'error' })
        return
      }
      set({ executionStatus: 'completed' })
    } catch (err) {
      set({ executionStatus: 'error' })
      get().addOutput({ stream: 'stderr', data: err.message || String(err) })
    }
  },

  stopExecution: async () => {
    try {
      const tutorialId = get().selectedTutorialId
      if (tutorialId) {
        await window.api.ssh.killProcess(`tutorial_${tutorialId}.py`)
      }
    } catch {
      // ignore
    }
    set({ executionStatus: 'completed' })
  }
}))

export default useTutorialStore
