# GPIO Dashboard v2 (Breadboard Studio): final report

The closing report of the build carried out to [`SPEC.md`](SPEC.md). It is written for a reader who
did not watch the build. Every claim comes from the repository: the docs in `docs/v2/`, the tests,
and commands re-run for this report. Numbers that were re-run say so; numbers taken from a
milestone's recorded exit suite say that instead.

- Drafted: 2026-10-24 (EDT), on `v2-breadboard-studio` at `20b9ab8` ("docs(progress): M11 done, with
  its exit suite"). The build ran from 2026-10-23 22:39 EDT (first commit `fa8f0f2`) to 2026-10-24
  15:55 EDT (`20b9ab8`): 238 commits over `52639d9`, 815 files changed.
- Two M12 lanes were still running when this was drafted: the frame-rate lane (acceptance 9) and the
  docs lane (the README rewrite that closes D16, and `docs/ARCHITECTURE.md`). Where the result
  depends on them, this report states what the repository shows today and carries a double-bracket
  INTEGRATOR placeholder at that spot, to be replaced once the lanes have merged.
- The repository is public. No secret is in this report. The reference photos are not in the
  repository either (`docs/v2/reference/IMAGES.md` lists them by hash).

## How to read the statuses

- **Met**: every clause of the criterion was exercised by a test, a measurement or a recorded run in
  this repository, and the result is written down. What remains is about the environment, and is
  listed under "Assumed or unverified".
- **Partly met**: at least one clause was not exercised, or the evidence is thinner than the
  clause. The clause is named.
- **Not met**: the clause fails. None of the 18 items is in this state.

Anything that needs the real Raspberry Pi, the user's hands, or the Tauri window (WKWebView) and was
not run is not "Met". The end-to-end browser tests ran in headless Chromium with WebGPU on the Mac's
GPU (ADR-0028), which is the same app code in a different webview. They are never counted as a
Tauri-window run.

## At a glance

| | Result |
|---|---|
| SPEC 20 acceptance | 11 Met, 7 Partly met, 0 Not met (section 2) |
| Partly met items | 4 (D16 pending), 8 (Labels untested), 9 (60 fps), 10 (real Pi), 12 (real Pi), 15 (look-dev gaps), 16 (README findings) |
| Defects | D1 to D15, D17, D18 fixed with a named guard; D16 (README) waits on the docs lane (section 4) |
| Hardware work left for the user | 48 unticked items in `HIL_CHECKLIST.md` (section 5.1) |
| Decisions recorded | 126 ADRs, ADR-0001 to ADR-0126, contiguous (section 6) |

Test suites, re-run at `20b9ab8` for this report (commands and output in the appendix):

| Suite | Result |
|---|---|
| `cargo test` | 94 passed, 0 failed, 20 ignored (the live tests) |
| `src-tauri/live-tests.sh` | 19 passed, 0 failed (throwaway sshd on 127.0.0.1) |
| `node --test` (bridge) | 7 passed |
| `npx vitest run` | 113 files passed, 1 skipped; 2321 tests passed, 2 skipped (the `FULL_PROBE=1` opt-in) |
| `npm run lint` | 0 errors, 35 warnings |
| `npm run typecheck` | exit 0 |
| `pi-agent` unittest | 58 tests, OK |
| `npm run evals` (replay) | 12 prompts, 158 of 161 checks, same scores as the live recording |
| `npm run assets:check` | passed, 469 checks |
| Playwright e2e | 103 tests listed in 9 files; 10 re-run and passed, 2 skipped (no `PI_HOST`); the full run was last made at `fbae85e` (101 passed, 2 skipped) and was not repeated while the frame-rate lane measured |

## 1. What was built

The result is a Tauri 2 desktop app (Rust shell, React 19 front end) that models the user's bench:
two breadboard types, the Raspberry Pi 5, the SunFounder T-board and its 40-wire ribbon, Dupont
leads, and 38 kit parts, each as a cited datasheet definition, an electrical model and a Blender-made
3D model. A circuit document is the single source of truth; netlist, ERC, simulation, wiring text,
build steps, 3D scene and the AI assistant's edits all derive from it. The source is organised as
`core/` (model, ops, netlist, ERC, simulator, Board Sense, steps), `physics/`, `studio/` (the 3D
view), `workers/` (simulator, Python, physics), `assistant/`, `state/`, `panels/`, `native/`, plus
the Rust commands in `src-tauri/src/` and the Pi agent in `pi-agent/`. Exit-suite figures below are
the ones recorded in `PROGRESS.md` at that milestone's commit.

**M0 Baseline and foundations.** The baseline at `52639d9` was measured and recorded in
`BASELINE.md` (cargo 24 passed, live tests 15/15, node 7/7, lint red with 134 errors). M0 added
strict TypeScript, ESLint import-boundary rules for `core/`, `physics/` and `assistant/`
(`boundaries.test.ts`, 30 cases today), Vitest inside `npm test`, `docs/VERSIONS.md`, cross-origin
isolation and the CSP (ADR-0008: the production front end is served from a loopback HTTP origin),
a WebGPU probe in the Tauri window (adapter present in dev and production), and the T-board body
geometry from calibrated photos (ADR-0004). Exit: lint 0 errors, typecheck clean, cargo 30 passed,
live tests 15/15, Vitest 25.

**M1 Native additions.** A Rust Anthropic proxy (`anthropic.rs`: Channel streaming, abort, header
rules, path allowlist, key held in the Keychain and never returned), `projects.rs`, an I2C scan
command and parser, the typed `native/` wrappers, and removal of the OpenRouter assistant. D17 (no
fixed run deadline; an optional time limit kills the remote process) and D18 (the agent socket runs
through an SSH direct-tcpip tunnel to a loopback-only agent) were fixed here. Exit: cargo 85 passed,
live tests 19/19, Vitest 37; the proxy's count_tokens live test passed once with the key loaded
into that test process only.

**M2 circuit-core.** The document model and zod schemas; BB830 and BB400 boards; the Pi 5 header
generated from the official documentation by `scripts/reference/pi_header_from_docs.py`; the
T-board, ribbon and Dupont definitions; 38 part definitions with datasheet citations; ops with exact
inverses; the union-find netlist and connectivity engine; placement validation (holes, T-board
body, spans, footprints, trench, genders); reach; ERC v1 (16 rules); `.gpiob` serialization with
migrations; the single-writer `CircuitStore`. Exit: Vitest 491; the D1 to D4 and D15 regressions.

**M3 Simulation.** A modified-nodal-analysis solver with Newton limiting and gmin stepping, device
models fitted from one datasheet point per part (ADR-0012), 15 behaviour models for the modules and
ICs, 23 ngspice 47 reference fixtures held to 2%, a session with PWM-averaged snapshots and floating
detection, simulator-based ERC checks, the probe-signature mode Board Sense needs, the simulator
worker and an interim Workbench page. Exit: Vitest 817.

**M4 Correctness audit and verified content.** `AUDIT.md` (242 finding rows, a section per
tutorial, plus pins, depictions, hard-coded facts, README claims and the D1 to D18 register);
26 tutorials rebuilt as `.gpiob` documents on the bench's T-board placement (17 kit projects, 9
extras), with generated wiring tables and build steps; the SVG breadboard and old tutorial data
retired; D6 to D13 regressions. The LCD1602 tutorial is withheld (section 5.4). Exit with M5:
Vitest 1427.

**M5 Code in the loop.** Pyodide 314.0.7 with RPi.GPIO, gpiozero and smbus shims on the simulator in
virtual time (ADR-0017); a compile check; Run in Sim; and a project-level, ERC-gated Run on Pi that
replaced the tutorial-only path. Every tutorial's own code drives its assertions (134 of 157; the
other 23 are circuit facts).

**M6 Board Sense.** `pi-agent/sense.py` (bias and pair sweeps that only ever configure inputs and
release every line), the transport (`sense_start`, `sense_stop`, `sense_pause`/`sense_paused`,
`sense_resume`, `gpio:sense`), Run on Pi pausing sensing and refusing to start without the
acknowledgement, reconciliation and candidate ranking in `core/sense/`, the Board tab with the
fixture walkthrough, a mock sense agent, and the bench fixtures in `HIL_CHECKLIST.md`. Presence
sensing was dropped by ADR-0018. Exit: cargo 91, live tests 19/19, Vitest 1450, pi-agent 58/58.

**M7 3D Studio and hero assets.** A headless asset pipeline (Blender 5.2.2 LTS, gltf-transform,
KTX2; ADR-0020 to ADR-0024) that produces 46 GLBs (7 bench models and 39 part files; 10,570,432
bytes of the 40,000,000 byte budget; the Pi 5 is the official STEP at 195,000 triangles and
4,981,612 bytes). The Studio renders with three.js WebGPURenderer on an on-demand frame loop
(ADR-0026): picking, drag-place with a legality glow, strip and net hover, Properties, Labels,
Voltages, Current, LED glow, animated parts, the Board Sense overlay, the drawer and the projects
gallery. The look-dev pass is `LOOKDEV.md` (ADR-0065 to ADR-0067). Exit: the Blinking LED hand-built
with live ERC in e2e, `assets:check -- --rebuild` (556 checks), the D5 regression; Vitest 1573,
e2e 21/21.

**M8 Real-time physics.** A cable solver (ribbon as a centreline chain with rigid rows, leads as
rods, direct banded bending solve, contacts, islands and sleep; ADR-0060 to ADR-0064, ADR-0072 to
ADR-0081) in a worker behind a double-buffered SharedArrayBuffer (ADR-0068), route hints, settle on
open, and a frame-cost pass (ADR-0082). Exit: Vitest 1658, e2e 29/29, worker step 1.82 to 1.85 ms
mean in the Tauri window against a 4 ms budget, stop about 0.92 s after the last input. Recorded as
not met at exit: 60 fps on every drag of the heaviest tutorial (section 2, item 9).

**M9 Assistant.** An Anthropic client over the Rust proxy that reads the stream itself (ADR-0083),
22 tools (11 strict, 12 streamed eagerly after ADR-0105), ghosts that appear while a tool call's
input streams, the Claude drawer with a review strip and one-step "Undo all", custom parts and
step notes held in the document, key entry to the Keychain, redacted transcripts, and an eval
harness (`EVALS.md`). The first live run found seven problems; six were fixed (ADR-0105 to
ADR-0108) and the seventh (a fetched datasheet's cost) was documented. Exit: cargo 94, Vitest 2128,
e2e 35/35, 11 of 12 eval prompts at 100%.

**M10 Build Mode in the Studio.** Tutorials open as read-only templates and fork into projects; a
step player with camera framing, ghosts and DOM rings; step confirmation from Board Sense
signatures (ADR-0112, ADR-0116). Exit: all 26 tutorials (411 steps) play through Build Mode in e2e;
Vitest 2256 passed, 2 skipped; e2e 74/74. The Tauri window could not be looked at (the Mac session
was locked), so visuals were checked in headless WebGPU.

**M11 Hardware twin.** The Pi's live pins painted on the bench, four telemetry divergence kinds
held 600 ms, badges with explanation cards, Build Mode checkpoints (I2C scan, press the button,
toggle an LED through the ERC-gated run path on a click only), and one set of hardware-in-the-loop
flows that run on a mock Pi, or on a real one when `PI_HOST` is set (ADR-0120 to ADR-0126). Exit:
Vitest 2321 passed, 2 skipped; e2e 101 passed, 2 skipped; `HIL_CHECKLIST.md` lists everything that
needs the Pi or the user's hands.

**M12 Polish and acceptance.** In progress at the base commit. The frame-rate lane works on the
main-thread levers listed in ADR-0082; the docs lane rewrites the README (closing D16) and writes
`docs/ARCHITECTURE.md`; this report is the third item. [[INTEGRATOR: update after the M12 lanes]]

## 2. SPEC 20 acceptance, item by item

| # | Criterion (short) | Status | What keeps it from a plain "Met" |
|---|---|---|---|
| 1 | Every lead end is in a real hole or on a real header pin | Met | Bench seating of the T-board is the user's to confirm |
| 2 | Geometry and constants cited and tested | Met | A few assumptions recorded (below) |
| 3 | Every tutorial: ERC, assertions, wiring text, code pins | Met | 26 tutorials; the LCD1602 is withheld |
| 4 | D1 to D18 each guarded | Partly met | D16 (README) waits on the docs lane |
| 5 | Assistant ghosts before input completes; fuzzed | Met | Ghosts not watched on a live stream in the Tauri window |
| 6 | Parking-sensor eval ends ERC-clean | Met | Replay is a recording, not a new model call |
| 7 | Undo of an assistant turn is deep-equal | Met | |
| 8 | Hover in one frame; Labels, Voltages, Current | Partly met | Labels has no automated test |
| 9 | WebGPU in the Tauri window, 60 fps, idle zero | Partly met | 60 fps not shown on the heaviest scenes [[INTEGRATOR: update after the M12 lanes]] |
| 10 | Run on Pi works; ERC gates it | Partly met | Never run on a real Pi |
| 11 | Secrets and safety | Met | The Settings key field not used with a real key in the real window |
| 12 | Baseline suites green; features keep working | Partly met | Features proven against local sshd and mocks only |
| 13 | Cables physical in real time | Met | Tauri measurement is from M8 |
| 14 | Assets reproducible | Met | Clean rebuild last run at M7's exit |
| 15 | Look fidelity (LOOKDEV.md) | Partly met | Two rows pass on data only; side-by-sides not committed |
| 16 | Correctness audit complete | Partly met | README findings are review-guarded [[INTEGRATOR: update after the M12 lanes]] |
| 17 | Wiring convention | Met | |
| 18 | Board Sense | Met | Real-Pi behaviour is the user's to run |

### Item 1. No lead or wire end outside a real hole or header pin

**Status: Met.**

Evidence:
- A lead end is typed as a breadboard hole or an off-board module's connector pin
  (`core/model/types.ts`, `Endpoint`). No endpoint can name the Pi's header, so nothing can attach to
  it by construction.
- `validateDoc` (`core/ops/validate.ts`) rejects an occupied hole, a hole under the T-board body,
  a flexible part beyond its lead span, a rigid part off its footprint, an off-board module in a
  hole, and a wrong-gender end. Tests: `core/ops/ops.test.ts` (15, among them "allows one lead per
  hole, never in a T-board pin hole", "refuses holes under the T-board body and allows the edge
  column beside it", "keeps a flexible part within its lead span", "keeps off-board modules out of
  the holes"); `core/regressions.test.ts` D2 ("every T-board pin is in a hole");
  `core/geometry/tboard.test.ts` (14).
- All 26 tutorials pass `validateDoc` (`content/tutorials/tutorials.test.ts`, "is a valid placement
  on the bench"). `state/circuitStore.test.ts` ("rejects an invalid transaction and leaves the very
  same document in place") shows the store refuses an invalid document.
- The assistant cannot commit an invalid op (item 5).
- e2e `studio.spec.ts`: "a drag from the library glows green on free holes and red on taken ones"
  and "draws the bench, its parts and every lead end in its hole".

Assumed or unverified: that the physical bench matches the model. The 830 and 400 holes of the
breadboard models coincide with core's coordinates within 0.004 mm (`assets:check`), but whether
3V3 (pin 1) lands in column d with the T-board seated as the app shows, and whether a male Dupont
seats in column c beside it, are bench facts listed in `HIL_CHECKLIST.md` ("Bench geometry").

### Item 2. Geometry and electrical constants come from cited sources and are tested

**Status: Met.**

Evidence:
- The Pi 5 model is the converted official "no graphics" STEP. `pi5.manifest.json` carries the
  archive URL, its SHA-256 (`6841637b…`), the STEP's SHA-256 and the MIT licence text (ADR-0020,
  ADR-0021). `assets:check`: Pi 5 mounting holes within 0.002 mm, 195,000 triangles (limit 200,000),
  4,981,612 bytes (limit 8,000,000).
- The T-board uses the 6-pitch row spacing (15.24 mm) and the bench's d/h column pair (ADR-0004;
  `core/geometry/tboard.test.ts`, 14 tests; D2 regression). Its other values come from a calibrated
  photo measurement (`scripts/reference/tboard_photo_measure.py`, aspect 1.0022, about 0.2 mm
  read-out error) against the Adafruit T-Cobbler prior.
- Breadboards: BB830 datasheet values (`core/geometry/breadboard.test.ts`, 15 tests); the GLB holes
  match core within 0.004 mm (830/830 and 400/400).
- Electrical constants: RP1 thresholds, pull resistances, drive limits from the official Raspberry Pi
  documentation (ADR-0009; `core/constants/rp1.test.ts`). Part models are fitted to one datasheet
  point each (ADR-0012) and held to the committed ngspice references (`core/sim/ngspice.test.ts`,
  42 tests; 23 fixtures within 2%). All 38 part definitions cite sources (`core/defs/parts.test.ts`
  and the four `batch-*.test.ts` facts tests).

Assumed or unverified (recorded in `DECISIONS.md`, and for the first four also in
`HIL_CHECKLIST.md`): 3V3 in column d and column c usability (ADR-0004); the box header's pin-1 end,
read from photo 5 (ADR-0037); how deep the ribbon's IDC socket sits in the shroud (5.08 mm from the
3M 891 sheet; ADR-0065); the pull-to-threshold ratio and node capacitance range of the probe, which
need calibration fixtures 2a to 2d (ADR-0013); PCB thickness 1.6 mm (assumed, ADR-0004); kit parts
with no named model use stand-in datasheets noted per part (ADR-0011); the BB400 datasheet's
dimension table does not reconcile and is not used; `reach` still uses an assumed 10 mm module pin
height (`ASSUMED_HEIGHTS_MM.modulePin`) where the Studio uses the model's.

### Item 3. Every tutorial: zero ERC errors, assertions pass, wiring text matches, code pins match

**Status: Met** for the 26 shipped tutorials.

Evidence:
- `content/tutorials/tutorials.test.ts` runs 313 tests over the 26 tutorials: valid placement, zero
  ERC errors, no `LEAD_TOO_SHORT`, code pins equal to the netlist's GPIOs, theory values taken from
  the document, and the generated wiring tables in `AUDIT.md` equal to what the documents produce.
- 157 simulator assertions in the `tutorial.json` files (counted by script);
  `workers/codeCheck.test.ts` (186 tests) runs each tutorial's own Python in Pyodide so that the 134
  code-driven assertions are driven by the program; the other 23 are circuit facts about stimuli the
  program never sets.
- Steps: 411 build steps over the 26 tutorials (counted with `buildSteps`);
  `core/steps/steps.test.ts` (15 golden tests); every tutorial plays through Build Mode in e2e
  (`build.spec.ts`).

Assumed or unverified: the simulator is the judge. None of the circuits was built on the bench. The
SPEC lists 27 tutorials (17 kit projects and 10 extras). The LCD1602 is not shipped because the 5 V
backpack's pull-ups put about 3.8 V on GPIO2 and GPIO3 and the PCF8574's 3.5 V input-high rules out
a 3.3 V bus; a safe build needs an I2C level shifter the kit does not have (`AUDIT.md`, lcd1602-1).
Its draft is on the local branch `held/lcd1602-tutorial`.

### Item 4. D1 to D18 each have a passing regression test or a verified fix (D16)

**Status: Partly met.** 17 of 18 have a named guard that passes today. D16 is the README. The
interim README replaced the false claims at M4; the full rewrite and its review belong to the docs
lane. [[INTEGRATOR: update after the M12 lanes]] Section 4 lists each defect and its guard.

### Item 5. The assistant builds with visible incremental ghosts and never commits an invalid op

**Status: Met.**

Evidence:
- `assistant/fuzz.test.ts` (3 tests, fast-check): random and malformed input through every tool and
  through the streaming loop; nothing throws out of the loop, the document stays valid, and a
  refused call changes nothing.
- e2e `assistant.spec.ts`, "builds a blinking LED from an empty project, ghosts first, and Undo all
  restores it": it records which ghosts the Studio had drawn while their tool call's input was
  still arriving and asserts all five parts and leads (calls t3 to t7) were.
- Real streams: in the live recording, across 12 runs, 428 partial `place_part` inputs and 534
  `connect` inputs arrived before their calls were complete, and 238 and 182 of them were enough to
  draw a ghost (`EVALS.md`; `npm run evals` prints these per run).
- The first live run found that the 20 strict tools exceeded the API's grammar budget, so every
  session had run without eager streaming. ADR-0105 fixed it (11 strict tools plus eager streaming
  on the 12 mutation tools); the second recording's first request was accepted with no fallback.

Assumed or unverified: ghosts on screen from a live stream in the Tauri window. The e2e streams are
recordings built to the documented event shapes (ADR-0099), the live recording ran the same loop on
real streams, and the Tauri window was looked at once with the dev replay (ADR-0097), before the Mac
session locked.

### Item 6. The parking-sensor eval ends ERC-clean with ECHO protected

**Status: Met.**

Evidence (live recording, 2026-10-24, `claude-opus-5-5`, effort high; replayed today by
`npm run evals` with identical scores):
- `parking-sensor`: 14/14 checks, one turn, ECHO divided down to GPIO24, at most 3.30 V on any GPIO
  net in a simulated measurement.
- `parking-sensor-direct` (asked to wire ECHO straight to a GPIO first): 15/15; `run_erc` answered
  `OVERVOLTAGE_GPIO` for the direct lead and the assistant built the divider in the same turn (34
  transactions, one undo group).
- The tutorial guard: `D12` in `content/tutorials/regressions.test.ts` and
  `scripts/assistant-evals/checks.test.ts` ("protects ECHO with a divider and keeps every GPIO under
  3.6 V").

Assumed or unverified: model behaviour is not deterministic. The replay re-scores a recording; it
does not call a model. A fresh live run costs about $0.90 for these two prompts
(`npm run evals:live -- --only parking-sensor,parking-sensor-direct`, key required; $0.43 and $0.46
in the recording).

### Item 7. Undoing an assistant turn restores a deep-equal prior document

**Status: Met.**

Evidence: all ten building eval runs end with `undo.all` passing under Node's strict deep equality,
and `undo-all` (two turns) restores the document after turn 1 when turn 2 is undone;
`state/circuitStore.test.ts` ("undoes a whole assistant turn back to a deep-equal document");
`assistant/customTurn.test.ts`; e2e `assistant.spec.ts` ends with
`expect(await appDoc(page)).toEqual(initial)` after "Undo all", code included;
`core/ops/ops.test.ts` "undo restores a strictly equal document after any sequence of edits"
(fast-check, 300 runs in the M2 record).

### Item 8. Hover highlights strip and net within one frame; Labels, Voltages and Current work in Simulate

**Status: Partly met.**

Evidence (re-run today in headless Chromium with WebGPU): `studio.spec.ts` "hovering a hole
highlights its strip and every wire end on its net within one frame" asserts the first frame drawn
after the pointer event already carries the highlight. `sim.spec.ts` turns Voltages and Current on,
presses Simulate, and asserts the LED lens lights, dashes run from 3V3 toward GPIO17 on both leads,
and the 3V3 net reads "3V3 3.30 V". Pressing a switch in 3D, the Nets list and the warning halos
have their own e2e tests.

Gap: the **Labels** toggle (`studio/labels.ts`, `panels/Inspect.tsx`) has no automated test, and
none of the e2e or look-dev captures is documented as having it on. It is untested rather than
known broken.

Assumed or unverified: all of this ran in Chromium, not WKWebView.

### Item 9. WebGPURenderer in the Tauri window, 60 fps, zero frames when static

**Status: Partly met.** [[INTEGRATOR: update after the M12 lanes]]

What the repository shows today:
- Backend shown in the overlay: the dev overlay has a "renderer" row; `studio.spec.ts` "the dev
  overlay shows the renderer backend" passes (it read "WebGPU" today, in Chromium).
- WebGPU on the Mac: `BASELINE.md` recorded `navigator.gpu` and an adapter in the Tauri window (dev
  and production). ADR-0025 and ADR-0082 report WebGPU in the Tauri window (WKWebView, WebGPU, M5
  Pro) during M7 and M8. WKWebView caps `requestAnimationFrame` at 60 Hz.
- Zero frames when static: `studio.spec.ts` "a still scene renders no frames, after a camera move
  too" passes (re-run today, Chromium); `studio/frameLoop.test.ts` ("renders SETTLE_FRAMES after the
  last moving frame, then stops"). The Tauri-window check of the overlay's "frames rendered while
  idle" row is a `HIL_CHECKLIST.md` item for the live-state mode.
- **At least 60 fps with physics awake and the full post stack: not shown on the heaviest scenes.**
  ADR-0082 measured it in the Tauri window by scripted drags, after moving to one geometry pass and
  a shadow map every second frame (draws per frame 452 to about 225). Medians were 55.3, 57.6 and
  55.9 fps on three heavy tutorials at load average 8 to 11 beside another app using 240% CPU, and
  the Blinking LED held 60 fps in half its runs. The GPU is not the limit (timestamp queries: a
  quarter of the pixels, AO off or bloom off moved fps within noise); the main thread's per-object
  cost in three's render path is. Levers not yet pulled when M8 closed: per-frame buffer churn,
  shadow casters (leads and small parts), a render bundle for the static boards, bloom off while
  nothing glows. The M12 frame-rate lane works on these.

Assumed or unverified: a quiet-machine measurement in the Tauri window. The Mac session was locked
during M10, which hides the WKWebView, and the M12 frame-rate lane brief still plans for headless
WebGPU if it stays locked, so later frame-rate work may be measured only there.

### Item 10. Run on Pi works for projects and tutorials; ERC errors block it unless overridden

**Status: Partly met.**

Evidence:
- `state/runStore.test.ts` (6 tests) against a mocked native layer: uploads to
  `/tmp/gpio_dashboard/project_<id>.py`, "is blocked by ERC errors until the user overrides them",
  kills the remote process on Stop then returns the program's pins to inputs, refuses a project id
  that could escape the script directory, and (Board Sense on) pauses sensing first and refuses to
  start without the acknowledgement.
- Live tests against a throwaway sshd (19/19 today):
  `stop_ends_a_running_tutorial_script_on_the_remote`,
  `a_run_that_hits_its_time_limit_is_killed_on_the_remote`,
  `closing_the_channel_alone_leaves_a_quiet_script_running`,
  `upload_round_trips_awkward_names_and_reports_failures`.
- e2e `hardware.spec.ts` "toggle the LED: ERC errors hold the run until the override dialog is
  answered"; `hil.spec.ts` runs the print-only run and stop against the mock Pi (3 mock flows
  passed today; the 2 real-Pi flows skipped because `PI_HOST` is unset).

Assumed or unverified: a run on the real Pi. `HIL_CHECKLIST.md` "Run on Pi" (3 items) and the
tutorial runs need the Pi: that `pinctrl set` runs without root after Stop, that a script blinks the
LED, and that the override dialog appears on a SHORT_SUPPLY document.

### Item 11. Secrets and safety

**Status: Met.**

Evidence:
- The key never reaches the webview and its commands never return it: Rust tests
  `commands::tests::no_anthropic_key_command_returns_the_key` and
  `anthropic::tests::the_key_never_appears_in_any_event`; the Settings field is uncontrolled and
  hands the value on once (ADR-0098); a message that looks like a key is refused
  (`state/assistantPanel.test.ts`, "refuses to send what looks like an API key"); e2e "the key goes
  to the Keychain only, and settings persist".
- The assistant has no hardware tool: `assistant/tools/contract.test.ts` ("has no tool that touches
  hardware"), the `AssistantContext` interface has no SSH, GPIO, terminal or Board Sense control
  member (`assistant/context.ts`), and the boundary rules forbid the imports (`boundaries.test.ts`).
- No secret in git, transcripts or reports: `.env` is ignored (`.gitignore:5`) and was never
  tracked (`git log --all -- .env` is empty). A scan of every tracked file found `sk-ant` only in
  test constants, redaction patterns, a UI placeholder and docs that name the pattern, and `git log --all -p` has no
  `sk-ant-` string of 40 characters or more. Transcripts are redacted in Rust
  (`projects::tests::a_transcript_never_holds_an_api_key`). Recorded eval fixtures are scrubbed and
  `scripts/assistant-evals/replay.test.ts` fails on any `sk-ant`, `authorization` or `x-api-key`
  content.

Assumed or unverified: typing a real key into the Settings field of the real app window and
reading it back from the Keychain. The e2e tests use a stand-in Keychain that logs only booleans,
and the Rust Keychain test (`keychain_distinguishes_missing_from_stored_and_replaces_and_deletes`)
passed in the live suite. Section 5.3 covers adding the key.

### Item 12. Baseline suites stay green; connect, deploy, telemetry, pinout, monitor, terminal, run/stop keep working

**Status: Partly met.**

Evidence (all re-run today): `cargo test` 94 passed, 20 ignored; `live-tests.sh` 19 passed;
`node --test` 7 passed; `npm run lint` 0 errors (the baseline had 134, greened by ADR-0003);
typecheck, Vitest and pi-agent suites pass. The live suite covers connect, key types, host keys,
exec, streaming, shells and PTY, upload, agent start and stop, reconnect, and the telemetry tunnel
against a local sshd; `pi-agent/test_gpio_monitor.py` covers the pinctrl parser behind the monitor;
`data/pins.test.ts` covers the pinout data.

Assumed or unverified: that those features work against the actual Pi and in the Tauri window. No
Pi was reachable (`PI_HOST` unset). The Pi-side install (the libgpiod 2 binding, ADR-0019), Live
Monitor output pins and System Info values are `HIL_CHECKLIST.md` "Pi agent and monitor" (4 items).

### Item 13. The cables are physical in real time

**Status: Met.**

Evidence:
- Vitest: `physics/cables.test.ts` (35 tests) and `physics/sleep.test.ts` (13): in-span leads stretch
  at most 1% and the ribbon 0.5%; clamped ends stay within 0.05 mm of their frames; penetration at
  most 0.5 mm for a lead over a part, a pile of leads, lead over ribbon, ribbon over the breadboard
  edge and the T-board dragged across the board; an island sleeps within 2 s and wakes on an anchor
  change; identical inputs give identical states.
- e2e `physics.spec.ts` (8 tests): opening settles the cables offscreen; dragging the Pi, a board,
  the T-board, a module and a lead end makes the cables follow and re-settle; the scene stops
  drawing within 2 s of the last input; the deepest penetration measured from the worker's positions
  is at most 0.5 mm. Green at the M8, M9, M10 and M11 exits.
- In the Tauri window at M8: the worker's step was 1.82 to 1.85 ms mean (budget 4 ms) and the scene
  stopped about 0.92 s after the last input (PROGRESS, M8).

Assumed or unverified: the Tauri-window timings are from M8. Later changes were checked in headless
Chromium only. How the cables feel under the user's hand is theirs to judge.

### Item 14. The assets are reproducible

**Status: Met.** The clean-rebuild leg was last run at M7's exit.

Evidence:
- `npm run assets:build` regenerates every GLB headlessly from committed scripts
  (`blender -b --factory-startup -P …`) and pinned sources (`scripts/assets/sources.json`, SHA-256
  checked, cached in `~/.cache/gpio-dashboard-assets/`). Each GLB has a manifest with the script
  hashes, tool versions and source hashes.
- `npm run assets:check` passed today: 469 checks over the 46 GLBs, including 46 geometry hashes,
  830/830 and 400/400 breadboard holes, Pi 5 and T-board mounting holes, dimensions, contacts, and
  the budgets (all models: 10,570,432 bytes of 40,000,000).
- `assets:check -- --rebuild` at M7's exit (`3481182`): 556 checks, geometry hashes exact, texture
  SSIM 0.99 or better. `git log 3481182..HEAD -- src/renderer/public scripts/assets` is empty, so no
  asset or asset script has changed since.
- `content/models.test.ts` (49 tests) guards the committed models inside Vitest.

Assumed or unverified: the rebuild was not repeated for this report (about six minutes of Blender;
it was left out to keep the machine quiet for the frame-rate lane). The texture SSIM clause runs only
under `--rebuild`. A rebuild on a clean machine downloads the pinned sources (Pi 5 STEP, HDRI,
Adafruit STEP files) and needs Blender 5.2.2 and KTX-Software 4.4.2.

### Item 15. Look fidelity

**Status: Partly met.**

Evidence: `LOOKDEV.md` has 30 checklist rows; 29 read "pass 2026-10-24" and one (D1, Dupont
housings) passes for the housing only. The captures in `docs/v2/lookdev/` (10 PNGs) are the Tauri
window's own, 900 px wide with the overlay hidden, and the pairs table names the reference photo for
each. Fixes came from ADR-0065 to ADR-0067; the ribbon and Dupont drape rows (R4, D3) passed after
the physics work (ADR-0078, ADR-0079).

Gaps:
- D1 (male pin and female mouth) and D4 (lead length) pass on `assets:check` measurements and data;
  no Studio view shows them.
- R2: at the Pi end, the brown edge away from the Ethernet and USB ports follows from ADR-0049's
  placement and was not re-read in a capture.
- The committed images are the app's half only. The reference photos are vendor images in a public
  repository, so no composite is committed; the comparison was made by reading both with vision.
- The look-dev pass was on the render pipeline of 2026-10-24 08:38 EDT. ADR-0082 later changed the
  render path (one geometry pass); it measured a mean pixel difference of 0.3 of 255 on the Blinking
  LED in the Tauri window, and nothing was retaken after that.

### Item 16. Correctness audit

**Status: Partly met.** [[INTEGRATOR: update after the M12 lanes]]

Evidence:
- `AUDIT.md` has 242 finding rows (sections for the 26 rebuilt tutorials, the pins, depictions,
  hard-coded facts, README claims, and D1 to D18). `audit.test.ts` (52 tests) checks that every
  rebuilt and every baseline tutorial has a section, that D1 to D18 are registered, that every row
  has eight columns, a source and a guard, and that no row is open or scheduled. Statuses: 192
  Fixed, 26 Correct, 20 Replaced, 3 Holds, 1 pointing to the README section (D16). 11 rows are
  severity "Unsafe for hardware"; each is Fixed or Replaced (the LCD1602's is Fixed by retiring
  the tutorial).
- Order: the audit was complete before 3D work. The last tutorial, depiction and fact findings were
  closed by `013b171` (2026-10-24 02:23 EDT); the first 3D asset commit is `94b1a34` (04:09 EDT)
  and the first renderer commit `7267768` (05:26 EDT). Two later edits to `AUDIT.md` are `31c6801`
  (04:06, one row for the Pi install fix) and `6bbfe5e` (13:47, D14 marked fixed once the assistant
  existed).

Gaps (found by checking the table against the criterion's wording):
- Of the 242 rows, 9 README rows name "Review in M12" as their guard and 7 more README rows
  (readme-15, -16, -21, -22, -23, -26, -27) name none; the README rewrite is what verifies them. The
  underlying System Info defect behind readme-16 is facts-8, whose guard is a code change with no
  test of its own (HIL: "System Info shows real values").
- D4 and D6 have no external source (the source cell is a dash); they are internal defects.
- `audit.test.ts` accepts "None" as a non-empty guard cell, so it does not enforce a passing test for
  every row.

### Item 17. Wiring convention

**Status: Met.**

Evidence: leads between holes must be male-male and a module with male header pins takes male-female
(`core/ops/ops.test.ts`, "wiring convention: lead ends mate by gender"); no endpoint can name the
Pi header (item 1); `scripts/assistant-evals/checks.test.ts` runs `conventionProblems` on all 26
tutorials (no part leg in a T-board strip, every Pi net reached by a lead ending in the T-board
strip, genders right) and the harness runs it on every eval build (no run broke it).

### Item 18. Board Sense

**Status: Met** against the mock sense agent. Real-Pi results are the user's, as the criterion says.

Evidence:
- Twin events: `core/netlist/engine.test.ts` (7 tests) checks hole-exact events for insertion,
  removal, merge and split, and "recomputes and diffs a net-splitting removal in under a
  millisecond" (median of warm runs on a full BB830 scene; the test allows two retries because
  wall-clock timing shares the machine with the suite's workers).
- Mock agent: `core/sense/sense.test.ts` covers fixtures 1, 3, 4 and 6 and three injected faults on
  fixture 3 (the lead one row off, the pull-up lead missing, the ground lead on the wrong rail), each
  ranking the true cause in the top 3; ties; a change reported only after two sweeps; a one-sweep
  blip ignored; the Blinking LED unobserved. `core/sim/probe.test.ts` (9) holds the hand-worked
  signature predictions; `core/sense/hil.test.ts` checks the generated hole tables in
  `HIL_CHECKLIST.md`.
- Pi agent: `pi-agent/test_sense.py` (52 tests, fake gpiod): no request or reconfigure is an output,
  bias is always up, down or off, lines are released before `sense_paused` and between sweeps, pause
  at any step leaves nothing held, pins 0, 1, out-of-range pins and pins left as outputs are skipped.
- Run on Pi waits for `sense_paused` (`state/runStore.test.ts`); the coding agent never turned
  sensing on against a Pi, and `AssistantContext.boardSense()` is read-only.
- The fixture walkthrough is in the Board tab, with exact holes in `HIL_CHECKLIST.md`.

Assumed or unverified: how a real RP1 pad behaves (pull range, node capacitance, the settle time),
which fixtures 2a to 2d narrow; presence sensing (fixture 7) is not built (ADR-0018); a known hazard
for fixture 8 (PNP bases behind 1 kΩ on the 4-Digit 7-Segment) is open until a bench run.

## 3. Verified versus assumed

| Area | Verified, and how | Assumed or not run | Closed by |
|---|---|---|---|
| Circuit core: model, ops, netlist, ERC, steps | Vitest in Node (2321 tests today); fast-check undo round-trips | The bench matches the model: T-board seating, column d and c | HIL "Bench geometry" |
| Simulator | 23 ngspice 47 fixtures within 2% (42 tests); hand-worked solver and probe tests | Real part behaviour where datasheets are stand-ins (active buzzer minimum voltage, DHT-11 timing, relay polarity); RP1 pull and capacitance ranges | HIL "stand-in datasheets"; fixtures 2a to 2d |
| Tutorials | 26: ERC, 157 assertions, code pins, generated wiring, 411 steps in Build Mode | Building them on the bench | The user |
| Python in the loop | Pyodide shims in virtual time; every tutorial's code drives its assertions | RPi.GPIO and gpiozero on a Pi 5 (DHT-11 bit-banging untested) | HIL |
| Run on Pi, SSH, tunnel, agent | cargo 94 and 19 live tests on a loopback sshd; 58 agent tests | The real Pi: install, libgpiod binding, `pinctrl set` as the user, Stop returning pins | HIL "Pi agent", "Run on Pi" |
| Board Sense | 52 fake-gpiod tests; core reconciliation and ranking; mock-agent e2e | The real board, real pulls, the eight fixtures; presence not built | HIL fixtures |
| Hardware twin and checkpoints | `hardware.spec.ts` (20 tests) against a mock Pi; read-only real-Pi flows exist but skip without `PI_HOST` | Everything under HIL "Hardware twin" | HIL |
| 3D Studio | 103 e2e tests in headless Chromium with WebGPU; 101 passed at the M11 exit; 10 re-run today | The Tauri window for the M10 and M11 visuals (session locked) | Section 5.2 |
| Physics | 48 Vitest tests, 8 e2e flows; Tauri window at M8 | Tauri window after M8; the feel of a drag | Section 5.2 |
| Frame rate | Tauri-window medians 55.3, 57.6, 55.9 fps on three heavy scenes under load | 60 fps on the heaviest scenes on a quiet machine | M12 frame-rate lane [[INTEGRATOR: update after the M12 lanes]] |
| Assets | `assets:check` today (469 checks); `--rebuild` at M7's exit (556 checks) | A fresh rebuild now | Integrator |
| Assistant | Replay today (158 of 161 checks); live recording 2026-10-24; Rust proxy live test passed twice in the evals lane | A fresh live run; the `web_search` path (it has never run); the Settings key flow in the real window | Section 5.3 |
| Secrets | Rust and Vitest tests; history scan | The real Settings-to-Keychain flow with a real key | Section 5.3 |
| Look | Tauri-window captures at M7; the lane's reading of both images | The user's own eye; the final render path | Section 5.2 |
| macOS bundle | `npm run build` produced the .app and .dmg at each milestone exit | The production bundle was launched and read at M1's exit only | Section 5.2 |
| README and ARCHITECTURE | Interim README (73 lines) lists only what existed at M4 | Rewrite pending [[INTEGRATOR: update after the M12 lanes]] | Docs lane |

## 4. Defects D1 to D18

From the register in `AUDIT.md`. Every guard below passes at `20b9ab8` (Vitest, cargo and the live
suite all green).

| # | Defect | Status | Guard |
|---|---|---|---|
| D1 | Breadboard had 30 rows, not 63 | Fixed | `core/regressions.test.ts` "D1" |
| D2 | T-board pins drawn between holes | Fixed | `core/regressions.test.ts` "D2" |
| D3 | Rail endpoints resolved off the rails | Fixed | `core/regressions.test.ts` "D3" |
| D4 | Rails and circuit area in different coordinate frames | Fixed | `core/regressions.test.ts` "D4" |
| D5 | Parts drawn as six glyph types; unknown types vanished | Replaced: the SVG renderer is gone, every part has a datasheet body and a model | `content/parts/parts.test.ts` and the batch facts tests; e2e `parts.spec.ts` "every part definition draws a body on the bench or the table (D5)" |
| D6 | Default tutorial id `led_blink` did not exist | Fixed: the Breadboard page is gone | `content/tutorials/regressions.test.ts` "D6" |
| D7 | 10 of 18 diagrams drew no components | Fixed: wiring is generated from the document | "D7: %s places every part and draws its leads" (26 cases) |
| D8 | Buzzer circuit open, driven from a GPIO | Fixed: PN2222 with a base resistor | "D8" and the `active-buzzer` assertions |
| D9 | Button pull resistor in the wrong place | Fixed: the kit's pull-up, proven with internal pulls off | "D9" and the `button` assertions |
| D10 | RGB LED legs on non-adjacent rows | Fixed: one four-lead part | "D10" and the `rgb-led` assertions |
| D11 | 4-digit display had no digit-select lines | Fixed | "D11" and the `four-digit-seven-segment` assertions |
| D12 | HC-SR04 missing, ECHO unprotected (unsafe for hardware) | Fixed: ECHO through a divider | "D12"; `checks.test.ts` ECHO protection |
| D13 | Curriculum drifted from the kit | Fixed: the kit's 17 projects first, extras tagged | "D13" |
| D14 | Single-turn OpenRouter assistant, tutorial-only runs, no undo | Fixed: OpenRouter removed; project-level ERC-gated runs; the assistant commits every change as one undoable group | `anthropic::tests`; `state/runStore.test.ts`; `scripts/assistant-evals/replay.test.ts` (`undo-all`); `assistant/customTurn.test.ts`; e2e "builds a blinking LED from an empty project" |
| D15 | No netlist or connectivity model | Fixed | `core/regressions.test.ts` "D15"; `core/netlist/*.test.ts` |
| D16 | README overclaimed ("photo-realistic breadboard", "63-row", "18-project kit curriculum") | The interim README (M4) states only what existed then; it now understates the product. The full rewrite is the docs lane's. [[INTEGRATOR: update after the M12 lanes]] | Review (SPEC 18); 27 README rows in `AUDIT.md` |
| D17 | A fixed 120 s run deadline closed the output while the script ran on | Fixed: no deadline unless set; a limit kills the remote process | `commands::tests::a_run_has_no_time_limit_unless_one_is_set`; live `a_run_that_hits_its_time_limit_is_killed_on_the_remote` |
| D18 | Agent bound to loopback while the app dialled the Pi's address | Fixed: SSH direct-tcpip tunnel | live `the_agent_socket_runs_through_the_ssh_tunnel_to_a_loopback_only_server` |

## 5. Items left for the user

### 5.1 The Pi and the bench

`HIL_CHECKLIST.md` holds 48 unticked checkbox items. Record results in `docs/v2/hil/` (the folder
does not exist yet). Several items drive a pin: build only the parts an item names, and leave no
other part on the bench, because Board Sense's pull changes reach everything wired to a GPIO.

| Section of `HIL_CHECKLIST.md` | Items | What it settles |
|---|---|---|
| Bench geometry | 4 | 3V3 in column d; a male lead seats in c6; which end of the box header the brown ribbon conductor sits at; how deep the IDC socket sits in the shroud |
| Pi agent and monitor | 4 | Deploy installs with the libgpiod 2 binding (note the OS release); output pins show in the Live Monitor; gpiod enrichment finds the header chip; System Info shows real values |
| Run on Pi | 3 | A project runs and stops; Stop returns pins to inputs (`pinctrl set` without root); ERC errors block a run |
| Tutorials with stand-in datasheets | 3 | Active buzzer at 3.3 V against 5 V; DHT-11 pure-Python reads; relay polarity |
| Board Sense bench fixtures | 12 | Fixture 1 (empty board), 2a to 2d (calibration through 10, 47, 100 and 220 kΩ), 3 (pull-up and button), 4 (GPIO17 to GPIO27 lead), 5 (three faults on fixture 3), 6 (Blinking LED must read unobserved), 8 (watch the 4-Digit 7-Segment digits while sensing). Fixture 7 (presence) is not built |
| Hardware twin: automated flows on the real Pi | 1 | `PI_HOST=… npx playwright test e2e/hil.spec.ts` (reads only; none drives or probes a pin) |
| Hardware twin: live Pi state | 9 | Telemetry through the tunnel; outputs light the bench; pull changes; alternate-function naming; I2C-off badge; output-on-input badge; Board Sense badge; idle costs nothing; header pin visibility |
| Hardware twin: Build Mode checkpoints | 12 | I2C scan finds the module and names what is wrong; press the button, a quarter-turned button; press with a program running; Toggle LED (right and wrong LED, each circuit, ERC still gates it, Stop ends it, Board Sense pauses for it, nothing runs by itself) |

Safety notes from the docs:
- Before running Board Sense on the 4-Digit 7-Segment build, read fixture 8. GPIO5, 6, 12 and 13
  reach S8550 PNP bases through 1 kΩ, which the probe's pin-role skip does not see; a pull of about
  50 kΩ could turn a PNP on a little. If a digit glows, the skip rule must look through series
  resistors to transistor bases (ADR-0116).
- A Toggle LED checkpoint drives a pin as an output on a click. Never GPIO0 to GPIO3; at most three
  toggles per build (ADR-0124).
- The assistant and the coding agents never turn Board Sense on against the Pi. Only the user does,
  from the Board tab.

### 5.2 The Tauri window

The Mac session was locked during the M10 lane (`PROGRESS.md`), which hides the WKWebView, and the
M12 lane brief still allows for it. These were not looked at in the Tauri window and were checked in
headless WebGPU instead:
- The final frame rate on the heaviest tutorial scenes, on a quiet machine, with physics awake
  (item 9). [[INTEGRATOR: update after the M12 lanes]]
- Build Mode visuals: DOM pulsing rings, camera framing (at most 600 ms), the optional depth of
  field, the step ghost.
- The hardware twin's visuals: painted header pins and T-board strips, divergence badges and their
  cards, and the overlay's "frames rendered while idle" row staying at 0.
- Ghosts from a live assistant stream and the Claude drawer in the window. After the M9 dev replay,
  the window was not used for them again.
- Never seen by eye (from the lane notes): the rotation signs of the potentiometer, servo, relay,
  bar graph and matrix animations; stray text over the drawer's Code tab seen in one lane's Tauri
  shots; the cost of the LED lens's transmission material in the Tauri window.
- Launching the production bundle. The `.app` was built at every milestone exit but launched and
  read (origin, `crossOriginIsolated`, IPC) at M1's exit only.
- A re-look at the look-dev pairs (item 15) on the final render path.

### 5.3 The account

- **Web search is refused for the organization**: `400 invalid_request_error: Web search is not
  enabled for this organization`, and it comes and goes with the same key. The assistant drops the
  tool on the first request and goes on (ADR-0106). The effect is on the BMP280 datasheet prompt
  (11 of 14 checks; the failures are `datasheet`, `web-tools` and `mixed-turn`), and `web_search` has
  never run in any check. `web_fetch` works, but only for a URL already in the conversation, and a
  fetched datasheet costs about $0.45. This is a setting on the account side.
- **Adding the API key**: in the app, the Claude drawer's settings has a key field (uncontrolled,
  saved to the macOS Keychain, never shown again; ADR-0098). The evals use a different place: the
  main checkout's `.env` (or `--key-file`), read by the eval process only.
- Settings also holds the model (default `claude-opus-5-5`), the effort (default `high`) and the
  web-tools switch (applies from the next conversation).

### 5.4 Open threads

From `PROGRESS.md`, `DECISIONS.md` and `AUDIT.md`:
- **LCD1602 tutorial** waits for an I2C level-shifter part (the kit has none). The draft is on the
  local branch `held/lcd1602-tutorial`, not pushed.
- **Docs lane** (D16, `docs/ARCHITECTURE.md`) and **frame-rate lane** (item 9).
  [[INTEGRATOR: update after the M12 lanes]]
- **Per-pin currents** are not in the simulator's snapshot, so `studio/flow.ts` carries copies of
  `circuit.ts` formulas (ADR-0052); move them into core and delete the copies.
- **`ASSUMED_HEIGHTS_MM.modulePin`** (10 mm) in `core/reach` against the model pin heights.
- **Not yet drawn or modelled**: a 5-band resistor shows its 4-band reading; the LCD draws ASCII,
  arrows, yen and CGRAM only (no katakana); ghosts of custom parts defined in the same streaming
  batch are not drawn; rigid servo and keypad cables pass through boards; the keypad's keys cannot
  be pressed in `simulate` (text input).
- **Board Sense pin-role skip** does not look through series resistors to transistor bases
  (ADR-0116); fixture 8 decides.
- **Telemetry check not done**: a switch's orientation is not a continuous check; it is the press
  checkpoint (ADR-0122).
- **Theory templates** have no arithmetic, so derived values (a divider's ratio) are written out in
  a few theory files.
- **Documentation corrections** found while checking: `EVALS.md` says all 28 shipped tutorials pass
  the convention check, but the test iterates the 26 tutorials (28 was a count of directory
  entries); the lane's note of "3 skipped" e2e flows became 2 after the integrator removed the I2C
  scan from the real-Pi path (ADR-0126); the interim `gpio-dashboard/README.md` still says the 3D
  studio and the Claude assistant are not yet built.

## 6. ADR index

126 ADRs in `DECISIONS.md`, ADR-0001 to ADR-0126 with no gaps. ADR-0105 supersedes
the strictness decision of ADR-0084 and the fallback of ADR-0085. The list below was produced by a
script that reads the `## ADR-NNNN` headings of `DECISIONS.md`; its line count was compared with the
heading count.

- ADR-0001 Worktree inside the repository
- ADR-0002 Track `gpio-dashboard/package-lock.json`
- ADR-0003 Lint green at the baseline
- ADR-0004 T-board body geometry
- ADR-0005 KTX-Software installed per user
- ADR-0006 New React code avoids `useEffect`
- ADR-0007 TypeScript 6.0.3, not 7.x
- ADR-0008 Serve the production frontend from a loopback HTTP origin
- ADR-0009 RP1 GPIO electrical values come from the official Raspberry Pi documentation
- ADR-0010 The proxy also forwards `anthropic-workspace-id`
- ADR-0011 The kit's actual parts govern, where they differ from the spec's list
- ADR-0012 Simulator model parameters come from one datasheet point per part
- ADR-0013 Probe-signature ranges: pull resistance, node capacitance and settle time
- ADR-0014 RAIL_BUDGET checks only documented budgets
- ADR-0015 Overlapping part bodies are an ERC warning, not a rejected placement
- ADR-0016 Tutorial code and theory are written for this app, not copied from the kit
- ADR-0017 Code in the loop: Python and the circuit share one worker, in virtual time
- ADR-0018 Presence sensing is not built
- ADR-0019 The agent gets libgpiod 2 from apt on Trixie and from a venv on Bookworm
- ADR-0020 The Pi 5 model comes from the no-graphics STEP, read in parts
- ADR-0021 Pi 5 budget: the PCB and header base stay as modelled, the rest is decimated
- ADR-0022 KTX2 encoding goes through `ktx create`
- ADR-0023 The asset scripts run on Node's type stripping, with a resolve hook
- ADR-0024 Breadboard model: drafted recesses under one top-down texture set, sheen for ABS
- ADR-0025 GTAO feeds the ambient light through a normal and velocity pre-pass
- ADR-0026 The Studio renders on demand from a frame loop it owns
- ADR-0027 One app-wide CircuitStore; the Workbench opens into it
- ADR-0028 End-to-end tests run in headless Chromium on the GPU, on their own port
- ADR-0029 Every passive, switch, transistor and buzzer family is built in Blender, without textures
- ADR-0030 Part pins sit on the definition's grid; formed leads are part of the body
- ADR-0031 Animated nodes and value-driven materials
- ADR-0032 Part files go through the asset registry, in a parts/ folder
- ADR-0033 Studio gestures propose ops; circuitStore.check() judges them
- ADR-0034 The Workbench follows the app's document; code joins it on leaving the editor
- ADR-0035 Placing and moving by hand
- ADR-0036 Projects in the app data folder; tutorials stay templates
- ADR-0037 T-board model: shape values beyond tboard.json, and the box header's pin 1
- ADR-0038 IDC socket: a 3M 891 body seated on the header's rim, cable and bump on the key wall
- ADR-0039 Ribbon: two baked textures, a raised-cosine ridge, a lossless lookup
- ADR-0040 Dupont ends: housing detail as geometry, AO only
- ADR-0041 Textures-only assets, and the controller checks beside verify.ts
- ADR-0042 A lead's length is sold tip to tip; reach counts only its wire
- ADR-0043 The displays, ICs and modules are seven Blender families on the part registry
- ADR-0044 Off-board modules lie on the table with the definition's pin layout and a header on top
- ADR-0045 Two models come from Adafruit's STEP files; the others are drawn from their datasheets
- ADR-0046 The displays and the DIP follow their datasheet drawings, snapped to the board's grid
- ADR-0047 The bench and the parts are instanced per model file, with handles per copy
- ADR-0048 Where part bodies seat, and how their leads bend
- ADR-0049 Dupont housings mate by gender; the Pi's socket turns a quarter
- ADR-0050 The ribbon's design curve rises in a loop
- ADR-0051 Committed parts and lead ends seat over 150 ms; GPU resources go with the Studio
- ADR-0052 Lead currents are derived from the snapshot by Kirchhoff's law
- ADR-0053 The sim-driven visuals are one layer that writes through the part handles
- ADR-0054 A node's extra transform is in millimetres about the node's origin; a copy can have its own texture
- ADR-0055 The LCD draws the HD44780's display RAM into the module's screen quad
- ADR-0056 Inspect: toggles, the Nets list, and a read-only Board Sense overlay
- ADR-0057 Playing the circuit: switches in 3D, sliders in Properties, a pin menu
- ADR-0058 A part over its rating gets a halo and its issue in Properties
- ADR-0059 Modelling choices of the visuals
- ADR-0060 Rods and the ribbon centreline are solved as chains, not by Gauss–Seidel sweeps
- ADR-0061 The ribbon is a centreline chain with rigid rows
- ADR-0062 Contacts: exact segment tests, hash broad phase, no cable-to-cable friction
- ADR-0063 Islands, sleep and wake
- ADR-0064 Over-span: the flag follows the reach rule, the relaxation follows the span
- ADR-0065 The IDC socket plugs 5.08 mm into the box header, whose cavity is sized to its body
- ADR-0066 Tin dulls to a matt grey, the mask loses its glare, and the Pi's mask and USB shells match its photographs
- ADR-0067 The stage is neutral and lit from above; AgX is followed by a colour grade; bloom takes only what passes 2
- ADR-0068 The physics worker: scenes in by message, steps out through a double-buffered SharedArrayBuffer
- ADR-0069 Cable geometry is rebuilt on the CPU, not in a TSL vertex stage
- ADR-0070 How the bench becomes the solver's scene
- ADR-0071 Route hints pull while dragged and start the lead when committed
- ADR-0072 Contacts are solved in one canonical order, with the push on any particle capped
- ADR-0073 Sleep: speed over ten frames, sleepers woken only by moving bodies
- ADR-0074 Contact pairs carry their gap and the solvers skip what cannot touch
- ADR-0075 The ribbon's sheet is tested against boxes a strip at a time
- ADR-0076 Bending stiffness: leads 2 N mm^2, ribbon 50, and why not more
- ADR-0077 A lead's length is the wire between its housings
- ADR-0078 Bending is solved directly along each chain
- ADR-0079 Stiffness: leads 10 N mm^2 and the ribbon 400, from their copper
- ADR-0080 A particle a collider pushed is sixteen times heavier in the next substep's rod solves
- ADR-0081 Route hints weigh in the solve, pick their particle by reach, and pull only as far as the wire reaches
- ADR-0082 The Studio draws one geometry pass and redraws the shadow map every other frame
- ADR-0083 The loop reads the stream itself instead of using the SDK's message helper
- ADR-0084 Twenty of the 22 tools are strict, and strict-driven shapes differ from SPEC 12.5
- ADR-0085 Mutation tools stream eagerly, and a rejected first request retries with plain tools
- ADR-0086 Web search and web fetch run as direct calls
- ADR-0087 A conversation freezes its prefix and only grows
- ADR-0088 How a turn ends
- ADR-0089 `place_part` and `connect` resolve holes in a pure placer
- ADR-0090 A project's custom parts live in its document
- ADR-0091 A custom part may cite no source; a library part may not
- ADR-0092 Build-step notes: step keys, an op, and format 2
- ADR-0093 `validateDoc` checks part properties against the definition
- ADR-0094 A running turn owns the document, and a turn undoes as one group
- ADR-0095 The assistant simulates and runs Python in workers of its own
- ADR-0096 Ghosts are drawn into the shown document; the review strip reads the document's change
- ADR-0097 capture_view reads the frame it has just drawn
- ADR-0098 The key, the settings and the transcript
- ADR-0099 The drawer is tested through a stand-in for the native bridge
- ADR-0100 The evals run the app's own TypeScript in Node through Vite's module runner
- ADR-0101 A live run is kept as the API's side of the conversation, scrubbed, and replayed
- ADR-0102 The key is read by the process that uses it, and live runs use the app's client
- ADR-0103 How a run is scored
- ADR-0104 The evals measure the shipped core, fallbacks included
- ADR-0105 Eleven tools are strict, twelve stream eagerly, and a refused first request drops one flag at a time
- ADR-0106 A web tool the API refuses is dropped from the first request
- ADR-0107 A simulator input is a declared property, and a part with no model adds no devices
- ADR-0108 `signal.pause` waits in virtual time, and the gpiozero shim covers what the code reader knows
- ADR-0109 Build Mode draws a document derived from the circuit, and never writes to it
- ADR-0110 The step's holes are ringed by DOM elements, so a held step draws no frames
- ADR-0111 Framing, and depth of field as an option that is off until asked for
- ADR-0112 Step confirmation: signatures once per step, two sweeps to believe, a stricter "changed"
- ADR-0113 Progress is kept in browser storage, by project
- ADR-0114 Tutorials open as templates and fork as themselves
- ADR-0115 A hardware checkpoint has a place in the step, and it is empty
- ADR-0116 A step is confirmed by the pins its own change reads on, and its signatures are computed once
- ADR-0117 A probe that cannot converge reports a board it knows nothing about
- ADR-0118 `docUpTo` finds a step by its key
- ADR-0119 The full-probe check of the shipped tutorials is split over four files, and two tutorials are opt-in
- ADR-0120 Live Pi state is the telemetry store, seen through the connection
- ADR-0121 The bench is painted from the pins, and lit by a simulation of its own
- ADR-0122 Telemetry divergences: four kinds, held for 600 ms
- ADR-0123 Badges are buttons outside the orbit element, and open a card
- ADR-0124 A checkpoint hangs on the first step that completes what it checks
- ADR-0125 How a checkpoint runs: one click, and what it touches
- ADR-0126 One set of hardware-in-the-loop flows, on a mock Pi or a real one

## 7. Commands

Run from `gpio-dashboard/` unless stated. Tool versions: Node 26.12.1, npm 11.20.0, Rust 1.99.1,
Blender 5.2.2 LTS, KTX-Software 4.4.2, ngspice 47 (`docs/VERSIONS.md`, `BASELINE.md`).

| Task | Command |
|---|---|
| Install | `npm ci` (the lockfile is tracked, ADR-0002) |
| Run the app (dev) | `npm run dev` (`tauri dev`; Vite on `localhost:5173`; toggle the dev overlay with Cmd/Ctrl+Shift+D) |
| Front end only, in a browser | `npm run web:dev` |
| All JS tests | `npm test` (`node --test` bridge tests, then `vitest run`) |
| Vitest only | `npx vitest run` |
| Types and lint | `npm run typecheck`; `npm run lint` |
| Rust tests | `cd src-tauri && cargo test` |
| Live sshd tests | `cd src-tauri && ./live-tests.sh` (needs `/usr/sbin/sshd`; ports 2222 and 2223 on loopback; skips the Anthropic live test) |
| Pi agent tests | `cd pi-agent && python3 -m unittest` |
| End to end | `E2E_PORT=5391 npm run e2e` (default port 5193; `E2E_PORT` lets a second worktree run its own server; needs `npx playwright install chromium`). One file: `E2E_PORT=5391 npx playwright test e2e/studio.spec.ts` |
| HIL flows on a real Pi | `PI_HOST=<host> PI_USER=<user> PI_KEY=<key file> E2E_PORT=<free port> npx playwright test e2e/hil.spec.ts` (reads only) |
| Assistant evals, replay | `npm run evals` (no key, no network; `-- --only a,b`; `-- --rescore` records today's scores as expected) |
| Assistant evals, live | `npm run evals:live` (spends money; see the key rules below) |
| Proxy live test | `npm run evals:proxy` |
| Assets, rebuild | `BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender npm run assets:build` (optionally `-- bb-830 …`; about six minutes; `KTX_BIN` names `toktx` if it is not on PATH) |
| Assets, check | `npm run assets:check`; with a clean rebuild compared: `BLENDER_BIN=… npm run assets:check -- --rebuild` |
| macOS bundle | `npm run build` (`tauri build`). Output under `src-tauri/target/release/bundle/`: `macos/GPIO Dashboard.app` and `dmg/GPIO Dashboard_1.0.0_aarch64.dmg` (names from `tauri.conf.json` and `BASELINE.md`; notarization is skipped, there are no Apple credentials) |

Key rules for the evals (`EVALS.md`, ADR-0102):
- Replay needs no key. It reads recorded fixtures and fails if any contains `sk-ant`, an
  `authorization` or `x-api-key` entry, or an unscrubbed token.
- Live reads `ANTHROPIC_API_KEY` from the main checkout's `.env` (found through the git common
  directory) or from `--key-file <path>`. The key is held in that process's memory only. It is never
  put in `process.env`, printed or written to a file; output passes through a redactor.
- `evals:proxy` gives the key to the one ignored Rust test's process only. It never touches the
  Keychain.
- A full live pass costs money: the second recording was $2.29 for the 12 prompts plus $0.61 for the
  live checks. `-- --checks-only`, `-- --only a,b` and `-- --budget N` limit it. A coding agent
  should not run it without being told to.
- Never commit anything under `scripts/assistant-evals/` that did not go through the scrubber.

## 8. Blender MCP use

All 46 committed GLBs were built by headless Blender scripts. The pipeline starts Blender as
`blender -b --factory-startup --python-exit-code 1 -P <script>` (`scripts/assets/build.ts`), and each
asset's manifest records the script hashes, the Blender version and the source hashes. A clean
rebuild reproduces the geometry hashes exactly (item 14).

What the docs say about the Blender MCP server, in full:
- `SPEC.md` 3.3 and 10.3 make it optional: use it to explore looks in a live Blender session, port
  everything kept into the scripts, prove it with a clean headless rebuild, and never use its
  downloaders for generated or third-party models.
- `BASELINE.md` (pre-flight, 2026-10-23): an MCP server named `blender` was configured in the
  coding session, its offline tools (bundled API and manual search) loaded, but
  `get_objects_summary` returned "Cannot connect to Blender at localhost:9876". No live Blender was
  attached, and its tool set (`execute_blender_code`, `get_blendfile_summary_*`,
  `render_viewport_to_path`, `search_api_docs`) is not the ahujasid add-on's tool set that SPEC 3.3
  names. `PROGRESS.md` (pre-flight, step 5) repeats this.
- No later entry in `PROGRESS.md`, `DECISIONS.md`, `LOOKDEV.md`, `VERSIONS.md` or `AUDIT.md`, and no
  commit message, mentions using it. The asset ADRs (ADR-0020 to ADR-0024, ADR-0029 to ADR-0032,
  ADR-0037 to ADR-0041, ADR-0043 to ADR-0046, ADR-0065 to ADR-0067) describe script-built assets,
  and `scripts/assets/` contains no MCP dependency.

So the repository records no use of the Blender MCP server. It cannot show what the working
sessions of the individual lanes did with their own tools, only that nothing the build depends on
came from one.

## Appendix: numbers re-checked for this report

All run on 2026-10-24 (EDT) in a worktree at `20b9ab8`, after `npm ci`, on a machine with load
average about 7.6 from other lanes.

| Number | Command | Output |
|---|---|---|
| 94 passed, 20 ignored | `cd src-tauri && cargo test` | `test result: ok. 94 passed; 0 failed; 20 ignored` |
| 19 live tests | `cd src-tauri && ./live-tests.sh` | `test result: ok. 19 passed; 0 failed`, exit 0 |
| 7 bridge tests | `node --test "src/renderer/src/**/*.test.js"` | `tests 7, pass 7, fail 0` |
| 2321 tests | `npx vitest run` | `Test Files 113 passed \| 1 skipped (114); Tests 2321 passed \| 2 skipped (2323)` |
| lint | `npm run lint` | `35 problems (0 errors, 35 warnings)` |
| typecheck | `npm run typecheck` | exit 0 |
| 58 agent tests | `cd pi-agent && python3 -I -m unittest discover -s . -p 'test_*.py'` | `Ran 58 tests ... OK` |
| 103 e2e tests | `E2E_PORT=5391 npx playwright test --list` | `Total: 103 tests in 9 files` (assistant 6, build 39, hardware 20, hil 6, parts 7, physics 8, pi 3, sim 6, studio 8) |
| 3 Studio e2e | `E2E_PORT=5391 npx playwright test e2e/studio.spec.ts -g "dev overlay shows\|hovering a hole\|still scene"` | 3 passed; backend `WebGPU` |
| HIL and Pi e2e | `E2E_PORT=5391 npx playwright test e2e/hil.spec.ts e2e/pi.spec.ts` | 7 passed, 2 skipped (`PI_HOST` unset) |
| 26 tutorials, 157 assertions (134 + 23), 22 checkpoints, 17 kit projects | script over `content/tutorials/*/tutorial.json` | tutorials 26; assertions 157, code-driven 134, `code:false` 23; checkpoints 22; `kitProject` set on 17 |
| 411 build steps, 134 part instances, 251 leads | a temporary Vitest file calling `buildSteps` on every tutorial (deleted afterwards) | tutorials 26, steps 411, wires 251, parts 134 |
| 38 part definitions | `ls content/parts/*.part.json \| wc -l` | 38 |
| 313 / 186 / 52 / 33 tests | `npx vitest run --reporter=json`, per file | `tutorials.test.ts` 313; `codeCheck.test.ts` 186; `audit.test.ts` 52; `tutorials/regressions.test.ts` 33 |
| 242 audit rows | script applying `audit.test.ts`'s row pattern to `AUDIT.md` | 242 rows; 192 Fixed, 26 Correct, 20 Replaced, 3 Holds, 1 README pointer; 11 "Unsafe for hardware" |
| 126 ADRs | `grep -c '^## ADR' docs/v2/DECISIONS.md` and the generated index | 126; numbers 1 to 126 with no gap or duplicate |
| 48 HIL items | script counting `- [ ]` lines in `HIL_CHECKLIST.md` | 48, none ticked |
| 30 look-dev rows | `grep -cE '^\| (T\|U\|R\|B\|D\|P\|S)[0-9] \|' docs/v2/LOOKDEV.md`; the same minus `pass 2026-10-24` | 30; 1 (D1) not a plain pass |
| 469 asset checks, 46 GLBs, 10,570,432 bytes | `npm run assets:check`; `find src/renderer/public/models -name '*.glb' \| wc -l` | `assets:check passed`; 469 `ok` lines; 46 geometry hashes; `10570432 bytes in all (max 40000000)`; 46 GLBs (7 + 39 under `parts/`) |
| Pi 5 budget | same | `195000 triangles (max 200000), 4981612 bytes (max 8000000)` |
| No asset change since M7 | `git log --oneline 3481182..HEAD -- src/renderer/public scripts/assets` | empty |
| Eval replay | `npm run evals` | 12 prompts; per prompt 14/14, 15/15, 14/14, 15/15, 13/13, 13/13, 13/13, 15/15, 13/13, 12/12, 10/10, 11/14 (158 of 161) |
| Secrets | `git ls-files \| grep -i '^\.env\|/\.env'`; `git log --all -- .env`; `git log --all -p \| grep -cE 'sk-ant-[A-Za-z0-9_-]{40,}'`; `git grep sk-ant` | no tracked `.env`; empty history; 0; only test constants, redaction patterns and docs naming the pattern |
| 238 commits | `git rev-list --count 52639d9..HEAD` | 238 (815 files changed in `git diff --shortstat`) |

Not re-run for this report: the full Playwright suite, `assets:check -- --rebuild`, `npm run build`,
and anything that needs the API key or a Pi.
