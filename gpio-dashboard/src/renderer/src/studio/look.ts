// The Studio's look as data (SPEC 10.1, 10.2): the stage's colours and lights, the environment, the
// tone mapping and grade, and the bloom. `StageRig.apply` and `Post` read it; nothing else holds
// these numbers. The Studio look is ADR-0067's, calibrated to the reference photos.

export type LookName = 'studio'

export interface Look {
  name: LookName
  /** The clear colour behind the set. */
  background: string
  /** One exponential-squared fog; density per mm, 0 for none. */
  fog: { color: string; density: number }
  /** The image-based light: the CC0 studio HDRI. */
  environment: { kind: 'hdri'; intensity: number }
  key: { color: string; intensity: number }
  hemisphere: { sky: string; ground: string; intensity: number }
  /** A light from behind the bench, to part silhouettes from what is behind them. */
  rim: { color: string; intensity: number }
  /** The tone mapping, its exposure and the grade after it (ADR-0067). */
  tone: { mapping: 'agx'; exposure: number; stretch: number }
  /** Bloom's strength and radius; its threshold is `BLOOM_THRESHOLD` in every look. */
  bloom: { strength: number; radius: number }
  /** The table top and the cyclorama sweep. */
  table: string
  sweep: string
  /** How far the camera may orbit from its target, mm. */
  maxDistance: number
}

export const STUDIO: Look = {
  name: 'studio',
  background: '#24272c',
  fog: { color: '#000000', density: 0 },
  environment: { kind: 'hdri', intensity: 0.6 },
  key: { color: '#ffffff', intensity: 2.2 },
  hemisphere: { sky: '#ffffff', ground: '#ffffff', intensity: 0 },
  rim: { color: '#ffffff', intensity: 0 },
  tone: { mapping: 'agx', exposure: 1.7, stretch: 1.2 },
  bloom: { strength: 0.35, radius: 0.4 },
  table: '#505153',
  sweep: '#6a6b6d',
  maxDistance: 3000
}
