// The renderer and its post-processing (SPEC 10.1, 10.2): WebGPURenderer, never the legacy
// WebGLRenderer, and three's node RenderPipeline with GTAO and TRAA, then each look's own finish:
// bloom, the tone mapping and grade (the pipeline draws without the renderer's tone mapping) and, in
// the Lab look, a faint grain. One output holds both finishes and a uniform picks one, so a look
// switch compiles nothing (ADR-0143). The Lab look focuses on the bench with a depth-aware bokeh
// (ADR-0145); Build Mode narrows its band to the step, and in the Studio look builds three's depth
// of field the first time it asks for focus. No aberration or lens dirt.
import {
  AgXToneMapping,
  type DirectionalLight,
  type Node,
  NodeUpdateType,
  NoToneMapping,
  RenderPipeline,
  type PerspectiveCamera,
  type Scene,
  SRGBColorSpace,
  type TextureNode,
  TimestampQuery,
  UnsignedByteType,
  Vector2,
  WebGPURenderer
} from 'three/webgpu'
import {
  acesFilmicToneMapping,
  builtinAOContext,
  float,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  max,
  min,
  smoothstep,
  pass,
  renderOutput,
  sample,
  saturation,
  screenUV,
  select,
  uniform,
  unpackRGBToNormal,
  vec4,
  velocity
} from 'three/tsl'
import type BloomNode from 'three/addons/tsl/display/BloomNode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { film } from 'three/addons/tsl/display/FilmNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { setFrameCost } from '../dev/frameCost'
import { bokeh, bokehUniforms } from './bokeh'
import { LAB, type LookName, STUDIO } from './look'
import { type Backend, setStatus } from './status'

/**
 * R3F's async renderer factory: the renderer is ready, and its backend known, when it resolves.
 * R3F hands it the DOM canvas it made.
 */
export async function createRenderer({ canvas }: { canvas: EventTarget }): Promise<WebGPURenderer> {
  // TRAA resolves edges, and it requires MSAA off. Dev builds time the GPU's passes (ADR-0082).
  const renderer = new WebGPURenderer({
    canvas: canvas as HTMLCanvasElement,
    antialias: false,
    powerPreference: 'high-performance',
    trackTimestamp: import.meta.env.DEV
  })
  renderer.toneMappingExposure = GRADE.exposure
  await renderer.init()
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'WebGPU'
    : 'WebGL2 (fallback)'
  console.info(`[studio] renderer backend: ${backend}`)
  setStatus({ backend })
  return renderer
}

type Output = Node<'vec4'>

/**
 * The look-dev grade (ADR-0067). AgX pulls saturated primaries toward grey (a pure red leaves it at
 * about 214, 83, 65 and a yellow at 230, 185, 120; the reference photos' are 208, 10, 14 and
 * 245, 203, 26) and, lit by the studio, leaves the white boards a step darker than the photos'.
 * The exposure is lifted, and once AgX has tone mapped the image, each pixel's distance below its
 * brightest channel is stretched by up to `1 + stretch`, in proportion to how colourful the
 * pixel is: greys and whites stay where they are, reds and yellows go back to red and yellow. AgX
 * stays the tone mapping, and nothing else is added. The numbers are the Studio look's.
 */
export const GRADE = { exposure: STUDIO.tone.exposure, saturation: STUDIO.tone.stretch }

/**
 * Bloom takes only what is brighter than this in scene-linear light: a lit LED's emission, which
 * passes it, and not the key light's highlight on a board's metal rings or the Pi's shields, which
 * pass 1 (ADR-0067). The Lab's room is drawn below it too (ADR-0144).
 */
export const BLOOM_THRESHOLD = 2

/**
 * The Lab look's depth of field (ADR-0145): the distance over which the blur ramps from none to
 * full around the bench, and around Build Mode's step; its largest radius in CSS pixels.
 */
const BENCH_BAND_MM = 4000
const STEP_BAND_MM = 320
const MAX_BLUR_PX = 10

/**
 * GTAO's resolution against the drawing buffer's, per look: the first step of SPEC 10.8's ladder
 * in the Lab look, whose dusk keeps the occlusion's detail in shadow (ADR-0145).
 */
const AO_SCALE: Record<LookName, number> = { studio: 0.5, lab: 0.35 }

/** The key light's shadow map is redrawn every this many frames (ADR-0082). */
const SHADOW_EVERY = 2

export class Post {
  private readonly pipeline: RenderPipeline
  private readonly resolved: Output
  private readonly viewZ: Node
  /**
   * 1 in the Lab look. One output holds both looks' finishes and picks one by it: pointing the
   * pipeline at another output node would release the GPU pipeline of the one it leaves and
   * build it again on the way back (ADR-0143).
   */
  private readonly lab = uniform(0)
  /** Every bloom node built, with the strength it draws at and its look, for `gate`. */
  private readonly blooms = new Map<BloomNode, { strength: number; look: LookName }>()
  /** Other nodes that draw passes of their own for one look only (depth of field). */
  private readonly own = new Map<Node, LookName>()
  /** The Lab look's depth of field, and the bench's image through it. */
  private readonly lens = bokehUniforms()
  private readonly occlusion: ReturnType<typeof ao>
  private readonly labInput: Output
  private readonly size = new Vector2()
  /** Both looks' output without depth of field. */
  private readonly output: Output
  private look: LookName = 'studio'
  private bloom = true
  /** Where Build Mode's depth of field focuses, and the output with it once built. */
  private readonly focus = { distance: uniform(0), output: null as Output | null }
  private focused = false
  private key: DirectionalLight | null = null
  private rendered = 0
  private renderMs = 0

  constructor(
    /** Public for the e2e frame-rate measurement, which reads the GPU's timestamp queries. */
    readonly renderer: WebGPURenderer,
    scene: Scene,
    private readonly camera: PerspectiveCamera
  ) {
    // One geometry pass draws the colour, the packed normal and the velocity. GTAO reads that
    // pass's depth and normals, and the same pass applies the occlusion to its ambient light: the
    // occlusion it applies was drawn from the previous frame's depth and normals (ADR-0082).
    const colour = pass(scene, camera)
    colour.setMRT(mrt({ output, normal: packNormalToRGB(normalView), velocity }))
    colour.getTexture('normal').type = UnsignedByteType
    const normal = sample((uv) => unpackRGBToNormal(colour.getTextureNode('normal').sample(uv)))
    const depth = colour.getTextureNode('depth')
    this.viewZ = colour.getViewZNode()

    // GTAO's radius is in scene units: 8 mm, about three pitches.
    const occlusion = ao(depth, normal, camera)
    this.occlusion = occlusion
    occlusion.resolutionScale = AO_SCALE.studio
    occlusion.useTemporalFiltering = true
    occlusion.radius.value = 8
    colour.contextNode = builtinAOContext(occlusion.getTextureNode().sample(screenUV).r)

    const resolved = traa(colour, depth, colour.getTextureNode('velocity'), camera)
    resolved.useSubpixelCorrection = false
    this.resolved = resolved

    // getTextureNode() exists on TRAANode in r186 but is missing from @types/three 0.186.
    const sharp = (resolved as unknown as { getTextureNode(): TextureNode }).getTextureNode()
    this.lens.band.value = BENCH_BAND_MM
    const lens = bokeh(sharp, depth, this.lens)
    for (const p of lens.passes) this.own.set(p, 'lab')
    this.labInput = lens.output
    this.output = this.pick(this.finishLab(lens.output), this.finish(resolved))
    this.pipeline = new RenderPipeline(renderer, this.output)
    this.pipeline.outputColorTransform = false
    this.gate()
  }

  /** The output without depth of field (tests compare the pipeline's with it). */
  get sharp(): Output {
    return this.output
  }

  /** Draws `look` from the next frame. */
  setLook(look: LookName): void {
    this.look = look
    this.lab.value = look === 'lab' ? 1 : 0
    this.occlusion.resolutionScale = AO_SCALE[look]
    this.gate()
  }

  /** Where the Lab look's depth of field focuses: the bench, `distanceMm` from the camera. */
  setBenchFocus(distanceMm: number): void {
    this.lens.focus.value = distanceMm
  }

  /** The light whose shadow map `render` redraws. */
  setKey(light: DirectionalLight): void {
    this.key = light
  }

  render(): void {
    if (this.key) {
      // A shadow that trails by one frame is under a millimetre behind a dragged board; the
      // settling frames after the last change redraw it.
      this.key.shadow.autoUpdate = false
      this.key.shadow.needsUpdate = this.rendered % SHADOW_EVERY === 0
    }
    this.renderer.getDrawingBufferSize(this.size)
    this.lens.texel.value.set(1 / this.size.x, 1 / this.size.y)
    this.lens.maxBlur.value = MAX_BLUR_PX * this.renderer.getPixelRatio()
    this.lens.near.value = this.camera.near
    this.lens.far.value = this.camera.far
    if (import.meta.env.DEV) this.renderTimed()
    else this.pipeline.render()
    // The frame that drew a bloom of strength 0 left its texture black; it is not drawn again.
    if (!this.bloom) for (const b of this.blooms.keys()) b.updateBeforeType = NodeUpdateType.NONE
    this.rendered += 1
  }

  /**
   * Whether anything in the scene passes the bloom's threshold. While nothing does, its twelve
   * passes (4 to 5 ms of GPU time) would add black, so the node is left out of the frame; the
   * image is the same. It is drawn again from the frame that asks for it.
   */
  setBloom(on: boolean): void {
    if (on === this.bloom) return
    this.bloom = on
    this.gate()
  }

  /**
   * Leaves out of the frame every pass the active look does not show, and its blooms while
   * nothing passes the threshold: they draw once more at strength 0, then not at all.
   */
  private gate(): void {
    for (const [b, { strength, look }] of this.blooms) {
      const mine = look === this.look
      b.strength.value = mine && this.bloom ? strength : 0
      b.updateBeforeType = mine ? NodeUpdateType.FRAME : NodeUpdateType.NONE
    }
    for (const [node, look] of this.own)
      node.updateBeforeType = look === this.look ? NodeUpdateType.FRAME : NodeUpdateType.NONE
  }

  /** Dev builds: the render call's main-thread time and the GPU's pass time, every 30 frames. */
  private renderTimed(): void {
    const t0 = performance.now()
    this.pipeline.render()
    this.renderMs += performance.now() - t0
    if (this.rendered % 30 !== 29) return
    const renderMs = this.renderMs / 30
    this.renderMs = 0
    const { info } = this.renderer
    void this.renderer.resolveTimestampsAsync(TimestampQuery.RENDER).then(() => {
      const gpuMs = info.render.timestamp
      setFrameCost({ renderMs, gpuMs: gpuMs > 0 ? gpuMs : null })
    })
  }

  /**
   * Depth of field focused `distanceMm` along the view, or none (Build Mode, SPEC 11.7). The Lab
   * look's narrows to the step; the Studio look's is three's, built the first time.
   */
  setFocus(distanceMm: number | null): void {
    if (distanceMm !== null) this.focus.distance.value = distanceMm
    this.focused = distanceMm !== null
    this.lens.band.value = this.focused ? STEP_BAND_MM : BENCH_BAND_MM
    const output = this.focused ? this.focusOutput() : this.output
    if (this.pipeline.outputNode !== output) {
      this.pipeline.outputNode = output
      this.pipeline.needsUpdate = true
    }
  }

  /** The output with depth of field, built the first time it is asked for. */
  private focusOutput(): Output {
    if (!this.focus.output) {
      // @types/three 0.186 leaves DepthOfFieldNode's output type out; it is a vec4 like TRAA's.
      const blurred = dof(
        this.resolved,
        this.viewZ,
        this.focus.distance,
        120,
        4
      ) as unknown as Output
      this.own.set(blurred, 'studio')
      this.focus.output = this.pick(this.finishLab(this.labInput), this.finish(blurred))
      this.gate()
    }
    return this.focus.output
  }

  /** The Lab look's output in the Lab look, the Studio look's otherwise. */
  private pick(lab: Output, studio: Output): Output {
    return select(this.lab.greaterThan(0.5), lab, studio)
  }

  /**
   * The Studio look's finish (ADR-0067): bloom, then the AgX mapping and sRGB encoding the
   * pipeline's own output transform would apply (it is off), then the grade.
   */
  private finish(input: Output): Output {
    const lit = input.add(this.glow(input, 'studio'))
    const mapped = renderOutput(lit, AgXToneMapping, SRGBColorSpace)
    const peak = max(max(mapped.r, mapped.g), mapped.b)
    const below = peak.sub(mapped.rgb)
    const chroma = peak.sub(min(min(mapped.r, mapped.g), mapped.b)).div(max(peak, 1e-4))
    const stretch = smoothstep(0.1, 0.5, chroma).mul(STUDIO.tone.stretch).add(1)
    return vec4(peak.sub(min(below.mul(stretch), peak)), mapped.a)
  }

  /**
   * The Lab look's finish, after the exhibit house style: bloom, a saturation lift that offsets
   * ACES's desaturation of bright colours, ACES Filmic at the look's exposure, a faint film grain,
   * and the sRGB encoding.
   */
  private finishLab(input: Output): Output {
    const lit = input.rgb.add(this.glow(input, 'lab').rgb)
    const graded = saturation(lit, LAB.tone.saturation).max(0)
    // @types/three 0.186 types the tone-mapping functions as returning a plain Node; it is a vec3.
    const toned = acesFilmicToneMapping(graded, float(LAB.tone.exposure)) as Node<'vec3'>
    const grained = film(vec4(toned, 1), float(LAB.grain))
    return renderOutput(grained, NoToneMapping, SRGBColorSpace)
  }

  /** A bloom of `input` at the bloom's threshold, gated with the others. */
  private glow(input: Output, look: LookName) {
    const { strength, radius } = (look === 'lab' ? LAB : STUDIO).bloom
    const glow = bloom(input, strength, radius, BLOOM_THRESHOLD)
    this.blooms.set(glow, { strength, look })
    return glow
  }
}
