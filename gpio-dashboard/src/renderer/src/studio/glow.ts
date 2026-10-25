// Light from simulation state (SPEC 10.6, 11.5): each LED die's brightness, as a fraction of its
// datasheet test current, becomes a linear emission on the model nodes that light with it. The
// emission scales with the bloom threshold (ADR-0067), so a die at its test current blooms and a
// faint one only glows.
import { Color } from 'three/webgpu'
import type { PartDef, PartInstance } from '../core/model/types'
import type { Snapshot } from '../core/sim/session'
import { dieEnds, dieHue } from './dies'
import { LENS } from './parts'
import { BLOOM_THRESHOLD } from './renderer'

/** Emission strength for a brightness (current over test current): perceptual, and capped. */
export const glowOf = (brightness: number): number =>
  Math.min(Math.max(brightness, 0), 2) ** 0.6 * 4 * BLOOM_THRESHOLD

/**
 * Emission with a channel this strong may pass the bloom's threshold once the light on the surface
 * is added (a surface is lit to under 1, ADR-0067); nothing weaker needs the bloom drawn.
 */
export const BLOOM_GATE = BLOOM_THRESHOLD / 2

/** Below this strength a die counts as dark. */
const DARK = 0.02

/** The nodes of a part that glow now, with their linear emission; the rest are off. */
export function emissionOf(
  part: PartInstance,
  def: PartDef,
  snapshot: Snapshot | null
): Map<string, Color> {
  const lit = new Map<string, Color>()
  if (!snapshot) return lit
  const mix = new Color(0, 0, 0)
  for (const [key, ends] of Object.entries(dieEnds(def))) {
    const die = snapshot.dies[`${part.id}.${key}`]
    const strength = die ? glowOf(die.brightness) : 0
    if (strength < DARK) continue
    const colour = new Color(LENS[dieHue(def, part.props, key)]).multiplyScalar(strength)
    for (const node of ends.nodes) lit.set(node, colour)
    mix.add(colour)
  }
  // An RGB LED's one lens shows the three dies mixed.
  if (def.sim.model === 'rgb-led' && (mix.r || mix.g || mix.b))
    lit.set('lens', mix.multiplyScalar(0.5))
  // The relay module's indicator lights while its transistor drives the coil.
  if (def.sim.model === 'relay-module' && snapshot.parts[part.id]?.coilDriven === true)
    lit.set('lens', new Color(LENS.red).multiplyScalar(glowOf(1)))
  return lit
}
