// Tutorials (SPEC 11.1, 13.1): the verified content. Each shows its theory, the generated wiring
// table and build steps, and its code, which runs on the Pi through the existing run path. It
// opens in the Studio as a read-only template, with Build Mode over its steps, or forks into my
// projects (SPEC 11.9); "Open in Workbench" checks and simulates its circuit.
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  FlaskConical,
  GitFork,
  Hammer,
  Play,
  Square
} from 'lucide-react'
import { useState } from 'react'
import CodeEditor from '../components/CodeEditor'
import { partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import { erc } from '../core/erc/erc'
import { buildSteps } from '../core/steps/steps'
import { renderTheory } from '../core/tutorials/theory'
import Markdown from '../panels/Markdown'
import RunBlockedDialog from '../panels/RunBlockedDialog'
import useConnectionStore from '../store/connectionStore'
import useTutorialStore from '../store/tutorialStore'
import useUiStore from '../store/uiStore'
import { useBuild } from '../state/buildStore'
import { forkTemplate, openTemplate, useProject } from '../state/projectStore'
import { useRun } from '../state/runStore'
import { useWorkbench } from '../state/workbenchStore'

function Wiring({ tutorial }) {
  const { table, steps } = buildSteps(tutorial.doc, partDef)
  return (
    <div className="space-y-4 text-sm">
      <ol className="list-decimal pl-5 space-y-1.5 text-gray-200">
        {steps.map((s, i) => (
          <li key={i}>
            {s.text}
            {s.why && <span className="block text-xs text-gray-400">Why: {s.why}</span>}
            {s.mistake && (
              <span className="block text-xs text-amber-400">Common mistake: {s.mistake}</span>
            )}
          </li>
        ))}
      </ol>
      <table className="text-xs font-mono">
        <thead className="text-gray-400 text-left">
          <tr>
            {['Ref', 'Part', 'Pin', 'Hole', 'Net'].map((h) => (
              <th key={h} className="pr-4 pb-1 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-gray-300">
          {table.map((r, i) => (
            <tr key={i} className="border-t border-white/[0.04]">
              <td className="pr-4 py-1">{r.ref}</td>
              <td className="pr-4">{r.what}</td>
              <td className="pr-4">{r.pin}</td>
              <td className="pr-4">{r.at}</td>
              <td>{r.net}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Code({ tutorial }) {
  const editorCode = useTutorialStore((s) => s.editorCode)
  const { status, output, run, stop } = useRun()
  const connected = useConnectionStore((s) => s.status === 'connected')
  const running = status === 'running' || status === 'deploying'
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="h-80 rounded-lg overflow-hidden border border-white/[0.06]">
        <CodeEditor code={editorCode} originalCode={tutorial.doc.code.source} />
      </div>
      <div className="flex items-center gap-2">
        {running ? (
          <button className="btn-danger text-sm flex items-center gap-1.5" onClick={stop}>
            <Square className="w-4 h-4" /> Stop
          </button>
        ) : (
          <button
            className="btn-success text-sm flex items-center gap-1.5"
            disabled={!connected}
            onClick={() => run(tutorial.meta.id, editorCode, erc(tutorial.doc, partDef))}
          >
            <Play className="w-4 h-4" /> Run on Pi
          </button>
        )}
        {!connected && <span className="text-xs text-gray-500">Connect to your Pi to run.</span>}
        <span className="text-xs text-gray-500">{status}</span>
      </div>
      <RunBlockedDialog />
      {output.length > 0 && (
        <pre className="text-xs font-mono text-gray-300 bg-surface-900 rounded p-3 max-h-48 overflow-y-auto">
          {output.map((l) => l.data).join('')}
        </pre>
      )}
    </div>
  )
}

function Detail({ tutorial, onBack }) {
  const [tab, setTab] = useState('theory')
  const { meta } = tutorial
  const error = useProject((s) => s.error)
  const openInWorkbench = () => {
    useWorkbench.getState().open(meta.id, tutorial.doc)
    useUiStore.getState().setActiveTab('workbench')
  }
  // The template opens in the Studio, with Build Mode over its steps when asked; a fork opens
  // as a project of my own. A document that fails to open stays here with its reason.
  const inStudio = async (open, then) => {
    await open()
    if (useProject.getState().error) return
    then?.()
    useUiStore.getState().setActiveTab('studio')
  }
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-white/[0.04] space-y-2">
        <div className="flex items-center gap-3">
          <button className="btn-ghost" aria-label="Back to tutorials" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-lg font-semibold text-gray-100">{meta.title}</h2>
          {meta.kitProject && <span className="text-xs text-gray-500">kit {meta.kitProject}</span>}
          {meta.tags.map((t) => (
            <span
              key={t}
              className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400"
            >
              {t}
            </span>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn-success text-sm flex items-center gap-1.5"
              onClick={() =>
                inStudio(
                  () => openTemplate(tutorial),
                  () => useBuild.getState().start()
                )
              }
            >
              <Hammer className="w-4 h-4" /> Build in the Studio
            </button>
            <button
              className="btn-secondary text-sm"
              onClick={() => inStudio(() => openTemplate(tutorial))}
            >
              Open in Studio
            </button>
            <button
              className="btn-secondary text-sm flex items-center gap-1.5"
              onClick={() => inStudio(() => forkTemplate(tutorial.doc))}
            >
              <GitFork className="w-4 h-4" /> Fork to my projects
            </button>
            <button
              className="btn-secondary text-sm flex items-center gap-1.5"
              onClick={openInWorkbench}
            >
              <FlaskConical className="w-4 h-4" /> Open in Workbench
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <p className="text-sm text-gray-400">{meta.summary}</p>
        <div className="flex flex-wrap gap-3 text-xs">
          {[meta.sources.kit, ...meta.sources.datasheets, ...meta.sources.pi]
            .filter(Boolean)
            .map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-accent-light flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
                {new URL(url).hostname}
              </a>
            ))}
        </div>
        <div className="flex gap-1 pt-1" role="tablist">
          {['theory', 'wiring', 'code'].map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`tab-button ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {{ theory: 'Theory', wiring: 'Wiring and steps', code: 'Code' }[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'theory' && (
          <Markdown text={renderTheory(tutorial.theory, tutorial.doc, partDef)} />
        )}
        {tab === 'wiring' && <Wiring tutorial={tutorial} />}
        {tab === 'code' && <Code tutorial={tutorial} />}
      </div>
    </div>
  )
}

export default function TutorialsPage() {
  const selectedId = useTutorialStore((s) => s.selectedTutorialId)
  const selectTutorial = useTutorialStore((s) => s.selectTutorial)
  const clearTutorial = useTutorialStore((s) => s.clearTutorial)
  const selected = TUTORIALS.find((t) => t.meta.id === selectedId)
  if (selected) return <Detail tutorial={selected} onBack={clearTutorial} />
  const kit = TUTORIALS.filter((t) => t.meta.kitProject)
  const extras = TUTORIALS.filter((t) => !t.meta.kitProject)
  const list = (items) => (
    <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {items.map((t) => (
        <li key={t.meta.id}>
          <button
            className="card w-full text-left"
            onClick={() => selectTutorial(t.meta.id, t.doc.code.source)}
          >
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {t.meta.kitProject ? `kit ${t.meta.kitProject}` : 'extra'}
              {t.meta.tags.map((tag) => (
                <span key={tag} className="text-amber-400">
                  · {tag}
                </span>
              ))}
            </div>
            <div className="text-sm font-semibold text-gray-100 mt-1">{t.meta.title}</div>
            <div className="text-xs text-gray-400 mt-1">{t.meta.summary}</div>
          </button>
        </li>
      ))}
    </ul>
  )
  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-accent-light" />
        <h2 className="text-lg font-semibold text-gray-100">Tutorials</h2>
      </div>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-300">The kit&apos;s projects</h3>
        {list(kit)}
      </section>
      {extras.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-300">Extras</h3>
          {list(extras)}
        </section>
      )}
    </div>
  )
}
