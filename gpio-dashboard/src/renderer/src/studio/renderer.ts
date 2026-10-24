// The renderer and its post-processing (SPEC 10.1, 10.2): WebGPURenderer, never the legacy
// WebGLRenderer, and three's node RenderPipeline with GTAO, bloom and TRAA. Depth of field is
// built when something first asks for focus (Build Mode). No grain, aberration or lens dirt.
import {
  AgXToneMapping,
  type Camera,
  type Node,
  RenderPipeline,
  type Scene,
  SRGBColorSpace,
  UnsignedByteType,
  WebGPURenderer
} from 'three/webgpu'
import {
  builtinAOContext,
  mrt,
  normalView,
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
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { type Backend, setStatus } from './status'

/**
 * R3F's async renderer factory: the renderer is ready, and its backend known, when it resolves.
 * R3F hands it the DOM canvas it made.
 */
export async function createRenderer({ canvas }: { canvas: EventTarget }): Promise<WebGPURenderer> {
  // TRAA resolves edges, and it requires MSAA off.
  const renderer = new WebGPURenderer({
    canvas: canvas as HTMLCanvasElement,
    antialias: false,
    powerPreference: 'high-performance'
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
 * brightest channel is stretched by up to `1 + saturation`, in proportion to how colourful the
 * pixel is: greys and whites stay where they are, reds and yellows go back to red and yellow. AgX
 * stays the tone mapping, and nothing else is added.
 */
export const GRADE = { exposure: 1.7, saturation: 1.2 }

/**
 * Bloom takes only what is brighter than this in scene-linear light: a lit LED's emission, which
 * passes it, and not the key light's highlight on a board's metal rings or the Pi's shields, which
 * pass 1 (ADR-0067).
 */
export const BLOOM_THRESHOLD = 2

// The pipeline's own output transform is off, so the same AgX mapping and sRGB encoding are
// applied here, followed by the grade.
const finish = (input: Output): Output => {
  const lit = input.add(bloom(input, 0.35, 0.4, BLOOM_THRESHOLD))
  const mapped = renderOutput(lit, AgXToneMapping, SRGBColorSpace)
  const peak = max(max(mapped.r, mapped.g), mapped.b)
  const below = peak.sub(mapped.rgb)
  const chroma = peak.sub(min(min(mapped.r, mapped.g), mapped.b)).div(max(peak, 1e-4))
  const stretch = smoothstep(0.1, 0.5, chroma).mul(GRADE.saturation).add(1)
  return vec4(peak.sub(min(below.mul(stretch), peak)), mapped.a)
}

export class Post {
  private readonly pipeline: RenderPipeline
  private readonly sharp: Output
  private readonly resolved: Output
  private readonly viewZ: Node
  private focus: { output: Output; distance: ReturnType<typeof uniform> } | null = null

  constructor(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
    // A pre-pass gives GTAO depth and normals before the colour pass, so occlusion darkens only
    // the ambient (image-based) light; it also gives TRAA depth and velocity.
    const pre = pass(scene, camera)
    pre.transparent = false
    pre.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }))
    pre.getTexture('output').type = UnsignedByteType
    const normal = sample((uv) => unpackRGBToNormal(pre.getTextureNode().sample(uv)))
    const depth = pre.getTextureNode('depth')
    this.viewZ = pre.getViewZNode()

    // GTAO's radius is in scene units: 8 mm, about three pitches.
    const occlusion = ao(depth, normal, camera)
    occlusion.resolutionScale = 0.5
    occlusion.useTemporalFiltering = true
    occlusion.radius.value = 8

    const colour = pass(scene, camera)
    colour.contextNode = builtinAOContext(occlusion.getTextureNode().sample(screenUV).r)

    const resolved = traa(colour, depth, pre.getTextureNode('velocity'), camera)
    resolved.useSubpixelCorrection = false
    this.resolved = resolved

    this.sharp = finish(resolved)
    this.pipeline = new RenderPipeline(renderer, this.sharp)
    this.pipeline.outputColorTransform = false
  }

  render(): void {
    this.pipeline.render()
  }

  /** Depth of field focused `distanceMm` along the view, or none (Build Mode, SPEC 11.7). */
  setFocus(distanceMm: number | null): void {
    if (distanceMm !== null) {
      this.focus ??= (() => {
        const distance = uniform(distanceMm)
        // @types/three 0.186 leaves DepthOfFieldNode's output type out; it is a vec4 like TRAA's.
        const blurred = dof(this.resolved, this.viewZ, distance, 120, 4) as unknown as Output
        return { output: finish(blurred), distance }
      })()
      this.focus.distance.value = distanceMm
    }
    const output = distanceMm === null ? this.sharp : this.focus!.output
    if (this.pipeline.outputNode !== output) {
      this.pipeline.outputNode = output
      this.pipeline.needsUpdate = true
    }
  }
}
