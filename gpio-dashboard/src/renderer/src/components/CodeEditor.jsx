import { useRef, useEffect } from 'react'
import { EditorView, lineNumbers } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import useTutorialStore from '../store/tutorialStore'
import { useRun } from '../state/runStore'

// The palette's colours (styles/palette.cjs), through the CSS variables it sets on :root.
const customTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface-900)', height: '100%' },
  '.cm-gutters': { backgroundColor: 'var(--ink)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-900)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--cyan) 3%, transparent)' },
  '.cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--cyan) 14%, transparent) !important'
  },
  '.cm-cursor': { borderLeftColor: 'var(--cyan)' }
})

export default function CodeEditor({ code, originalCode }) {
  const containerRef = useRef(null)
  const viewRef = useRef(null)
  const compartmentRef = useRef(new Compartment())
  const externalUpdateRef = useRef(false)
  const setEditorCode = useTutorialStore((s) => s.setEditorCode)
  const resetCode = useTutorialStore((s) => s.resetCode)
  const isCodeModified = useTutorialStore((s) => s.isCodeModified)
  const executionStatus = useRun((s) => s.status)

  const readOnly = executionStatus === 'running' || executionStatus === 'deploying'

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: code || '',
      extensions: [
        basicSetup,
        lineNumbers(),
        python(),
        oneDark,
        customTheme,
        compartmentRef.current.of(EditorView.editable.of(!readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !externalUpdateRef.current) {
            setEditorCode(update.state.doc.toString())
          }
        })
      ]
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync code prop changes (e.g. AI streaming, reset)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== code) {
      externalUpdateRef.current = true
      view.dispatch({
        changes: { from: 0, to: current.length, insert: code || '' },
        selection: { anchor: Math.min(view.state.selection.main.anchor, (code || '').length) }
      })
      externalUpdateRef.current = false
    }
  }, [code])

  // Sync readOnly
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: compartmentRef.current.reconfigure(EditorView.editable.of(!readOnly))
    })
  }, [readOnly])

  return (
    <div className="flex flex-col gap-2">
      {isCodeModified && (
        <div className="flex justify-end">
          <button onClick={() => resetCode(originalCode)} className="btn-ghost text-xs">
            Reset Code
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        className="rounded-btn overflow-hidden border border-white/[0.04] h-80"
      />
    </div>
  )
}
