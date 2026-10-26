// What the simulation and Board Sense paint on the bench (SPEC 10.6, 11.5): LEDs and displays that
// glow, parts that move, the LCD's characters, current dashes along leads, voltage tags, warning
// halos and the Board Sense tint of each net. It reads a simulation snapshot and the Inspect
// toggles, and writes to the part handles, the lead overlays, the halos and the tag layer. Nothing
// here draws a frame by itself: a change asks for one, and `step` says whether a part is still
// moving.
import { Color, type Matrix4, Quaternion, Vector3 } from 'three/webgpu'
import { partDef } from '../core/defs/parts'
import type { Issue } from '../core/erc/erc'
import type { CircuitDoc, HoleRef } from '../core/model/types'
import { netlist, type Netlist } from '../core/netlist/netlist'
import type { Ranked } from '../core/sense/candidates'
import type { NetState } from '../core/sense/sense'
import type { EnvValue } from '../core/sim/behavior'
import type { Snapshot } from '../core/sim/session'
import { bodyBox } from './bodies'
import { defOf } from './coords'
import { BLOOM_GATE, emissionOf } from './glow'
import { Halos } from './halos'
import { type Label, type LabelLayer } from './labels'
import { type LcdView, LcdScreen } from './lcd'
import { type Marker, Markers } from './markers'
import { Motion, motionOf } from './motion'
import { netAnchor, netMarkers, stripIndex } from './nets'
import { type PartLayer } from './parts'
import { wireCurrents } from './flow'
import { type WireFxState, type WireLayer } from './wires'

/** Issues that name a part as over its rating (the halo's reason). */
const RATING_CODES = new Set(['LED_NO_LIMIT'])
const HALO_COLOR = { error: new Color(3, 0.3, 0.15), warning: new Color(3, 1.6, 0.2) } as const
const TINT: Record<NetState['state'], string | null> = {
  matched: '#22C55E',
  diverged: '#EF4444',
  ambiguous: '#F59E0B',
  settling: '#9CA3AF',
  unobserved: '#6B7280',
  skipped: null
}
const TINT_SIZE_MM = 2.0
/** The most causes a diverged net's tag lists. */
const CAUSES_SHOWN = 2
/** What the assistant added or changed and has not been kept, and its ghosts (SPEC 11.8). */
const REVIEW_HALO = new Color(0.9, 0.55, 3)
const REVIEW_TINT = new Color('#A78BFA')

export interface SimInputs {
  /** The document being drawn. */
  doc: CircuitDoc
  snapshot: Snapshot | null
  env: Record<string, Record<string, EnvValue>>
  issues: Issue[]
  voltages: boolean
  current: boolean
  sense: {
    /** The overlay is on and Board Sense has states to show. */
    on: boolean
    states: [number, NetState][]
    candidates: Record<number, Ranked[] | 'working'>
    /** Asks for a diverged pin's ranked causes (a simulation; it senses nothing). */
    findCauses(pin: number): void
  }
  /** Parts and leads tinted as the assistant's: its ghosts, and what its turn changed. */
  review: { parts: string[]; wires: string[] }
  /** A drag's part drawn where it may not go: ringed in red, as an error is. */
  refused: string[]
}

/** What the visuals drew, read back for tests. */
export interface VisualsReport {
  /** Per part, the nodes that glow. */
  lit: Record<string, string[]>
  /** Per `part.node`, the animated value: mm, degrees or radians of the channel. */
  motion: Record<string, number>
  /** Per lead, the current (a to b, amps) and the dashes' speed (mm/s, signed). */
  flow: Record<string, { amps: number; mmPerS: number }>
  /** Parts with a halo. */
  halos: string[]
  /** The net tags and halo tags. */
  tags: string[]
  /** How many markers tint nets for Board Sense. */
  tints: number
  /** Each LCD's lines. */
  lcd: Record<string, [string, string]>
  /** Parts and leads tinted as the assistant's. */
  review: string[]
}

const signature = (c: Color) => `${c.r.toFixed(2)},${c.g.toFixed(2)},${c.b.toFixed(2)}`

export class SimVisuals {
  /** The tag layer over the canvas; set while the Studio is attached. */
  tags: LabelLayer | null = null
  private readonly motion = new Motion()
  private readonly lit = new Map<string, Map<string, string>>()
  /** Per part, the strongest channel of what it emits now (linear). */
  private readonly peaks = new Map<string, number>()
  private readonly screens = new Map<string, LcdScreen>()
  private readonly lcdLines = new Map<string, [string, string]>()
  private haloIds: string[] = []
  private reviewIds: string[] = []
  private haloKey = ''
  private haloDoc: CircuitDoc | null = null
  private fxKey = ''
  private tagKeys = ''
  private tagDoc: CircuitDoc | null = null
  private tintKey = ''
  private tintCount = 0
  /** The drawn document's netlist and strip index, built the first time something needs them. */
  private cache: { doc: CircuitDoc; nl?: Netlist; index?: Map<string, HoleRef[]> } | null = null
  private last = 0

  constructor(
    private readonly parts: PartLayer,
    private readonly wires: WireLayer,
    private readonly halos: Halos,
    private readonly tints: Markers,
    private readonly invalidate: () => void
  ) {}

  /** Brings every visual onto `i`; unchanged ones are left alone, so a still scene stays still. */
  sync(i: SimInputs): void {
    if (this.cache?.doc !== i.doc) this.cache = { doc: i.doc }
    this.syncParts(i)
    const tinted = this.senseTints(i)
    this.syncWires(i, tinted)
    this.syncTints(i, tinted)
    this.syncTags(i, tinted)
  }

  private get nl(): Netlist {
    const c = this.cache!
    return (c.nl ??= netlist(c.doc, partDef))
  }

  private get index(): Map<string, HoleRef[]> {
    const c = this.cache!
    return (c.index ??= stripIndex(c.doc))
  }

  /** Moves the animated parts and the dashes on to `now` (ms); whether anything still moves. */
  step(now: number): boolean {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0
    this.last = now
    const parts = this.motion.step(dt, (id, node, matrix) =>
      this.parts.handle(id)?.setTransform(node, matrix)
    )
    const dashes = this.wires.step(dt)
    // The next frame starts a new interval, not one that spans the idle time.
    if (!parts && !dashes) this.last = 0
    return parts || dashes
  }

  /**
   * Whether anything drawn may pass the bloom's threshold: a part that glows strongly, a halo, a
   * lead with current in it. Nothing else in the scene is brighter than 1 (ADR-0067).
   */
  get glowing(): boolean {
    return (
      this.halos.count > 0 ||
      this.wires.flowing ||
      [...this.peaks.values()].some((peak) => peak >= BLOOM_GATE)
    )
  }

  report(): VisualsReport {
    const motion: Record<string, number> = {}
    for (const part of this.motion.parts())
      for (const node of ['plunger', 'shaft', 'horn', 'rotor', 'armature']) {
        const v = this.motion.valueOf(part, node)
        if (v !== undefined) motion[`${part}.${node}`] = v
      }
    return {
      lit: Object.fromEntries([...this.lit].map(([id, nodes]) => [id, [...nodes.keys()].sort()])),
      motion,
      flow: this.wires.flowReport(),
      halos: this.haloIds,
      tags: this.tags?.texts() ?? [],
      tints: this.tintCount,
      lcd: Object.fromEntries(this.lcdLines),
      review: this.reviewIds
    }
  }

  dispose(): void {
    for (const screen of this.screens.values()) screen.dispose()
    this.screens.clear()
    this.lit.clear()
    this.halos.dispose()
    this.peaks.clear()
    // A later attach draws everything again.
    this.haloKey = this.fxKey = this.tagKeys = this.tintKey = ''
    this.cache = null
  }

  private syncParts(i: SimInputs): void {
    const seen = new Set<string>()
    for (const part of i.doc.parts) {
      seen.add(part.id)
      const def = defOf(i.doc, part.defId)
      const handle = this.parts.handle(part.id)
      if (handle) {
        this.light(part.id, handle, emissionOf(part, def, i.snapshot))
        if (def.sim.model === 'lcd1602-i2c') {
          let screen = this.screens.get(part.id)
          if (!screen) {
            screen = new LcdScreen()
            this.screens.set(part.id, screen)
            handle.setTexture('lcd-screen', screen.texture)
          }
          const view = i.snapshot?.parts[part.id] as LcdView | undefined
          if (screen.draw(view)) this.invalidate()
          if (view) this.lcdLines.set(part.id, view.lines)
        }
      }
      for (const target of motionOf(part, def, i.snapshot, i.env[part.id]))
        if (this.motion.aim(part.id, target)) this.invalidate()
    }
    for (const id of this.motion.parts()) if (!seen.has(id)) this.motion.drop(id)
    for (const id of [...this.lit.keys()])
      if (!seen.has(id)) {
        this.lit.delete(id)
        this.peaks.delete(id)
      }
    for (const [id, screen] of [...this.screens]) {
      if (seen.has(id)) continue
      screen.dispose()
      this.screens.delete(id)
      this.lcdLines.delete(id)
    }
    this.syncHalos(i)
  }

  /** Sets the nodes of a part that glow, and darkens the ones that stopped. */
  private light(
    id: string,
    handle: NonNullable<ReturnType<PartLayer['handle']>>,
    next: Map<string, Color>
  ) {
    const was = this.lit.get(id) ?? new Map<string, string>()
    const now = new Map<string, string>()
    for (const [node, color] of next) {
      const sig = signature(color)
      now.set(node, sig)
      if (was.get(node) !== sig) handle.setEmission(node, color)
    }
    for (const node of was.keys()) if (!now.has(node)) handle.setEmission(node, null)
    this.lit.set(id, now)
    this.peaks.set(id, Math.max(0, ...[...next.values()].map((c) => Math.max(c.r, c.g, c.b))))
  }

  private syncHalos(i: SimInputs): void {
    const rated = new Map<string, Issue['severity']>()
    for (const issue of i.issues)
      if (RATING_CODES.has(issue.code) && issue.severity !== 'info')
        for (const ref of issue.refs)
          if (i.doc.parts.some((p) => p.id === ref)) rated.set(ref, issue.severity)
    // A rating halo says more than the assistant's tint, so it wins.
    const reviewed = i.review.parts.filter((id) => !rated.has(id))
    const key = JSON.stringify([[...rated], reviewed, i.refused])
    if (key === this.haloKey && this.cache?.doc === this.haloDoc) return
    this.haloKey = key
    this.haloDoc = this.cache?.doc ?? null
    this.haloIds = [...rated.keys()]
    this.halos.set([
      ...[...rated].flatMap(([id, severity]) => {
        const box = bodyBox(i.doc, { kind: 'part', id })
        return box ? [{ box, color: HALO_COLOR[severity as 'error' | 'warning'] }] : []
      }),
      ...reviewed.flatMap((id) => {
        const box = bodyBox(i.doc, { kind: 'part', id })
        return box ? [{ box, color: REVIEW_HALO }] : []
      }),
      ...i.refused.flatMap((id) => {
        const box = bodyBox(i.doc, { kind: 'part', id })
        return box ? [{ box, color: HALO_COLOR.error }] : []
      })
    ])
    this.invalidate()
  }

  /** The tint of each net Board Sense has a state for, by net name; the state it comes from. */
  private senseTints(i: SimInputs): Map<string, { color: Color; state: NetState; pin: number }> {
    const out = new Map<string, { color: Color; state: NetState; pin: number }>()
    if (!i.sense.on) return out
    for (const [pin, state] of i.sense.states) {
      const hex = TINT[state.state]
      const net = this.nl.nets.find((n) => n.names.includes(`GPIO${pin}`))
      // A pin with nothing on its net is not a connection to confirm, unless it diverged.
      const attached = net?.members.some((m) => m.kind !== 'header')
      if (hex && net && (attached || state.state === 'diverged'))
        out.set(net.name, { color: new Color(hex), state, pin })
    }
    return out
  }

  private syncWires(
    i: SimInputs,
    tinted: Map<string, { color: Color; state: NetState; pin: number }>
  ): void {
    const amps = i.current && i.snapshot ? wireCurrents(i.doc, i.snapshot, partDef, i.env) : {}
    const tintOf = new Map<string, Color>()
    for (const id of i.review.wires) tintOf.set(id, REVIEW_TINT)
    // Board Sense's tint is a measurement, so it wins over the assistant's.
    if (tinted.size)
      for (const net of this.nl.nets)
        for (const m of net.members)
          if (m.kind === 'wire' && tinted.has(net.name))
            tintOf.set(m.wire, tinted.get(net.name)!.color)
    const drawn = new Set([...i.doc.parts.map((p) => p.id), ...i.doc.wires.map((w) => w.id)])
    this.reviewIds = [...i.review.parts, ...i.review.wires].filter((id) => drawn.has(id))
    const fx = new Map<string, WireFxState>(
      i.doc.wires.map((w) => [w.id, { amps: amps[w.id] ?? 0, tint: tintOf.get(w.id) ?? null }])
    )
    const key = JSON.stringify(
      [...fx].map(([id, s]) => [id, s.amps.toExponential(2), s.tint?.getHexString()])
    )
    this.wires.setFx(fx)
    if (key !== this.fxKey) {
      this.fxKey = key
      this.invalidate()
    }
  }

  private syncTints(i: SimInputs, tinted: Map<string, { color: Color }>): void {
    const markers: Marker[] = []
    for (const [name, { color }] of tinted)
      markers.push(
        ...netMarkers(i.doc, this.index, this.nl.byName.get(name)!, { size: TINT_SIZE_MM, color })
      )
    const key = `${markers.length}:${[...tinted].map(([n, t]) => n + t.color.getHexString()).join()}`
    if (key === this.tintKey) return
    this.tintKey = key
    this.tintCount = markers.length
    this.tints.set(markers)
    this.invalidate()
  }

  /** Voltage tags, Board Sense text on diverged nets, and the halos' reasons. */
  private syncTags(i: SimInputs, tinted: Map<string, { state: NetState; pin: number }>): void {
    if (!this.tags) return
    const entries: { key: string; label: Label }[] = []
    for (const net of i.voltages || tinted.size ? this.nl.nets : []) {
      const sense = tinted.get(net.name)
      const lines: string[] = []
      // A net that is only the header has nothing on the bench to tag.
      const attached = net.members.some((m) => m.kind !== 'header')
      const v =
        attached && i.voltages && i.snapshot?.nets[net.name] !== undefined
          ? volts(i.snapshot.nets[net.name]!)
          : null
      if (v) lines.push(`${net.name} ${v}`)
      if (sense?.state.state === 'diverged')
        lines.push(...this.divergence(i, sense.pin, sense.state))
      const at = lines.length ? netAnchor(i.doc, this.index, net) : null
      // A voltage alone is the net's name with the reading as the tag's value.
      if (at)
        entries.push({
          key: `net:${net.name}`,
          label:
            sense?.state.state === 'diverged'
              ? { text: lines.join('\n'), at, kind: 'sense' }
              : { text: net.name, value: v!, at, kind: 'volt' }
        })
    }
    for (const id of this.haloIds) {
      const box = bodyBox(i.doc, { kind: 'part', id })
      const code = i.issues.find((x) => RATING_CODES.has(x.code) && x.refs.includes(id))?.code
      if (box && code)
        entries.push({
          key: `halo:${id}`,
          label: { text: `${id}: ${code}`, at: topOf(box), kind: 'halo' }
        })
    }
    const key = `${i.doc.boards.length}:${entries.map((e) => e.key).join()}`
    if (key === this.tagKeys && this.cache?.doc === this.tagDoc) {
      this.tags.retext(entries.map((e) => e.label))
      return
    }
    this.tagKeys = key
    this.tagDoc = this.cache?.doc ?? null
    this.tags.set(entries.map((e) => e.label))
    this.invalidate()
  }

  /** A diverged net's detail and its top ranked causes, asked for once. */
  private divergence(
    i: SimInputs,
    pin: number,
    state: Extract<NetState, { state: 'diverged' }>
  ): string[] {
    const causes = i.sense.candidates[pin]
    if (causes === undefined) i.sense.findCauses(pin)
    const lines = [`Board Sense: ${state.kind}, ${state.detail}`]
    if (Array.isArray(causes))
      causes
        .slice(0, CAUSES_SHOWN)
        .forEach((group, n) => lines.push(`${n + 1}. ${group.candidates[0]!.text}`))
    else lines.push('(finding causes)')
    return lines
  }
}

const volts = (v: number): string => `${v.toFixed(2)} V`

/** The middle of a selection box's top face. */
const topOf = (box: Matrix4): Vector3 => {
  const [at, , size] = [new Vector3(), new Quaternion(), new Vector3()]
  box.decompose(at, new Quaternion(), size)
  return at.setY(at.y + size.y / 2)
}
