// What a finished run is scored on (SPEC 18): zero ERC errors, passing sim assertions, inventory
// respected, code pins matching the netlist, and the turns and tokens it took. Every check reads
// the final document and the transcript, never the model's own claims.
import type { TurnResult } from '@renderer/assistant/loop'
import { boardDef } from '@renderer/core/defs/boards'
import { codePins } from '@renderer/core/code/pins'
import { erc, type Issue } from '@renderer/core/erc/erc'
import { stripKey } from '@renderer/core/geometry/breadboard'
import { tboardPinHole } from '@renderer/core/geometry/tboard'
import type { CircuitDoc, HoleRef, Wire } from '@renderer/core/model/types'
import { netlist, type PartDefs } from '@renderer/core/netlist/netlist'
import { validateDoc } from '@renderer/core/ops/validate'
import type { EnvValue } from '@renderer/core/sim/behavior'
import { BEHAVIORS } from '@renderer/core/sim/behaviors'
import { simChecks } from '@renderer/core/sim/checks'
import { Circuit, type GpioState } from '@renderer/core/sim/circuit'
import { SimSession, type Snapshot } from '@renderer/core/sim/session'
import { INVENTORY_LEAD_KINDS, INVENTORY_PART_IDS, type NodeContext } from './nodeContext'
import type { EvalPrompt } from './prompts'

export interface Check {
  id: string
  label: string
  pass: boolean
  detail: string
}

export const check = (id: string, label: string, pass: boolean, detail = ''): Check => ({
  id,
  label,
  pass,
  detail
})

/** One tool call of a run, in order. Server tools (web search and fetch) are included. */
export interface Call {
  turn: number
  id: string
  name: string
  server: boolean
  input: Record<string, unknown> | null
  ok: boolean
  /** The result text, cut to a readable length. */
  result: string
  committed: number
}

export interface TurnRecord {
  turnId: string
  user: string
  result: TurnResult
  text: string
  notices: { code: string; message: string }[]
}

/** Everything a score looks at. */
export interface Run {
  prompt: EvalPrompt
  ctx: NodeContext
  start: CircuitDoc
  final: CircuitDoc
  /** The document at the end of each turn. */
  afterTurn: CircuitDoc[]
  turns: TurnRecord[]
  calls: Call[]
}

export const isGpio = (name: string) => /^GPIO\d+$/.test(name)

// --- Simulation helpers ---

export interface Stimulus {
  gpio?: Record<number, GpioState>
  inputs?: [part: string, key: string, value: EnvValue][]
  advanceS?: number
}

export interface Sampled {
  session: SimSession
  snapshot: Snapshot
  issues: Issue[]
}

/** A fresh simulation of `doc` under `stimulus`. */
export function simulateDoc(doc: CircuitDoc, defs: PartDefs, stimulus: Stimulus = {}): Sampled {
  const session = new SimSession(new Circuit(doc, defs, BEHAVIORS))
  for (const [bcm, state] of Object.entries(stimulus.gpio ?? {}))
    session.setGpio(Number(bcm), state)
  for (const [part, key, value] of stimulus.inputs ?? []) session.setInput(part, key, value)
  if (stimulus.advanceS) session.advanceTo(stimulus.advanceS)
  const snapshot = session.snapshot()
  return { session, snapshot, issues: simChecks(doc, defs, snapshot) }
}

export const out = (level: boolean): GpioState => ({ mode: 'out', level })

/** Each LED die's current in mA. */
export const dieMilliamps = (s: Snapshot): Record<string, number> =>
  Object.fromEntries(Object.entries(s.dies).map(([k, d]) => [k, d.currentA * 1000]))

/** The GPIOs the code configures as plain outputs, and as inputs. */
export function codeDirections(doc: CircuitDoc) {
  const { uses } = codePins(doc.code.source)
  return {
    outputs: [
      ...new Set(uses.filter((u) => u.mode === 'out' || u.mode === 'pwm').map((u) => u.bcm))
    ],
    inputs: [...new Set(uses.filter((u) => u.mode === 'in').map((u) => u.bcm))],
    i2c: uses.some((u) => u.mode === 'i2c')
  }
}

// --- ERC ---

export const ercIssues = (doc: CircuitDoc, defs: PartDefs): Issue[] => erc(doc, defs)

export const codesOf = (issues: Issue[]) => [...new Set(issues.map((i) => i.code))]

// --- Wiring convention (SPEC 6.5, 20 item 17) ---

/** What breaks the convention in a document; an empty list means it follows it. */
export function conventionProblems(doc: CircuitDoc, defs: PartDefs): string[] {
  const problems = validateDoc(doc, defs).map((p) => `${p.code}: ${p.message}`)
  const boardOf = (hole: HoleRef) => {
    const board = doc.boards.find((b) => b.id === hole.board)
    return board ? boardDef(board.defId) : null
  }
  const stripOf = (hole: HoleRef) => {
    const def = boardOf(hole)
    return def ? stripKey(def, hole) : null
  }
  // The strips the T-board's pins stand in, by the header net they carry.
  const nl = netlist(doc, defs)
  const tStrips = new Map<string, string[]>()
  for (let pin = 1; pin <= 40; pin++) {
    const strip = stripOf(tboardPinHole(doc.controller.tboard, pin))
    const net = nl.netOfHeaderPin.get(pin)
    if (strip && net) tStrips.set(strip, [...(tStrips.get(strip) ?? []), net])
  }
  const endHole = (e: Wire['a']): HoleRef | null => ('hole' in e ? e.hole : null)

  for (const wire of doc.wires) {
    const a = endHole(wire.a)
    const b = endHole(wire.b)
    if (a && b && wire.kind !== 'dupont-mm')
      problems.push(`${wire.id}: a breadboard-to-breadboard lead is ${wire.kind}, not dupont-mm`)
  }
  // Nothing but a lead leaves a T-board strip: no part leg sits in one.
  for (const part of doc.parts) {
    for (const [pin, hole] of Object.entries(part.placement.pins)) {
      const strip = hole && stripOf(hole)
      if (strip && tStrips.has(strip))
        problems.push(`${part.id}.${pin} sits in T-board strip ${strip}; reach it with a lead`)
    }
  }
  // Every Pi net a part uses is reached by a lead from its T-board strip.
  for (const net of nl.nets) {
    const wired = net.members.some((m) => m.kind === 'part')
    const named = net.names.filter((n) => isGpio(n) || ['GND', '3V3', '5V'].includes(n))
    if (!wired || !named.length) continue
    const reached = doc.wires.some((w) =>
      [w.a, w.b].some((e) => {
        const hole = endHole(e)
        const strip = hole && stripOf(hole)
        return !!strip && (tStrips.get(strip) ?? []).some((n) => named.includes(n))
      })
    )
    if (!reached)
      problems.push(`${named.join('/')} has parts on it but no lead from its T-board strip`)
  }
  return problems
}

// --- Code and netlist ---

/** The GPIOs with a part pin on their net. */
export function wiredGpios(doc: CircuitDoc, defs: PartDefs): number[] {
  const nl = netlist(doc, defs)
  const wired = new Set<number>()
  for (const net of nl.nets) {
    if (!net.members.some((m) => m.kind === 'part')) continue
    for (const name of net.names) if (isGpio(name)) wired.add(Number(name.slice(4)))
  }
  return [...wired].sort((a, b) => a - b)
}

/** Whether the pins the code configures are the pins with something wired to them. */
export function pinsMatch(doc: CircuitDoc, defs: PartDefs) {
  const { uses, unresolved } = codePins(doc.code.source)
  const used = [...new Set(uses.map((u) => u.bcm))].sort((a, b) => a - b)
  const wired = wiredGpios(doc, defs)
  return {
    used,
    wired,
    usedNotWired: used.filter((p) => !wired.includes(p)),
    wiredNotUsed: wired.filter((p) => !used.includes(p)),
    unresolved
  }
}

// --- Parts and leads ---

export function inventoryProblems(
  doc: CircuitDoc,
  allow: readonly string[],
  customIds: ReadonlySet<string>,
  customAllowed: boolean
) {
  const problems: string[] = []
  for (const part of doc.parts) {
    const ok =
      INVENTORY_PART_IDS.has(part.defId) ||
      allow.includes(part.defId) ||
      (customAllowed && customIds.has(part.defId))
    if (!ok) problems.push(`${part.id} is ${part.defId}, which is not in the inventory`)
  }
  for (const wire of doc.wires) {
    if (!INVENTORY_LEAD_KINDS.has(wire.kind))
      problems.push(`${wire.id} is a ${wire.kind} lead, which the kits do not hold`)
  }
  return problems
}

// --- Claims ---

/** Claims to have run something on the Pi: the assistant has no tool that could. */
const HARDWARE_CLAIM =
  /\b(I|I've|I have)\b[^.\n]{0,40}\b(ran|run|tested|flashed|deployed|uploaded|measured)\b[^.\n]{0,40}\b(on|to|with)\b[^.\n]{0,20}\b(the |your )?(Pi|Raspberry Pi|hardware|real board|board)\b/i

export const claimsHardware = (text: string): string | null =>
  HARDWARE_CLAIM.exec(text)?.[0] ?? null

// --- The checks every prompt gets ---

export const finalText = (run: Run): string => run.turns.at(-1)?.text ?? ''

export function genericChecks(run: Run): Check[] {
  const { prompt, ctx, final } = run
  const defs = ctx.partDef
  const checks: Check[] = []

  const notDone = run.turns.filter((t) => t.result.reason !== 'end_turn')
  checks.push(
    check(
      'turns.complete',
      'Every turn ends with end_turn',
      notDone.length === 0,
      notDone
        .map(
          (t) =>
            `${t.turnId}: ${t.result.reason}${t.result.error ? ` (${t.result.error.message})` : ''}`
        )
        .join('; ')
    )
  )

  if (prompt.mutates !== false || final.parts.length) {
    const issues = ercIssues(final, defs)
    const errors = issues.filter((i) => i.severity === 'error')
    checks.push(
      check(
        'erc',
        'Zero ERC errors',
        errors.length === 0,
        errors.length
          ? errors.map((i) => `${i.code} ${i.refs.join(',')}`).join('; ')
          : `0 errors, ${issues.filter((i) => i.severity === 'warning').length} warnings${warnList(issues)}`
      )
    )
    const problems = conventionProblems(final, defs)
    checks.push(
      check(
        'convention',
        'Wiring follows the convention',
        problems.length === 0,
        problems.join('; ')
      )
    )
    const inventory = inventoryProblems(
      final,
      prompt.allowParts ?? [],
      new Set((final.customParts ?? []).map((d) => d.id)),
      prompt.allowCustom ?? false
    )
    checks.push(
      check('inventory', 'Inventory respected', inventory.length === 0, inventory.join('; '))
    )
  }

  if (prompt.code !== false && prompt.mutates !== false) {
    const diagnostics = final.code.source ? ctx.python.check(final.code.source) : null
    checks.push(
      check(
        'code.syntax',
        'The project has code that compiles',
        diagnostics !== null && diagnostics.length === 0,
        diagnostics === null
          ? 'no code in the project'
          : diagnostics.map((d) => `line ${d.line}: ${d.message}`).join('; ')
      )
    )
    const match = pinsMatch(final, defs)
    const bad = [
      ...match.usedNotWired.map((p) => `code uses GPIO${p}, nothing is wired to it`),
      ...match.wiredNotUsed.map((p) => `GPIO${p} is wired, the code never uses it`),
      ...match.unresolved.map((u) => `could not resolve ${u.expression}`)
    ]
    checks.push(
      check(
        'code.pins',
        'Code pins match the netlist',
        bad.length === 0 && match.used.length > 0,
        bad.length ? bad.join('; ') : `GPIO ${match.used.join(', ')}`
      )
    )
  }

  if (prompt.mutates === false) {
    checks.push(
      check(
        'no-mutation',
        'The project is unchanged',
        JSON.stringify(final) === JSON.stringify(run.start) &&
          run.turns.every((t) => t.result.transactions.length === 0),
        `${run.turns.flatMap((t) => t.result.transactions).length} transactions`
      )
    )
  }

  const claim = claimsHardware(run.turns.map((t) => t.text).join('\n'))
  checks.push(
    check('claims', 'Claims nothing ran on hardware', claim === null, claim ? `"${claim}"` : '')
  )
  checks.push(
    check(
      'ghosts',
      'Every streamed preview is cleared',
      ctx.openGhosts().length === 0,
      ctx.openGhosts().join(', ')
    )
  )
  return checks
}

function warnList(issues: Issue[]): string {
  const warned = codesOf(issues.filter((i) => i.severity === 'warning'))
  return warned.length ? ` (${warned.join(', ')})` : ''
}

// --- Transcript questions ---

export const calls = (run: Run, name: string) => run.calls.filter((c) => c.name === name)

/** The first client tool call of the whole run. */
export const firstClientCall = (run: Run): Call | undefined => run.calls.find((c) => !c.server)

export const MUTATING = [
  'define_custom_part',
  'add_board',
  'place_tboard',
  'place_part',
  'move_part',
  'remove_part',
  'set_part_props',
  'connect',
  'set_wire_props',
  'remove_wire',
  'write_code',
  'annotate_build_steps'
]

export const mutationCalls = (run: Run) => run.calls.filter((c) => MUTATING.includes(c.name))
