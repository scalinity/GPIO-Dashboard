// The Studio's two looks as data (SPEC 10.1, 10.2; ADR-0143): the stage's colours and lights, the
// environment, the tone mapping and grade, the bloom, the grain and the vignette. `StageRig.apply`,
// `Post` and the view read them; nothing else holds these numbers. A switch between looks changes
// values only, so no material recompiles.
//  - Lab, the default: the bench in an electronics workroom at dusk, after the exhibit house
//    style (a warm key, cool fog and ambient, ACES, faint grain, a vignette).
//  - Studio: the neutral studio of ADR-0067, calibrated to the reference photos; LOOKDEV's photo
//    checks are made in it.

export type LookName = 'lab' | 'studio'

export interface Look {
  name: LookName
  /** The clear colour behind the set. */
  background: string
  /** One exponential-squared fog; density per mm, 0 for none. */
  fog: { color: string; density: number }
  /** The image-based light: the CC0 studio HDRI, or a dusk scene drawn for the Lab (lab/dusk.ts). */
  environment: { kind: 'hdri' | 'dusk'; intensity: number }
  key: { color: string; intensity: number }
  hemisphere: { sky: string; ground: string; intensity: number }
  /** A light from behind the bench, to part silhouettes from what is behind them. */
  rim: { color: string; intensity: number }
  /**
   * The tone mapping and its exposure, and the grade: AgX then ADR-0067's chroma stretch, or a
   * saturation lift then ACES Filmic.
   */
  tone:
    | { mapping: 'agx'; exposure: number; stretch: number }
    | { mapping: 'aces'; exposure: number; saturation: number }
  /** Film grain's intensity after tone mapping; 0 for none. */
  grain: number
  /** Bloom's strength and radius; its threshold is `BLOOM_THRESHOLD` in every look. */
  bloom: { strength: number; radius: number }
  /** The HTML vignette's opacity over the stage. */
  vignette: number
  /** Whether the workroom stands around the bench (lab/room.ts). */
  room: boolean
  /** The table top, and the cyclorama sweep (null hides it). */
  table: string
  /** An ESD mat on the table and its printed grid, or null for none. */
  mat: { color: string; grid: string } | null
  sweep: string | null
  /** How far the camera may orbit from its target, mm. */
  maxDistance: number
}

export const STUDIO = {
  name: 'studio',
  background: '#24272c',
  fog: { color: '#000000', density: 0 },
  environment: { kind: 'hdri', intensity: 0.6 },
  key: { color: '#ffffff', intensity: 2.2 },
  hemisphere: { sky: '#ffffff', ground: '#ffffff', intensity: 0 },
  rim: { color: '#ffffff', intensity: 0 },
  tone: { mapping: 'agx', exposure: 1.7, stretch: 1.2 },
  grain: 0,
  bloom: { strength: 0.35, radius: 0.4 },
  vignette: 0,
  room: false,
  table: '#505153',
  mat: null,
  sweep: '#6a6b6d',
  maxDistance: 3000
} satisfies Look

export const LAB = {
  name: 'lab',
  background: '#0b0f1a',
  // A lavender haze: the room's far walls sit a third of the way into it and read as depth.
  fog: { color: '#3a3d62', density: 0.6e-4 },
  environment: { kind: 'dusk', intensity: 0.85 },
  key: { color: '#ffc98f', intensity: 1 },
  hemisphere: { sky: '#8fa6d8', ground: '#3a3026', intensity: 0.6 },
  rim: { color: '#a8b8ff', intensity: 1.6 },
  tone: { mapping: 'aces', exposure: 1.5, saturation: 1.35 },
  grain: 0.06,
  bloom: { strength: 1.6, radius: 0.85 },
  vignette: 1,
  room: true,
  // A walnut bench top under a slate ESD mat: the mat's edge and grid give the bench its size.
  table: '#22170f',
  mat: { color: '#14171d', grid: '#1c222b' },
  sweep: null,
  maxDistance: 2200
} satisfies Look

export const LOOKS: Record<LookName, Look> = { lab: LAB, studio: STUDIO }
