// Part leads (SPEC 10.4): generated at runtime from where each leaves the body (its model's
// `pin-<id>` empty) into its hole, bent the same way every time, at the lead's real diameter. A
// lead is a polyline of corners; its tube bends round each corner.
import { CurvePath, LineCurve3, QuadraticBezierCurve3, TubeGeometry, Vector3 } from 'three/webgpu'
import type { PartDef } from '../core/model/types'

/** How far a lead goes into its hole, below the board's top (the hole's funnel and shaft). */
export const LEAD_DEPTH_MM = 2
/** Sides of a lead's tube; its last ring of RADIAL + 1 vertices is the lead's end. */
export const RADIAL = 8
/** Parameters that give a lead's thickness, by family: round, square or flat (its width). */
const DIAMETER_KEYS = [
  'leadDiameterMm',
  'leadDiaMm',
  'leadDiaMaxMm',
  'leadSquareMm',
  'leadWidthMm',
  'leadWidthMaxMm',
  'pinWidthMm',
  'terminalWidthMm'
]

/** A lead's diameter from its definition's params, read for the part's variant (the LED's size). */
export function leadDiameterMm(def: PartDef, props: Record<string, unknown>): number {
  const params: Record<string, unknown> = 'params' in def.geometry ? def.geometry.params : {}
  const prefixes = ['', ...Object.values(props).map((v) => `${String(v)}.`)]
  for (const key of DIAMETER_KEYS)
    for (const prefix of prefixes) {
      const value = params[prefix + key]
      if (typeof value === 'number') return value
    }
  return 0.5
}

/**
 * The corners of a lead from `exit`, leaving along `dir`, to `depth` down its hole at `hole` (the
 * hole's centre on the board's top). Down out of a body: straight in, or a knee halfway down and a
 * jog to the hole. Up out of a body (an axial part standing on end): over the top and down.
 * Sideways (an axial part lying down): out along the body's axis, then down.
 */
export function leadPath(
  exit: Vector3,
  dir: Vector3,
  hole: Vector3,
  depth = LEAD_DEPTH_MM
): Vector3[] {
  const bottom = hole.clone().setY(hole.y - depth)
  const off = Math.hypot(hole.x - exit.x, hole.z - exit.z)
  if (dir.y < -0.7) {
    if (off < 0.1) return [exit.clone(), bottom]
    const knee = hole.y + (exit.y - hole.y) / 2
    return [exit.clone(), exit.clone().setY(knee), hole.clone().setY(knee), bottom]
  }
  if (dir.y > 0.7) {
    const top = exit.y + Math.max(1.5, off / 2)
    return [exit.clone(), exit.clone().setY(top), hole.clone().setY(top), bottom]
  }
  return [exit.clone(), hole.clone().setY(exit.y), bottom]
}

/** A round lead through the corners of `points`, each bent at up to `bendMm`. */
export function bentLeadGeometry(points: Vector3[], radius: number, bendMm: number): TubeGeometry {
  const path = new CurvePath<Vector3>()
  let from = points[0]!.clone()
  for (let i = 1; i < points.length - 1; i++) {
    const [a, c, b] = [points[i - 1]!, points[i]!, points[i + 1]!]
    const trim = Math.min(bendMm, a.distanceTo(c) / 2, c.distanceTo(b) / 2)
    const enter = c.clone().addScaledVector(a.clone().sub(c).normalize(), trim)
    const leave = c.clone().addScaledVector(b.clone().sub(c).normalize(), trim)
    if (from.distanceTo(enter) > 1e-4) path.add(new LineCurve3(from, enter))
    path.add(new QuadraticBezierCurve3(enter, c.clone(), leave))
    from = leave
  }
  path.add(new LineCurve3(from, points.at(-1)!.clone()))
  const segments = Math.max(4, Math.ceil(path.getLength() / 0.3))
  return new TubeGeometry(path, segments, radius, RADIAL, false)
}
