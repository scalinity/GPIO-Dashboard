// Leads (SPEC 6.5, 10.4, 11.3): a Dupont housing at each end and the wire as a tube between the two
// housings' wire exits. A housing mates with what its end plugs into: a male end stands in a hole
// (or a module's socket) with its pin inside, a female end sits on a module's header pin. The
// housings are instanced. Until the physics lane simulates them, the wire follows a design curve,
// straight out of both housings and arched between them; the tube is built from any polyline, so
// simulated points can replace the design curve later.
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
  TubeGeometry,
  Vector3
} from 'three/webgpu'
import { float, fract, max, mix, step, uniform, uv, vec3 } from 'three/tsl'
import { partDef } from '../core/defs/parts'
import type { CircuitDoc, Endpoint, Wire } from '../core/model/types'
import { endpointInScene } from './coords'
import { ModelInstances } from './instances'
import { LEAD_DEPTH_MM } from './leads'
import { modelNow } from './loaders'

const RADIUS_MM = dupontJson.wire.outerDiameterMm / 2
/** Picking treats a lead as a capsule this much fatter than the wire. */
const PICK_RADIUS_MM = 1.5
const up = new Vector3(0, 1, 0)

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
  material: MeshBasicNodeMaterial
  phase: { value: number }
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

/** A round tube through a polyline. */
export function leadGeometry(points: Vector3[], radius = RADIUS_MM): TubeGeometry {
  return new TubeGeometry(new CatmullRomCurve3(points), points.length * 8, radius, 8)
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

/**
 * A housing's pose: a male's pin tip a pin's length into what it plugs into, a female's mouth a
 * pin's length down the pin it sits on; its axis along the end's, square to the board.
 */
export function housingPose(end: LeadEnd, lift = 0): Matrix4 {
  const depth = dupontJson.malePin.exposedMm - lift
  const q = new Quaternion()
    .setFromUnitVectors(up, end.axis)
    .multiply(new Quaternion().setFromAxisAngle(up, end.turn))
  return new Matrix4().compose(
    end.at.clone().addScaledVector(end.axis, -depth),
    q,
    new Vector3(1, 1, 1)
  )
}

const materials = new Map<string, MeshStandardNodeMaterial>()

function material(color: string): MeshStandardNodeMaterial {
  let m = materials.get(color)
  if (!m) {
    m = new MeshStandardNodeMaterial({ color: new Color(color), roughness: 0.55 })
    materials.set(color, m)
  }
  return m
}

interface Drawn {
  key: string
  mesh: Mesh
  points: Vector3[]
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

  /** Draws the document's leads, rebuilding only those whose ends, lifts or colour changed. */
  update(doc: CircuitDoc, lift: (key: string) => number): void {
    const genders = ['male', 'female'] as const
    for (const gender of genders) {
      const model = modelNow(`/models/dupont-${gender}.glb`)
      if (model && !this.housings[gender])
        this.housings[gender] = new ModelInstances(this.group, model)
    }
    const seen = new Set<string>()
    this.placed = { male: [], female: [] }
    for (const wire of doc.wires) {
      seen.add(wire.id)
      const a = leadEnd(doc, wire, wire.a)
      const b = leadEnd(doc, wire, wire.b)
      if (!a || !b) continue
      for (const [which, end] of [
        ['a', a],
        ['b', b]
      ] as const)
        if (end.gender) this.placed[end.gender].push({ key: `${wire.id}:${which}`, end })
      this.draw(wire, a, b, lift)
    }
    for (const id of [...this.drawn.keys()]) if (!seen.has(id)) this.remove(id)
    this.syncOverlays()
    for (const gender of genders)
      this.housings[gender]?.set(
        this.placed[gender].map(({ key, end }) => housingPose(end, lift(key)))
      )
  }

  /** Moves the ends being inserted to their current lift, and their wires with them. */
  animate(doc: CircuitDoc, lift: (key: string) => number): void {
    this.update(doc, lift)
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

  /** The polyline a lead is drawn along. */
  points(id: Wire['id']): Vector3[] | null {
    return this.drawn.get(id)?.points ?? null
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
  pick(ray: Ray): { id: string; distance: number } | null {
    let best: { id: string; distance: number } | null = null
    const onRay = new Vector3()
    const onSegment = new Vector3()
    for (const [id, { mesh }] of this.drawn) {
      const curve = (mesh.geometry as TubeGeometry).parameters.path
      const samples = curve.getSpacedPoints(48)
      for (let i = 1; i < samples.length; i++) {
        const d2 = ray.distanceSqToSegment(samples[i - 1]!, samples[i]!, onRay, onSegment)
        const distance = onRay.distanceTo(ray.origin)
        if (d2 <= PICK_RADIUS_MM ** 2 && (!best || distance < best.distance))
          best = { id, distance }
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

  private draw(wire: Wire, a: LeadEnd, b: LeadEnd, lift: (key: string) => number): void {
    const exits = [this.exit(a, lift(`${wire.id}:a`)), this.exit(b, lift(`${wire.id}:b`))] as const
    const key = JSON.stringify([exits, wire.color])
    if (this.drawn.get(wire.id)?.key === key) return
    this.remove(wire.id)
    const points = designCurve(exits[0], exits[1])
    const mesh = new Mesh(leadGeometry(points), material(wire.color))
    mesh.castShadow = true
    this.group.add(mesh)
    this.drawn.set(wire.id, { key, mesh, points })
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
    const phase = uniform(this.phases.get(id) ?? 0)
    const repeat = uniform(new CatmullRomCurve3(drawn.points).getLength() / DASH_PERIOD_MM)
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
    const mesh = new Mesh(leadGeometry(drawn.points, RADIUS_MM * OVERLAY_SCALE), material)
    mesh.renderOrder = 1
    this.group.add(mesh)
    const o: Overlay = { mesh, material, phase, flow, tint, tintAmount, rate: 0 }
    this.overlays.set(id, o)
    return o
  }

  private removeOverlay(id: string): void {
    const o = this.overlays.get(id)
    if (!o) return
    this.group.remove(o.mesh)
    o.mesh.geometry.dispose()
    o.material.dispose()
    this.overlays.delete(id)
  }

  private remove(id: string): void {
    this.removeOverlay(id)
    const drawn = this.drawn.get(id)
    if (!drawn) return
    this.group.remove(drawn.mesh)
    drawn.mesh.geometry.dispose()
    this.drawn.delete(id)
  }
}
