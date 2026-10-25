// Typed project file access (src-tauri/src/projects.rs through commands.rs).
import { bridge, unwrap } from './bridge'

export interface ProjectSummary {
  id: string
  name: string
  updated: string
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return unwrap(await bridge().projects.list()).projects as ProjectSummary[]
}

export async function readProject(id: string): Promise<unknown> {
  return unwrap(await bridge().projects.read(id)).doc
}

export async function writeProject(id: string, doc: unknown): Promise<void> {
  unwrap(await bridge().projects.write(id, doc))
}

export async function deleteProject(id: string): Promise<void> {
  unwrap(await bridge().projects.delete(id))
}

/** Saves through the native save dialog; `null` when the user cancels. */
export async function exportProject(doc: unknown): Promise<string | null> {
  const result = unwrap(await bridge().projects.export(doc))
  return 'canceled' in result ? null : result.path
}

/** Writes the assistant's transcript beside project `id`'s file (SPEC 11.9). */
export async function writeTranscript(id: string, transcript: unknown): Promise<void> {
  unwrap(await bridge().projects.writeTranscript(id, transcript))
}

/** Opens a project file through the native open dialog; `null` when the user cancels. */
export async function importProject(): Promise<unknown | null> {
  const result = unwrap(await bridge().projects.import())
  return 'canceled' in result ? null : result.doc
}
