// Depth of field for the Lab look (SPEC 10.2, ADR-0145): a depth-aware bokeh gather, after the
// exhibit house style's stage (a single gather after Dennis Gustafsson's 2018 "Bokeh depth of
// field in a single pass"). three's dof() gathers its neighbours without weighing them by depth, so
// a sharp edge smears into the blurred background behind it, worst on the white breadboard against
// a dark room. Here a sample counts only if its own blur reaches the pixel, and a sample behind the
// pixel may not out-blur it by more than twice: the bench stays crisp against a room melting into
// bokeh, and a blurred foreground still spreads over what is behind it. The gather runs at half
// resolution and a full-resolution composite keeps in-focus pixels sharp. The far blur grows
// faster than the near.
import { HalfFloatType, type Node, type TextureNode, type UniformNode, Vector2 } from 'three/webgpu'
import {
  clamp,
  cos,
  float,
  Fn,
  If,
  Loop,
  max,
  min,
  mix,
  perspectiveDepthToViewZ,
  rtt,
  screenUV,
  select,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  vec4
} from 'three/tsl'

/** Taps per pixel in the gather. */
export const BOKEH_SAMPLES = 32
const GOLDEN_ANGLE = 2.39996323
/** Tap radius, in device pixels, beyond which the gather reads the prefiltered copy. */
const PREFILTER_FROM = 4
/** How fast blur grows behind the focus and in front of it (the house style's apertures). */
const FAR = 1.6
const NEAR = 0.9

type Float = UniformNode<'float', number>

/** What the blur depends on, set every frame. */
export interface BokehUniforms {
  /** The distance from the camera that is sharp, mm. */
  focus: Float
  /** The distance over which blur ramps from none to full, mm. */
  band: Float
  /** The largest blur radius, in device pixels. */
  maxBlur: Float
  /** One over the drawing buffer's size, in pixels. */
  texel: UniformNode<'vec2', Vector2>
  /** The scene camera's clip planes: inside a full-screen pass, cameraNear and cameraFar are the quad's. */
  near: Float
  far: Float
}

export function bokehUniforms(): BokehUniforms {
  return {
    focus: uniform(1000),
    band: uniform(1000),
    maxBlur: uniform(0),
    texel: uniform(new Vector2(1, 1)),
    near: uniform(1),
    far: uniform(1000)
  }
}

/**
 * The blurred image of `colour` (with `depth`, the scene pass's), and the two passes it draws, so
 * a look that does not show it can leave them out of its frames.
 */
export function bokeh(
  colour: TextureNode,
  depth: TextureNode,
  u: BokehUniforms
): { output: Node<'vec4'>; passes: Node[] } {
  const distance = (uv: Node<'vec2'>) =>
    perspectiveDepthToViewZ(depth.sample(uv), u.near, u.far).negate()
  const blurOf = (d: Node<'float'>) => {
    const signed = d.sub(u.focus)
    const k = select(signed.greaterThan(0), float(FAR), float(NEAR))
    return clamp(signed.abs().mul(k).div(u.band), 0, 1).mul(u.maxBlur)
  }

  // Outer taps sit several pixels apart, so point samples would skip across a thin bright strip
  // and break a defocused one into beads. Taps past PREFILTER_FROM pixels read a 4 x 4 box-filtered
  // copy: four bilinear taps, each on the corner of a 2 x 2 block. Each corner counts by its own
  // blur, so a sharp pixel (the breadboard's white edge) adds next to nothing to the copy a blurred
  // tap behind it reads, and does not halo into the background.
  const prefiltered = rtt(
    Fn(() => {
      const sum = vec3(0).toVar()
      const weight = float(0).toVar()
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1]
      ] as const) {
        const at = screenUV.add(vec2(dx, dy).mul(u.texel))
        const w = blurOf(distance(at)).div(max(u.maxBlur, 1)).add(0.02)
        sum.addAssign(colour.sample(at).rgb.mul(w))
        weight.addAssign(w)
      }
      return vec4(sum.div(weight), 1)
    })(),
    null,
    null,
    { resolutionScale: 0.25, type: HalfFloatType }
  )

  const gather = Fn(() => {
    const centre = screenUV
    const dC = distance(centre)
    const sC = blurOf(dC)
    const sum = colour.sample(centre).rgb.toVar()
    const total = float(1).toVar()
    const nearCover = float(0).toVar()
    const tap = vec3(0).toVar()
    Loop(BOKEH_SAMPLES, ({ i }) => {
      const fi = float(i)
      const r = u.maxBlur.mul(fi.add(0.5).div(BOKEH_SAMPLES).pow(0.75))
      const a = fi.mul(GOLDEN_ANGLE)
      const at = centre.add(vec2(cos(a), sin(a)).mul(r).mul(u.texel))
      const dS = distance(at)
      const sS = blurOf(dS).toVar()
      If(dS.greaterThan(dC), () => {
        sS.assign(min(sS, sC.mul(2)))
      })
      // r depends only on the loop index, so every pixel takes the same branch.
      If(r.lessThan(PREFILTER_FROM), () => {
        tap.assign(colour.sample(at).level(float(0)).rgb)
      }).Else(() => {
        tap.assign(prefiltered.sample(at).level(float(0)).rgb)
      })
      const m = smoothstep(r.sub(0.75), r.add(0.75), sS)
      sum.addAssign(mix(sum.div(total), tap, m))
      total.addAssign(1)
      nearCover.addAssign(m.mul(step(dS, dC.mul(0.97))))
    })
    return vec4(sum.div(total), nearCover.div(BOKEH_SAMPLES))
  })

  const blurred = rtt(gather(), null, null, { resolutionScale: 0.5, type: HalfFloatType })
  // Named for the frame-rate measurement's per-pass times.
  prefiltered.renderTarget!.texture.name = 'Bokeh.prefilter'
  blurred.renderTarget!.texture.name = 'Bokeh.gather'

  const output = Fn(() => {
    const sharp = colour.sample(screenUV)
    const soft = blurred.sample(screenUV)
    const t = max(smoothstep(1, 4, blurOf(distance(screenUV))), smoothstep(0.03, 0.25, soft.a))
    return vec4(mix(sharp.rgb, soft.rgb, t), sharp.a)
  })()
  return { output, passes: [prefiltered, blurred] }
}
