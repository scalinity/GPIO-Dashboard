// The Studio's imperative side: the camera and its damped orbit, hover picking and highlights, the
// gestures that edit the document, the bench, parts and leads it draws, the cables' physics, and
// the frame loop.
// Pointer and key handlers act directly on three objects and request a frame, so a hover shows on
// the very next frame (SPEC 11.3, acceptance 8) without waiting on React. Edits go through the
// studio store's edit(), one transaction each. While an assistant turn owns the document the canvas
// is read-only: the camera and hover work, nothing edits (SPEC 11.8). The assistant's ghosts are
// drawn into the shown document, its changes tinted, and its cues marked; it can capture a view.
// In Build Mode (SPEC 11.7) the bench shows the document as built so far with the step in hand as
// a ghost, the camera frames the step, and depth of field can follow its target.
import {
  Box3,
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicNodeMaterial,
  LineSegments,
  PerspectiveCamera,
  Raycaster,
  type Scene,
  Sphere,
  Vector2,
  Vector3,
  type WebGPURenderer
} from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CapturedView, Ghost, ViewPreset } from '../assistant/context'
import { boardDef } from '../core/defs/boards'
import { PI_HEADER } from '../core/defs/controllers'
import { partDef } from '../core/defs/parts'
import { holeKey, isValidHole, parseHoleKey } from '../core/geometry/breadboard'
import { tboardPinHoles } from '../core/geometry/tboard'
import type { CircuitDoc, Endpoint, Op, Vec3, Wire } from '../core/model/types'
import { computeState, type ConnectivityState } from '../core/netlist/engine'
import type { Problem } from '../core/ops/validate'
import { useBuild } from '../state/buildStore'
import { circuit } from '../state/circuit'
import { LOCKED_MESSAGE } from '../state/circuitStore'
import { useSense } from '../state/senseStore'
import { BUILDING_MESSAGE, edit, type Selection, type Tool, useStudio } from '../state/studioStore'
import { useWorkbench } from '../state/workbenchStore'
import { BenchLayer } from './bench'
import { bodyBox, pickBody, pointsBox } from './bodies'
import { BUILD_GHOST } from './build'
import { Cables, type CablesReport, placeColliders, type Placement, TABLE, toCore } from './cables'
import { CameraTween, type Preset, presetView, sphereView } from './camera'
import { defOf, endpointInScene, holeInScene, poseMatrix } from './coords'
import { cuePlaces } from './cues'
import { FrameLoop, SETTLE_FRAMES } from './frameLoop'
import { ghostIds, withGhosts } from './ghosts'
import {
  boardTop,
  type Gesture,
  grabVector,
  planePoint,
  type Pointer,
  type Proposal,
  propose
} from './gestures'
import { Halos } from './halos'
import { Insertion, reseated } from './insertion'
import { LabelLayer, labelsOf } from './labels'
import { collidersNow, configureModels, disposeModels, onArrival } from './loaders'
import { type Marker, Markers } from './markers'
import { netMarkers, stripIndex } from './nets'
import { type PartHandle, PartLayer } from './parts'
import { hoverInfo, type HoverInfo, pickHole, pickModulePin } from './picking'
import { holeFree, holeLegality, removePartOps, turned, turnedPart } from './placement'
import { Post } from './renderer'
import { SimVisuals, type VisualsReport } from './simvisuals'
import { setStatus } from './status'
import { type Mark, StepMarks } from './stepMarks'
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
const CUE_SIZE_MM = 2.8
const CUE_COLOR = new Color('#C4B5FD')
/** Focus frames at least a sphere this big, so one hole is not filled edge to edge. */
const FOCUS_MIN_RADIUS_MM = 25
/** capture_view waits at most this long for the cables to sleep (SPEC 12.5). */
const CAPTURE_SLEEP_MS = 2000
/** A captured view's longest side, in pixels: what the API reads without downscaling. */
const CAPTURE_MAX_PX = 1568
/** A press that moves further than this, in pixels, is a drag rather than a click. */
const CLICK_PX = 4
/** A lead grabbed this close to one of its route hints moves that hint rather than adding one. */
const HINT_GRAB_MM = 15
const MAX_HINTS = 3
/** A box of side 1 about the origin: a selection box's matrix maps it onto the body. */
const UNIT = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5))

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
  /** Per part: whether a body and how many leads are drawn, and its selection box's top centre (core frame, mm). */
  parts: Record<string, { body: boolean; leads: number; top: Vec3 | null }>
  /** Every part lead's end and male Dupont pin in a hole: off its hole's axis, and how deep. */
  leadEnds: { id: string; offAxisMm: number; depthMm: number }[]
  /** What the simulation and Board Sense paint: glow, motion, flow, halos, tags, tints. */
  sim: VisualsReport
  /** The parts and leads drawn only as the assistant's ghosts. */
  ghosts: string[]
  /** How many places the assistant's cue marks. */
  cueMarks: number
  /** Build Mode's step on the bench; null outside Build Mode. */
  build: BuildReport | null
}

/** What Build Mode shows for the step in hand, read back for tests. */
export interface BuildReport {
  index: number
  /** The step's ghost on the bench, by id; none for the T-board step and the finished build. */
  ghosts: string[]
  /** The pulsing marks, in canvas pixels, and whether each is on screen. */
  marks: { x: number; y: number; tone: 'step' | 'cause'; inView: boolean }[]
  /** How long the camera took to frame the step, in ms; null while it is still on its way. */
  framingMs: number | null
  /** Whether depth of field follows the step's target. */
  blur: boolean
}

/** A capture_view in progress: waiting for the cables to sleep, then for TRAA to settle. */
interface Capture {
  preset: ViewPreset
  since: number
  /** Frames to draw at the preset before reading it; null until the camera is there. */
  frames: number | null
  /** The view to go back to afterwards. */
  back: { position: Vector3; target: Vector3 } | null
  resolve(view: CapturedView): void
  reject(error: Error): void
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
  /** The assistant's highlight (SPEC 12.5): marks on what it names, until dismissed. */
  private readonly cueMarkers = new Markers(this.layers, 0.35)
  private capturing: Capture | null = null
  private readonly wires = new WireLayer(this.layers)
  private readonly bench = new BenchLayer(this.layers)
  private readonly parts = new PartLayer(this.layers, () => this.invalidate())
  private readonly visuals = new SimVisuals(
    this.parts,
    this.wires,
    new Halos(this.layers),
    new Markers(this.layers, 0.12),
    () => this.invalidate()
  )
  private readonly insertion = new Insertion()
  /** The cables' physics (SPEC 10.5): the solver runs in physics.worker. */
  private readonly cables = new Cables()
  /** A fresh world settles offscreen before the cables show: on first drawing, and on opening. */
  private settle = true
  /** The leads the solver runs, as committed: a lead only a preview holds is a ghost. */
  private committedWire: (id: string) => Wire | null = () => null
  /** The layers changed what the cables are drawn from: the next frame draws them again. */
  private redrawCables = false
  /** The committed document last drawn: what a commit's insertion is measured against. */
  private committed: CircuitDoc | null = null
  private readonly selectionBox = new LineSegments(
    new EdgesGeometry(new BoxGeometry(1, 1, 1)),
    new LineBasicNodeMaterial({ color: STRIP_COLOR })
  )
  private readonly tween = new CameraTween()
  /** Build Mode's rings over the step's holes; set while the Studio is attached. */
  private stepMarks: StepMarks | null = null
  private marksKey = ''
  /** When the camera set off to frame the step, and how long it took. */
  private framing: { start: number; ms: number | null } | null = null
  /** Depth of field follows the camera's target (Build Mode, SPEC 10.7). */
  private focusing = false
  /** The connectivity of Build Mode's document, for what hover and pressing ask of it. */
  private shownState: ConnectivityState | null = null
  /** The assistant's ghosts with the step's: the same object while neither changed. */
  private merged: {
    ghosts: Record<string, Ghost>
    step: Ghost
    out: Record<string, Ghost>
  } | null = null
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
  /** A right button down on the canvas, until it is let go: a click opens a pin's menu. */
  private rightPress: { x: number; y: number } | null = null
  /** The momentary switch being held down in 3D. */
  private held: string | null = null

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
    // Reopening the Studio in the middle of a build: the step is framed, not flown to.
    if (useBuild.getState().on) this.frameBuild(true)
    this.syncFocus()
    this.draw()
  }

  /** One frame: move, render, and say whether another is needed. */
  frame(now: number): boolean {
    if (!this.post) return false
    // Damping drains during a preset move too, so nothing is left over when it ends.
    let moving = this.controls.update()
    if (this.tween.active) {
      const running = this.tween.step(now, this.camera, this.controls.target)
      if (!running && this.framing?.ms === null) this.framing.ms = now - this.framing.start
      moving = true
    }
    if (this.insertion.settle(now)) {
      const lift = (key: string) => this.insertion.lift(key, now)
      const doc = this.drawnDoc()
      this.parts.animate(lift)
      this.wires.update(doc, lift, this.committedWire)
      this.syncCables(doc, lift)
      moving = true
    }
    // The newest step the worker published; it keeps frames coming while an island is awake.
    if (this.cables.poll() || this.redrawCables) this.showCables()
    if (this.cables.moving) moving = true
    if (this.visuals.step(now)) moving = true
    const capture = this.capturing && this.captureStep(now)
    if (this.capturing) moving = true
    if (this.focusing) this.post.setFocus(this.camera.position.distanceTo(this.controls.target))
    this.post.render()
    if (capture) this.finishCapture(capture)
    if (this.canvas) {
      const [w, h] = [this.canvas.clientWidth, this.canvas.clientHeight]
      this.labels?.project(this.camera, w, h)
      this.visuals.tags?.project(this.camera, w, h)
      this.stepMarks?.project(this.camera, w, h)
    }
    const more = this.loop.tick(moving, now)
    this.hover.shownFrame ??= this.loop.frames
    if (!more || this.loop.frames % 30 === 0) {
      setStatus({ frames: this.loop.frames, fps: this.loop.fps, physics: this.cables.stepMs })
    }
    return more
  }

  preset(preset: Preset): void {
    const to = presetView(preset, circuit.getSnapshot(), this.camera, this.controls.target)
    const from = { position: this.camera.position, target: this.controls.target }
    this.tween.begin(performance.now(), from, to)
    this.invalidate()
  }

  /**
   * capture_view (SPEC 12.5): waits for the cables to sleep (at most 2 s), draws the preset's view
   * until TRAA has settled, reads it as a PNG no larger than the API reads, and puts the camera
   * back where it was.
   */
  capture(preset: ViewPreset): Promise<CapturedView> {
    if (!this.post || !this.canvas)
      return Promise.reject(new Error('The 3D stage is not open, so there is nothing to capture.'))
    this.capturing?.reject(new Error('A newer capture replaced this one.'))
    return new Promise((resolve, reject) => {
      this.capturing = {
        preset,
        since: performance.now(),
        frames: null,
        back: null,
        resolve,
        reject
      }
      this.invalidate()
    })
  }

  /** Frames `refs` (parts, leads, boards, holes or nets), keeping the view's direction. */
  focusOn(refs: string[]): void {
    const doc = this.drawnDoc()
    const { box } = cuePlaces(doc, this.conn().netlist, refs, {
      size: CUE_SIZE_MM,
      color: CUE_COLOR
    })
    if (box.isEmpty()) return
    const sphere = box.getBoundingSphere(new Sphere())
    sphere.radius = Math.max(sphere.radius, FOCUS_MIN_RADIUS_MM)
    const direction = this.camera.position.clone().sub(this.controls.target).normalize()
    const from = { position: this.camera.position, target: this.controls.target }
    this.tween.begin(performance.now(), from, sphereView(sphere, this.camera, direction))
    this.invalidate()
  }

  /** Starts placing a part from the library; the pointer carries its ghost until release. */
  place(defId: string): void {
    if (this.refuseWhileLocked()) return
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
      parts: Object.fromEntries(
        doc.parts.map((p) => {
          const box = bodyBox(doc, { kind: 'part', id: p.id })
          const top = box && new Vector3(0, 0.5, 0).applyMatrix4(box)
          return [
            p.id,
            { ...this.parts.drawn(p.id), top: top && ([top.x, -top.z, top.y] as const) }
          ]
        })
      ),
      leadEnds: [...this.parts.leadEnds(), ...this.wires.maleTips()],
      sim: this.visuals.report(),
      ghosts: ghostIds(this.base(), this.ghosted()),
      cueMarks: this.cueMarkers.count,
      build: this.buildReport()
    }
  }

  /** Shows a net's strips and lead ends as hover does (the Nets list); null clears it. */
  highlightNet(name: string | null): void {
    const doc = this.base()
    const net = name ? this.conn().netlist.byName.get(name) : undefined
    this.highlights.set(
      net
        ? netMarkers(
            doc,
            stripIndex(doc),
            net,
            { size: STRIP_SIZE_MM, color: STRIP_COLOR },
            { size: WIRE_END_SIZE_MM, color: WIRE_END_COLOR }
          )
        : []
    )
    this.invalidate()
  }

  /** Attaches input to the Studio's element; returns the detach. */
  attach(
    element: HTMLElement,
    tooltip: HTMLElement,
    labels: HTMLElement,
    tags: HTMLElement,
    marks: HTMLElement
  ): () => void {
    this.tooltip = tooltip
    this.labels = new LabelLayer(labels)
    this.visuals.tags = new LabelLayer(tags)
    this.stepMarks = new StepMarks(marks)
    this.marksKey = ''
    this.controls.connect(element)
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.isContentEditable || target?.closest('input, textarea, select')) return
      const key = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault()
        if (this.refuseWhileLocked()) return
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
        // Opening a document clears its history: its cables settle afresh, offscreen.
        if (!circuit.canUndo && !circuit.canRedo) this.settle = true
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
          now.preview !== before.preview ||
          now.ghosts !== before.ghosts
        )
          this.draw()
        else if (
          now.voltages !== before.voltages ||
          now.current !== before.current ||
          now.sense !== before.sense ||
          now.tinted !== before.tinted
        )
          this.syncVisuals()
        if (now.cue !== before.cue) this.showCue()
      }),
      // The simulation's snapshots, the part inputs and the issues, and Board Sense's states.
      useWorkbench.subscribe((now, before) => {
        if (now.sim !== before.sim || now.env !== before.env) this.syncVisuals()
      }),
      useSense.subscribe((now, before) => {
        if (
          now.states !== before.states ||
          now.mode !== before.mode ||
          now.candidates !== before.candidates
        )
          this.syncVisuals()
      }),
      // Build Mode: the step in hand changes what is drawn, where the camera looks, and the marks.
      useBuild.subscribe((now, before) => {
        if (now.scene !== before.scene) {
          this.refreshHover()
          this.draw()
        } else if (now.status !== before.status) this.syncMarks()
        if (now.frameSeq !== before.frameSeq) this.frameBuild()
        if (now.on !== before.on || now.blur !== before.blur) this.syncFocus()
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
    this.showCue()
    this.syncMarks()
    return () => {
      this.cancel()
      this.capturing?.reject(new Error('The 3D stage closed before the capture.'))
      this.capturing = null
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
      this.visuals.tags = null
      this.stepMarks = null
      // GPU resources go with the Studio (SPEC 10.8); a later attach draws them again.
      this.bench.dispose()
      this.visuals.dispose()
      this.parts.dispose()
      this.wires.dispose()
      disposeModels()
    }
  }

  /**
   * The solver's side of the cables (tests measure from it): the colliders it was last sent, and
   * each cable's drawn particles in the core frame, from the latest step.
   */
  cablesReport(): CablesReport | null {
    return this.cables.report()
  }

  /** A core-frame point's position on screen, in client pixels (for tests). */
  projectPoint([x, y, z]: readonly [number, number, number]): { x: number; y: number } | null {
    if (!this.canvas) return null
    const p = new Vector3(x, z, -y).project(this.camera)
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height
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
  private pointerAt(e: MouseEvent): Pointer | null {
    if (!this.canvas) return null
    const rect = this.canvas.getBoundingClientRect()
    const [x, y] = [e.clientX - rect.left, e.clientY - rect.top]
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
    this.raycaster.setFromCamera(
      new Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1),
      this.camera
    )
    const doc = this.base()
    const ray = this.raycaster.ray.clone()
    return { ray, hole: pickHole(doc, ray), pin: pickModulePin(doc, ray) }
  }

  /** What a press here selects, and what it drags (SPEC 11.3). */
  private pick(p: Pointer): { select: Selection | null; drag: Gesture | null } {
    const doc = this.base()
    const selected = useStudio.getState().selection
    const occupant = p.hole && this.conn().occupancy.get(holeKey(p.hole))?.occupant
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
      defOf(doc, doc.parts.find((x) => x.id === occupant.part)!.defId).footprint.kind ===
        'flex-2lead'
    ) {
      return { select: selected, drag: { kind: 'leg', id: occupant.part, pin: occupant.pin } }
    }
    const body = pickBody(doc, p.ray)
    const wire = this.wires.pick(p.ray)
    if (wire && (!body || wire.distance < body.distance))
      return { select: { kind: 'wire', id: wire.id }, drag: this.routeOf(doc, wire.id, wire.at) }
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
        const pin1 = part.placement.pins[defOf(doc, part.defId).pins[0]!.id]
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

  /**
   * Grabbing a simulated lead mid-span drags a route hint (SPEC 10.5, 11.3): the one near the grab,
   * else a new one while it has fewer than three, else the nearest. It moves across the plane
   * through the grab that faces the camera.
   */
  private routeOf(doc: CircuitDoc, id: string, at: Vector3): Gesture | null {
    const wire = doc.wires.find((w) => w.id === id)
    if (!wire?.kind.startsWith('dupont') || !this.cables.available) return null
    const hints = wire.routeHints ?? []
    const [x, y, z] = toCore(at)
    const gap = hints.map((h) => Math.hypot(h[0] - x, h[1] - y, h[2] - z))
    const nearest = gap.indexOf(Math.min(...gap))
    const index =
      nearest >= 0 && (gap[nearest]! < HINT_GRAB_MM || hints.length >= MAX_HINTS)
        ? nearest
        : hints.length
    const normal = this.camera.getWorldDirection(new Vector3()).negate()
    return { kind: 'route', id, index, normal: normal.toArray(), constant: -normal.dot(at) }
  }

  private down(e: PointerEvent): void {
    if (e.button === 2) this.rightPress = { x: e.clientX, y: e.clientY }
    if (e.button !== 0 || this.gesture?.kind === 'place') return
    const p = this.pointerAt(e)
    if (!p) return
    const wireTool = useStudio.getState().tool === 'wire'
    const picked = wireTool ? { select: null, drag: null } : this.pick(p)
    // Read-only while the assistant works or a build is played: a press still selects, but drags
    // nothing (it orbits), and no switch is pressed on a bench that is only partly drawn.
    const building = useBuild.getState().on
    const { select, drag } = circuit.locked || building ? { ...picked, drag: null } : picked
    if (select?.kind === 'part' && !building) this.pressSwitch(select.id)
    // The orbit controls ignore a press that drags something.
    if (drag) this.controls.enabled = false
    this.press = { x: e.clientX, y: e.clientY, select, drag, dragging: false }
  }

  private moveGesture(e: PointerEvent): void {
    const press = this.press
    if (press?.drag && !press.dragging) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= CLICK_PX) return
      press.dragging = true
      this.releaseSwitch()
      this.cancel()
      this.gesture = press.drag
    }
    if (this.gesture) this.update(this.pointerAt(e))
  }

  private up(e: PointerEvent): void {
    const press = this.press
    this.press = null
    this.controls.enabled = true
    this.releaseSwitch()
    const right = this.rightPress
    this.rightPress = null
    if (
      e.button === 2 &&
      right &&
      !useBuild.getState().on &&
      Math.hypot(e.clientX - right.x, e.clientY - right.y) <= CLICK_PX
    )
      this.pinMenu(e)
    if (this.gesture?.kind === 'place' || press?.dragging) {
      this.commit()
      this.cancel()
      return
    }
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_PX) return
    if (useStudio.getState().tool === 'wire') this.wireClick(this.pointerAt(e))
    else useStudio.setState({ selection: press.select })
  }

  /**
   * Simulate (SPEC 11.5): a press on a switch in 3D works it. A momentary tact switch is down while
   * the button is; a retain-press one and a tilt switch change state on each click.
   */
  private pressSwitch(id: string): void {
    const doc = circuit.getSnapshot()
    const part = doc.parts.find((p) => p.id === id)
    const def = part && defOf(doc, part.defId)
    if (!part || !def) return
    const { env, setInput } = useWorkbench.getState()
    const value = (key: string) => env[id]?.[key] ?? part.props[key] ?? def.properties[key]?.default
    if (def.sim.model === 'tilt-switch') void setInput(id, 'tilted', value('tilted') !== true)
    else if (def.sim.model === 'tact-switch') {
      if (value('mode') === 'retain') void setInput(id, 'pressed', value('pressed') !== true)
      else {
        this.held = id
        void setInput(id, 'pressed', true)
      }
    }
  }

  private releaseSwitch(): void {
    if (!this.held) return
    void useWorkbench.getState().setInput(this.held, 'pressed', false)
    this.held = null
  }

  /** A right click on one of the T-board's GPIO pins opens its menu (Studio.tsx). */
  private pinMenu(e: PointerEvent): void {
    const hole = this.pointerAt(e)?.hole
    const occupant = hole && this.conn().occupancy.get(holeKey(hole))?.occupant
    const pin = occupant?.kind === 'tboard' ? PI_HEADER[occupant.pin - 1] : undefined
    useStudio.setState({
      pinMenu: pin?.bcm == null ? null : { bcm: pin.bcm, x: e.clientX, y: e.clientY }
    })
  }

  /** While an assistant turn owns the document or a build is played, says so and returns true. */
  private refuseWhileLocked(): boolean {
    const building = useBuild.getState().on
    if (!circuit.locked && !building) return false
    useStudio.setState({ notice: circuit.locked ? LOCKED_MESSAGE : BUILDING_MESSAGE })
    return true
  }

  /** The wire tool: the first click picks a free end, the second commits the lead. */
  private wireClick(p: Pointer | null): void {
    if (this.refuseWhileLocked()) return
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

  /**
   * The document the bench holds as committed: in Build Mode the steps done so far, else the app's
   * document. The pointer, hover, selection and insertion all go by it.
   */
  private base(): CircuitDoc {
    return useBuild.getState().scene?.shown ?? circuit.getSnapshot()
  }

  /** The base document's connectivity: the app's engine, or Build Mode's own. */
  private conn(): ConnectivityState {
    const shown = useBuild.getState().scene?.shown
    if (!shown) return circuit.engine.state
    if (this.shownState?.doc !== shown) this.shownState = computeState(shown, partDef)
    return this.shownState
  }

  /** The base document with the assistant's ghosts, and the step in hand as one more. */
  private ghosted(): CircuitDoc {
    const { ghosts } = useStudio.getState()
    const step = useBuild.getState().scene?.ghost
    if (!step) return withGhosts(this.base(), ghosts)
    if (this.merged?.ghosts !== ghosts || this.merged.step !== step)
      this.merged = { ghosts, step, out: { ...ghosts, [BUILD_GHOST]: step } }
    return withGhosts(this.base(), this.merged.out)
  }

  /** The document being drawn: the drag's preview, else the committed one with any ghosts. */
  private drawnDoc(): CircuitDoc {
    return useStudio.getState().preview ?? this.ghosted()
  }

  /**
   * Draws what the document holds (or the preview of a drag): the bench, parts, leads, footprints,
   * labels and selection. What a drag moves, and every ghost, hovers above its holes; what a
   * commit moved seats.
   */
  private draw(): void {
    const { preview, selection, labels } = useStudio.getState()
    const committed = this.base()
    const doc = preview ?? this.ghosted()
    const now = performance.now()
    this.insertion.hover(doc === committed ? [] : reseated(committed, doc))
    // A drag's commit is measured once its preview is gone; the assistant's as each one lands.
    if (!preview) {
      if (this.committed && this.committed !== committed)
        this.insertion.start(reseated(this.committed, committed), now)
      this.committed = committed
    }
    const lift = (key: string) => this.insertion.lift(key, now)
    this.bench.update(doc)
    // Parts first: a module's model tells where its pins are, which its leads' ends need.
    this.parts.update(doc, lift)
    const held = new Map(committed.wires.map((w) => [w.id, w]))
    this.committedWire = (id) => (this.cables.available && held.get(id)) || null
    this.wires.update(doc, lift, this.committedWire)
    this.syncCables(doc, lift)
    this.redrawCables = true
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
      for (const pin of defOf(doc, part.defId).pins) {
        const hole = part.placement.pins[pin.id]
        const at = hole
          ? endpointInScene(doc, { hole })
          : endpointInScene(doc, { pin: { part: part.id, pin: pin.id } })
        if (at) markers.push({ ...at, size: FOOTPRINT_SIZE_MM, color: PART_COLOR })
      }
    }
    this.footprints.set(markers)
    this.placeSelection(doc, selection)
    this.labels?.set(labels ? labelsOf(doc) : [])
    this.syncVisuals()
    this.syncMarks()
    // A highlight follows what it names as the document changes.
    if (useStudio.getState().cue?.marks) this.showCue()
    this.invalidate()
  }

  /** The selection's box: a lead's from where it is drawn, anything else's from the document. */
  private placeSelection(doc: CircuitDoc, selection: Selection | null): void {
    const points = selection?.kind === 'wire' ? this.wires.points(selection.id) : null
    const box = selection && (points ? pointsBox(points) : bodyBox(doc, selection))
    this.selectionBox.visible = !!box
    if (box) this.selectionBox.matrix.copy(box)
    this.selectionBox.matrixWorldNeedsUpdate = true
  }

  /**
   * Hands the solver the scene as drawn (SPEC 10.5): every collider file the bench uses at its
   * model's pose, and each committed lead's and the ribbon's anchors, so a drag moves them as it
   * goes. Opening waits until every model and collider file it needs has arrived, then settles.
   */
  private syncCables(doc: CircuitDoc, lift: (key: string) => number): void {
    if (!this.cables.available) return
    const placed: Placement[] = [
      ...doc.boards.map((b) => ({
        key: b.id,
        url: `/models/${b.defId}.colliders.json`,
        pose: poseMatrix(b.transform, boardDef(b.defId).body.heightMm)
      })),
      {
        key: 'pi',
        url: '/models/pi5.colliders.json',
        pose: poseMatrix(doc.controller.pi.transform, 0)
      },
      ...this.bench.placements(),
      ...this.parts.placements(lift),
      ...this.wires.placements()
    ]
    const exits = this.wires.exits()
    const colliders = [TABLE]
    let complete = this.parts.ready && this.bench.ready && this.wires.ready
    for (const p of placed) {
      const file = collidersNow(p.url)
      if (file === undefined) complete = false
      else if (file) colliders.push(...placeColliders(p, file, exits))
    }
    if (this.settle && !complete) return
    const ribbon = this.bench.cable()
    this.cables.sync(colliders, [...this.wires.cables(), ...(ribbon ? [ribbon] : [])], this.settle)
    this.settle = false
  }

  /** Draws the cables from the latest step the worker published. */
  private showCables(): void {
    this.redrawCables = false
    const ready = this.cables.ready
    this.wires.simulate((id) => this.cables.state(id), ready)
    this.bench.simulate(this.cables.state('ribbon'), ready)
    const selection = useStudio.getState().selection
    if (selection?.kind === 'wire') this.placeSelection(this.drawnDoc(), selection)
  }

  /** Brings the simulation's visuals onto the stores' present state. */
  private syncVisuals(): void {
    const { sim, env } = useWorkbench.getState()
    const { voltages, current, sense, tinted } = useStudio.getState()
    const board = useSense.getState()
    const doc = this.drawnDoc()
    const ghosts = new Set(ghostIds(this.base(), doc))
    // A build in progress shows a bench that is not the one the simulation ran: nothing glows. And
    // Board Sense's tint compares the board with the finished document, so while a build is played
    // everything not yet built reads as diverged, and its causes would be searched for one net at a
    // time; the step card reports what the sweeps say of the step instead.
    const build = useBuild.getState()
    const partial = build.on && build.index < build.steps.length
    this.visuals.sync({
      doc,
      review: {
        parts: [
          ...(tinted?.parts ?? []),
          ...doc.parts.filter((p) => ghosts.has(p.id)).map((p) => p.id)
        ],
        wires: [
          ...(tinted?.wires ?? []),
          ...doc.wires.filter((w) => ghosts.has(w.id)).map((w) => w.id)
        ]
      },
      snapshot: partial ? null : (sim?.snapshot ?? null),
      env,
      issues: sim?.issues ?? [],
      voltages,
      current,
      sense: {
        on: sense && board.mode !== 'off' && !build.on,
        states: board.states,
        candidates: board.candidates,
        findCauses: (pin) => void useSense.getState().findCauses(pin)
      }
    })
  }

  /**
   * Frames the step in hand (SPEC 10.7, 11.7), eased in PRESET_MS: its holes and part, the T-board
   * and the Pi for the first step, the whole bench once the build is done. The view's direction
   * stays as the user has it. `jump` sets the camera there at once.
   */
  private frameBuild(jump = false): void {
    const { scene } = useBuild.getState()
    if (!scene) return
    const doc = this.drawnDoc()
    const box = new Box3()
    const add = (sel: Parameters<typeof bodyBox>[1]) => {
      const m = bodyBox(doc, sel)
      if (m) box.union(UNIT.clone().applyMatrix4(m))
    }
    if (scene.tboard) {
      add({ kind: 'tboard' })
      add({ kind: 'pi' })
    } else {
      for (const mark of scene.marks) {
        const at = endpointInScene(doc, mark)
        if (at) box.expandByPoint(at.at)
      }
      if (scene.part) add({ kind: 'part', id: scene.part })
    }
    const direction = this.camera.position.clone().sub(this.controls.target).normalize()
    let to: ReturnType<typeof sphereView>
    if (box.isEmpty()) to = presetView('fit', doc, this.camera, this.controls.target)
    else {
      const sphere = box.getBoundingSphere(new Sphere())
      sphere.radius = Math.max(sphere.radius, FOCUS_MIN_RADIUS_MM)
      to = sphereView(sphere, this.camera, direction)
    }
    if (jump) {
      this.camera.position.copy(to.position)
      this.controls.target.copy(to.target)
      this.camera.lookAt(to.target)
      this.framing = { start: performance.now(), ms: 0 }
    } else {
      const from = { position: this.camera.position, target: this.controls.target }
      this.tween.begin(performance.now(), from, to)
      this.framing = { start: performance.now(), ms: null }
    }
    this.invalidate()
  }

  /** The step's rings over its holes, and a red ring where Board Sense's likeliest cause is. */
  private syncMarks(): void {
    if (!this.stepMarks) return
    const { scene, status } = useBuild.getState()
    const doc = this.drawnDoc()
    const marks: Mark[] = []
    for (const mark of scene?.marks ?? []) {
      const at = endpointInScene(doc, mark)
      if (at) marks.push({ at: at.at, tone: 'step' })
    }
    const likeliest =
      status.state === 'diverged' && Array.isArray(status.causes) && status.causes[0]
    for (const hole of likeliest ? likeliest.candidates[0]!.holes : []) {
      const at = endpointInScene(doc, { hole })
      if (at) marks.push({ at: at.at, tone: 'cause' })
    }
    // Rings that stand where they stood are left alone, so their pulse keeps its beat.
    const key = JSON.stringify(marks.map((m) => [m.at.toArray(), m.tone]))
    if (key === this.marksKey && this.stepMarks.count === marks.length) return
    this.marksKey = key
    this.stepMarks.set(marks)
    this.invalidate()
  }

  /** Depth of field follows the camera's target while Build Mode asks for it; otherwise it is off. */
  private syncFocus(): void {
    const { on, blur } = useBuild.getState()
    this.focusing = on && blur
    if (!this.focusing) this.post?.setFocus(null)
    this.invalidate()
  }

  private buildReport(): BuildReport | null {
    const build = useBuild.getState()
    if (!build.on || !this.canvas) return null
    const [w, h] = [this.canvas.clientWidth, this.canvas.clientHeight]
    return {
      index: build.index,
      ghosts: ghostIds(this.base(), this.ghosted()),
      marks: (this.stepMarks?.screen(this.camera, w, h) ?? []).map(({ x, y, tone }) => ({
        x,
        y,
        tone,
        inView: x >= 0 && y >= 0 && x <= w && y <= h
      })),
      framingMs: this.framing?.ms ?? null,
      blur: this.focusing
    }
  }

  /** Marks what the assistant's highlight names; a focus or no cue marks nothing. */
  private showCue(): void {
    const cue = useStudio.getState().cue
    this.cueMarkers.set(
      cue?.marks
        ? cuePlaces(this.drawnDoc(), this.conn().netlist, cue.refs, {
            size: CUE_SIZE_MM,
            color: CUE_COLOR
          }).markers
        : []
    )
    this.invalidate()
  }

  /**
   * One frame of a capture: once the cables sleep (or 2 s pass), jump to the preset and draw
   * SETTLE_FRAMES frames there. Returns the capture on the frame to read, after it is drawn.
   */
  private captureStep(now: number): Capture | null {
    const c = this.capturing!
    if (c.frames === null) {
      if (this.cables.moving && now - c.since < CAPTURE_SLEEP_MS) return null
      this.tween.cancel()
      c.back = { position: this.camera.position.clone(), target: this.controls.target.clone() }
      const to = presetView(c.preset, circuit.getSnapshot(), this.camera, this.controls.target)
      this.camera.position.copy(to.position)
      this.controls.target.copy(to.target)
      this.camera.lookAt(to.target)
      c.frames = SETTLE_FRAMES
      return null
    }
    c.frames -= 1
    return c.frames <= 0 ? c : null
  }

  /** Reads the frame just drawn (it is still the canvas's current image), then restores the view. */
  private finishCapture(c: Capture): void {
    this.capturing = null
    try {
      const canvas = this.canvas!
      const scale = Math.min(1, CAPTURE_MAX_PX / Math.max(canvas.width, canvas.height))
      const out = document.createElement('canvas')
      out.width = Math.max(1, Math.round(canvas.width * scale))
      out.height = Math.max(1, Math.round(canvas.height * scale))
      out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height)
      const data = out.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
      c.resolve({ mediaType: 'image/png', data })
    } catch (e) {
      c.reject(e instanceof Error ? e : new Error(String(e)))
    }
    if (c.back) {
      this.camera.position.copy(c.back.position)
      this.controls.target.copy(c.back.target)
      this.camera.lookAt(c.back.target)
    }
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
      const doc = this.base()
      const hole = pickHole(doc, this.raycaster.ray)
      info = hole && hoverInfo(doc, this.conn().netlist, hole)
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
    const doc = this.base()
    const board = doc.boards.find((b) => b.id === hole.board)
    const valid = board && isValidHole(boardDef(board.defId), hole)
    this.show(valid ? hoverInfo(doc, this.conn().netlist, hole) : null)
  }

  private show(info: HoverInfo | null): void {
    this.hover = { info, eventFrame: this.loop.frames, shownFrame: null }
    if (this.tooltip) {
      this.tooltip.textContent = info?.text ?? ''
      this.tooltip.hidden = !info
    }
    const doc = this.base()
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
