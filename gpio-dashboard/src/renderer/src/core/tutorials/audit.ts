// A tutorial's generated wiring table and build steps as Markdown, for AUDIT.md (SPEC 16.1).
import type { PartDefs } from '../netlist/netlist'
import { buildSteps } from '../steps/steps'
import type { CircuitDoc } from '../model/types'

export function auditTables(doc: CircuitDoc, defs: PartDefs): string {
  const { table, steps } = buildSteps(doc, defs)
  const cell = (s: string) => s.replace(/\|/g, '\\|')
  return [
    '| Ref | Part | Pin | Hole | Net |',
    '|-----|------|-----|------|-----|',
    ...table.map((r) => `| ${r.ref} | ${cell(r.what)} | ${cell(r.pin)} | ${r.at} | ${r.net} |`),
    '',
    ...steps.map((s, i) => `${i + 1}. ${s.text}`)
  ].join('\n')
}

/** The marked region AUDIT.md holds for a tutorial: `<!-- generated:<id> -->` … `<!-- /generated:<id> -->`. */
export function auditRegion(id: string, body: string): string {
  return `<!-- generated:${id} -->\n${body}\n<!-- /generated:${id} -->`
}
