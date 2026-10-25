// The Code panel (SPEC 11.6, 13.2, 14.3): edit the program, check it, run it against the simulated
// circuit at a chosen speed, or run it on the Pi behind the ERC gate. Leaving the editor commits
// the program to the document as one transaction.
import { CheckCircle2, Cpu, Play, Square } from 'lucide-react'
import { useState } from 'react'
import type { CircuitDoc } from '../core/model/types'
import { circuit } from '../state/circuit'
import { runOnPi, useRun } from '../state/runStore'
import { edit } from '../state/studioStore'
import { useWorkbench } from '../state/workbenchStore'
import CodeEditor from './CodeEditor'

const SPEEDS = [
  { label: 'Real time', scale: 1 },
  { label: '10×', scale: 10 },
  { label: 'As fast as possible', scale: Infinity }
]

function commitCode() {
  const { code } = useWorkbench.getState()
  const doc = circuit.getSnapshot()
  if (code !== doc.code.source)
    edit('Edit code', [{ type: 'SetCode', code: { ...doc.code, source: code } }])
}

export default function CodePanel({ doc }: { doc: CircuitDoc }) {
  const { source, code, codeRevision, diagnostics, codeStatus, codeOutput, codeError } =
    useWorkbench()
  const { setCode, check, runInSim, stopCode } = useWorkbench.getState()
  const piOutput = useRun((s) => s.output)
  const [speed, setSpeed] = useState(0)
  const running = codeStatus === 'running'
  return (
    <div className="flex flex-col gap-3">
      <div
        className="h-72 rounded-lg overflow-hidden border border-white/[0.06]"
        onBlur={commitCode}
      >
        <CodeEditor
          key={`${codeRevision}-${running}`}
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
          onClick={() => runOnPi(source, doc, code)}
        >
          <Cpu className="w-4 h-4" /> Run on Pi
        </button>
        <span className="text-xs text-gray-500">{codeStatus}</span>
      </div>
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
      {piOutput.length > 0 && (
        <pre
          aria-label="Output from the Pi"
          className="text-xs font-mono text-gray-300 bg-surface-900 rounded p-3 max-h-48 overflow-y-auto"
        >
          {piOutput.map((l) => l.data).join('')}
        </pre>
      )}
    </div>
  )
}
