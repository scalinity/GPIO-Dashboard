// The Part Library (SPEC 11.2): search, categories, an "In my inventory" filter and kit tags. A
// part is placed by dragging it onto the board (or the table, for an off-board module). "Create
// custom part…" hands off to Claude, which defines one from its datasheet.
import { Search, Sparkles } from 'lucide-react'
import { useState } from 'react'
import inventoryJson from '../content/inventory.json'
import { PART_DEFS } from '../core/defs/parts'
import type { PartCategory } from '../core/model/types'
import { openWithDraft } from '../state/assistantStore'
import type { StudioView } from '../studio/view'

const CUSTOM_PART_PROMPT = 'Define a custom part for this project from its datasheet. The part is: '

const INVENTORY = new Set(inventoryJson.kit.items.flatMap((item) => item.partId ?? []))

const CATEGORIES: PartCategory[] = [
  'passive',
  'led',
  'switch',
  'sensor',
  'semiconductor',
  'ic',
  'display',
  'actuator',
  'audio',
  'module',
  'power'
]

const DEFS = [...PART_DEFS.values()].sort((a, b) => a.name.localeCompare(b.name))

export default function PartLibrary({ view }: { view: StudioView }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PartCategory | null>(null)
  const [owned, setOwned] = useState(false)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = DEFS.filter(
    (def) =>
      (!category || def.category === category) &&
      (!owned || INVENTORY.has(def.id)) &&
      words.every((w) => `${def.name} ${def.id} ${def.category}`.toLowerCase().includes(w))
  )
  return (
    <aside
      aria-label="Part library"
      className="w-56 shrink-0 flex flex-col border-r border-white/[0.04] bg-surface-900/60 min-h-0"
    >
      <div className="p-3 space-y-2 border-b border-white/[0.04]">
        <label className="relative block">
          <Search className="absolute left-2 top-2 w-4 h-4 text-gray-500" />
          <input
            type="search"
            autoComplete="off"
            aria-label="Search parts"
            placeholder="Search parts"
            className="input-field pl-8 py-1.5 text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              className={`px-1.5 py-0.5 rounded text-[11px] ${category === c ? 'bg-on-bg text-on-text' : 'bg-white/[0.04] text-gray-400 hover:text-gray-200'}`}
              onClick={() => setCategory(category === c ? null : c)}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input type="checkbox" checked={owned} onChange={(e) => setOwned(e.target.checked)} />
          In my inventory
        </label>
        <button
          className="w-full flex items-center gap-1.5 rounded-btn px-2 py-1 text-xs text-accent-light hover:bg-white/[0.06]"
          onClick={() => openWithDraft(CUSTOM_PART_PROMPT)}
        >
          <Sparkles className="w-3.5 h-3.5" /> Create custom part…
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto p-2 space-y-1">
        {shown.map((def) => (
          <li key={def.id}>
            <button
              title="Drag onto the board"
              className="w-full text-left rounded-btn px-2 py-1.5 bg-white/[0.02] hover:bg-white/[0.06] cursor-grab select-none touch-none"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                view.place(def.id)
              }}
            >
              <span className="block text-sm text-gray-200">{def.name}</span>
              <span className="flex flex-wrap gap-1 mt-0.5">
                <span className="text-[10px] text-gray-500">{def.category}</span>
                {def.kitTags.map((tag) => (
                  <span
                    key={tag}
                    className={`text-[10px] px-1 rounded ${tag === 'kit' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}
                  >
                    {tag}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
