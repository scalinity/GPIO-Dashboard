// Leads (SPEC 6.5, 10.4, 10.5, 11.3): a Dupont housing at each end and the wire as a tube between the
// two housings' wire exits. A housing mates with what its end plugs into: a male end stands in a
// hole (or a module's socket) with its pin inside, a female end sits on a module's header pin. The
// housings are instanced. A committed lead is simulated: its housings are the solver's anchors and
// colliders, and its tube follows the worker's particles. A lead that only a preview holds (a
// ghost) is not: it follows a design curve, straight out of both housings and arched between them,
// until it is committed and drops into place.
import dupontJson from '../content/leads/dupont.json'
import {
  CatmullRomCurve3,
  Color,
  type Group,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Quaternion,
  type Ray,
  Vector3
} from 'three/webgpu'
import { float, fract, max, mix, step, uniform, uv, vec3 } from 'three/tsl'
import { partDef } from '../core/defs/parts'
import type { CircuitDoc, Endpoint, Wire } from '../core/model/types'
import { leadReach } from '../core/reach/reach'
import { type CableIn, type CableState, corePose, fromCore, type Placement, toCore } from './cables'
import { endpointInScene } from './coords'
import { ModelInstances } from './instances'
import { LEAD_DEPTH_MM } from './leads'
import { modelNow } from './loaders'
import { Tube } from './tube'

const RADIUS_MM = dupontJson.wire.outerDiameterMm / 2
/** Picking treats a lead as a capsule this much fatter than the wire. */
const PICK_RADIUS_MM = 1.5
const up = new Vector3(0, 1, 0)
/** A housing's collider stops this far short of its wire exit, so its own wire never touches it. */
const HOUSING_TRIM_MM = RADIUS_MM + 0.25
/** A solid jumper's simulated part starts this far up out of its holes, clear of the board. */
const JUMPER_CLEAR_MM = RADIUS_MM + 0.25
/** Points along a design curve's tube. */
const DESIGN_POINTS = 48
/** An over-span lead is tinted toward this red (SPEC 10.5). */
const TAUT = new Color('#ff2a2a')

/** Current flow (SPEC 11.5): dashes this far apart travel along a lead at this speed per mA. */
const DASH_PERIOD_MM = 5
const DASH_MM_PER_S_PER_MA = 4
const DASH_MAX_MM_PER_S = 80
/** Below this a lead shows no flow. */
const VISIBLE_A = 1e-5
const OVERLAY_SCALE = 1.3
const DASH_COLOR = new Color(1, 0.85, 0.35).multiplyScalar(2.5)
const TINT_ALPHA = 0.55

/** What a lead's overlay shows: the current in it (a to b, amps) and the tint over it, if any. */
export interface WireFxState {
  amps: number
  tint: Color | null
}

/** A lead's overlay tube: its dashes (a TSL offset along the tube's uv) and its tint. */
interface Overlay {
  mesh: Mesh
  tube: Tube
  material: MeshBasicNodeMaterial
  phase: { value: number }
  repeat: { value: number }
  flow: { value: number }
  tint: { value: Color }
  tintAmount: { value: number }
  /** Dash periods per second, signed: positive runs from end a to end b. */
  rate: number
}

export type Gender = 'male' | 'female'

/** One end of a lead: where it mates, the way its housing points out, and the housing's kind. */
export interface LeadEnd {
  at: Vector3
  axis: Vector3
  turn: number
  /** Null for a solid jumper, which has no housing. */
  gender: Gender | null
}

/** Where a wire leaves its end, and the way it leaves. */
export interface Exit {
  at: Vector3
  dir: Vector3
}

/** The design curve between two exits: straight out of each, then an arch rising with the gap. */
export function designCurve(a: Exit, b: Exit): Vector3[] {
  const rise = dupontJson.minBendRadiusMm
  const [a1, b1] = [
    a.at.clone().addScaledVector(a.dir, rise),
    b.at.clone().addScaledVector(b.dir, rise)
  ]
  const height = Math.min(40, 0.25 * a1.distanceTo(b1))
  const arch = [0.25, 0.5, 0.75].map((t) =>
    a1
      .clone()
      .lerp(b1, t)
      .setY(a1.y + (b1.y - a1.y) * t + height * 4 * t * (1 - t))
  )
  return [a.at.clone(), a1, ...arch, b1, b.at.clone()]
}

/** The design curve as evenly spaced points along a smooth curve through it. */
const spaced = (a: Exit, b: Exit) =>
  new CatmullRomCurve3(designCurve(a, b)).getSpacedPoints(DESIGN_POINTS)

const pathLength = (points: Vector3[]) =>
  points.reduce((s, p, i) => (i ? s + p.distanceTo(points[i - 1]!) : 0), 0)

/**
 * Where a lead with route hints starts in the solver: `length` mm of wire out of both exits and
 * through its hints, each span between them bowed upward until the whole is that long, so it drops
 * onto the hints. Opening a project and committing a hint both start the lead here, so a reopened
 * project shows the lead as it was left.
 */
export function routeGuess(a: Exit, b: Exit, hints: Vector3[], length: number): Vector3[] {
  const rise = dupontJson.minBendRadiusMm
  const through = [
    a.at,
    a.at.clone().addScaledVector(a.dir, rise),
    ...hints,
    b.at.clone().addScaledVector(b.dir, rise),
    b.at
  ]
  const spans = through.length - 1
  const base = new CatmullRomCurve3(through).getPoints(16 * spans)
  const bowed = (s: number) =>
    base.map((p, j) => {
      const t = (j / (base.length - 1)) * spans
      const i = Math.min(Math.floor(t), spans - 1)
      const u = t - i
      if (i === 0 || i === spans - 1) return p
      return p.clone().setY(p.y + s * through[i]!.distanceTo(through[i + 1]!) * 4 * u * (1 - u))
    })
  let [lo, hi] = [0, 4]
  if (pathLength(bowed(0)) >= length) return base
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2
    if (pathLength(bowed(mid)) < length) lo = mid
    else hi = mid
  }
  return bowed(hi)
}

/** A lead end's place and housing: male into a hole or a female socket, female onto a male pin. */
export function leadEnd(doc: CircuitDoc, wire: Wire, end: Endpoint): LeadEnd | null {
  const place = endpointInScene(doc, end)
  if (!place) return null
  if (wire.kind === 'solid-arc' || wire.kind === 'solid-flat') return { ...place, gender: null }
  const part = 'pin' in end ? doc.parts.find((p) => p.id === end.pin.part) : undefined
  const connector =
    part && 'pin' in end
      ? partDef(part.defId).pins.find((p) => p.id === end.pin.pin)?.connector
      : null
  return { ...place, gender: connector === 'male-pin' ? 'female' : 'male' }
}

/** A housing's turn: its axis along the end's, square to the board. */
function housingTurn(end: LeadEnd): Quaternion {
  return new Quaternion()
    .setFromUnitVectors(up, end.axis)
    .multiply(new Quaternion().setFromAxisAngle(up, end.turn))
}

/**
 * A housing's pose: a male's pin tip a pin's length into what it plugs into, a female's mouth a
 * pin's length down the pin it sits on; its axis along the end's, square to the board.
 */
export function housingPose(end: LeadEnd, lift = 0): Matrix4 {
  const depth = dupontJson.malePin.exposedMm - lift
  return new Matrix4().compose(
    end.at.clone().addScaledVector(end.axis, -depth),
    housingTurn(end),
    new Vector3(1, 1, 1)
  )
}

const materials = new Map<string, MeshStandardNodeMaterial>()

/** A lead's wire: its colour, or tinted red while it is over-span. */
function material(color: string, taut = false): MeshStandardNodeMaterial {
  const key = `${color}${taut ? ':taut' : ''}`
  let m = materials.get(key)
  if (!m) {
    m = new MeshStandardNodeMaterial({
      color: taut ? new Color(color).lerp(TAUT, 0.7) : new Color(color),
      roughness: 0.55
    })
    if (taut) m.emissive = TAUT.clone().multiplyScalar(0.25)
    materials.set(key, m)
  }
  return m
}

interface Drawn {
  wire: Wire
  mesh: Mesh
  tube: Tube
  /** The points the tube was last fitted to. */
  points: Vector3[]
  ends: [LeadEnd, LeadEnd]
  exits: [Exit, Exit]
  /** The solver's anchor frames, in the scene: a housing's base with its axis as local y. */
  frames: [Matrix4, Matrix4]
  /** Each end's housing pose, as drawn, or null for a solid jumper. */
  housings: [Matrix4 | null, Matrix4 | null]
  /** The wire between the housings, mm (`wireLengthMm`). */
  wireMm: number
  /** The lead as committed, which the solver runs; null for a ghost. */
  committed: Wire | null
  /** What a ghost's design curve was fitted for. */
  design: string
  taut: boolean
}

export class WireLayer {
  private drawn = new Map<string, Drawn>()
  /** The housings, one copy per end of each gender (tests read them). */
  readonly housings: Record<Gender, ModelInstances | null> = { male: null, female: null }
  /** Each copy's end, in copy order, for animating and measuring. */
  private placed: Record<Gender, { key: string; end: LeadEnd }[]> = { male: [], female: [] }
  private fx = new Map<string, WireFxState>()
  private readonly overlays = new Map<string, Overlay>()
  /** Each lead's dash phase, kept while its overlay is rebuilt. */
  private readonly phases = new Map<string, number>()

  constructor(private readonly group: Group) {}

  /**
   * Places the document's leads and their housings, each end raised `lift(key)` mm. The leads that
   * `committed` holds follow the solver; the rest (ghosts) follow their design curves.
   */
  update(
    doc: CircuitDoc,
    lift: (key: string) => number,
    committed: (id: string) => Wire | null
  ): void {
    const genders = ['male', 'female'] as const
    for (const gender of genders) {
      const model = modelNow(`/models/dupont-${gender}.glb`)
      if (model && !this.housings[gender])
        this.housings[gender] = new ModelInstances(this.group, model)
    }
    const wireMm = new Map(leadReach(doc, partDef).map((r) => [r.wire, r.wireMm]))
    const seen = new Set<string>()
    this.placed = { male: [], female: [] }
    for (const wire of doc.wires) {
      const a = leadEnd(doc, wire, wire.a)
      const b = leadEnd(doc, wire, wire.b)
      if (!a || !b) continue
      seen.add(wire.id)
      const lifts = [lift(`${wire.id}:a`), lift(`${wire.id}:b`)] as const
      for (const [which, end] of [
        ['a', a],
        ['b', b]
      ] as const)
        if (end.gender) this.placed[end.gender].push({ key: `${wire.id}:${which}`, end })
      this.draw(wire, [a, b], lifts, wireMm.get(wire.id) ?? 0, committed(wire.id))
    }
    for (const id of [...this.drawn.keys()]) if (!seen.has(id)) this.remove(id)
    this.syncOverlays()
    for (const gender of genders)
      this.housings[gender]?.set(
        this.placed[gender].map(({ key, end }) => housingPose(end, lift(key)))
      )
  }

  /**
   * Fits each simulated lead to its particles. Until the settled scene is `ready` they are hidden;
   * after that, one the solver has not reached yet keeps what it last showed (a committed ghost's
   * design curve until it drops).
   */
  simulate(state: (id: string) => CableState | null, ready: boolean): void {
    for (const [id, d] of this.drawn) {
      if (!d.committed) continue
      const s = ready ? state(id) : null
      d.mesh.visible = ready && (!!s || d.points.length > 0)
      const o = this.overlays.get(id)
      if (o) o.mesh.visible = d.mesh.visible
      if (!s) continue
      const { body, positions } = s
      const points: Vector3[] = []
      for (let i = body.wireStart; i < body.wireEnd; i++)
        points.push(fromCore(positions, body.offset + i))
      // The ends are where the housings are drawn now, which the worker may not have caught up with.
      if (d.ends[0].gender) points[0]!.copy(d.exits[0].at)
      else points.unshift(d.exits[0].at.clone())
      if (d.ends[1].gender) points[points.length - 1]!.copy(d.exits[1].at)
      else points.push(d.exits[1].at.clone())
      this.fit(d, points)
      if (body.taut !== d.taut) {
        d.taut = body.taut
        d.mesh.material = material(d.wire.color, d.taut)
      }
    }
  }

  /**
   * The simulated leads, as the solver's cables: anchors, length and route hints. A drag's hints
   * pull the lead as it goes; committed hints start it afresh from its route (`routeGuess`).
   */
  cables(): CableIn[] {
    const out: CableIn[] = []
    for (const [id, d] of this.drawn) {
      if (!d.committed) continue
      const [a, b] = [corePose(d.frames[0]), corePose(d.frames[1])]
      if (d.ends[0].gender) {
        const hints = [...(d.wire.routeHints ?? [])]
        const routed = d.committed.routeHints ?? []
        const through = routed.map(([x, y, z]) => new Vector3(x, z, -y))
        out.push({
          key: id,
          build: `lead ${d.wireMm} ${JSON.stringify(routed)}`,
          spec: {
            kind: 'lead',
            a,
            b,
            lengthMm: d.wireMm,
            hints,
            ...(routed.length && {
              guess: routeGuess(d.exits[0], d.exits[1], through, d.wireMm).map(toCore)
            })
          }
        })
        continue
      }
      // A solid jumper keeps its authored shape: the design curve between its holes.
      const at = (m: Matrix4): Exit => ({
        at: new Vector3().setFromMatrixPosition(m),
        dir: up.clone().transformDirection(m)
      })
      const shape = spaced(at(d.frames[0]), at(d.frames[1])).map(toCore)
      out.push({ key: id, build: JSON.stringify(shape), spec: { kind: 'jumper', a, b, shape } })
    }
    return out
  }

  /** The simulated leads' housings, as collider placements. */
  placements(): Placement[] {
    const out: Placement[] = []
    for (const [id, d] of this.drawn) {
      if (!d.committed) continue
      d.ends.forEach((end, i) => {
        const pose = d.housings[i]
        if (end.gender && pose)
          out.push({
            key: `${id}:${i ? 'b' : 'a'}`,
            url: `/models/dupont-${end.gender}.colliders.json`,
            pose,
            trimTopMm: HOUSING_TRIM_MM
          })
      })
    }
    return out
  }

  /** Where the simulated leads leave their housings: the solver clamps them there. */
  exits(): Vector3[] {
    return [...this.drawn.values()].flatMap((d) => (d.committed ? d.exits.map((e) => e.at) : []))
  }

  /** Whether the housings' models have settled, so the exits are where they will stay. */
  get ready(): boolean {
    return [...this.drawn.values()].every((d) =>
      d.ends.every((e) => !e.gender || modelNow(`/models/dupont-${e.gender}.glb`) !== undefined)
    )
  }

  /** Sets what the leads' overlays show; a lead absent from `fx` shows nothing. */
  setFx(fx: Map<string, WireFxState>): void {
    this.fx = fx
    this.syncOverlays()
  }

  /** Moves the dashes on by `dt` seconds; whether any lead still has current flowing. */
  step(dt: number): boolean {
    let flowing = false
    for (const [id, o] of this.overlays) {
      if (!o.rate) continue
      flowing = true
      const phase = ((this.phases.get(id) ?? 0) + o.rate * dt) % 1
      this.phases.set(id, phase)
      o.phase.value = phase
    }
    return flowing
  }

  /** What each lead's overlay shows (tests): the current and the dashes' speed in mm/s. */
  flowReport(): Record<string, { amps: number; mmPerS: number }> {
    return Object.fromEntries(
      [...this.overlays].map(([id, o]) => [
        id,
        { amps: this.fx.get(id)?.amps ?? 0, mmPerS: o.rate * DASH_PERIOD_MM }
      ])
    )
  }

  /** The smoothed centreline a lead is drawn along. */
  points(id: Wire['id']): Vector3[] | null {
    const d = this.drawn.get(id)
    return d?.mesh.visible ? d.tube.line : null
  }

  /** Every male pin tip in a hole as drawn, against its hole: sideways, and its depth (tests). */
  maleTips(): { id: string; offAxisMm: number; depthMm: number }[] {
    const housings = this.housings.male
    if (!housings) return []
    return this.placed.male.flatMap(({ key, end }, i) => {
      if (Math.abs(end.axis.y - 1) > 1e-6) return []
      const tip = new Vector3().setFromMatrixPosition(housings.drawnPose(i))
      return [
        {
          id: key.replace(':', '.'),
          offAxisMm: Math.hypot(tip.x - end.at.x, tip.z - end.at.z),
          depthMm: end.at.y - tip.y
        }
      ]
    })
  }

  /** The lead nearest along the ray whose capsule it passes through, with that distance. */
  pick(ray: Ray): { id: string; distance: number; at: Vector3 } | null {
    let best: { id: string; distance: number; at: Vector3 } | null = null
    const onRay = new Vector3()
    const onSegment = new Vector3()
    for (const [id, { mesh, tube }] of this.drawn) {
      if (!mesh.visible) continue
      const line = tube.line
      for (let i = 1; i < line.length; i++) {
        const d2 = ray.distanceSqToSegment(line[i - 1]!, line[i]!, onRay, onSegment)
        const distance = onRay.distanceTo(ray.origin)
        if (d2 <= PICK_RADIUS_MM ** 2 && (!best || distance < best.distance))
          best = { id, distance, at: onSegment.clone() }
      }
    }
    return best
  }

  /** Frees the GPU side; the next update draws everything again. */
  dispose(): void {
    for (const id of [...this.drawn.keys()]) this.remove(id)
    for (const id of [...this.overlays.keys()]) this.removeOverlay(id)
    for (const gender of ['male', 'female'] as const) this.housings[gender]?.dispose()
    this.housings.male = this.housings.female = null
    materials.forEach((m) => m.dispose())
  }

  private draw(
    wire: Wire,
    ends: [LeadEnd, LeadEnd],
    lifts: readonly [number, number],
    wireMm: number,
    committed: Wire | null
  ): void {
    const exits: Drawn['exits'] = [this.exit(ends[0], lifts[0]), this.exit(ends[1], lifts[1])]
    const frames: Drawn['frames'] = [
      this.frame(ends[0], exits[0], lifts[0]),
      this.frame(ends[1], exits[1], lifts[1])
    ]
    const housing = (i: 0 | 1) => (ends[i].gender ? housingPose(ends[i], lifts[i]) : null)
    const housings: Drawn['housings'] = [housing(0), housing(1)]
    let d = this.drawn.get(wire.id)
    if (!d) {
      const tube = new Tube(RADIUS_MM)
      const mesh = new Mesh(tube.geometry, material(wire.color))
      mesh.castShadow = true
      mesh.frustumCulled = false
      mesh.visible = false
      this.group.add(mesh)
      d = {
        wire,
        mesh,
        tube,
        points: [],
        ends,
        exits,
        frames,
        housings,
        wireMm,
        committed,
        design: '',
        taut: false
      }
      this.drawn.set(wire.id, d)
    }
    Object.assign(d, { wire, ends, exits, frames, housings, wireMm, committed })
    if (!committed) d.taut = false
    d.mesh.material = material(wire.color, d.taut)
    if (committed) {
      d.design = ''
      return
    }
    const design = JSON.stringify(d.exits)
    if (d.design !== design) {
      d.design = design
      this.fit(d, spaced(d.exits[0], d.exits[1]))
    }
    d.mesh.visible = true
    const o = this.overlays.get(wire.id)
    if (o) o.mesh.visible = true
  }

  /** Refits a lead's tube, and its overlay's, to `points`. */
  private fit(d: Drawn, points: Vector3[]): void {
    d.points = points
    const reference = new Vector3().setFromMatrixColumn(d.frames[0], 0)
    d.tube.fit(points, reference)
    const o = this.overlays.get(d.wire.id)
    if (o) {
      o.tube.fit(points, reference)
      o.repeat.value = o.tube.length / DASH_PERIOD_MM
    }
  }

  /** Where the wire leaves an end: its housing's `wire` empty, or a solid jumper's hole. */
  private exit(end: LeadEnd, lift: number): Exit {
    if (!end.gender)
      return { at: end.at.clone().addScaledVector(end.axis, lift - LEAD_DEPTH_MM), dir: end.axis }
    const wire = this.housings[end.gender]?.node('wire')
    const fallback =
      dupontJson.housing.lengthMm + (end.gender === 'male' ? dupontJson.malePin.exposedMm : 0)
    const along = wire ? new Vector3().setFromMatrixPosition(wire).y : fallback
    return { at: new Vector3(0, along, 0).applyMatrix4(housingPose(end, lift)), dir: end.axis }
  }

  /**
   * The solver's frame at an end (physics/types: +z along the housing, its origin at the housing's
   * base, so the wire leaves a housing length out): one housing length back from the exit. A solid
   * jumper's starts just above its hole.
   */
  private frame(end: LeadEnd, exit: Exit, lift: number): Matrix4 {
    const origin = end.gender
      ? exit.at.clone().addScaledVector(end.axis, -dupontJson.housing.lengthMm)
      : end.at.clone().addScaledVector(end.axis, lift + JUMPER_CLEAR_MM)
    return new Matrix4().compose(origin, housingTurn(end), new Vector3(1, 1, 1))
  }

  /** Builds, updates and frees the overlay of each drawn lead from `fx`. */
  private syncOverlays(): void {
    for (const [id, drawn] of this.drawn) {
      const state = this.fx.get(id)
      const flowing = !!state && Math.abs(state.amps) >= VISIBLE_A
      if (!state || (!flowing && !state.tint)) {
        this.removeOverlay(id)
        continue
      }
      let o = this.overlays.get(id)
      if (!o) o = this.addOverlay(id, drawn)
      o.flow.value = flowing ? 1 : 0
      o.rate = flowing
        ? Math.sign(state.amps) *
          (Math.min(Math.abs(state.amps) * 1000 * DASH_MM_PER_S_PER_MA, DASH_MAX_MM_PER_S) /
            DASH_PERIOD_MM)
        : 0
      o.tintAmount.value = state.tint ? TINT_ALPHA : 0
      if (state.tint) o.tint.value.copy(state.tint)
    }
    for (const id of [...this.overlays.keys()]) if (!this.drawn.has(id)) this.removeOverlay(id)
  }

  private addOverlay(id: string, drawn: Drawn): Overlay {
    const tube = new Tube(RADIUS_MM * OVERLAY_SCALE)
    if (drawn.points.length)
      tube.fit(drawn.points, new Vector3().setFromMatrixColumn(drawn.frames[0], 0))
    const phase = uniform(this.phases.get(id) ?? 0)
    const repeat = uniform(tube.length / DASH_PERIOD_MM)
    const flow = uniform(0)
    const tint = uniform(new Color())
    const tintAmount = uniform(0)
    // A ramp that rises along the lead and drops sharply: its sharp edge leads, so the direction
    // reads even in a still picture.
    const f = fract(uv().x.mul(repeat).sub(phase))
    const dash = f
      .mul(2)
      .mul(float(1).sub(step(0.5, f)))
      .mul(flow)
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    material.colorNode = mix(tint, vec3(DASH_COLOR.r, DASH_COLOR.g, DASH_COLOR.b), dash.clamp())
    material.opacityNode = max(tintAmount, dash.mul(0.95))
    const mesh = new Mesh(tube.geometry, material)
    mesh.renderOrder = 1
    mesh.frustumCulled = false
    mesh.visible = drawn.mesh.visible
    this.group.add(mesh)
    const o: Overlay = { mesh, tube, material, phase, repeat, flow, tint, tintAmount, rate: 0 }
    this.overlays.set(id, o)
    return o
  }

  private removeOverlay(id: string): void {
    const o = this.overlays.get(id)
    if (!o) return
    this.group.remove(o.mesh)
    o.tube.dispose()
    o.material.dispose()
    this.overlays.delete(id)
  }

  private remove(id: string): void {
    this.removeOverlay(id)
    const drawn = this.drawn.get(id)
    if (!drawn) return
    this.group.remove(drawn.mesh)
    drawn.tube.dispose()
    this.drawn.delete(id)
  }
}
