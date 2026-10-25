// The divergences of the Pi's pins from the document (state/liveCheck.ts), kept up to date while
// Live Pi state is on. A contradiction shows once it has held for HOLD_MS: pins change level
// between two telemetry frames when a program starts or ends, and a flash is not news.
import { codePins } from '../core/code/pins'
import { partDef } from '../core/defs/parts'
import { circuit } from './circuit'
import { liveDivergences, SETUP_GRACE_MS } from './liveCheck'
import { useLive } from './liveStore'
import { useRun } from './runStore'
import { useStudio } from './studioStore'
import { useWorkbench } from './workbenchStore'

export const HOLD_MS = 600

let seen = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | null = null
let runStartedAt: number | null = null
let graceTimer: ReturnType<typeof setTimeout> | null = null

const now = () => performance.now()

function evaluate(): void {
  if (timer) clearTimeout(timer)
  timer = null
  const live = useLive.getState()
  if (!useStudio.getState().live || !live.online) {
    seen = new Map()
    if (live.divergences.length) useLive.setState({ divergences: [] })
    return
  }
  const doc = circuit.getSnapshot()
  const found = liveDivergences({
    doc,
    nl: circuit.engine.state.netlist,
    defs: partDef,
    pins: live.pins,
    uses: codePins(useWorkbench.getState().code).uses,
    runningMs: runStartedAt === null ? null : now() - runStartedAt,
    reads: live.sim?.reads ?? {}
  })
  const t = now()
  const next = new Map<string, number>()
  for (const d of found) next.set(d.id, seen.get(d.id) ?? t)
  seen = next
  const shown = found.filter((d) => t - seen.get(d.id)! >= HOLD_MS)
  const waiting = found.filter((d) => t - seen.get(d.id)! < HOLD_MS)
  if (waiting.length) {
    const wait = Math.min(...waiting.map((d) => HOLD_MS - (t - seen.get(d.id)!)))
    timer = setTimeout(evaluate, wait + 5)
  }
  if (JSON.stringify(shown) !== JSON.stringify(live.divergences))
    useLive.setState({ divergences: shown })
}

useLive.subscribe((after, before) => {
  if (after.pins !== before.pins || after.sim !== before.sim || after.online !== before.online)
    evaluate()
})
useStudio.subscribe((after, before) => {
  if (after.live !== before.live) evaluate()
})
circuit.subscribe(evaluate)
useWorkbench.subscribe((after, before) => {
  if (after.code !== before.code) evaluate()
})
useRun.subscribe((after, before) => {
  if (after.status === before.status) return
  const running = after.status === 'running'
  runStartedAt = running ? (runStartedAt ?? now()) : null
  if (graceTimer) clearTimeout(graceTimer)
  graceTimer = running ? setTimeout(evaluate, SETUP_GRACE_MS + 5) : null
  evaluate()
})
