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

## M1 Native additions — in progress

| Task | Status | Verified / notes |
|------|--------|------------------|
| 1.7 D17 run deadline | done | `TUTORIAL_TIMEOUT` removed; `run.timeLimitSec` setting (null = no limit); a limited run is killed on the remote. Live: `closing_the_channel_alone_leaves_a_quiet_script_running` (observes the baseline orphan), `a_run_that_hits_its_time_limit_is_killed_on_the_remote` |
| 1.8 D18 tunnel | done | `Ssh::open_tunnel` (direct-tcpip) + `ws.rs` `Route::Tunnel`; agent.py bind fixed to 127.0.0.1. Live: `the_agent_socket_runs_through_the_ssh_tunnel_to_a_loopback_only_server` (peer process is sshd; telemetry in, `sense_pause` out) |
| ws send path | done | `Ws::send`, ordered, queued until auth. Unit: `sent_messages_reach_the_agent_in_order_after_auth`. Callers arrive in M6 (2 dead-code warnings until then) |
| 1.6 remove OpenRouter | done | ai.rs, 4 commands, `window.api.ai`, AiChatPanel wiring removed; `assistant.*` settings defaults |
| 1.2 key commands | done | `settings_set/has/clear_anthropic_key`; unit `no_anthropic_key_command_returns_the_key` |
| 1.3 projects.rs | done | Authored by a Sonnet subagent and reviewed; 21 tests; commands list/read/write/delete/export/import (dialogs from Rust) |
| 1.4 ssh_i2c_scan | done | i2c.rs parser (16 tests, Sonnet subagent, reviewed); live `an_i2c_scan_without_i2c_tools_reports_why` |
| 1.5 bridge + native/ | partial | api.js `projects`, `ssh.i2cScan`, `anthropic.{setKey,hasKey,clearKey}`; native/{bridge,projects,ssh}.ts + tests. `anthropic.request` waits for 1.1 |
| 1.1 anthropic.rs | in progress | Sonnet subagent in an isolated worktree; review + wiring pending. Docs check (platform.claude.com/docs/en/api/overview, 2026-10-23): `Authorization: Bearer` is primary; `anthropic-workspace-id` is required for keys not scoped to a workspace, so it must be forwarded too |
| 1.9 live proxy test | todo | |

Suite at fc780d9/991ac40: cargo test 65 pass / 19 ignored; live-tests 19/19; node 6/6; Vitest 29/29; lint 0 errors; typecheck ok.
