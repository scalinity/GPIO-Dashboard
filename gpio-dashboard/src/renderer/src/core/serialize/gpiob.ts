// The .gpiob file format: a circuit document as JSON with a schemaVersion (SPEC 5).
import { SCHEMA_VERSION } from '../model/defaults'
import { CircuitDocSchema } from '../model/schema'
import type { CircuitDoc } from '../model/types'

/** Upgrades a document from version n to n + 1. Add one entry per format change, with a fixture test. */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {}

export class FormatError extends Error {}

export function serialize(doc: CircuitDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

/** Parses a .gpiob file, upgrading it to the current format. Placement rules are checked separately. */
export function parse(text: string): CircuitDoc {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new FormatError(`Not a project file: ${(e as Error).message}`)
  }
  return migrate(raw)
}

export function migrate(raw: unknown): CircuitDoc {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new FormatError('Not a project file: expected a JSON object')
  }
  let doc = raw as Record<string, unknown>
  let version = doc.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new FormatError('Not a project file: missing schemaVersion')
  }
  if (version > SCHEMA_VERSION) {
    throw new FormatError(
      `This project was saved by a newer version of the app (format ${version}; this app reads up to ${SCHEMA_VERSION})`
    )
  }
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new FormatError(`No upgrade from format ${version}`)
    doc = { ...step(doc), schemaVersion: version + 1 }
    version += 1
  }
  const parsed = CircuitDocSchema.safeParse(doc)
  if (!parsed.success)
    throw new FormatError(
      `The project file is damaged: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`
    )
  return parsed.data
}
