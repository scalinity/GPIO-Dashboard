// The audit covers every baseline item and leaves no finding open (SPEC 16.1, PLAN 4.6).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TUTORIALS } from './core/defs/tutorials'

const AUDIT = readFileSync(
  fileURLToPath(new URL('../../../../docs/v2/AUDIT.md', import.meta.url)),
  'utf8'
)

/** The tutorial ids in data/tutorials.js at 52639d9, the baseline. */
const BASELINE_TUTORIALS = [
  'blinking-led',
  'rgb-led',
  'button-led',
  'breathing-led',
  'flowing-leds',
  'buzzer',
  'relay',
  'motor',
  'servo',
  'lcd-display',
  'seven-segment',
  'four-digit-seven-segment',
  'shift-register',
  'pir-sensor',
  'dht11',
  'ultrasonic',
  'joystick',
  'keypad'
]
const OTHER_SECTIONS = ['pins', 'depictions', 'facts', 'readme', 'defects']

const section = (id: string) =>
  new RegExp(`<!-- section:${id} -->([\\s\\S]*?)<!-- /section:${id} -->`).exec(AUDIT)?.[1]

/**
 * Findings rows: `| <id> | item | baseline | correct | source | severity | guard | status |`,
 * outside the generated wiring tables (whose part refs such as D1 look like defect ids).
 */
const rows = AUDIT.replace(/<!-- generated:([\w-]+) -->[\s\S]*?<!-- \/generated:\1 -->/g, '')
  .split('\n')
  .filter((l) => /^\| ([a-z0-9-]+-\d+|D\d+) \|/.test(l))
  .map((l) =>
    l
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((c) => c.trim())
  )

describe('audit coverage', () => {
  it.each(TUTORIALS.map((t) => t.meta.id))('rebuilt tutorial %s has a section', (id) => {
    expect(section(id), id).toBeDefined()
  })

  it.each(BASELINE_TUTORIALS)('baseline tutorial %s is audited in a section heading', (id) => {
    expect(AUDIT).toMatch(new RegExp(`^### .*baseline \`${id}\``, 'm'))
  })

  it.each(OTHER_SECTIONS)('has the %s section', (id) => {
    expect(section(id)?.trim().length ?? 0).toBeGreaterThan(0)
  })

  it('registers D1–D18', () => {
    const ids = new Set(rows.map((r) => r[0]))
    for (let n = 1; n <= 18; n++) expect(ids.has(`D${n}`), `D${n}`).toBe(true)
  })

  it('gives every finding eight columns, a source and a guard', () => {
    for (const r of rows) {
      expect(r, r.join(' | ')).toHaveLength(8)
      expect(r[4]!.length, `${r[0]} source`).toBeGreaterThan(0)
      expect(r[6]!.length, `${r[0]} guard`).toBeGreaterThan(0)
    }
  })

  it('leaves no finding open; only parts SPEC 19 schedules later are marked so', () => {
    const open = rows.filter(
      (r) =>
        !/^(Fixed|Replaced|Correct|Holds|Scheduled \(M\d+(, M\d+)*\)|see the README section)/.test(r[7]!)
    )
    expect(open.map((r) => `${r[0]}: ${r[7]}`)).toEqual([])
    const scheduled = rows.filter((r) => r[7]!.startsWith('Scheduled')).map((r) => r[0])
    expect(scheduled).toEqual(['D14'])
  })
})
