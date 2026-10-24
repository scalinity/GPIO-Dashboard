// Applies edits to a circuit document and computes their inverses (SPEC 5). Pure: inputs are
// never modified, and every op has an exact inverse, so undo restores an identical document.
import type { CircuitDoc, Op, Wire } from '../model/types'

/** An op that cannot apply to this document (unknown or duplicate id). */
export class OpError extends Error {}

type WithId = { id: string }

function indexOf<T extends WithId>(list: readonly T[], id: string, what: string): number {
  const i = list.findIndex((x) => x.id === id)
  if (i === -1) throw new OpError(`No ${what} ${id}`)
  return i
}

function insert<T extends WithId>(
  list: readonly T[],
  item: T,
  index: number | undefined,
  what: string
): T[] {
  if (list.some((x) => x.id === item.id)) throw new OpError(`A ${what} ${item.id} already exists`)
  const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length))
  return [...list.slice(0, at), structuredClone(item), ...list.slice(at)]
}

function replaceAt<T>(list: readonly T[], i: number, item: T): T[] {
  return list.map((x, j) => (j === i ? item : x))
}

/** Sets each given key on a copy; a key given as undefined is removed. */
function patch<T extends object>(target: T, fields: Partial<T>): T {
  const next = { ...target } as Record<string, unknown>
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete next[key]
    else next[key] = structuredClone(value)
  }
  return next as T
}

/** The current values of `keys` on `target`, undefined where absent: a patch that undoes one. */
function snapshot<T extends object>(target: T, keys: string[]): Partial<T> {
  const old: Record<string, unknown> = {}
  for (const key of keys) old[key] = structuredClone((target as Record<string, unknown>)[key])
  return old as Partial<T>
}

export function applyOp(doc: CircuitDoc, op: Op): { doc: CircuitDoc; inverse: Op } {
  switch (op.type) {
    case 'AddBoard':
      return {
        doc: { ...doc, boards: insert(doc.boards, op.board, op.index, 'board') },
        inverse: { type: 'RemoveBoard', id: op.board.id }
      }
    case 'RemoveBoard': {
      const i = indexOf(doc.boards, op.id, 'board')
      return {
        doc: { ...doc, boards: doc.boards.filter((_, j) => j !== i) },
        inverse: { type: 'AddBoard', board: doc.boards[i]!, index: i }
      }
    }
    case 'MoveBoard': {
      const i = indexOf(doc.boards, op.id, 'board')
      const board = doc.boards[i]!
      return {
        doc: {
          ...doc,
          boards: replaceAt(doc.boards, i, { ...board, transform: structuredClone(op.transform) })
        },
        inverse: { type: 'MoveBoard', id: op.id, transform: board.transform }
      }
    }
    case 'SetControllerPlacement':
      return {
        doc: { ...doc, controller: structuredClone(op.controller) },
        inverse: { type: 'SetControllerPlacement', controller: doc.controller }
      }
    case 'AddPart':
      return {
        doc: { ...doc, parts: insert(doc.parts, op.part, op.index, 'part') },
        inverse: { type: 'RemovePart', id: op.part.id }
      }
    case 'RemovePart': {
      const i = indexOf(doc.parts, op.id, 'part')
      return {
        doc: { ...doc, parts: doc.parts.filter((_, j) => j !== i) },
        inverse: { type: 'AddPart', part: doc.parts[i]!, index: i }
      }
    }
    case 'MovePart': {
      const i = indexOf(doc.parts, op.id, 'part')
      const part = doc.parts[i]!
      return {
        doc: {
          ...doc,
          parts: replaceAt(doc.parts, i, { ...part, placement: structuredClone(op.placement) })
        },
        inverse: { type: 'MovePart', id: op.id, placement: part.placement }
      }
    }
    case 'SetPartProps': {
      const i = indexOf(doc.parts, op.id, 'part')
      const part = doc.parts[i]!
      return {
        doc: {
          ...doc,
          parts: replaceAt(doc.parts, i, { ...part, props: structuredClone(op.props) })
        },
        inverse: { type: 'SetPartProps', id: op.id, props: part.props }
      }
    }
    case 'AddWire':
      return {
        doc: { ...doc, wires: insert(doc.wires, op.wire, op.index, 'wire') },
        inverse: { type: 'RemoveWire', id: op.wire.id }
      }
    case 'RemoveWire': {
      const i = indexOf(doc.wires, op.id, 'wire')
      return {
        doc: { ...doc, wires: doc.wires.filter((_, j) => j !== i) },
        inverse: { type: 'AddWire', wire: doc.wires[i]!, index: i }
      }
    }
    case 'MoveWireEnd': {
      const i = indexOf(doc.wires, op.id, 'wire')
      const wire = doc.wires[i]!
      return {
        doc: {
          ...doc,
          wires: replaceAt(doc.wires, i, { ...wire, [op.end]: structuredClone(op.to) })
        },
        inverse: { type: 'MoveWireEnd', id: op.id, end: op.end, to: wire[op.end] }
      }
    }
    case 'SetWireProps': {
      const i = indexOf(doc.wires, op.id, 'wire')
      const wire = doc.wires[i]!
      return {
        doc: { ...doc, wires: replaceAt(doc.wires, i, patch<Wire>(wire, op.props)) },
        inverse: { type: 'SetWireProps', id: op.id, props: snapshot(wire, Object.keys(op.props)) }
      }
    }
    case 'SetCode':
      return {
        doc: { ...doc, code: structuredClone(op.code) },
        inverse: { type: 'SetCode', code: doc.code }
      }
    case 'SetMeta':
      return {
        doc: { ...doc, meta: patch<CircuitDoc['meta']>(doc.meta, op.meta) },
        inverse: { type: 'SetMeta', meta: snapshot(doc.meta, Object.keys(op.meta)) }
      }
  }
}

/** Applies ops in order; the inverse undoes them all, in reverse order. */
export function applyOps(doc: CircuitDoc, ops: readonly Op[]): { doc: CircuitDoc; inverse: Op[] } {
  let current = doc
  const inverse: Op[] = []
  for (const op of ops) {
    const result = applyOp(current, op)
    current = result.doc
    inverse.unshift(result.inverse)
  }
  return { doc: current, inverse }
}
