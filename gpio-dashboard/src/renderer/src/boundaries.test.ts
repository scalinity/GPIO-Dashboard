// SPEC 4.5: module boundaries are enforced by lint. This proves the rules exist and bite.
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()
const BOUNDARY_RULES = new Set([
  'no-restricted-imports',
  'no-restricted-globals',
  'no-restricted-syntax'
])
// no-restricted-imports does not see import(); assistant/ has its own rule for it.
const DYNAMIC_IMPORT_RULE = 'assistant-boundary/dynamic-import'

async function boundaryErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `src/renderer/src/${file}` })
  return (result?.messages ?? [])
    .filter(
      (m) =>
        m.severity === 2 &&
        m.ruleId !== null &&
        (BOUNDARY_RULES.has(m.ruleId) || m.ruleId === DYNAMIC_IMPORT_RULE)
    )
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
  ['core/x.ts', "import { StudioView } from '../studio/view'\nexport { StudioView }", false],
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
  ],
  // studio/ renders with WebGPURenderer and TSL, never the legacy renderer or drei
  ['studio/x.ts', "import { WebGLRenderer } from 'three'\nexport { WebGLRenderer }", false],
  [
    'studio/x.tsx',
    "import { OrbitControls } from '@react-three/drei'\nexport { OrbitControls }",
    false
  ],
  ['studio/x.ts', "import { WebGPURenderer } from 'three/webgpu'\nexport { WebGPURenderer }", true],
  ['studio/x.ts', "import { circuit } from '../state/circuit'\nexport { circuit }", true]
]

// Every way assistant/ can reach what it may not, written in plain JavaScript so each parses in
// every file type the boundary covers.
const ASSISTANT_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx']
const assistantViolations = [
  "import { runScript } from '../native/ssh'\nexport { runScript }",
  "export * from '../native/ssh'",
  "export { runScript } from '../native/ssh'",
  "export const run = async () => (await import('../native/ssh')).runScript('project_x.py')",
  "export const core = () => import('@tauri-apps/api/core')",
  "export const store = () => import('../state/runStore')",
  "export const store = () => import('@renderer/state/runStore')",
  "export const ui = () => import('react')",
  "export const sibling = () => import('../core/../state/runStore')",
  'export const load = (name) => import(name)',
  'export const load = (name) => import(`../core/${name}`)',
  'export const win = () => window.api.gpio'
]
const assistantAllowed = [
  "export * from '../core/netlist/build'",
  "export const load = () => import('../native/anthropic')",
  "export const load = () => import('../core/netlist/build')",
  "export const load = () => import('@renderer/core/netlist/build')",
  "export const load = () => import('./context')",
  "export const load = () => import('./tools/index')",
  "export const load = () => import('zod')"
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

  it('has the dynamic import rule configured as an error for assistant/', async () => {
    const config = await eslint.calculateConfigForFile('src/renderer/src/assistant/x.ts')
    const setting = config.rules?.[DYNAMIC_IMPORT_RULE]
    expect(Array.isArray(setting) ? setting[0] : setting).toBe(2)
  })

  it.each(cases)('%s: %s → allowed=%s', async (file, code, allowed) => {
    const errors = await boundaryErrors(file, code)
    if (allowed) expect(errors).toEqual([])
    else expect(errors.length).toBeGreaterThan(0)
  })

  describe.each(ASSISTANT_EXTENSIONS)('assistant/*.%s', (ext) => {
    it.each(assistantViolations)('rejects %s', async (code) => {
      expect((await boundaryErrors(`assistant/probe.${ext}`, code)).length).toBeGreaterThan(0)
    })

    it.each(assistantAllowed)('allows %s', async (code) => {
      expect(await boundaryErrors(`assistant/probe.${ext}`, code)).toEqual([])
    })
  })

  it('resolves a dynamic import against the importing file, not against assistant/', async () => {
    const nested = (spec: string) =>
      boundaryErrors('assistant/tools/probe.ts', `export const l = () => import('${spec}')`)
    expect(await nested('../../core/netlist/build')).toEqual([])
    expect(await nested('../types')).toEqual([])
    expect(await nested('../../native/anthropic')).toEqual([])
    expect(await nested('../../native/ssh')).not.toEqual([])
    expect(await nested('../../state/runStore')).not.toEqual([])
  })
})
