// A Python editor for the Workbench. The view is made and destroyed through a stable callback ref,
// so it needs no effect hook (ADR-0006). The parent remounts it (key) to load other code or to
// switch it read-only. `onChange` must be stable (a store action): the editor keeps the first one.
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, basicSetup } from 'codemirror'
import { useCallback } from 'react'

export default function CodeEditor({
  initial,
  onChange,
  readOnly
}: {
  initial: string
  onChange: (source: string) => void
  readOnly: boolean
}) {
  const mount = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      const view = new EditorView({
        doc: initial,
        parent: el,
        extensions: [
          basicSetup,
          python(),
          oneDark,
          EditorView.editable.of(!readOnly),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString())
          })
        ]
      })
      return () => view.destroy()
    },
    // Mount once; the parent's key decides when to start again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  return <div ref={mount} className="h-full overflow-auto text-sm" />
}
