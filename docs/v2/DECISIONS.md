# Decisions (ADRs)

Short records of choices made where the spec met reality. Each has context, options,
decision and consequences. Numbering is stable; superseded records say so.

---

## ADR-0001 Worktree inside the repository

- **Context.** The kickoff names `git worktree add ../GPIO-Dashboard-v2`, which creates a
  sibling folder next to the repository. The standing workspace rule is that worktrees
  live inside their project under `<repo>/.worktrees/<name>`, which `.git/info/exclude`
  already ignores.
- **Options.** (a) Sibling folder as written. (b) `.worktrees/v2-breadboard-studio`.
- **Decision.** (b). Same branch (`v2-breadboard-studio`) and base (`origin/main` at
  52639d9). Only the path differs.
- **Consequences.** Nothing appears beside the repository. The worktree is invisible to
  git status in the main checkout. Its `.codegraph/` index is ignored through the shared
  `info/exclude`.

## ADR-0002 Track `gpio-dashboard/package-lock.json`

- **Context.** At 52639d9, `gpio-dashboard/.gitignore` ignores `package-lock.json`, so a
  fresh worktree cannot `npm ci`. The baseline was installed from a copy of the main
  checkout's lockfile. v2 adds build-time tools whose output must be reproducible:
  gltf-transform, occt-import-js and Pyodide (SPEC 1.9, 10.3).
- **Options.** (a) Keep ignoring it; pin direct dependencies exactly. (b) Track the
  lockfile.
- **Decision.** (b). Remove the ignore line, and commit the lockfile from the first M0
  dependency change onward.
- **Consequences.** Transitive versions are pinned, so asset rebuilds and test runs are
  reproducible. The lockfile shows up in diffs when dependencies change.

## ADR-0003 Lint green at the baseline

- **Context.** `npm run lint` fails at 52639d9: 134 errors, of which 129 are
  `react/prop-types`; 174 Prettier warnings (BASELINE.md). SPEC 18 and 20.12 require lint
  to stay green, so it has to start green.
- **Options.** (a) Add PropTypes to every component. (b) Turn `react/prop-types` off: the
  code base uses no PropTypes, and new modules are strict TypeScript. Fix the five
  remaining errors by hand.
- **Decision.** (b). Prettier stays a warning, as configured. Files are not mass-reformatted.
- **Consequences.** Lint exits 0. The five real errors (`no-empty` ×3,
  `set-state-in-effect`, `no-unused-vars`) are fixed in place. Most `prop-types` hits
  were in components SPEC 17 replaces anyway.

## ADR-0004 T-board body geometry

- **Context.** SPEC 6.3: SunFounder publishes no drawing. `docs/v2/reference/tboard/`
  (bench measurements) does not exist. So the evidence is the calibrated reference photos
  (priority 2), with the Adafruit T-Cobbler Plus board file as the prior (priority 3).
- **Method.** `gpio-dashboard/scripts/reference/tboard_photo_measure.py` measures
  `T-Type Board - Bottom.jpg` (SHA-256 `82c741f4…3295`, docs/v2/reference/IMAGES.md):
  - The x scale comes from the 20 pads in each header row: 20.742 px/mm, max residual
    9.4 px.
  - The y scale comes from the 20 pin bases of one stem strip: 20.788 px/mm, max
    residual 2.6 px.
  - The aspect is 1.0022, so the shot is close to orthographic.
  - Read-out uncertainty is about ±0.2 mm on edges, plus about 0.3% on scale.
- **Measurements vs prior.**

  | Quantity | Photo | Adafruit prior | Listing | Used |
  |---|---|---|---|---|
  | Pin-row spacing | 15.27 mm (6.013 pitch) | 15.24 | — | **15.24 mm = 6 pitches** (holes are on a 2.54 grid; 6.013 confirms the integer) |
  | Stem width | 20.06 | 20.32 | — | **20.06** |
  | Pin-row → stem edge | 2.37 / 2.36 | 2.54 | — | **2.37** (stem symmetric about the pin rows; offset 0.01 mm) |
  | Top bar width | 57.71 | 58.42 | 59 | **57.7** |
  | Top bar depth | 13.57 | 15.24 | 14.5 | **13.6** (edge not cropped: verified on a crop of the top edge, where a trace runs just inside it) |
  | Overall length | 71.67 | 73.66 | 73 | **71.7** |
  | Header centre → pin 1 (along the stem) | 11.40 | 12.70 | — | **11.40** |
  | Top edge → header centre | 4.00 | 5.08 | — | **4.00** |
  | Header row spacing | 2.50 | 2.54 | — | **2.54** (grid) |
  | Pin 20 → stem end | 7.97 | 7.62 | — | **7.97** |
  | Mounting holes | 15.21 apart, 5.51 past pin 20, 2.46 from the stem end | 15.24 apart, 5.08 past pin 20, 2.54 from the end | — | **in line with the pin rows; 5.51 past pin 20; Ø2.5 (prior)** |
  | Header vs strip midline | 0.40 mm offset | 0 (symmetric) | — | **0** (within read-out error) |
  | PCB thickness | not measurable | 1.6 | — | **1.6** (assumed) |
  | Box header | — | outline ≈58.4 × 9.0 | DC3-40P 58.5 × 8.5 × 11.5; photo callout 11 mm tall | **58.5 × 8.8 × 11.2**; key slot on the long wall facing away from the stem (photos 3, 4, 6) |

- **Decision.** Use the photo values where the photo measures them, and the prior only
  where it doesn't (mounting-hole drill, PCB thickness). Where the listing disagrees
  (73 × 59 mm overall, 60 mm stem, 14.5 mm depth), the calibrated photo wins: the listing
  callouts are rounded, and one pair of them is wrong by 10× (SPEC 2.2). The
  pin-row-to-header relationship is SunFounder's own (11.40 mm, not Adafruit's 12.70).
- **Consequences on the breadboard** (default d/h, header toward row 0, pin 1 at row 1):
  - Columns e, f and g are under the stem in rows 1–20.
  - Columns c and i: the hole centre is 2.54 − 2.37 = 0.17 mm outside the stem edge. A
    2.54 mm Dupont housing there overlaps the PCB edge by about 1.1 mm at PCB height,
    matching the bench fact that leads seat in c with a slight lean. `tboard.json`
    carries `edgeColumnsUsable: true`.
  - The stem ends 7.97 mm past pin 20. Row 23's hole centre (7.62 mm) is 0.35 mm inside
    the outline, so rows 21–23 are blocked under the stem, and row 24 onward is free.
  - The top bar and box header overhang the row-0 end of the board by about 11.6 mm.
    Pin 1 is 15.40 mm from the top edge, and BB830 row 1 is about 3.81 mm from its end.
- **Open, for the bench** (HIL_CHECKLIST.md): confirm 3V3 (pin 1) is in column d; confirm
  a male Dupont seats in column c beside the T-board; optionally caliper the top bar
  depth, the overall length and the header-centre-to-pin-1 distance. Those three differ
  most from the prior.

## ADR-0005 KTX-Software installed per user

- **Context.** gltf-transform's KTX2 encoding needs `toktx` (SPEC 10.3). Homebrew has no
  formula or cask for it. The official macOS package installs into `/usr/local` and needs
  admin rights.
- **Options.** (a) Run the installer with sudo. (b) Fall back to WebP (SPEC 10.3 allows it
  by ADR). (c) Verify the official signed package, then unpack its payload into the user's
  home.
- **Decision.** (c). Install `KTX-Software-4.4.2-Darwin-arm64.pkg` (Khronos Developer ID,
  Apple-notarized) to `~/.local/opt/ktx-software-4.4.2/{bin,lib}`, and link `toktx` and
  `ktx` into `~/.local/bin`. The binaries find `libktx` through `@executable_path/../lib`.
- **Consequences.** KTX2 stays the texture format. The asset scripts look for `toktx` on
  PATH, or in `KTX_BIN` when set.

## ADR-0006 New React code avoids `useEffect`

- **Context.** A standing project rule forbids the `useEffect` hook in React components.
  Baseline components use it. v2 adds a lot of React: the Studio, panels and the
  Workbench.
- **Decision.** New and rewritten components don't use `useEffect`. Instead:
  - external stores through `useSyncExternalStore` (Zustand selectors already do this)
  - work triggered by events, inside the event handlers
  - DOM and three.js resource lifecycles through ref callbacks (React 19 cleanup
    functions) and R3F's `useFrame`
  - async loads through `use()` with Suspense

  Baseline components that are kept unchanged keep their existing hooks.
- **Consequences.** Side effects are tied to the event or element that causes them, which
  also keeps the on-demand render loop easy to reason about (SPEC 10.2).

## ADR-0007 TypeScript 6.0.3, not 7.x

- **Context.** "Latest stable" for TypeScript is 7.0.2, the Go-native compiler released
  2026-07-08. typescript-eslint 8.72.0, the latest, declares the peer range
  `typescript >=4.8.4 <6.1.0`. The SPEC 4.5 boundary rules have to parse `.ts` files
  through it.
- **Options.** (a) TS 7 for `tsc` and an unsupported TS for ESLint. (b) TS 6.0.3 for both.
- **Decision.** (b). TypeScript 6.0.3 is the newest release that typescript-eslint
  supports.
- **Consequences.** One compiler serves typecheck and lint. Revisit when typescript-eslint
  supports 7.x.

## ADR-0008 Serve the production frontend from a loopback HTTP origin

- **Context.** SPEC 13.2 sets COOP/COEP for SharedArrayBuffer, which the physics worker and
  Pyodide's blocking sleep both need. Measured in the real windows on 2026-10-23
  (macOS 27.2, the dev overlay):
  - **dev**, `http://localhost:5173`: `crossOriginIsolated` false at first. The cause was
    WebKit's HTTP cache. Vite's `server.headers` is missing from its `304 Not Modified`
    revalidations (checked with curl). `index.html` is `Cache-Control: no-cache`, so every
    load revalidates and keeps the cached headers from before isolation existed.
  - **production**, `tauri://localhost`: `isSecureContext` true and
    `crossOriginIsolated` true, but **`SharedArrayBuffer` undefined**. Reproduced outside
    Tauri: a Swift WKWebView harness serving the same headers from an `app://` scheme
    handler gives the same result, even with WebKit's private
    `processSwapsOnNavigationWithinSameNonHTTPFamilyProtocol` pool flag set. An http(s)
    document in the same harness gets SharedArrayBuffer.
  - Bare wry 0.57.1 and a plain WKWebView isolate `http://localhost` with every builder
    option Tauri uses. That ruled out the webview configuration for the dev failure.
- **Options.** (a) Accept no SharedArrayBuffer in production: no blocking sleep in
  Run in Sim, and a copy-based physics transport. (b) Private WebKit flags: tried, no
  effect. (c) Serve the embedded frontend over loopback HTTP in production.
- **Decision.** (c), plus a dev fix.
  - **Dev:** a Vite middleware sets the isolation headers on every response, 304s
    included (`vite.config.js`).
  - **Production:** `src-tauri/src/loopback.rs` binds `127.0.0.1:<ephemeral>` and serves
    only GET/HEAD for embedded assets. Each response carries COOP, COEP, CORP
    `same-origin`, Tauri's computed CSP, `Cache-Control: no-store` and `nosniff`.
  - The main window is created in `setup` (`create: false` in tauri.conf.json). It loads
    that origin and may navigate only within it.
  - A loopback origin is *remote* to Tauri, so app commands need ACL. `build.rs`
    declares them (`AppManifest::commands`), and `permissions/app-commands.toml` groups
    them. The local capability (dev) and a runtime capability scoped to the exact
    loopback origin grant the same set.
  - A cargo test keeps `generate_handler!`, `build.rs` and the permission set in step.
- **Consequences.**
  - Production: `crossOriginIsolated` true, `SharedArrayBuffer` true, IPC ok; dev: the
    same.
  - Any local process can read the frontend's assets over loopback. They're public in
    the repository anyway, and the IPC grant does not extend to other ports.
  - Every new command is added in three places, and the test fails until it is.
  - `app > security > headers` stays in tauri.conf.json, and a test checks that the
    loopback server sends the same values.
  - tokio gains the `net` and `io-util` features; no new crates.

## ADR-0009 RP1 GPIO electrical values come from the official Raspberry Pi documentation

- **Context.** SPEC 9 and 14.5 say no official source gives RP1's input thresholds or
  pull resistances. They fall back to JESD8C.01's 0.8 V / 2.0 V band and a pull range
  chosen by ADR. On 2026-10-23 the official documentation source does publish them:
  - Repository `raspberrypi/documentation`, branch master, commit `1bf32ac`.
  - File `documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc`.
  - Section "RP1 products": "voltage specifications for the GPIO pins on RP1-based
    products (Raspberry Pi 5, 500, and 500+)".
  - Values: V_IL max 0.8 V; V_IH min 2.0 V, max 3.3 V; I_IL max 3 µA; V_OL max 0.4 V;
    V_OH min 2.9 V.
  - I_OL / I_OH (min/typ/max) at drive strength 2, 4, 8, 12 mA:
    6.1/9.6/13.5, 9.2/14.3/20.2, 15.3/23.9/33.7, 18.4/28.7/40.5 mA (low);
    4.5/6.3/8.4, 6.8/9.5/12.6, 11.4/15.8/21, 13.6/19/25.2 mA (high).
  - R_PU 37/55/86 kΩ; R_PD 35/55/98 kΩ.
  - The same file also says: GPIO2/GPIO3 have fixed 1.8 kΩ pull-ups to 3.3 V; "An
    individual GPIO pin can supply up to 16 mA … all GPIO pins combined … a maximum total
    current of 50 mA"; pins "aren't 5 V tolerant".
  - Verified by reading the AsciiDoc source directly. The rendered page sits behind a bot
    challenge.
- **Decision.**
  - The probe-signature threshold band uses the official V_IL / V_IH. They equal
    JESD8C.01's values, which stays cited as the generic standard behind them.
  - Pull resistances are carried as the official ranges: pull-up 37–86 kΩ, pull-down
    35–98 kΩ, typical 55 kΩ. Every prediction is computed across the range (SPEC 9).
  - The calibration fixture (SPEC 18, bench fixture 2) still narrows the effective ratio on
    the actual Pi.
  - GPIO output resistance in the simulator comes from V_OH/V_OL and I_OH/I_OL at the
    configured drive strength.
  - Per-pin and total current limits for ERC use the 16 mA / 50 mA statement.
- **Addendum (2026-10-24).** The RP1 table gives no default drive strength. The RP1
  peripherals datasheet (RP-008370-DS-1, SHA-256 `87fb7b24…6c3d`), Table 21 (pad control
  register for GPIO0–27), gives the reset values: `DRIVE` = 0x1 (**4 mA**), `SCHMITT` = 1,
  `SLEWFAST` = 0, `OD` = 1 (output disabled), and `PUE`/`PDE` varying per pin. §3.1.3 lists
  pull-up, pull-down, bus-keeper and high-impedance pad behaviour. The simulator models a
  driven output as a Thévenin source: about 42 Ω high and 28 Ω low at 4 mA, i.e. the VOH/VOL
  margin over the typical I_OH/I_OL (`core/constants/rp1.ts`).
- **Consequences.** These numbers live in `core/constants/rp1.ts` with this source. The spec's
  "no official source" premise no longer holds for Raspberry Pi 5, and the code follows
  the official document. The leakage (≤ 3 µA) bounds how long an isolated net holds its
  precharge in the pair test (SPEC 14.5).

## ADR-0010 The proxy also forwards `anthropic-workspace-id`

- **Context.** SPEC 12.1 lists the request headers the proxy forwards: `anthropic-version`,
  `anthropic-beta` and `content-type`. The API overview
  (https://platform.claude.com/docs/en/api/overview, read 2026-10-23) lists
  `anthropic-workspace-id` as "Required with an API key that isn't scoped to a workspace",
  passed by the caller when the key needs it. `Authorization: Bearer <key>` is the primary
  credential, and `x-api-key` the legacy fallback.
- **Decision.** Forward `anthropic-workspace-id` too. It is not a secret, and the
  assistant (M9) sets it from a setting when one is configured. Authorization stays
  Bearer, as SPEC 12.1 says.
- **Consequences.** A key that isn't scoped to a workspace can still be used. The live
  proxy test (`live_count_tokens_through_the_real_proxy_path`, run 2026-10-23 with the key
  loaded into that test process only) returned 200 with `input_tokens`. So Bearer works
  for this key, and this key doesn't need the header.

## ADR-0011 The kit's actual parts govern, where they differ from the spec's list

- **Context.** The SunFounder component list image (`component_list.html`, `Basic_List.jpg`,
  SHA-256 `5799cd52a286ef0327295427df619711f528a4879f07ef709ea5cd5aaf04eda1`, transcribed
  into `content/inventory.json`) differs from SPEC 7's kit list:
  - Transistors are **PN2222** (×2; PN2222A on the buzzer pages), not S8050/S8550. The
    SPEC's D8 note ("the kit design uses an S8050 with a 1 kΩ base resistor") names the
    wrong transistor.
  - The ADC is an **ADS7830 I2C module**, not an ADC0834. The Potentiometer,
    Photoresistor and Adjustable Fan projects use it.
  - The kit's own leads are F-M ×10 and F-F ×10, plus a "65 Jumper Wire" set. The user's
    T-board kit adds M-M ×10 and M-F ×10, 200 mm.
  - Dot matrix: common-anode 788BS (project 1.1.3). 7-segment: common cathode (1.1.4).
    RGB LED: common cathode. SunFounder's components documentation states it ("We use
    the common cathode one"), and project 1.1.2's wiring agrees.
  - LED colours red, yellow, green, white, blue; the size isn't stated anywhere.
- **Decision.**
  - The library keeps every part SPEC 7 lists, so S8050, S8550, ADC0834 and ADS1115
    stay, tagged "not in kit".
  - It adds the kit's real parts: `pn2222` and `ads7830-module`.
  - Tutorials, and the assistant's inventory preference, use what the kit contains.
  - Where SunFounder's own pages disagree with each other, the page text that states the
    kit's part wins over code comments, and the conflict is recorded in the part's
    provenance notes.
  - The "65 Jumper Wire" set is recorded as kit inventory. Whether it is solid or flexible
    is not confirmed from the photo, so it gets no lead kind until it is.
- **Consequences.** M4's audit cites the kit's real part in every finding. The D8 fix uses
  the PN2222 with the kit's base resistor, not the S8050 the spec assumed.

## ADR-0012 Simulator model parameters come from one datasheet point per part

- **Context.** SPEC 9 asks for diodes and LEDs "with per-color parameters fitted to the
  datasheet Vf at the rated If", and BJTs "with the datasheet β".
  - A datasheet gives one typical (Vf, If) point per die. A Shockley diode with series
    resistance has three unknowns (IS, N, RS), so one point can't fix them all.
  - BJT datasheets give an hFE range at a test point, not one β.
  - ngspice 47 floors a diode's IS at 1e-28 A (`showmod` reports `is 1e-28` for a card
    that says 8.3e-30). With N = 2, a 3.3 V InGaN die fits to IS ≈ 1e-29, so ngspice
    silently simulates a different diode. That made the blue and white LED fixtures differ
    by 3.5%.
- **Decision.**
  - Diodes fix N and RS per family and solve IS so the curve passes exactly through the
    datasheet's typical point (`core/sim/fit.ts`):
    - LEDs with a typical Vf below 2.6 V (AlGaInP, GaAsP, GaP: red, yellow, the kit's
      2.0 V green): N = 2, RS = 2 Ω.
    - LEDs at or above 2.6 V (InGaN: blue, white, true green): N = 3, RS = 2 Ω. InGaN
      junctions show ideality factors well above 2 (Shah et al., J. Appl. Phys. 94, 2627
      (2003)), so N = 2 was wrong for them as well as below ngspice's floor.
    - Rectifiers (1N4007): N = 2, RS = 0.05 Ω, fitted at the Fig. 4 typical Vf at 1 A.
    - The family is chosen from the datasheet Vf, not the colour name, because the kit's
      5 mm green LED (2.0 V) and the RGB LED's green die (3.2 V) are different chemistries.
  - BJTs: Ebers–Moll transport model with IS = 1e-14 A and BR = 1; β is the geometric
    mean of the datasheet's hFE range (PN2222: √(100·300) ≈ 173).
  - A driven GPIO is a Thévenin source. Its resistance is the RP1 table's VOH margin over
    the typical IOH at the drive strength (ADR-0009; 42.1 Ω high at the default 4 mA).
- **Consequences.**
  - `scripts/reference/ngspice_fixtures.py` applies the same rules and records the
    parameters it gave ngspice. `core/sim/ngspice.test.ts` checks that `fit.ts` reproduces
    them, and that every fixture matches ngspice within ±2%.
  - A part whose fit would put IS under 1e-28 A shows up as a fixture failure, not as a
    quiet mismatch.
  - Currents away from the datasheet point are a model, not a measurement. The Inspect
    panel labels them "simulated".

## ADR-0013 Probe-signature ranges: pull resistance, node capacitance and settle time

- **Context.** SPEC 9 asks probe-signature mode to carry the pull resistance as a range
  through every prediction, and to predict the pair test as a transient from the precharge
  state with a node-capacitance range.
  - The pull range is documented: the Raspberry Pi GPIO doc gives 37–86 kΩ up and
    35–98 kΩ down (ADR-0009).
  - No source gives a GPIO net's capacitance on this bench. That net is the RP1 pad, a
    200 mm ribbon conductor, the T-board trace, a breadboard strip, and any leads.
- **Decision.**
  - Pull range: the documented min–max (`core/constants/rp1.ts`). A bench calibration
    fixture (SPEC 18) may later narrow it, and `probeSignature` takes the range as a
    parameter for that reason.
  - Node capacitance: 10–100 pF per GPIO net. This is a modelling choice: a few pF for the
    pad and strip, and tens of pF for a ribbon conductor and leads, with a wide margin either
    side. Every pair-test reading is predicted at both ends, so a result that depends on it
    comes out ambiguous rather than wrong.
  - Settle time: 100 µs between applying the driving pin's pull and reading. The slowest
    corner (98 kΩ × 100 pF ≈ 10 µs) settles in about ten time constants, and gmin
    (1e-12 S) discharges an isolated 10 pF net with a 10 s time constant. So connected nets
    settle while isolated nets hold their precharge. sense.py (M6) uses the same settle time.
  - Pins are skipped by role on their net: transistor bases, logic and ADC inputs and
    outputs, driver outputs and module signal inputs. Each skip names the pin and the
    reason.
  - Observable means the bias test is certainly tied (low or high at every corner), or
    another GPIO certainly follows the pin both up and down. Reading the drive level in one
    polarity only can mean something else pulled the pin there (an LED path to 3V3 lifts a
    released pin), and a pin's response to its own pull adds nothing the bias test lacks.
    Both were found with the Blinking LED fixture, which must stay unobserved (SPEC 18).
- **Consequences.**
  - LED paths come out unobservable, as SPEC 14.5 expects (about 1.6 V at tens of µA).
  - GPIO2/3 read tied-high through the board's 1.8 kΩ pull-ups.
  - The capacitance range is unverified until the bench calibration fixture runs. It is
    listed in HIL_CHECKLIST.md with that fixture.

## ADR-0014 RAIL_BUDGET checks only documented budgets

- **Context.** SPEC 8: "PIN_OVERCURRENT and RAIL_BUDGET: sim currents above the documented
  limits in constants". The Raspberry Pi documentation at 1bf32ac gives:
  - "GPIO pins (combined): 50 mA maximum" and "GPIO pin (individual): Up to 16 mA"
    (`power-supplies.adoc`; the same figures appear in `gpio-on-raspberry-pi.adoc`).
  - For the 5 V pins on a Pi 5: "Limited by PSU, board, and connector ratings only".
  - No current limit for the 3V3 pins.
- **Decision.**
  - PIN_OVERCURRENT fires above 16 mA on any GPIO.
  - RAIL_BUDGET fires when the GPIOs carry more than 50 mA together.
  - The 3V3 and 5V currents are reported in every snapshot (and the Inspect panel), but no
    limit is invented for them.
  - LED_NO_LIMIT's current check compares each die with its datasheet's maximum continuous
    current (`ifMaxMa`).
- **Consequences.** A 3V3 load heavy enough to brown out the regulator is not flagged. If a
  documented Pi 5 3V3 limit appears, it goes in `core/constants/rp1.ts` with its source and
  a RAIL_BUDGET case.

## ADR-0015 Overlapping part bodies are an ERC warning, not a rejected placement

- **Context.** SPEC 6.6 lists "Part bodies may not collide" among the placement rules
  validated on every op. SPEC 8 lists PHYSICAL_COLLISION as an ERC rule, with a severity
  to choose. Real builds put 5 mm LEDs in neighbouring row pairs (5.9 mm flanges 5.08 mm
  apart), and their leads splay to make room. A rejected placement would refuse a layout
  that works on the bench.
- **Decision.**
  - Overlap is checked in plan view from each part's `bodyMm`, centred on its pins, with a
    separating-axis test.
  - Overlap beyond 0.3 mm is a PHYSICAL_COLLISION **warning** naming both parts and the
    depth.
  - Placement validation keeps the rules that are physically absolute: one lead per hole,
    holes under the T-board body, spans, and the trench.
- **Consequences.**
  - Tutorials must pass ERC with zero errors, so a collision warning does not block one.
    The audit reviews each warning, and the tutorials avoid collisions where a free row
    allows it.
  - Bodies that overhang their pins to one side (the potentiometer) are approximated
    centred on their pins. The Studio's 3D colliders (M7) are exact.

## ADR-0016 Tutorial code and theory are written for this app, not copied from the kit

- **Context.** The kit's code is at https://github.com/lafvintech/Basic-Starter-Kit-for-Raspberry-Pi
  (linked from the kit's "Download the Code" page), licensed **GPL-3.0**. This repository
  is public and has no license file. Copying the kit's code into `content/tutorials/`
  would make those files GPL-3.0 derived works inside an otherwise unlicensed repository.
  The kit's documentation prose has no stated license.
- **Decision.**
  - Each tutorial's Python is written for this app. It follows what the kit's project page
    establishes: the same GPIOs, the same circuit polarity (for example, active-low for
    Blinking LED), the same libraries where the kit names them, and the same observable
    behaviour. No code is copied from the kit's repository.
  - Theory is written in this app's own words, or reused from the baseline's own
    `data/tutorials.js` where the audit finds it correct. Values are templated from the
    circuit document.
  - Each tutorial cites the kit page it follows (`sources.kit`), plus the datasheets and
    Raspberry Pi pages it relies on.
  - Reading the kit's code to confirm a protocol detail is allowed, with the file cited
    (as the ADS7830 behaviour does for the command byte).
- **Consequences.** The repository's license is the owner's choice. If it ever becomes
  GPL-3.0-compatible, the kit's code could be used directly with attribution. Until then,
  nothing in this repo is copied from it.

## ADR-0017 Code in the loop: Python and the circuit share one worker, in virtual time

- **Context.** SPEC 13.2: Pyodide runs the project's Python against the simulator, with
  RPi.GPIO, gpiozero and smbus shims, Atomics-based sleep, and a selectable time scale.
  RPi.GPIO calls are synchronous: `GPIO.input()` must return a level at once. A worker
  running Python cannot receive messages until the program yields.
- **Decision.**
  - `pyodide.worker` hosts its own `SimSession` of the circuit. Every shim call is a direct
    call into `workers/bridge.ts`, with no cross-worker round trip.
  - **Virtual time.** `time.sleep(dt)` advances the circuit's clock by dt. Every shim call
    costs 5 µs of virtual time (an RPi.GPIO call on a Pi 5 is on the order of microseconds),
    so a polling loop advances the clock. `time.time()`, `monotonic()` and `perf_counter()`
    return virtual time, so code that times a pulse (HC-SR04 ECHO) measures the circuit's
    pulse.
  - **Pacing.** The worker waits dt ÷ time scale of real time per sleep, with
    `Atomics.wait` in slices of at most 20 ms. "As fast as possible" skips the wait.
  - **The UI reaches a running program through shared memory.** Stop sets Pyodide's
    interrupt buffer, which raises `KeyboardInterrupt` as Ctrl+C does on the Pi. Part inputs
    (buttons, sliders) are written as JSON to a shared buffer, with a counter the bridge
    checks on every call.
  - The shims match the Pi's behaviour where a program can see it: RPi.GPIO's errors and
    constants, gpiozero's pull-up defaults, and smbus raising `OSError` with Linux's errno
    121 (Pyodide's own table says 147). gpiozero's background `blink()` and `beep()` run as
    PWM, since there are no threads.
  - **Code checks.** `workers/codeCheck.ts` runs a tutorial's own code with each
    assertion's part inputs held, samples the circuit at every sleep, and passes when the
    assertion's expectations all hold at some sample (I2C reads are left to the program).
    This is the M5 exit check, with no per-tutorial run specification.
  - Pyodide 314.0.7 (Python 3.14) is bundled from npm, never a CDN. A Vite plugin serves
    its runtime files at `/pyodide/` in dev and emits them into the build.
- **Consequences.**
  - Simulated time runs only while the program calls the shims or sleeps; a pure-compute
    loop does not advance it.
  - Native extensions (the kit's `dht_c_driver.so`) cannot run in the browser. Tutorials
    use pure-Python code paths, which ADR-0016 requires anyway.

## ADR-0018 Presence sensing is not built

- **Context.** SPEC 14.5 makes presence sensing a stretch goal, gated by a spike in M6: time
  each pin's charge under its pull with 10 ns resolution or better, using PIO cycle counts on
  RP1 through piolib, and see whether a dangling lead's few picofarads, about a tenth of a
  microsecond, can be told from noise, hand proximity and ribbon movement. If it can't, drop
  it and record an ADR.
- **Decision.**
  - The spike needs the Pi and the bench. This build never runs Board Sense against the real
    Pi (SPEC 18), and no Pi is reachable from it.
  - So presence sensing is not built. The `presence` divergence kind is never produced, and
    bench fixture 7 is listed in `HIL_CHECKLIST.md` as not part of this build.
  - Board Sense ships with the bias and pair tests, which need no timing finer than the
    100 µs settle time (ADR-0013).
- **Consequences.**
  - A lead whose far end touches nothing stays invisible to Board Sense, as SPEC 14.5 already
    says of microsecond timing.
  - Building presence later means the spike first: a piolib program on RP1 that times the
    charge edge, its noise measured on the bench with and without a dangling lead, and a
    keep-or-drop decision recorded here.

## ADR-0019 The agent gets libgpiod 2 from apt on Trixie and from a venv on Bookworm

- **Context.**
  - SPEC 14.5 asks which libgpiod binding the Pi's OS ships. Board Sense and the monitor's line
    info use the v2 Python API (`request_lines`, `LineSettings`, `Chip.get_line_info`).
  - The baseline `install.sh` asked apt for `python3-gpiod`. No such package exists in Debian
    or in archive.raspberrypi.com, so the install stopped at its package step.
  - Debian's `python3-libgpiod` is 2.2.1 (v2) on Trixie and 1.6.3 (v1) on Bookworm. Raspberry
    Pi OS takes it from Debian. PyPI's `gpiod` 2.x is the official v2 binding, with aarch64
    wheels for CPython 3.10 to 3.14.
  - Bookworm's pip refuses system-wide installs (PEP 668).
- **Decision.**
  - `install.sh` asks apt for `python3-libgpiod`, `python3-websockets` and `python3-venv`.
  - When the system `python3` has no `gpiod.request_lines`, it makes `venv/` in the agent's
    directory with `--system-site-packages` and installs `gpiod>=2,<3` there. The venv still
    sees apt's websockets and RPi.GPIO. If that fails it removes the venv and warns; the rest
    of the agent still works.
  - The app starts the agent with `venv/bin/python3` when it exists, and `python3` otherwise.
  - The system's Python packages are never changed, and removing the agent's directory removes
    the venv.
- **Consequences.**
  - On Bookworm, Deploy agent downloads gpiod from PyPI once. A 32-bit OS has no wheel and
    needs `python3-dev` and a compiler; the warning then says Board Sense is unavailable.
  - Tutorials still run with the system `python3` (`runScript`), so they're unaffected.
  - Not run on a Pi from this build (PI_HOST is unset). `HIL_CHECKLIST.md` lists the check.

## ADR-0020 The Pi 5 model comes from the no-graphics STEP, read in parts

- **Context.**
  - SPEC 6.2 links two official STEP archives, both MIT-licensed by Raspberry Pi Ltd, retrieved
    2026-10-24. With graphics (RP-010082, archive SHA-256
    `1b38b554a317411bc60604f066ae004273e6c857778ecf997925ea0b56b44e0b`): a 142 MB STEP,
    3,467 solids, 83,152 faces. No graphics (RP-010083, pinned in `sources.json`): 78 MB, 2,689
    solids plus 22 surface shells, 45,689 faces. The extra 778 solids and 37,463 faces are
    markings modelled as solid prisms.
  - The budget is 200k triangles and 8 MB (SPEC 10.8).
  - occt-import-js 0.0.23 is compiled with a 2 GB heap. Loading the 78 MB file filled it: all
    2,711 bodies came back with their faces listed but no triangles, and the read still
    reported success.
- **Decision.**
  - Use the no-graphics variant. The markings would add 82% more faces for flat colour detail,
    which a texture carries better, and twice the STEP text to load.
  - `step-to-glb.ts` splits the STEP text into parts holding at most 12 MB of body geometry
    each. Every part keeps all the non-geometry entities (products, assembly, placements,
    styles) and its share of the solids. References to left-out solids are dropped from item
    lists, and their styles are removed. A fresh occt-import-js instance reads each part. The
    Pi reads in 5 parts, in about 4 minutes.
  - The read fails if any body comes back untriangulated, or if the number of bodies read
    differs from the STEP's.
  - The licence travels with the model: the full MIT text in `pi5.manifest.json`, the notice in
    the GLB's `asset.copyright`.
- **Consequences.**
  - The Pi has no silkscreen or logos. The with-graphics markings could later be baked into a
    colour texture; the same splitting reads that file.
  - The STEP is drawn in `pi5-board.json`'s frame: the PCB spans 0–85 by 0–56 mm, and its
    mounting holes sit on the drawing's centres. The only transform is the lift onto the table.

## ADR-0021 Pi 5 budget: the PCB and header base stay as modelled, the rest is decimated

- **Context.**
  - At 0.05 mm linear and 0.5 rad angular deflection the STEP tessellates to 853,982
    triangles. At 0.1 mm and 1.0 rad it is still 402,702, because small parts have many faces:
    an 0402 termination takes 300–580 triangles, and the BGA balls hidden under the SoC and RAM
    take about 150k.
  - assets:check measures the mounting holes from the PCB's walls and the header's position
    from its base, so those two bodies have to keep their shape.
- **Decision.**
  - Tessellate at 0.05 mm and 0.5 rad. Weld the faces the reader leaves apart, then apply one
    quadric (collapse) decimation to every body except the PCB and the header base, bringing the
    whole model to 195,000 triangles. Quadric error is absolute, so sub-millimetre detail
    collapses first and the connectors keep their shape.
  - Shade smooth by angle (30°), replacing the reader's per-face normals.
  - Remove the 40 header pins, after checking each stands within 0.05 mm of its
    `pi5-board.json` position. The build fails if any pin is missing or off the grid.
  - Bake AO into one 2048 × 2048 map over a smart-projected atlas, repacked at one texel
    density. Without the repack, the PCB got about 100 px of the atlas.
- **Consequences.**
  - One level of detail. Sub-millimetre parts lose their rounding, which isn't visible at
    bench distance.
  - The materials are one per STEP colour. Metal versus plastic is a table in `pi5.py`, read
    from where each colour's bodies sit on the board, and the solder mask has a clear coat.

## ADR-0022 KTX2 encoding goes through `ktx create`

- **Context.** ADR-0005 installed KTX-Software 4.4.2 for `toktx`. gltf-transform 4.5.1's KTX2
  transform (`toktx()` in `@gltf-transform/cli`) now runs `ktx create`, and needs
  KTX-Software 4.4.0 or later. It no longer calls `toktx`.
- **Decision.**
  - The pipeline runs `ktx` from the same install. When `KTX_BIN` is set (naming `toktx`, as
    ADR-0005 has it), its directory goes first on `PATH`.
  - Base colour is encoded as ETC1S; normal and occlusion maps as UASTC (level 2, zstd 18).
    Each texture is resized to fit its asset's budget.
  - `assets:check -- --rebuild` decodes textures with `ktx extract --transcode rgba8` for its
    SSIM comparison.
- **Consequences.** ADR-0005 already links `ktx` into `~/.local/bin`, so nothing new is
  installed, and the WebP fallback isn't needed.

## ADR-0023 The asset scripts run on Node's type stripping, with a resolve hook

- **Context.** Node 26 runs `.ts` files directly. assets:check measures the models against
  `core/geometry/breadboard.ts`, which imports `../model/types` without an extension, as Vite
  and Vitest allow. Node resolves only imports that name their file.
- **Options.** (a) Add a TypeScript runner such as tsx. (b) A small module hook
  (`registerHooks`), loaded with `--import`, that adds `.ts` to extensionless relative imports
  made from `.ts` files.
- **Decision.** (b), in `scripts/assets/resolve-ts.ts`.
  - The scripts import without extensions, like the app.
  - `npm run typecheck` covers the modules the Vitest guard imports, and
    `tsc --noEmit -p scripts/assets` covers all of them.
  - The npm scripts turn off one Node warning, about `package.json` declaring no module type.
    That field affects the whole app, so the pipeline doesn't change it.
- **Consequences.** No new dependency. If core starts importing JSON or browser-only modules
  on the path assets:check takes, the hook won't cover them.

## ADR-0024 Breadboard model: drafted recesses under one top-down texture set, sheen for ABS

- **Context.**
  - SPEC 10.4 asks for a chamfered body, molded square hole recesses as geometry, the trench
    and rail channels, a legend generated from data, a glimpse of nickel contact, and white ABS
    with a slightly translucent look. SPEC 10.3 bakes AO, and tangent-space normals from
    high-poly detail.
  - The datasheets give only the outline and the hole grid.
  - SPEC 10.3 keeps real-time transmission to where it shows (LED lenses).
- **Decision.**
  - Shape values (mm), chosen to read like reference photos 3 and 4:
    - top chamfer 0.5; corner chamfer 1.0
    - each hole: a 1.4 square opening, a funnel to 0.9 at 0.45 deep, then a shaft drafted
      to 0.8 at 2.2 deep
    - the nickel contact: two leaves meeting in a V 0.2 deeper, along the strip
    - the trench: 2.4 wide (2.0 at the floor) and 2.0 deep, centred between e and f
    - the rail channels: 1.0 wide (0.7 at the floor) and 1.5 deep, midway between the inner
      rail and column a or j
    - every groove stops 1.5 short of the ends
  - Every recess wall has draft, so the whole top maps straight down (u = x / length,
    v = y / width) without folding over. One texture set covers it:
    - the legend's colour, baked as emission from text and bars generated from the board JSON
    - a normal map, baked from a copy with 0.08 mm rounded edges and hardened normals
    - AO
  - Texture sizes: bb-830 2048 × 1024 and bb-400 1024 × 1024, about 12 texels/mm along the
    rows and 19 across.
  - The legend follows the photos:
    - row numbers 1, 5, 10, … beside columns a and j
    - letters a–j at both ends
    - a red line beside each + rail and a blue line beside each − rail, on the side away from
      its partner rail
    - + and − at both ends of each rail
    - text reads across the board, with its top toward row 1
  - Translucency comes from `KHR_materials_sheen` (weight 0.3, roughness 0.5) on ABS
    (roughness 0.45), not from transmission. The exporter writes IOR only alongside
    transmission, so ABS keeps glTF's default of 1.5.
- **Consequences.**
  - The legend uses Blender's built-in font, rendered into the texture.
  - If the look-dev pass (M7.7) wants real subsurface glow, the studio can add it in TSL.
  - Changing a shape value changes the geometry hash. Hole centres don't move, because they
    always come from `holePosition`'s formulas.

## ADR-0025 GTAO feeds the ambient light through a normal and velocity pre-pass

- **Context.** SPEC 10.2 asks for a scene pass with MRT (output, normals, velocity as
  needed), then GTAO, bloom and TRAA, with depth of field available. In three 0.186 the
  pipeline class is `RenderPipeline` (`PostProcessing` remains only as a deprecated alias),
  and three's own GTAO example no longer multiplies occlusion over the finished image: it
  renders depth, packed normals and velocity in a pre-pass and hands occlusion to the
  colour pass through `builtinAOContext`, so only ambient light is occluded.
  `PCFSoftShadowMap` is removed from WebGPURenderer in r186 (it falls back to
  `PCFShadowMap` with a warning).
- **Options.** (a) One scene pass with MRT `{output, normal, velocity}` and occlusion
  multiplied over the output: one geometry pass, but direct light and highlights darken in
  creases too. (b) The r186 structure: an MRT pre-pass and a colour pass, two geometry passes.
- **Decision.** (b), in `studio/renderer.ts`:
  - pre-pass: `pass()` with `mrt({ output: packNormalToRGB(normalView), velocity })`, its
    normal target 8-bit, transparent objects skipped;
  - `ao()` (GTAONode) from the pre-pass depth and normals at half resolution with temporal
    filtering, radius 8 mm (scene units are mm);
  - colour `pass()` with `contextNode = builtinAOContext(ao)`;
  - `traa()` over the colour pass with the pre-pass depth and velocity (MSAA off, renderer
    `antialias: false`);
  - `bloom(traa, 0.35, 0.4, 1)` added on top, thresholded at 1 so the white boards don't
    glow and lit LEDs will;
  - depth of field (`dof()`, DepthOfFieldNode) is built the first time `Post.setFocus()`
    asks for focus, between TRAA and bloom, and `setFocus(null)` turns it off;
  - AgX tone mapping and sRGB output are applied by the pipeline's output transform;
    shadows use `PCFShadowMap` (`shadows="percentage"`) softened by `shadow.radius`.
- **Consequences.**
  - Every frame draws the scene twice. In the Tauri window on this Mac (WebGPU, M5 Pro) the
    empty bench runs at 60 fps, which is WKWebView's requestAnimationFrame cap; it has to be
    measured again once the board and Pi models load (SPEC 10.8).
  - `@types/three` 0.186 types DepthOfFieldNode without its vec4 output, so one cast in
    `setFocus` carries a comment saying so.

## ADR-0026 The Studio renders on demand from a frame loop it owns

- **Context.** SPEC 10.2: render only while something moves, then at most 16 frames for TRAA
  to converge, then none. SPEC 11.3 and acceptance 8: a hover shows its strip and net within
  one frame. Routing the highlight through React state would put React's render between the
  pointer event and the frame.
- **Decision.**
  - R3F runs with `frameloop="demand"`. One `useFrame` subscriber with priority 1 renders the
    `RenderPipeline` and asks `FrameLoop.tick()` whether another frame is needed. Moving
    means the damped OrbitControls (three's addon, not drei) changed the camera or a preset
    move is running. Any frame nobody scheduled for settling (a hover, a document change, a
    model arriving, a resize) counts as a change and starts the same 16-frame run.
  - `StudioView` owns the camera, the controls, the hover and its overlay. A pointer move
    picks a hole against each board's top plane (`nearestHole` within half a pitch), writes
    the strip's holes and the net's wire ends into one instanced mesh from core geometry,
    sets the tooltip's text, and requests a frame, all in the event handler. React renders
    only what the document declares: the stage and the models.
  - Listeners attach through a React 19 ref callback with cleanup, and objects are created
    in `useState` initializers, so no `useEffect` is involved (ADR-0006).
  - Dev builds expose the view as `window.__studio` (frame counter, hover record with the
    frame it was first drawn on, hole projection) for the e2e tests. The dev overlay shows
    the backend, the frame count and the frame rate of the last continuous run of frames.
  - Models are loaded once per URL and shared; each placement clones the node tree. A model
    that fails to load logs a warning and draws nothing. GPU resources go with the renderer,
    which R3F disposes when the Studio unmounts.
- **Consequences.**
  - Later motion sources (drags, sim animations, physics) report "moving" to the same tick.
  - The e2e tests assert that the first frame drawn after a hover already carries it, and
    that a still scene draws nothing, before and after a camera move.

## ADR-0027 One app-wide CircuitStore; the Workbench opens into it

- **Context.** The Studio renders the circuit document, and the interim Workbench (SPEC 11.1)
  holds its own copy in `workbenchStore`. Both pages must show one document.
- **Decision.** `state/circuit.ts` holds the app's one `CircuitStore`, starting as a new
  project on the bench layout (`newDoc`). `workbenchStore.open()` calls `circuit.open(doc)`
  for every document that passes `validateDoc`. The Studio reads it with
  `useSyncExternalStore`, and hover reads nets from its ConnectivityEngine.
- **Consequences.** A document that breaks placement rules opens in the Workbench, which lists
  its problems, but not in the Studio, which keeps the previous document (`CircuitStore`
  rejects it anyway). The Workbench follows every committed change to the app's document
  (ADR-0034).

## ADR-0028 End-to-end tests run in headless Chromium on the GPU, on their own port

- **Context.** SPEC 18 asks for Playwright e2e in Chromium against the Vite dev server.
  Playwright's default headless shell has no WebGPU adapter and draws WebGL2 in software
  (SwiftShader): there the Studio ran on the WebGL2 fallback, and a preset move plus its 16
  settle frames took longer than the 2 s acceptance 13 allows. A page on `about:blank` also
  sees no `navigator.gpu`, which needs a secure context.
- **Decision.** `playwright.config.ts` uses the `chromium` channel: Playwright's full
  Chromium build in new headless mode, which draws on the Metal GPU and offers a WebGPU
  adapter on this Mac with no extra flags. The server is `npm run web:dev -- --port 5193`
  with `reuseExistingServer: false`, so a running `tauri dev` on 5173, or another checkout's
  server, is never tested by mistake. Results go to `out/e2e`, which is ignored.
- **Consequences.** `npm run e2e` exercises the WebGPU path, as the Tauri window does. A
  machine without a GPU would fall back to WebGL2 and may miss the 2 s settle bound.

## ADR-0029 Every passive, switch, transistor and buzzer family is built in Blender, without textures

- **Context.**
  - SPEC 10.4 lets a family stay runtime-procedural only if a Blender version adds no visible
    fidelity at close range, and asks for the decision per family.
  - A runtime body is a primitive (a cylinder, a box, a lathe) with a material. What it lacks at
    close range is the moulded detail that tells the parts apart: the resistor's end caps, the
    LED's lead frame inside its dome, the TO-92's flat face and printed number, the LDR's
    serpentine track.
  - The parts share the 40 MB models budget with the boards, the Pi and the other part
    families (about 7 MB used when these were built).
- **Decision.** All 13 families are Blender scripts, one per family, parameterized by the
  definition's `geometry.params`. None stays runtime-procedural. What each adds:
  - axial-resistor: metal end caps, a lacquered body necked under them, four ring primitives
  - diode: the DO-41 body with moulded rounded ends and a flush cathode band
  - led (3 and 5 mm, two files): the flange with its flat on the cathode side, the dome, and
    through the clear epoxy the cathode's cup, the anode's post, the bond wire and the die
  - rgb-led (two files): one dome over three dies on one anvil, and the four leads formed to
    the grid
  - ceramic-cap: a moulded block with bevelled edges and a rounded top
  - electrolytic-cap: the crimped base, rolled groove, sleeve with its stripe and minus signs,
    and the scored vent
  - ldr: the face's serpentine track and electrodes, as geometry on a 2.1 mm disc cut flat
  - ntc: the epoxy drop
  - to92 (three files): the cylinder cut flat by a plane, the part number printed on the flat as
    geometry, the leads formed outward
  - tact-switch: the housing, steel cover with its round opening, and the plunger
  - tilt-switch: the tin can with its crimp groove over the resin plug
  - potentiometer: the case, bezel, bushing and shaft with its slot, and the three flat
    terminals
  - buzzer (two files): the chamfered case, sound hole, + mark, the seal sticker of the active
    one and the green board under the passive one
- **No textures.** The parts carry geometry and material parameters only.
  - Ambient occlusion at this scale comes from the runtime GTAO pass (ADR-0025). A baked map
    would add a KTX2 file per part for contact darkening the pass already draws.
  - What is printed and fixed is geometry (the TO-92 number, the minus signs, the + marks). What
    depends on the value (the resistor's bands, the capacitors' printed values) is the studio's.
  - `assets:check` asserts a part has no textures, so adding a bake is a decision, not drift.
- **Budgets.** One triangle cap per family, about a third over its largest file; 40 KB per
  file. The 18 files build to 252 to 1,232 triangles and 4.6 to 16 KB each, 179 KB together.
- **Consequences.** Cycles bakes nothing for parts, so the fixed samples and seed matter only to
  the boards. Geometry hashes reproduce exactly (`assets:check -- --rebuild parts`); there are
  no textures to compare by SSIM. If the look-dev pass (M7.7) wants detail normals on the
  moulded bodies, the family scripts bake them through `lib/bake.py` and the check's no-texture
  assertion changes for that family.

## ADR-0030 Part pins sit on the definition's grid; formed leads are part of the body

- **Context.** The part GLB contract puts a `pin-<id>` empty where each lead leaves the body,
  and has `assets:check` hold every rigid pin within 0.05 mm of its `offsetPitch` position.
  Several parts' real leads leave the body at another pitch: the TO-92 and the RGB LED at
  1.27 mm, the tact switch's terminals 6.5 x 4.5 mm apart, the potentiometer's 5.0 mm, the
  tilt switch's 2.4 mm, and the ceramic capacitor's 5.08 mm spacing is wider than its 4.83 mm
  body. The definitions put their pins on the 2.54 mm grid, where they plug in.
- **Decision.**
  - The empties are at the grid positions, and the lead's section between the body and the
    grid is modelled, as formed stubs in a material named `lead` that the body-dimension check
    leaves out. The runtime's straight lead starts at the empty. This applies to the TO-92
    (outer leads fan from 1.27 to 2.54 mm), the RGB LED (all four), the tact switch (a foot out
    of the wall nearest each terminal), the potentiometer (three flat strips down from the
    case) and the ceramic capacitor (a 0.6 mm jog under the body).
  - The tilt switch's leads leave its plug at the grid, 0.14 mm wider than the datasheet's
    2.4 mm, which the definition says the leads' bend absorbs.
  - An empty's +z axis (Blender; the empty's local +y in glTF) runs along the lead out of the
    body: down for radial and rigid parts, along -x (pin 1) and +x (pin 2) for the axial ones.
    `assets:check` measures it from the GLB.
  - Flex-2lead parts have the origin at the pins' midpoint and both pins at model z = 0, so
    `seatMm` is the height of the pins above the board: one body radius for the axial parts
    (they lie on it), 1.0 mm for the radial ones. That 1.0 mm is a modelling choice, not a
    datasheet figure; the studio may seat the part lower or higher.
  - Pin spacing is the params' lead spacing (`leadPitchMm`, `leadSpacingMm`), and for the axial
    resistor and diode the body length, because the leads leave the end caps.
  - Rigid parts stand where they seat: the tact switch and buzzers flat on the board, the
    potentiometer with its case 4 mm up on its terminals, the TO-92 and RGB LED 3.0 mm up on
    their formed leads and the tilt switch 2.0 mm up. These heights are modelling choices.
  - The TO-92's flat face points toward -y (column a at rotation 0), pin 1 on the left seen from
    that face, as the definitions' notes place it. The potentiometer's shaft points toward -y,
    with the terminals on the rear plane at y = 0.3 and the shaft over the middle terminal.
- **Consequences.** The studio draws each lead from its empty: straight down for rigid parts,
  bent to the holes for flex ones. The `lead` material is not a runtime lead and keeps its
  place if the studio draws the runtime lead in the same colour.

## ADR-0031 Animated nodes and value-driven materials

- **Context.**
  - The studio drives the tact switch's plunger and the potentiometer's shaft as nodes, and the
    resistor's rings and the LEDs' lenses and dies as materials, by name (SPEC 10.6).
  - gltf-transform's dedup, which `optimize.ts` runs, merges materials equal in every
    parameter but the name. The default resistor, 220 ohm at 5 %, has two red rings.
  - Meshopt quantization gives each mesh node a translation and scale; the node's origin
    becomes the centre of its mesh's bounding box.
- **Decision.**
  - `plunger` and `shaft` are their own mesh nodes under the root, built around their axes.
    The plunger travels along -z; the shaft turns about core y (glTF local z) and is modelled
    at 50 % wiper with its screwdriver slot upright. The shaft's cross-section is symmetric about
    its axis, which puts the bounding-box centre, and so the node's origin, on it; the slot is a
    decal inside that section, not a flat on one side.
  - The studio animates relative to each node's loaded transform. Both nodes load with an
    identity rotation and a uniform scale (quantization's), so a rotation about the node's own
    axis, or a translation along -z, composes with the load transform as written.
  - Value-driven materials carry a custom property `driven` equal to their name, exported as
    glTF `extras` (`partkit.driven`), which keeps equal-looking materials apart through dedup.
  - The resistor has four ring primitives, `band-1` to `band-4`; the five-ring variant is not
    modelled. Rings stand 0.012 mm off the body, which is narrowed so the rings, not the body,
    are the widest part.
  - Single-colour LEDs have one `lens` (the whole epoxy body, with `KHR_materials_transmission`)
    and one `die`; RGB LEDs have one `lens` and the dies `die-r`, `die-g` and `die-b`.
- **Consequences.** A part that adds an animated node whose axis is not through its bounding
  box's centre would turn about the wrong point; the family script must keep the section
  symmetric, as the shaft's is.

## ADR-0032 Part files go through the asset registry, in a parts/ folder

- **Context.** The asset pipeline built one GLB per entry in `assets.ts`, flat in
  `public/models`, and checked it with `verify.ts`, which this change leaves as it is.
- **Decision.**
  - `parts.ts` holds the 13 families (script, triangle cap, and the expectation read from the
    definition's `geometry.params`) and the 18 files, and `assets.ts` adds them to `ASSETS` with
    `kind: 'part'`. `Asset.name` is a plain string, and `assetDir` puts a part's files in
    `parts/`.
  - `verify-parts.ts` holds the part checks; `check.ts` and `models.test.ts` choose between it
    and `verify.ts` by kind.
  - `build.ts` merges each part's entry into `parts/index.json` and records the shared helper
    `blender/partkit.py` in the manifest's script hashes.
  - `assets:build` and `assets:check` accept asset names, and `parts` for all the parts, so a
    part can be rebuilt and compared without rebuilding the Pi.
  - The folder-size check counts the files in `parts/`.
  - The family scripts use `blender/partkit.py`, not `lib/`: it exports with custom properties
    (for `seatMm`, which `lib/export.glb` drops), and builds meshes from lathes, prisms and
    sweeps, welding seams and shading by angle.
- **Consequences.** Another lane's parts register the same way, in their own families and
  entries. Each build merges into `index.json`, so lanes' entries combine; a clash is two
  entries for one file, resolved by rebuilding.

## ADR-0033 Studio gestures propose ops; circuitStore.check() judges them

- **Context.** SPEC 11.3 asks for drag-placing with a green/red glow per footprint hole, a wire
  tool that offers only legal targets, and live moves of boards, the Pi, the T-board, modules,
  parts and lead ends. SPEC 4.5 allows only `circuitStore.dispatch` to change a document, and
  SPEC 8 has ghost previews produce provisional connectivity events.
- **Decision.**
  - Each gesture (`studio/gestures.ts`) turns the pointer's hole, module pin or table point into
    a proposal: the ops it would dispatch, the holes and module pins it puts leads in, and what to
    select afterwards. `studio/placement.ts` builds the ops (ids by designator prefix, default
    props, seating by an anchor hole, quarter turns, removals, the inventory's default lead).
  - The view runs `circuitStore.check()` once per changed proposal. A hole glows red when a
    problem names it, every hole glows red when a problem concerns the edit as a whole, and all
    glow green when it passes. A legal proposal becomes the preview: the studio store's
    `preview` document, which the leads, footprints, labels and models draw instead of the
    committed one, and `engine.preview()` for provisional events. Release commits it through
    `edit()`, one transaction; Esc or an illegal release drops it.
  - Leads are tubes along a design curve (`designCurve`, then `leadGeometry(points)`), so
    simulated points can replace the curve. Placed parts show as footprint markers and a
    selection box from `bodyMm` grown to take in the pins; the same box picks them. Labels are
    DOM tags re-projected on every drawn frame.
- **Consequences.** Every legality decision stays in core/ops/validate; the Studio adds none of
  its own except that a library footprint must land wholly on a board, and that a lead's first
  end must be a free hole (nothing in it, not under the T-board). Nothing renders while still:
  a proposal is recomputed only when its ops change, and every change requests frames.

## ADR-0034 The Workbench follows the app's document; code joins it on leaving the editor

- **Context.** ADR-0027 left `workbenchStore.doc` set only by `open()`, so Studio edits never
  reached the sim or ERC, and the Code panel's program lived outside the document.
- **Decision.** `workbenchStore.follow()` runs on every CircuitStore change (and when the Studio
  mounts): it takes the new document, reloads it into the sim worker, and replays the GPIO states
  and part inputs already set, for parts that still exist. Loads run one after another, and a
  load whose document has been replaced meanwhile is skipped. `open()` validates as before and
  hands a valid document to the CircuitStore, which `follow()` then picks up. Leaving the code
  editor commits the program with one `SetCode` transaction; Save does the same first. The
  editor reloads (a `codeRevision` key) only when the document's code changed and differs from
  what is being edited, as after an undo.
- **Consequences.** ERC, the sim, Build Steps and Board Sense's expectations follow every commit,
  undo and redo. Running Python keeps the document it started with until it is run again.

## ADR-0035 Placing and moving by hand

- **Context.** SPEC 11.3: flexible two-lead parts are placed by anchor plus span; boards, the
  Pi, the T-board and modules move by dragging; lead ends are draggable. The orbit controls also
  take a left drag on the canvas.
- **Decision.**
  - A library drag seats pin 1 in the hole under the pointer and the other pins at the
    definition's offsets, turned by R in quarter steps; a flexible part starts at its native
    pitch. Once placed (and selected), dragging either of its legs to another hole sets the span.
  - Pressing on a lead end, a selected flexible part's leg, a part, a module, the T-board or the
    Pi drags it; a press on a board drags it only when the board is already selected, so a drag
    over a board orbits otherwise. A press that moves at most 4 px is a click and selects.
  - The T-board moves by whole rows, and by column pairs as the pointer crosses columns.
- **Consequences.** Moving a board carries everything plugged into it for free, since parts and
  leads name holes on it. Moves that the rules refuse glow red and are not committed.

## ADR-0036 Projects in the app data folder; tutorials stay templates

- **Context.** SPEC 11.9: `.gpiob` files in the app data folder with a gallery, Save As and Open
  through Rust's native dialogs, tutorials as read-only templates, forking in M10.
- **Decision.** Save writes the open document with `projects_write` under its file id, which
  is made from the name and the time on the first save and kept afterwards. Save As exports a
  copy through `projects_export` and leaves the open project as it was. Open… reads through
  `projects_import`; the gallery lists `projects_list` and opens with `projects_read`. A
  document that carries `meta.sourceTutorialId` and has no project file id is a template: the
  Studio refuses its edits and Save, with a notice.
- **Consequences.** Opening a tutorial and building on it waits for "Fork to my projects". The
  e2e tests stand in for the native commands with an in-memory `window.api.projects`.

## ADR-A2-1 T-board model: shape values beyond tboard.json, and the box header's pin 1

- **Context.**
  - `tboard.json` fixes the outline, the header's size and place, the mounting holes and the
    pin grid (ADR-0004). It does not give the spacer, the pins' lengths, the shroud's walls, the
    key slot, the pad sizes or the silkscreen, and it leaves open which end of the box header
    carries its pin 1.
  - Photos 3, 5 and 6 (`docs/v2/reference/IMAGES.md`) show those details. SunFounder publishes
    no drawing.
- **Method.** A dimension read from a photo uses a feature of known size in the same photo as its
  scale: the 2.54 mm pin pitch in photos 3 and 5 (12.4 and 20.74 px/mm), or the 1.6 mm PCB edge
  in photo 6, which is angled, so its vertical readings are ratios. Read-outs are good to about
  0.3 mm. Where a photo cannot settle a value, the standard part's value is used.
- **Decision.** Values in mm, in `scripts/assets/blender/tboard.py`.
  - Spacers 2.5 tall: a 0.1 in header's body. The stem's pins stand 6.0 below them and 1.4 above
    the PCB. These are a standard 11.54 mm header's 6.0 mm mating length and 3.0 mm tail, less the
    1.6 mm PCB; photo 6 gives 5.5 to 5.8 below, against the PCB edge.
  - Plated holes 1.0 drill and pads 1.68 round: the Adafruit T-Cobbler Plus values (SPEC 22).
    The mounting holes take tboard.json's 2.5 and a ring 4.1 across (photo 5: 85 px at 20.74
    px/mm). The box header's tails stand 1.2 below the PCB, in solder cones.
  - Shroud: long walls 1.2, end walls 1.9, floor 2.0, pins ending 2.0 below the rim. The key slot
    is 6.5 wide and 4.5 deep from the rim (photo 6: about a ninth of the header's length, and
    under half the wall's height), cut through the -x wall, which tboard.json names. The photo's
    window in the end wall is not modelled.
  - Silkscreen: labels 1.5 mm font size (photo 3: cap height 14 px = 1.1 mm), squeezed to at most
    5.6 mm wide so the two columns' labels clear each other, 1.6 mm from the pad centre on the
    inboard side. The title box is 32 x 3.5 mm with text about 30 mm wide (photo 3: 394 x 45 px).
  - **Box header pin 1** is the +y end of the key-side row (x = centerXMm - pitch / 2), odd pins
    in that row. Photo 5, seen from below with the header up, puts the square pad at the top
    left, in the row nearest the key wall; mirrored to the top view, that is the +y end. The
    other pins follow the usual 2 x 20 numbering. tboard.json left this open; the IDC socket's
    pin 1, and so conductor 1, follows it.
  - The traces are stylised, not copied: one rule routes all 40. Each header pad fans, in
    parallel at 70 degrees, into a lane between the pin rows (0.2 wide, 0.34 apart, ordered by the
    header's y so none cross), a via takes it to the top face, and a short top trace reaches the
    stem pad. Traces stand 0.05 proud as a baked normal map, and show as a darker red.
  - Colours are sRGB: mask (0.75, 0.07, 0.08) with a clear coat, tinned metal (0.84, 0.84, 0.86),
    spacer yellow (0.98, 0.80, 0.05), the shroud's grey (0.62, 0.64, 0.67), FR-4 edge cream.
- **Consequences.**
  - The PCB's two faces are 1652 x 2048 maps (28.6 px/mm, ETC1S colour, UASTC normal) and AO is at
    half that; the model is about 13,000 triangles and 1.6 MB.
  - If the bench shows the box header's pin 1 at the other end, `header_pin` in `tboard.py`, the
    `pin1` empty and contact order in `idc.py`, and the matching two checks in `controllers.ts`
    change together.
  - The silkscreen's font is Blender's built-in one, not the photos' typeface.

## ADR-A2-2 IDC socket: a 3M 891 body seated on the header's rim, cable and bump on the key wall

- **Context.**
  - SPEC 6.4 names the 3M 891 series (TS-0449-L) as the body reference, and the Farnell listing
    as a cross-check. The contract fixes the origin (the mating face's centre, facing -z) and
    the empties `pin1`, `cable-a` and `cable-b`.
  - The sheet's text gives the 2.54 mm grid, a 10.7 mm assembled height with the standard strain
    relief, and a 1.5 mm centrebump; its 40-position length and width table did not come through
    the text. The listing gives 55.6 x 10.5 mm (its 6 mm width is not credible for two rows).
- **Decision.** Values in mm, in `scripts/assets/blender/idc.py`.
  - The body is 21 pitches long (53.34: a pitch of margin beyond the end contacts) and 9.0 wide,
    7.1 tall, with a 3.6 mm cover on top, 10.7 in all. The listing's longer figure is not used;
    photo 3's socket is about 5.5 times as long as it is wide, which a 9.7 mm width would match.
    9.0 sits flush with the 8.8 mm shroud.
  - 40 openings 1.2 square, narrowing to 0.9, 2.2 deep. The cable's mid-plane is at z = 6.0 and
    leaves through a 51.8 x 1.05 slot, 0.6 deep, under the cover's 1.0 mm lip, which is the strain
    relief. The pin-1 triangle is 2.4 x 2.4 x 0.25, on the cover above contact 1.
  - The polarization bump is on the cable wall: 6.0 wide (photo 3), 1.2 out of the wall, 5.3 tall,
    ending under the slot. The sheet's 1.5 mm centrebump is read as the bump's size, not
    matched; the rib is rounded. The cable leaves on the bump's side, as photo 3's lower socket.
  - That wall is -x, so seated on the T-board's `socket` the bump meets the key slot and the
    cable runs away from the stem. Pin 1 is the row beside the bump (ADR-A2-1), at +y;
    `cable-a` is at +y, conductor 1's edge.
  - The socket's origin goes on the rim: its body rests on the shroud and is not inserted into
    it. The shroud's cavity (6.4 wide) is narrower than the socket (9.0), so the two do not
    interlock in the model.
  - The cover's moulded ribs are a high-poly copy baked to the normal map; AO is baked.
- **Consequences.** A socket seated on the rim hides the header's pins, which is what shows at
  bench distance. If the studio wants the socket inserted, it needs a deeper contract (the
  seating depth, and a shroud cavity that fits) and a new header.

## ADR-A2-3 Ribbon: two baked textures, a raised-cosine ridge, a lossless lookup

- **Context.** SPEC 10.4 has Blender bake the ribbon's cross-section: a tileable normal map of
  the 40 conductor ridges and a 40-texel colour lookup. `ribbon.json` gives the width, pitch,
  thickness (0.95, CP-40) and colour sequence. No datasheet gives the ridge's profile.
- **Decision.**
  - The ridge is a raised cosine, 0.15 mm high, one a conductor's pitch, crowned at the pitch's
    middle with its valleys at the pitch's edges, so the map tiles across and, because the
    conductors run along the cable, along it. This is an assumption read against photos 1 and 3,
    whose ridges are visible but faint. It is baked from a mesh that carries them.
  - The map is 1280 x 64: 32 texels per ridge, and a tile 2.54 mm of cable long, with the same
    texel density along it. It is linear UASTC with mipmaps.
  - The lookup is 40 x 1 RGBA8 in sRGB, without mipmaps and uncompressed. A block-compressed
    texture would blend neighbouring conductors' colours within each 4 x 4 block, and WebGPU
    needs block-aligned sizes for compressed formats.
  - The ten colours are sRGB values read off the rainbow cable in photos 1 and 3: brown 6b3a1d,
    red d81e1e, orange f07a12, yellow f2d21a, green 1fa84a, blue 1f59d6, violet 7a2fc4, grey
    9a9a9e, white eeeeea, black 1c1c1f. They are in `assets.ts` (`colors`), and the check reads
    them from there.
- **Consequences.** The studio samples the lookup with nearest filtering. The 0.15 mm ridge is a
  tunable constant in `ribbon.py`; changing it changes the ridge map's bytes, not its size.

## ADR-A2-4 Dupont ends: housing detail as geometry, AO only

- **Context.** `dupont.json` gives the housing's 2.54 x 2.54 x 12.0 mm, the 0.64 mm pin with 5.5 mm
  exposed, and the 1.0 mm wire. The housings are instanced at the ends of every lead, so they
  stay small.
- **Decision.** Values in mm, in `scripts/assets/blender/dupont.py`.
  - Edges rounded 0.1. A latch window 1.2 x 1.4 and 0.5 deep on each side, its centre 3.6 above
    the mating face: the window a 2.54 mm crimp housing has over its terminal's tab, which photo
    3 is too small to show. The wire entry is a 1.8 square recess, 0.3 deep, round a 1.1 square
    hole, 2.0 deep.
  - The male's pin has a 0.26 tip tapering over 0.4 mm, and runs 3.0 mm up into the housing; a
    1.5 square recess, 0.25 deep, surrounds it.
  - The female's mouth is 1.7 square funnelling over 0.35 mm into a 1.0 square cavity, 6.5 deep,
    in `metal`.
  - AO is baked into a 256 x 256 atlas; there is no normal map.
- **Consequences.** About 170 triangles and 55 KB each. The male's pin is one piece with the
  housing in the mesh, so the studio cannot hide them separately.

## ADR-A2-5 Textures-only assets, and the controller checks beside verify.ts

- **Context.** The ribbon is two textures and no mesh, so `build.ts`'s GLB path does not fit it.
  `verifyAsset` branches two ways, on breadboard or Pi, and is outside this change.
- **Decision.**
  - An `Asset` may list `ktx2` files. The Blender script saves a PNG for each beside its output,
    and `build.ts` encodes them with `ktx create` (UASTC level 2, zstd 18, mipmaps for the
    ridge map; lossless sRGB RGBA8 for the lookup) and writes the manifest, with no geometry
    hash. `Manifest.geometryHash` is optional for that reason, and `provenance()` holds the part
    of the manifest the two paths share.
  - `controllers.ts` holds the controller assets' checks and re-implements the hash, budget and
    texture findings of `verifyAsset`. `check.ts` and `models.test.ts` choose between it,
    `verify-parts.ts` and `verifyAsset` by kind.
  - `check --rebuild` compares the lookup byte for byte and the ridge map by SSIM, like the GLB
    textures.
  - Colour and normal bakes use 16 samples (they need only anti-aliasing: flat colour and
    ridged geometry), and AO uses the pipeline's 128, at fixed seed.
- **Consequences.** If `verify.ts` later dispatches by kind, the three shared findings can move
  back. A texture asset costs about 2 s to build; the T-board about 20 s.
