// The workroom's three materials (ADR-0144), shared by every side so the room compiles three
// pipelines in all:
//  - lit: one vertex-coloured standard material; roughness and metalness come per vertex.
//  - emit: the practical lamps and screens, unlit at their vertex colour. Each is at most 1.5 in
//    linear light, under the bloom's threshold of 2, so nothing on the set blooms; their glow is
//    drawn by the cards instead.
//  - glow: soft additive cards around the practicals, without fog (light, not a surface), fading
//    to nothing at their edges and as they turn edge-on to the camera.
import {
  AdditiveBlending,
  DoubleSide,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial
} from 'three/webgpu'
import { attribute, float, normalView, positionView, smoothstep, uv } from 'three/tsl'

/** The brightest an emitter is drawn, linear: under the bloom's threshold (BLOOM_THRESHOLD). */
export const EMIT_MAX = 1.5

/**
 * The brightest a glow card is drawn, linear. A bulb's three crossed cards over it add to it, and
 * all four stay under the threshold.
 */
export const GLOW_MAX = 0.16

export function roomMaterials() {
  const lit = new MeshStandardNodeMaterial({ vertexColors: true })
  lit.roughnessNode = attribute('roughness', 'float')
  lit.metalnessNode = attribute('metalness', 'float')
  const emit = new MeshBasicNodeMaterial({ vertexColors: true })
  const glow = new MeshBasicNodeMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false
  })
  const edge = float(1).sub(smoothstep(0.15, 0.5, uv().sub(0.5).length()))
  const facing = smoothstep(0.1, 0.6, normalView.dot(positionView.normalize()).abs())
  glow.opacityNode = edge.mul(edge).mul(facing)
  return { lit, emit, glow }
}
