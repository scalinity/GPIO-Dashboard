# Baseline (before any v2 change)

Recorded 2026-10-23 (US Eastern) in the worktree
`.worktrees/v2-breadboard-studio`, branch `v2-breadboard-studio`, created from
`origin/main`.

- Baseline commit: `52639d943b2694b9e519d26cdeabf801cb77524f`
  ("docs(readme): correct the capability claim and describe host keys and testing").
- The suite runs below were made on that tree. The only addition was a copy of the main
  checkout's `gpio-dashboard/package-lock.json`, needed for `npm ci` because the project
  gitignores its lockfile. The copy stays ignored.

## Toolchain

| Tool | Version | How checked |
|------|---------|-------------|
| rustc | 1.99.1 (58cf8f9c3 2026-10-13) | `rustc --version` |
| cargo | 1.99.1 (5f94df478 2026-08-27) | `cargo --version` |
| node | v26.12.1 | `node --version` |
| npm | 11.20.0 | `npm --version` |
| Tauri CLI | tauri-cli 2.12.4 (`@tauri-apps/cli`) | `npx tauri --version` |
| tauri crate | 2.12.5 | `src-tauri/Cargo.lock` |
| Vite | 7.3.7 | `npx vite --version` |
| gh | 2.103.0 (2026-10-21) | `gh --version` |
| Blender | **5.2.2 LTS** (build date 2026-09-15) | `blender` is not on PATH; `/Applications/Blender.app/Contents/MacOS/Blender --version`. Already the LTS, so nothing was installed. `BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender` |
| KTX-Software | **4.4.2** (`toktx v4.4.2`, `ktx v4.4.2`) | Was missing. Installed from the signed, Apple-notarized release package `KTX-Software-4.4.2-Darwin-arm64.pkg` (SHA-256 `500bd8f9d63358c3f3a0d83b724c8574436a72c37dc0e4bad90ec1ca38032c3c`, Developer ID Installer: The Khronos Group, Inc.). The payload was unpacked to `~/.local/opt/ktx-software-4.4.2/{bin,lib}` without sudo, with `toktx` and `ktx` linked into `~/.local/bin`. Homebrew has no KTX-Software formula. |
| ngspice | 47 | Was missing; `brew install ngspice` |
| uv | present (`/opt/homebrew/bin/uv`) | used for throwaway Python measurement scripts |

**Blender MCP:** an MCP server named `blender` is configured in this Claude Code session.
Its offline tools (bundled API and manual search) load, but
`get_objects_summary` returned "Cannot connect to Blender at localhost:9876". So no live
Blender session is attached. Its tool set (`execute_blender_code`,
`get_blendfile_summary_*`, `render_viewport_to_path`, `search_api_docs`) is not the
ahujasid add-on's tool set named in SPEC 3.3. Assets are built headless regardless
(SPEC 10.3).

## Baseline suite results

| Suite | Command | Result |
|-------|---------|--------|
| Rust unit + mock-server tests | `cd src-tauri && cargo test` | **pass**: 24 passed, 0 failed, 15 ignored (the live tests), 4.11 s |
| Live sshd integration | `src-tauri/live-tests.sh` | **pass**: 15 passed, 0 failed (throwaway sshd on 127.0.0.1:2222 and :2223), 25.15 s |
| Bridge tests | `npm test` (`node --test src/renderer/src/`) | **pass**: 7 tests, 7 pass |
| Lint | `npm run lint` | **FAIL (pre-existing)**: 308 problems, 134 errors and 174 warnings |
| Production build | `npm run build` (`tauri build`) | **pass**: `GPIO Dashboard.app` (5.81 MiB) and `GPIO Dashboard_1.0.0_aarch64.dmg` (3.31 MiB); notarization skipped, no Apple credentials |

### Pre-existing lint failures (by rule)

| Count | Severity | Rule |
|------:|----------|------|
| 174 | warning | prettier/prettier |
| 129 | error | react/prop-types |
| 3 | error | no-empty (`store/tutorialStore.js` lines 88, 93, 120) |
| 1 | error | react-hooks/set-state-in-effect |
| 1 | error | no-unused-vars |

Errors by file: WiringOverlay.jsx 34, TutorialDetail.jsx 25, TCobbler.jsx 17,
TutorialCard.jsx 13, GpioPin.jsx 11, AiChatPanel.jsx 9, LiveMonitor.jsx 7,
Breadboard.jsx 5, SystemInfo.jsx 5, tutorialStore.js 3, CodeEditor.jsx 2,
Terminal.jsx 2, ErrorBoundary.jsx 1.

The lint suite was already red at the baseline. M0 brings it to green (see DECISIONS.md),
so later regressions are measurable.

## Dev launch and Pi connection

- `npm run dev` launches the app. Vite was ready in 101 ms on `localhost:5173`, then
  `cargo run` started `target/debug/gpio-dashboard`. System Events reported one window
  titled "GPIO Dashboard" (1168×734 pt), which rendered the Connect page with the overlay
  title bar and navbar (Connect, Pinout, Breadboard, Tutorials, Monitor).
- **Pi connection: not tested.** `PI_HOST` was unset in this environment. Per D18, the
  telemetry WebSocket is expected to fail as deployed: the agent binds `127.0.0.1:8765`,
  and `ws.rs` dials the Pi's address directly.

## WebGPU availability and isolation in the Tauri window (M0 task 0.8)

Read from the dev overlay (`src/renderer/src/dev/`, toggled with Cmd/Ctrl+Shift+D) in the
real Tauri window (WKWebView, `AppleWebKit/605.1.15`, macOS 27.2) on 2026-10-23, after the
ADR-0008 changes:

| | dev (`tauri dev`) | production (`tauri build` .app) |
|---|---|---|
| origin | `http://localhost:5173` | `http://127.0.0.1:<ephemeral>` (52124 in the run) |
| isSecureContext | true | true |
| crossOriginIsolated | true | true |
| SharedArrayBuffer | true | true |
| IPC round trip (`ssh_get_status`) | ok | ok |
| `navigator.gpu` | adapter ok | adapter ok |

Adapter: `adapter.info` reports vendor, architecture and device all as "apple" (WebKit
limits adapter info). `maxBufferSize` is 2048 MiB. Features: bgra8unorm-storage,
clip-distances, core-features-and-limits, depth-clip-control, depth32float-stencil8,
float16-renderable, float32-blendable, float32-filterable, float32-renderable,
indirect-first-instance, primitive-index, rg11b10ufloat-renderable, shader-f16,
texture-compression-astc (+ sliced-3d), texture-compression-bc (+ sliced-3d),
texture-compression-etc2, texture-formats-tier1, texture-formats-tier2, timestamp-query.
So WebGPU is exposed in the webview, and WebGPURenderer is expected to pick the WebGPU
backend (verified in M7).

Before ADR-0008: dev reported `crossOriginIsolated` false (stale cached headers), and
production on `tauri://localhost` reported `crossOriginIsolated` true but
`SharedArrayBuffer` undefined.

## T-board measurements

`docs/v2/reference/tboard/` does **not** exist in the main checkout (checked 2026-10-23).
T-board geometry therefore comes from the calibrated reference photos (priority 2 in
SPEC 6.3), with the Adafruit T-Cobbler Plus board file as the prior (priority 3).

## Existing modules vs SPEC 17

Paths are relative to `gpio-dashboard/`.

| Module | Lines / notes | SPEC 17 disposition |
|--------|---------------|---------------------|
| `src-tauri/src/main.rs` | 110; command and state registration | **Keep** (register new commands/state) |
| `src-tauri/src/ssh.rs` | 798; russh exec, streaming exec, PTY, `cat >` upload, TOFU known_hosts, reconnect | **Extend**: direct-tcpip tunnel (D18), `ssh_i2c_scan` |
| `src-tauri/src/ws.rs` | 218; Pi-agent WebSocket feed, raw-payload dedupe; sends only the auth frame | **Extend**: connect through the tunnel; send path for agent commands |
| `src-tauri/src/agent.rs` | 171; deploys a fixed six-file `AGENT_FILES` array, install, start/stop | **Extend**: deploy `sense.py` |
| `src-tauri/src/commands.rs` | 433; command handlers, `SETTINGS_ALLOWLIST`, `TUTORIAL_TIMEOUT = 120 s` (D17) | **Extend**: new commands and allowlist; fix D17 |
| `src-tauri/src/settings.rs` | 273; JSON settings + Keychain helpers (`com.gpio-dashboard`) | **Extend**: Anthropic key, `assistant.*` defaults |
| `src-tauri/src/ai.rs` | 550; OpenRouter single-turn streaming | **Remove** |
| `src-tauri/src/live_tests.rs`, `test_support.rs` | 549 / 33; ignored live tests and helpers | **Keep** (extended for D17/D18) |
| `src-tauri/tauri.conf.json` | CSP without `'self'` in connect-src; no COOP/COEP | **Extend**: CSP and headers |
| `pi-agent/` (agent.py, code_executor.py, gpio_monitor.py, system_info.py, install.sh, requirements.txt) | Python agent, binds `AGENT_HOST` default `127.0.0.1` | **Keep** + `sense.py` and its message types |
| `src/renderer/src/api.js` (+ `api.test.js`) | `window.api` over invoke/listen; `createApi` injectable | **Extend**: `anthropic`, `projects`; remove `ai` |
| pages Connect, Pinout, Monitor | | **Keep** |
| `pages/BreadboardPage.jsx` | falls back to `'led_blink'` (D6) | **Replace** → StudioPage (M7) |
| `pages/TutorialsPage.jsx` | | **Replace** (Build Mode) |
| components Terminal, TerminalPanel, CodeEditor, GpioHeader, GpioPin, PinDetail, LiveMonitor, SystemInfo, ConnectionStatus, Navbar, ErrorBoundary | | **Keep** |
| components Breadboard.jsx, TCobbler.jsx, WiringOverlay.jsx, breadboardCoords.js | SVG breadboard; 30 rows (D1); pins between holes (D2); rails off-board (D3); mixed coordinates (D4); 6 glyph types (D5) | **Replace** |
| components TutorialDetail.jsx, TutorialCard.jsx | | **Replace** (Build Mode) |
| components AiChatPanel.jsx | OpenRouter chat (D14) | **Replace** → panels/Claude |
| `data/tutorials.js` | 18 tutorials with `wiringDiagram` | **Replace** → `content/tutorials/*.gpiob` |
| `data/pins.js` | header table | starting point only; verified and replaced by `core` data (M2) |
| stores connection, gpio, ui | | **Keep** |
| `store/tutorialStore.js` | tutorial-only run path, AI wiring | **Extend**: project-level run (M5) |
| `vite.config.js`, `eslint.config.mjs`, `package.json` | | **Extend** |
| Root `.gitignore` | did not cover `.env` | **Fixed** in the first v2 commit (`fa8f0f2`) |
