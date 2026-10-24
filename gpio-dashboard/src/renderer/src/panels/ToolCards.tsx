// The compact cards under a tool chip (SPEC 11.8): ERC counts and issues, the simulated numbers,
// a program's run, a captured view, or why a call failed. They read the tool's own result.
import { AlertOctagon, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { ChatItem } from '../state/assistantStore'

type Tool = Extract<ChatItem, { kind: 'tool' }>

interface IssueRow {
  code: string
  severity: 'error' | 'warning' | 'info'
  refs: string[]
  message: string
}

interface Counts {
  errors: number
  warnings: number
  info: number
  issues: IssueRow[]
}

interface SimResult extends Counts {
  leds: { die: string; mA: number; brightness: number }[]
  resistors: { ref: string; ohms: number; volts: number; mA: number; mW: number }[]
  gpio: { pin: string; volts: number; mA: number }[]
  rails: { '3V3_mA': number; '5V_mA': number }
}

interface RunResult {
  stdout: string
  error: string | null
  events: string[]
  eventCount: number
}

function parse<T>(text: string | undefined): T | null {
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? (value as T) : null
  } catch {
    return null
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function CountLine({ counts }: { counts: Counts }) {
  const clean = counts.errors === 0
  const Icon = clean ? (counts.warnings ? AlertTriangle : CheckCircle2) : AlertOctagon
  const tone = clean ? (counts.warnings ? 'text-amber-400' : 'text-emerald-400') : 'text-red-400'
  return (
    <div className={`flex items-center gap-1.5 ${tone}`}>
      <Icon className="w-3.5 h-3.5" />
      {plural(counts.errors, 'error')} · {plural(counts.warnings, 'warning')}
      {counts.info ? ` · ${counts.info} info` : ''}
    </div>
  )
}

function Issues({ issues }: { issues: IssueRow[] }) {
  const shown = issues.filter((i) => i.severity !== 'info').slice(0, 3)
  if (!shown.length) return null
  return (
    <ul className="mt-1 space-y-0.5">
      {shown.map((i, n) => (
        <li key={n} className="text-gray-300">
          <span
            className={`font-mono ${i.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}
          >
            {i.code}
          </span>{' '}
          <span className="text-gray-500">{i.refs.join(', ')}</span> {i.message}
        </li>
      ))}
    </ul>
  )
}

const Card = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div
    aria-label={label}
    className="mt-1 ml-5 rounded-btn border border-white/[0.06] bg-surface-900/70 px-2.5 py-1.5 text-[11px] leading-snug"
  >
    {children}
  </div>
)

const cell = 'pr-3 py-0.5 font-mono text-gray-300'

function SimCard({ sim }: { sim: SimResult }) {
  return (
    <Card label="Simulation result">
      <CountLine counts={sim} />
      <table className="mt-1">
        <tbody>
          {sim.leds.map((l) => (
            <tr key={l.die}>
              <td className={cell}>{l.die}</td>
              <td className={cell}>{l.mA.toFixed(2)} mA</td>
              <td className={cell}>{Math.round(l.brightness * 100)}% bright</td>
            </tr>
          ))}
          {sim.resistors.map((r) => (
            <tr key={r.ref}>
              <td className={cell}>
                {r.ref} {r.ohms} Ω
              </td>
              <td className={cell}>{r.mA.toFixed(2)} mA</td>
              <td className={cell}>
                {r.volts.toFixed(2)} V · {r.mW.toFixed(1)} mW
              </td>
            </tr>
          ))}
          {sim.gpio
            .filter((g) => Math.abs(g.mA) >= 0.01)
            .map((g) => (
              <tr key={g.pin}>
                <td className={cell}>{g.pin}</td>
                <td className={cell}>{g.mA.toFixed(2)} mA</td>
                <td className={cell}>{g.volts.toFixed(2)} V</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="text-gray-500 font-mono">
        3V3 {sim.rails['3V3_mA'].toFixed(1)} mA · 5V {sim.rails['5V_mA'].toFixed(1)} mA
      </div>
      <Issues issues={sim.issues} />
    </Card>
  )
}

/** The card for a finished tool call, or nothing for tools that need none. */
export default function ToolCard({ tool }: { tool: Tool }) {
  if (tool.status === 'failed') {
    const failure = parse<Record<string, unknown>>(tool.result)
    const [code, detail] = failure ? (Object.entries(failure)[0] ?? []) : []
    const text = code
      ? `${code}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
      : (tool.result ?? '')
    return (
      <Card label="Tool error">
        <p className="text-red-300 line-clamp-3 break-words">{text}</p>
      </Card>
    )
  }
  if (tool.status !== 'done') return null
  if (tool.image)
    return (
      <Card label="Captured view">
        <img
          alt={tool.result ?? 'Captured view'}
          src={`data:image/png;base64,${tool.image}`}
          className="h-28 w-auto rounded"
        />
      </Card>
    )
  if (tool.name === 'run_erc') {
    const erc = parse<Counts>(tool.result)
    return erc ? (
      <Card label="ERC result">
        <CountLine counts={erc} />
        <Issues issues={erc.issues} />
      </Card>
    ) : null
  }
  if (tool.name === 'simulate') {
    const sim = parse<SimResult>(tool.result)
    return sim?.leds ? <SimCard sim={sim} /> : null
  }
  if (tool.name === 'run_code_in_sim') {
    const run = parse<RunResult>(tool.result)
    if (!run) return null
    return (
      <Card label="Run in the simulator">
        <div className="text-gray-400">{plural(run.eventCount, 'pin event')}</div>
        <ul className="font-mono text-gray-300">
          {run.events.slice(0, 4).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
        {run.stdout && (
          <pre className="mt-1 whitespace-pre-wrap text-gray-400 line-clamp-3">{run.stdout}</pre>
        )}
      </Card>
    )
  }
  return null
}
