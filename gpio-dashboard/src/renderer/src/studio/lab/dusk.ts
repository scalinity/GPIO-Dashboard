// The Lab look's environment (SPEC 10.2, ADR-0143): a small dusk scene that StageRig prefilters
// into the PMREM target the Studio's HDRI uses. A deep navy zenith over a warm low band, the
// workroom's window glowing lavender behind the bench (north, -z), the amber bars beside it, the
// shelf's strip to the east and the desk lamp to the west, as the room draws them. It lights the
// bench's ambient side and gives metal and glass something to reflect. Its brightest panel times
// the look's environment intensity stays under 2, so a mirror-like part reflecting it never
// passes the bloom's threshold (ADR-0067).
//
// Units are arbitrary (only directions matter); nothing tests depth, so the PMREM target needs
// no depth buffer.
import {
  BackSide,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicNodeMaterial,
  type Node,
  PlaneGeometry,
  Scene,
  SphereGeometry
} from 'three/webgpu'
import { mix, positionLocal, smoothstep, vec3 } from 'three/tsl'

/** Sky stops from straight down (-1) to straight up (1), each colour times its gain. */
const SKY: [y: number, colour: string, gain: number][] = [
  [-1, '#1a140f', 1],
  [-0.05, '#3a2a1e', 1],
  [0.04, '#d9895a', 0.55],
  [0.22, '#3b3a5c', 0.6],
  [0.65, '#121a36', 0.8],
  [1, '#0a0f22', 0.8]
]

/** Glowing panels: size, colour, gain, and where they stand around the bench. */
const PANELS: [w: number, h: number, colour: string, gain: number, at: [number, number, number]][] =
  [
    [20, 26, '#c9b6ff', 1.3, [4, 14, -40]], // the dusk window, behind the bench
    [1.4, 24, '#ffb454', 2.4, [-14, 12, -39]], // the amber bars either side of it
    [1.4, 24, '#ffb454', 2.4, [22, 12, -39]],
    [1.2, 24, '#ffc070', 1.6, [40, 8, 4]], // the shelf's strip, east
    [3, 3, '#ffcf8a', 2.4, [-38, 4, 6]] // the desk lamp, west
  ]

const rgb = (hex: string, gain: number) => {
  const c = new Color(hex).multiplyScalar(gain)
  return vec3(c.r, c.g, c.b)
}

export function duskScene(): Scene {
  const scene = new Scene()
  const sky = new MeshBasicNodeMaterial({ side: BackSide, depthTest: false, depthWrite: false })
  const up = positionLocal.normalize().y
  let colour: Node<'vec3'> = rgb(SKY[0]![1], SKY[0]![2])
  for (let i = 1; i < SKY.length; i++) {
    const [y0] = SKY[i - 1]!
    const [y1, hex, gain] = SKY[i]!
    colour = mix(colour, rgb(hex, gain), smoothstep(y0, y1, up))
  }
  sky.colorNode = colour
  scene.add(new Mesh(new SphereGeometry(50, 48, 24), sky))
  for (const [w, h, hex, gain, at] of PANELS) {
    const material = new MeshBasicNodeMaterial({
      side: DoubleSide,
      depthTest: false,
      depthWrite: false
    })
    material.colorNode = rgb(hex, gain)
    const panel = new Mesh(new PlaneGeometry(w, h), material)
    panel.position.set(...at)
    panel.lookAt(0, at[1] * 0.4, 0)
    // Drawn after the sky, over it.
    panel.renderOrder = 1
    scene.add(panel)
  }
  return scene
}
