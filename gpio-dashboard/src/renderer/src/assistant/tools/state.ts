// The circuit as the assistant reads it: compact text for the model, built from the same pure
// functions the app's own panels use (netlist, ERC, code pins, connectivity diff).
import { codePins } from '../../core/code/pins'
import { boardDef } from '../../core/defs/boards'
import { erc } from '../../core/erc/erc'
import { holeKey } from '../../core/geometry/breadboard'
import { tboardPinHole } from '../../core/geometry/tboard'
import type { CircuitDoc, Endpoint, HoleRef } from '../../core/model/types'
import { computeState, diffStates } from '../../core/netlist/engine'
import {
  docPartDefs,
  netlist,
  occupantKey,
  type Netlist,
  type PartDefs
} from '../../core/netlist/netlist'
import { free, stripHoles } from '../../core/placer/placer'
import { headerNetName } from '../../core/defs/controllers'
import { RAIL_IDS } from '../../core/model/types'

export const endpointText = (e: Endpoint): string =>
  'hole' in e ? holeKey(e.hole) : `${e.pin.part}.${e.pin.pin}`

/** Runs of rows whose ten main holes are all free, as [first, last]. */
function freeRowRuns(doc: CircuitDoc, board: string, rows: number): [number, number][] {
  const f = free(doc)
  const runs: [number, number][] = []
  for (let row = 1; row <= rows; row++) {
    const clear = stripHoles(doc, { board, area: 'main', row, col: 'a' })
      .concat(stripHoles(doc, { board, area: 'main', row, col: 'f' }))
      .every((h) => f.has(h))
    if (!clear) continue
    const last = runs.at(-1)
    if (last && last[1] === row - 1) last[1] = row
    else runs.push([row, row])
  }
  return runs
}

function railsFree(doc: CircuitDoc, board: string): Record<string, number> {
  const f = free(doc)
  return Object.fromEntries(
    RAIL_IDS.map((rail) => [
      rail,
      stripHoles(doc, { board, area: 'rail', rail, index: 0 }).filter((h) => f.has(h)).length
    ])
  )
}

function netRows(doc: CircuitDoc, nl: Netlist) {
  const tb = doc.controller.tboard
  return nl.nets.map((net) => ({
    net: net.name,
    ...(net.names.length > 1 ? { joined: net.names } : {}),
    tboardHoles: net.headerPins.map((pin) => holeKey(tboardPinHole(tb, pin))),
    partPins: net.members.flatMap((m) => (m.kind === 'part' ? [`${m.part}.${m.pin}`] : [])),
    wireEnds: net.members.flatMap((m) => (m.kind === 'wire' ? [`${m.wire}.${m.end}`] : []))
  }))
}

function partRows(doc: CircuitDoc, defs: PartDefs, nl: Netlist, full: boolean) {
  const resolve = docPartDefs(doc, defs)
  return doc.parts.map((part) => {
    const def = resolve(part.defId)
    return {
      ref: part.id,
      def: part.defId,
      ...(full ? { props: part.props } : {}),
      ...(part.placement.rotationDeg ? { rotationDeg: part.placement.rotationDeg } : {}),
      ...(part.placement.offboardPose ? { pose: part.placement.offboardPose } : {}),
      pins: Object.fromEntries(
        def.pins.map((pin) => {
          const hole = part.placement.pins[pin.id]
          const net = nl.netOfPin.get(`${part.id}.${pin.id}`)
          return [pin.id, `${hole ? holeKey(hole) : 'off-board'} ${net ?? ''}`.trim()]
        })
      )
    }
  })
}

export interface StateOptions {
  detail: 'summary' | 'full'
}

/** The whole circuit: boards and free regions, T-board, parts, wires, nets, ERC and code pins. */
export function circuitState(doc: CircuitDoc, defs: PartDefs, { detail }: StateOptions): string {
  const full = detail === 'full'
  const nl = netlist(doc, defs)
  const issues = erc(doc, defs, nl)
  const tb = doc.controller.tboard
  const code = codePins(doc.code.source)
  const count = (s: string) => issues.filter((i) => i.severity === s).length
  const headline = `Revision ${doc.meta.revision}: ${doc.boards.length} board(s), ${doc.parts.length} part(s), ${doc.wires.length} wire(s). ERC: ${count('error')} error(s), ${count('warning')} warning(s).`
  const body = {
    revision: doc.meta.revision,
    boards: doc.boards.map((b) => ({
      id: b.id,
      def: b.defId,
      rows: boardDef(b.defId).rows,
      freeRows: freeRowRuns(doc, b.id, boardDef(b.defId).rows),
      freeRailHoles: railsFree(doc, b.id)
    })),
    tboard: {
      ...tb,
      ...(full
        ? {
            pins: Object.fromEntries(
              Array.from({ length: 40 }, (_, i) => i + 1).map((pin) => [
                pin,
                `${holeKey(tboardPinHole(tb, pin))} ${headerNetName(pin)}`
              ])
            )
          }
        : {})
    },
    parts: partRows(doc, defs, nl, full),
    wires: doc.wires.map((w) => ({
      id: w.id,
      kind: w.kind,
      lengthMm: w.lengthMm,
      color: w.color,
      a: endpointText(w.a),
      b: endpointText(w.b),
      ...(full && w.heightMm !== undefined ? { heightMm: w.heightMm } : {})
    })),
    nets: netRows(doc, nl).filter((n) => full || n.partPins.length + n.wireEnds.length > 0),
    erc: issues.map((i) => ({
      code: i.code,
      severity: i.severity,
      refs: i.refs,
      message: i.message,
      fix: i.fix
    })),
    code: {
      library: doc.code.library,
      lines: doc.code.source ? doc.code.source.split('\n').length : 0,
      uses: code.uses.map((u) => ({
        gpio: u.bcm,
        mode: u.mode,
        ...(u.pull ? { pull: u.pull } : {})
      })),
      unresolved: code.unresolved,
      ...(full ? { source: doc.code.source } : {})
    }
  }
  return `${headline}\n${JSON.stringify(body)}`
}

/** What changed from `before` to `after`, as the connectivity engine reports it. */
export function changesSince(before: CircuitDoc, after: CircuitDoc, defs: PartDefs): string {
  const events = diffStates(computeState(before, defs), computeState(after, defs))
  const rows = events.map((e) => {
    switch (e.type) {
      case 'HoleOccupied':
      case 'HoleVacated':
        return `${e.type} ${holeKey(e.hole as HoleRef)} ${occupantKey(e.occupant)}`
      case 'StripJoined':
        return `StripJoined ${e.strip} ${e.net ?? '(no net)'}`
      case 'NetsMerged':
        return `NetsMerged ${e.from.join('+')} -> ${e.into}`
      case 'NetSplit':
        return `NetSplit ${e.from} -> ${e.into.join(', ')}`
      case 'PartPlaced':
        return `PartPlaced ${e.part}`
      case 'LeadRouted':
        return `LeadRouted ${e.wire}`
    }
  })
  return `Changes from revision ${before.meta.revision} to ${after.meta.revision}: ${rows.length} event(s).\n${JSON.stringify(rows)}`
}
