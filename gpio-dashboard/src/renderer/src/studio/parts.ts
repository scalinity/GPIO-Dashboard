// Part bodies and their leads (SPEC 10.4, 10.6, 11.3). A part's model comes from parts/index.json,
// chosen by its props, and every copy of one file is drawn by one set of instanced meshes. Each
// footprint seats as the part contract says: a rigid part's origin on its first pin's hole; a
// flexible two-lead part between its holes at its seat height, turned to them (an axial body whose
// holes are too close to lie between stands on end); an off-board module on the table, its first
// pin at the document's pose. Leads run from each pin empty into its hole. A part with no model
// still gets its leads, as short stubs out of its holes.
import {
  Color,
  type Group,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  type Texture,
  Vector3
} from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { boardDef } from '../core/defs/boards'
import { holePosition } from '../core/geometry/breadboard'
import type { CircuitDoc, HoleRef, PartDef, PartInstance } from '../core/model/types'
import { toTable } from '../core/reach/reach'
import { resistorBands } from '../core/steps/steps'
import type { Placement } from './cables'
import {
  defOf,
  holeInScene,
  type ModulePinFrame,
  moduleRestMm,
  poseMatrix,
  setModuleModel
} from './coords'
import { ModelInstances } from './instances'
import { bentLeadGeometry, leadDiameterMm, leadPath, RADIAL } from './leads'
import { modelNow, type PartFile, partIndexNow } from './loaders'

/** Per-copy controls for a placed part's model, for the sim-driven visuals (SPEC 10.6, 11.5). */
export interface PartHandle {
  /** The names its meshes, nodes and materials go by (`lens`, `band-1`, `seg-a`, `horn`…). */
  readonly names: string[]
  /** Base colour of everything called `name`; null restores the model's. */
  setColor(name: string, color: Color | null): void
  /** Light emitted by everything called `name`, linear (bloom picks up what passes BLOOM_THRESHOLD); null is off. */
  setEmission(name: string, color: Color | null): void
  /**
   * A transform after node `name`'s own, in the node's frame in mm about its origin (a plunger's
   * travel, a horn's turn); null restores it.
   */
  setTransform(name: string, matrix: Matrix4 | null): void
  /** A texture only this part's copy has, as the colour and emission map of `name`; null restores. */
  setTexture(name: string, texture: Texture | null): void
}

/** The 4-band code's colours (sRGB), for the resistor's rings. */
const BAND: Record<string, string> = {
  black: '#1b1b1b',
  brown: '#6e3b17',
  red: '#c41e1a',
  orange: '#ef7212',
  yellow: '#f2cf1a',
  green: '#1f9b45',
  blue: '#1f4fc8',
  violet: '#7a2fc4',
  grey: '#8a8a8e',
  white: '#ecece8',
  gold: '#c9a23a',
  silver: '#c4c4cc'
}

/** An LED lens's tint per colour option (sRGB): diffused epoxy of that colour, white water-clear. */
export const LENS: Record<string, string> = {
  red: '#ff2a1f',
  green: '#2bd14b',
  blue: '#2a5cff',
  yellow: '#ffd21a',
  white: '#f4f6ff'
}

const LEAD_COLOR = new Color().setRGB(0.674, 0.674, 0.711)
/** A part with no model shows its leads standing this far out of its holes. */
const STUB_MM = 3
const up = new Vector3(0, 1, 0)

interface Lead {
  pin: string
  /** The hole's centre on the board's top, in the scene. */
  hole: Vector3
  points: Vector3[]
}

interface Drawn {
  mesh: Mesh
  diameter: number
  /** Each lead's corners in the frame the mesh is placed by: a rigid move of the part leaves them be. */
  local: Vector3[][]
  /** The mesh's place before any lift. */
  at: Vector3
  ends: { pin: string; hole: Vector3; ring: number }[]
}

/** Corners that differ by less than this (mm) are the same lead. */
const SAME_MM = 1e-3

const sameLeads = (a: Vector3[][], b: Vector3[][]) =>
  a.length === b.length &&
  a.every(
    (lead, i) =>
      lead.length === b[i]!.length &&
      lead.every((p, j) => p.distanceToSquared(b[i]![j]!) < SAME_MM ** 2)
  )

interface Handled {
  color: Map<string, Color | null>
  emit: Map<string, Color | null>
  transform: Map<string, Matrix4 | null>
  texture: Map<string, Texture | null>
}

/** The file for a part, by its props; null when none is listed. */
function fileOf(
  index: Record<string, PartFile[]>,
  part: PartInstance,
  def: PartDef
): string | null {
  const prop = (k: string) => String(part.props[k] ?? def.properties[k]?.default)
  const entry = index[part.defId]?.find((e) =>
    Object.entries(e.when ?? {}).every(([k, v]) => prop(k) === v)
  )
  return entry ? `/models/parts/${entry.file}` : null
}

/** Colours that follow the part's value: the resistor's rings, an LED's lens. */
function valueColors(part: PartInstance, def: PartDef): [string, Color][] {
  if (def.sim.model === 'resistor') {
    const ohms = Number(part.props.resistance ?? def.properties.resistance?.default)
    const tolerance = String(part.props.tolerance ?? def.properties.tolerance?.default)
    const bands = resistorBands(ohms, tolerance)
    // Four rings are modelled (ADR-0031): a five-band value shows as its four-band reading.
    const rings =
      bands.length === 4 ? bands : [...resistorBands(ohms, '5%').slice(0, 3), bands.at(-1)!]
    return rings.map((c, i) => [`band-${i + 1}`, new Color(BAND[c] ?? '#808080')])
  }
  if (def.sim.model === 'led') {
    const color = String(part.props.color ?? def.properties.color?.default)
    return [['lens', new Color(LENS[color] ?? '#ffffff')]]
  }
  return []
}

/** A node's position and the way its +y points (a pin empty's lead axis), through `pose`. */
function frameOf(node: Matrix4, pose: Matrix4): { at: Vector3; dir: Vector3 } {
  const world = node.clone().premultiply(pose)
  return {
    at: new Vector3().setFromMatrixPosition(world),
    dir: up.clone().transformDirection(world)
  }
}

export class PartLayer {
  private readonly files = new Map<string, ModelInstances>()
  /** Each drawn part's copy: its file, its index there and its pose before any lift. */
  private readonly slots = new Map<string, { file: string; index: number; pose: Matrix4 }>()
  private readonly leads = new Map<string, Drawn>()
  private readonly handled = new Map<string, Handled>()
  private readonly modules = new Set<string>()
  private readonly leadMaterial = new MeshStandardNodeMaterial({
    color: LEAD_COLOR,
    metalness: 1,
    roughness: 0.3
  })
  private doc: CircuitDoc | null = null
  /** Parts whose model was still loading at the last update. */
  private loading = 0

  constructor(
    private readonly group: Group,
    private readonly invalidate: () => void
  ) {}

  /** Places every part of `doc`, each raised `lift(id)` mm (its insertion). */
  update(doc: CircuitDoc, lift: (id: string) => number): void {
    this.doc = doc
    const index = partIndexNow()
    this.loading = doc.parts.length
    if (index === undefined) return
    this.loading = 0
    const poses = new Map<string, { id: string; pose: Matrix4 }[]>()
    const seen = new Set<string>()
    for (const part of doc.parts) {
      const def = defOf(doc, part.defId)
      const file = index && fileOf(index, part, def)
      const model = file ? modelNow(file) : null
      if (model === undefined) {
        this.loading++
        continue
      }
      const instances = file && model ? this.instancesOf(file, model) : null
      const placed = this.place(doc, part, def, instances)
      if (!placed) continue
      seen.add(part.id)
      if (instances && placed.pose) {
        const list = poses.get(file!) ?? []
        list.push({ id: part.id, pose: placed.pose })
        poses.set(file!, list)
      }
      this.drawLeads(part.id, placed.leads, leadDiameterMm(def, part.props), placed.pose)
    }

    this.slots.clear()
    for (const [file, instances] of this.files) {
      const list = poses.get(file) ?? []
      if (!list.length) {
        instances.dispose()
        this.files.delete(file)
        continue
      }
      instances.set(list.map(({ id, pose }) => this.lifted(pose, lift(id))))
      list.forEach(({ id, pose }, index) => this.slots.set(id, { file, index, pose }))
      for (const { id } of list) this.apply(id)
    }
    for (const id of [...this.leads.keys()]) if (!seen.has(id)) this.removeLeads(id)
    for (const [id, drawn] of this.leads) this.lift(drawn, lift(id))
    for (const id of [...this.handled.keys()])
      if (!doc.parts.some((p) => p.id === id)) this.handled.delete(id)
  }

  /** Moves the parts being inserted to their current lift. */
  animate(lift: (id: string) => number): void {
    for (const [id, slot] of this.slots)
      this.files.get(slot.file)!.move(slot.index, this.lifted(slot.pose, lift(id)))
    for (const [id, drawn] of this.leads) this.lift(drawn, lift(id))
  }

  /** Whether every part's model has settled, so each body is where it will stay. */
  get ready(): boolean {
    return this.loading === 0
  }

  /** The drawn bodies, each raised `lift(id)` mm, as collider placements. */
  placements(lift: (id: string) => number): Placement[] {
    return [...this.slots].map(([id, { file, pose }]) => ({
      key: id,
      url: file.replace(/\.glb$/, '.colliders.json'),
      pose: this.lifted(pose, lift(id))
    }))
  }

  /** The handle for a placed part's model, or null when it has none drawn. */
  handle(id: string): PartHandle | null {
    const slot = this.slots.get(id)
    if (!slot) return null
    const state = (): Handled => {
      let h = this.handled.get(id)
      if (!h)
        this.handled.set(
          id,
          (h = { color: new Map(), emit: new Map(), transform: new Map(), texture: new Map() })
        )
      return h
    }
    // The copy is looked up again on each call: a redraw can move it in its file.
    const copy = () => {
      const now = this.slots.get(id)
      return now && { at: now.index, instances: this.files.get(now.file)! }
    }
    return {
      names: this.files.get(slot.file)!.names(),
      setColor: (name, color) => {
        state().color.set(name, color)
        this.reapplyColor(id, name)
        this.invalidate()
      },
      setEmission: (name, color) => {
        state().emit.set(name, color)
        const c = copy()
        c?.instances.emit(c.at, name, color)
        this.invalidate()
      },
      setTransform: (name, matrix) => {
        state().transform.set(name, matrix)
        const c = copy()
        c?.instances.transform(c.at, name, matrix)
        this.invalidate()
      },
      setTexture: (name, texture) => {
        state().texture.set(name, texture)
        const c = copy()
        c?.instances.texture(c.at, name, texture)
        this.invalidate()
      }
    }
  }

  /** How many copies each file draws (tests). */
  copies(): Record<string, number> {
    return Object.fromEntries([...this.files].map(([file, i]) => [file.split('/').pop()!, i.count]))
  }

  /** Whether part `id` has a body drawn, and how many leads. */
  drawn(id: string): { body: boolean; leads: number } {
    return { body: this.slots.has(id), leads: this.leads.get(id)?.ends.length ?? 0 }
  }

  /**
   * Each lead's end as drawn, measured from its mesh: the centre of the tube's last ring, against
   * the hole's centre (sideways) and the board's top (depth).
   */
  leadEnds(): { id: string; offAxisMm: number; depthMm: number }[] {
    const out: { id: string; offAxisMm: number; depthMm: number }[] = []
    const v = new Vector3()
    for (const [id, { mesh, ends }] of this.leads) {
      mesh.updateMatrixWorld(true)
      const position = mesh.geometry.getAttribute('position')
      for (const { pin, hole, ring } of ends) {
        const end = new Vector3()
        for (let k = 0; k < RADIAL; k++) end.add(v.fromBufferAttribute(position, ring + k))
        end.divideScalar(RADIAL).applyMatrix4(mesh.matrixWorld)
        out.push({
          id: `${id}.${pin}`,
          offAxisMm: Math.hypot(end.x - hole.x, end.z - hole.z),
          depthMm: hole.y - end.y
        })
      }
    }
    return out
  }

  /** Frees the GPU side; the next update draws everything again. */
  dispose(): void {
    for (const instances of this.files.values()) instances.dispose()
    this.files.clear()
    this.slots.clear()
    for (const id of [...this.leads.keys()]) this.removeLeads(id)
    this.leadMaterial.dispose()
  }

  private instancesOf(file: string, model: Group): ModelInstances {
    let instances = this.files.get(file)
    if (!instances) this.files.set(file, (instances = new ModelInstances(this.group, model)))
    return instances
  }

  private lifted(pose: Matrix4, lift: number): Matrix4 {
    return lift ? pose.clone().premultiply(new Matrix4().makeTranslation(0, lift, 0)) : pose
  }

  /** Part `id`'s colour of `name`: what the handle set, else the value's, else the model's. */
  private reapplyColor(id: string, name: string): void {
    const slot = this.slots.get(id)
    const part = this.doc?.parts.find((p) => p.id === id)
    if (!slot || !part) return
    const values = new Map(valueColors(part, defOf(this.doc!, part.defId)))
    const set = this.handled.get(id)?.color.get(name)
    this.files.get(slot.file)!.color(slot.index, name, set ?? values.get(name) ?? null)
  }

  /** The value's colours, then whatever the handle set, on part `id`'s copy. */
  private apply(id: string): void {
    const slot = this.slots.get(id)
    const part = this.doc?.parts.find((p) => p.id === id)
    if (!slot || !part) return
    const instances = this.files.get(slot.file)!
    const values = new Map(valueColors(part, defOf(this.doc!, part.defId)))
    const h = this.handled.get(id)
    for (const name of new Set([...values.keys(), ...(h?.color.keys() ?? [])]))
      instances.color(slot.index, name, h?.color.get(name) ?? values.get(name) ?? null)
    h?.emit.forEach((c, name) => instances.emit(slot.index, name, c))
    h?.transform.forEach((m, name) => instances.transform(slot.index, name, m))
    h?.texture.forEach((t, name) => instances.texture(slot.index, name, t))
  }

  /** The body's pose and the leads' paths; null when the part cannot be placed yet. */
  private place(
    doc: CircuitDoc,
    part: PartInstance,
    def: PartDef,
    model: ModelInstances | null
  ): { pose: Matrix4 | null; leads: Lead[] } | null {
    const pin = (id: string) => model?.node(`pin-${id}`) ?? null
    const pose = part.placement.offboardPose
    if (def.footprint.kind === 'offboard') {
      if (!pose || !model) return null
      const first = pin(def.pins[0]!.id)
      if (!first) return null
      const origin = new Vector3().setFromMatrixPosition(first).setY(0)
      this.recordModule(def, model, origin)
      return {
        pose: poseMatrix(pose, moduleRestMm(doc, part.defId, pose)).multiply(
          new Matrix4().makeTranslation(origin.negate())
        ),
        leads: []
      }
    }

    const holes = def.pins.map((p) => part.placement.pins[p.id] ?? null)
    if (holes.some((h) => !h)) return null
    const board = doc.boards.find((b) => b.id === holes[0]!.board)
    if (!board) return null
    const inScene = (h: HoleRef) => {
      const b = doc.boards.find((x) => x.id === h.board)
      return b ? holeInScene(b, h) : null
    }
    const points = holes.map((h) => inScene(h!))
    if (points.some((p) => !p)) return null
    const scene = points as Vector3[]

    let body: Matrix4 | null = null
    if (model && def.footprint.kind === 'rigid') {
      const bd = boardDef(board.defId)
      body = poseMatrix(
        {
          position: toTable(board.transform, holePosition(bd, holes[0]!)),
          rotationDeg: board.transform.rotationDeg + (part.placement.rotationDeg ?? 0)
        },
        bd.body.heightMm
      )
    } else if (model) body = this.flexPose(def, part, model, scene[0]!, scene[1]!)

    const leads = def.pins.map((p, i): Lead => {
      const hole = scene[i]!
      const empty = pin(p.id)
      const exit =
        body && empty
          ? frameOf(empty, body)
          : { at: hole.clone().setY(hole.y + STUB_MM), dir: up.clone().negate() }
      return { pin: p.id, hole, points: leadPath(exit.at, exit.dir, hole) }
    })
    return { pose: body, leads }
  }

  /**
   * A flexible two-lead part's pose: lifted by its seat height between its holes and turned to
   * them; an axial body too long for the gap stands on end over pins[0]'s hole.
   */
  private flexPose(
    def: PartDef,
    part: PartInstance,
    model: ModelInstances,
    p0: Vector3,
    p1: Vector3
  ): Matrix4 | null {
    const e0 = model.node(`pin-${def.pins[0]!.id}`)
    const e1 = model.node(`pin-${def.pins[1]!.id}`)
    if (!e0 || !e1) return null
    const identity = new Matrix4()
    const [a, b] = [frameOf(e0, identity), frameOf(e1, identity)]
    const seat = Number(model.extras.seatMm ?? 0)
    const along = p1.clone().sub(p0).setY(0)
    const gap = along.length()
    const u = gap > 1e-6 ? along.normalize() : new Vector3(1, 0, 0)
    const axial = Math.abs(a.dir.y) < 0.5
    const room = a.at.distanceTo(b.at) + 2 * leadDiameterMm(def, part.props)
    if (axial && gap < room) {
      // On end: the body's axis (model x) up, pins[0]'s end down over its hole.
      const rotation = new Matrix4().makeBasis(
        up,
        u.clone().negate(),
        up.clone().cross(u.clone().negate())
      )
      const lowest = a.at.clone().applyMatrix4(rotation)
      const origin = p0
        .clone()
        .setY(p0.y + seat)
        .sub(lowest)
      return rotation.setPosition(origin)
    }
    const turn = Math.atan2(-u.z, u.x)
    return new Matrix4().makeRotationY(turn).setPosition(
      p0
        .clone()
        .add(p1)
        .multiplyScalar(0.5)
        .setY(p0.y + seat)
    )
  }

  /**
   * Tells coords where a module's pins are (heights and axes) and what it covers, measured from its
   * first pin, once its model is known.
   */
  private recordModule(def: PartDef, model: ModelInstances, origin: Vector3): void {
    if (this.modules.has(def.id)) return
    this.modules.add(def.id)
    const pins: Record<string, ModulePinFrame> = {}
    for (const p of def.pins) {
      const node = model.node(`pin-${p.id}`)
      if (!node) continue
      const { at, dir } = frameOf(node, new Matrix4())
      pins[p.id] = { at: at.sub(origin), axis: dir }
    }
    const { min, max } = model.bounds()
    const rect = {
      xMin: min.x - origin.x,
      xMax: max.x - origin.x,
      yMin: origin.z - max.z,
      yMax: origin.z - min.z
    }
    setModuleModel(def.id, { pins, rect, top: max.y })
  }

  /**
   * Draws a part's leads. Their corners are taken in `frame` (the body's pose, else the scene), so
   * a board dragged with its parts leaves them as they were: only the mesh moves. The tubes and
   * their GPU buffers are built again when a lead's shape changes.
   */
  private drawLeads(id: string, leads: Lead[], diameter: number, frame: Matrix4 | null): void {
    const inverse = frame?.clone().invert()
    const local = leads.map((l) =>
      l.points.map((p) => (inverse ? p.clone().applyMatrix4(inverse) : p))
    )
    const drawn = this.leads.get(id)
    if (drawn && drawn.diameter === diameter && sameLeads(drawn.local, local)) {
      drawn.ends.forEach((e, i) => (e.hole = leads[i]!.hole))
      this.pose(drawn, frame)
      return
    }
    this.removeLeads(id)
    if (!leads.length) return
    const tubes = local.map((points) => bentLeadGeometry(points, diameter / 2, diameter))
    const ends: Drawn['ends'] = []
    let offset = 0
    tubes.forEach((t, i) => {
      offset += t.getAttribute('position').count
      ends.push({ pin: leads[i]!.pin, hole: leads[i]!.hole, ring: offset - (RADIAL + 1) })
    })
    const mesh = new Mesh(mergeGeometries(tubes), this.leadMaterial)
    tubes.forEach((t) => t.dispose())
    // A lead is 0.5 mm thick, a texel of the key light's shadow map: it would only draw a smudge.
    mesh.receiveShadow = true
    this.group.add(mesh)
    const next: Drawn = { mesh, diameter, local, at: new Vector3(), ends }
    this.pose(next, frame)
    this.leads.set(id, next)
  }

  /** Puts the mesh in `frame`, the one its corners were taken in; `update` then lifts it. */
  private pose(drawn: Drawn, frame: Matrix4 | null): void {
    if (frame) frame.decompose(drawn.at, drawn.mesh.quaternion, new Vector3())
    else {
      drawn.at.set(0, 0, 0)
      drawn.mesh.quaternion.identity()
    }
    drawn.mesh.position.copy(drawn.at)
  }

  /** Raises a lead's mesh `mm` above its place (a part being inserted). */
  private lift(drawn: Drawn, mm: number): void {
    drawn.mesh.position.set(drawn.at.x, drawn.at.y + mm, drawn.at.z)
  }

  private removeLeads(id: string): void {
    const drawn = this.leads.get(id)
    if (!drawn) return
    this.group.remove(drawn.mesh)
    drawn.mesh.geometry.dispose()
    this.leads.delete(id)
  }
}
