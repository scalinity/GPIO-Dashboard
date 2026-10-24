// The Workbench's Code panel (SPEC 11.6, 13.2, 14.3): edit the program, check it, run it against
// the simulated circuit at a chosen speed, or run it on the Pi behind the ERC gate.
import { CheckCircle2, Cpu, Play, Square } from 'lucide-react'
import { useState } from 'react'
import { partDef } from '../core/defs/parts'
import { erc } from '../core/erc/erc'
import type { CircuitDoc } from '../core/model/types'
import { useRun } from '../state/runStore'
import { useWorkbench } from '../state/workbenchStore'
import CodeEditor from './CodeEditor'
import RunBlockedDialog from './RunBlockedDialog'

const SPEEDS = [
  { label: 'Real time', scale: 1 },
  { label: '10×', scale: 10 },
  { label: 'As fast as possible', scale: Infinity }
]

/** A project id for Run on Pi: [a-zA-Z0-9_-] only (SPEC 14.3). */
const projectId = (source: string | null, doc: CircuitDoc) =>
  (source && /^[\w-]+$/.test(source) ? source : doc.meta.name)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .slice(0, 48) || 'project'

export default function CodePanel({ doc }: { doc: CircuitDoc }) {
  const { source, code, diagnostics, codeStatus, codeOutput, codeError } = useWorkbench()
  const { setCode, check, runInSim, stopCode } = useWorkbench.getState()
  const run = useRun((s) => s.run)
  const [speed, setSpeed] = useState(0)
  const running = codeStatus === 'running'
  return (
    <div className="flex flex-col gap-3">
      <div className="h-72 rounded-lg overflow-hidden border border-white/[0.06]">
        <CodeEditor
          key={`${source}-${running}`}
          initial={code}
          onChange={setCode}
          readOnly={running}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-secondary text-sm flex items-center gap-1.5" onClick={check}>
          <CheckCircle2 className="w-4 h-4" /> Check
        </button>
        {running ? (
          <button className="btn-danger text-sm flex items-center gap-1.5" onClick={stopCode}>
            <Square className="w-4 h-4" /> Stop
          </button>
        ) : (
          <button
            className="btn-success text-sm flex items-center gap-1.5"
            onClick={() => runInSim(SPEEDS[speed]!.scale)}
          >
            <Play className="w-4 h-4" /> Run in Sim
          </button>
        )}
        <select
          aria-label="Simulation speed"
          className="bg-surface-800 text-gray-200 text-xs rounded px-1.5 py-1"
          value={speed}
          disabled={running}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s, i) => (
            <option key={s.label} value={i}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          className="btn-secondary text-sm flex items-center gap-1.5 ml-auto"
          onClick={() =>
            run(
              projectId(source, doc),
              code,
              erc({ ...doc, code: { ...doc.code, source: code } }, partDef)
            )
          }
        >
          <Cpu className="w-4 h-4" /> Run on Pi
        </button>
        <span className="text-xs text-gray-500">{codeStatus}</span>
      </div>
      <RunBlockedDialog />
      {diagnostics.length > 0 && (
        <ul className="text-xs font-mono text-red-300">
          {diagnostics.map((d, i) => (
            <li key={i}>
              line {d.line}, column {d.column}: {d.message}
            </li>
          ))}
        </ul>
      )}
      {(codeOutput.length > 0 || codeError) && (
        <pre className="text-xs font-mono text-gray-300 bg-surface-900 rounded p-3 max-h-48 overflow-y-auto">
          {codeOutput.join('\n')}
          {codeError && <span className="text-red-400">{`\n${codeError}`}</span>}
        </pre>
      )}
    </div>
  )
}
