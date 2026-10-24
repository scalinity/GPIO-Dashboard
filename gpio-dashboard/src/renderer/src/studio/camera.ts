// Camera presets (SPEC 10.7, 11.2): Fit keeps the view direction, Iso, Top and Front set one; all
// frame the document's boards and Pi, and move there with easing in PRESET_MS (at most 600 ms).
import piBoardJson from '../content/controllers/pi5-board.json'
import { boardDef } from '../core/defs/boards'
import type { CircuitDoc, Transform2D, Vec2 } from '../core/model/types'
import { toTable } from '../core/reach/reach'
import { Box3, MathUtils, type PerspectiveCamera, Sphere, Spherical, Vector3 } from 'three/webgpu'
import { toThree } from './coords'

export const PRESETS = ['fit', 'iso', 'top', 'front'] as const
export type Preset = (typeof PRESETS)[number]

export const PRESET_MS = 500

/** Polar angle from straight up and azimuth about it, from the front (three +z, the a side). */
const DIRECTIONS: Record<Exclude<Preset, 'fit'>, { phi: number; theta: number }> = {
  iso: { phi: MathUtils.degToRad(54.74), theta: MathUtils.degToRad(45) },
  // Not quite 0: the azimuth then fixes which way is up on screen (column j at the top).
  top: { phi: 1e-4, theta: 0 },
  front: { phi: MathUtils.degToRad(70), theta: 0 }
}

/** Height of the Pi with its header, for framing only. */
const PI_HEIGHT_MM = 20

/** The boards and the Pi as a box in the scene. */
export function contentBox(doc: CircuitDoc): Box3 {
  const box = new Box3()
  const add = (t: Transform2D, [w, d]: Vec2, height: number) => {
    for (const corner of [
      [0, 0],
      [w, 0],
      [0, d],
      [w, d]
    ] as const) {
      box.expandByPoint(toThree(toTable(t, corner), 0))
      box.expandByPoint(toThree(toTable(t, corner), height))
    }
  }
  for (const board of doc.boards) {
    const { lengthMm, widthMm, heightMm } = boardDef(board.defId).body
    add(board.transform, [lengthMm, widthMm], heightMm)
  }
  const { widthMm, depthMm } = piBoardJson.outline
  add(doc.controller.pi.transform, [widthMm, depthMm], PI_HEIGHT_MM)
  return box
}

export interface View {
  position: Vector3
  target: Vector3
}

/** Where the camera goes for a preset; Fit keeps the current direction. */
export function presetView(
  preset: Preset,
  doc: CircuitDoc,
  camera: PerspectiveCamera,
  target: Vector3
): View {
  const sphere = contentBox(doc).getBoundingSphere(new Sphere())
  const vfov = MathUtils.degToRad(camera.fov)
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect)
  const distance = (sphere.radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.05
  const direction =
    preset === 'fit'
      ? camera.position.clone().sub(target).normalize()
      : new Vector3().setFromSpherical(
          new Spherical(1, DIRECTIONS[preset].phi, DIRECTIONS[preset].theta)
        )
  return {
    position: sphere.center.clone().addScaledVector(direction, distance),
    target: sphere.center.clone()
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** An eased move between two views, around the target so it never cuts through the scene. */
export class CameraTween {
  private from: { target: Vector3; spherical: Spherical } | null = null
  private to: { target: Vector3; spherical: Spherical } | null = null
  private start = 0

  get active(): boolean {
    return this.to !== null
  }

  begin(now: number, from: View, to: View): void {
    const spherical = (v: View) =>
      new Spherical().setFromVector3(v.position.clone().sub(v.target)).makeSafe()
    this.from = { target: from.target.clone(), spherical: spherical(from) }
    this.to = { target: to.target.clone(), spherical: spherical(to) }
    // Turn the short way round.
    const turn = this.to.spherical.theta - this.from.spherical.theta
    this.to.spherical.theta -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI
    this.start = now
  }

  cancel(): void {
    this.from = this.to = null
  }

  /** Moves the camera and target along the tween. Returns whether it is still running. */
  step(now: number, camera: PerspectiveCamera, target: Vector3): boolean {
    if (!this.from || !this.to) return false
    const t = Math.min(1, (now - this.start) / PRESET_MS)
    const k = ease(t)
    const { from, to } = this
    target.lerpVectors(from.target, to.target, k)
    const s = new Spherical(
      MathUtils.lerp(from.spherical.radius, to.spherical.radius, k),
      MathUtils.lerp(from.spherical.phi, to.spherical.phi, k),
      MathUtils.lerp(from.spherical.theta, to.spherical.theta, k)
    )
    camera.position.setFromSpherical(s).add(target)
    camera.lookAt(target)
    if (t === 1) this.from = this.to = null
    return t < 1
  }
}
