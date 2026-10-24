// The Studio's imperative side: the camera and its damped orbit, hover picking and highlights, and
// the frame loop. Pointer and key handlers act directly on three objects and request a frame, so a
// hover shows on the very next frame (SPEC 11.3, acceptance 8) without waiting on React.
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  type Scene,
  Vector2,
  Vector3,
  type WebGPURenderer
} from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { boardDef } from '../core/defs/boards'
import { partDef } from '../core/defs/parts'
import { holeKey, isValidHole, parseHoleKey } from '../core/geometry/breadboard'
import type { CircuitDoc, Endpoint } from '../core/model/types'
import { ASSUMED_HEIGHTS_MM, toTable } from '../core/reach/reach'
import { circuit } from '../state/circuit'
import { CameraTween, type Preset, presetView } from './camera'
import { holeInScene, toThree } from './coords'
import { FrameLoop } from './frameLoop'
import { configureModels } from './loaders'
import { hoverInfo, type HoverInfo, pickHole } from './picking'
import { Post } from './renderer'
import { setStatus } from './status'

const KEYS: Record<string, Preset> = { f: 'fit', 1: 'fit', 2: 'iso', 3: 'top', 4: 'front' }

// Highlights are flat squares just above the board, a little larger than a hole (2.54 mm pitch).
const LIFT_MM = 0.15
const STRIP_SIZE_MM = 2.0
const WIRE_END_SIZE_MM = 2.6
const STRIP_COLOR = new Color('#818CF8') // accent-light
const WIRE_END_COLOR = new Color('#FBBF24')

interface Marker {
  at: Vector3
  turn: number
  size: number
  color: Color
}

/** What the last hover showed, and on which frame (tests read it). */
export interface HoverRecord {
  info: HoverInfo | null
  /** `loop.frames` when the hover changed. */
  eventFrame: number
  /** The first frame drawn with it; null until then. */
  shownFrame: number | null
}

export class StudioView {
  readonly camera = new PerspectiveCamera(35, 1, 5, 20000)
  readonly controls = new OrbitControls(this.camera)
  readonly loop = new FrameLoop()
  /** Hover highlights, drawn from core geometry; one instanced mesh, replaced when it must grow. */
  readonly overlay = new Group()
  hover: HoverRecord = { info: null, eventFrame: 0, shownFrame: null }
  post: Post | null = null

  private highlights: InstancedMesh
  private readonly geometry = new BoxGeometry(1, 0.3, 1)
  private readonly material = new MeshBasicNodeMaterial()
  private readonly tween = new CameraTween()
  private readonly raycaster = new Raycaster()
  private invalidate: () => void = () => {}
  private canvas: HTMLCanvasElement | null = null
  private tooltip: HTMLElement | null = null

  constructor() {
    this.highlights = this.instanced(64)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.1
    this.controls.minDistance = 60
    this.controls.maxDistance = 3000
    this.controls.maxPolarAngle = (85 * Math.PI) / 180 // stay above the table
    this.controls.addEventListener('start', () => this.tween.cancel())
    this.controls.addEventListener('change', () => this.invalidate())
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
    this.invalidate()
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
    this.post.render()
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

  /** Attaches input to the Studio's element; returns the detach. */
  attach(element: HTMLElement, tooltip: HTMLElement): () => void {
    this.tooltip = tooltip
    this.controls.connect(element)
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || target?.isContentEditable) return
      if (target?.closest('input, textarea, select')) return
      const preset = KEYS[e.key.toLowerCase()]
      if (preset) this.preset(preset)
    }
    // Hover only over the canvas itself, and not while a button is down (orbiting).
    const onMove = (e: PointerEvent) =>
      this.pointer(e.target === this.canvas && e.buttons === 0 ? e : null)
    const onLeave = () => this.pointer(null)
    const unsubscribe = circuit.subscribe(() => this.refreshHover())
    window.addEventListener('keydown', onKey)
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerleave', onLeave)
    return () => {
      unsubscribe()
      window.removeEventListener('keydown', onKey)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerleave', onLeave)
      this.controls.disconnect()
      this.tooltip = null
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
      const board = doc.boards.find((b) => b.id === hole.board)!
      const turn = (board.transform.rotationDeg * Math.PI) / 180
      markers.push({ at: holeInScene(board, hole), turn, size: STRIP_SIZE_MM, color: STRIP_COLOR })
    }
    for (const { wire, end } of info?.wireEnds ?? []) {
      const w = doc.wires.find((x) => x.id === wire)!
      const at = endpointInScene(doc, end === 'a' ? w.a : w.b)
      if (at) markers.push({ ...at, size: WIRE_END_SIZE_MM, color: WIRE_END_COLOR })
    }
    this.place(markers)
    this.invalidate()
  }

  private place(markers: Marker[]): void {
    if (markers.length > this.highlights.instanceMatrix.count) {
      this.overlay.remove(this.highlights)
      this.highlights.dispose()
      this.highlights = this.instanced(markers.length * 2)
    }
    const m = new Matrix4()
    const q = new Quaternion()
    const up = new Vector3(0, 1, 0)
    markers.forEach(({ at, turn, size, color }, i) => {
      at.y += LIFT_MM
      m.compose(at, q.setFromAxisAngle(up, turn), new Vector3(size, 1, size))
      this.highlights.setMatrixAt(i, m)
      this.highlights.setColorAt(i, color)
    })
    this.highlights.count = markers.length
    this.highlights.instanceMatrix.needsUpdate = true
    this.highlights.instanceColor!.needsUpdate = true
  }

  private instanced(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity)
    // Colours exist from the start, so the material never has to be rebuilt for them.
    mesh.setColorAt(0, STRIP_COLOR)
    mesh.count = 0
    mesh.frustumCulled = false
    this.overlay.add(mesh)
    return mesh
  }
}

/** Where a wire end is: in a hole on a board, or on an off-board module's pin. */
function endpointInScene(doc: CircuitDoc, end: Endpoint): { at: Vector3; turn: number } | null {
  if ('hole' in end) {
    const board = doc.boards.find((b) => b.id === end.hole.board)
    if (!board) return null
    return { at: holeInScene(board, end.hole), turn: (board.transform.rotationDeg * Math.PI) / 180 }
  }
  const part = doc.parts.find((p) => p.id === end.pin.part)
  const pin = part && partDef(part.defId).pins.find((p) => p.id === end.pin.pin)
  const pose = part?.placement.offboardPose
  if (!pose || !pin) return null
  const at = toThree(
    toTable(pose, [pin.offsetPitch[0] * 2.54, pin.offsetPitch[1] * 2.54]),
    ASSUMED_HEIGHTS_MM.modulePin
  )
  return { at, turn: (pose.rotationDeg * Math.PI) / 180 }
}
