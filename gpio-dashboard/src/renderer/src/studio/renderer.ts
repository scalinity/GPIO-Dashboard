// The renderer and its post-processing (SPEC 10.1, 10.2): WebGPURenderer, never the legacy
// WebGLRenderer, and three's node RenderPipeline with GTAO, bloom and TRAA. Depth of field is
// built when something first asks for focus (Build Mode). No grain, aberration or lens dirt.
import {
  type Camera,
  type Node,
  RenderPipeline,
  type Scene,
  UnsignedByteType,
  WebGPURenderer
} from 'three/webgpu'
import {
  builtinAOContext,
  mrt,
  normalView,
  packNormalToRGB,
  pass,
  sample,
  screenUV,
  uniform,
  unpackRGBToNormal,
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
  await renderer.init()
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'WebGPU'
    : 'WebGL2 (fallback)'
  console.info(`[studio] renderer backend: ${backend}`)
  setStatus({ backend })
  return renderer
}

type Output = Node<'vec4'>

// Bloom takes only what is brighter than white after lighting: lit LEDs, not the white boards.
const withBloom = (input: Output): Output => input.add(bloom(input, 0.35, 0.4, 1))

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

    this.sharp = withBloom(resolved)
    this.pipeline = new RenderPipeline(renderer, this.sharp)
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
        return { output: withBloom(blurred), distance }
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
