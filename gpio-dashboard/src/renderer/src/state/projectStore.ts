// Projects (SPEC 11.9): .gpiob files in the app data folder with a gallery, plus Save As and Open
// through the native dialogs that Rust runs. Every document opens through the Workbench's open(),
// which validates it and hands it to the app's CircuitStore.
import { create } from 'zustand'
import { newDoc } from '../core/model/defaults'
import type { CircuitDoc } from '../core/model/types'
import { migrate } from '../core/serialize/gpiob'
import {
  exportProject,
  importProject,
  listProjects,
  type ProjectSummary,
  readProject,
  writeProject
} from '../native/projects'
import { circuit } from './circuit'
import { useWorkbench } from './workbenchStore'

interface ProjectState {
  /** The open document's file in the app data folder; null until it is saved there. */
  id: string | null
  /** The gallery's listing while it is open. */
  gallery: ProjectSummary[] | null
  error: string | null
}

export const useProject = create<ProjectState>(() => ({ id: null, gallery: null, error: null }))

/**
 * A document opened from the Tutorials and not saved as one of my projects is a read-only
 * template (SPEC 11.9); forking it into my projects comes with Build Mode.
 */
export const isTemplate = (doc: CircuitDoc = circuit.getSnapshot()) =>
  !!doc.meta.sourceTutorialId && useProject.getState().id === null

/** A file id from the project's name: [A-Za-z0-9_-], unique by its time of creation. */
const fileId = (name: string) =>
  `${name.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40) || 'project'}-${Date.now().toString(36)}`

async function attempt(action: () => Promise<void>) {
  try {
    useProject.setState({ error: null })
    await action()
  } catch (e) {
    useProject.setState({ error: e instanceof Error ? e.message : String(e) })
  }
}

/** While an assistant turn owns the document, no other document may replace it. */
function unlocked() {
  if (circuit.locked) throw new Error('Claude is working on the circuit. Stop it first.')
}

async function open(id: string | null, raw: unknown) {
  unlocked()
  const doc = migrate(raw)
  const workbench = useWorkbench.getState()
  await workbench.open(id ?? doc.meta.name, doc)
  const { problems } = useWorkbench.getState()
  if (problems.length)
    throw new Error(`The project breaks placement rules: ${problems[0]!.message}`)
  useProject.setState({ id, gallery: null })
}

/** The code being edited joins the document before it is written. */
function commitCode() {
  const { code } = useWorkbench.getState()
  const doc = circuit.getSnapshot()
  if (code === doc.code.source) return
  circuit.dispatch({
    author: 'user',
    label: 'Edit code',
    ops: [{ type: 'SetCode', code: { ...doc.code, source: code } }]
  })
}

export const newProject = () =>
  attempt(async () => {
    unlocked()
    await useWorkbench.getState().open('new', newDoc('Untitled', new Date().toISOString()))
    useProject.setState({ id: null })
  })

export const openFile = () =>
  attempt(async () => {
    unlocked()
    const raw = await importProject()
    if (raw !== null) await open(null, raw)
  })

export const openProject = (id: string) => attempt(async () => open(id, await readProject(id)))

export const save = () =>
  attempt(async () => {
    if (isTemplate()) throw new Error('Tutorials are read-only templates.')
    commitCode()
    const doc = circuit.getSnapshot()
    const id = useProject.getState().id ?? fileId(doc.meta.name)
    await writeProject(id, doc)
    useProject.setState({ id })
    // Run on Pi names the uploaded program after the project's file.
    useWorkbench.setState({ source: id })
  })

export const saveAs = () =>
  attempt(async () => {
    if (isTemplate()) throw new Error('Tutorials are read-only templates.')
    commitCode()
    await exportProject(circuit.getSnapshot())
  })

export const showGallery = () =>
  attempt(async () => useProject.setState({ gallery: await listProjects() }))

export const closeGallery = () => useProject.setState({ gallery: null })
