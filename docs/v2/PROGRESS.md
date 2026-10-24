# Progress

Memory across context resets. After any restart, re-read SPEC.md, PLAN.md and this
file before continuing. Each entry: milestone/task · status · verified (command →
result) · assumed · open issues.

Worktree: `/Users/danny/Documents/Tools/GPIO Dashboard/.worktrees/v2-breadboard-studio`
(branch `v2-breadboard-studio`). Never edit the main checkout.

Environment facts a fresh session needs:
- `BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender` (5.2.2 LTS).
- `toktx`/`ktx` 4.4.2 in `~/.local/bin` (ADR-0005). ngspice 47 via Homebrew.
- `PI_HOST` is unset, so hardware-in-the-loop flows run against the mocks.
- The Anthropic key lives only in the main checkout's `.env`. Load it into the memory of
  an eval or live-proxy-test process only; never print, copy or log it.
- Reference photos stay in the main checkout (the repo is public): see
  docs/v2/reference/IMAGES.md.
- Throwaway Python: `uv run -q --with numpy --with pillow python -I <script>`.
- Commit messages: conventional style, no attribution trailers.

---

## Pre-flight (2026-10-23)

| Step | Status | Verified |
|------|--------|----------|
| 1 SPEC exists | done | `docs/v2/SPEC.md`, 2275 lines, read in full |
| 2 secrets | done | `git log --all --oneline -- .env` → empty. `git check-ignore -v .env` at the main root → matched only by `.git/info/exclude:9` (no root .gitignore rule, as expected) |
| 3 worktree + first commit | done | `fa8f0f2` adds SPEC.md and the root .gitignore `.env`/`.env.*`/`!.env.example`. `git check-ignore -v .env` in the worktree → `.gitignore:5`. `.env.example` not ignored (exit 1). No `docs/v2/reference/tboard/` to copy. Worktree path per ADR-0001 |
| 4 reference photos | done | 6 JPEGs read with vision; sizes + SHA-256 in `reference/IMAGES.md`. Repo `PUBLIC` → not copied |
| 5 toolchain | done | BASELINE.md. Blender 5.2.2 LTS present; KTX 4.4.2 installed (ADR-0005); ngspice 47 installed; Blender MCP configured, but no live Blender (`localhost:9876` refused) |
| 6 baseline | done | cargo test 24 pass / 15 ignored; live-tests 15/15; npm test 7/7; **lint FAIL 134 errors (pre-existing)**; build OK; `npm run dev` window renders; Pi not tested (PI_HOST unset) |
| 7 PLAN.md | done | docs/v2/PLAN.md |

## M0 Baseline and foundations — done (pushed at 37c2050)

| Task | Status | Verified / notes |
|------|--------|------------------|
| 0.1 BASELINE.md | done | see file |
| 0.9 T-board geometry ADR | done | ADR-0004; `scripts/reference/tboard_photo_measure.py` → aspect 1.0022, row spacing 6.013 pitch |
| 0.2 lint green | done | `npm run lint` → 0 errors, 167 warnings (baseline 134 errors, 174 warnings) |
| 0.3 TS strict + typecheck | done | `npm run typecheck` → exit 0 (TS 6.0.3, ADR-0007) |
| 0.4 ESLint boundary rules | done | `boundaries.test.ts`: 25 cases pass (rules exist as errors; forbidden imports and window.api rejected; native/anthropic and core allowed) |
| 0.5 Vitest in npm test | done | `npm test` → node 7/7 + Vitest 25/25 |
| 0.6 VERSIONS.md | done | docs/VERSIONS.md |
| 0.7 COOP/COEP + CSP | done | ADR-0008. Dev and prod both report crossOriginIsolated true, SharedArrayBuffer true, IPC ok (overlay, real window). CSP per SPEC 15 in tauri.conf.json; loopback responses carry Tauri's computed CSP |
| 0.8 WebGPU probe in the Tauri window | done | navigator.gpu adapter present in dev and prod; recorded in BASELINE.md |
| suite | green | cargo test 30 pass / 15 ignored; live-tests 15/15; npm test node 7/7 + Vitest 25/25; lint 0 errors (167 warnings); typecheck ok; `npm run build` ok |

## M1 Native additions — done

| Task | Status | Verified / notes |
|------|--------|------------------|
| 1.7 D17 run deadline | done | `TUTORIAL_TIMEOUT` removed; `run.timeLimitSec` setting (null = no limit); a limited run is killed on the remote. Live: `closing_the_channel_alone_leaves_a_quiet_script_running` (observes the baseline orphan), `a_run_that_hits_its_time_limit_is_killed_on_the_remote` |
| 1.8 D18 tunnel | done | `Ssh::open_tunnel` (direct-tcpip) + `ws.rs` `Route::Tunnel`; agent.py bind fixed to 127.0.0.1. Live: `the_agent_socket_runs_through_the_ssh_tunnel_to_a_loopback_only_server` (peer process is sshd; telemetry in, `sense_pause` out) |
| ws send path | done | `Ws::send`, ordered, queued until auth. Unit: `sent_messages_reach_the_agent_in_order_after_auth`. Callers arrive in M6 (2 dead-code warnings until then) |
| 1.6 remove OpenRouter | done | ai.rs, 4 commands, `window.api.ai`, AiChatPanel wiring removed; `assistant.*` settings defaults |
| 1.2 key commands | done | `settings_set/has/clear_anthropic_key`; unit `no_anthropic_key_command_returns_the_key` |
| 1.3 projects.rs | done | Authored by a Sonnet subagent and reviewed; 21 tests; commands list/read/write/delete/export/import (dialogs from Rust) |
| 1.4 ssh_i2c_scan | done | i2c.rs parser (16 tests, Sonnet subagent, reviewed); live `an_i2c_scan_without_i2c_tools_reports_why` |
| 1.5 bridge + native/ | done | api.js `projects`, `ssh.i2cScan`, `anthropic.{request,abort,setKey,hasKey,clearKey}` (Channel injected for tests); native/{bridge,projects,ssh,anthropic}.ts; `nativeAnthropicFetch` (8 Vitest cases: streaming, head-before-body, 4xx passthrough, errors before/after the head, abort, cancel, null-body statuses) |
| 1.1 anthropic.rs | done | Authored by a Sonnet subagent (19 tests; its own mutation check: 15/15 caught); production code reviewed line by line. `anthropic-workspace-id` added to the forwarded headers (ADR-0010). Commands `anthropic_request` (Channel: JSON head/end/error, raw chunks) and `anthropic_abort`; `proxy_events_become_json_messages_and_raw_chunks` |
| 1.9 live proxy test | done | `live_count_tokens_through_the_real_proxy_path`, key loaded from the main .env into that cargo process only → 1 passed (HTTP 200, numeric input_tokens). Output filtered for `sk-ant`; nothing printed |

M1 exit suite (2026-10-24, at afc0796 + the live-tests.sh fix):
- `cargo test`: 85 passed / 20 ignored.
- `live-tests.sh`: 19/19. It now skips the Anthropic live test, which needs a key in its own process. Run that one with `cargo test live_count_tokens_through_the_real_proxy_path -- --ignored`; it passed earlier the same day.
- `npm test`: node 7/7 + Vitest 37/37. Lint 0 errors (167 warnings). Typecheck ok. `npm run build` ok.
- Production app, read from the overlay: origin `http://127.0.0.1:57852`, crossOriginIsolated true, SharedArrayBuffer true, IPC ok.
- The subagent worktrees were removed after a diff confirmed their work is integrated (5.4 GB freed).

### Research carried into M2 (verified 2026-10-23; turn each into data with its source)
- **Pi 5 header pins**: the official table "Pin names, types, and typical functions" in
  `raspberrypi/documentation` master@1bf32ac,
  `documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc`. All 40 rows
  parse; the GP numbers cross-check against the T-board label table from the photos. A
  parser that handles empty function cells and the one-line header row was tried in the
  scratchpad; rebuild it as a committed script, or transcribe with a test.
- **RP1 electrical values**: ADR-0009 (V_IL ≤ 0.8, V_IH ≥ 2.0, R_PU 37/55/86 kΩ,
  R_PD 35/55/98 kΩ, I_IL ≤ 3 µA, I_OL/I_OH per drive strength, 16 mA per pin / 50 mA
  total, GP2/GP3 1.8 kΩ pull-ups).
- **BB830** (datasheet BPS-MAR-BB830+BB830T-001 Rev 3.05, SHA-256 `bf594dc5…cbd61bcf85c`,
  from datasheet.octopart.com; AN0002 included):
  - 165.1 × 54.6 × 8.5 mm, 63 rows, 0.1″ square holes.
  - Rails: 4 × 50 holes in groups of 5, holes in line with the circuit rows.
  - AN0002 §3.3 and §4: the BR1's outer strips are on 0.1″ centres from the circuit
    area, and the BB830's sit 0.05″ further out. So the BB830 rail lines are **0.25″
    and 0.35″** from the outermost circuit column (a or j). This matches §3.2: the
    BB400's outer strips sit 0.25″ from the circuit area, with holes offset 0.050″ along
    the rows.
  - Rail holes along the rows: the datasheet's internal-connections diagram, and the
    top-down kit photo measured with `bb_rows` (column a → 63 rows; left inner rail → 50
    holes), agree on rows **3–7, 9–13, …, 57–61** (start 3 + 6k, k = 0..9).
  - Across the board, the kit photo gives inner/outer rail at 2.66/3.76 pitch (left) and
    2.93/4.01 pitch (right) from the nearest circuit column, with the trench at 2.96
    pitch. That's nearer 2.5/3.5 (BB830) than 1.5/2.5. The generic board sits about 0.3
    pitch further out: record it as a photo difference, and keep the BB830 values.
  - The BB400 datasheet URL returned HTML, not a PDF. Find another copy in M2.
- **Kit photo legend** (IMAGES.md): one side is `+` outer / `−` inner, the other `+` inner
  / `−` outer.

## M2 circuit-core — in progress (2026-10-24)

| Task | Status | Verified / notes |
|------|--------|------------------|
| 2.1 model + schemas | done | `core/model/types.ts`, zod `schema.ts` typed against it (PartDef, CircuitDoc). Add ops carry an optional `index` and RemoveBoard exists, so undo is exact |
| 2.2 boards | bb-830 done; **bb-400 pending** | `content/boards/bb-830.board.json` with per-value provenance; geometry tests (12). The BB300/BB400 datasheet URLs all return 404 or a bot challenge (busboard.us, mouser, jameco, sparkfun); still to try: firecrawl/fcpi or another mirror. DigiKey lists the BB400 at 84.0 x 54.3 mm (search result only, not yet verified) |
| 2.3 Pi header + RP1 constants | done | `pi5-header.json` generated by `scripts/reference/pi_header_from_docs.py` from the official docs at 1bf32ac; `pi5-board.json` from the mechanical drawing (read visually); RP1 values in ADR-0009 (constants file still to write for the sim, M3) |
| 2.4 T-board / ribbon / leads | done | `tboard.json` (ADR-0004), `ribbon.json`, `leads/dupont.json` (housing 12.0 mm and pin 5.5 mm, photo-calibrated); T-board tests (14) including the label ↔ header identity through the ribbon |
| 2.5 kit part defs | partial | Batch 3 (ICs and displays) integrated, e54fa74. Batches 1 (passives/LEDs), 2 (switches/transistors/audio, plus pn2222), 4 (modules, plus ads7830-module) still running in subagent worktrees. Inventory integrated (8a04ba9). Kit vs spec differences: ADR-0011 |
| 2.6 ops/undo | done | `core/ops/apply.ts`; fast-check: any edit sequence undoes to a strictly equal doc (300 runs) |
| 2.7 netlist + engine | done | union-find netlist (13 tests; the wire-end union bug was found by a test and fixed); engine diffs + preview; **≤1 ms budget test passes** (median of warm runs on a full bb-830 scene) |
| 2.8 validation | done | `core/ops/validate.ts`: holes, T-board body (edge-column lean), spans, rigid footprints and rotation, trench, off-board, gender mating |
| 2.9 reach + ERC v1 | done | `core/reach`, `core/erc` (15 rule tests, each firing and quiet); `core/code/pins.ts` (6 tests). Sim-based rules (PIN_OVERCURRENT, RAIL_BUDGET, LED current check) come in M3. **PHYSICAL_COLLISION pending** until real part bodies land |
| 2.10 serialization | done | `.gpiob` parse/serialize/migrate; 4 tests |
| store | done | `state/circuitStore.ts`: single writer, exact undo/redo, undoTurn, open; 7 tests |
| regressions | D1-D4, D15 done | `core/regressions.test.ts` |

Suite at 65cf521: Vitest 98 core/state/content tests green; typecheck clean; lint 0 errors.
Open for M2 exit: batches 1, 2, 4 + review; bb-400; PHYSICAL_COLLISION; then the full suite and push.
