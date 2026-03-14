import {
  ChevronLeft,
  BookOpen,
  List,
  Lightbulb,
  Wrench,
  Code,
  Play,
  Square,
  Check,
  Eye
} from 'lucide-react'
import useTutorialStore from '../store/tutorialStore'
import useUiStore from '../store/uiStore'
import CodeEditor from './CodeEditor'

const STEPS = [
  { label: 'Introduction', icon: BookOpen },
  { label: 'Components', icon: List },
  { label: 'Theory', icon: Lightbulb },
  { label: 'Wiring', icon: Wrench },
  { label: 'Code', icon: Code },
  { label: 'Run', icon: Play },
  { label: 'Tips', icon: Lightbulb }
]

export default function TutorialDetail({ tutorial }) {
  const activeStep = useTutorialStore((s) => s.activeStep)
  const setActiveStep = useTutorialStore((s) => s.setActiveStep)
  const clearTutorial = useTutorialStore((s) => s.clearTutorial)
  const editorCode = useTutorialStore((s) => s.editorCode)
  const executionStatus = useTutorialStore((s) => s.executionStatus)
  const executionOutput = useTutorialStore((s) => s.executionOutput)
  const deployAndRun = useTutorialStore((s) => s.deployAndRun)
  const stopExecution = useTutorialStore((s) => s.stopExecution)
  const markCompleted = useTutorialStore((s) => s.markCompleted)
  const completedTutorials = useTutorialStore((s) => s.completedTutorials)
  const showWiring = useTutorialStore((s) => s.showWiring)
  const setActiveTab = useUiStore((s) => s.setActiveTab)

  const isCompleted = completedTutorials.includes(tutorial.id)
  const isRunning = executionStatus === 'running' || executionStatus === 'deploying'

  const handleViewBreadboard = () => {
    showWiring(tutorial.id)
    setActiveTab('breadboard')
  }

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-100 mb-3">Introduction</h3>
            <p className="text-gray-300 leading-relaxed">{tutorial.description}</p>
          </div>
        )
      case 1:
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-100 mb-3">Components Needed</h3>
            <ul className="space-y-2">
              {tutorial.components.map((c, i) => (
                <li key={i} className="flex items-center gap-3 text-gray-300">
                  <span className="w-2 h-2 rounded-full bg-accent-light shrink-0" />
                  <span>
                    {c.name}
                    {c.quantity > 1 && (
                      <span className="text-gray-500 ml-1">x{c.quantity}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      case 2:
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-100 mb-3">Theory</h3>
            <p className="text-gray-300 leading-relaxed">{tutorial.theory}</p>
          </div>
        )
      case 3:
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-100 mb-3">Wiring</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left py-2 pr-4 section-title">From</th>
                    <th className="text-left py-2 pr-4 section-title">To</th>
                    <th className="text-left py-2 section-title">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {tutorial.wiring.map((w, i) => (
                    <tr key={i} className="border-b border-white/[0.04]">
                      <td className="py-2 pr-4 text-gray-200 font-mono text-xs">{w.from}</td>
                      <td className="py-2 pr-4 text-gray-200 font-mono text-xs">{w.to}</td>
                      <td className="py-2 text-gray-400">{w.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={handleViewBreadboard}
              className="mt-4 flex items-center gap-2 btn-secondary"
            >
              <Eye className="w-4 h-4" />
              View on Breadboard
            </button>
          </div>
        )
      case 4:
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-100 mb-3">Code</h3>
            <CodeEditor code={editorCode} originalCode={tutorial.pythonCode} />
          </div>
        )
      case 5:
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-100 mb-3">Run</h3>
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={deployAndRun}
                disabled={isRunning}
                className="flex items-center gap-2 btn-success"
              >
                <Play className="w-4 h-4" />
                Deploy & Run
              </button>
              {isRunning && (
                <button
                  onClick={stopExecution}
                  className="flex items-center gap-2 btn-danger"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </button>
              )}
              <StatusIndicator status={executionStatus} />
            </div>
            <div className="bg-surface-950 border border-white/[0.04] rounded-btn p-3 h-48 overflow-y-auto font-mono text-xs">
              {executionOutput.length === 0 ? (
                <span className="text-gray-600">Output will appear here...</span>
              ) : (
                executionOutput.map((line, i) => (
                  <div
                    key={i}
                    className={line.stream === 'stderr' ? 'text-red-400' : 'text-gray-300'}
                  >
                    {line.data}
                  </div>
                ))
              )}
            </div>
            {executionStatus === 'completed' && !isCompleted && (
              <button
                onClick={() => markCompleted(tutorial.id)}
                className="mt-4 flex items-center gap-2 px-4 py-2 rounded-btn bg-emerald-500/10 text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
              >
                <Check className="w-4 h-4" />
                Mark Complete
              </button>
            )}
          </div>
        )
      case 6:
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-100 mb-3">Tips</h3>
            <ul className="space-y-3">
              {tutorial.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-3 text-gray-300">
                  <Lightbulb className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.04]">
        <button
          onClick={clearTutorial}
          className="btn-ghost flex items-center gap-1"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <h2 className="text-lg font-semibold text-gray-100">{tutorial.title}</h2>
        {isCompleted && (
          <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
            <Check className="w-3 h-3" />
            Completed
          </span>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Stepper sidebar */}
        <div className="w-14 shrink-0 flex flex-col items-center py-6 border-r border-white/[0.04] glass-bg">
          {STEPS.map((step, i) => {
            const StepIcon = step.icon
            const isActive = i === activeStep
            const isPast = i < activeStep
            return (
              <div key={i} className="flex flex-col items-center">
                {i > 0 && (
                  <div
                    className={`w-px h-6 ${isPast ? 'bg-accent' : 'bg-white/[0.06]'}`}
                  />
                )}
                <button
                  onClick={() => setActiveStep(i)}
                  aria-label={step.label}
                  aria-current={isActive ? 'step' : undefined}
                  title={step.label}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                    isActive
                      ? 'bg-accent text-white ring-2 ring-accent/30'
                      : isPast
                        ? 'bg-accent/20 text-accent-light'
                        : 'bg-white/[0.04] text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {isPast ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <StepIcon className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6">{renderStepContent()}</div>
      </div>
    </div>
  )
}

function StatusIndicator({ status }) {
  const config = {
    idle: { text: 'Ready', className: 'text-gray-500' },
    deploying: { text: 'Deploying...', className: 'text-amber-400' },
    running: { text: 'Running...', className: 'text-emerald-400' },
    completed: { text: 'Completed', className: 'text-accent-light' },
    error: { text: 'Error', className: 'text-red-400' }
  }
  const c = config[status] || config.idle
  return (
    <span className={`text-xs font-medium flex items-center gap-1.5 ${c.className}`}>
      {(status === 'deploying' || status === 'running') && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      )}
      {c.text}
    </span>
  )
}
