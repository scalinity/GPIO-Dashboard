// Hole picking and hover (SPEC 10.7, 11.3): a ray meets each board's top plane, and the nearest
// hole within tolerance is the hit. Hovering a hole shows its whole strip (or rail) and every wire
// end on its net, from the same geometry and netlist the rest of the app uses.
import { Plane, type Ray, Vector3 } from 'three/webgpu'
import { boardDef } from '../core/defs/boards'
import { boardHoles, nearestHole, railHoleRow, stripKey } from '../core/geometry/breadboard'
import type { CircuitDoc, HoleRef } from '../core/model/types'
import type { Netlist } from '../core/netlist/netlist'
import { defOf, modulePinInScene } from './coords'

const plane = new Plane(new Vector3(0, 1, 0), 0)
const hit = new Vector3()
/** Half the 2.54 mm pitch: a ray this close to a module pin picks it. */
const PIN_REACH_MM = 1.27

/** The hole under a ray, on any board, or null. */
export function pickHole(doc: CircuitDoc, ray: Ray): HoleRef | null {
  for (const board of doc.boards) {
    const def = boardDef(board.defId)
    plane.constant = -def.body.heightMm
    if (!ray.intersectPlane(plane, hit)) continue
    // Into the board's frame: undo its translation, then its rotation about the vertical.
    const dx = hit.x - board.transform.position[0]
    const dy = -hit.z - board.transform.position[1]
    const r = (-board.transform.rotationDeg * Math.PI) / 180
    const local = [
      dx * Math.cos(r) - dy * Math.sin(r),
      dx * Math.sin(r) + dy * Math.cos(r)
    ] as const
    const hole = nearestHole(def, board.id, local)
    if (hole) return hole
  }
  return null
}

export interface WireEnd {
  wire: string
  end: 'a' | 'b'
}

export interface HoverInfo {
  hole: HoleRef
  /** Every hole of the hovered hole's strip, or of its whole rail. */
  strip: HoleRef[]
  /** Every wire end on the strip's net, wherever it is. */
  wireEnds: WireEnd[]
  net: string | null
  text: string
}

export function hoverInfo(doc: CircuitDoc, nets: Netlist, hole: HoleRef): HoverInfo {
  const board = doc.boards.find((b) => b.id === hole.board)
  if (!board) throw new Error(`Hole on unknown board ${hole.board}`)
  const def = boardDef(board.defId)
  // The netlist joins rails whole (stripKey without splitting), so the highlight does too.
  const key = stripKey(def, hole)
  const strip = boardHoles(def, board.id).filter((h) => stripKey(def, h) === key)
  const net = nets.netOfStrip.get(key) ?? null
  const members = net ? nets.byName.get(net)!.members : []
  const wireEnds = members.flatMap((m) => (m.kind === 'wire' ? [{ wire: m.wire, end: m.end }] : []))

  const where =
    hole.area === 'main'
      ? `Row ${hole.row} · column ${hole.col}`
      : `${hole.rail.startsWith('top') ? 'Top' : 'Bottom'} ${hole.rail.endsWith('+') ? '+' : '−'} rail · row ${Math.round(railHoleRow(def, hole.index) * 10) / 10}`
  const prefix = doc.boards.length > 1 ? `${board.id} · ` : ''
  return { hole, strip, wireEnds, net, text: `${prefix}${where} · ${net ? `net ${net}` : 'empty'}` }
}

/** The off-board module connector pin nearest along the ray that it passes within reach of. */
export function pickModulePin(doc: CircuitDoc, ray: Ray): { part: string; pin: string } | null {
  let best: { part: string; pin: string; distance: number } | null = null
  for (const part of doc.parts) {
    if (!part.placement.offboardPose) continue
    for (const pin of defOf(doc, part.defId).pins) {
      const at = modulePinInScene(doc, part, pin.id)
      if (!at || ray.distanceSqToPoint(at) > PIN_REACH_MM ** 2) continue
      const distance = ray.origin.distanceTo(at)
      if (!best || distance < best.distance) best = { part: part.id, pin: pin.id, distance }
    }
  }
  return best && { part: best.part, pin: best.pin }
}
