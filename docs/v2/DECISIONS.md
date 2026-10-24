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

## ADR-0037 T-board model: shape values beyond tboard.json, and the box header's pin 1

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

## ADR-0038 IDC socket: a 3M 891 body seated on the header's rim, cable and bump on the key wall

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
    cable runs away from the stem. Pin 1 is the row beside the bump (ADR-0037), at +y;
    `cable-a` is at +y, conductor 1's edge.
  - The socket's origin goes on the rim: its body rests on the shroud and is not inserted into
    it. The shroud's cavity (6.4 wide) is narrower than the socket (9.0), so the two do not
    interlock in the model.
  - The cover's moulded ribs are a high-poly copy baked to the normal map; AO is baked.
- **Consequences.** A socket seated on the rim hides the header's pins, which is what shows at
  bench distance. If the studio wants the socket inserted, it needs a deeper contract (the
  seating depth, and a shroud cavity that fits) and a new header.

## ADR-0039 Ribbon: two baked textures, a raised-cosine ridge, a lossless lookup

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

## ADR-0040 Dupont ends: housing detail as geometry, AO only

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

## ADR-0041 Textures-only assets, and the controller checks beside verify.ts

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

## ADR-0042 A lead's length is sold tip to tip; reach counts only its wire

- **Context.**
  - `reach.ts` compared the distance between a lead's two wire exits (each housing's top),
    plus a bend allowance, with `lengthMm` itself, so it treated all 200 mm as free wire.
  - Photo 4's 200 mm callout for the Dupont bundle ends at the outermost pin tips, so the
    listing's length runs tip to tip. `dupont.json` gives 12 mm housings and 5.5 mm exposed
    male pins. A 200 mm male–male lead therefore has 165 mm of wire between its housings.
  - The cable solver (M8) needs the same figure for a lead's rest length.
- **Decision.**
  - `lengthMm` stays the length as sold, which build steps quote ("a 20 cm lead").
  - `wireLengthMm(lengthMm, kind)` gives the wire between the housing exits: the length less
    two housings, less one exposed pin per male end. Solid jumpers are all wire.
  - `leadReach` reports it as `wireMm` and passes a lead only when the span fits it;
    `autoLength` picks the shortest inventory length whose wire has 10% slack.
  - `LEAD_TOO_SHORT` names both figures.
- **Consequences.**
  - The check is 35 mm stricter for a male–male lead. Every tutorial still passes it.
  - The M8 integration gives `CableWorld.addLead` the wire length, so the physics and the
    ERC agree on when a lead goes taut.
  - The ribbon's 200 mm (photo 4) is left as it was: its callout's ends sit at the sockets,
    and `ribbonReach` already measures between them.

## ADR-0043 The displays, ICs and modules are seven Blender families on the part registry

- **Context.**
  - SPEC 7 and 10.4 ask for a Blender family script per footprint family, parameterized by the
    part definitions' datasheet dimensions: DIP, seven-segment, bar graph, dot matrix and
    modules. The registry, `partkit.py` and `verify-parts.ts` came from the on-board lane
    (ADR-0029 to ADR-0032), where parts carry no textures.
  - The studio draws these parts' value-dependent detail itself (SPEC 10.4, 10.6), which asks for
    names it can find: segments, bars, dots, the relay's LED lens, the LCD's screen quad.
- **Decision.**
  - Seven families in `parts.ts`, named by the definitions' `geometry.family`: `dip` (3 files),
    `seven-segment` (2), `seven-segment-4digit`, `bar-graph`, `dot-matrix`, `motor` and `module`
    (12 files: one script, a variant per `geometry.params.variant`, or the definition's id for
    the two definitions that name none). `seven_segment.py` draws both seven-segment families.
  - `blender/devicekit.py` builds on `partkit.py` (arguments, root, pin empties, Builder, export
    with extras) and adds what these need: tapered boxes, frusta, tubes and drilled slabs; a decal
    baked from text and shapes; boards with a baked legend and male headers; the STEP helpers.
    `partkit.start()` takes an `add_args` for a family's own arguments.
  - Textures are allowed where a file's budget names a size: the DIPs' part-number marking, the
    boards' silkscreen legend, the DHT11's grille, the relay's case top and terminal face, the
    keypad's keys, the LCD's screen, the housings' socket holes. They are KTX2 (ETC1S), at most
    1024 x 1024, and `assets:check` still demands none from a file whose budget names none. What
    is printed on a board has no geometry to be, and a 20 x 6 mm chip top is not worth a mesh
    per letter.
  - `verify-parts.ts` gains the checks for off-board modules (below), per-pin axes, a body taken
    from named top-level nodes, and the LCD screen's size and UV orientation.
  - Budgets per file: 14 to 9,000 triangles and 12 to 300 KB, each about 20% over what the script
    makes. The 21 files total 0.67 MB with their manifests and colliders; the largest is the
    ADS1115 at 229 KB and 7,500 triangles.
- **Consequences.**
  - The displays' segments, bars and dots are separate nodes of one shared material; the studio
    gives each node its own material to light it.
  - A new module is a function in a `mod_*.py` file, an entry in `module.py`'s table and one in
    `parts.ts`'s `MODULES`.

## ADR-0044 Off-board modules lie on the table with the definition's pin layout and a header on top

- **Context.** The part GLB contract puts an off-board module's origin at its footprint corner on
  the table, its header pins in the model, and `pin-<id>` at each pin tip, axis out along the pin.
  The definitions give each pin an `offsetPitch` from the first pin "as a layout hint", and their
  `bodyMm` as the module's [x, y, z]. Several real boards carry the header on the other side or
  along their short edge (the HC-SR04, HC-SR501 and KY-023 plug into a breadboard upright; the
  LCD's backpack is behind the glass), and no source read shows which.
- **Decision.**
  - The model's x axis runs along the header row and y across it, so a pin's `offsetPitch`
    maps onto the model without a rotation: pin i is at pin 1 + `offsetPitch` * 2.54 mm
    (a screw terminal block at its own pitch, 5 mm for the relay). `bodyMm`'s x and y are the
    model's. `assets:check` measures each pin against the first within 0.05 mm, the 2.54 mm pitch
    of header neighbours, and the origin: the model's lowest x, y and z are 0, which
    `module.py` sets by moving every top-level node after the variant is drawn.
  - Every header is straight, on the board's top face, pins up (6 mm above a 2.5 mm base, 1.5 mm
    tails below), so a female Dupont housing mates from above whichever side the real board
    has it on. The module rests on the tails. The empties are at the pin tips, +z up.
  - Female connectors lie flat on the table with their sockets facing -y, away from the module:
    the keypad's 1 x 8 housing at the end of its 86 mm tail (flat, 0.35 mm), the SG90's 3-way
    housing at the end of its 250 mm cable (three 1.1 mm wires, straight), and the relay's three
    screw terminals, whose entries face out of the board's far edge (+y). `parts.ts` lists those
    axes, and `assets:check` measures them within 1 degree.
  - The servo's cable and the keypad's tail run along -y from the long side, not from the end
    the real part uses, because the definitions put the sockets in a row along x. The cable
    lengths are the definitions'; the motor's leads, which no source gives, are 100 mm.
  - The bare DHT11 is a rigid part: the origin on pin VDD's hole, empties down, and the housing
    2.0 mm above the board; its definition's 8 mm leads are the runtime's.
  - The DHT11 breakout stands its sensor upright on the board (the sensor is 15.5 mm tall,
    12 mm wide and 5.5 mm thick, as the Aosong drawing shows), so the definition's `bodyMm` height
    of 5.5 mm is not the model's; `assets:check` compares that module's footprint only.
- **Consequences.** A studio that rotates a module on the table rotates its pins with it. A
  module whose real header is on the other side or edge looks different from its photo; the
  README lists which. If a source later shows a header's real side, that module's script moves
  its header and its `axes` entry, and nothing else changes.

## ADR-0045 Two models come from Adafruit's STEP files; the others are drawn from their datasheets

- **Context.** SPEC 10.4 prefers, for an off-board module, the manufacturer's official STEP
  through the pipeline, if its licence allows redistribution, then a Blender model from the
  datasheet drawing. Never an unlicensed model.
- **Decision.**
  - The ADS1115 breakout is Adafruit product 1085, the very board the definition's variant
    names, and the 130 motor is Adafruit product 711, the datasheet the definition cites.
    Adafruit publishes both as STEP in `adafruit/Adafruit_CAD_Parts`, licensed MIT (Copyright
    (c) 2016 Adafruit Industries), which permits copying and redistribution with the notice.
    They are pinned in `sources.json` by SHA-256 at commit `c128bce` (2026-10-01), with the
    licence as its own entry, retrieved 2026-10-24, and read by `step-to-glb.ts`. `Asset.step`
    takes a bare pinned file (no `file`) and a `licenseSource`, so a STEP need not be in an
    archive. The licence text goes in each manifest and the notice in each GLB.
  - The ADS1115's STEP is a bare board: Adafruit ships the header loose. `mod_ads.py` checks the
    ten pads the definition names are drilled where the pins go (within 0.05 mm) before it draws
    the header on them, lifts the board onto the tails, makes the 3 x 3 mm converter black, and
    bakes a 512 x 512 occlusion map.
  - The motor's STEP has two bodies, the can with its shaft and the end cap with its lugs.
    `motor.py` turns the motor onto the table, splits the shaft into `rotor`'s child and the lugs
    into `terminals`, and adds the leads and housings, which the STEP lacks.
  - `step-to-glb.ts` accepts more meshes than it counted bodies: an assembly can place one body
    several times (the ADS1115 repeats its passives), and each placement reads as a mesh. Fewer
    still fails.
  - Every other module is drawn in Blender from the datasheet drawing where one exists (the
    Kingbright, Toplite, TI, Aosong, Elecfreaks and LCD-1602A drawings) and from the definition's
    figures where they are the only source. The search for an official STEP covered Adafruit's
    CAD repository, whose other servos, joysticks and motors are different parts (a metal-gear
    micro servo, a thumbstick, a TT motor). For the other parts' makers (TowerPro, Elecfreaks,
    LAFVIN, Songle, Joy-IT, the kit's relay and power boards) it went no further than the sources
    the definitions cite. A STEP found later, with a licence that permits redistribution and
    pinned the same way, would replace the Blender model.
- **Consequences.**
  - The motor's can is 30 mm long in Adafruit's STEP and 27.5 mm in the datasheet's figure,
    the difference being the bearing boss; `assets:check` allows 2.6 mm on that axis only.
  - Each of the two files weighs 28 KB (motor) and 229 KB (ADS1115).

## ADR-0046 The displays and the DIP follow their datasheet drawings, snapped to the board's grid

- **Context.** The definitions snap their pins to the 2.54 mm breadboard grid: the dot matrix's
  real 2.5 mm pitch and 15 mm rows are 2.54 and 15.24 mm, and the bar graph's recommended 7.5 mm
  rows are 7.62 mm. Kingbright's four-digit drawing puts its 12 pins in a block 12.7 mm wide at
  the middle of a 50.3 mm body.
- **Decision.**
  - The body is centred on its pins, as each drawing shows, so the four-digit display's body
    overhangs its pins by 18.8 mm each side. The dot matrix's dots stay on their 2.5 mm pitch,
    centred on the body, a pin up to 0.14 mm off the dot above it.
  - Standoffs: the DIP's 0.51 mm minimum (TI MPDI002C); 0.5 mm under each display, whose
    drawings give none, so a lead and a gap show. The segments, bars and dots stand flush with the
    body's stated height and the face lies 0.05 mm below them, so the height is the stated one and
    the surfaces do not fight.
  - The digit is Kingbright's: 14.22 mm tall, 8 mm across including the slant, segments 1.5 mm
    wide, slanted 8 degrees (both drawings give these), and a decimal point 1.5 mm across at the
    lower right.
  - The DIP has the half-round notch (1.0 mm radius, 0.5 mm deep) and the pin-1 dimple cut with
    an exact Boolean, the drafted body sides (0.25 mm), and its top marked with the part number
    (`SN74HC595N`, `ADC0834CCN`, `L293DNE`) in a KTX2 map.
- **Consequences.** The studio places the dot matrix's pins from the definition and its dots from
  the model; a dot is never more than 0.14 mm from the hole row it belongs to. The displays'
  segment shapes are mine, from the drawing's outline; a lookdev pass can refine them.

## ADR-0047 The bench and the parts are instanced per model file, with handles per copy

- **Context.** SPEC 10.8 asks for repeated meshes to be instanced: the Pi's 40 header pins, a
  Dupont housing at every lead end, identical parts. The sim-driven visuals (SPEC 10.6, 11.5) need
  each placed part's named meshes, materials and nodes: an LED lens's emission, a ring's colour, a
  plunger's travel. ADR-0026's `Models` clones a node tree per placement, which instances nothing.
- **Decision.**
  - `studio/instances.ts` (`ModelInstances`) draws one loaded GLB any number of times: an
    `InstancedMesh` per mesh in the file, each copy's matrix being its pose times the mesh's place
    in the model. The T-board, both IDC sockets, the two Dupont housings and every part file use
    it. The Pi's pins are one `InstancedMesh` of 40 posts from `pi5-board.json`'s header. The
    boards and the Pi's body stay in `Models`.
  - A copy's colour, emission and node transforms are set by name: a mesh's, an ancestor node's
    or a material's. Colour uses `instanceColor` over a white copy of the material; emission an
    instanced attribute that a node-material copy reads as its `emissiveNode`; a node transform
    composes after the node's own into the copies' matrices. Each is built the first time
    something asks for it.
  - `view.part(id)` returns a `PartHandle` (`names`, `setColor`, `setEmission`, `setTransform`)
    whose settings the parts layer keeps per part and puts back after every redraw;
    `view.piPin(physical, color)` tints a header pin.
  - The resistor's rings come from `resistorBands`; an LED's lens takes a tint per `color`
    option. A 1 % value, five bands, shows as its four-band reading with the 1 % ring, because four
    rings are modelled (ADR-0031).
- **Consequences.**
  - No per-copy `Mesh` exists. A copy needing its own texture (the LCD's characters) gets it from
    a mesh of its own, which the handle does not yet give.
  - The first `setEmission` or `setColor` on a mesh builds its material copy, a shader compile
    once.
  - Segments, bars and dots are separate meshes in their files, so each is its own instanced mesh:
    64 for the dot matrix, whatever the number of matrices.

## ADR-0048 Where part bodies seat, and how their leads bend

- **Context.** The part contract (ADR-0030, ADR-0044) gives rigid origins on pins[0]'s hole,
  flexible parts' `seatMm` and pin spacing, modules' origins at their lowest corner with pins on
  the definition's layout, and `pin-<id>` empties with their axes. The leads are the runtime's, at
  the real diameter. The resistor's definition calls a 1- or 2-pitch span an upright mount.
- **Decision.**
  - A flexible part lies at its seat height midway between its holes, turned to them. An axial
    one (its pins' axes level) whose holes are closer than its pin spacing plus two lead diameters
    stands on end over pins[0]'s hole, `seatMm` above it.
  - A module is placed with its first pin's x and y at the document's pose, where core already
    puts that pin. Once its model loads, its pins' heights and axes and its footprint replace the
    assumed ones (`ASSUMED_HEIGHTS_MM.modulePin`) in the studio's drawing, picking, labels,
    selection box and lead ends. Core's reach keeps its assumption.
  - A lead is a polyline of corners from the empty to 2 mm down its hole, bent at one lead diameter:
    straight down; down to a knee halfway, across and down; along an axial body, then down; or up,
    over and down from a body on end. Its diameter is the first of `leadDiameterMm`, `leadDiaMm`,
    `leadDiaMaxMm`, `leadSquareMm`, `leadWidthMm`, `leadWidthMaxMm`, `pinWidthMm`,
    `terminalWidthMm` in the params, read with the variant prefix (`5mm.`) where one applies.
    A part's leads are one merged mesh.
  - A part whose file is missing or fails draws no body, and its leads as 3 mm stubs out of its
    holes; its footprint markers stay.
- **Consequences.** Every tutorial's parts draw with bodies; their lead ends measure within
  1e-5 mm of their holes' axes. A radial part seated 1 mm up has little room for its knee. Square
  and flat leads are drawn round.

## ADR-0049 Dupont housings mate by gender; the Pi's socket turns a quarter

- **Context.** SPEC 6.5: a male end goes into a hole or a female socket, a female end onto a male
  pin. The housings' origins are the male's pin tip and the female's mouth, with a `wire` empty
  where the wire leaves. The Pi end of the ribbon has brown on the edge away from the ports.
- **Decision.**
  - An end is male unless it is on a module's male pin. A male's tip goes the exposed pin's
    5.5 mm into what it plugs into; a female's mouth sits that far down the pin (ADR-0044's pins
    stand 6 mm, so it rests 0.5 mm above the base). The housing's axis follows the end's (up from a
    hole, the module's pin or socket axis otherwise), turned square to the board. Solid jumpers
    have no housing.
  - The wire's tube starts at each housing's `wire` empty, runs 3 mm (`minBendRadiusMm`) along the
    housing's axis and arches as before.
  - The Pi's socket rests on the header base's top (5.326 mm, pi5.colliders.json), turned +90°
    about the Pi's z so contact 1 meets pin 1; its cable then leaves toward the Pi's middle with
    brown away from the ports. The T-board's sits on the `socket` empty unturned.
- **Consequences.** The rigid cables in the servo's and keypad's models (ADR-0044) run straight
  wherever the document puts the module, through a board if it is in the way.

## ADR-0050 The ribbon's design curve rises in a loop

- **Context.** The ribbon's strip is drawn between the two sockets' cable lines along a design
  curve of `ribbon.json`'s 200 mm until the physics lane (M8) simulates it. On the bench layout
  the two exits point 90° apart in plan (the Pi's toward the front, the T-board's toward the Pi),
  and the cable's face must turn over between them. A flat cable cannot bend in its own plane;
  lying on the table it could turn only by folding. Photo 1 shows the real cable rising in a loop.
  A first design that sagged the slack onto the table crumpled where it turned.
- **Decision.**
  - The centreline is a centripetal Catmull-Rom curve through the two exits, points 20 mm out of
    each, and a crown that leans `s` toward where both exits point and stands `s / 2` above the
    higher exit. It is held above the table, the boards' tops and the Pi's PCB. `s` is found by
    bisection so that the drawn rows' middle measures the cable's length.
  - The cable's width follows rotation-minimizing frames from the Pi's exit line; the twist left
    at the T-board's is spread in proportion to how steeply the cable runs, where a flat cable
    twists most easily.
  - Rows every 2.5 mm with 9 points across (the physics grid has 5 to 9). With 2 points the
    colours kinked along each quad's diagonal wherever the strip bent in its plane.
  - The strip's u runs from conductor 1's edge, v one unit per pitch along; the colour lookup is
    sampled nearest, the ridge map repeated. Its geometry is a function of the rows, so the
    simulated grid can replace them.
- **Consequences.** The design is a loop standing as if stiff, not a drape onto the table; the
  simulation replaces it. A span longer than the cable is drawn at its shortest design, not taut
  and tinted (SPEC 10.5 gives that to the simulation).

## ADR-0051 Committed parts and lead ends seat over 150 ms; GPU resources go with the Studio

- **Context.** SPEC 10.6 and 11.3: parts and leads seat with an eased insertion of about 150 ms.
  SPEC 10.8: dispose on unmount. ADR-0026 left GPU resources to the renderer's disposal.
- **Decision.**
  - Against the committed document last drawn, every part whose placement changed and every lead
    end whose endpoint changed drops 4 mm into its holes over 150 ms, eased out. While a drag
    previews it, it hovers at 4 mm. Frames run while anything is dropping. Undo, redo and opening
    a document seat what they move; moving a board, which changes no hole, does not.
  - When the Studio detaches, its layers free their geometry, instanced meshes and materials, and
    every loaded model's and texture's GPU side; the layers stay usable, and React's development
    remount draws them again. A document change frees what it removes: a part's leads, a file
    nothing uses any longer, rebuilt tubes and the ribbon.
- **Consequences.** The scene still stops drawing once the drop and TRAA's settling frames end.
  Opening a tutorial seats all of it at once.


## ADR-0052 Lead currents are derived from the snapshot by Kirchhoff's law

- **Context.** SPEC 11.5 asks for dashes along each lead whose speed follows its current. The simulator
  solves one node per net (core/sim/circuit.ts), so a lead has no current of its own, and the
  snapshot carries only LED die currents, GPIO currents, the two supplies' currents, net voltages
  and each behavioural part's view.
- **Options.** (a) Add per-pin currents to the snapshot (core and the sim worker change). (b) Derive
  lead currents in the Studio from what the snapshot has.
- **Decision.** (b), in `studio/flow.ts`, so that nothing outside the Studio changes.
  - The nodes are rigid clusters: a strip with the parts standing in it, a module pin, the T-board's
    strips with their header pins and the header's supply pins, joined as the netlist joins
    everything except leads. The leads are the edges, each counted as the same small resistance.
  - What each cluster takes from outside comes from the snapshot where it names it (LED dies, GPIOs,
    `rails`) and from Ohm's law for the resistive parts (resistor, passive buzzer, potentiometer, LDR,
    NTC, from the same formulas as the simulator and the part inputs). A part with no current in the
    snapshot (ICs, motor, relay, servo, transistors, switches) takes what is left of its net, split
    between its clusters; a net with no such part gives what is left to the ground pins, else drops
    it. The potentials of the cluster graph are solved per net and a lead's current is its end
    difference.
  - Current is conventional, positive from a lead's end `a` to its end `b`.
- **Consequences.**
  - Leads in series with an LED, a resistor or a GPIO carry exactly the circuit's current (tested
    against the Blinking LED and the Button). Leads around a behavioural part carry the remainder of
    their net, which is right for one such part per net and approximate for several.
  - A snapshot with per-pin currents would replace this (core request B4-A in the lane report). The
    resistive formulas are the one place the Studio repeats the simulator's models.

## ADR-0053 The sim-driven visuals are one layer that writes through the part handles

- **Context.** SPEC 10.6 and 11.5: parts glow and move from simulation state; the scene renders
  continuously only while something animates (SPEC 10.2); a still scene renders no frames.
  Snapshots arrive about every 33 ms while a program runs, whether or not anything changed.
- **Decision.** `studio/simvisuals.ts` (`SimVisuals`) is built by the view and fed one `SimInputs`
  (the drawn document, the snapshot, the part inputs, the issues, the Inspect toggles and Board
  Sense's states) whenever the workbench store, the studio store, the sense store or the drawn
  document changes.
  - It writes to what already exists: part handles (`setEmission`, `setTransform`, `setTexture`), the
    lead layer's overlays, a halo layer, a marker set and the tag layer. Each write is compared with
    the last one first, and only a change asks for a frame, so snapshots that change nothing leave
    the scene still.
  - Motion is `Motion` channels (`studio/motion.ts`): an ease (exponential, a time constant of 20 to
    50 ms) for the plunger, shaft, horn and armature, and a spin (speed eased, angle integrated)
    for the rotor. `StudioView.frame` calls `visuals.step`, which reports whether any channel is
    unsettled or any lead has current flowing; those frames count as moving, so the scene renders
    continuously then and settles through TRAA's 16 frames after.
  - The dashes run while current flows and the Current toggle is on, so a circuit with a steady current
    renders continuously until the toggle is turned off. Measured: 42 fps in headless Chromium and
    60 fps in the Tauri window (WKWebView's rate cap), on this Mac.
  - A channel's first transform is applied on its first step, and a spin counts as moving on the frame
    it starts (no time has passed on it).
- **Consequences.** `view.report().sim` reads back what was applied (lit nodes, channel values, lead
  speeds, halos, tags, tint counts, LCD lines) for the e2e tests.

## ADR-0054 A node's extra transform is in millimetres about the node's origin; a copy can have its own texture

- **Context.** ADR-0047's handle composed a node's extra transform after the node's whole matrix,
  which for a quantized mesh node includes its scale: a plunger node has scale 1.75, so a travel of
  1 mm would have moved 1.75 mm. It also gave no per-copy texture, which the LCD's characters need.
- **Decision.**
  - `ModelInstances.local` places the extra between the node's translation and rotation and its scale
    (`T R extra S`), so a translation is in mm and a rotation is about the node's origin, in the node's
    own axes. A node without an extra, and every pivot (scale 1), is as before.
  - `PartHandle.setTexture(name, texture)` sets the colour and emission map of the meshes called
    `name` for that copy. The copy is drawn as a mesh of its own with a cloned material (the
    instanced copy is hidden by a zero-scale matrix), follows the copy's pose, lift and node
    transforms, and is cleared by `set()`, after which the parts layer puts the texture back from the
    handle's state. Handle setters write only their own channel and look the copy up again each call,
    since a redraw can move it inside its file.
- **Consequences.** A copy with a texture is one more draw call and one more material, for the LCD
  only. A model with a per-copy texture on many copies would want an atlas instead.

## ADR-0055 The LCD draws the HD44780's display RAM into the module's screen quad

- **Context.** SPEC 10.6: characters from the HD44780 model, drawn into the `lcd-screen` texture. The
  model exposes the 16 x 2 window's character codes, CGRAM, the cursor and the backlight (`view()`).
- **Decision.** `studio/lcd.ts`: one canvas of 562 x 115 px (10 px per mm of the 56.2 x 11.5 mm quad,
  glTF's UV origin at the top left, so `flipY` is off), per LCD. A character is 5 x 8 dots of 5.4 x 5 px
  on the datasheet's 3.55 mm cell pitch; lit dots are near white on the backlight's blue, unlit dots
  a faint shade, an unpowered module a dark glass and an unlit backlight a dim one. The glass is lit
  by emission (the same map), so it reads under any light. The picture is redrawn only when the
  view's JSON changes.
  - Glyphs for the ASCII range are a table drawn for this app (5 x 7 shapes in the layout of the
    controller's A00 ROM: yen at 0x5C, arrows at 0x7E and 0x7F); other codes show a box; codes 0 to
    15 are CGRAM's eight custom characters.
- **Consequences.** The katakana and symbols of the A00 ROM are not drawn. The blank-glass texture
  in the model's file is replaced, not blended.

## ADR-0056 Inspect: toggles, the Nets list, and a read-only Board Sense overlay

- **Context.** SPEC 11.2 and 11.5 list Labels, Voltages, Current flow, Nets (a list suffices, SPEC 21)
  and the Board Sense overlay; Live Pi state belongs to M11.
- **Decision.**
  - `studioStore` holds `voltages`, `current`, `nets` and `sense` beside `labels`. Voltage tags are
    DOM tags (as labels are) at the first part pin of each net with something on it, else its first
    lead end; the 3V3 net reads "3V3 3.30 V". A net that is only header pins has no tag.
  - The Nets list names every net with a part or lead on it, with its voltage; hovering a row draws
    all its strips and every lead end on it with the hover's markers (`view.highlightNet`).
  - Board Sense: each probed GPIO's net is tinted from `senseStore.states` (matched green, diverged
    red, ambiguous amber, settling and unobserved grey, skipped none): the strips' holes by markers
    and its leads by a tinted overlay tube. A net with nothing on it is tinted only when it
    diverged. A diverged net's tag carries the divergence's detail and its top two ranked causes;
    when `senseStore.candidates` has none for the pin, the overlay asks for them once, a simulation
    that senses nothing, which is what the Board tab's "Find likely causes" runs. The overlay
    never starts, stops or pauses sensing; the Board tab's buttons do. "Board Sense" in Inspect shows
    or hides the tint, and it only has an effect while sensing runs.
- **Consequences.** The overlay is silent when `senseStore.mode` is `off`.

## ADR-0057 Playing the circuit: switches in 3D, sliders in Properties, a pin menu

- **Context.** SPEC 11.5: during Simulate, click switches, drag sliders, toggle GPIOs from the T-board
  pin's context menu when no code runs; everything clickable outside the orbit controls' element.
- **Decision.**
  - A press on a tact switch sets its `pressed` input while the button is down and releases it on
    pointer up or when the press becomes a drag; a `retain` switch and a tilt switch change state on each
    press. Inputs go through `workbenchStore.setInput`, so they reach a running program and the
    static simulation alike. A press also selects the part, as before.
  - While a program runs, Properties' environment sliders and boolean inputs (`INPUT_PROPS`) send the
    value to the simulation as they move; otherwise they stay build choices, committed once on
    release.
  - A right press and release within 4 px on a T-board GPIO pin opens a menu (`studioStore.pinMenu`),
    rendered by `Studio.tsx` outside the orbit element: output HIGH or LOW, input with pull-up,
    pull-down or none. While a program runs it says the program owns the pins. The menu opens on
    release, so a right-drag pan does not open it.
  - A running program's snapshots recompute the issues that read currents (`simChecks`) against its
    document, and the netlist ERC once per document, so the ERC tab and the halos follow the run.
- **Consequences.** Pressing a switch while editing also works the simulation, which is harmless.

## ADR-0058 A part over its rating gets a halo and its issue in Properties

- **Context.** SPEC 11.5: a warning halo linked to its ERC issue.
- **Decision.** Parts named in the `refs` of an issue with a rating code (`LED_NO_LIMIT`, from both the
  netlist rule and the simulated-current check) get a soft additive glow on the board under their
  box (error red, warning amber) and a tag "D1: LED_NO_LIMIT"; selecting the part shows the issue
  and a button to the ERC tab. The halo is static, so it never keeps the scene drawing.
- **Consequences.** Issues that name GPIOs (`PIN_OVERCURRENT`, `OVERVOLTAGE_GPIO`) have no part to
  halo. More codes join by adding them to `RATING_CODES`.

## ADR-0059 Modelling choices of the visuals

- **Context.** The datasheets give no on-screen travel, swing or speed, and the models are drawn
  at rest.
- **Decision.** Each is a constant in `studio/glow.ts` or `studio/motion.ts`.
  - LED glow: emission is `4 * min(brightness, 2)^0.6` times the lens colour, brightness being the
    die current over its datasheet test current, so a die at its test current is at 4 (bloom starts
    at 1) and a faint one still shows. A display's segment, bar or dot lights as the same die; an RGB
    LED's lens shows its three dies mixed; the relay's indicator lights while its transistor drives
    the coil.
  - Tact plunger: 0.4 mm down its own axis (the Omron B3F actuates at 0.25 mm), eased over about 25 ms.
  - Potentiometer shaft: (wiper - 50 %) of the part's `rotationDeg` (300), a higher wiper clockwise
    seen from the shaft's end.
  - Servo horn: the behaviour's `angleDeg` (the datasheet pulse mapping, in the part definition), a
    longer pulse clockwise seen from above, eased over about 40 ms against the 33 ms snapshots.
  - Motor rotor: the behaviour's rpm over the no-load rpm, as a share of 3 turns a second, speed eased
    over 150 ms; real speeds would only strobe at 60 fps.
  - Relay armature: 6 degrees about its hinge, eased over about 20 ms.
  - Dashes: 5 mm apart, 4 mm/s per mA, at most 80 mm/s, none below 10 uA; a ramp whose sharp edge
    leads, so the direction reads in a still picture.
- **Consequences.** A later look-dev pass can retune them without touching the plumbing.

## ADR-0060 Rods and the ribbon centreline are solved as chains, not by Gauss–Seidel sweeps

- **Context.**
  - SPEC 10.5 asks for XPBD with small steps: 12 substeps a frame and one constraint
    iteration each. A first version projected every distance constraint once per substep, in a
    Gauss–Seidel sweep, with the bending constraint after it. Measured on a 200 mm lead between
    two holes 120 mm apart: with stretch last the lead zig-zagged (a ±1 mm saw tooth every
    2 mm, segments from 2.4 to 3.5 mm against a 3 mm rest); with bending last the lead shrank to
    149 mm. A second stretch sweep tightened the segments to about ±5% but left the shape.
  - The cause is conditioning, not iteration count. Bending and stretch are both near-rigid
    at this particle spacing and mass, so the result is whichever constraint goes last, and a
    compressive load needs one sweep per link to cross a 67-link chain.
- **Options.** (a) More sweeps per substep, which breaks "one iteration". (b) Softer bending,
  which cannot hold a lead up. (c) Solve each rod's stretch constraints together, exactly.
- **Decision.** (c). Linearised, the stretch constraints of a chain give a tridiagonal XPBD
  system `A dλ = −C` (`A = J W Jᵀ`), solved by the Thomas algorithm in O(n) (`solveChain`).
  It costs about one sweep and makes the whole chain inextensible every substep. Each substep
  runs: predict, hints, bending (symmetric forward-and-back sweep), solid-jumper goals, the
  chain solve, long-range attachments, then contacts. Distance constraints are rigid;
  bending is XPBD with `α = s³ / EI`; a touch of compliance (1e-6 relative) and a pivot floor
  keep a chain pulled exactly straight from dividing by zero.
- **Consequences.**
  - In-span leads hold their length to 0.02% (worst single segment 0.4%, from contacts), and
    the ribbon's centre column to under 0.5%, with clamped ends within 1e-5 mm of their frames.
  - A lead's bending cannot be stiff. `MATERIAL.leadEI` is 3e4 g·mm³/s² (0.03 N·mm²), two to
    three orders of magnitude below a real stranded jumper, because at 1e5 and above dense
    piles keep moving above the sleep speed. A lead would hold itself upright for about 23 mm
    above its housing and then fold. `housingBendFactor` makes the first joint five times
    stiffer, so the wire leaves a vertical housing within 3° of vertical (measured 2.3°).
  - Not tuned against the reference photos, which this build cannot read: every material
    constant is in `MATERIAL` (builders.ts) for that pass.

## ADR-0061 The ribbon is a centreline chain with rigid rows

- **Context.** SPEC 10.5 describes a particle grid held by stretch and shear constraints.
  A 41 × 7 grid held that way, one pass per substep, reached 31% edge strain and 5% across
  its width in the first settled scene (sockets offset sideways), and curved sideways, against
  a target of 0.5% stretch.
- **Decision.** The grid stays the interface (rows × columns of particles, contacts and
  triangles on it) but each row rides on a centre particle. Per substep: row centres are the
  mean of each free row; the centres form a chain solved like a lead (ADR-0060: curvature,
  `solveChain`, long-range attachments); the chain is kept in the plane between the two end
  frames; and every free row is laid out again from its centre, straight, with the true
  column spacing, turned by the two frames' width axes blended along the length. The first
  and last two rows (0 and 5 mm in; the data says ≈6) are clamped to the socket frames.
- **Consequences.**
  - Across-width spacing is exact (1e-6 mm), rows stay parallel, and the ribbon cannot curve
    sideways or twist: it bends only about its width axis, as SPEC 10.5 states. The two frames
    must agree on the width axis (x) and on which conductor sits at which x; a socket offset
    along x is shared out as an even shear.
  - Ribbon contacts act on single particles. A collider thinner than the particle pitch
    (5 mm along, 8.5 mm across at 7 columns) can pass between particles; leads use exact
    segment contacts. The ribbon does not collide with itself.
  - Row contacts are not rigid: a single-sided contact lifts the row's mean only, so an edge
    that meets a row at an angle is resolved over a few substeps.

## ADR-0062 Contacts: exact segment tests, hash broad phase, no cable-to-cable friction

- **Context.** SPEC 10.5 asks for particle contacts with box and capsule colliders,
  capsule–capsule and point–triangle tests in a spatial hash, and position-based friction
  "against surfaces". Particle-only tests let a 3 mm segment pass through a 2.4 mm part.
- **Decision.**
  - Rod segments (capsules of the wire's radius) are tested exactly against boxes
    (`segmentBox`: the squared distance is piecewise quadratic in the segment parameter, so each
    piece is minimised in closed form) and capsules (segment–segment). Ribbon particles use the
    point tests. Lead–lead is segment–segment; lead–ribbon samples each segment at ¼ and ¾
    against the ribbon's triangles (Ericson 5.1.5, 5.1.9).
  - The hash (8 mm cells, Müller 11) is built once a frame over every body's swept, padded
    boxes. A candidate pair is kept only if its closest points at the frame start are within
    reach + 0.75 mm skin + the bodies' expected travel, and the pair list then serves all
    twelve substeps. Collider candidates come from a per-body bounds test first.
  - Friction is Macklin et al. 2014 (cancel the relative tangential motion up to the Coulomb
    limit, scaled by the depth just resolved), μs 0.5 and μk 0.4, against colliders only.
  - Each substep solves cable–cable contacts first and surfaces last, in a fixed order. A
    contact moves its points at most 1 mm along the normal per substep, and no particle moves
    more than 3 m/s·h in a substep; positions that stop being finite are restored to the
    frame start.
- **Consequences.**
  - Penetration in the scripted scenes is at most 0.10 mm (pile of five leads), against a
    0.5 mm tolerance; every scene also asserts that contact happens (within 0.5 mm of touching).
  - Friction between cables was tried at three strengths and left piles creeping at 2–13 mm/s,
    above the 0.5 mm/s sleep speed; alternating the sweep direction per substep did the same.
    Both were removed. Crossed cables slide on each other.
  - A cable overlapping something at the start (a design curve drawn through a part) is
    pushed out over several frames, not in one.

## ADR-0063 Islands, sleep and wake

- **Context.** SPEC 10.5: an island sleeps when every particle stays below 0.5 mm/s for 30
  frames; any anchor change wakes it; a lead resting on a part reacts when the part moves.
- **Decision.**
  - A body's speed is its fastest free particle's displacement over the frame. An island is
    the connected set of bodies whose cables came within contact range this frame (union–find
    over the kept pairs); it sleeps when all its bodies have been quiet for 30 frames, and its
    bodies keep one group id so they wake together.
  - Waking: `setAnchor` with a changed pose; `setColliderPose`, `addCollider` and
    `removeCollider` for every body whose bounds are within 5 mm of the collider's swept
    bounds; `removeBody` likewise; and an awake body's boxes overlapping a sleeper's.
  - A body that has slowed below 40 mm/s is damped at 14/s instead of 2/s, so it reaches the
    sleep speed instead of hovering above it. `settle(maxFrames)` runs that damping throughout
    and stops when everything sleeps or after the bound; the bound is in frames, not wall time,
    to stay deterministic.
- **Consequences.**
  - A lead alone sleeps 45 frames (0.75 s) after the last anchor input; a lead settling from
    its design curve takes about 85 frames.
  - A dense pile of 40 leads on one board settles slowly: a few leads creep for more than
    5 s, and since they touch, their island stays awake. The scene stops rendering only once
    the whole pile is still.
  - Sleep is per island: `isAsleep(id)` reports the island's flag, and `islandOf(id)` labels
    it.

## ADR-0064 Over-span: the flag follows the reach rule, the relaxation follows the span

- **Context.** SPEC 10.5 and 16 require a lead or ribbon whose ends are farther apart than
  its length to relax into a straight, taut span and report itself taut, in agreement with
  LEAD_TOO_SHORT. `core/reach.ts` flags a lead when the housing-tip distance plus two minimum
  bend radii exceeds `lengthMm`, and a ribbon when the socket distance plus two clamped ends
  exceeds its length.
- **Decision.** `isTaut` uses exactly that rule, from the same data files. The span itself
  relaxes only when the clamped ends are farther apart than the free span can reach: every
  rest length along the cable is scaled by `D / L`, and the free particles are laid on the
  line between the clamps (`straighten`), because a taut chain's constraints barely see
  lateral motion and the solver otherwise sags 1.9 mm off the line on a 130 mm span.
- **Consequences.**
  - Between `L − 6 mm` and `L` a lead is flagged but still drapes: it has real slack and no
    straight shape to take. The renderer tints on the flag; it should not assume straight.
  - A straightened span ignores obstacles under it each substep, then contacts push it off;
    it does not drape over a tall part. It is a warning state.
  - `lengthMm` is the wire between the two housing tips, as `reach.ts` assumes. If the 200 mm
    in the listing includes the housings, the physical lead is 24 mm shorter than this
    treats it. `core/` owns that call.

## ADR-0065 The IDC socket plugs 5.08 mm into the box header, whose cavity is sized to its body

- **Context.**
  - ADR-0038 rested a 9.0 mm wide socket on the shroud's rim, because the shroud's cavity (6.4 mm)
    was narrower. Photos 1 and 3 show the real socket plugged down into the shroud, its cover and
    strain relief above it.
  - The 3M 891 sheet (TS-0449-L, sheet 2; its page rendered to an image and read, with its text
    layer as a check) gives for 40 contacts: the body's bottom view .240 in (6.10 mm) wide; B = 2.03
    in (51.6 mm), the body's length; A = 2.18 in (55.4 mm), the cover with its latch ears; the
    preassembled side view's .200 in (5.08 mm) step below the cover and .14 in (3.6 mm) cover
    plate; and an assembled height of .42 in (10.7 mm). ADR-0038 had the width at 9.0 and the
    length at 21 pitches (53.34, a pitch of margin beyond the end contacts); the width was a guess and
    the length the cover's, not the body's.
- **Decision.** Values in mm, in `idc.py` and `tboard.py`.
  - The socket's lower body is 6.10 x 51.6. The cover keeps its 7.1 mm body and 3.6 mm plate (10.7
    in all) and gains two latch ears, 1.9 long, flush with the body's width, from 5.08 mm above the
    mating face up to the cover's top: 55.4 over all. The socket stands in a header with its mating
    face 5.08 mm below the rim and its ears on the shroud's end walls.
  - The shroud's end walls go from 1.9 to 2.95, so its cavity is 6.40 x 52.60 (it was 6.40 x
    54.70): 0.15 clear either side of the body, 0.5 at each end, the ears overlapping each end wall
    by 1.4. The long walls, the key slot (6.5 wide, 4.5 deep) and the pins are as before. Photo 6's
    end wall, with its window, is thicker than the long walls.
  - The polarization bump is 6.0 wide and 1.2 out of the wall, from 0.8 to 5.5 above the face, so it
    stands in the key slot above the slot's floor (0.58 above the face when seated; the bump's foot
    is 0.22 higher). It ends under the cable.
  - The cable leaves the -x wall (x = -3.05) at z = 6.3, its underside 0.75 above the rim's
    5.08, through a slot 50.9 long (the cable's 50.8, because the body is only 51.6). It was at
    x = -4.5, z = 6.0.
  - The 40 contact openings are 6.0 deep, not 2.2: the Pi's header posts stand 6.0 mm over its
    base, and the T-board's pins, which end 2.0 below the rim, enter 3.08 mm of a seated socket;
    neither pokes through the body's solid.
  - The `socket` empty moves from the rim (z = 15.3) to the seating plane (10.22), so the Studio's
    placement is unchanged. At the Pi the face still rests on the header base's top.
  - `assets:check` measures the socket's body, ears, seat and openings against the sheet's values
    (`IDC_3M` in `controllers.ts`), the cable's clearance of the rim, the `socket` empty, and the fit:
    cavity, ears, mating face above the floor, bump above the slot's floor, pins into the openings.
- **Consequences.**
  - Contract changes the Studio sees: `socket` at z = 10.22 (was 15.3), `cable-a` and `cable-b`
    at (-3.05, +/-25.4, 6.3) (were (-4.5, ..., 6.0)), the body 6.10 wide and 55.4 long over all (was
    9.0 by 53.34), the `strain-relief` collider from y = -27.7 to 27.7 and z = 5.08 up. The ribbon's
    exit at the T-board is 4.8 mm lower in the scene and 1.45 mm nearer the socket's middle.
  - `HIL_CHECKLIST.md` asks for the real seating depth; if it differs, `SOCKET_SEAT` and `PLUG`
    change together.
  - The socket's lower body at the Pi is narrower than before (6.1 against 9.0) and sits between the
    header's two rows of pins with 1.78 mm of body either side of the contacts.

## ADR-0066 Tin dulls to a matt grey, the mask loses its glare, and the Pi's mask and USB shells match its photographs

- **Context.**
  - Photos 3, 5 and 6 show the T-board's pads and solder as a dull grey tin, and its mask as a
    flat red. In the Studio the pads' cones were near-white points (luminance p99 238 of 255 in a
    close view of the stem; 212 once dulled) and, at a low camera angle, the mask washed to salmon: the coat's
    Fresnel reflected the studio HDRI over the whole face (a sample at the grazing angle read
    213, 161, 160, against the top view's 215, 0, 1).
  - Raspberry Pi's product brief shows a bright green board with silver USB shells. The STEP's
    CAD colours are a dark green (`004311`) and, for the USB-A shells, yellow metal (`ffd43e`).
- **Decision.** In `tboard.py` and `pi5.py`.
  - Pads, plated holes, vias and solder cones take a tin of base colour (0.70, 0.70, 0.72) and
    roughness 0.55 (was 0.84 / 0.86 and 0.25); the pins keep the nickel (0.84, 0.84, 0.86) at 0.30.
    The cones are smooth-shaded: an eight-sided cone had facets, each a glint.
  - The T-board's mask is roughness 0.9 with a clear coat of weight 0.06 and roughness 0.2 (was
    0.5 with a full coat at 0.08). The top view's red is 215, 0, 1 (photo 3: 208, 10, 14) and the
    underside's 184, 6, 2 (photo 5: 162, 1, 1).
  - The spacers' yellow is (1.0, 0.76, 0.0) (was 0.98, 0.80, 0.05).
  - The Pi's mask is `0f7a3b` with the same matt coat; its yellow-metal shells are `b8b8bc`.
    The material names stay (`solder-mask`, `step-<STEP colour>`), so `pi5.glb`'s contract holds.
- **Consequences.**
  - The yellow spacers read paler than the photo (201, 160, 107 against 245, 203, 26): AgX
    desaturates a bright yellow, and the grade of ADR-0067 recovers only part of it.
  - The Pi has none of the brief photograph's legends and logos: the no-graphics STEP carries none.
  - These changes are materials and shading only: the T-board's geometry hash changes with ADR-0065's
    shroud walls and not with these, and the Pi's mesh is the same triangles.

## ADR-0067 The stage is neutral and lit from above; AgX is followed by a colour grade; bloom takes only what passes 2

- **Context.**
  - SPEC 10.1 and photos 1, 3 and 6 call for a neutral studio look with white boards, saturated
    red and soft shadows. Measured in the Tauri window before the change, against the photos: the
    T-board's mask read 188, 74, 64 (photo 3: 208, 10, 14), the underside's yellow spacers 178, 139,
    98 (photo 5: 245, 203, 26), and the stage's greys carried a blue cast. AgX pulls a saturated
    primary toward orange, and leaves the studio's whites a step below the photos'.
  - The key light at (-260, 520, 340) put the shroud's shadow over the T-board's title.
  - A key light's highlight on the board's metal rings and on the Pi's shields passed the bloom's
    threshold of 1 and glowed, against SPEC 10.1's "bloom on lit LEDs".
- **Decision.** In `Stage.tsx` and `renderer.ts`; AgX stays the tone mapping, and no grain,
  aberration or lens dirt is added.
  - Table `#505153` and sweep `#6a6b6d` (were `#4a4d53`, `#65686e`): neutral greys. The key moves
    to (-120, 640, 220), 64 degrees up, with intensity 2.2 (was 3.0); its shadow settings are as
    before. The HDRI, its intensity of 0.6, GTAO and TRAA are unchanged.
  - The renderer's exposure is 1.7. The pipeline's own output transform is off, and the AgX
    mapping and sRGB encoding are applied in the pipeline's last node, followed by a grade: each
    pixel's distance below its brightest channel is stretched by `1 + 1.2 * smoothstep(0.1, 0.5,
    chroma)`, which leaves greys and whites where they are and takes a red back toward red.
    `GRADE` in `renderer.ts` holds the two numbers.
  - Bloom's threshold is 2 (`BLOOM_THRESHOLD`; was 1), strength and radius as before.
  - Result, in the same views: the T-board's top mask 215, 0, 1 (was 188, 74, 64; photo 208, 10,
    14), the underside's mask 184, 6, 2 (photo 162, 1, 1) and spacers 201, 160, 107 (was 178, 139,
    98; photo 245, 203, 26), the title box 205, 204, 202 and the breadboard 199, 199, 199 (photo
    209, 213, 215), the stage's grey 125, 125, 127, and no glow on the metal rings.
- **Consequences.**
  - A lit LED's emission has to exceed 2 (linear) to bloom, as the PartHandle's comment says of 1.
    The simulation's visuals (SPEC 11.5) must emit above that.
  - The grade acts on the final image only, so a screenshot's colours, not the models' base
    colours, are what the numbers above measure.
  - The breadboard and the yellow spacers stay a little below the photos' brightness and
    saturation (the photos are lit by a ring of lights; the Studio by one key and the HDRI).
