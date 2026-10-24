// Leads as plain tubes (SPEC 11.3) until the physics lane simulates them: each follows a design
// curve, straight up out of both housings and arched between them. The tube is built from any
// polyline, so simulated points can replace the design curve later.
import dupontJson from '../content/leads/dupont.json'
import {
  CatmullRomCurve3,
  Color,
  type Group,
  Mesh,
  MeshStandardNodeMaterial,
  type Ray,
  TubeGeometry,
  Vector3
} from 'three/webgpu'
import type { CircuitDoc, Wire } from '../core/model/types'
import { endpointInScene } from './coords'

const RADIUS_MM = dupontJson.wire.outerDiameterMm / 2
/** Picking treats a lead as a capsule this much fatter than the wire. */
const PICK_RADIUS_MM = 1.5

/** The design curve between two ends: up the housing length, then an arch rising with the gap. */
export function designCurve(a: Vector3, b: Vector3): Vector3[] {
  const rise = dupontJson.housing.lengthMm
  const top = (p: Vector3) => p.clone().setY(p.y + rise)
  const [a1, b1] = [top(a), top(b)]
  const height = Math.min(40, 0.25 * a1.distanceTo(b1))
  const arch = [0.25, 0.5, 0.75].map((t) =>
    a1
      .clone()
      .lerp(b1, t)
      .setY(a1.y + (b1.y - a1.y) * t + height * 4 * t * (1 - t))
  )
  return [a, a1, ...arch, b1, b]
}

/** A round tube through a polyline. */
export function leadGeometry(points: Vector3[], radius = RADIUS_MM): TubeGeometry {
  return new TubeGeometry(new CatmullRomCurve3(points), points.length * 8, radius, 8)
}

const materials = new Map<string, MeshStandardNodeMaterial>()

function material(color: string): MeshStandardNodeMaterial {
  let m = materials.get(color)
  if (!m) {
    m = new MeshStandardNodeMaterial({ color: new Color(color), roughness: 0.55 })
    materials.set(color, m)
  }
  return m
}

interface Drawn {
  key: string
  mesh: Mesh
  points: Vector3[]
}

export class WireLayer {
  private drawn = new Map<string, Drawn>()

  constructor(private readonly group: Group) {}

  /** Draws the document's leads, rebuilding only those whose ends or colour changed. */
  update(doc: CircuitDoc): void {
    const seen = new Set<string>()
    for (const wire of doc.wires) {
      seen.add(wire.id)
      const ends = [endpointInScene(doc, wire.a), endpointInScene(doc, wire.b)]
      if (!ends[0] || !ends[1]) continue
      const key = JSON.stringify([ends[0].at, ends[1].at, wire.color])
      if (this.drawn.get(wire.id)?.key === key) continue
      this.remove(wire.id)
      const points = designCurve(ends[0].at, ends[1].at)
      const mesh = new Mesh(leadGeometry(points), material(wire.color))
      mesh.castShadow = true
      this.group.add(mesh)
      this.drawn.set(wire.id, { key, mesh, points })
    }
    for (const id of [...this.drawn.keys()]) if (!seen.has(id)) this.remove(id)
  }

  /** The polyline a lead is drawn along. */
  points(id: Wire['id']): Vector3[] | null {
    return this.drawn.get(id)?.points ?? null
  }

  /** The lead nearest along the ray whose capsule it passes through, with that distance. */
  pick(ray: Ray): { id: string; distance: number } | null {
    let best: { id: string; distance: number } | null = null
    const onRay = new Vector3()
    const onSegment = new Vector3()
    for (const [id, { mesh }] of this.drawn) {
      const curve = (mesh.geometry as TubeGeometry).parameters.path
      const samples = curve.getSpacedPoints(48)
      for (let i = 1; i < samples.length; i++) {
        const d2 = ray.distanceSqToSegment(samples[i - 1]!, samples[i]!, onRay, onSegment)
        const distance = onRay.distanceTo(ray.origin)
        if (d2 <= PICK_RADIUS_MM ** 2 && (!best || distance < best.distance))
          best = { id, distance }
      }
    }
    return best
  }

  private remove(id: string): void {
    const drawn = this.drawn.get(id)
    if (!drawn) return
    this.group.remove(drawn.mesh)
    drawn.mesh.geometry.dispose()
    this.drawn.delete(id)
  }
}
