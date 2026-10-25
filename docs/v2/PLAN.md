# v2 Plan — Breadboard Studio

Source of truth: `docs/v2/SPEC.md`. Order is SPEC 19 and is not reordered:
correctness (M2–M5) → Board Sense (M6) → 3D Studio (M7+). State lives in
`PROGRESS.md`; decisions in `DECISIONS.md`.

Paths below are relative to `gpio-dashboard/` unless they start with `docs/`.
`R` = `src/renderer/src`.

Every milestone ends with the full suite: `cargo test`, `src-tauri/live-tests.sh`,
`npm test` (node + Vitest), `npm run lint`, `npm run typecheck`; plus, once they
exist, `npm run e2e`, golden tutorial tests and `npm run assets:check`. Then
commit and push `v2-breadboard-studio`.

---

## M0 Baseline and foundations
| # | Task | Exit check |
|---|------|------------|
| 0.1 | `docs/v2/BASELINE.md`: toolchain, suite results at 52639d9, dev launch, module map vs SPEC 17 | file committed; every number came from a run |
| 0.2 | Lint to green at the baseline (pre-existing failures), ADR | `npm run lint` exit 0 |
| 0.3 | TypeScript strict (`tsconfig.json`), `npm run typecheck` | `tsc --noEmit` exit 0 |
| 0.4 | ESLint TS + boundary rules: `core/`, `physics/` (no React/DOM/Tauri/window.api; physics ↛ state/assistant/native), `assistant/` (only core/, native/anthropic, own context) | rule fixtures fail as expected; a Vitest asserts the rules exist |
| 0.5 | Vitest wired into `npm test` next to `node --test` | `npm test` runs both |
| 0.6 | `docs/VERSIONS.md` (new deps + tools, incl. Blender 5.2.2 LTS, KTX 4.4.2, ngspice 47) | file committed |
| 0.7 | COOP/COEP in `tauri.conf.json` `app.security.headers` and Vite `server.headers`; CSP per SPEC 15 | `crossOriginIsolated === true` in dev and in a production build |
| 0.8 | WebGPU availability probe in the Tauri window (navigator.gpu + adapter info) → BASELINE.md | recorded from the real window |
| 0.9 | T-board geometry evidence: photo calibration + Adafruit prior → ADR | ADR in DECISIONS.md; numbers queued for `tboard.json` (M2) |

## M1 Native additions
| # | Task | Exit check |
|---|------|------------|
| 1.1 | `anthropic.rs`: path allowlist, header strip/inject, key-provider seam, Channel streaming, abort, `{code,message}` errors | cargo tests vs local mock server |
| 1.2 | Key commands `settings_set/has/clear_anthropic_key` (booleans only) | test: no command returns the key |
| 1.3 | `projects.rs`: list/read/write/delete, export/import via the dialog plugin from Rust | cargo tests (temp dir) |
| 1.4 | `ssh_i2c_scan(bus)` + i2cdetect parser | parser unit tests; live sshd test |
| 1.5 | `api.js` `anthropic`/`projects` namespaces, remove `ai`; `native/*.ts` wrappers | `api.test.js` updated and green |
| 1.6 | Remove `ai.rs`, OpenRouter settings/commands, AiChatPanel wiring; settings defaults `assistant.*` | builds; allowlist test |
| 1.7 | D17: no fixed run deadline; optional limit setting (off); kill on Stop/timeout | cargo + live sshd test |
| 1.8 | D18: WebSocket over a russh direct-tcpip tunnel to 127.0.0.1:8765; ws.rs send path | live sshd test with an agent bound to 127.0.0.1 |
| 1.9 | Ignored live proxy test (count_tokens, key from that process's env only) | runs when the key is loaded into that process |

## M2 circuit-core (`R/core`, `R/content`)
| # | Task | Exit check |
|---|------|------------|
| 2.1 | Model types (SPEC 5), zod schemas, constants with sources | typecheck |
| 2.2 | Board defs bb-830 / bb-400 (BB830, BB300/400 datasheets) | geometry tests (holes, strips, trench, rail groups/offsets); D1 |
| 2.3 | Pi 5 header table (official pinout) + electrical constants | header tests vs official docs |
| 2.4 | `tboard.json` (6-pitch rule, column pairs, label table, outline, provenance), ribbon, lead defs | T-board tests; D2 |
| 2.5 | Kit part defs from datasheets (batched) | pin-order tests per part |
| 2.6 | Ops, transactions, inverse, dispatcher, undo/redo | fast-check round trips |
| 2.7 | Occupancy, netlist (union-find), connectivity engine with typed diffs | event-diff tests per op; ≤1 ms budget test; D15 |
| 2.8 | Placement/collision rules, wiring-convention + gender validation | rule tests; D3, D4 |
| 2.9 | reach (LEAD_TOO_SHORT), ERC v1 with positive/negative fixtures per rule | ERC fixture tests |
| 2.10 | Serialization `.gpiob` + migrations | fixture tests |

## M3 Simulation
| # | Task | Exit check |
|---|------|------------|
| 3.1 | MNA (dense LU), NR with limiting/damping/gmin stepping, DC + transient (BE/trap) | unit tests |
| 3.2 | Device models (SPEC 9) incl. behavioural ICs | per-model tests |
| 3.3 | ngspice reference script + committed outputs | fixtures within ±2% |
| 3.4 | Probe-signature mode (bias, pair-test transients, pull range ADR) | hand-worked fixtures |
| 3.5 | `sim.worker.ts`; interim Workbench page with ERC + Sim/Probes panels | blink + button behave; Vitest |

## M4 Correctness audit and verified content
| # | Task | Exit check |
|---|------|------------|
| 4.1 | Inventory transcription (SunFounder component image, vision) → `inventory.json` | file + source |
| 4.2 | Audit every baseline tutorial, depiction, pins.js, hard-coded facts, README claims | AUDIT.md entry per item |
| 4.3 | Rebuild each tutorial/extra as `.gpiob` on d/h, header→row 0, wiring convention | 13.1 checks green |
| 4.4 | `core/steps`: wiring text, hole tables, build steps | golden tests |
| 4.5 | Retire SVG diagrams; Tutorials page shows audited content via Workbench | D6–D13 regressions |
| 4.6 | Audit cross-check script (every baseline item has an entry) | script green |

## M5 Code in the loop
| # | Task | Exit check |
|---|------|------------|
| 5.1 | Pyodide bundled locally, worker, RPi.GPIO / gpiozero / smbus2 shims, Atomics sleep, time scale | shim tests |
| 5.2 | Compile check + Run in Sim (Code panel) | each tutorial's code drives its assertions |
| 5.3 | Project-level, ERC-gated Run on Pi (override dialog) replacing tutorial-only run | e2e with mocked native layer; D14 (run part) |

## M6 Board Sense
| # | Task | Exit check |
|---|------|------------|
| 6.1 | `pi-agent/sense.py` + message types; fake-gpiod unit tests (never output, never bus-keeper, release between sweeps, pause/ack) | pytest green |
| 6.2 | ws.rs send path, `sense_start/stop`, pause/resume ack, `gpio:sense` dedupe; agent.rs deploys sense.py | cargo tests |
| 6.3 | Run on Pi waits for `sense_paused` (≤1 s) | test |
| 6.4 | Reconciliation state machine, observability rule, candidate ranking | core tests |
| 6.5 | Mock sense agent driven by core/sim; Board tab + fixture walkthrough | mock e2e on every bench fixture |
| 6.6 | Presence-sensing spike → keep/drop ADR | ADR |
| 6.7 | HIL_CHECKLIST.md bench fixtures with exact holes | file |

## M7 3D Studio and hero assets
| # | Task | Exit check |
|---|------|------------|
| 7.1 | Asset pipeline: sources.json, step-to-glb (occt-import-js), Blender scripts, gltf-transform, manifests, colliders, `assets:build/check` | clean rebuild; hashes + SSIM |
| 7.2 | Blender assets: breadboards, Pi 5 (STEP), T-board, IDC, ribbon maps, Dupont housings, part families | geometry coincidence tests |
| 7.3 | WebGPURenderer via R3F, stage, HDRI, shadows, post (GTAO, bloom, TRAA, DoF), on-demand loop | backend overlay in the Tauri window |
| 7.4 | Picking, drag-place with legality glow, strip hover, selection, Properties, camera presets, Labels | e2e |
| 7.5 | Voltages/Current overlays, LED glow, animated parts, Board Sense overlay | e2e |
| 7.6 | Workbench panels → Studio drawer; projects gallery/save/open | e2e |
| 7.7 | LOOKDEV.md side-by-sides (Tauri window vs photos) | checklist passes; D5 |

## M8 Real-time physics
| # | Task | Exit check |
|---|------|------------|
| 8.1 | XPBD core: particles, distance/bend/shear, long-range attachments, substeps, determinism | physics tests |
| 8.2 | Ribbon grid, Dupont rods, solid jumpers, clamped end frames | attachment ≤0.05 mm |
| 8.3 | Contacts (colliders, capsule–capsule, point–triangle, spatial hash, friction), islands, sleep | penetration ≤0.5 mm |
| 8.4 | Worker + SharedArrayBuffer double buffer; CPU vs TSL geometry ADR | budgets in the Tauri window |
| 8.5 | Route hints, settle-on-open, taut-lead feedback, live drag | drag e2e |

## M9 Assistant
| # | Task | Exit check |
|---|------|------------|
| 9.1 | Client with `nativeAnthropicFetch`; loop handling every stop_reason; caching; server tools | unit tests with mocked fetch |
| 9.2 | zod tools (strict, eager streaming), AssistantContext, `read_board_sense` | tool-contract + fuzz tests |
| 9.3 | Streaming ghosts → commit; Claude drawer, review strip, Stop | e2e replay |
| 9.4 | Settings: key, model, effort, web tools; transcripts; capture_view | e2e |
| 9.5 | Evals (≥10 prompts), live when the key is loaded into the eval process, else mock replay | scores recorded; D14 (assistant + undo) |

## M10 Build Mode in the Studio
| 10.1 | Step UI: framing, ghosts, DoF; Board Sense confirmations; Fork to my projects | every tutorial plays through |

## M11 Hardware twin
| 11.1 | Live state in 3D, divergence badges (telemetry + Board Sense), checkpoints (I2C scan, press, Toggle LED) | HIL flows (real Pi if reachable, else mocks); HIL_CHECKLIST.md complete |

## M12 Polish and acceptance
| 12.1 | Visual pass, performance budgets, README rewrite (D16), `docs/ARCHITECTURE.md` | FINAL_REPORT.md with evidence for every SPEC 20 item; PR opened (not merged) |
