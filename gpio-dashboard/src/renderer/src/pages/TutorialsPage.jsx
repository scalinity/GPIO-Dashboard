import { useMemo, useState } from 'react'
import { BookOpen, Check } from 'lucide-react'
import TUTORIALS, { CATEGORIES, DIFFICULTIES } from '../data/tutorials'
import useTutorialStore from '../store/tutorialStore'
import TutorialCard from '../components/TutorialCard'
import TutorialDetail from '../components/TutorialDetail'

const ALL_CATEGORIES = ['all', ...Object.keys(CATEGORIES)]
const ALL_DIFFICULTIES = Object.keys(DIFFICULTIES)

export default function TutorialsPage() {
  const selectedTutorialId = useTutorialStore((s) => s.selectedTutorialId)
  const completedTutorials = useTutorialStore((s) => s.completedTutorials)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [difficultyFilter, setDifficultyFilter] = useState(null)

  const selectedTutorial = useMemo(
    () => TUTORIALS.find((t) => t.id === selectedTutorialId),
    [selectedTutorialId]
  )

  const filtered = useMemo(() => {
    return TUTORIALS.filter((t) => {
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
      if (difficultyFilter && t.difficulty !== difficultyFilter) return false
      return true
    })
  }, [categoryFilter, difficultyFilter])

  if (selectedTutorial) {
    return <TutorialDetail tutorial={selectedTutorial} />
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-white/[0.04] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-accent-light" />
            <h2 className="text-lg font-semibold text-gray-100">Tutorials</h2>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400">
            <Check className="w-3.5 h-3.5" />
            {completedTutorials.length} / {TUTORIALS.length}
          </span>
        </div>

        {/* Category filter tabs */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {ALL_CATEGORIES.map((cat) => {
            const isActive = categoryFilter === cat
            const label = cat === 'all' ? 'All' : CATEGORIES[cat].label
            const color = cat === 'all' ? null : CATEGORIES[cat].color
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                  isActive
                    ? 'text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.06]'
                }`}
                style={
                  isActive
                    ? { backgroundColor: color ? color + '30' : '#374151', color: color || '#E5E7EB' }
                    : undefined
                }
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Difficulty filter pills */}
        <div className="flex items-center gap-2">
          {ALL_DIFFICULTIES.map((diff) => {
            const isActive = difficultyFilter === diff
            const d = DIFFICULTIES[diff]
            return (
              <button
                key={diff}
                onClick={() => setDifficultyFilter(isActive ? null : diff)}
                className={`px-3 py-1 text-xs rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                  isActive ? 'ring-1' : 'opacity-60 hover:opacity-100'
                }`}
                style={{
                  backgroundColor: d.color + '20',
                  color: d.color,
                  '--tw-ring-color': d.color
                }}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tutorial grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            No tutorials match the selected filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((tutorial) => (
              <TutorialCard key={tutorial.id} tutorial={tutorial} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
