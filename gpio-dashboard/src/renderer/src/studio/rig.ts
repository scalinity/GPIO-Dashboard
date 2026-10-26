// The stage (SPEC 10.2): the table, the cyclorama sweep, the lights, the environment, the fog and
// the background, built once and set to a look by changing values (ADR-0067). A new environment
// texture, fog object or light would rebuild every lit material, so each is one object here: the
// fog and the background colour are re-coloured, the PMREM target is re-rendered in place, and
// every light stays in the scene, dimmed to 0 when the look does not use it.
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  PMREMGenerator,
  type RenderTarget,
  Scene,
  type Texture,
  type WebGPURenderer
} from 'three/webgpu'
import { duskScene } from './lab/dusk'
import { type Look, STUDIO } from './look'

// The table is centred on the default bench (core/model/defaults: the board at the origin, the Pi
// 120 mm to its left); its top is the table plane, y = 0.
const TABLE = { width: 1000, depth: 700, thickness: 20, centre: [20, -30] as const }

// The sweep: a floor from the front, a curve, and a wall behind, in mm.
const SWEEP = { width: 5000, front: 1500, back: 700, radius: 600, height: 2500 }

/**
 * The key stands 64 degrees up, a little in front: the T-board's shroud then leaves its title out
 * of its shadow (ADR-0067).
 */
const KEY_POSITION = [-120, 640, 220] as const

/** The rim light comes from behind the bench and above it. */
const RIM_POSITION = [300, 450, -800] as const

function sweepGeometry(): BufferGeometry {
  const { width, front, back, radius, height } = SWEEP
  const floor = front + back
  const curve = (Math.PI / 2) * radius
  const length = floor + curve + (height - radius)
  const geometry = new PlaneGeometry(width, length, 1, 128)
  const position = geometry.attributes.position!
  const y0 = -TABLE.thickness
  for (let i = 0; i < position.count; i++) {
    const s = position.getY(i) + length / 2
    let y: number
    let z: number
    if (s <= floor) [z, y] = [front - s, y0]
    else if (s <= floor + curve) {
      const a = (s - floor) / radius
      ;[z, y] = [-back - radius * Math.sin(a), y0 + radius * (1 - Math.cos(a))]
    } else [z, y] = [-back - radius, y0 + radius + (s - floor - curve)]
    position.setXYZ(i, position.getX(i), y, z)
  }
  geometry.computeVertexNormals()
  return geometry
}

export class StageRig {
  /** Everything the scene draws of the stage, lights included. */
  readonly group = new Group()
  readonly fog = new FogExp2('#000000', 0)
  readonly background = new Color()
  readonly key = new DirectionalLight()
  readonly hemisphere = new HemisphereLight()
  readonly rim = new DirectionalLight()
  /** Called when the environment changes outside a frame (the HDRI arriving). */
  onChange: () => void = () => {}

  private readonly table = new Mesh(
    new BoxGeometry(TABLE.width, TABLE.thickness, TABLE.depth),
    new MeshStandardNodeMaterial({ roughness: 0.9 })
  )
  private readonly sweep = new Mesh(sweepGeometry(), new MeshStandardNodeMaterial({ roughness: 1 }))
  private renderer: WebGPURenderer | null = null
  private scene: Scene | null = null
  private pmrem: PMREMGenerator | null = null
  /** The one PMREM target every environment is rendered into. */
  private target: RenderTarget | null = null
  /** What the target holds now. */
  private shown: Texture | Scene | null = null
  private hdri: Texture | null = null
  private readonly dusk = duskScene()
  private look: Look = STUDIO

  constructor() {
    this.table.position.set(TABLE.centre[0], -TABLE.thickness / 2, -TABLE.centre[1])
    this.table.receiveShadow = true
    this.sweep.receiveShadow = true
    const key = this.key
    key.position.set(...KEY_POSITION)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.radius = 4
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.3
    Object.assign(key.shadow.camera, { left: -450, right: 450, top: 450, bottom: -450 })
    Object.assign(key.shadow.camera, { near: 100, far: 1600 })
    this.rim.position.set(...RIM_POSITION)
    this.group.add(this.table, this.sweep, key, this.hemisphere, this.rim)
    this.apply(STUDIO)
  }

  /** The renderer is ready: the scene takes the fog, the background and the environment. */
  bind(renderer: WebGPURenderer, scene: Scene): void {
    this.renderer = renderer
    this.scene = scene
    this.pmrem = new PMREMGenerator(renderer)
    scene.fog = this.fog
    scene.background = this.background
    this.apply(this.look)
  }

  /** The studio HDRI has loaded. */
  setHdri(texture: Texture): void {
    if (this.hdri === texture) return
    this.hdri = texture
    this.environment()
  }

  /** Sets every value of the stage to `look`'s. */
  apply(look: Look): void {
    this.look = look
    this.background.set(look.background)
    this.fog.color.set(look.fog.color)
    this.fog.density = look.fog.density
    this.key.color.set(look.key.color)
    this.key.intensity = look.key.intensity
    this.hemisphere.color.set(look.hemisphere.sky)
    this.hemisphere.groundColor.set(look.hemisphere.ground)
    this.hemisphere.intensity = look.hemisphere.intensity
    this.rim.color.set(look.rim.color)
    this.rim.intensity = look.rim.intensity
    this.table.material.color.set(look.table)
    this.sweep.visible = look.sweep !== null
    if (look.sweep) this.sweep.material.color.set(look.sweep)
    if (this.scene) this.scene.environmentIntensity = look.environment.intensity
    this.environment()
  }

  /** Renders the look's environment into the PMREM target, unless it is there already. */
  private environment(): void {
    const { pmrem, scene, hdri } = this
    const source = this.look.environment.kind === 'dusk' ? this.dusk : hdri
    if (!pmrem || !scene || !source || source === this.shown) return
    this.target =
      source === hdri
        ? pmrem.fromEquirectangular(hdri, this.target)
        : pmrem.fromScene(this.dusk, 0.02, 0.1, 100, { size: 256, renderTarget: this.target })
    this.shown = source
    scene.environment = this.target.texture
    this.onChange()
  }
}
