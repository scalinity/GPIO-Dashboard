// The Studio's imperative side: the camera and its damped orbit, hover picking and highlights, the
// gestures that edit the document, the bench, parts and leads it draws, and the frame loop.
// Pointer and key handlers act directly on three objects and request a frame, so a hover shows on
// the very next frame (SPEC 11.3, acceptance 8) without waiting on React. Edits go through the
// studio store's edit(), one transaction each.
import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicNodeMaterial,
  LineSegments,
  PerspectiveCamera,
  Raycaster,
  type Scene,
  Vector2,
  type WebGPURenderer
} from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { boardDef } from '../core/defs/boards'
import { partDef } from '../core/defs/parts'
import { holeKey, isValidHole, parseHoleKey } from '../core/geometry/breadboard'
import { tboardPinHoles } from '../core/geometry/tboard'
import type { CircuitDoc, Endpoint, Op } from '../core/model/types'
import type { Problem } from '../core/ops/validate'
import { circuit } from '../state/circuit'
import { edit, type Selection, type Tool, useStudio } from '../state/studioStore'
import { BenchLayer } from './bench'
import { bodyBox, pickBody, pointsBox } from './bodies'
import { CameraTween, type Preset, presetView } from './camera'
import { endpointInScene, holeInScene } from './coords'
import { FrameLoop } from './frameLoop'
import {
  boardTop,
  type Gesture,
  grabVector,
  planePoint,
  type Pointer,
  type Proposal,
  propose
} from './gestures'
import { Insertion, reseated } from './insertion'
import { LabelLayer, labelsOf } from './labels'
import { configureModels, disposeModels, onArrival } from './loaders'
import { type Marker, Markers } from './markers'
import { type PartHandle, PartLayer } from './parts'
import { hoverInfo, type HoverInfo, pickHole, pickModulePin } from './picking'
import { holeFree, holeLegality, removePartOps, turned, turnedPart } from './placement'
import { Post } from './renderer'
import { setStatus } from './status'
import { WireLayer } from './wires'

const KEYS: Record<string, Preset> = { f: 'fit', 1: 'fit', 2: 'iso', 3: 'top', 4: 'front' }

// Markers are flat squares just above the board, a little larger than a hole (2.54 mm pitch).
const STRIP_SIZE_MM = 2.0
const WIRE_END_SIZE_MM = 2.6
const STRIP_COLOR = new Color('#818CF8') // accent-light
const WIRE_END_COLOR = new Color('#FBBF24')
const FOOTPRINT_SIZE_MM = 1.6
const PART_COLOR = new Color('#22D3EE')
const TBOARD_COLOR = new Color('#FCA5A5')
const GHOST_SIZE_MM = 2.3
const LEGAL = new Color('#22C55E')
const ILLEGAL = new Color('#EF4444')
/** A press that moves further than this, in pixels, is a drag rather than a click. */
const CLICK_PX = 4

/** What the last hover showed, and on which frame (tests read it). */
export interface HoverRecord {
  info: HoverInfo | null
  /** `loop.frames` when the hover changed. */
  eventFrame: number
  /** The first frame drawn with it; null until then. */
  shownFrame: number | null
}

/** What the bench draws, counted and measured from the scene (tests). */
export interface SceneReport {
  piPins: number
  tboards: number
  sockets: number
  ribbons: number
  /** The ribbon's length along its middle, as drawn. */
  ribbonMm: number | null
  housings: { male: number; female: number }
  /** Copies drawn per part file. */
  copies: Record<string, number>
  parts: Record<string, { body: boolean; leads: number }>
  /** Every part lead's end and male Dupont pin in a hole: off its hole's axis, and how deep. */
  leadEnds: { id: string; offAxisMm: number; depthMm: number }[]
}

/** A press on the canvas: what it selects as a click, and what it drags once it moves. */
interface Press {
  x: number
  y: number
  select: Selection | null
  drag: Gesture | null
  dragging: boolean
}

export class StudioView {
  readonly camera = new PerspectiveCamera(35, 1, 5, 20000)
  readonly controls = new OrbitControls(this.camera)
  readonly loop = new FrameLoop()
  /** Hover highlights, drawn from core geometry (tests read its first child). */
  readonly overlay = new Group()
  /** Footprints, leads, ghosts and the selection box. */
  readonly layers = new Group()
  hover: HoverRecord = { info: null, eventFrame: 0, shownFrame: null }
  /** The current ghost's holes and whether each glows green (tests read it). */
  ghost: { holes: string[]; legal: boolean[] } | null = null
  post: Post | null = null

  private readonly highlights = new Markers(this.overlay, 0.15)
  private readonly footprints = new Markers(this.layers, 0.1)
  private readonly ghostMarkers = new Markers(this.layers, 0.3)
  private readonly wires = new WireLayer(this.layers)
  private readonly bench = new BenchLayer(this.layers)
  private readonly parts = new PartLayer(this.layers, () => this.invalidate())
  private readonly insertion = new Insertion()
  /** The committed document last drawn: what a commit's insertion is measured against. */
  private committed: CircuitDoc | null = null
  private readonly selectionBox = new LineSegments(
    new EdgesGeometry(new BoxGeometry(1, 1, 1)),
    new LineBasicNodeMaterial({ color: STRIP_COLOR })
  )
  private readonly tween = new CameraTween()
  private readonly raycaster = new Raycaster()
  private invalidate: () => void = () => {}
  private canvas: HTMLCanvasElement | null = null
  private tooltip: HTMLElement | null = null
  private labels: LabelLayer | null = null
  private gesture: Gesture | null = null
  /** The gesture's proposal at the pointer, while it is legal: what a release commits. */
  private proposal: Proposal | null = null
  private proposed = ''
  private pointerNow: Pointer | null = null
  private press: Press | null = null

  constructor() {
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.1
    this.controls.minDistance = 60
    this.controls.maxDistance = 3000
    this.controls.maxPolarAngle = (85 * Math.PI) / 180 // stay above the table
    this.controls.addEventListener('start', () => this.tween.cancel())
    this.controls.addEventListener('change', () => this.invalidate())
    this.selectionBox.matrixAutoUpdate = false
    this.selectionBox.visible = false
    this.layers.add(this.selectionBox)
  }

  /** The R3F root is ready, with the camera's aspect set: frame the bench and start drawing. */
  bind(renderer: WebGPURenderer, scene: Scene, invalidate: () => void): void {
    configureModels(renderer)
    this.post = new Post(renderer, scene, this.camera)
    this.canvas = renderer.domElement
    this.invalidate = () => {
      this.loop.changed()
      invalidate()
    }
    const view = presetView('iso', circuit.getSnapshot(), this.camera, this.controls.target)
    this.camera.position.copy(view.position)
    this.controls.target.copy(view.target)
    this.controls.update()
    this.draw()
  }

  /** One frame: move, render, and say whether another is needed. */
  frame(now: number): boolean {
    if (!this.post) return false
    // Damping drains during a preset move too, so nothing is left over when it ends.
    let moving = this.controls.update()
    if (this.tween.active) {
      this.tween.step(now, this.camera, this.controls.target)
      moving = true
    }
    if (this.insertion.settle(now)) {
      const lift = (key: string) => this.insertion.lift(key, now)
      this.parts.animate(lift)
      this.wires.animate(this.drawnDoc(), lift)
      moving = true
    }
    this.post.render()
    if (this.labels && this.canvas)
      this.labels.project(this.camera, this.canvas.clientWidth, this.canvas.clientHeight)
    const more = this.loop.tick(moving, now)
    this.hover.shownFrame ??= this.loop.frames
    if (!more || this.loop.frames % 30 === 0) {
      setStatus({ frames: this.loop.frames, fps: this.loop.fps })
    }
    return more
  }

  preset(preset: Preset): void {
    const to = presetView(preset, circuit.getSnapshot(), this.camera, this.controls.target)
    const from = { position: this.camera.position, target: this.controls.target }
    this.tween.begin(performance.now(), from, to)
    this.invalidate()
  }

  /** Starts placing a part from the library; the pointer carries its ghost until release. */
  place(defId: string): void {
    this.cancel()
    useStudio.setState({ selection: null, tool: 'select' })
    this.gesture = { kind: 'place', defId, rotation: 0 }
  }

  /** Turns the ghost being placed, or the selection, by a quarter turn. */
  rotate(by: 90 | -90): void {
    const g = this.gesture
    if (g?.kind === 'place') {
      this.gesture = { ...g, rotation: turned(g.rotation, by) }
      this.update(this.pointerNow)
      return
    }
    const doc = circuit.getSnapshot()
    const sel = useStudio.getState().selection
    let op: Op | null = null
    if (sel?.kind === 'part') {
      const part = doc.parts.find((p) => p.id === sel.id)
      if (part)
        op = { type: 'MovePart', id: part.id, placement: turnedPart(doc, part, by).placement }
    } else if (sel?.kind === 'board') {
      const board = doc.boards.find((b) => b.id === sel.id)
      const t = board?.transform
      if (t)
        op = {
          type: 'MoveBoard',
          id: sel.id,
          transform: { ...t, rotationDeg: turned(t.rotationDeg, by) }
        }
    } else if (sel?.kind === 'pi') {
      const t = doc.controller.pi.transform
      const pi = { transform: { ...t, rotationDeg: turned(t.rotationDeg, by) } }
      op = { type: 'SetControllerPlacement', controller: { ...doc.controller, pi } }
    }
    if (op) edit(`Rotate ${sel && 'id' in sel ? sel.id : 'the Pi'}`, [op])
  }

  /** Removes the selected part or lead. */
  remove(): void {
    const doc = circuit.getSnapshot()
    const sel = useStudio.getState().selection
    if (sel?.kind === 'part') edit(`Remove ${sel.id}`, removePartOps(doc, sel.id))
    else if (sel?.kind === 'wire') edit(`Remove ${sel.id}`, [{ type: 'RemoveWire', id: sel.id }])
  }

  setTool(tool: Tool): void {
    useStudio.setState({ tool })
  }

  /** Per-copy controls for a placed part's model (SPEC 10.6); null while it has none drawn. */
  part(id: string): PartHandle | null {
    return this.parts.handle(id)
  }

  /** Tints one of the Pi's header pins by physical number (live Pi state); null restores it. */
  piPin(physical: number, color: Color | null): void {
    this.bench.setPiPin(physical, color)
    this.invalidate()
  }

  /** What the bench draws, counted and measured from the scene (tests). */
  report(): SceneReport {
    const doc = this.drawnDoc()
    return {
      piPins: this.bench.piPins.count,
      tboards: this.bench.tboard?.count ?? 0,
      sockets: this.bench.sockets?.count ?? 0,
      ribbons: this.bench.ribbon ? 1 : 0,
      ribbonMm: this.bench.ribbonLength(),
      housings: {
        male: this.wires.housings.male?.count ?? 0,
        female: this.wires.housings.female?.count ?? 0
      },
      copies: this.parts.copies(),
      parts: Object.fromEntries(doc.parts.map((p) => [p.id, this.parts.drawn(p.id)])),
      leadEnds: [...this.parts.leadEnds(), ...this.wires.maleTips()]
    }
  }

  /** Attaches input to the Studio's element; returns the detach. */
  attach(element: HTMLElement, tooltip: HTMLElement, labels: HTMLElement): () => void {
    this.tooltip = tooltip
    this.labels = new LabelLayer(labels)
    this.controls.connect(element)
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.isContentEditable || target?.closest('input, textarea, select')) return
      const key = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault()
        this.cancel()
        if (e.shiftKey) circuit.redo()
        else circuit.undo()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (key === 'escape') this.escape()
      else if (key === 'delete' || key === 'backspace') this.remove()
      else if (key === 'r') this.rotate(90)
      else if (key === 'w') this.setTool(useStudio.getState().tool === 'wire' ? 'select' : 'wire')
      else if (KEYS[key]) this.preset(KEYS[key])
    }
    // Hover only over the canvas itself, and not while a button is down (orbiting).
    const onMove = (e: PointerEvent) =>
      this.pointer(e.target === this.canvas && e.buttons === 0 ? e : null)
    const onLeave = () => this.pointer(null)
    const onDown = (e: PointerEvent) => this.down(e)
    const onGestureMove = (e: PointerEvent) => this.moveGesture(e)
    const onUp = (e: PointerEvent) => this.up(e)
    const unsubscribe = [
      circuit.subscribe(() => {
        this.refreshHover()
        this.draw()
      }),
      useStudio.subscribe((now, before) => {
        if (now.tool !== before.tool) {
          element.style.cursor = now.tool === 'wire' ? 'crosshair' : ''
          this.cancel()
        }
        if (
          now.selection !== before.selection ||
          now.labels !== before.labels ||
          now.preview !== before.preview
        )
          this.draw()
      }),
      // A model, texture or the parts index arriving draws what was waiting on it.
      onArrival(() => this.draw())
    ]
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointermove', onGestureMove)
    window.addEventListener('pointerup', onUp)
    // Capture runs before the orbit controls' own listener, so a drag can switch them off first.
    element.addEventListener('pointerdown', onDown, { capture: true })
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerleave', onLeave)
    return () => {
      this.cancel()
      unsubscribe.forEach((u) => u())
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointermove', onGestureMove)
      window.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointerdown', onDown, { capture: true })
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerleave', onLeave)
      this.controls.disconnect()
      this.tooltip = null
      this.labels = null
      // GPU resources go with the Studio (SPEC 10.8); a later attach draws them again.
      this.bench.dispose()
      this.parts.dispose()
      this.wires.dispose()
      disposeModels()
    }
  }

  /** A hole's position on screen, in client pixels (for tests). */
  projectHole(key: string): { x: number; y: number } | null {
    const hole = parseHoleKey(key)
    const board = hole && circuit.getSnapshot().boards.find((b) => b.id === hole.board)
    if (!hole || !board || !this.canvas) return null
    const p = holeInScene(board, hole).project(this.camera)
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height
    }
  }

  /** The pointer's ray and what it is over, or null off the canvas. */
  private pointerAt(e: PointerEvent): Pointer | null {
    if (!this.canvas) return null
    const rect = this.canvas.getBoundingClientRect()
    const [x, y] = [e.clientX - rect.left, e.clientY - rect.top]
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
    this.raycaster.setFromCamera(
      new Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1),
      this.camera
    )
    const doc = circuit.getSnapshot()
    const ray = this.raycaster.ray.clone()
    return { ray, hole: pickHole(doc, ray), pin: pickModulePin(doc, ray) }
  }

  /** What a press here selects, and what it drags (SPEC 11.3). */
  private pick(p: Pointer): { select: Selection | null; drag: Gesture | null } {
    const doc = circuit.getSnapshot()
    const selected = useStudio.getState().selection
    const occupant = p.hole && circuit.engine.state.occupancy.get(holeKey(p.hole))?.occupant
    // Lead ends, in a hole or on a module pin, drag on their own.
    const end =
      occupant?.kind === 'wire'
        ? { id: occupant.wire, end: occupant.end }
        : p.pin && endOnPin(doc, p.pin)
    if (end) return { select: { kind: 'wire', id: end.id }, drag: { kind: 'end', ...end } }
    // A selected flexible part's legs drag on their own too.
    if (
      occupant?.kind === 'part' &&
      selected?.kind === 'part' &&
      selected.id === occupant.part &&
      partDef(doc.parts.find((x) => x.id === occupant.part)!.defId).footprint.kind === 'flex-2lead'
    ) {
      return { select: selected, drag: { kind: 'leg', id: occupant.part, pin: occupant.pin } }
    }
    const body = pickBody(doc, p.ray)
    const wire = this.wires.pick(p.ray)
    if (wire && (!body || wire.distance < body.distance))
      return { select: { kind: 'wire', id: wire.id }, drag: null }
    // A part's pin in the hole wins over the board around it.
    const sel: Selection | null =
      occupant?.kind === 'part' && (!body || body.sel.kind === 'board')
        ? { kind: 'part', id: occupant.part }
        : (body?.sel ?? null)
    return { select: sel, drag: sel && this.dragOf(doc, sel, p, selected) }
  }

  private dragOf(
    doc: CircuitDoc,
    sel: Selection,
    p: Pointer,
    selected: Selection | null
  ): Gesture | null {
    const table = planePoint(p.ray, 0)
    switch (sel.kind) {
      case 'part': {
        const part = doc.parts.find((x) => x.id === sel.id)!
        const pose = part.placement.offboardPose
        if (pose) return table && { kind: 'module', id: part.id, from: table, pose }
        const pin1 = part.placement.pins[partDef(part.defId).pins[0]!.id]
        return pin1 ? { kind: 'part', id: part.id, grab: grabVector(doc, p.hole, pin1) } : null
      }
      case 'tboard':
        return p.hole && { kind: 'tboard', from: p.hole, placement: doc.controller.tboard }
      case 'pi':
        return table && { kind: 'pi', from: table, transform: doc.controller.pi.transform }
      case 'board': {
        // A board is large: dragging it moves it only once it is selected; otherwise it orbits.
        const board = doc.boards.find((b) => b.id === sel.id)!
        const from = planePoint(p.ray, boardTop(doc, sel.id))
        const isSelected = selected?.kind === 'board' && selected.id === sel.id
        return isSelected && from
          ? { kind: 'board', id: sel.id, from, transform: board.transform }
          : null
      }
      case 'wire':
        return null
    }
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 || this.gesture?.kind === 'place') return
    const p = this.pointerAt(e)
    if (!p) return
    const wireTool = useStudio.getState().tool === 'wire'
    const { select, drag } = wireTool ? { select: null, drag: null } : this.pick(p)
    // The orbit controls ignore a press that drags something.
    if (drag) this.controls.enabled = false
    this.press = { x: e.clientX, y: e.clientY, select, drag, dragging: false }
  }

  private moveGesture(e: PointerEvent): void {
    const press = this.press
    if (press?.drag && !press.dragging) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= CLICK_PX) return
      press.dragging = true
      this.cancel()
      this.gesture = press.drag
    }
    if (this.gesture) this.update(this.pointerAt(e))
  }

  private up(e: PointerEvent): void {
    const press = this.press
    this.press = null
    this.controls.enabled = true
    if (this.gesture?.kind === 'place' || press?.dragging) {
      this.commit()
      this.cancel()
      return
    }
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_PX) return
    if (useStudio.getState().tool === 'wire') this.wireClick(this.pointerAt(e))
    else useStudio.setState({ selection: press.select })
  }

  /** The wire tool: the first click picks a free end, the second commits the lead. */
  private wireClick(p: Pointer | null): void {
    if (this.gesture?.kind === 'wire') {
      this.commit()
      if (this.proposal) this.cancel()
      return
    }
    const doc = circuit.getSnapshot()
    const from: Endpoint | null = p?.pin
      ? { pin: p.pin }
      : p?.hole && holeFree(doc, p.hole)
        ? { hole: p.hole }
        : null
    if (!from) return
    this.gesture = { kind: 'wire', from }
    this.update(p)
  }

  private commit(): void {
    const p = this.proposal
    if (p && edit(p.label, p.ops)) useStudio.setState({ selection: p.select })
  }

  /** Esc: drop the gesture, else leave the wire tool, else clear the selection. */
  private escape(): void {
    if (this.gesture) this.cancel()
    else if (useStudio.getState().tool === 'wire') this.setTool('select')
    else useStudio.setState({ selection: null })
  }

  /** Ends any gesture without committing, clearing its ghost and preview. */
  private cancel(): void {
    this.gesture = null
    this.proposal = null
    this.proposed = ''
    this.ghost = null
    this.ghostMarkers.set([])
    if (useStudio.getState().preview) {
      circuit.engine.clearPreview()
      useStudio.setState({ preview: null })
    }
    this.invalidate()
  }

  /** The gesture's proposal at the pointer: checked, glowing green or red, previewed if legal. */
  private update(p: Pointer | null): void {
    this.pointerNow = p
    const g = this.gesture
    if (!g) return
    const doc = circuit.getSnapshot()
    const proposal = p && propose(g, p, doc)
    const key = JSON.stringify([proposal?.ops, proposal?.refused])
    if (key === this.proposed) return
    this.proposed = key
    let problems: Problem[] | null = null
    let preview: CircuitDoc | null = null
    if (proposal?.refused) problems = [{ code: 'REFUSED', message: proposal.refused, refs: [] }]
    else if (proposal) {
      const result = circuit.check({ author: 'user', label: proposal.label, ops: proposal.ops })
      if (result.ok) preview = result.doc
      else problems = result.problems
    }
    this.proposal = preview ? proposal : null
    const holes = proposal?.holes ?? []
    const legal = holeLegality(holes, problems)
    const markers: Marker[] = holes.map((hole, i) => ({
      ...endpointInScene(doc, { hole })!,
      size: GHOST_SIZE_MM,
      color: legal[i] ? LEGAL : ILLEGAL
    }))
    for (const pin of proposal?.pins ?? []) {
      const at = endpointInScene(preview ?? doc, { pin })
      if (at) markers.push({ ...at, size: GHOST_SIZE_MM, color: preview ? LEGAL : ILLEGAL })
    }
    if (g.kind === 'wire' && !proposal) {
      const at = endpointInScene(doc, g.from)
      if (at) markers.push({ ...at, size: GHOST_SIZE_MM, color: STRIP_COLOR })
    }
    this.ghost = { holes: holes.map(holeKey), legal }
    this.ghostMarkers.set(markers)
    if (preview) circuit.engine.preview(preview)
    else circuit.engine.clearPreview()
    useStudio.setState({ preview })
    this.invalidate()
  }

  /** The document being drawn: the drag's preview, else the committed one. */
  private drawnDoc(): CircuitDoc {
    return useStudio.getState().preview ?? circuit.getSnapshot()
  }

  /**
   * Draws what the document holds (or the preview of a drag): the bench, parts, leads, footprints,
   * labels and selection. What a drag moves hovers above its holes; what a commit moved seats.
   */
  private draw(): void {
    const { preview, selection, labels } = useStudio.getState()
    const committed = circuit.getSnapshot()
    const doc = preview ?? committed
    const now = performance.now()
    if (preview) this.insertion.hover(reseated(committed, preview))
    else {
      this.insertion.hover([])
      if (this.committed && this.committed !== committed)
        this.insertion.start(reseated(this.committed, committed), now)
      this.committed = committed
    }
    const lift = (key: string) => this.insertion.lift(key, now)
    this.bench.update(doc)
    // Parts first: a module's model tells where its pins are, which its leads' ends need.
    this.parts.update(doc, lift)
    this.wires.update(doc, lift)
    const markers: Marker[] = []
    const tb = doc.controller.tboard
    const tbBoard = doc.boards.find((b) => b.id === tb.board)
    if (tbBoard) {
      const def = boardDef(tbBoard.defId)
      for (const hole of tboardPinHoles(tb).filter((h) => isValidHole(def, h)))
        markers.push({
          ...endpointInScene(doc, { hole })!,
          size: FOOTPRINT_SIZE_MM,
          color: TBOARD_COLOR
        })
    }
    for (const part of doc.parts) {
      for (const pin of partDef(part.defId).pins) {
        const hole = part.placement.pins[pin.id]
        const at = hole
          ? endpointInScene(doc, { hole })
          : endpointInScene(doc, { pin: { part: part.id, pin: pin.id } })
        if (at) markers.push({ ...at, size: FOOTPRINT_SIZE_MM, color: PART_COLOR })
      }
    }
    this.footprints.set(markers)
    const points = selection?.kind === 'wire' ? this.wires.points(selection.id) : null
    const box = selection && (points ? pointsBox(points) : bodyBox(doc, selection))
    this.selectionBox.visible = !!box
    if (box) this.selectionBox.matrix.copy(box)
    this.selectionBox.matrixWorldNeedsUpdate = true
    this.labels?.set(labels ? labelsOf(doc) : [])
    this.invalidate()
  }

  private pointer(e: PointerEvent | null): void {
    let info: HoverInfo | null = null
    if (e && this.canvas) {
      const rect = this.canvas.getBoundingClientRect()
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      this.raycaster.setFromCamera(ndc, this.camera)
      const doc = circuit.getSnapshot()
      const hole = pickHole(doc, this.raycaster.ray)
      info = hole && hoverInfo(doc, circuit.engine.state.netlist, hole)
      if (this.tooltip) {
        const [x, y] = [e.clientX - rect.left + 14, e.clientY - rect.top + 14]
        this.tooltip.style.transform = `translate(${x}px, ${y}px)`
      }
    }
    const before = this.hover.info
    if ((info && holeKey(info.hole)) === (before && holeKey(before.hole))) return
    this.show(info)
  }

  /** The document changed under a hover: show the same hole on the new document. */
  private refreshHover(): void {
    const hole = this.hover.info?.hole
    if (!hole) return
    const doc = circuit.getSnapshot()
    const board = doc.boards.find((b) => b.id === hole.board)
    const valid = board && isValidHole(boardDef(board.defId), hole)
    this.show(valid ? hoverInfo(doc, circuit.engine.state.netlist, hole) : null)
  }

  private show(info: HoverInfo | null): void {
    this.hover = { info, eventFrame: this.loop.frames, shownFrame: null }
    if (this.tooltip) {
      this.tooltip.textContent = info?.text ?? ''
      this.tooltip.hidden = !info
    }
    const doc = circuit.getSnapshot()
    const markers: Marker[] = []
    for (const hole of info?.strip ?? []) {
      markers.push({ ...endpointInScene(doc, { hole })!, size: STRIP_SIZE_MM, color: STRIP_COLOR })
    }
    for (const { wire, end } of info?.wireEnds ?? []) {
      const w = doc.wires.find((x) => x.id === wire)!
      const at = endpointInScene(doc, end === 'a' ? w.a : w.b)
      if (at) markers.push({ ...at, size: WIRE_END_SIZE_MM, color: WIRE_END_COLOR })
    }
    this.highlights.set(markers)
    this.invalidate()
  }
}

/** The lead end on a module pin, if one is there. */
function endOnPin(
  doc: CircuitDoc,
  pin: { part: string; pin: string }
): { id: string; end: 'a' | 'b' } | null {
  for (const w of doc.wires) {
    for (const end of ['a', 'b'] as const) {
      const e = w[end]
      if ('pin' in e && e.pin.part === pin.part && e.pin.pin === pin.pin) return { id: w.id, end }
    }
  }
  return null
}
