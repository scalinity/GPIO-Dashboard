// Assistant ghosts on the bench (SPEC 10.5, 12.6): the parts and leads of tool calls still
// streaming in, drawn into the document the Studio shows but never committed. A ghost part hovers
// over its holes as a drag's preview does; a ghost lead keeps its design curve and is never sent to
// the solver, since only committed leads are simulated. When the call commits, the ghost gives way
// to the real part or lead, which seats and drops into place.
import type { Ghost } from '../assistant/context'
import { PART_DEFS } from '../core/defs/parts'
import type { CircuitDoc } from '../core/model/types'

/** The id a ghost lead is drawn under, for the tool call `call`. */
export const ghostWireId = (call: string) => `ghost:${call}`

let cache: { doc: CircuitDoc; ghosts: Record<string, Ghost>; out: CircuitDoc } | null = null

/**
 * `doc` with every ghost added: the same object when there are none, and the same result for the
 * same inputs, so redraws stay cheap.
 */
export function withGhosts(doc: CircuitDoc, ghosts: Record<string, Ghost>): CircuitDoc {
  const entries = Object.entries(ghosts)
  if (!entries.length) return doc
  if (cache?.doc === doc && cache.ghosts === ghosts) return cache.out
  const taken = new Set([...doc.parts.map((p) => p.id), ...doc.wires.map((w) => w.id)])
  const parts = [...doc.parts]
  const wires = [...doc.wires]
  for (const [call, ghost] of entries) {
    if (ghost.kind === 'part') {
      // The library's parts and the project's own; a part defined in the same streaming batch
      // is not in the document yet, so it has nothing to draw from.
      if (!PART_DEFS.has(ghost.defId) && !doc.customParts?.some((d) => d.id === ghost.defId))
        continue
      const id = taken.has(ghost.ref) ? `${ghost.ref}?${call}` : ghost.ref
      taken.add(id)
      parts.push({ id, defId: ghost.defId, props: ghost.props, placement: ghost.placement })
    } else {
      wires.push({
        id: ghostWireId(call),
        a: ghost.a,
        b: ghost.b,
        kind: ghost.wireKind,
        color: ghost.color,
        lengthMm: 'auto'
      })
    }
  }
  const out = { ...doc, parts, wires }
  cache = { doc, ghosts, out }
  return out
}

/** The ids `ghosted` draws that `doc` does not hold: the ghosts on the bench. */
export function ghostIds(doc: CircuitDoc, ghosted: CircuitDoc): string[] {
  if (doc === ghosted) return []
  const real = new Set([...doc.parts.map((p) => p.id), ...doc.wires.map((w) => w.id)])
  return [...ghosted.parts, ...ghosted.wires].map((x) => x.id).filter((id) => !real.has(id))
}
