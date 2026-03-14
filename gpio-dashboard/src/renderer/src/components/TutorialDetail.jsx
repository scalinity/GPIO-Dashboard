import {
  ChevronLeft,
  ChevronRight,
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
import AiChatPanel from './AiChatPanel'

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
  const isFirstStep = activeStep === 0
  const isLastStep = activeStep === STEPS.length - 1

  const handleViewBreadboard = () => {
    showWiring(tutorial.id)
    setActiveTab('breadboard')
  }

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <div className="space-y-6">
            <div>
              <span className="inline-block text-[10px] font-bold tracking-widest uppercase text-accent-light/60 mb-2">
                {tutorial.category} &middot; {tutorial.difficulty}
              </span>
              <h3 className="text-2xl font-bold text-white mb-4">{tutorial.title}</h3>
              <p className="text-gray-300 leading-relaxed text-[15px]">{tutorial.description}</p>
            </div>
            <div className="bg-accent/[0.06] border border-accent/10 rounded-card p-4">
              <h4 className="text-xs font-semibold tracking-wider uppercase text-accent-light/70 mb-3">What you&apos;ll learn</h4>
              <ul className="space-y-2">
                {tutorial.tips.slice(0, 3).map((tip, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-gray-300">
                    <Check className="w-3.5 h-3.5 text-accent-light shrink-0 mt-0.5" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span className="flex items-center gap-1.5">
                <List className="w-3.5 h-3.5" />
                {tutorial.components.length} components
              </span>
              <span className="w-1 h-1 rounded-full bg-gray-600" />
              <span className="flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5" />
                {tutorial.pythonCode.split('\n').length} lines of code
              </span>
            </div>
          </div>
        )
      case 1:
        return (
          <div className="space-y-5">
            <h3 className="text-xl font-bold text-white">Components Needed</h3>
            <p className="text-gray-400 text-sm">Gather these parts before starting the wiring.</p>
            <div className="grid gap-3">
              {tutorial.components.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 bg-white/[0.02] border border-white/[0.06] rounded-card px-4 py-3"
                >
                  <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent-light text-sm font-bold shrink-0">
                    {c.quantity}x
                  </div>
                  <span className="text-gray-200 text-[15px]">{c.name}</span>
                </div>
              ))}
            </div>
          </div>
        )
      case 2:
        return (
          <div className="space-y-5">
            <h3 className="text-xl font-bold text-white">Theory</h3>
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-card p-5">
              <p className="text-gray-300 leading-relaxed text-[15px]">{tutorial.theory}</p>
            </div>
          </div>
        )
      case 3:
        return (
          <div className="space-y-5">
            <h3 className="text-xl font-bold text-white">Wiring</h3>
            <p className="text-gray-400 text-sm">Connect the components following this guide. Double check before powering on.</p>
            <div className="space-y-2">
              {tutorial.wiring.map((w, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 bg-white/[0.02] border border-white/[0.06] rounded-card px-4 py-3"
                >
                  <span className="text-xs font-bold text-accent-light bg-accent/10 rounded px-2 py-0.5 shrink-0 font-mono">
                    {w.from}
                  </span>
                  <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 rounded px-2 py-0.5 shrink-0 font-mono">
                    {w.to}
                  </span>
                  <span className="text-gray-400 text-sm ml-auto">{w.description}</span>
                </div>
              ))}
            </div>
            <button
              onClick={handleViewBreadboard}
              className="flex items-center gap-2 btn-secondary"
            >
              <Eye className="w-4 h-4" />
              View on Breadboard
            </button>
          </div>
        )
      case 4:
        return (
          <div className="space-y-4 h-full flex flex-col">
            <div>
              <h3 className="text-xl font-bold text-white mb-1">Code</h3>
              <p className="text-gray-400 text-sm">Review and edit the Python code before running it on your Pi.</p>
            </div>
            <div className="flex-1 min-h-0">
              <CodeEditor code={editorCode} originalCode={tutorial.pythonCode} />
            </div>
            <AiChatPanel tutorial={tutorial} />
          </div>
        )
      case 5:
        return (
          <div className="space-y-5">
            <h3 className="text-xl font-bold text-white">Run</h3>
            <div className="flex items-center gap-3">
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
            <div className="bg-surface-950 border border-white/[0.04] rounded-card p-4 h-56 overflow-y-auto font-mono text-xs">
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
                className="flex items-center gap-2 px-4 py-2 rounded-btn bg-emerald-500/10 text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
              >
                <Check className="w-4 h-4" />
                Mark Complete
              </button>
            )}
          </div>
        )
      case 6:
        return (
          <div className="space-y-5">
            <h3 className="text-xl font-bold text-white">Tips & Troubleshooting</h3>
            <div className="space-y-3">
              {tutorial.tips.map((tip, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 bg-yellow-500/[0.04] border border-yellow-500/10 rounded-card px-4 py-3"
                >
                  <Lightbulb className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                  <span className="text-gray-300 text-[15px]">{tip}</span>
                </div>
              ))}
            </div>
            {!isCompleted && (
              <button
                onClick={() => markCompleted(tutorial.id)}
                className="flex items-center gap-2 px-4 py-2 rounded-btn bg-emerald-500/10 text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
              >
                <Check className="w-4 h-4" />
                Mark Complete
              </button>
            )}
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.04]">
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
        <div className="w-14 shrink-0 flex flex-col items-center py-4 border-r border-white/[0.04] glass-bg">
          {STEPS.map((step, i) => {
            const StepIcon = step.icon
            const isActive = i === activeStep
            const isPast = i < activeStep
            return (
              <div key={i} className="flex flex-col items-center">
                {i > 0 && (
                  <div
                    className={`w-px h-5 ${isPast ? 'bg-accent' : 'bg-white/[0.06]'}`}
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

        {/* Content + navigation */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Step label bar */}
          <div className="px-8 pt-5 pb-0">
            {(() => {
              const CurrentIcon = STEPS[activeStep].icon
              return (
                <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-gray-500">
                  <CurrentIcon className="w-3 h-3" />
                  Step {activeStep + 1} of {STEPS.length} &middot; {STEPS[activeStep].label}
                </div>
              )
            })()}
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-8 py-5">{renderStepContent()}</div>

          {/* Bottom navigation */}
          <div className="px-8 py-4 border-t border-white/[0.04] flex items-center justify-between">
            <button
              onClick={() => setActiveStep(activeStep - 1)}
              disabled={isFirstStep}
              className={`flex items-center gap-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-btn px-4 py-2 ${
                isFirstStep
                  ? 'text-gray-600 cursor-not-allowed'
                  : 'text-gray-300 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              {isFirstStep ? '' : STEPS[activeStep - 1].label}
            </button>

            {/* Step dots */}
            <div className="flex items-center gap-1.5">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveStep(i)}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    i === activeStep
                      ? 'bg-accent w-4'
                      : i < activeStep
                        ? 'bg-accent/40'
                        : 'bg-white/10'
                  }`}
                  aria-label={`Go to step ${i + 1}`}
                />
              ))}
            </div>

            <button
              onClick={() => isLastStep ? clearTutorial() : setActiveStep(activeStep + 1)}
              className="flex items-center gap-2 text-sm font-medium btn-primary px-5 py-2"
            >
              {isLastStep ? 'Finish' : STEPS[activeStep + 1]?.label || 'Next'}
              {!isLastStep && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
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
