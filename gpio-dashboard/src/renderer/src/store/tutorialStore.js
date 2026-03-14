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

  selectTutorial: (id, defaultCode) => {
    set({
      selectedTutorialId: id,
      activeStep: 0,
      editorCode: defaultCode || '',
      isCodeModified: false,
      executionStatus: 'idle',
      executionOutput: []
    })
  },

  clearTutorial: () =>
    set({
      selectedTutorialId: null,
      activeStep: 0,
      editorCode: '',
      isCodeModified: false,
      executionStatus: 'idle',
      executionOutput: []
    }),

  setActiveStep: (step) => set({ activeStep: step }),
  setEditorCode: (code) => set({ editorCode: code, isCodeModified: true }),
  resetCode: (defaultCode) => set({ editorCode: defaultCode, isCodeModified: false }),
  setExecutionStatus: (status) => set({ executionStatus: status }),

  addOutput: (line) =>
    set((state) => ({
      executionOutput: [...state.executionOutput, line]
    })),

  clearOutput: () => set({ executionOutput: [] }),

  markCompleted: (id) =>
    set((state) => {
      if (state.completedTutorials.includes(id)) return state
      const updated = [...state.completedTutorials, id]
      try {
        window.api.settings.set('completedTutorials', updated)
      } catch {
        // ignore if settings not available
      }
      return { completedTutorials: updated }
    }),

  loadCompleted: async () => {
    try {
      const saved = await window.api.settings.get('completedTutorials')
      if (Array.isArray(saved)) set({ completedTutorials: saved })
    } catch {
      // ignore
    }
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
      await window.api.ssh.scpBuffer(editorCode, `/tmp/gpio_dashboard/${filename}`)
      set({ executionStatus: 'running' })
      await window.api.ssh.execute(`python3 /tmp/gpio_dashboard/${filename}`)
    } catch (err) {
      set({ executionStatus: 'error' })
      get().addOutput({ stream: 'stderr', data: err.message || String(err) })
    }
  },

  stopExecution: async () => {
    try {
      await window.api.agent.stop()
    } catch {
      // ignore
    }
    set({ executionStatus: 'completed' })
  }
}))

export default useTutorialStore
