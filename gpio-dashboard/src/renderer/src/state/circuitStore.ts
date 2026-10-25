// The single writer (SPEC 1.2, 4.5): user gestures, assistant tool calls, tutorial loading and
// undo/redo all change the document here, as validated transactions. A rejected transaction
// leaves the document exactly as it was. React reads it through useSyncExternalStore.
// An assistant turn's transactions undo and redo together, as one group (SPEC 11.8, 12.8). While a
// turn runs the store is locked to it: nothing else commits, undoes, redoes or opens a document.
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
  /** The assistant turn that owns the document while it runs; null when anyone may edit. */
  private owner: string | null = null
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

  /** Whether an assistant turn owns the document, so nothing else may change it. */
  get locked(): boolean {
    return this.owner !== null
  }

  /** The assistant turn whose transactions are the latest undoable change, if it is one. */
  get lastTurnId(): string | undefined {
    return this.undoStack.at(-1)?.tx.assistantTurnId
  }

  /** Until unlock(), only transactions of this assistant turn commit. */
  lock(assistantTurnId: string): void {
    this.owner = assistantTurnId
  }

  unlock(): void {
    this.owner = null
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
    if (this.owner !== null && input.assistantTurnId !== this.owner) return refused()
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

  /**
   * Undoes the last change, restoring the document exactly as it was before it: one transaction,
   * or every transaction of the latest assistant turn together. Returns the earliest one undone.
   */
  undo(): Transaction | null {
    if (this.owner !== null) return null
    const group = takeGroup(this.undoStack)
    if (!group.length) return null
    let doc = this.doc
    for (const entry of group) {
      doc = applyOps(doc, entry.tx.inverse).doc
      this.redoStack.push(entry)
    }
    this.commit({ ...doc, meta: group.at(-1)!.metaBefore })
    return group.at(-1)!.tx
  }

  /** Redoes the last undone change, an assistant turn as a whole. Returns the latest one redone. */
  redo(): Transaction | null {
    if (this.owner !== null) return null
    const group = takeGroup(this.redoStack)
    if (!group.length) return null
    let doc = this.doc
    for (const entry of group) {
      doc = applyOps(doc, entry.tx.ops).doc
      this.undoStack.push(entry)
    }
    this.commit({ ...doc, meta: group.at(-1)!.metaAfter })
    return group.at(-1)!.tx
  }

  /**
   * Undoes every transaction of one assistant turn ("Undo all", SPEC 11.8) when they are the
   * latest change, in one commit. Returns how many it undid: none when something came after them.
   */
  undoTurn(assistantTurnId: string): number {
    if (this.owner !== null && this.owner !== assistantTurnId) return 0
    if (this.lastTurnId !== assistantTurnId) return 0
    const owner = this.owner
    const before = this.undoStack.length
    this.owner = null
    this.undo()
    this.owner = owner
    return before - this.undoStack.length
  }

  /** Opens another document (a project or a tutorial). Not undoable; history starts afresh. */
  open(doc: CircuitDoc): DispatchResult | { ok: true } {
    if (this.owner !== null) return refused()
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

export const LOCKED_MESSAGE = 'Claude is working on the circuit. Stop it to edit by hand.'

/** What a locked store answers anyone but the assistant turn that owns it. */
const refused = (): { ok: false; problems: Problem[] } => ({
  ok: false,
  problems: [{ code: 'LOCKED', message: LOCKED_MESSAGE, refs: [] }]
})

/**
 * Takes the next undo group off the top of a stack: one transaction, or every adjacent one of the
 * same assistant turn, in the order they come off.
 */
function takeGroup(stack: HistoryEntry[]): HistoryEntry[] {
  const top = stack.pop()
  if (!top) return []
  const group = [top]
  const turn = top.tx.assistantTurnId
  while (turn !== undefined && stack.at(-1)?.tx.assistantTurnId === turn) group.push(stack.pop()!)
  return group
}
