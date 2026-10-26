// The opening tour (SPEC 10.7, ADR-0147): the first time the Studio opens in a launch, in the Lab
// look, the camera takes three slow shots of the bench in its workroom, dipping through the veil
// between them, then eases home to the iso preset. The shots are planned from the bench itself,
// so every project gets its own; the view runs them and gives them up to the first input.
import piBoardJson from '../content/controllers/pi5-board.json'
import { boardDef } from '../core/defs/boards'
import { tboardPinHole } from '../core/geometry/tboard'
import type { CircuitDoc } from '../core/model/types'
import { toTable } from '../core/reach/reach'
import { Box3, MathUtils, type PerspectiveCamera, Spherical, Vector3 } from 'three/webgpu'
import { contentBox, presetView, type View } from './camera'
import { holeInScene, toThree } from './coords'

/** One move of the camera: the target and the camera about it, from and to, over `ms`. */
export interface Shot {
  name: 'room' | 'bench' | 'close' | 'home'
  target: [Vector3, Vector3]
  /** Distance (mm), polar angle from straight up and azimuth from the front, about the target. */
  orbit: [Spherical, Spherical]
  ms: number
  /** Whether the shot ends in a cut: the veil dips to black over its last DIP_MS. */
  cut: boolean
}

/** How long the veil takes to dip at a cut, and to lift after it. */
export const DIP_MS = 350

/** What the shots are planned around, in the scene (mm). */
export interface Bench {
  /** The middle of the boards and the Pi. */
  centre: Vector3
  pi: Vector3
  board: Vector3
  /** What the close-up looks at: the brightest lit part, else the T-board. */
  close: Vector3
  /** Where the tour ends: the iso preset. */
  home: View
}

/**
 * What the tour is planned around for `doc` seen through `camera`. `close` is the brightest lit
 * part's middle when one is lit; otherwise the close-up looks at the T-board.
 */
export function benchOf(doc: CircuitDoc, camera: PerspectiveCamera, close?: Vector3): Bench {
  const centre = contentBox(doc).getCenter(new Vector3())
  const { widthMm, depthMm } = piBoardJson.outline
  const pi = toThree(toTable(doc.controller.pi.transform, [widthMm / 2, depthMm / 2]), 10)
  const tb = doc.controller.tboard
  const host = doc.boards.find((b) => b.id === tb.board) ?? doc.boards[0]
  let board = centre.clone()
  let tboard = centre.clone()
  if (host) {
    const { lengthMm, widthMm: w, heightMm } = boardDef(host.defId).body
    board = toThree(toTable(host.transform, [lengthMm / 2, w / 2]), heightMm)
    if (host.id === tb.board)
      tboard = new Box3()
        .expandByPoint(holeInScene(host, tboardPinHole(tb, 1)))
        .expandByPoint(holeInScene(host, tboardPinHole(tb, 40)))
        .getCenter(new Vector3())
  }
  const home = presetView('iso', doc, camera, centre)
  return { centre, pi, board, close: close ?? tboard, home }
}

const deg = MathUtils.degToRad

/** The tour's shots for `bench`: about 16 s in all, each turning 1.6 to 3 degrees a second. */
export function planShots(bench: Bench): Shot[] {
  const orbit = (radius: number, phi: number, theta: number) =>
    new Spherical(radius, deg(phi), deg(theta))
  const homeOrbit = new Spherical().setFromVector3(
    bench.home.position.clone().sub(bench.home.target)
  )
  return [
    {
      // The bench small in its room at dusk, the window and the light bars behind it.
      name: 'room',
      target: [bench.centre.clone(), bench.centre.clone()],
      orbit: [orbit(1400, 64, -20), orbit(1300, 64, -7)],
      ms: 5000,
      cut: true
    },
    {
      // Low along the bench, from the Pi to the breadboard.
      name: 'bench',
      target: [bench.pi.clone(), bench.board.clone()],
      orbit: [orbit(420, 74, 34), orbit(400, 74, 24)],
      ms: 5000,
      cut: true
    },
    {
      // Close on one part, the room melting behind it.
      name: 'close',
      target: [bench.close.clone(), bench.close.clone()],
      orbit: [orbit(170, 58, 20), orbit(150, 58, 9.7)],
      ms: 4500,
      cut: false
    },
    {
      name: 'home',
      target: [bench.close.clone(), bench.home.target.clone()],
      orbit: [orbit(150, 58, 9.7), homeOrbit],
      ms: 1200,
      cut: false
    }
  ]
}

const smooth = (t: number) => (1 - Math.cos(Math.PI * t)) / 2

/** Puts the camera and its target `k` of the way through `shot`. */
function place(shot: Shot, k: number, camera: PerspectiveCamera, target: Vector3): void {
  const [from, to] = shot.orbit
  target.lerpVectors(shot.target[0], shot.target[1], k)
  const s = new Spherical(
    MathUtils.lerp(from.radius, to.radius, k),
    MathUtils.lerp(from.phi, to.phi, k),
    MathUtils.lerp(from.theta, to.theta, k)
  )
  camera.position.setFromSpherical(s).add(target)
  camera.lookAt(target)
}

/** Runs planned shots on the camera, one frame at a time. */
export class Tour {
  private shots: Shot[] = []
  private index = 0
  private start = 0

  get playing(): boolean {
    return this.shots.length > 0
  }

  begin(shots: Shot[], now: number): void {
    this.shots = shots
    this.index = 0
    this.start = now
  }

  stop(): void {
    this.shots = []
  }

  /**
   * Moves the camera and its target to where the tour is at `now`. Returns the veil's opacity
   * (0 to 1), or null once the last shot has ended.
   */
  step(now: number, camera: PerspectiveCamera, target: Vector3): number | null {
    let shot = this.shots[this.index]
    while (shot && now - this.start >= shot.ms) {
      // The last shot ends exactly where it was going: home.
      if (this.index === this.shots.length - 1) {
        place(shot, 1, camera, target)
        this.shots = []
        return null
      }
      this.start += shot.ms
      shot = this.shots[++this.index]
    }
    if (!shot) {
      this.shots = []
      return null
    }
    const elapsed = now - this.start
    const t = elapsed / shot.ms
    // The shots drift at an even pace; the move home eases in and out.
    place(shot, shot.name === 'home' ? smooth(t) : t, camera, target)
    // Black at the start, a dip into each cut, and a lift out of it.
    const after = this.index === 0 || this.shots[this.index - 1]!.cut
    const lift = after ? MathUtils.clamp(1 - elapsed / DIP_MS, 0, 1) : 0
    const dip = shot.cut ? MathUtils.clamp((elapsed - (shot.ms - DIP_MS)) / DIP_MS, 0, 1) : 0
    return Math.max(lift, dip)
  }
}
