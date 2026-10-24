import { create } from 'zustand'

const useTutorialStore = create((set) => ({
  selectedTutorialId: null,
  activeStep: 0,
  editorCode: '',
  isCodeModified: false,
  completedTutorials: [],

  selectTutorial: (id, defaultCode) => {
    set({
      selectedTutorialId: id,
      activeStep: 0,
      editorCode: defaultCode || '',
      isCodeModified: false
    })
  },

  clearTutorial: () =>
    set({
      selectedTutorialId: null,
      activeStep: 0,
      editorCode: '',
      isCodeModified: false
    }),

  setActiveStep: (step) => set({ activeStep: step }),
  setEditorCode: (code) => set({ editorCode: code, isCodeModified: true }),
  resetCode: (defaultCode) => set({ editorCode: defaultCode, isCodeModified: false }),

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
  }
}))

export default useTutorialStore
