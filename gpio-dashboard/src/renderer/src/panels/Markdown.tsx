// The Markdown subset tutorial theory uses (## and ### headings, paragraphs, - lists, **bold**,
// *italic*, `code`), rendered to elements. Theory is this app's own content; nothing is injected
// as HTML.
import type { ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((piece, i) => {
    if (piece.startsWith('**'))
      return (
        <strong key={i} className="font-semibold text-gray-100">
          {piece.slice(2, -2)}
        </strong>
      )
    if (piece.startsWith('*') && piece.length > 1) return <em key={i}>{piece.slice(1, -1)}</em>
    if (piece.startsWith('`')) {
      return (
        <code
          key={i}
          className="rounded-[5px] bg-white/[0.07] px-1 font-mono text-[0.92em] text-accent"
        >
          {piece.slice(1, -1)}
        </code>
      )
    }
    return piece
  })
}

export default function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/)
  return (
    <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
      {blocks.map((block, i) => {
        const lines = block.split('\n')
        if (block.startsWith('### ')) {
          return (
            <h4 key={i} className="text-sm font-semibold text-gray-200">
              {inline(block.slice(4))}
            </h4>
          )
        }
        if (block.startsWith('## ')) {
          return (
            <h3 key={i} className="text-base font-semibold text-gray-100 pt-2">
              {inline(block.slice(3))}
            </h3>
          )
        }
        if (lines.every((l) => /^\s*- |^\s{2,}\S/.test(l))) {
          // A list item continues onto indented lines.
          const items = block.split(/\n(?=\s*- )/).map((item) => item.replace(/^\s*- /, ''))
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {items.map((item, j) => (
                <li key={j}>{inline(item.replace(/\s*\n\s*/g, ' '))}</li>
              ))}
            </ul>
          )
        }
        return <p key={i}>{inline(block.replace(/\s*\n\s*/g, ' '))}</p>
      })}
    </div>
  )
}
