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

## M2 circuit-core — done (2026-10-24)

| Task | Status | Verified / notes |
|------|--------|------------------|
| 2.1 model + schemas | done | `core/model/types.ts`, zod `schema.ts` typed against it (PartDef, CircuitDoc). Add ops carry an optional `index` and RemoveBoard exists, so undo is exact |
| 2.2 boards | done | bb-830 and bb-400 (0261319). The BB400 datasheet Rev 6 was fetched through `mcp__fcpi__firecrawl_scrape` (direct curl gets a bot challenge); body 84.0 x 54.3 x 8.5 mm, 30 rows, rails per AN0002; its dimension table does not reconcile and is recorded as unused |
| 2.3 Pi header + RP1 constants | done | `pi5-header.json` generated by `scripts/reference/pi_header_from_docs.py` from the official docs at 1bf32ac; `pi5-board.json` from the mechanical drawing (read visually); RP1 values in ADR-0009 (constants file still to write for the sim, M3) |
| 2.4 T-board / ribbon / leads | done | `tboard.json` (ADR-0004), `ribbon.json`, `leads/dupont.json` (housing 12.0 mm and pin 5.5 mm, photo-calibrated); T-board tests (14) including the label ↔ header identity through the ribbon |
| 2.5 kit part defs | done | 38 definitions in four batches by Sonnet subagents, each from cited manufacturer datasheets with a facts test per part; integrated through the generic part test in this tree (e54fa74, 35c967a, d4e2adf). Kit vs spec differences: ADR-0011. Stand-in datasheets for kit parts with no named model are in each part's notes |
| 2.6 ops/undo | done | `core/ops/apply.ts`; fast-check: any edit sequence undoes to a strictly equal doc (300 runs) |
| 2.7 netlist + engine | done | union-find netlist (13 tests; the wire-end union bug was found by a test and fixed); engine diffs + preview; **≤1 ms budget test passes** (median of warm runs on a full bb-830 scene) |
| 2.8 validation | done | `core/ops/validate.ts`: holes, T-board body (edge-column lean), spans, rigid footprints and rotation, trench, off-board, gender mating |
| 2.9 reach + ERC v1 | done | `core/reach`, `core/erc` (16 rules, each firing and quiet), `core/code/pins.ts`. PHYSICAL_COLLISION (warning; separating-axis test on `bodyMm` outlines, 0.3 mm tolerance) runs against the real library: neighbouring 5 mm LEDs, side-by-side resistors, a resistor under a DIP. Sim-based rules (PIN_OVERCURRENT, RAIL_BUDGET, LED current) come with M3 |
| 2.10 serialization | done | `.gpiob` parse/serialize/migrate; 4 tests |
| store | done | `state/circuitStore.ts`: single writer, exact undo/redo, undoTurn, open; 7 tests |
| regressions | D1-D4, D15 done | `core/regressions.test.ts` |

Suite at 65cf521: Vitest 98 core/state/content tests green; typecheck clean; lint 0 errors.
**Lesson (0261319):** Vitest 5's on-disk transform cache (`fsModuleCache`) kept a stale `import.meta.glob` expansion, so new content files were silently left out of tests. It is now off in vitest.config.ts. After the fix: 16 files, 236 tests green. Integrate subagent content only through the generic test in this tree.
M2 exit suite (2026-10-24):
- `cargo test`: 85 passed / 20 ignored. `live-tests.sh`: 19/19.
- `npm test`: node 7/7 + Vitest 491/491 (23 files). Lint 0 errors (167 warnings, all prettier/react-refresh in v1 files). Typecheck clean. `npm run build` produced the .app and .dmg.
- All subagent worktrees removed after file-by-file comparison with the integrated copies.

## M3 simulation — done (2026-10-24)

| Task | Status | Verified / notes |
|------|--------|------------------|
| 3.1 solver | done | `core/sim/solver.ts`: dense LU with partial pivoting, Newton with pnjlim limiting, 1 V step damping, gmin stepping (1e-2 → 1e-12), BE first step then trapezoidal. Singular and non-convergent circuits throw. 16 hand-worked tests (divider, Norton source, switch, diode KCL, NPN saturation and active β, PNP, RC and RL against analytic curves within 0.1%) |
| 3.2 device models | done | Primitives in `devices.ts`; `fit.ts` (ADR-0012); `circuit.ts` builds every library part (LEDs/RGB/displays/bar graph as fitted dies, BJTs, switches, pot, LDR, NTC, passive-buzzer coil (R only: no inductance in its datasheet), power module). 15 behaviours: dc-motor, active-buzzer (mine); 74HC595, L293D, ADC0834, relay module, keypad, joystick, HC-SR501 (Sonnet subagent, 136 tests, 13 mutations each caught); DHT11, HC-SR04, SG90, LCD1602 (PCF8574 + HD44780), ADS1115, ADS7830 (Sonnet subagent, 107 tests). `circuit.test.ts`: all 38 parts build and solve. Relay polarity settled: S high energises (SunFounder module page and Davinci lesson 1.3.4; the Basic kit page's comments contradict its own prints). Integration test: GPIO17 → relay → COM-NO lights an LED after the 10 ms operate time |
| 3.3 ngspice fixtures | done | `scripts/reference/ngspice_fixtures.py` → `core/sim/fixtures/ngspice.json` (ngspice 47). 23 fixtures, all within ±2%; `fit.ts` reproduces the parameters ngspice was given. **Finding:** ngspice floors diode IS at 1e-28 A; InGaN dies use N = 3 (ADR-0012) |
| session | done | `session.ts`: stimulus, behaviour fixed point (tolerance 1e-6), behaviour timers and listened PWM edges in time, PWM-averaged snapshots (exact over 2^n on/off states up to 4 pins). GPIO reads are low/high/ambiguous/**floating** (Thévenin resistance × the 3 µA max input leakage > VIL) |
| sim ERC | done | `checks.ts`: PIN_OVERCURRENT (16 mA), RAIL_BUDGET (50 mA all GPIOs), LED_NO_LIMIT current vs `ifMaxMa`. No 3V3/5V limit is invented (ADR-0014) |
| 3.4 probe-signature mode | done | `probe.ts`: bias test at both ends of the pull range; pair test as a transient from precharge with a 10–100 pF node range and 100 µs settle (ADR-0013); skips by pin role with reasons; observability. 9 hand-worked tests incl. SPEC 14.5's own example (tied-high released, tied-low pressed, follows-bias one row off), LED path unobservable, GPIO2 tied-high from the board pull-up. Mutation check: replacing node capacitance with nothing fails the isolated-net test. 26-pin prediction in the worker: 94 ms on the button sample |
| 3.5 sim.worker + Workbench | done | `workers/simHost.ts` (pure, tested) + `sim.worker.ts`; `state/simClient.ts`, `state/workbenchStore.ts` (zustand, no effects); `pages/WorkbenchPage.tsx`, `panels/ErcPanel.tsx`, `panels/SimPanel.tsx`. Two sample circuits in `content/samples/` (this app's own, not the kit's tutorials). Checked in Chromium against `vite` on localhost:5173: blink sample GPIO17 HIGH → 3.069 V, 5.49 mA, D1 lit; button sample GPIO18 reads low → high (held) → low; probe prediction GPIO18 tied-low observable, GPIO2/3 tied-high. `web:build` emits the worker as its own chunk |

M3 exit suite (2026-10-24, at 3f7d886):
- `cargo test`: 85 passed / 20 ignored. `live-tests.sh` not re-run: no Rust changed since the M2 run (19/19).
- `npm test`: node 7/7 + Vitest 817/817 (43 files). Lint 0 errors. Typecheck clean. `npm run build`: app bundled and signed.

Notes carried into M5 (Pyodide shims):
- I2C devices are transaction-level (`behavior.i2c`); after each transaction the session must settle (call `update`) so time-stamped behaviour (ADS1115 conversion start) uses the transaction time.
- The DHT11 counts its power-up wait from its first powered update: start sessions at t = 0.
- The kit's code is at https://github.com/lafvintech/Basic-Starter-Kit-for-Raspberry-Pi (from its "Download the Code" page); `python/ADCDevice.py` drives the ADS7830 at 0x48 with cmd 0x84.

## M4 correctness audit and verified content — done (2026-10-24)

| Task | Status | Verified / notes |
|------|--------|------------------|
| 4.1 inventory | done in M2 | `content/inventory.json` + test (checked against `PART_DEFS`) |
| 4.2 audit | done | `docs/v2/AUDIT.md`: a section per tutorial (26 shipped + LCD1602 held back), pins, depictions, other facts, README, and the D1–D18 register. Non-tutorial audit by a Sonnet subagent (81 rows); I closed its six open facts: the Live Monitor dropped output pins (pinctrl drive field), System Info read field names the agent never sends, GPIO cleanup was a no-op (now `pinctrl set <program's pins> ip pn` after Stop, pins 2–27), chip detection by label (gpiochip4→0 since Aug 2024), alternate functions named, temperature colours at the documented throttling points. README: an interim README states only what exists (full rewrite M12) |
| 4.3 tutorials | done | 26 tutorials by three Sonnet subagents + the exemplar; 13.1 checks green (365 tests incl. the cross-check). **LCD1602 not shipped**: the 5 V backpack's pull-ups put ~3.8 V on GPIO2/3 and the PCF8574's 3.5 V VIH rules out a 3.3 V bus; a safe build needs an I2C level shifter (no part). Its content is kept on local branch `held/lcd1602-tutorial` (not pushed). Notable kit conflicts recorded per tutorial: Active Buzzer and Relay text vs diagram/prints (followed the diagram and the module), Tilt Switch kit diagram grounds ID_SD, Morse kit diagram feeds the buzzer from 3V3 (below the 4 V minimum; used 5V0), Thermistor kit text inverts hot/voltage, Adjustable Fan's table lists seven GPIOs for a three-GPIO circuit |
| 4.4 steps | done | `core/steps/steps.ts`, 13 golden tests |
| 4.5 retire SVG | done | Breadboard page, SVG renderer and `data/tutorials.js` removed; Tutorials page shows verified content; `content/tutorials/regressions.test.ts` guards D6–D13 (33 tests) |
| 4.6 cross-check | done | `src/renderer/src/audit.test.ts` green |

Decisions this milestone: ADR-0015 (collisions are ERC warnings), ADR-0016 (tutorial code is written for this app; the kit's code is GPL-3.0 at lafvintech/Basic-Starter-Kit-for-Raspberry-Pi and this repo has no license, so nothing is copied).

Core fixes found while building M4: `codePins` counts `SMBus(1)` as I2C use of GPIO2/3 (a10d20a); floating detection uses a bounded 1 V / 1 GΩ probe, since the 1 nA probe failed to converge on a floating node beside a diode (091c59f).

README: SPEC schedules the rewrite for M12, but M4's exit needs zero open findings, so the false claims the audit lists get corrected at M4 and the full rewrite stays in M12.

M5 groundwork in the working tree (not committed until M4 is pushed): `pyodide@314.0.7` (exact), Vite plugin serving and emitting `/pyodide/*`, `workers/bridge.ts` (virtual time, 5 µs per call), shims in `workers/python/` (RPi.GPIO, gpiozero subset, smbus/smbus2 with Linux errno 121, time prelude), `workers/python.ts`, `workers/codeCheck.ts` (+ test: runs each tutorial's code per assertion; blinking-led passes, and a mutation that never drives LOW fails), `workers/pyodide.worker.ts`. ADR-0017 to write with the commit.

## M5 code in the loop — done (2026-10-24)

| Task | Status | Verified / notes |
|------|--------|------------------|
| 5.1 Pyodide + shims | done | `pyodide@314.0.7` from npm, served/emitted at `/pyodide/` by a Vite plugin; RPi.GPIO, gpiozero subset, smbus/smbus2 shims on `workers/bridge.ts` in virtual time (ADR-0017); `python.test.ts` (8) incl. Linux errno 121, EOF stdin, a late stop not leaking into the next call |
| 5.2 compile check + Run in Sim | done | Workbench Code panel (editor via callback ref, no effects), Check → line/column diagnostics, Run in Sim (real time, 10×, max) with Stop through Pyodide's interrupt buffer and part inputs through shared memory; checked in Chromium (Blinking LED at real time ≈ one line per 0.5 s, D1 5.79 mA, Stop → done; a syntax error → "line 1, column 8: expected ':'"). `codeCheck.test.ts`: each tutorial's own code drives every code-driven assertion: 134 of 157 assertions across 26 tutorials; the other 23 are circuit facts (`"code": false`) under stimuli the program never sets. All pass in ~4 s |
| 5.3 project-level Run on Pi | done | `state/runStore.ts`: upload to `/tmp/gpio_dashboard/project_<id>.py`, run, kill on Stop, then `pinctrl set <program's pins> ip pn`; ERC errors open an override dialog; the Tutorials page uses the same path. `runStore.test.ts` against a mocked native layer (D14 run part). On-Pi checks are in `HIL_CHECKLIST.md` (PI_HOST unset) |

Simulator speed found on the way: an event-free `advanceTo` only moves the clock, and input readings are cached between settles (044edf4); without it, polling loops solved the circuit twice per 5 µs call.

M4 + M5 exit suite (2026-10-24, at 4f98426):
- `cargo test`: 86 passed / 20 ignored. `live-tests.sh`: 19/19.
- `npm test`: node 7/7 + Vitest 1427/1427 (51 files, including every tutorial's code checks). Lint 0 errors (35 warnings). Typecheck clean. `pi-agent` unittest OK. `npm run build`: .app and .dmg.

Open threads:
- LCD1602 tutorial waits for an I2C level-shifter part (branch `held/lcd1602-tutorial`, local only).
- HIL items in `docs/v2/HIL_CHECKLIST.md`.
- Theory templates have no arithmetic, so derived values (a divider's ratio) are written out in a few theory files.

## M6 Board Sense — done (2026-10-24)

Protocol (fixed; agent and app build to it): app → agent `sense_start {config:{pins,settleUs,periodMs}}`, `sense_stop`, `sense_pause` (agent replies `sense_paused` once every line is released), `sense_resume`; agent → app `sense_sweep {data:{t,pins,skipped,bias:{pin:{up,down}},pairs:{a:{up:{b:0|1},down:{b:0|1}}}}}` with raw levels only, `sense_event {data:{kind:'error',message}}`. The agent only measures; all interpretation is in `core/sense`.

| Task | Status | Verified / notes |
|------|--------|------------------|
| 6.1 sense.py | done | 875e6ca (Sonnet subagent, reviewed): bias and pair sweeps, raw levels only; every LineSettings is built in one place as an INPUT with pull-up, pull-down or disabled bias; GPIO0/1, pins outside 2–27, alternate functions, gpiod consumers and (a618e2c) pins left as outputs are skipped; lines released at the end of every sweep and on pause/stop/error/disconnect before `sense_paused`. 52 fake-gpiod tests. `agent.rs` deploys sense.py; a test checks every non-test .py is deployed. 31c6801: install.sh asked apt for `python3-gpiod`, which exists nowhere (audit facts-11); it now installs `python3-libgpiod`, and gpiod 2 into a venv when apt's binding is 1.x (ADR-0019) |
| 6.2 transport | done | db7cdbe: `sense_start/stop/pause/resume` (pause waits ≤ 1 s for the ack, waiter registered before sending), `gpio:sense` (timestamp-only repeats dropped), `gpio:sense-event`; 4 new cargo tests (90 total) |
| 6.3 run waits for sense_paused | done | `state/runStore.ts` + `state/senseStore.ts`: with sensing on, Run on Pi pauses it and refuses to start without the ack within 1 s, then resumes; `runStore.test.ts` covers both |
| 6.4 reconciliation | done | c041f43 `core/sense/{sense,candidates,mockAgent}.ts`: states, settling over two sweeps, events, candidates ranked with ties. Tests on SPEC 18 fixtures 1, 3, 4, 5 (three faults, true cause in top 3), 6 (Blinking LED unobserved). Observability fixed: tied bias, or another GPIO following both up and down (ADR-0013) |
| 6.5 Board tab + walkthrough | done | `panels/BoardPanel.tsx` (Workbench Board tab): toggle (Pi or simulated board), net states, skipped pins, events, likely causes (sim worker), fixture walkthrough with generated steps, "Use as the twin" and recorded results; checked in Chromium against the mock (fixture 3 → GPIO18 matched; empty board → unobserved). Headless build-step confirmation `core/sense/buildSteps.ts` (confirmed / waiting / diverged / not electrically verifiable) |
| 6.6 presence spike | done (dropped) | ADR-0018: needs the Pi; not built; fixture 7 listed as not built |
| 6.7 HIL fixtures | done | `HIL_CHECKLIST.md` fixtures 1–7; 1–4 holes generated and checked by `core/sense/hil.test.ts` |

M6 exit suite (2026-10-24, at 31c6801):
- `cargo test`: 91 passed / 20 ignored. `live-tests.sh`: 19/19.
- `npm test`: node + Vitest 1450/1450 (54 files, including every tutorial's code checks). Lint 0 errors (35 warnings). Typecheck clean. `pi-agent` unittest 58/58. `npm run build`: .app and .dmg.
- Board Sense was never started against a real Pi (PI_HOST unset). The bench fixtures and the agent install are on `HIL_CHECKLIST.md`.

## M7 3D Studio and hero assets — in progress (2026-10-24)

94b1a34 pins the studio HDRI (Poly Haven Studio Small 09, 1k, CC0) in `scripts/assets/sources.json` and ships it as `public/env/studio_small_09_1k.hdr`. Download cache: `~/.cache/gpio-dashboard-assets/`.

GLB runtime contract (fixed in both lane briefs): `public/models/<name>.glb`, meshopt + KTX2; 1 glTF unit = 1 mm; glTF +Y up, so core (x, y, z) is three (x, z, −y); a breadboard's origin is its core local origin (row-1 end, column-a edge, top surface z = 0); the Pi's 40 header pins are not in pi5.glb and are instanced from `pi5-header.json`.

| Lane | Model | Scope | Status |
|------|-------|-------|--------|
| A1 assets | Opus subagent, worktree | 7.1 pipeline (sources, step-to-glb, Blender scripts, gltf-transform, manifests, colliders, `assets:build/check`, `--rebuild` SSIM) + bb-830, bb-400, pi5; ADRs as `ADR-A1-<n>` | running |
| B1 studio | Opus subagent, worktree | 7.3 WebGPURenderer via R3F, stage, IBL, post (GTAO, bloom, TRAA, DoF off), on-demand loop + frame counter; app-wide CircuitStore; GLB loading; hole picking/strip+net hover; camera presets; Playwright e2e; Tauri-window check; ADRs as `ADR-B1-<n>` | running |
| P physics core | Sonnet subagent, worktree | M8 8.1–8.3 pure TS XPBD in `physics/` with headless tests; merged only after M7 exits (milestone order) | running |
| M9 assistant core | Sonnet subagent, worktree | 9.1–9.2 | **done, held for merge after M8** on branch `worktree-agent-af1d36fa14f512c6d` (f899145, b1d7b82, 626fa57; worktree `.claude/worktrees/agent-af1d36fa14f512c6d`, local only, keep until merged). 205 assistant + 23 placer tests; full Vitest 1682 at its base; fuzz 570 runs ×12. 22 tools: 20 strict (API cap of 20 strict tools; holes as `"bb1:23e"`, props as `{name,value}` lists), 12 eager. ADR-M9-1…7 in its DECISIONS.md (renumber at merge). Reviewed loop.ts: imports only core/, native/anthropic, SDK, zod; applyOps/SimSession only in the test double. **At merge:** (1) fallback must drop eager first and keep strict (SPEC 12.4), then strict only if still refused; (2) pin `@anthropic-ai/sdk` exactly (it imports `_vendor/partial-json-parser`); (3) live-verify in 9.5 evals: top-level `cache_control`, strict+eager, 20-strict grammar size, SSE through the proxy; add a HIL/live line. **Core follow-ups it found:** `SetBuildStepAnnotations` op (annotate_build_steps is not undoable yet); custom part defs are not saved in `.gpiob`; `PartDefSchema` requires ≥1 source but ERC/`checkPartDef` accept none; `validateDoc` does not check part props |

Next after A1/B1: T-board, IDC, ribbon maps, Dupont housings, part families (follow A1's pattern); 7.4 drag-place/Properties/Labels; 7.5 overlays, LED glow, animated parts, Board Sense overlay; 7.6 drawer + projects gallery; 7.7 LOOKDEV.md.
