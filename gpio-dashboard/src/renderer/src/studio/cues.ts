// Where the assistant's refs are on the bench (SPEC 12.5 focus, highlight): a part's pins and body,
// a lead's ends, a board's body, a hole, or a net's strips and lead ends. Focus frames the points;
// highlight marks the places.
import { Box3, type Color, Vector3 } from 'three/webgpu'
import { parseHoleKey } from '../core/geometry/breadboard'
import type { CircuitDoc } from '../core/model/types'
import type { Netlist } from '../core/netlist/netlist'
import { bodyBox } from './bodies'
import { defOf, endpointInScene } from './coords'
import type { Marker } from './markers'
import { netMarkers, stripIndex } from './nets'

const unit = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5))

/** The points to frame and the places to mark for `refs`; refs that name nothing are skipped. */
export function cuePlaces(
  doc: CircuitDoc,
  nl: Netlist,
  refs: string[],
  marker: { size: number; color: Color }
): { box: Box3; markers: Marker[] } {
  const box = new Box3()
  const markers: Marker[] = []
  const mark = (at: { at: Vector3; turn: number } | null) => {
    if (!at) return
    box.expandByPoint(at.at)
    markers.push({ at: at.at, turn: at.turn, ...marker })
  }
  let index: ReturnType<typeof stripIndex> | null = null
  for (const ref of refs) {
    const part = doc.parts.find((p) => p.id === ref)
    if (part) {
      const body = bodyBox(doc, { kind: 'part', id: ref })
      if (body) box.union(unit.clone().applyMatrix4(body))
      for (const pin of defOf(doc, part.defId).pins) {
        const hole = part.placement.pins[pin.id]
        mark(endpointInScene(doc, hole ? { hole } : { pin: { part: part.id, pin: pin.id } }))
      }
      continue
    }
    const wire = doc.wires.find((w) => w.id === ref)
    if (wire) {
      mark(endpointInScene(doc, wire.a))
      mark(endpointInScene(doc, wire.b))
      continue
    }
    if (doc.boards.some((b) => b.id === ref)) {
      const body = bodyBox(doc, { kind: 'board', id: ref })
      if (body) box.union(unit.clone().applyMatrix4(body))
      continue
    }
    const hole = parseHoleKey(ref)
    if (hole) {
      mark(endpointInScene(doc, { hole }))
      continue
    }
    const net = nl.byName.get(ref)
    if (net) {
      index ??= stripIndex(doc)
      for (const m of netMarkers(doc, index, net, marker, marker)) {
        box.expandByPoint(m.at)
        markers.push(m)
      }
    }
  }
  return { box, markers }
}
