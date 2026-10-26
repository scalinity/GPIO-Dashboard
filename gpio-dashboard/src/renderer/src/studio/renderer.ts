// The renderer and its post-processing (SPEC 10.1, 10.2): WebGPURenderer, never the legacy
// WebGLRenderer, and three's node RenderPipeline with GTAO, bloom and TRAA. Depth of field is
// built when something first asks for focus (Build Mode). No grain, aberration or lens dirt.
import {
  AgXToneMapping,
  type Camera,
  type DirectionalLight,
  type Node,
  NodeUpdateType,
  RenderPipeline,
  type Scene,
  SRGBColorSpace,
  TimestampQuery,
  UnsignedByteType,
  WebGPURenderer
} from 'three/webgpu'
import {
  builtinAOContext,
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
  screenUV,
  uniform,
  unpackRGBToNormal,
  vec4,
  velocity
} from 'three/tsl'
import type BloomNode from 'three/addons/tsl/display/BloomNode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { setFrameCost } from '../dev/frameCost'
import { type LookName, STUDIO } from './look'
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
 * pass 1 (ADR-0067).
 */
export const BLOOM_THRESHOLD = 2

/** The key light's shadow map is redrawn every this many frames (ADR-0082). */
const SHADOW_EVERY = 2

export class Post {
  private readonly pipeline: RenderPipeline
  private readonly resolved: Output
  private readonly viewZ: Node
  /** Every bloom node built, with the strength it draws at, for `setBloom`. */
  private readonly blooms = new Map<BloomNode, number>()
  /** Each look's output without depth of field. */
  private readonly outputs: Record<LookName, Output>
  private look: LookName = 'studio'
  private bloom = true
  private focus: { output: Output; distance: ReturnType<typeof uniform> } | null = null
  private focused = false
  private key: DirectionalLight | null = null
  private rendered = 0
  private renderMs = 0

  constructor(
    /** Public for the e2e frame-rate measurement, which reads the GPU's timestamp queries. */
    readonly renderer: WebGPURenderer,
    scene: Scene,
    camera: Camera
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
    occlusion.resolutionScale = 0.5
    occlusion.useTemporalFiltering = true
    occlusion.radius.value = 8
    colour.contextNode = builtinAOContext(occlusion.getTextureNode().sample(screenUV).r)

    const resolved = traa(colour, depth, colour.getTextureNode('velocity'), camera)
    resolved.useSubpixelCorrection = false
    this.resolved = resolved

    this.outputs = { studio: this.finish(resolved) }
    this.pipeline = new RenderPipeline(renderer, this.outputs.studio)
    this.pipeline.outputColorTransform = false
  }

  /** The active look's output without depth of field (tests compare the pipeline's with it). */
  get sharp(): Output {
    return this.outputs[this.look]
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
    for (const [b, strength] of this.blooms) {
      b.strength.value = on ? strength : 0
      b.updateBeforeType = NodeUpdateType.FRAME
    }
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

  /** Depth of field focused `distanceMm` along the view, or none (Build Mode, SPEC 11.7). */
  setFocus(distanceMm: number | null): void {
    if (distanceMm !== null) {
      this.focus ??= (() => {
        const distance = uniform(distanceMm)
        // @types/three 0.186 leaves DepthOfFieldNode's output type out; it is a vec4 like TRAA's.
        const blurred = dof(this.resolved, this.viewZ, distance, 120, 4) as unknown as Output
        return { output: this.finish(blurred), distance }
      })()
      this.focus.distance.value = distanceMm
    }
    this.focused = distanceMm !== null
    this.show()
  }

  /** Points the pipeline at the output the look and the focus ask for. */
  private show(): void {
    const output = this.focused ? this.focus!.output : this.sharp
    if (this.pipeline.outputNode !== output) {
      this.pipeline.outputNode = output
      this.pipeline.needsUpdate = true
    }
  }

  /**
   * The Studio look's finish (ADR-0067): bloom, then the AgX mapping and sRGB encoding the
   * pipeline's own output transform would apply (it is off), then the grade.
   */
  private finish(input: Output): Output {
    const { strength, radius } = STUDIO.bloom
    const glow = bloom(input, strength, radius, BLOOM_THRESHOLD)
    if (!this.bloom) glow.strength.value = 0
    this.blooms.set(glow, strength)
    const lit = input.add(glow)
    const mapped = renderOutput(lit, AgXToneMapping, SRGBColorSpace)
    const peak = max(max(mapped.r, mapped.g), mapped.b)
    const below = peak.sub(mapped.rgb)
    const chroma = peak.sub(min(min(mapped.r, mapped.g), mapped.b)).div(max(peak, 1e-4))
    const stretch = smoothstep(0.1, 0.5, chroma).mul(STUDIO.tone.stretch).add(1)
    return vec4(peak.sub(min(below.mul(stretch), peak)), mapped.a)
  }
}
