// The single writer (SPEC 1.2, 4.5): user gestures, assistant tool calls, tutorial loading and
// undo/redo all change the document here, as validated transactions. A rejected transaction
// leaves the document exactly as it was. React reads it through useSyncExternalStore.
import { partDef } from '../core/defs/parts'
import { ConnectivityEngine } from '../core/netlist/engine'
import type { PartDefs } from '../core/netlist/netlist'
import { applyOps, OpError } from '../core/ops/apply'
import { type Problem, validateDoc } from '../core/ops/validate'
import type { Author, CircuitDoc, Op, Transaction } from '../core/model/types'

export interface TransactionInput {
  author: Author
  label: string
  ops: Op[]
  assistantTurnId?: string
}

export type DispatchResult = { ok: true; tx: Transaction } | { ok: false; problems: Problem[] }

interface HistoryEntry {
  tx: Transaction
  metaBefore: CircuitDoc['meta']
  metaAfter: CircuitDoc['meta']
}

export class CircuitStore {
  private doc: CircuitDoc
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private listeners = new Set<() => void>()
  private txCounter = 0
  /** Counts every change (commits, undos, redos, opens); never goes backwards. */
  private changes = 0
  readonly engine: ConnectivityEngine

  constructor(
    doc: CircuitDoc,
    private readonly defs: PartDefs = partDef,
    private readonly clock: () => string = () => new Date().toISOString()
  ) {
    const problems = validateDoc(doc, defs)
    if (problems.length)
      throw new Error(`Invalid document: ${problems.map((p) => p.message).join('; ')}`)
    this.doc = doc
    this.engine = new ConnectivityEngine(doc, defs)
  }

  getSnapshot = (): CircuitDoc => this.doc

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get changeCount(): number {
    return this.changes
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Checks a transaction without committing it (for legality glows and assistant previews). */
  check(
    input: TransactionInput
  ): { ok: true; doc: CircuitDoc } | { ok: false; problems: Problem[] } {
    let result: { doc: CircuitDoc; inverse: Op[] }
    try {
      result = applyOps(this.doc, input.ops)
    } catch (e) {
      if (e instanceof OpError)
        return { ok: false, problems: [{ code: 'OP', message: e.message, refs: [] }] }
      throw e
    }
    const problems = validateDoc(result.doc, this.defs)
    return problems.length ? { ok: false, problems } : { ok: true, doc: result.doc }
  }

  dispatch(input: TransactionInput): DispatchResult {
    let result: { doc: CircuitDoc; inverse: Op[] }
    try {
      result = applyOps(this.doc, input.ops)
    } catch (e) {
      if (e instanceof OpError)
        return { ok: false, problems: [{ code: 'OP', message: e.message, refs: [] }] }
      throw e
    }
    const problems = validateDoc(result.doc, this.defs)
    if (problems.length) return { ok: false, problems }

    this.txCounter += 1
    const tx: Transaction = {
      id: `tx${this.txCounter}`,
      author: input.author,
      label: input.label,
      ops: structuredClone(input.ops),
      inverse: result.inverse,
      ...(input.assistantTurnId ? { assistantTurnId: input.assistantTurnId } : {})
    }
    const metaBefore = this.doc.meta
    const metaAfter = {
      ...result.doc.meta,
      revision: metaBefore.revision + 1,
      updated: this.clock()
    }
    this.undoStack.push({ tx, metaBefore, metaAfter })
    this.redoStack = []
    this.commit({ ...result.doc, meta: metaAfter })
    return { ok: true, tx }
  }

  /** Undoes the last transaction, restoring the document exactly as it was before it. */
  undo(): Transaction | null {
    const entry = this.undoStack.pop()
    if (!entry) return null
    const { doc } = applyOps(this.doc, entry.tx.inverse)
    this.redoStack.push(entry)
    this.commit({ ...doc, meta: entry.metaBefore })
    return entry.tx
  }

  redo(): Transaction | null {
    const entry = this.redoStack.pop()
    if (!entry) return null
    const { doc } = applyOps(this.doc, entry.tx.ops)
    this.undoStack.push(entry)
    this.commit({ ...doc, meta: entry.metaAfter })
    return entry.tx
  }

  /** Undoes every transaction of one assistant turn ("Undo all", SPEC 11.8). */
  undoTurn(assistantTurnId: string): number {
    let undone = 0
    while (this.undoStack.at(-1)?.tx.assistantTurnId === assistantTurnId) {
      this.undo()
      undone += 1
    }
    return undone
  }

  /** Opens another document (a project or a tutorial). Not undoable; history starts afresh. */
  open(doc: CircuitDoc): DispatchResult | { ok: true } {
    const problems = validateDoc(doc, this.defs)
    if (problems.length) return { ok: false, problems }
    this.undoStack = []
    this.redoStack = []
    this.commit(structuredClone(doc))
    return { ok: true }
  }

  private commit(doc: CircuitDoc) {
    this.doc = doc
    this.changes += 1
    this.engine.commit(doc)
    for (const listener of this.listeners) listener()
  }
}
