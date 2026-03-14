import { useRef, useEffect } from 'react'
import { EditorView, lineNumbers } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import useTutorialStore from '../store/tutorialStore'

const customTheme = EditorView.theme({
  '&': { backgroundColor: '#0A0F1A', height: '100%' },           // surface-900
  '.cm-gutters': { backgroundColor: '#050A14', border: 'none' },  // surface-950
  '.cm-activeLineGutter': { backgroundColor: '#0A0F1A' },         // surface-900
  '.cm-activeLine': { backgroundColor: '#6366F108' },              // accent/3
  '.cm-selectionBackground': { backgroundColor: '#6366F120 !important' }, // accent/12
  '.cm-cursor': { borderLeftColor: '#6366F1' }                     // accent
})

export default function CodeEditor({ code, originalCode }) {
  const containerRef = useRef(null)
  const viewRef = useRef(null)
  const compartmentRef = useRef(new Compartment())
  const externalUpdateRef = useRef(false)
  const setEditorCode = useTutorialStore((s) => s.setEditorCode)
  const resetCode = useTutorialStore((s) => s.resetCode)
  const isCodeModified = useTutorialStore((s) => s.isCodeModified)
  const executionStatus = useTutorialStore((s) => s.executionStatus)

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
          <button
            onClick={() => resetCode(originalCode)}
            className="btn-ghost text-xs"
          >
            Reset Code
          </button>
        </div>
      )}
      <div ref={containerRef} className="rounded-btn overflow-hidden border border-white/[0.04] h-80" />
    </div>
  )
}
