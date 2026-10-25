// The README states only what exists (SPEC 17; SPEC 20 item 16). Each test is named after its row in
// the "README claims" section of docs/v2/AUDIT.md. It fails if the README says that row's false
// claim again, or if a fact the README states about the topic stops matching the code, the data or
// the tooling it describes. A phrase is banned only where the claim has no number or file to check.
// Figures that need a tool run (test totals, the Playwright test count) or that change with every
// new file (the TypeScript file count) are not checked.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL, MODELS } from './assistant/client'
import { STRICT_TOOLS, TOOLS } from './assistant/tools'
import { BOARD_DEFS } from './core/defs/boards'
import { PART_DEFS, partDef } from './core/defs/parts'
import { TUTORIALS } from './core/defs/tutorials'
import { BEHAVIORS } from './core/sim/behaviors'
import { buildSteps } from './core/steps/steps'

const REPO = fileURLToPath(new URL('../../../../', import.meta.url))
const APP = join(REPO, 'gpio-dashboard')
const SRC = join(APP, 'src/renderer/src')
const MODELS_DIR = join(APP, 'src/renderer/public/models')

const read = (...path: string[]) => readFileSync(join(...path), 'utf8')
const ls = (dir: string) => readdirSync(dir, { recursive: true }) as string[]
const WORDS = 'zero one two three four five six seven eight nine ten eleven twelve'.split(' ')
const word = (n: number) => WORDS[n] ?? String(n)

const README = read(APP, 'README.md')
const PKG = JSON.parse(read(APP, 'package.json')) as {
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const DEPS = { ...PKG.dependencies, ...PKG.devDependencies }
const CARGO = read(APP, 'src-tauri/Cargo.toml')
const AGENT = read(APP, 'pi-agent/agent.py')
const SYSTEM_INFO = read(APP, 'pi-agent/system_info.py')
const ANTHROPIC = read(APP, 'src-tauri/src/anthropic.rs')
const MAIN = read(APP, 'src-tauri/src/main.rs')
const CONF = JSON.parse(read(APP, 'src-tauri/tauri.conf.json')) as {
  identifier: string
  build: { devUrl: string }
  app: { security: { csp: string }; windows: { titleBarStyle: string }[] }
}

/** The first capture of `re` in `text`; fails when nothing matches (the README was reworded). */
const grab = (re: RegExp, text: string, what: string) => {
  const m = re.exec(text)
  if (!m?.[1]) throw new Error(`${what}: nothing matches ${re}`)
  return m[1]
}

/** Every capture of `re` (global) in the README, as numbers. */
const stated = (re: RegExp) => [...README.matchAll(re)].map((m) => Number(m[1]))

/** The count cell of the Project scale row whose metric is `metric`. */
const scale = (metric: string) => {
  const table = /\n## Project scale\n([\s\S]*?)\n---/.exec(README)?.[1] ?? ''
  const cells = table.split('\n').map((l) => l.split('|').map((c) => c.trim()))
  return cells.find((c) => c[1] === metric)?.[2]
}

/** Non-test source files under these folders of the app whose text matches `re`. */
const mentions = (re: RegExp, ...dirs: string[]) =>
  dirs
    .flatMap((d) => ls(join(APP, d)).map((f) => join(APP, d, f)))
    .filter((f) => /\.(tsx?|jsx?|rs|py)$/.test(f) && !/\.test\./.test(f))
    .filter((f) => re.test(readFileSync(f, 'utf8')))
    .map((f) => relative(APP, f))

/** Findings rows of AUDIT.md, read as audit.test.ts reads them. */
const auditRows = read(REPO, 'docs/v2/AUDIT.md')
  .replace(/<!-- generated:([\w-]+) -->[\s\S]*?<!-- \/generated:\1 -->/g, '')
  .split('\n')
  .filter((l) => /^\| ([a-z0-9-]+-\d+|D\d+) \|/.test(l))
  .map((l) =>
    l
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((c) => c.trim())
  )

const KIT = TUTORIALS.filter((t) => t.meta.kitProject !== null)
const EXTRAS = TUTORIALS.filter((t) => t.meta.kitProject === null)
const NOT_IN_KIT = EXTRAS.filter((t) => t.meta.tags.includes('needs parts not in the kit'))
const STEPS = TUTORIALS.reduce((n, t) => n + buildSteps(t.doc, partDef).steps.length, 0)
const ASSERTIONS = TUTORIALS.reduce((n, t) => n + t.meta.assertions.length, 0)

/** The electrical rule codes: the netlist rules, and the ones that need simulated currents. */
const ERC_CODES = new Set(
  ['core/erc/erc.ts', 'core/sim/checks.ts'].flatMap((f) =>
    [...read(SRC, f).matchAll(/code: '([A-Z_]+)'/g)].map((m) => m[1])
  )
)

describe('README claims (AUDIT.md, section readme)', () => {
  it('readme-1: every file the README links to or names exists, and none is a root README', () => {
    const links = [...README.matchAll(/\]\(([^)\s]+)\)|src="([^"]+)"/g)]
      .map((m) => (m[1] ?? m[2])!.split('#')[0]!)
      .filter((l) => l && !/^(https?:|mailto:)/.test(l))
    // Backticked paths are written relative to the repository, the app, the renderer or its src.
    const roots = [REPO, APP, join(APP, 'src/renderer'), SRC]
    const named = [...README.matchAll(/`([^`\s]+\/[^`\s]*)`/g)]
      .map((m) => m[1]!)
      .filter((p) => !/^[~@/]/.test(p))
    const missing = [
      ...links.filter((l) => !existsSync(join(APP, l))),
      ...named.filter((p) => !roots.some((r) => existsSync(join(r, p.split('*')[0]!))))
    ]
    expect(links.length).toBeGreaterThan(0)
    expect(missing).toEqual([])
    expect(links).not.toContain('../README.md')
    expect(README).not.toMatch(/root `?README/i)
  })

  it('readme-2: the breadboard is a 3D model with committed GLBs; nothing is photo-realistic', () => {
    expect(README).not.toMatch(/photo[- ]?real/i)
    for (const id of BOARD_DEFS.keys()) {
      expect(existsSync(join(MODELS_DIR, `${id}.glb`)), `${id}.glb`).toBe(true)
    }
    expect(DEPS).toHaveProperty('three')
  })

  it('readme-3: "bb-830 (63 rows)" is the bb-830 model; no coordinate-system claim', () => {
    const boards = [...README.matchAll(/(bb-\d+) \((\d+) rows\)/g)]
    expect(boards.map((m) => m[1])).toContain('bb-830')
    for (const [, id, rows] of boards) {
      expect(BOARD_DEFS.get(id as 'bb-830' | 'bb-400')?.rows, id).toBe(Number(rows))
    }
    expect(BOARD_DEFS.get('bb-830')?.rows).toBe(63)
    expect(README).not.toMatch(
      /authoritative coordinate|coordinate[^.\n]*single source of truth|single source of truth[^.\n]*coordinate/i
    )
    // The model's holes are measured against the logical holes by a committed test.
    expect(existsSync(join(SRC, 'content/models.test.ts'))).toBe(true)
  })

  it('readme-5: parts are GLB models, one for every library part; no SVG glyphs', () => {
    expect(README).not.toMatch(/inline SVG|SVG primitive|exact row\/column/i)
    const index = JSON.parse(read(MODELS_DIR, 'parts/index.json')) as Record<
      string,
      { file: string }[]
    >
    expect([...PART_DEFS.keys()].filter((id) => !index[id]?.length)).toEqual([])
    const files = Object.values(index).flatMap((models) => models.map((m) => m.file))
    expect(files.filter((f) => !existsSync(join(MODELS_DIR, 'parts', f)))).toEqual([])
    const counts = stated(/\b(\d+) parts\b/g)
    expect(counts.length).toBeGreaterThan(0)
    for (const n of counts) expect(n, 'parts in the library').toBe(PART_DEFS.size)
  })

  it('readme-6: the tutorial, kit-project and not-in-kit counts are the shipped ones', () => {
    expect(README).not.toMatch(/\b18[- ](project|tutorial)/i)
    const counts = stated(/\b(\d+) tutorials\b/g)
    expect(counts.length).toBeGreaterThan(0)
    for (const n of counts) expect(n, 'tutorials').toBe(TUTORIALS.length)
    const sentence = grab(/(kit's \d+ projects.*)/, README, 'README')
    const claim =
      /kit's (\d+) projects[^,]*, then (\w+) extras, (\w+) of which are tagged[^(]*\(([^)]+)\)/.exec(
        sentence
      )
    expect(claim, 'the sentence on kit projects and extras').not.toBeNull()
    expect(Number(claim![1])).toBe(KIT.length)
    expect(claim![2]).toBe(word(EXTRAS.length))
    expect(claim![3]).toBe(word(NOT_IN_KIT.length))
    const names = claim![4]!.split(', ').map((n) => n.toLowerCase())
    expect(names).toHaveLength(NOT_IN_KIT.length)
    NOT_IN_KIT.forEach((t, i) => {
      expect(t.meta.title.toLowerCase().startsWith(names[i]!), `${t.meta.title}`).toBe(true)
    })
    // The kit's projects come first, in the kit's order.
    const projects = KIT.map((t) => t.meta.kitProject!)
    expect(projects).toEqual([...projects].sort())
    expect(Math.max(...KIT.map((t) => t.meta.order))).toBeLessThan(
      Math.min(...EXTRAS.map((t) => t.meta.order))
    )
    // The LCD1602 tutorial is held back, as the README says.
    expect(README).toMatch(/LCD1602 tutorial is not shipped/)
    expect(TUTORIALS.filter((t) => /lcd/i.test(t.meta.id))).toEqual([])
    const steps = [...stated(/\b(\d+) build steps\b/g), ...stated(/\bof the (\d+) steps\b/g)]
    expect(steps.length).toBeGreaterThan(0)
    for (const n of steps) expect(n, 'build steps').toBe(STEPS)
  })

  it('readme-9: no OpenRouter or multi-model AI; the assistant is the Anthropic proxy it describes', () => {
    expect(README).not.toMatch(/openrouter|multi-model|AI Code Generation|Supported Models/i)
    expect(mentions(/openrouter/i, 'src', 'src-tauri/src', 'pi-agent', 'scripts')).toEqual([])
    expect(JSON.stringify(PKG) + CARGO).not.toMatch(/openrouter/i)
    // The registered tools: 22, of which 11 are strict and 12 stream eagerly.
    const counts = stated(/\b(\d+) tools\b/g)
    expect(counts.length).toBeGreaterThan(0)
    for (const n of counts) expect(n, 'assistant tools').toBe(TOOLS.length)
    const budget = /(\d+) of the (\d+) tools are strict and (\d+) stream eagerly/.exec(README)
    expect(budget, 'the sentence on strict and eager tools').not.toBeNull()
    expect(budget!.slice(1).map(Number)).toEqual([
      STRICT_TOOLS.size,
      TOOLS.length,
      TOOLS.filter((t) => t.mutates).length
    ])
    // The first model is the default; the others are selectable.
    expect(MODELS[0].id).toBe(DEFAULT_MODEL)
    const others = MODELS.slice(1).map((m) => m.label.replace('Claude ', ''))
    expect(README).toContain(
      `${MODELS[0].label} by default, with ${others.slice(0, -1).join(', ')} and ${others.at(-1)} selectable`
    )
    expect(MAIN).toContain('commands::anthropic_request')
    // One recorded transcript for each prompt that replays offline.
    const recorded = readdirSync(join(APP, 'scripts/assistant-evals/transcripts')).length
    expect(grab(/(\w+) recorded prompts/i, README, 'README').toLowerCase()).toBe(word(recorded))
  })

  it('readme-15: SSH is Rust (russh); no SSHManager class and no per-shell drain', () => {
    expect(README).not.toMatch(/SSHManager|Map<sessionId|drains? up to \d+ seconds?/i)
    expect(CARGO).toMatch(/^russh = /m)
    expect(existsSync(join(APP, 'src-tauri/src/ssh.rs'))).toBe(true)
    expect(mentions(/SSHManager/, 'src', 'src-tauri/src', 'pi-agent')).toEqual([])
  })

  it('readme-16: system information is a Monitor panel, fed at the rates the agent uses', () => {
    expect(README).not.toMatch(/\bHUD\b|navbar/i)
    const rates = /pins at (\d+) Hz, system information every (\d+) s/.exec(README)
    expect(rates, 'the sentence on the sampling rates').not.toBeNull()
    expect(Number(rates![1])).toBe(Number(grab(/^GPIO_POLL_HZ = (\d+)/m, AGENT, 'agent.py')))
    expect(Number(rates![2])).toBe(Number(grab(/^SYSINFO_INTERVAL = (\d+)/m, AGENT, 'agent.py')))
    for (const key of ['cpu_temp', 'memory', 'disk', 'uptime']) {
      expect(SYSTEM_INFO, key).toContain(`"${key}"`)
    }
    // The panel reads only fields the agent sends (it once read others and showed 0.0 °C and NaN).
    const panel = read(SRC, 'components/SystemInfo.jsx')
    const fields = [...panel.matchAll(/\b(?:systemInfo|mem|disk)\.(\w+)/g)].map((m) => m[1]!)
    expect(fields.length).toBeGreaterThan(0)
    for (const field of fields) expect(SYSTEM_INFO, field).toContain(`"${field}"`)
    expect(read(SRC, 'pages/MonitorPage.jsx')).toMatch(/import SystemInfo from/)
    expect(read(SRC, 'components/Navbar.jsx')).not.toContain('SystemInfo')
  })

  it('readme-17: the tabs, Rust modules and workers are the ones the README names', () => {
    const tabs = [...read(SRC, 'components/Navbar.jsx').matchAll(/label: '(\w+)'/g)].map(
      (m) => m[1]
    )
    const sentence = /The app has (\w+) tabs: (.+?), plus/.exec(README)
    expect(sentence, 'the sentence on the tabs').not.toBeNull()
    expect(sentence![1]).toBe(word(tabs.length))
    expect([...sentence![2]!.matchAll(/\*\*(\w+)\*\*/g)].map((m) => m[1])).toEqual(tabs)
    expect(README).not.toMatch(/four disjoint stores|port 8765|direct WebSocket/i)
    // The architecture diagram's Rust modules.
    for (const [label, file] of [
      ['ssh', 'ssh'],
      ['ws', 'ws'],
      ['agent deploy', 'agent'],
      ['Anthropic proxy', 'anthropic'],
      ['projects', 'projects'],
      ['settings', 'settings']
    ]) {
      expect(README, label).toContain(label)
      expect(existsSync(join(APP, `src-tauri/src/${file}.rs`)), `${file}.rs`).toBe(true)
    }
    // Its workers, and the single writer.
    const workers = ls(join(SRC, 'workers')).filter((f) => f.endsWith('.worker.ts'))
    const noWorker = ['sim', 'pyodide', 'physics', 'assistant'].filter(
      (w) => !workers.some((f) => f.startsWith(w))
    )
    expect(noWorker).toEqual([])
    expect(read(SRC, 'state/circuitStore.ts')).toMatch(/\bdispatch\(/)
    // The agent is loopback-only with a start-up token, and the app reaches it through a tunnel.
    expect(AGENT).toMatch(/^\s+host = "127\.0\.0\.1"/m)
    expect(AGENT).toContain('secrets.token_urlsafe')
    expect(read(APP, 'src-tauri/src/ssh.rs')).toContain('channel_open_direct_tcpip')
  })

  it('readme-20: the security model is the one the code implements', () => {
    // The Anthropic proxy: the endpoints, the forwarded headers and no redirects.
    const route = grab(/fn route\(([\s\S]*?)\n}\n/, ANTHROPIC, 'anthropic.rs')
    const paths = [...new Set([...route.matchAll(/"(\/v1\/[\w/]+)"/g)].map((m) => m[1]!))].sort()
    const documented = [...README.matchAll(/`(?:GET|POST) (\/v1\/[\w/]+)`/g)].map((m) => m[1]!)
    expect([...new Set(documented)].sort()).toEqual(paths)
    expect(README).toContain(`allows ${word(paths.length)} endpoints`)
    const headers = Number(grab(/FORWARDED_HEADERS: \[&str; (\d+)\]/, ANTHROPIC, 'anthropic.rs'))
    expect(README).toContain(`forwards ${word(headers)} request headers`)
    expect(ANTHROPIC).toContain('redirect::Policy::none()')
    expect(README).toContain('refuses redirects')
    // Secrets are set, tested for and cleared; no registered command reads one back.
    const commands = [...MAIN.matchAll(/commands::(\w+)/g)].map((m) => m[1]!)
    expect(commands).toContain('settings_has_anthropic_key')
    expect(commands.filter((c) => /(get|read|reveal).*(key|password|secret)/.test(c))).toEqual([])
    expect(CARGO).toMatch(/^keyring = /m)
    expect(read(APP, 'src-tauri/src/settings.rs')).toContain('keyring::Entry::new(')
    // The page's CSP lets it connect to its own origin and Tauri's IPC only.
    const connect = grab(/connect-src ([^;]+)/, CONF.app.security.csp, 'tauri.conf.json')
    const allowed = ["'self'", 'ipc:', 'http://ipc.localhost']
    expect(connect.split(' ').filter((s) => !allowed.includes(s))).toEqual([])
    expect(README).toMatch(/only to its own origin and Tauri's IPC/)
    // Host keys: trust on first use, in known_hosts in the app config folder, certificates refused.
    expect(README).toContain(`${CONF.identifier}/`)
    expect(MAIN).toContain('config_dir.join("known_hosts")')
    const ssh = read(APP, 'src-tauri/src/ssh.rs')
    expect(ssh).toContain('accept-new')
    expect(ssh).toContain('host certificate')
    // The allowlists of the removed OpenRouter assistant are not described.
    expect(README).not.toMatch(/thinking level|prompt length/i)
  })

  it('readme-21: Stop returns pins with pinctrl; no GPIO.cleanup() reset is claimed', () => {
    expect(README).not.toMatch(
      /GPIO\.cleanup|GPIO\.setmode|GPIO Cleanup Guardrail|reset every pin/i
    )
    const commands = read(APP, 'src-tauri/src/commands.rs')
    expect(commands).toContain('format!("pinctrl set {} ip pn"')
    expect(commands.split('#[cfg(test)]')[0]).not.toContain('GPIO.cleanup')
    expect(read(SRC, 'state/runStore.ts')).toMatch(/async stop\(\)[\s\S]*?cleanupPins/)
    expect(MAIN).toContain('commands::ssh_gpio_cleanup')
  })

  it('readme-22: the tech stack names the versions the manifests pin', () => {
    // [README text, dependency, how many dot-separated parts of its version the README gives]
    const stack: [string, string, number][] = [
      ['React', 'react', 1],
      ['Vite', 'vite', 1],
      ['Tailwind', 'tailwindcss', 1],
      ['Zustand', 'zustand', 1],
      ['CodeMirror', 'codemirror', 1],
      ['xterm.js', '@xterm/xterm', 1],
      ['TypeScript', 'typescript', 1],
      ['three.js', 'three', 2],
      ['`@react-three/fiber`', '@react-three/fiber', 1],
      ['Pyodide', 'pyodide', 3],
      ['`@anthropic-ai/sdk`', '@anthropic-ai/sdk', 3],
      ['Vitest', 'vitest', 1],
      ['ESLint', 'eslint', 1],
      ['Prettier', 'prettier', 1]
    ]
    const version = (dep: string, parts: number) =>
      DEPS[dep]!.replace(/^[\^~]/, '')
        .split('.')
        .slice(0, parts)
        .join('.')
    const missing = stack
      .map(([text, dep, parts]) => `${text} ${version(dep, parts)}`)
      .filter((text) => !README.includes(text))
    expect(missing).toEqual([])
    // Rust crates and the Tauri major.
    expect(README).toContain(`Tauri ${grab(/^tauri = \{ version = "(\d+)"/m, CARGO, 'Cargo.toml')}`)
    for (const crate of [
      'russh',
      'tokio-tungstenite',
      'reqwest',
      'keyring',
      'tauri-plugin-dialog'
    ]) {
      expect(CARGO, crate).toMatch(new RegExp(`^${crate} = `, 'm'))
      expect(README, crate).toContain(`\`${crate}\``)
    }
    // The Pi agent's packages, Blender, ngspice and the strict TypeScript the badge states.
    const needs = read(APP, 'pi-agent/requirements.txt')
    expect(README).toContain(`\`websockets\` ${grab(/^websockets>=(\d+)/m, needs, 'requirements')}`)
    expect(README).toContain(`libgpiod ${grab(/^gpiod>=(\d+)/m, needs, 'requirements')}`)
    const versions = read(REPO, 'docs/VERSIONS.md')
    expect(README).toContain(
      `Blender ${grab(/\| Blender \| (\d+\.\d+)/, versions, 'VERSIONS.md')} LTS`
    )
    const ngspice = grab(
      /"ngspice": "ngspice-(\d+)"/,
      read(SRC, 'core/sim/fixtures/ngspice.json'),
      'fixtures'
    )
    expect(README).toContain(`ngspice ${ngspice}`)
    expect(read(APP, 'tsconfig.json')).toMatch(/"strict": true/)
    expect(README).toContain('TypeScript-strict')
  })

  it('readme-23: the Project scale table counts what the repository holds', () => {
    const glbs = ls(MODELS_DIR).filter((f) => f.endsWith('.glb'))
    const bytes = glbs.reduce((n, f) => n + statSync(join(MODELS_DIR, f)).size, 0)
    const python = readdirSync(join(APP, 'pi-agent')).filter((f) => f.endsWith('.py'))
    // The Rust sources are src/*.rs and build.rs.
    const rust = readdirSync(join(APP, 'src-tauri/src')).filter((f) => f.endsWith('.rs')).length + 1
    const decisions = (read(REPO, 'docs/v2/DECISIONS.md').match(/^## ADR-\d{4}/gm) ?? []).length
    const unsafe = auditRows.filter((r) => r[5] === 'Unsafe for hardware').length
    const ngspice = (
      JSON.parse(read(SRC, 'core/sim/fixtures/ngspice.json')) as { fixtures: unknown[] }
    ).fixtures.length
    const e2eFiles = readdirSync(join(APP, 'e2e')).filter((f) => f.endsWith('.spec.ts')).length
    const benchGlbs = glbs.filter((f) => !f.includes('/')).length
    const table: [metric: string, actual: unknown][] = [
      ['Tutorials', `${TUTORIALS.length} (${KIT.length} kit projects, ${EXTRAS.length} extras)`],
      ['Build steps, all tutorials', STEPS],
      ['Simulation assertions, all tutorials', ASSERTIONS],
      ['Library parts', PART_DEFS.size],
      [
        '3D model files',
        `${glbs.length} GLB (${benchGlbs} bench, ${glbs.length - benchGlbs} part), ${Math.round(bytes / 1e6)} MB`
      ],
      ['ERC rules', ERC_CODES.size],
      ['Device behaviour models', Object.keys(BEHAVIORS).length],
      ['ngspice reference circuits', ngspice],
      ['Assistant tools', TOOLS.length],
      [
        'Rust files / Pi-agent Python files',
        `${rust} / ${python.length} (${python.filter((f) => f.startsWith('test_')).length} of the Python files are tests)`
      ],
      [
        'Blender scripts',
        ls(join(APP, 'scripts/assets/blender')).filter((f) => f.endsWith('.py')).length
      ],
      ['Recorded decisions', decisions],
      ['Audit rows', `${auditRows.length} (${unsafe} unsafe for hardware), every one closed`]
    ]
    const wrong: string[] = []
    const check = (what: string, said: unknown, actual: unknown) => {
      if (String(said) !== String(actual))
        wrong.push(`${what}: README says ${said}, found ${actual}`)
    }
    for (const [metric, actual] of table) check(metric, scale(metric), actual)
    // The Playwright test total needs `playwright test --list`; the number of spec files does not.
    const e2e = scale('End-to-end tests (listed, not run for this table)')
    check('End-to-end test files', /^\d+ in (\d+) files/.exec(e2e ?? '')?.[1], e2eFiles)
    // The same figures in prose.
    const prose: [RegExp, string, unknown][] = [
      [/\b(\d+) recorded decisions\b/g, 'recorded decisions', decisions],
      [/ADR-0001 to ADR-(\d{4})/g, 'last ADR', decisions],
      [/\b(\d+) rules\b/g, 'ERC rules', ERC_CODES.size],
      [/\b(\d+) behaviour models\b/g, 'behaviour models', Object.keys(BEHAVIORS).length],
      [/\brecorded (\d+) rows\b/g, 'audit rows', auditRows.length],
      [/\b(\d+) of them marked unsafe\b/g, 'unsafe rows', unsafe],
      [/\b(\d+) circuits? compared with ngspice\b/g, 'ngspice circuits', ngspice]
    ]
    for (const [re, what, actual] of prose) for (const n of stated(re)) check(what, n, actual)
    // Every rule the ERC bullet names is a rule in the code.
    const bullet = README.split('\n').find((l) => l.includes('Electrical rule check')) ?? ''
    const named = [...bullet.matchAll(/`([A-Z]+(?:_[A-Z]+)+)`/g)].map((m) => m[1]!)
    if (!named.length) wrong.push('the ERC bullet names no rule')
    for (const code of named) if (!ERC_CODES.has(code)) wrong.push(`${code} is not an ERC rule`)
    expect(wrong).toEqual([])
  })

  it('readme-24: only macOS and the Pi 5 are claimed; the Node floor is the real one', () => {
    expect(README).not.toMatch(/cross-platform|Pi 4\b|Raspberry Pi 4/i)
    for (const line of README.split('\n').filter((l) => /\b(Windows|Linux)\b/.test(l))) {
      expect(line, 'Windows and Linux appear only as unsupported').toMatch(
        /out of scope|not been tried/
      )
    }
    expect(CONF.app.windows[0]?.titleBarStyle).toBe('Overlay')
    expect(ls(join(SRC, 'content/controllers')).filter((f) => /pi4/i.test(f))).toEqual([])
    // The floor is the lowest Node Vitest 5 accepts; the checks ran on the Node and npm recorded.
    const vitest = JSON.parse(read(APP, 'node_modules/vitest/package.json')) as {
      engines: { node: string }
    }
    expect(README).toContain(
      `Node.js ${grab(/(\d+\.\d+)/, vitest.engines.node, 'vitest')} or later`
    )
    const baseline = read(REPO, 'docs/v2/BASELINE.md')
    const node = grab(/\| node \| v(\d+)\./, baseline, 'BASELINE.md')
    const npm = grab(/\| npm \| (\d+)\./, baseline, 'BASELINE.md')
    expect(README).toContain(`Node ${node} with npm ${npm}`)
  })

  it('readme-26: the commands and files the Testing and Building sections name exist', () => {
    const scripts = [...README.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]!)
    expect(scripts.length).toBeGreaterThan(0)
    expect(scripts.filter((s) => !(s in PKG.scripts))).toEqual([])
    // `npm test` runs the Node bridge tests, then Vitest.
    expect(PKG.scripts.test).toMatch(/node --test .*&& vitest run/)
    expect(README).toMatch(/npm test .*Node tests for the bridge, then the Vitest suite/)
    for (const file of [
      'src-tauri/live-tests.sh',
      'scripts/assets/README.md',
      'playwright.config.ts'
    ]) {
      expect(existsSync(join(APP, file)), file).toBe(true)
    }
    expect(ls(join(APP, 'pi-agent')).filter((f) => f.startsWith('test_'))).not.toEqual([])
    // `cargo test` covers the WebSocket and Anthropic-proxy modules.
    for (const module of ['ws', 'anthropic']) {
      expect(read(APP, `src-tauri/src/${module}.rs`), module).toContain('#[cfg(test)]')
    }
    // The live scripts read the key from a git-ignored .env or a named file; `web:dev` is Vite.
    expect(read(REPO, '.gitignore')).toMatch(/^\.env$/m)
    const key = read(APP, 'scripts/assistant-evals/key.ts')
    expect(key).toContain('ANTHROPIC_API_KEY')
    expect(key).toContain('--key-file')
    expect(PKG.scripts['web:dev']).toBe('vite')
    expect(README).toContain('localhost:5173')
    expect(CONF.build.devUrl).toContain('localhost:5173')
  })

  it('readme-27: what the README lists as built exists; what it lists as not built is absent', () => {
    // Built: the I2C scan, project files, and the by-hand breadboard editor.
    expect(MAIN).toContain('commands::ssh_i2c_scan')
    expect(existsSync(join(APP, 'src-tauri/src/i2c.rs'))).toBe(true)
    expect(MAIN).toContain('commands::projects_import')
    expect(MAIN).toContain('commands::projects_export')
    expect(read(APP, 'src-tauri/src/projects.rs')).toContain('const EXTENSION: &str = "gpiob"')
    for (const file of ['panels/PartLibrary.tsx', 'panels/Properties.tsx', 'studio/gestures.ts']) {
      expect(existsSync(join(SRC, file)), file).toBe(true)
    }
    // Not built: the LCD1602 tutorial waits on an I2C level shifter the library does not have.
    expect(README).toMatch(/Not shipped until the part library has an I2C level shifter/)
    expect(TUTORIALS.filter((t) => /lcd/i.test(t.meta.id))).toEqual([])
    const shifters = [...PART_DEFS.values()].filter((d) =>
      /level[- ]?shift/i.test(`${d.id} ${d.name}`)
    )
    expect(shifters.map((d) => d.id)).toEqual([])
    // The controller is data and only the Pi 5's exists.
    expect(ls(join(SRC, 'content/controllers')).filter((f) => f.startsWith('pi5'))).not.toEqual([])
  })
})
