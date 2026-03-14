import { Check, Zap, Lightbulb, Eye, Wrench, Code, List } from 'lucide-react'
import { CATEGORIES, DIFFICULTIES } from '../data/tutorials'
import useTutorialStore from '../store/tutorialStore'

const CATEGORY_ICONS = {
  output: Zap,
  input: Wrench,
  display: Eye,
  sensor: Lightbulb,
  motor: Code,
  advanced: List
}

export default function TutorialCard({ tutorial }) {
  const completedTutorials = useTutorialStore((s) => s.completedTutorials)
  const selectTutorial = useTutorialStore((s) => s.selectTutorial)

  const category = CATEGORIES[tutorial.category]
  const difficulty = DIFFICULTIES[tutorial.difficulty]
  const isCompleted = completedTutorials.includes(tutorial.id)
  const Icon = CATEGORY_ICONS[tutorial.category] || Zap

  return (
    <button
      onClick={() => selectTutorial(tutorial.id, tutorial.pythonCode)}
      className="card text-left group relative cursor-pointer hover:scale-[1.015] transition-all duration-200"
    >
      {isCompleted && (
        <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Check className="w-4 h-4 text-emerald-400" />
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: category.color + '20' }}
        >
          <Icon className="w-4 h-4" style={{ color: category.color }} />
        </div>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: category.color + '20', color: category.color }}
        >
          {category.label}
        </span>
      </div>

      <h3 className="text-[13px] font-semibold text-gray-100 mb-1 leading-tight group-hover:text-white">
        {tutorial.title}
      </h3>

      <p className="text-xs text-gray-500 mb-3 line-clamp-2">{tutorial.description}</p>

      <div className="flex items-center gap-2">
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{ backgroundColor: difficulty.color + '20', color: difficulty.color }}
        >
          {difficulty.label}
        </span>
        <span className="text-xs text-gray-600">
          {tutorial.components.length} component{tutorial.components.length !== 1 ? 's' : ''}
        </span>
      </div>
    </button>
  )
}
