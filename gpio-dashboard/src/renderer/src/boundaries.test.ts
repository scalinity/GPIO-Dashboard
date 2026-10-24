// SPEC 4.5: module boundaries are enforced by lint. This proves the rules exist and bite.
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()
const BOUNDARY_RULES = new Set([
  'no-restricted-imports',
  'no-restricted-globals',
  'no-restricted-syntax'
])

async function boundaryErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `src/renderer/src/${file}` })
  return (result?.messages ?? [])
    .filter((m) => m.severity === 2 && m.ruleId !== null && BOUNDARY_RULES.has(m.ruleId))
    .map((m) => `${m.ruleId}: ${m.message}`)
}

const cases: [file: string, code: string, allowed: boolean][] = [
  // core/ is pure
  ['core/x.ts', "import { useState } from 'react'\nexport { useState }", false],
  ['core/x.ts', "import { invoke } from '@tauri-apps/api/core'\nexport { invoke }", false],
  ['core/x.ts', "import { store } from '../state/circuitStore'\nexport { store }", false],
  ['core/x.ts', "import * as THREE from 'three'\nexport { THREE }", false],
  ['core/x.ts', 'export const n = window.api', false],
  ['core/x.ts', 'export const d = document.body', false],
  ['core/x.ts', "import { netlist } from './netlist/build'\nexport { netlist }", true],
  // physics/ is visual only
  ['physics/x.ts', "import { store } from '../state/circuitStore'\nexport { store }", false],
  ['physics/x.ts', "import { run } from '../assistant/loop'\nexport { run }", false],
  ['physics/x.ts', "import { ssh } from '../native/ssh'\nexport { ssh }", false],
  ['physics/x.ts', "import { apply } from '../core/ops/apply'\nexport { apply }", false],
  ['physics/x.ts', "import { step } from './solver'\nexport { step }", true],
  // assistant/ reaches only core/, native/anthropic and its own context
  ['assistant/x.ts', "import { ssh } from '../native/ssh'\nexport { ssh }", false],
  ['assistant/x.ts', "import { gpio } from '@renderer/native/gpio'\nexport { gpio }", false],
  ['assistant/x.ts', "import { store } from '../state/circuitStore'\nexport { store }", false],
  ['assistant/x.ts', "import { scene } from '../studio/stage'\nexport { scene }", false],
  ['assistant/x.ts', "import { w } from '../workers/sim.worker'\nexport { w }", false],
  ['assistant/x.ts', "import { invoke } from '@tauri-apps/api/core'\nexport { invoke }", false],
  ['assistant/x.ts', 'export const run = () => window.api.gpio', false],
  ['assistant/x.ts', "import { request } from '../native/anthropic'\nexport { request }", true],
  ['assistant/x.ts', "import { netlist } from '../core/netlist/build'\nexport { netlist }", true],
  [
    'assistant/x.ts',
    "import type { AssistantContext } from './context'\nexport type { AssistantContext }",
    true
  ]
]

describe('module boundary lint rules (SPEC 4.5)', () => {
  it.each(['core', 'physics', 'assistant'])(
    '%s/ has the boundary rules configured as errors',
    async (dir) => {
      const config = await eslint.calculateConfigForFile(`src/renderer/src/${dir}/x.ts`)
      for (const rule of BOUNDARY_RULES) {
        const setting = config.rules?.[rule]
        expect(setting, `${dir}: ${rule}`).toBeDefined()
        expect(Array.isArray(setting) ? setting[0] : setting).toBe(2)
      }
    }
  )

  it.each(cases)('%s: %s → allowed=%s', async (file, code, allowed) => {
    const errors = await boundaryErrors(file, code)
    if (allowed) expect(errors).toEqual([])
    else expect(errors.length).toBeGreaterThan(0)
  })
})
