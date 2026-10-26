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
    boards' silkscreen legend (with the HC-SR04's transducer meshes and the DHT11 breakout's
    resistor code mapped from it), the relay's case top and terminal face, the keypad's keys, the
    LCD's screen, the housings' socket holes. They are KTX2 (ETC1S), at most
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

## ADR-0044 Off-board modules lie flat with the definition's pin layout and their headers as built

- **Context.** The part GLB contract puts an off-board module's origin at its footprint corner on
  the table, its header pins in the model, and `pin-<id>` at each pin tip, axis out along the pin.
  The definitions give each pin an `offsetPitch` from the first pin "as a layout hint", and their
  `bodyMm` as the module's [x, y, z]. Several real boards carry the header on the other side or
  as a right-angle header along an edge (the HC-SR04, DHT11 breakout, relay and KY-023 lay their
  pins out of an edge; the HC-SR501's points down from its component side; the LCD's backpack is
  behind the glass), as the kit's and the vendors' photographs show.
- **Decision.**
  - The model's x axis runs along the header row and y across it, so a pin's `offsetPitch`
    maps onto the model without a rotation: pin i is at pin 1 + `offsetPitch` * 2.54 mm
    (a screw terminal block at its own pitch, 5 mm for the relay). `bodyMm`'s x and y are the
    model's. `assets:check` measures each pin against the first within 0.05 mm, the 2.54 mm pitch
    of header neighbours, and the origin: the model's lowest x, y and z are 0, which
    `module.py` sets by moving every top-level node after the variant is drawn.
  - A straight header is on the board's top face, pins up (6 mm above a 2.5 mm base, 1.5 mm
    tails below), so a female Dupont housing mates from above whichever side the real board
    has it on. The module rests on the tails. The empties are at the pin tips, +z up. The
    HC-SR501's real header points down from its component side; the model stands it on the lens
    side's free end, beside a mounting hole, and runs the board's 32 mm along y to make room.
  - A right-angle header is drawn as the board has it, its pins along -y out of the board's near
    edge, with the empties at their tips pointing along -y: the HC-SR04's, whose base is on the
    back (the module lies on its back and rests on the bent pins), and the DHT11 breakout's, the
    relay's and the joystick's, whose bases are on top. A female housing slides on sideways, and
    the module is raised so that it clears what the module rests on (ADR-0139).
  - The LCD lies face up on its backpack, whose contrast trimmer is its lowest point. The
    backpack's right-angle header stands its four pins in a column along y, GND by the 16-pin
    edge, and points them past the module's -x end, the empties along -x.
  - Female connectors lie flat on the table with their sockets facing -y, away from the module:
    the keypad's 1 x 8 housing at the end of its 86 mm tail (flat, 0.35 mm), the SG90's 3-way
    housing at the end of its 250 mm cable (three 1.1 mm wires, straight), and the relay's three
    screw terminals, whose entries face out of the board's far edge (+y). `parts.ts` lists those
    axes and the right-angle headers', and `assets:check` measures them within 1 degree.
  - The servo's cable and the keypad's tail run along -y from the long side, not from the end
    the real part uses, because the definitions put the sockets in a row along x. The cable
    lengths are the definitions'; the motor's leads, which no source gives, are 100 mm.
  - The bare DHT11 is a rigid part: the origin on pin VDD's hole, empties down, and the housing
    2.0 mm above the board; its definition's 8 mm leads are the runtime's.
  - The DHT11 breakout lays its sensor on its back, grille up (15.5 x 12 x 5.5 mm, as the Aosong
    drawing shows), its legs bent down into the board and its top end 3.8 mm past the far edge, as
    the kit's photographs show; `assets:check` compares that module's footprint, with the
    overhang, only, because the board's size is read off a photo.
- **Consequences.** A studio that rotates a module on the table rotates its pins with it. A
  module whose real header is on the other side or edge looks different from its photo (the
  HC-SR501's); the README lists which. If a source later shows a header's real side, that module's script moves
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
  - The digit is Kingbright's: 14.22 mm tall, 8 mm wide along a row (the kit's display measures
    8.1 mm on its 12.7 mm face), segments 1.5 mm wide, slanted 8 degrees (both drawings give
    these), and a decimal point 1.5 mm across at the lower right. Segments meet in mitres at the
    digit's corners and in points at its middle, 0.3 mm apart, as on the kit's display.
  - The displays look like the kit's own parts, from SunFounder's photos of them: a white housing,
    a black face, white diffused segments, bars and dots, and the marking printed in black on the
    side along pin 1's row, as geometry (`2510SR-1  420`, `CL5611AH`, `788BS`). The parts not in
    the kit carry their makers' common-anode names: `CL5611BH` for the one digit and `5641BS` for
    the four. The dot matrix has square corners, as the 788BS has; its marking shows pin 1's side.
  - The DIP has the half-round notch (1.0 mm radius, 0.5 mm deep) and the pin-1 dimple cut with
    an exact Boolean, the drafted body sides (0.25 mm), and its top marked with the part number
    (`SN74HC595N`, `ADC0834CCN`, `L293DNE`) in a KTX2 map.
- **Consequences.** The studio places the dot matrix's pins from the definition and its dots from
  the model; a dot is never more than 0.14 mm from the hole row it belongs to. The black face
  keeps the displays readable on the white breadboard from the top and iso views.

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

Superseded in part by ADR-0143: this decision now governs the Studio look.

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

## ADR-0068 The physics worker: scenes in by message, steps out through a double-buffered SharedArrayBuffer

- **Context.** SPEC 4.3 and 10.5: the solver runs in `workers/physics.worker.ts`; the main thread
  sends kinematic anchors, colliders and route hints, never the document; positions and per-island
  flags come back through a SharedArrayBuffer, double-buffered so the renderer never reads a
  half-written step; nothing renders once everything sleeps.
- **Decision.**
  - The Studio (`studio/cables.ts`) sends the whole cable scene whenever it changes: every
    collider by key (`bb1/0`, `pi/12`, `R1/0`, `W3:a/0`) with its shape and core-frame pose, and
    every cable by a handle the Studio assigns, with its two anchor poses, wire length, live
    route hints and, for a routed lead, its start (ADR-0071). An unchanged scene is not sent.
    The worker (`PhysicsHost`) diffs it against its world: same key and shape moves a collider,
    a known handle moves its anchors and hints, a new handle builds a body, a missing one is
    removed. A handle changes when what the body was built from changes (its length, its
    committed route), so the worker never rebuilds a body on its own judgement.
  - The buffer (`workers/physicsTransport.ts`) is sized from the solver's pool (8192 particles,
    197 KB of positions): a 9-word header (front half, publish count, last applied scene, awake,
    last/mean/longest step in µs, two half generations) and two halves, each a table of up to
    256 bodies (handle, particle offset and count, rows, columns, drawn range, asleep and taut
    flags) and the particles in the core frame. The worker writes the half not at the front with
    its generation odd, makes it even, then publishes it as the front. The Studio copies the front
    half once per drawn frame and rereads its generation; a changed one means a torn read, and it
    reads again. Each half is one whole step, so its table always matches its particles.
  - The worker steps on its own 60 Hz `setTimeout` clock (a late step resets the clock rather
    than catching up), publishes every step, and stops when the world is still: every island
    asleep, or no particle faster than 0.5 mm/s for 30 frames (SPEC 10.5's sleep test over the
    whole world). The second test is there because two islands whose padded boxes overlap
    without touching wake each other in turn and never both sleep (seven-segment: 18 leads and
    the ribbon awake indefinitely at 1e-11 mm/s). A scene message starts it again.
  - The Studio counts frames as moving while the header says awake or a sent scene is not yet
    applied, so the frame loop stops 16 frames after the worker does.
  - Opening a document (the store's history is empty after the change) asks for a fresh world
    settled offscreen for at most 1 s; the Studio waits until every model and collider file the
    scene needs has arrived before it asks, and shows no cable until that settle is applied.
- **Consequences.**
  - The drawn cables trail their anchors by one or two frames. Each lead's two end points are
    drawn at the housings' current exits, so no gap opens at a housing while a drag moves it.
  - Without cross-origin isolation there is no SharedArrayBuffer: leads then draw their design
    curves and the ribbon is not drawn. The app is isolated in Vite and in Tauri (SPEC 13.2).
  - The dev overlay shows the worker's last step and the current run's mean and longest.

## ADR-0069 Cable geometry is rebuilt on the CPU, not in a TSL vertex stage

- **Context.** SPEC 10.5 asks for both to be measured: tubes and the ribbon strip rebuilt on the
  CPU each frame, or a TSL vertex stage that reads particle positions from a storage buffer.
- **Measured.** Heaviest tutorial (four-digit seven-segment: 37 leads and the ribbon), the board
  dragged back and forth for 4 s so every cable is awake, headless Chromium on the GPU (WebGPU,
  M-series Mac), GPU time from timestamp queries over all render passes:
  - CPU rebuild (`studio/tube.ts`: Catmull-Rom smoothing, three points per span, and
    double-reflection parallel-transport frames, written straight into the attributes): 0.75 ms
    per frame for the leads (p95 0.82), 0.91 ms with the ribbon (p95 0.98); GPU 1.9 to 2.8 ms
    a frame. A first version that went through `setXYZ` and built small arrays per vertex took
    3.1 to 3.3 ms.
  - TSL prototype (each vertex finds its ring on the spline from the storage buffer and carries
    the transport frame from the lead's start to its ring in a loop): 0.06 ms per frame on the
    main thread (copying the particles in); GPU 2.2 to 2.3 ms a frame. Both held 60 fps.
- **Decision.** The CPU rebuild. It costs under 1 ms of the 16.7 ms frame only while cables
  move; it keeps one path for the current-flow overlay (its dashes run on the tube's u, which a
  vertex stage would have to integrate too), for picking and the selection box (which read the
  smoothed centreline), and for the WebGL2 fallback, where storage buffers in a vertex stage
  depend on three's emulation. Geometry is refitted in place; it is reallocated only when a
  cable's particle count changes.
- **Consequences.** A scene several times heavier would want the vertex stage; the prototype's
  numbers say the GPU would absorb it.

## ADR-0070 How the bench becomes the solver's scene

- **Context.** SPEC 10.5: colliders from every `*.colliders.json`, placed by the documents'
  transforms; leads anchored at their housings; the ribbon clamped at both sockets with
  conductor 1 consistent; solid jumpers keep their shape; assistant ghosts are not simulated.
- **Decision.**
  - The solver runs in the core frame; a scene matrix M of a model built in core axes becomes
    the pose C·M·C⁻¹ with C a quarter turn about x. Each layer hands over what it placed: boards
    and the Pi by their transforms, the T-board and both IDC sockets as the bench draws them,
    part bodies at their drawn (and lifted) poses, the Dupont housings at their drawn poses, and
    a table box with its top at z = 0.
  - A lead's frame sits a housing length (12 mm) back along the housing axis from where the drawn
    housing's `wire` empty puts the exit, so the solver's exit is the drawn one, male or female,
    in a hole or on a module pin. Its rest length is `wireLengthMm` of the resolved length
    (ADR-0042), the figure `leadReach` uses.
  - A housing's box stops 0.75 mm (wire radius plus 0.25) short of its own exit, or its own
    wire would always touch it. A box that holds any lead's exit is left out: the exit is
    clamped and could never be pushed out. That drops the bounding boxes of modules whose box
    covers their header (the joystick's 32 mm-tall box encloses its pins).
  - The ribbon's frames sit on each socket's cable exit line, +y out of the wall and +x from
    `cable-a` (conductor 1) to `cable-b`, so column 0 is conductor 1 at both ends. Seven
    columns: with nine, the dht11 scene's ribbon settled 0.69 mm into the Pi's micro-HDMI box
    (single-particle contacts, ADR-0061); with seven it stays within 0.12 mm.
  - A solid jumper's frames sit 0.75 mm above its holes and its authored shape is the design
    curve between them; the drawn tube adds the 2 mm down each hole.
  - A lead that only a preview holds (the wire tool's ghost, an assistant ghost) keeps its
    design curve and is not sent; once committed it is built from the solver's own design curve
    and drops into place.
- **Consequences.** In the drag scenes (dht11 and the bench layout) nothing reaches more than
  0.12 mm into a collider or another cable after it settles, measured from the worker's
  positions. A module's crude box still holds leads draped over it at its full height.

## ADR-0071 Route hints pull while dragged and start the lead when committed

- **Context.** SPEC 10.5 and 11.3: dragging a lead mid-span sets a soft target stored through
  `SetWireProps.routeHints` (at most 3), so a reopened project looks the same. A lead is a soft
  chain (ADR-0060): its slack comes to rest on the board or table wherever its history left it.
  Measured on Blinking LED: after a hint was dragged in and the project reopened, the settled
  lead differed from what had been on screen by 19 to 25 mm.
- **Decision.**
  - Pressing on a simulated lead and moving it more than 4 px drags a hint: the one within
    15 mm of the grab, else a new one while there are fewer than three, else the nearest. It
    moves across the plane through the grab that faces the camera, rounded to 0.1 mm, as a
    preview `SetWireProps`; the solver pulls the lead toward it as it goes. Release commits that
    one transaction. A tutorial template refuses it, as it refuses every edit.
  - Committed hints start the lead again: its handle changes, it is built from `routeGuess` (out
    of both exits, through its hints, every span between bowed upward until the whole is the
    wire's length) and settled offscreen at once, the way opening a project settles it.
- **Consequences.** A reopened project shows the lead within 1.4 mm of where it was left
  (three runs). On release the lead's slack takes that settled shape at once rather than
  staying where the drag left it.

## ADR-0072 Contacts are solved in one canonical order, with the push on any particle capped

- **Context.** ADR-0063 left a dense pile of 40 leads awake for more than 5 s, and ADR-0062
  tried friction between cables to settle it, without success. The cause was the order. The
  hash returned a segment's candidates in cell order, which changes whenever a padded box
  crosses a cell, and Gauss-Seidel contacts give a different result in a different order, so a
  pile that had nearly converged rang between two orderings, frame after frame. Freezing the
  pair list after settling stopped the ringing; so did sorting each segment's candidates (the
  same pile then slept in about 1.9 s). A second source, found by tracing one particle through
  a substep, was a contact point near a clamped end: the contact's weight on the one free
  particle was 0.012, so a 0.02 mm overlap moved it 1.7 mm and kicked the segment.
- **Decision.**
  - Each segment's kept candidates are inserted in ascending primitive number, and the awake
    list stays in body order after a sleeper is woken. Cable-cable, cable-ribbon and surface
    contacts then run in an order that depends on the numbers alone.
  - A contact moves no particle more than twice the depth it is resolving (`MAX_SHARE`);
    the rest clears over the next substeps.
  - A body under 40 mm/s is damped at 60/s (was 14/s): it comes to rest instead of
    hovering above the sleep speed.
  - Two cables are kept 0.06 mm apart beyond their radii (`CABLE_GAP`). A pile's last contacts
    are with the board, and they leave the wires on top overlapping each other by a few tenths
    of a mm; the gap comes that off the overlap measured against the true radii.
- **Consequences.**
  - The pile slept in 80 of 80 layouts tried (40 leads of 165 mm and of 200 mm, each between
    distinct holes) and in 40 of 40 whose housings overlap, as the old random timing layout's
    do (two housings within 1 mm, which 2.54 mm housings cannot do).
  - Settled, a pile's worst lead-in-lead overlap is 0.15 to 0.39 mm in 29 of 30 layouts and
    0.59 mm in one (0.52 mm in one of eight without the gap); into the board 0.03 mm at most.
    Nearby wires stacked on a taut one are where it sits. The 0.5 mm limit holds for the four
    layouts in sleep.test.ts and not for every layout.
  - Hash order no longer matters, so the pair search may change without changing results.

## ADR-0073 Sleep: speed over ten frames, sleepers woken only by moving bodies

- **Context.** After ADR-0072 some piles still rang by microns: a 0.0126 mm cycle of three
  frames, a 0.15 mm cycle of five in a stack where a taut lead is pressed on another against
  the board (corrections of 0.2 to 0.35 mm a substep that cancel). Frame to frame that is 1 to
  16 mm/s. The integrator also found, replaying the seven-segment tutorial, that an awake body
  at rest woke every sleeper whose padded box it overlapped, so close islands woke each other
  in turn and never slept together.
- **Decision.**
  - A body's speed for sleeping is the farthest any particle has travelled over the last 10
    frames, divided by the window (`SLEEP_WINDOW`); it sleeps after 30 frames below 0.5 mm/s,
    as before. A ring of positions holds the window. A ring cancels, and a drift is still
    caught at the same 0.5 mm/s.
  - `wakeTouching` wakes a sleeper only for an awake body expected to travel more than
    0.5 mm/s over the frame (`move`), and a body woken that way is assumed at rest.
  - `settle()` damps every body at the slow rate while it runs. Dropped freely, a lead can
    fall to the far side of a ridge and rest in a different, equally valid shape, and a project
    reopened that way looked up to 5 mm different from the one saved (e2e route-hint flow);
    settled slowly it is within 1 mm.
- **Consequences.**
  - Every scene in sleep.test.ts sleeps within 2 s of its last anchor change (0.63 to 0.98 s;
    the dense pile 0.87 to 1.18 s after a drag), and the step it sleeps on moves nothing by
    more than 0.02 mm. From its design curves the pile takes 93 to 123 frames to sleep.
  - A body drifting at under 0.5 mm/s over the whole window can sleep before it has reached
    its equilibrium. The slow modes of a soft lead were the worry; none showed up.
  - The wake rule follows the integrator's trace. The headless pairs tried (two leads 1.6 to
    3.6 mm apart, parallel, diagonal, crossing) sleep with the old rule too, so the tests do not
    reproduce the tutorial's failure; they hold the result.
  - ADR-0063's numbers (45 frames for a lead alone, 85 from a design curve) hold; its 5 s pile
    does not.

## ADR-0074 Contact pairs carry their gap and the solvers skip what cannot touch

- **Context.** SPEC 10.8 gives the physics 4 ms a frame for the heaviest scene. ADR-0062's
  pair list held 3000 to 13000 cable pairs, of which 300 to 800 were within 0.1 mm, each read,
  and tested with a closest-points routine, in all 12 substeps. Measured on this Mac in Node 26
  (M5 Pro, machine busy: interleaved runs, range of three, mean / p95 ms over the frames that
  did work), for 40 leads plus the ribbon:

  | 165 mm of wire (a 200 mm lead as sold) | before | after |
  |---|---|---|
  | opening settle (offscreen) | 6.9 to 7.2 / 13.5 to 14.8 | 4.0 to 4.4 / 9.4 to 10.0 |
  | dragging the ribbon's socket | 5.0 to 5.5 / 5.6 to 7.0 | 2.5 to 2.8 / 3.5 to 3.9 |
  | moving the whole board | 8.2 to 8.7 / 9.0 to 10.8 | 3.4 to 4.0 / 3.7 to 4.5 |

  | 200 mm of wire (the first measurement's scene) | before | after |
  |---|---|---|
  | opening settle | 8.0 to 8.4 / 14.1 to 16.2 | 4.7 to 5.1 / 10.7 to 11.2 |
  | dragging the ribbon's socket | 6.6 to 7.0 / 7.5 to 8.8 | 3.8 to 3.9 / 4.6 |
  | moving the whole board | 10.8 to 11.6 / 12.7 to 13.3 | 4.5 to 4.9 / 4.8 to 5.9 |

  Phase means (mean / p95 ms) for the whole board at 165 mm, before to after: prepare 0.23 to
  0.24, colliders 0.03 to 0.06, pair search 2.11 to 1.03, predict 0.20 to 0.18, chains
  1.34 to 1.09, cable contacts 4.48 to 0.44, surface contacts 0.77 to 0.42, velocity 0.10 to
  0.09, finish 0.07 to 0.05. `WorldOptions.profile` and `phaseTimes()` report them.
- **Decision.**
  - Every cable and surface record keeps the gap it had when the frame began. Each substep,
    after the constraints, each body's farthest travel since the frame began plus 0.1 mm is
    measured; a record whose gap exceeds its two bodies' sum cannot be touching and is
    passed over (`measure`, `solveRodPairs`, `solveSurfaces`). Measuring before the contacts,
    not predicting from the last substep, is what keeps this exact: the predicted bound
    missed contacts and the pile stopped sleeping.
  - Cable-cable contacts are one inlined kernel on typed records. A cable lying over a box
    face (most surface contacts) takes a closed form instead of the piecewise segment-box
    minimisation. The curvature constraint's multiplier is precomputed, so it needs no square
    root or division. The chain solve shares one set of work arrays and applies each multiplier
    as it is found. The hash scan stops at ids not above the query segment, and broad-phase
    boxes are padded by half the skin each.
  - A body that is awake keeps its measured speed when an anchor moves (it was reset to
    "falling", which tripled its expected travel and so its pair list).
- **Consequences.** The mean is about 4 ms or under for a socket drag and for moving the whole
  board with the leads as sold (165 mm of wire); the opening settle, which runs offscreen,
  is 4.0 to 4.4. With 200 mm of wire (35 mm more than any such lead has) the whole board is
  4.5 to 4.9. The p95 of the board drag is 3.7 to 4.5. Not done: reusing a pair list across
  frames (the drags move bodies about 0.5 mm a frame, so a list would be rebuilt every second
  frame at best), fewer collision segments per lead (a 6 mm capsule would cut a bend of 10 mm
  radius by 0.45 mm), 10 substeps (tests pass, but the sheet then sinks 1.1 mm into a plate
  edge it is dragged over).

## ADR-0075 The ribbon's sheet is tested against boxes a strip at a time

- **Context.** ADR-0061's ribbon contacts act on grid particles, 5 mm apart along and 8.5 mm
  across. The Pi's micro-HDMI housing (7.19 mm wide), a Dupont housing (2.54), a PCB edge
  (1.6) fit between them: in the integrator's e2e flows the sheet sat 0.77 to 1.30 mm in the
  Pi's `OBJ5053` after look-dev moved the IDC cable's exit, and 0.69 mm with 9 columns. A push
  on one particle also moved its row's centre by 1/columns of it, because the rows are re-laid
  from their centres every substep.
- **Decision.**
  - The sheet between two neighbouring rows is two triangles on the four corner particles
    (the rows are straight). Each is tested against a box inflated by half the sheet's
    thickness with a separating-axis test (three face normals, the triangle's plane, nine edge
    pairs). On overlap each row is carried clear along the way out by the depth of its own
    deepest corner and no more, every particle of the row together, and its sliding on the
    collider is cancelled up to the Coulomb limit (`strips.ts`). Carrying both rows by the
    triangle's deepest corner lifted a row that was resting on the surface: it hopped.
    Capsule colliders keep the particle test.
  - The row direction between the sockets turns about the axis between their width axes
    (`turnWidthAxis`). The linear blend shrank to nothing, and the rows with it, where the axes
    point opposite ways. An exact reversal turns about the cable's own direction.
- **Consequences.** A housing placed off every row and column, a 1.6 mm plate edge under a
  dragged socket, and a housing raised through a settled ribbon stay within 0.0 mm of the
  box (1.1 to 1.2 mm with particles alone); a 7.19 mm box is cleared at 5, 7 and 9 columns,
  and no integrator physics flow reports the ribbon inside a collider any more (the one that
  still fails does so on a pointer offset, ADR-0076). The push is along the shallowest
  separating axis, not necessarily the one a viewer would choose, for a collider that pierces
  a strip's interior with no corner behind it.

## ADR-0076 Bending stiffness: leads 2 N mm^2, ribbon 50, and why not more

- **Context.** `leadEI` was 3e4 g mm^3/s^2 (0.03 N mm^2), two to three orders under a real
  stranded 26-28 AWG jumper (copper strands and a soft PVC jacket: 1 to 25 N mm^2), and the
  ribbon's 1.5e7 (15 N mm^2) an order or two under a 40-way cable (100 to 500). The
  integrator saw leads whose slack drops off the board edge and a ribbon that curls down
  onto the table.
- **Decision.** `leadEI` = 2e6 and `ribbonEI` = 5e7. A lead of 2 N mm^2 holds itself up for
  about 92 mm ((7.8 EI / weight per mm)^(1/3)). With the sleep fixes the pile sleeps better
  stiffer: over 40 layouts at 165 mm and 40 at 200 mm the worst took 181 and 138 frames at
  2e6, and 196 and 354 at 3e4. The ribbon stays below its real range because at 1.5e8 the
  Studio's check that the ribbon measures its 200 mm along a row fails (199.5 mm: the polyline
  bends hard at the clamps) and at 10 substeps it sinks into a plate edge.
- **Consequences.**
  - Above about 1e6 the lead's EI changes no shape: the bending constraint is then rigid in
    effect, and one forward and one back sweep a substep carry its stiffness only so far along
    55 particles, so the leads still lean out of their housings after about 17 mm and fall over
    a board's edge. Tripling the substeps (36) lifts the stub to 24 mm, and so do two extra
    sweeps of the six joints nearest each housing, for 44% more bending work, but sleeping
    then slows (2.2 s for one scene) and eight scenes no longer rest on what they were built
    around. Stiff arches need a direct solve of the bending constraints along the chain (as the
    stretch constraints have, ADR-0060), not a bigger number. That is the next step, not done
    here.
  - Two scenes that assumed a floppy lead are rebased: a lead over a wall, and the wall removed,
    use 90 mm of wire. After the wall is removed the middle ends within 0.1 mm of where an
    identical lead with no wall rests.
  - The e2e flow "dragging the module drags its leads" (physics.spec.ts) fails at every
    `leadEI` above 3e4 tried (1e5, 3e5, 1e6, 2e6): the pointer goes to the module's pose plus
    (8, 8, 8) mm, and with the leads' changed arch no anchor moves (the host sent none), which
    fits the pointer now landing on a lead. It is a pointer offset in the test, not a solver
    defect.

## ADR-0077 A lead's length is the wire between its housings

- **Context.** ADR-0042 settled that a lead's listing length (200 mm) runs tip to tip, and that
  the wire between the housing exits is `wireLengthMm(length, kind)`: 165 mm for a male-male
  lead. `LeadDef.lengthMm` took the wire length but carried the name of the listing's, and the
  timing scene fed it 200.
- **Decision.** `LeadDef` takes `wireMm`, documented as the figure `wireLengthMm` returns.
  `lengthMm` stays as a second name for the same wire length, so a caller written against the
  first version still works (the type allows one of the two). Rest length, over-span
  relaxation and the taut flag all read it, so the flag follows reach.ts: a lead is taut when
  the distance between its housing exits plus twice the minimum bend radius exceeds the wire.
- **Consequences.** leads.test.ts holds a 200 mm male-male lead to 165 mm of wire (165.04 at
  rest), the male-female and female-female figures to 170.5 and 176, and the taut flag to
  reach.ts's rule at its threshold. `lengthMm: 200` would rest a lead at 200 mm of wire: the
  physics host's `addLead` call should pass `wireMm: wireLengthMm(wire.lengthMm, wire.kind)`.

## ADR-0078 Bending is solved directly along each chain

- **Context.** ADR-0060 solves a chain's stretch constraints together but its bending by one
  symmetric Gauss-Seidel sweep a substep, and ADR-0076 found that above about 1e6 g mm^3/s^2 a
  lead's EI changes no shape. Measured on the solver as it stood (Node; a 200 mm lead, 165 mm of
  wire, between holes 60 mm apart on the board, at `leadEI` 2e6): the wire stays within 30 degrees
  of vertical for 3.0 mm above each housing (the one joint `housingBendFactor` stiffened), its
  apex is 16.8 mm above the board, 30 of its wire particles lie off the board's edge below its top
  (on the table), and its resting shape at 12 and at 48 substeps differs by up to 33.6 mm (apex
  16.8 against 30.4): the iteration set the stiffness, not EI. In dense piles 1 and 2, 39 and 40
  of the 40 leads reached the table.
- **Options.** (a) More sweeps near the housings (ADR-0076: 44% more bending work, one scene slept
  in 2.2 s). (b) More substeps (36 lifted the stub to 24 mm at three times the cost). (c) Solve all
  of a chain's bending constraints together, as its stretch constraints already are.
- **Decision.** (c). Bending is the curvature vector C_k = x_k - 2 x_(k+1) + x_(k+2) held at zero
  with compliance s^3 / EI, whose energy is EI theta^2 / 2s at a joint turned by theta. It is
  linear in the positions, so the XPBD system (J W J^T + alpha / h^2) lambda = -C is exact, the
  same for x, y and z, and pentadiagonal. Its LDL^T factors depend only on the inverse masses, the
  compliances and the substep: they are found when a body is added and again when its weights
  change (ADR-0080, ADR-0081). Each substep is a forward and a back substitution with three
  right-hand sides, applying each particle's move as soon as its three multipliers are known
  (`factorBending`, `solveBending` in constraints.ts). It is the banded case of Deul, Kugelstadt,
  Weiler and Bender, "Direct Position-Based Solver for Stiff Rods" (Computer Graphics Forum
  37(6), 2018): for linear constraints along a chain one solve is exact, with no Newton
  iteration. The substep's order is unchanged. A body's bending constraints must run along a
  chain; both builders' do, and `factorBending` refuses others. `housingBendFactor` is gone:
  solved directly, the first joint holds at the wire's own stiffness.
- **Consequences.**
  - The same lead at `leadEI` 1e7 (ADR-0079): within 30 degrees of vertical for 52.8 mm above
    each housing (within 10 degrees for 35.9), apex 78.8 mm above the board, nothing below its
    housing exits, and 12 and 48 substeps rest within 0.63 mm of each other (leads.test.ts).
    Between holes 20 mm apart: 64.6 mm and an apex of 85.1. Dense piles 1 and 2: mean apex 84.5
    and 84.1 mm, no lead off the board. The first wire segment leaves its housing 0.5 degrees
    from vertical (was 4.9).
  - Node, heaviest scene (40 leads of 165 mm of wire plus the ribbon, perf.test.ts, M5 Pro, three
    interleaved runs each, mean / p95 ms over the frames that did work):

    | | before (ba8742d) | after |
    |---|---|---|
    | opening settle (offscreen) | 3.19 to 3.22 / 6.99 to 7.24 | 1.79 to 1.86 / 3.62 to 3.74 |
    | dragging the ribbon's socket | 1.96 to 2.02 / 2.61 to 2.67 | 0.34 to 0.35 / 0.64 to 0.67 |
    | moving the whole board | 2.77 to 2.80 / 2.93 to 3.06 | 1.53 to 1.57 / 1.62 to 1.73 |

    Phases of the whole-board drag, before to after (mean ms): prepare 0.17 to 0.12, colliders
    0.05 to 0.00, pairs 0.80 to 0.33, predict 0.14 to 0.14, chains 0.89 to 0.75, cables 0.32 to
    0.11, surfaces 0.30 to 0.00, velocity 0.07 to 0.07, finish 0.04 to 0.03. The direct solve
    costs less than the sweep did, and standing leads touch the board and each other far less.
    The socket drag no longer wakes the leads: the ribbon no longer reaches them.
  - Tauri window (`npm run dev`, 1200 x 800, WebGPU, the Studio's default post stack), the
    4-Digit 7-Segment circuit opened as a project, bb1 dragged back and forth for 4 to 6 s with
    every cable awake: the worker's step 1.82 to 1.85 ms mean and 4.2 to 7.3 ms longest (was 3.91
    to 3.99 and 30.7 to 31.1); the last change on screen 0.91 to 0.93 s after release (1.14 s in
    the one run timed before), from a 60 Hz screen recording with wall-clock stamps of the board
    and its leads; the overlay's last run 53 to
    62 fps, 56 on average over four runs (was 51 in both runs). The 60 fps budget is missed by
    about what it was before, and the physics is not the cause: it runs in the worker at under
    2 ms a step. The machine was shared with other lanes' test runs (load average 3 to 4).
  - Every scene in sleep.test.ts sleeps 38 to 41 frames (0.63 to 0.68 s) after its last input
    (was 38 to 88), and the dense piles 42 to 81 frames after a drag (was 46 to 68). From their
    design curves the dense piles take 114 to 126 frames (was 93 to 100); the test allows 150.

## ADR-0079 Stiffness: leads 10 N mm^2 and the ribbon 400, from their copper

- **Context.** ADR-0076 set leads to 2 N mm^2 and the ribbon to 50 because the sweep could carry
  no more; at 1.5e8 the ribbon's row polyline bent hard at the clamps and measured 199.5 mm.
- **Decision.** Estimate EI from the conductors. A stranded conductor's strands bend nearly
  independently: Bruski, "Determination of the Bending Properties of Wire Rope Used in Cable
  Barrier Systems" (Materials, 2020), measured a 3 x 7 steel rope at twice the sum of its 21
  wires' own stiffness and a fifteenth of a solid section's. So a 7-strand conductor is about
  7 x E pi d^4 / 64 with copper's E of 117 GPa: 10.5 N mm^2 for 28 AWG (7 x 0.127 mm) and 26 for
  26 AWG (7 x 0.16 mm); a lead's 1 mm PVC jacket adds 0.5 to 2. `leadEI` is 1e7 (10 N mm^2), the
  28 AWG end of `dupont.json`'s 26-28; at 2e7 the same lead's arch stands 0.7 mm higher, so the
  choice within the range barely shows. `ribbonEI` is 4e8 (400 N mm^2): 40 such conductors on the
  sheet's neutral plane are 420, and the 50.8 x 0.95 mm web 40 to 180 more.
- **Consequences.**
  - A lead stands about 160 mm before its own weight folds it ((7.8 EI / weight per mm)^(1/3)),
    so a 200 mm lead between two holes stands as a loop: up out of each housing and over in an
    arch (`lookdev/dupont-drape.png`).
  - The ribbon leaves the T-board's socket in a broad arch and comes down into the Pi's
    (`lookdev/ribbon-drape.png`); at 50 it folded into a tight U beside the Pi. The Studio
    measures it at 200 mm (e2e) and every e2e flow passes.
  - Test scenes that relied on a floppy cable sagging onto something are rebased so contact still
    happens: two crossing leads hang from housings turned down, one lowered onto the other
    (`crossingPair`); a lead hangs from turned-down housings and a wall rises under it
    (`hangOver`: lead over a part, over a thin wall, resting on a part, a collider removed); a
    lead hangs across a ribbon started sagging between its sockets (`saggingRibbon`, also under
    the ribbon-strip scenes); the ribbon over the board's edge ends at (0, 175, 1); the dragged
    ribbon's sockets lie on the table either side of the board, 197 mm apart.
  - Between two leads this stiff a contact holds up to about 2 mm of bending of one against the
    other: a lead lowered onto another to where it would hang 3.5 mm lower rests on it; at 4.3 mm
    lower it passes through. Bending is solved before contacts, and the stiff chain puts back what
    the contact pushed out. Scaling the pressed particles' mass for cable contacts too (as
    ADR-0080 does for colliders) held both, but then no dense pile slept in 400 frames (particles
    at 1.2 to 1.8 m/s), so it is left out. The dense piles and e2e scenes stay within 0.5 mm.
  - Penetration, before to after: dense piles 0.15 to 0.27 mm, now -0.03 to 0.09; pile of five
    -0.05, now 0.28 between leads; lead over a part 0.00, now 0.08; lead over the ribbon 0.02, now
    0.08. The deepest in any e2e flow is now -0.25 (W1 against its own housing's box).

## ADR-0080 A particle a collider pushed is sixteen times heavier in the next substep's rod solves

- **Context.** Solved directly, a stiff lead pressed against a part was bent back into it each
  substep by nearly the whole of what the contact had just pushed out. A wall rising under a hung
  lead went through it once it had lifted the lead about 4 mm (5.4 mm deep); a 2.4 mm wall did at
  2 mm (1.6 mm deep).
- **Decision.** Mass scaling for contact, after Macklin, Muller, Chentanez and Kim, "Unified
  Particle Physics for Real-Time Applications" (SIGGRAPH 2014, section 5.2), itself after the
  shock propagation of Guendelman et al. 2003. A collider contact marks the particles it moved; in
  the next substep they weigh 16 times their mass in the bending and stretch solves (16 so the
  weight is restored exactly), the bending factors are found again whenever the set of pressed
  particles changes or empties, and the weights are put back before the contacts. Cable-to-cable
  contacts are not marked (ADR-0079).
- **Consequences.** The wall rising 14 mm under a hung lead: 0.07 mm deep at the end. Lead over a
  part 0.08 mm, across a 2.4 mm wall -0.01. At rest it changes nothing: a weight scales a
  particle's share of the corrections, not their balance. Factors of 20 and 100 behaved as 16
  did. A body that touches a collider pays one extra factorisation a substep, about the cost of a
  solve.

## ADR-0081 Route hints weigh in the solve, pick their particle by reach, and pull only as far as the wire reaches

- **Context.** With stiff leads a hint applied before the bending solve was mostly undone by it
  (cables.test: 1.85 mm from the target against 1.5 allowed). In the e2e route-hint flow on
  Blinking LED the drag put a hint at (32.1, 22.9, 105.1), 186 mm of wire away through the two
  housing exits for a 165 mm lead: bending, stretch and the hint never agreed, the lead moved about
  4 mm every half second for as long as it was watched, and the scene never stopped drawing.
- **Decision.**
  - A hint is the energy (h^2 / 2 alpha) |x - target|^2 on one particle, the same as that particle
    weighing h^2 / alpha more, so the bending and stretch solves take it at that weight
    (`weighHints`) and the bending factors include it. `HINT_ALPHA` is 3e-5.
  - The hinted particle is the one whose wire either side reaches the target with the same to
    spare both ways, s = (L + |t - a| - |t - b|) / 2 along the wire, not the one nearest the
    target's projection onto the chord: a standing lead does not follow the chord.
  - Each frame the target is brought into the lens of points that particle can reach from both
    exits (alternating projection onto the two balls, `reachHints`), so a target out of reach
    pulls the lead as far as it goes and it comes to rest.
- **Consequences.** cables.test: 0.61 mm from the target (0.63 before); a target 160 mm above a
  165 mm lead sleeps in 51 frames with the lead 4.6 mm short of its highest reach. The e2e
  route-hint drag now moves the grab sideways (60 px) instead of up: a standing lead is already
  near the most height its wire allows, so a target dragged up from its stub is out of every
  lead's reach. The reopened lead lies within 0.00 mm of where it was left.

## ADR-0082 The Studio draws one geometry pass and redraws the shadow map every other frame

- **Context.** SPEC 10.8 asks for 60 fps in the Tauri window with physics awake and the full post
  stack, and says to scale effect quality first (AO resolution, then depth of field). ADR-0078
  measured the heaviest tutorial (four-digit seven-segment, 37 leads and the ribbon, bb1 dragged)
  at 53 to 62 fps, 56 on average, with the physics worker's step at 1.8 ms. The question was where
  the rest of the frame goes. Measured in the Tauri window (`npm run dev`'s binary, 1200 x 800,
  WKWebView, WebGPU, a canvas of 1376 x 1189 device pixels at a pixel ratio of 2) by scripted
  drags: synthetic pointer events at the display rate move bb1 back and forth for 3 to 5 s with
  every cable awake. The machine was at load average 7.5 to 11.2 throughout, shared with other
  lanes and with a second Tauri app (KasaHub) whose WebContent process held 240% CPU and whose GPU
  process 100% at each of three samples; the same code's fps moved by 10 or more between batches
  minutes apart. Every comparison below is therefore between runs interleaved in one batch, three
  to five repeats each.
- **Where a frame goes.**
  - GPU, from timestamp queries. three 0.186 reads them when the renderer is built with
    `trackTimestamp: true` (the adapter lists `timestamp-query`): `renderer.resolveTimestampsAsync
    ('render')` fills `backend.timestampQueryPool.render.timestamps`, one entry per render context
    and frame (`r:<calls>:<context>:f<frame>`, in the order the passes began), and
    `renderer.info.render.timestamp` holds the last frame's sum. Heaviest tutorial, one run of 205
    frames, mean ms per frame before the change: pre-pass (normal and velocity, 1376 x 1189) 1.03;
    shadow map (2048 x 2048) 0.74; scene pass 1.75; GTAO (688 x 595) 1.66; TRAA resolve 1.66; bloom
    4.26 (high pass 1.75, first blur 1.80, the other nine blurs and the composite 0.71); AgX and
    grade, the pass to the canvas, 0.25; total 11.35 (p95 13.9). The sum is generous: a pass is
    timed from its first to its last stage, and on Apple GPUs a pass waits on the one before it,
    so a half-resolution blur reads as long as the full-resolution resolve it follows. The same
    sums for the LED dot matrix and the shift register: 11.2 and 6.4.
  - The GPU is not what sets the rate. At a pixel ratio of 1 (a quarter of the pixels) the passes
    sum to 6.5 ms instead of 11.0, and three drags ran 50.2, 44.0 and 46.8 fps against 50.9, 50.8
    and 46.6. With AO at a quarter of its resolution (344 x 297), at a quarter with 8 samples, with
    AO off, and with bloom off, fps in each batch stayed within the spread between repeats of the
    default (39.9 against 39.7, 38.8, 38.6 and 38.5 on average, three repeats each, one load);
    the pass sum moved by at most 0.5 ms, and bloom off took 2.1 ms. After the change below, AO at
    half, a quarter, and a quarter with 8 samples gave 55.5, 54.9 and 56.7 fps (medians of five).
    Depth of field is never built: nothing calls `Post.setFocus` yet (Build Mode), so it is off.
  - The main thread is. `post.render()` took 8.5 to 18 ms of a 9.6 to 19 ms `view.frame`, for 452
    draws a frame: 151 visible meshes (63 instanced), 145 of them shadow casters, drawn by the
    pre-pass, the shadow pass and the colour pass, 1.19 M triangles in all. Of the final build's
    main thread, the sixteen full-screen passes together cost 0.56 ms (0.014 to 0.17 each, the
    time inside `_renderScene` per pass); the geometry passes cost the rest, 6.9 ms a frame for
    one and a half of them at that load. Exclusive time in three's render path per object and
    pass, with the profiling wrappers on (so inflated), four-digit against LED dot matrix:
    `RenderObjects.get` 2.9 against 1.5 us, `bindings.updateForRender` 4.8 against 5.1,
    `geometries.updateForRender` 5.0 against 1.4, `nodes.updateForRender` 1.8 against 1.8,
    `backend.draw` 1.2 against 0.9. The WebGPU calls themselves are about 2.0 ms of a frame: 435
    `drawIndexed`, 668 `setBindGroup`, 840 `setVertexBuffer`, 363 `setIndexBuffer`, 304
    `setPipeline`, 569 `queue.writeBuffer`, 49 `createBuffer` a frame (25 mapped at creation,
    `getMappedRange` 40 us each, 1.0 ms), 20 command encoders and submits.
  - The two dense scenes with the same 452 draws differ most in `geometries.updateForRender`
    (2.3 against 0.7 ms a frame) and `RenderObjects.get` (1.3 against 0.7): consecutive profiled
    drags ran at 38.8 fps (four-digit) and 60.0 (LED dot matrix). The cost is the cable geometry
    and bindings of a scene whose cables are all awake.
  - The frame interval follows the main thread's time in `view.frame`: 16.9 ms at 6.3, 19.6 at
    9.6, 21.5 at 11.8, about 25 at 15. During a drag the WebContent process ran at 52 to 88% CPU
    and WebKit's GPU process at 30 to 46%: neither was saturated.
- **Options.** (a) Lower AO resolution and samples, then bloom or shadow resolution: the SPEC's
  order. It buys GPU time, which is not the limit here, and costs look. (b) Draw fewer objects:
  instance or merge the models, wrap the static ones in a render bundle, stop leads casting
  shadows. Right, and in other lanes' files. (c) Draw each object fewer times: it is drawn by
  the pre-pass, the colour pass and the shadow pass.
- **Decision.** (c), in `studio/renderer.ts`, and nothing else in the pipeline.
  - One geometry pass. The colour pass writes the colour, the packed normal (8-bit) and the
    velocity as an MRT, and GTAO and TRAA read its depth, normal and velocity. The pre-pass is
    gone. GTAO still feeds `builtinAOContext`, so only ambient light is occluded. three runs the
    GTAO pass when the first object that uses it is drawn, and the colour pass's commands are
    submitted after it, so GTAO reads the depth and normals the colour pass wrote on the previous
    frame: the occlusion applied in a frame was computed one frame earlier. A still image is the
    same as before; in motion the occlusion trails by a frame.
  - The key light's shadow map is redrawn on every second frame (`SHADOW_EVERY`), by switching
    its `autoUpdate` off and setting `needsUpdate` from `Post.render`. SPEC 10.2's 16 frames that
    settle a change include redraws, so a still scene ends on a current shadow; a dragged board's
    shadow trails by a frame, about a millimetre at 70 mm/s.
  - AO stays at half resolution and 16 samples, and bloom, shadow size, TRAA and DoF are as they
    were: the measurements say none of them buys frame rate, and each costs look.
  - Dev builds build the renderer with `trackTimestamp` and report the render call's main-thread
    time and the GPU's pass time to the overlay every 30 frames (`dev/frameCost.ts`, a row "frame
    cost"). Queries on or off made no difference in four interleaved pairs of drags (`view.frame`
    8.0 ms against 8.0, 58.3 against 57.3 fps).
- **Consequences.**
  - Draws a frame 452 to about 225 (151 colour, 151 shadow on every second frame). Interleaved
    batches of five drags each, before then after (fps median; `view.frame` and its render call,
    mean ms; pass sum, mean ms; load average):
    - four-digit seven-segment: 33.9 to 44.6 fps; 18.9 and 17.9 to 11.9 and 11.1 ms; 12.1 to
      11.3; load 9.7.
    - LED dot matrix: 58.6 to 58.5; 7.2 and 6.4 to 5.3 and 4.5 ms; 11.0 to 11.3; load 9.0. It
      held the 60 Hz cap before and after.
    - shift register: 53.5 to 57.0; 9.2 and 8.5 to 7.0 and 6.4 ms; 6.9 to 9.0; load 9.7.
    - The pass sum stays level or rises because the colour pass writes normal and velocity as
      well (1.75 to 2.29 ms in the four-digit run) and bloom and TRAA read a little longer; the
      pre-pass's 1.03 is gone. Per pass after, in that run: shadow map 0.80 (a redraw), scene 2.29,
      GTAO 1.39, TRAA 1.87, bloom 4.77, grade 0.25, total 11.36.
    - The final build, five drags each, load 9.8 to 10.1: 55.3, 57.6 and 55.9 fps median during
      the drag; the overlay's "last run" 55.9 to 60.8 (medians 58.0, 58.3, 58.5); `view.frame` 8.3,
      5.1 and 7.6 ms. A first set of four drags each at load 8.3 to 8.9: 57.6 to 59.3, 57.1 to
      60.0 and 53.8 to 57.7 fps, last run 58.3 to 60.6. Blinking LED (61 meshes): 54.1, 56.3, 60.0
      and 60.0 fps with `view.frame` at 2.7 to 2.9 ms, so at this load a scene that costs the main
      thread 3 ms held 60 in half its runs. 60 fps on every drag of the heaviest tutorial was not
      shown here, and the load on this machine did not allow a quieter measurement.
  - What is left is per object and per pass in three's render path (about 150 objects in each of
    two passes), and the awake scenes pay about 1.5 ms more than the quiet ones in geometry and
    binding updates. The levers are in files this change does not touch: fewer objects per pass
    (instancing and merging; leads and small parts need not cast shadows), a render bundle for the
    static boards and models, and the buffers three re-creates every frame (in a second trace,
    three binding buffers of 80, 256 and 448 bytes 6.4 times a frame each, and 19 vertex and index
    buffers mapped at creation). Bloom costs 4.3 to 4.8 ms of pass time and does nothing while no
    LED exceeds its threshold of 2; a switch for it, driven by the simulation's glow, is the next
    GPU saving and the only one that costs nothing visible.
  - Look: Blinking LED at the Iso preset in the Tauri window, dev overlay hidden, TRAA converged.
    Compared pixel by pixel on the canvas, before against the interleaved build and against the
    final build: mean absolute difference 0.30 and 0.49 of 255 (two captures of the same build:
    0.08), 0.8% and 1.4% of pixels differ by more than 8 levels (same build: 0.016%), almost all on
    silhouettes and the rims of the breadboard's holes, which read a hair darker at 6x; mean
    luminance 132.64 to 132.71 and 132.60. By eye, at full size and at 2x and 6x crops, nothing
    visible changed. A frame drawn after six 0.7 degree orbit steps by hand differs more (mean 1.5,
    4.3% of pixels over 8, on edges), and the one-pass frame was the sharper.
  - e2e's frame counter tests, including that a still scene renders no frames after a camera move,
    pass unchanged.

## ADR-0083 The loop reads the stream itself instead of using the SDK's message helper

- **Context.**
  - SPEC 12.3 requires every assistant content block to go back to the API exactly as received,
    and SPEC 12.4 requires a tool input that is not valid JSON to come back as a `tool_result`
    with `{"INVALID_JSON": "<raw>"}`.
  - `@anthropic-ai/sdk` 1.3.0 builds a tool call's `input` as a lazy getter over a tolerant
    partial-JSON parse, and evaluates it when the block closes. Input the parser rejects makes
    `finalMessage()` reject, which loses the whole message: the thinking signature, the server-tool
    results and the other tool calls. Input it accepts can be silently truncated.
  - The SDK's `Stream` treats an `AbortError` as the end of the stream (`core/streaming.js`), so
    an aborted request looks like a message with no stop reason.
- **Decision.**
  - `assistant/stream.ts` calls `client.messages.create({stream: true})` and accumulates the events
    itself: each `content_block_start` is cloned and filled by its deltas, and tool input is kept
    as raw text and parsed strictly with `JSON.parse` at `content_block_stop`. A tool input that is
    not a JSON object is recorded with its raw text and answered with `INVALID_JSON`; the block
    goes back with `input: {}`, since the API needs an object.
  - Previews use the SDK's own partial parser (`@anthropic-ai/sdk/_vendor/partial-json-parser`).
    It keeps only keys and values that have fully arrived, so a ghost never jumps. A property test
    shows that no prefix of any JSON object yields a value the finished object lacks.
  - The loop checks `signal.aborted` after the stream ends and reports `aborted` then.
  - A block the stream never closed (a response cut off by `max_tokens`) is not sent back: a
    thinking block without its signature, or a tool call with half an input, would be a 400.
- **Consequences.**
  - The SDK still does transport, SSE parsing, retries (two, before a stream starts), headers and
    types. Only the accumulation is ours, one small module, tested against hand-written SSE
    fixtures split at odd byte positions.
  - The `_vendor` path is an SDK internal. A future SDK that moves it fails the import at build
    time, and `partialJson.ts` is the one file to change.

## ADR-0084 Twenty of the 22 tools are strict, and strict-driven shapes differ from SPEC 12.5

- **Context.**
  - SPEC 12.4 asks for `strict: true` on every client tool. The API limits a request to 20 strict
    tools, 24 optional parameters and 16 parameters with union types across all strict schemas,
    and rejects every JSON Schema keyword outside a small subset (structured outputs, "Schema
    complexity limits" and "JSON Schema limitations"). SPEC 12.5 lists 22 tools.
  - `additionalProperties` must be `false` on every object, so a map with arbitrary keys can not
    be described.
- **Decision.**
  - Every tool that takes parameters is strict (20). `run_erc` and `read_board_sense` take none;
    a grammar over `{}` guarantees nothing, so they are not.
  - Schemas are written in Zod and converted by `tools/jsonSchema.ts`, which keeps only the
    subset, closes every object, and moves ranges and lengths into the description. The same Zod
    schema validates the input at runtime, so the ranges still hold.
  - Shapes that a strict schema can not express change form, with the same content:
    - holes are text, `"bb1:23e"` or `"bb1:top+.7"`, which also saves a union per hole;
    - `props` is a list of `{name, value}`;
    - `simulate` takes `stimulus: {gpio: [...], inputs: [...]}` with `durationMs` required (0 for
      `op`); `inputs` carries what SPEC 12.5 splits into `inputs` and `env`, because both set a
      part property in the simulator;
    - `annotate_build_steps` entries carry `why` and `mistake` as required strings, empty when
      there is nothing to say;
    - `define_custom_part` pins carry `connector: "none"` for parts that plug into the board.
  - A test asserts at most 20 strict tools, 24 optional parameters and 16 unions over the schemas
    actually sent. They use 20, 15 and 5.
- **Consequences.**
  - The API also limits compiled grammar size, which can not be checked offline. ADR-0085 covers
    a rejection.
  - `circuitStore` gets no new op: `annotate_build_steps` can not commit, because no op sets
    `buildStepAnnotations`. The tool validates its steps and calls
    `AssistantContext.annotateBuildSteps`. A `SetBuildStepAnnotations` op in `core/` would make
    it one transaction of the turn, and undoable with it.

## ADR-0085 Mutation tools stream eagerly, and a rejected first request retries with plain tools

- **Context.**
  - SPEC 12.4 sets `eager_input_streaming: true` on the mutation tools and asks to drop it from a
    tool if the API rejects it together with `strict`. The fine-grained streaming, strict tool use
    and tool reference pages say nothing about the combination. This build can not call the API
    (no key is read or used), so the combination is unverified.
  - Eager streaming turns off the server's validation of each parameter, so the accumulated input
    can be invalid JSON (ADR-0083) or cut off (`max_tokens`).
- **Decision.**
  - `eager_input_streaming` is set on the 12 tools that change the document or the part library,
    together with `strict`.
  - If the first request of a conversation fails with a 400 whose message mentions strict, eager,
    schema or complexity, the session rebuilds its tools without both flags, tells the UI with a
    `plain-tools` notice, and retries once. Later requests never do this: the tools array is part
    of what thinking blocks are bound to (ADR-0087), and the first request has none yet.
  - Runtime validation does not depend on the flags, so plain tools lose only the grammar
    guarantee and early ghosts.
- **Consequences.**
  - The first live run of the Claude drawer settles it. If the API rejects the combination,
    this fallback is what the user sees; the permanent fix is dropping `eager` from the tool the
    API names, in `tools/index.ts`.
  - A live check belongs in `HIL_CHECKLIST.md`: send one request with the 22 tools and read the
    response or the 400.

## ADR-0086 Web search and web fetch run as direct calls

- **Context.**
  - SPEC 12.3 names `web_search_20260318` and `web_fetch_20260318` and asks to read the
    `allowed_callers` and mixed-turn rules. From `_20260209` on, the web tools default to
    `allowed_callers: ["code_execution_20260120"]`: dynamic filtering, with code execution
    provisioned by the API in a container, and no zero-data-retention eligibility.
  - A turn that calls a web tool and a client tool together ends with `stop_reason: "tool_use"`
    and a `server_tool_use` block with no result; the next request must carry only the client
    `tool_result` blocks and the same `tools`. A long server loop ends with `pause_turn`.
- **Decision.**
  - Both tools are declared with `allowed_callers: ["direct"]`, `max_uses` 6 (search) and 4
    (fetch), and `max_content_tokens` 30000 for fetch, which bounds what a datasheet costs now
    that nothing filters it.
  - The loop answers only client `tool_use` blocks, resends the same tools on every request,
    and resumes `pause_turn` by sending the assistant content back as received, up to 8 times in a
    row. A turn that stops for `tool_use` with no client call waiting is resumed the same way.
  - `assistant.webTools` is fixed for a conversation (ADR-0087).
- **Consequences.**
  - Search results and fetched pages enter the context whole, up to the caps. Switching to dynamic
    filtering later is `allowed_callers` and `webTools()` in `tools/index.ts`, plus whatever
    container handling the API then needs.
  - Fetched text is untrusted. The assistant has no hardware tool, and every document change it
    makes is one undoable transaction, so injected instructions can do no more than a bad build.

## ADR-0087 A conversation freezes its prefix and only grows

- **Context.**
  - Opus 5.5, Sonnet 5.5, Fable 5.1 and Haiku 5.5 bind each thinking block to the system prompt,
    the tools and every earlier message. A request that edits any of them after a block was
    produced is a 400 on accounts created from 2026-08-31, and a cache miss on every account
    (preserved thinking; prompt caching).
- **Decision.**
  - `AssistantSession` builds its system blocks (the rules from `system-prompt.md`, then the part
    catalog summary) and its tools once. The catalog is a snapshot; parts defined later are found
    with `search_parts`. `webTools`, strictness and eagerness are fixed with it. The panel starts a
    new session to change them.
  - History is append-only. Per-turn overrides are limited to `model` and `effort`, which the API
    allows to change (a model change drops the old thinking blocks, unbilled). Either one costs a
    cache write for that turn, so the panel should change them rarely.
  - Caching uses two breakpoints: an explicit one on the last system block, which caches the tools
    and the system together, and the top-level automatic one, which follows the growing history.
  - `get_circuit_state` is the only way live state reaches the model, so nothing volatile enters
    the prefix. `since` is answered from documents the assistant remembered by revision.
  - A turn that ends early never edits the history either: a response that was cut off, refused or
    aborted is not appended, and an aborted tool round is closed with error results.
- **Consequences.**
  - Two adjacent user messages (after an aborted turn) are merged by the API, which allows it.
  - A conversation that mixed a web tool with a client tool and was aborted before its results
    went back leaves a server tool call unresolved; the next request would be a 400. That needs a
    new conversation.
  - There is no compaction. The 1M window holds a long build session; a longer one needs the
    server-side compaction beta.

## ADR-0088 How a turn ends

- **Context.**
  - SPEC 12.3 requires handling `tool_use`, `end_turn`, `max_tokens`, `pause_turn` and `refusal`,
    a soft cap of 60 tool calls, and abort. The API also returns `stop_sequence` (never requested
    here) and `model_context_window_exceeded`.
- **Decision.**
  - `end_turn`, `stop_sequence`: the response is appended and the turn ends.
  - `tool_use`: client tools run in order; all results go back in one user message. Parallel
    calls are not run concurrently, because later calls read what earlier ones changed.
  - `max_tokens`, `model_context_window_exceeded`: nothing runs, since a tool input cut off can
    parse as a valid partial object. Complete blocks are kept and every complete tool call is
    answered with a `TRUNCATED` error so the history stays valid; the UI gets a notice and the
    user can say "continue".
  - `pause_turn`: resumed, as in ADR-0086.
  - `refusal`: the response is dropped, not appended; the UI gets the category and explanation.
    Server-side fallback needs the beta namespace and is not enabled; `fallbacks` can be added to
    the request in `loop.ts` once a fallback model is chosen.
  - Cap: at 60 calls the remaining calls in the batch get a `TOOL_CALL_CAP` error, and the next
    request sets `tool_choice: none` so the model can only summarize and ask whether to continue.
    `tool_choice` is outside the prefix the thinking blocks bind to; it costs one cache write.
    The count restarts each turn.
  - Abort: the request is aborted, a half-received response is dropped, committed transactions
    stay, results already earned are returned, calls not yet run get an `ABORTED` error, and every
    ghost is cleared.
  - An API error, or a stream that ends without a stop reason, ends the turn with `error` and the
    reason; the SDK has already retried what it retries before a stream starts.
- **Consequences.**
  - A mid-stream error loses the partial response; the user resends.

## ADR-0089 `place_part` and `connect` resolve holes in a pure placer

- **Context.**
  - SPEC 12.5 has `place_part {at: 'auto'}` choose free strips near related nets, and `connect`
    accept `{net}` and `{partPin}` ends and return concrete holes and a resolved length.
    SPEC 6.5 and 6.6 fix the wiring convention and the placement rules.
- **Decision.**
  - `core/placer/placer.ts` holds the rules, pure and deterministic, with tests that check every
    result against `validateDoc`.
  - A net resolves to the first free hole (a, b, c beside a d pin; j, i beside an h pin) in the
    T-board strip of a pin on that net. Of several strips (GND has eight) the nearest to the other
    end wins. A part pin on the breadboard resolves to a free hole in its own strip, nearest the
    other end. An off-board module pin stays a pin end.
  - The lead kind follows the genders the ends need (hole or female socket: male; male pin:
    female). Two net ends are refused as a short. The length is `autoLength` over the exact
    distance, through `leadReach`, and is stored as a number.
  - `at: 'auto'` scans outward from the search row (the row of `near`, a part or a net's strip;
    otherwise the first row past the T-board and everything under it). A position needs every pin
    in a free hole, every strip it touches empty, and, for a part that straddles the trench, both
    halves used. Flexible parts run along the rows with the span that fits the body
    (`ceil(body / 2.54)`). Off-board modules sit beside the board's j side in rows of three. When
    nothing fits, the tool says to add a board.
  - Parts placed automatically do not share strips, so they join nothing until `connect` joins
    them. To chain parts, the model gives an exact `at` in a strip already in use; the reply lists
    each pin's free holes and warns when a pin shares a strip.
- **Consequences.**
  - A circuit built entirely with `auto` uses one lead per series connection, where a hand build
    would share a strip. It is valid and ERC-clean, and the prompt tells the model how to chain.
  - `edgeColumnsUsable` is honoured through the existing blocked-hole rule, so c and i beside the
    T-board are used for leads.

## ADR-0090 A project's custom parts live in its document

- **Context.**
  - SPEC 7 lets the assistant or the user define a part, and `define_custom_part` did, by
    registering the definition with the `AssistantContext`. SPEC 5's `CircuitDoc` has no field for
    one, and a `.gpiob` stores only each part's `defId`, so a project with a custom part could not
    be reopened. The registration also sat outside the undo group of the turn that made it.
  - Every consumer (netlist, ERC, sim, steps, placer, reach) looked a definition up through a
    `PartDefs` function its caller supplied, which knew the library and whatever the app had
    registered.
- **Decision.**
  - `CircuitDoc.customParts?: PartDef[]`, absent when there are none. Two ops, each the other's
    inverse: `AddCustomPart {def, index?}` and `RemoveCustomPart {id}`. Removing the last one
    drops the field, so an undo restores a strictly equal document.
  - A custom part's id starts `custom-` (`CUSTOM_PART_PREFIX`), and `loadPartDef` refuses a
    library id that does. A project's part therefore never shadows a library part, including one
    a later version adds, and no lookup order has to be chosen.
  - `validateDoc` checks each custom part before anything resolves it: `PartDefSchema`,
    `checkPartDef`, the prefix and unique ids (`CUSTOM_PART`, `DUPLICATE_ID`), and stops there,
    because the rest assumes sound definitions. A `defId` found in neither the document nor the
    library is `UNKNOWN_DEF`, as before. The `.gpiob` schema parses `customParts` with the same
    `PartDefSchema`.
  - `docPartDefs(doc, library)` (core/netlist) is the library resolver extended with the
    document's parts, and is the library resolver itself when there are none. Each core function
    that takes `(doc, defs)` and calls `defs` itself applies it on entry: `netlist`, the
    connectivity engine through it, `erc`, `simChecks`, `Circuit`, `buildSteps`, `exitPoint` and
    `leadReach`, the placer's `offboardPose`, `endNeeds` and `planLead`, `candidates`,
    `renderTheory` and `validateDoc`. Callers keep passing the library.
  - `AssistantContext.partDef` and `partDefs()` are the library; `registerPartDef` is removed.
    `define_custom_part` commits `AddCustomPart` as one transaction of the turn. The tools that
    look a part up themselves apply `docPartDefs`, `search_parts` lists the document's parts, and
    the catalog in the cached system prompt includes the ones the project already has.
- **Consequences.**
  - A custom part is not edited in place. `RemoveCustomPart` leaves any part that uses it without
    a definition, so `validateDoc` refuses it until those parts are gone; a changed part is a new
    id.
  - A custom part belongs to one project and is not shared between projects.
  - The `.gpiob` format changes (ADR-0092).
  - UI code that reads `partDef(part.defId)` from `core/defs/parts` for a document's part must use
    `docPartDefs(doc, partDef)` instead; the Claude panel's review strip should count the new op
    types. SPEC 5 (`CircuitDoc`, `Op`) and SPEC 7 (custom parts) should name `customParts`.

## ADR-0091 A custom part may cite no source; a library part may not

- **Context.**
  - `PartDefSchema` required at least one source URL (SPEC 5: "required"). `checkPartDef` and the
    ERC rule `PART_WITHOUT_DATASHEET` accept none, and `define_custom_part` without a datasheet
    built `sources: []` with the "no datasheet" tag. A project holding that part would have failed
    its own schema on save.
- **Decision.**
  - The schema takes any list of URLs, including none; a string that is not a URL still fails.
    A part with no sources is a legal custom part and gets the `PART_WITHOUT_DATASHEET` info
    (SPEC 8), whether or not it carries the "no datasheet" tag.
  - The rule that a shipped part cites its datasheet (SPEC 7) moves from the schema to
    `loadPartDef`, the one place library content is loaded. A library file without a source
    still fails at load and in the content tests.
- **Consequences.**
  - SPEC 5's `provenance` comment should read "required for the library; a custom part may have
    none".

## ADR-0092 Build-step notes: step keys, an op, and format 2

- **Context.**
  - Notes were keyed by the bare id of a step's first ref ("R1", "W2"). Part ids and wire ids are
    unique only within their own lists, and `place_part` accepts any unused part ref, so a part
    and a lead could share an id and the note landed on both. A part named "tboard" would have
    collided with the T-board step.
  - No op set `buildStepAnnotations`, so `annotate_build_steps` called
    `AssistantContext.annotateBuildSteps` and its notes were outside the turn's undo group
    (ADR-0084, last consequence).
- **Decision.**
  - `BuildStep.key` is `"tboard"`, `"part:R1"` or `"wire:W2"`, from `stepKey(kind, id)` in
    core/steps. It depends only on what the step is about, so edits elsewhere do not move it.
    `BuildStep.refs` stays as it is, for tutorial checkpoints and Board Sense.
  - `SetBuildStepAnnotations {annotations?}` replaces the notes as a whole, the way `SetCode`
    replaces the code, and none removes the field. The inverse is the previous value, exactly.
    `annotate_build_steps` builds the new record from the document's and commits it as one
    transaction of the turn.
  - The tool accepts a step key, or a ref that only one step is about; a ref a part and a lead
    share is refused with the keys to use. Both notes empty clear the step's notes.
  - The `.gpiob` format is version 2, for the keys and for `customParts`. Migration 1 → 2 rewrites
    each bare key to `part:` or `wire:` by which list holds that id (both when both do) and keeps
    any other key as it is. The shipped tutorials stay version 1 files and are upgraded as they
    load; a test checks that every note in them lands on a step.
- **Consequences.**
  - `AssistantContext.annotateBuildSteps` and `BuildStepAnnotation` are removed.
  - A note for a step that no longer exists stays in the document and is ignored; removing a part
    does not remove its note.

## ADR-0093 `validateDoc` checks part properties against the definition

- **Context.**
  - The assistant's tools checked a part's props against its definition's properties, and nothing
    else did, so a hand-edited `.gpiob` could carry a resistance of "big", or a property the part
    does not have, and every consumer would read it.
- **Decision.**
  - `propProblem(def, name, value)` in core/defs/parts is the one check: a number is finite and
    within `min` and `max`, an enum value is one of its options, a boolean is a boolean, and the
    name is a property of the definition. `validateDoc` reports `BAD_PROP` for each prop of each
    part, and `mergeProps` in the tools uses the same function, so the two cannot disagree. A part
    that sets no props passes; the defaults apply.
- **Consequences.**
  - Every tutorial, sample and fixture validates. One test document did not: the Board Sense test
    seeded a switch's pressed state through a prop, `pressed`, that `tact-switch-6mm` does not
    declare (the simulator reads a part's inputs from its props). That test now gives the
    definition it passes to the ranker a `pressed` property. Anything that seeds a simulator input
    through props must declare it as a property.

## ADR-0094 A running turn owns the document, and a turn undoes as one group

- **Context.**
  - SPEC 11.8 makes the canvas read-only while Claude runs, keeps committed ops after Stop, and
    makes each turn one undo group; SPEC 12.8 and acceptance 7 want Undo all to restore a
    deep-equal prior document. Edits reach the document from many places: the Studio's gestures
    and keys, Properties, the Code panel, the top bar's Undo and Redo, the Workbench's samples and
    the project menu.
- **Decision.**
  - `CircuitStore.lock(turnId)` and `unlock()`: while locked, `dispatch` refuses every transaction
    not of that turn with a `LOCKED` problem, and `undo`, `redo` and `open` do nothing. The Claude
    drawer locks on the turn's `turn-start` event and unlocks when `runTurn` returns, whatever the
    ending. The project menu and `workbenchStore.open` refuse to open another document while
    locked, so no project id is attached to the wrong document.
  - `undo` and `redo` take one group: a user transaction, or every adjacent transaction of the
    same assistant turn, applied in one commit (one notification, one redraw). `undoTurn(id)` undoes
    the turn only while it is the latest change, and `lastTurnId` says which turn that is.
  - The Studio stays usable for looking: the camera, hover and selection work; a press drags
    nothing; the wire tool, library drags, Delete, R and Cmd+Z show the lock's notice instead. A
    banner over the stage says Claude is working and carries Stop.
- **Consequences.**
  - The top bar's Undo and Redo look enabled during a turn but do nothing (`pages/StudioPage.tsx`
    is outside this lane). Disabling them on `useAssistant.running` is a one-line change there.
  - Cmd+Z after a build takes the whole build back at once, as Undo all does.

## ADR-0095 The assistant simulates and runs Python in workers of its own

- **Context.**
  - The app has one sim worker and one Pyodide worker, and the Workbench reloads its sim on every
    commit and replays its GPIO states into it. A `simulate` call loading its stimulus there would
    change what the Sim panel shows; a `write_code` check queued behind a user's running program
    would wait for it to stop; and the Pyodide worker posts throttled snapshots, not pin events, so
    `run_code_in_sim` could only sample.
- **Decision.**
  - `simChannel()` in `state/simClient.ts` makes a sim worker; the app keeps `simRequest`, and the
    AssistantContext has its own channel. Its answers are narrowed to `state` or `error`.
  - `workers/assistantPython.worker.ts` is the assistant's own Pyodide, started on first use, for
    the syntax check and the run. `workers/assistantRun.ts` runs the document's program as fast as
    the solver allows for the asked virtual seconds through a `RecordingBridge`, which notes each
    change a program makes to a pin (setup, output, PWM, release) with its virtual time, and stops
    it by Pyodide's interrupt, as Ctrl+C would. Nothing after the end time is recorded, because
    the interpreter notices the interrupt a few statements late.
  - `state/assistantPython.ts` runs requests one at a time, interrupts a run on Stop or after 30 s
    of real time, and replaces a worker that does not answer 5 s after an interrupt.
- **Consequences.**
  - A second Pyodide costs its memory and a few seconds to start, the first time the assistant
    checks or runs code in a session.
  - The two new files sit in `workers/`, beside the code they reuse; neither changes the existing
    workers.

## ADR-0096 Ghosts are drawn into the shown document; the review strip reads the document's change

- **Context.**
  - SPEC 12.6 and acceptance 5: a ghost per streaming tool call, a part at its anchor, a lead as a
    design curve once both ends parse, never simulated, cleared on error or abort; on commit the
    ghost becomes the real object and a lead becomes physical. ADR-0070 already keeps a lead that
    only a preview holds out of the solver, and ADR-0051 hovers what a preview holds and seats what
    a commit moves. SPEC 11.8: "Claude added N parts, M wires · Keep · Undo all", tinted until kept.
- **Decision.**
  - `setGhost` keeps the ghosts in `useStudio.ghosts`, by tool call; an unchanged ghost is not set
    again, so most deltas redraw nothing. The Studio draws `withGhosts(committed, ghosts)`: each
    ghost part under its designator (or `ref?call` when that is taken), each ghost lead as
    `ghost:<call>` with length `auto`. Ghosts hover 4 mm over their holes, are tinted violet, and
    their leads follow design curves; the commit drops the real part and lead into place and the
    solver takes the lead. A ghost of a part the document does not define yet is not drawn.
  - Every Studio and panel site that looked a part up in the library now resolves it in the shown
    document (`defOf`, over `docPartDefs`), so a project's own part draws as its footprint and
    leads, with no body.
  - The review compares the document when the turn began with the one it left: parts and leads
    added, custom parts defined, items changed or removed, and the code, build-step notes, boards,
    T-board and Pi, or name when they changed. Added and changed parts get a violet halo and leads
    a violet overlay; a rating halo and Board Sense's tint win where they overlap. The strip lasts
    while the turn is the latest change: Keep, Undo all, an undo or the next edit by hand ends it.
- **Consequences.**
  - A ghost carries no props, so an LED's ghost lens shows the default colour until it commits.
  - A turn that only wrote code reads "Claude updated the code".

## ADR-0097 capture_view reads the frame it has just drawn

- **Context.**
  - SPEC 12.5: capture_view waits for physics to sleep (at most 2 s) and returns a PNG of the top
    or iso view. The Studio renders on demand through TRAA, and a WebGPU canvas's image is reliable
    to read only in the task that drew it.
- **Decision.**
  - `StudioView.capture(preset)` keeps frames coming until the cables report asleep or 2 s pass,
    jumps the camera to the preset, draws `SETTLE_FRAMES` frames there so TRAA converges, and on
    the last one, right after rendering, copies the canvas into a 2D canvas no larger than 1568 px
    on its long side and encodes it as PNG. The camera then goes back where it was.
  - Focus frames the refs' bounding sphere (at least 25 mm) from the current direction. Highlight
    marks the refs (part pins, lead ends, holes, a net's strips and ends) and shows its caption
    until dismissed; a focus with a note shows the caption only.
- **Consequences.**
  - The captured view is the drawn bench in headless Chromium on WebGPU (the e2e test checks its
    size and that it is not blank) and in the Tauri window on WebGPU, where the dev replay's
    capture of the iso view showed the built blink circuit, with the camera back where it was.
  - With the Studio closed, capture_view fails with a plain message and the turn goes on.

## ADR-0098 The key, the settings and the transcript

- **Context.**
  - SPEC 4.2, 12.1 and 12.2: the key goes to the Keychain through Rust, and its commands return
    booleans only; `assistant.model`, `assistant.effort` and `assistant.webTools` are settings.
    SPEC 11.9 saves the transcript next to the project, and acceptance 11 keeps secrets out of
    transcripts.
- **Decision.**
  - `native/anthropic.ts` gains `setKey`, `hasKey` and `clearKey`, each returning a boolean. The
    Settings field is uncontrolled: Save reads it once, clears it and hands the value on; no state
    holds it. A chat message that looks like a key (`sk-ant-…`) is not sent, and the composer is
    cleared.
  - `native/settings.ts` reads and writes the three settings; the defaults in `settings.rs` were
    already `claude-opus-5-5`, `high` and `true`, and the allowlist already held the keys. Model
    and effort apply from the next turn; web tools from the next conversation (ADR-0087), and
    Settings says so.
  - The transcript is `<id>.transcript.json` beside `<id>.gpiob`, written by a new command,
    `projects_write_transcript`, after every turn and on a project's first save. It holds what was
    said, each tool call's label, status and result (images replaced, results cut at 4000
    characters), the model, effort and cost. Rust redacts anything shaped like an Anthropic key
    before writing, and deleting a project deletes its transcript. Opening another project starts
    a new conversation.
- **Consequences.**
  - The new command is in `build.rs`, `permissions/app-commands.toml` and `main.rs`, which the
    loopback test checks agree; no plugin or capability changed.
  - A transcript is a record, not a resumable conversation: the API history (thinking signatures,
    captured images) is not saved.

## ADR-0099 The drawer is tested through a stand-in for the native bridge

- **Context.**
  - The e2e tests run in Chromium without Tauri, and no API key is used to record real streams.
- **Decision.**
  - `e2e/assistant.ts` installs `window.api` with an Anthropic proxy that plays recorded Messages
    API streams (built from `assistant/testing/sse.ts`) in 48-byte chunks, a reply that stops and
    waits for an abort, a Keychain that logs its calls and keeps only a flag, and settings and
    projects in memory. Everything above the bridge is the app's: `nativeAnthropicFetch`, the SDK,
    the loop, the tools, the store and the Studio.
  - `VITE_ASSISTANT_REPLAY=blink npm run dev` replays the blink turn in the app through a delayed
    fetch, ending with a capture of the iso view, for a look in the Tauri window without a key. It
    neither reads nor writes the Keychain. It is dev only; production builds drop it.
- **Consequences.**
  - The streams are hand-written to the documented event shapes; the first live run (HIL
    checklist) confirms them against the API.

## ADR-0100 The evals run the app's own TypeScript in Node through Vite's module runner

- **Context.**
  - SPEC 18 wants the assistant evals to run the real loop against a context made of the real
    `CircuitStore`, ERC, `SimSession` and Pyodide. Those modules import `?raw` files and use
    `import.meta.glob` (the part library, the tutorials, the Python shims, the system prompt), which
    only a bundler resolves. Node's own type stripping loads none of it.
- **Decision.**
  - `scripts/assistant-evals/cli.ts` is a plain Node script. It starts a Vite server in middleware
    mode with no config file and no plugins, and imports `main.ts` through
    `createServerModuleRunner`, so every `@renderer/...` import loads as it does in the app and in
    Vitest. Nothing in `R/` is copied, patched or aliased to a stand-in.
  - Vitest imports the same modules, so `replay.test.ts` runs the replay in the test run with no
    second code path.
  - Pyodide is given its folder as `indexURL`: it works out its own folder from a stack trace, and
    the runner's source-map support rewrites that trace to a path in Pyodide's sources.
- **Consequences.**
  - The harness depends on Vite 7's module-runner API (`createServerModuleRunner`), which is
    exported but newer than the rest of Vite's server API.
  - `tsconfig.json` includes `scripts/assistant-evals`, so `npm run typecheck` covers the harness,
    and `allowImportingTsExtensions` lets the two files Node loads itself (`cli.ts`, `proxyTest.ts`)
    import `key.ts` with its extension.

## ADR-0101 A live run is kept as the API's side of the conversation, scrubbed, and replayed

- **Context.**
  - Mock mode has to replay a live run with no key and no network, and the repository is public.
- **Decision.**
  - `recordFetch` wraps the fetch under the SDK client and keeps, for each request the SDK makes,
    the JSON body it sent and the status and body that came back (the SSE text). It never reads a
    header, so the Authorization header cannot reach a fixture. A refused or retried request is
    kept like any other, so a replay goes through the same fallbacks.
  - Before a fixture is written, every `signature`, `encrypted_content` and `encrypted_index` value
    is replaced by `scrubbed`: they are opaque tokens bound to an account, and replay never sends
    them anywhere. Writing a file that holds anything shaped like `sk-ant-...`, or the key itself,
    is refused, and a test scans every fixture.
  - A fixture stores each request's `messages` as what was added since the request before (the
    history only grows, ADR-0087) and its `system` and `tools` only when they changed. Replay
    rebuilds the full request bodies and serves the responses in order.
  - Replay does not require the requests it sends to equal the recorded ones: the tool results the
    model saw come from today's code, so a change to a tool's wording would otherwise fail every
    fixture. It counts the requests that differ and reports the count. What replay does require is
    that every check scores as it did live and that no recorded response is left over.
  - `npm run evals -- --rescore` records today's scores as the expected ones, for when the scoring
    code changes on purpose.
- **Consequences.**
  - A fixture is a record of one model run; `npm run evals:live` replaces it.
  - A change that makes a recorded tool call fail (a renamed argument, a stricter validation) shows
    up as a changed score in `replay.test.ts`.

## ADR-0102 The key is read by the process that uses it, and live runs use the app's client

- **Context.**
  - SPEC 3.3 lets exactly two kinds of process use the key: the live evals and the ignored Rust
    proxy test. Neither may print it, copy `.env`, or put it in the Keychain or in the environment
    of any other process.
- **Decision.**
  - `key.ts` finds the main checkout's `.env` from `git rev-parse --git-common-dir` (so a worktree
    finds it), reads `ANTHROPIC_API_KEY`, and returns a function. The key is not put in
    `process.env`. `cli.ts` reads it only for `--live`; replay never opens the file.
  - Live runs build the client with the app's own `createClient`, so the SDK holds a placeholder
    key, and a fetch replaces the SDK's bearer with the real key, as `anthropic_request` does in
    the app. Output goes through `redact`, and files through `assertNoSecret`.
  - `npm run evals:proxy` builds the Rust test binary with no key anywhere, then starts that one
    binary with the key in its environment and runs
    `live_count_tokens_through_the_real_proxy_path`.
- **Consequences.**
  - The two live paths differ from the app in transport only (Node `fetch` instead of the Rust
    proxy). The proxy's own path is the one the Rust test covers.

## ADR-0103 How a run is scored

- **Context.**
  - SPEC 18 scores each prompt on zero ERC errors, passing sim assertions, inventory respected,
    code pins matching the netlist, and turns and tokens.
- **Decision.**
  - Every score reads the final document and the transcript, never the model's claims. The checks
    every run gets: each turn ends `end_turn`; zero ERC errors; the wiring convention; inventory;
    the code compiles (Pyodide) and its pins are the pins with something wired to them, in both
    directions; no claim to have run anything on hardware; every ghost cleared; and, for a prompt
    that builds, undo restores the starting document (compared with strict deep equality).
  - The wiring convention check is `validateDoc` (genders, holes, placement), plus: a hole-to-hole
    lead is male-male; no part leg sits in a T-board strip; every Pi net a part uses is reached by
    a lead that has an end in that net's T-board strip. The shipped tutorials are its test.
  - Each prompt adds behaviour checks that run the project: the simulator with the GPIOs and part
    inputs a user would set, and the project's own program in the simulator's Pyodide against the
    circuit, with scripted input changes. The ECHO check follows resistors from ECHO to a GPIO and
    from that GPIO to GND, and simulates a measurement to see that no GPIO net passes 3.6 V.
  - A program run for a score has `signal.pause()` wait in virtual time. The app's Pyodide returns
    from it at once, so an event-driven program ends at t = 0 and would be marked wrong for the
    shim's gap. The model's own `run_code_in_sim` is not changed, so it sees what the app would
    give it.
  - A program is stopped where the simulator's clock reaches the requested seconds, by raising from
    the next shim call. Pyodide's interrupt arrives 0 to 2 s of virtual time late, and not the
    same each run, which made the model's tool results differ between a live run and its replay.
- **Consequences.**
  - A failed check is a finding about one run, not a harness error: the report names which.

## ADR-0104 The evals measure the shipped core, fallbacks included

- **Context.**
  - The first live request of every session is refused ("The compiled grammar is too large"), and
    the loop falls back twice before a request is accepted. The organization's web search is also
    refused at times (docs/v2/EVALS.md).
- **Decision.**
  - The evals run `AssistantSession` as it is, so each recorded run shows the fallback the app takes
    today. They do not patch the tool list in transit to make the first request pass.
  - Only the datasheet prompt turns the web tools on. When a run of it ends on "Web search is not
    enabled for this organization", the harness runs it again (up to twelve times, pausing longer
    each time; a refused request costs nothing), because the loop has no answer to that error. Under
    `--search`, a request that carries the tool and is refused that way is also sent again,
    unchanged, up to fifteen times, below the tape, and the fixture says how often. If the saved
    live checks show web fetch but not web search, or under `--no-search`, the harness removes
    `web_search` from the tool list in transit, after the recording, and the fixture says so.
    The recorded datasheet run is the second kind: web search was refused throughout.
- **Consequences.**
  - The recorded runs have no eager streaming and no strict tools. They measure the model with the
    plain tools, not the ghosts: whether a preview appears before a tool's input completes is a
    property of the app's window, which a headless run cannot see.

## ADR-0105 Eleven tools are strict, twelve stream eagerly, and a refused first request drops one flag at a time

Supersedes the strictness decision of ADR-0084 ("every tool that takes parameters is strict") and
the fallback of ADR-0085 (one retry that drops both flags). The rest of both stands: the Zod
schemas, the shapes that strict forces, `eager_input_streaming` on the 12 mutation tools, and
retrying on the first request only. ADR-0104's last consequence (the recorded runs have no eager
streaming and no strict tools) no longer holds.

- **Context.**
  - ADR-0084 sent `strict: true` on all 20 tools that take parameters, inside the documented limits
    (20 strict tools, 24 optional parameters, 16 union-typed parameters). The API has a further
    limit that is not documented and can not be checked offline. The first live run (docs/v2/EVALS.md,
    problem 1) was refused, with and without eager streaming, with:
    ```
    400 invalid_request_error: The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.
    ```
    Plain tools were accepted. Every session therefore ran on plain tools with no eager streaming,
    and the early ghosts of acceptance 5 (SPEC 12.4, 12.6) were lost. The notice the loop showed
    for its first step blamed eager streaming, which was not the cause.
  - Measured live: `eager_input_streaming` on 12 plain tools is accepted; each of the 20 strict
    tools compiles alone; the limit is the size of the compiled grammar, not a count. Growing the
    strict set from the mutation tools, 11 fit in the whole 22-tool request with eager on the 12
    mutation tools, and no other tool fit beside them.
- **Decision.**
  - `STRICT_TOOLS` in `tools/index.ts` is the set sent with `strict: true`: `get_circuit_state`,
    `add_board`, `place_tboard`, `place_part`, `move_part`, `remove_part`, `set_part_props`,
    `connect`, `set_wire_props`, `remove_wire`, `write_code`. They are the tools that change the
    document through the most structured input (a hole, a net, a property list), plus the one read
    that every turn starts with. The other nine are checked by their Zod schemas when they run, as
    all 22 are. A contract test pins the set; the live checks `strict-set`, `strict-all` and
    `strict-room` measure it again.
  - `eager_input_streaming` stays on all 12 mutation tools, strict or not.
  - On the first request of a conversation (no assistant message yet, so no thinking block is
    bound to the tools), a 400 whose message names strict, eager, a grammar, a schema or
    complexity is answered by dropping one flag and sending the request again: strict first,
    eager first when the message names it. The chain is strict and eager, then eager alone, then
    plain tools. Each step tells the user with a notice (`strict-refused`, `eager-refused`) that
    quotes the API's own message, so it names the cause the API gave. After the last step the
    error ends the turn.
- **Consequences.**
  - Nine tools lose the grammar guarantee: `search_parts`, `define_custom_part`, `simulate`,
    `run_code_in_sim`, `capture_view`, `focus`, `highlight`, `annotate_build_steps`, `ask_user`.
    Their input is validated here, and a wrong input comes back as `INVALID_INPUT`, which the model
    reads and corrects.
  - Adding a tool to the set is a live question: add it to `STRICT_TOOLS`, run
    `npm run evals:live -- --checks-only`, and keep it only if `strict-set` still answers yes.
  - If the API's budget changes, the first request falls back by itself and says why.

## ADR-0106 A web tool the API refuses is dropped from the first request

Amends ADR-0086, whose web tools had no answer to an organization that does not have them.

- **Context.**
  - Web search is refused for this organization at times, with
    `400 invalid_request_error: Web search is not enabled for this organization`, and accepted at
    others with the same key and tools (docs/v2/EVALS.md, problem 2). The loop retried only
    strict, eager and schema errors, so the refusal ended the turn, and the user could do nothing
    with it. Web fetch was accepted every time.
- **Decision.**
  - On the first request of a conversation, a 400 that says `web search` or `web fetch` "is not
    enabled" removes that tool from the conversation's tools, sends the request again, and tells the
    user with a `web-tools-refused` notice that quotes the API and names the setting that turns the
    web tools off. The other web tool stays: fetch alone still reads a datasheet URL the user gives.
    It can happen once for each tool.
  - A refusal later in a conversation is not retried: the tools are bound to the thinking blocks
    already in the history (ADR-0087), so the turn ends with the API's message.
- **Consequences.**
  - The conversation's tools are fixed again after the first request, so the cache and the thinking
    blocks hold from there.
  - The evals meet the refusal through the loop and record the notice. The harness takes web search
    out in transit only for `--no-search` or after `--wait-for-search` finds it refused throughout,
    and resends a refused request unchanged only under `--search` or `--wait-for-search`.

## ADR-0107 A simulator input is a declared property, and a part with no model adds no devices

Follows ADR-0093, which says that anything that seeds a simulator input through a property must
declare it.

- **Context.**
  - `simulate` takes inputs by property name, and accepts only the properties a part declares.
    `tact-switch-6mm` declared `mode` and not `pressed`, which the simulator reads, so no press could
    be simulated (`{"NO_SUCH_INPUT":"SW1 has no input pressed"}`). `tilt-switch` already declared
    `tilted`. A part with `simModel: "none"` made `Circuit` throw, so the whole project failed with
    `SIM_ERROR`.
- **Decision.**
  - The fix is in the part definition, the layer ADR-0093 names, and not in a mapping inside the
    tool: `tact-switch-6mm` declares `pressed` (boolean, default false). The Properties panel
    already treats `pressed` as an input property.
  - `simulate` checks an input's name and value with `propProblem`, the check `validateDoc` and
    `set_part_props` use, so `BAD_PROP` keeps its meaning. A wrong name lists the part's properties
    (`NO_SUCH_INPUT`); a wrong value type is `BAD_INPUT`.
  - A test records every environment key the simulator reads from each library part and requires it
    to be declared. The keypad's `pressedKeys` is text, which a property can not be yet, so it is
    the one listed exception.
  - `Circuit.addPart` treats `none` as a part whose pins are nets and which stamps nothing.
- **Consequences.**
  - A tact switch now has a `pressed` property in the document's defaults, shown with the other
    input properties.
  - The assistant can not press a keypad key in `simulate`; that needs a text property type.

## ADR-0108 `signal.pause` waits in virtual time, and the gpiozero shim covers what the code reader knows

- **Context.**
  - `signal.pause()` returns at once under Pyodide, so a program that sets gpiozero callbacks and
    pauses ended at t = 0 in `run_code_in_sim`. The shim defined five classes while
    `core/code/pins.ts` reads sixteen, so `from gpiozero import DistanceSensor` raised ImportError and
    the assistant fell back to RPi.GPIO (docs/v2/EVALS.md, problems 4 and 6).
- **Decision.**
  - `_prelude.py` replaces `signal.pause` with a loop of 10 ms virtual sleeps. It ends when the run
    does: Stop, Ctrl+C and the end of the run's time all arrive as `KeyboardInterrupt`. 10 ms is how
    late after an input changes a callback runs.
  - The prelude also keeps a list of pollers, which a sleep runs each period of virtual time. A
    device whose events gpiozero takes from a thread (a distance sensor's range events) adds one
    when a callback is set. Devices with edge events use the simulator's edge detection, as `Button`
    did. With no poller a sleep is exactly one `_sim.sleep`, so every existing program keeps its times.
  - The shim gains `OutputDevice`, `DigitalOutputDevice`, `PWMOutputDevice`, `RGBLED`, `Servo`,
    `AngularServo`, `InputDevice`, `DigitalInputDevice`, `MotionSensor`, `LineSensor` and
    `DistanceSensor`. They drive and read the pins the part models answer on: `DistanceSensor` pulses
    TRIG for 10 us and times ECHO call by call (5 us of virtual time each) against the HC-SR04
    model, `Servo` and `AngularServo` send the pulse width as PWM for the SG90 model, and
    `MotionSensor` reads the HC-SR501's OUT. A callback may take the device or nothing, as in gpiozero.
    Not modelled: fades (`PWMLED.pulse`, `RGBLED.blink`), `Button.when_held`, and the sensors'
    smoothing queues.
  - `codePins` reads `RGBLED`'s three pins and `DistanceSensor`'s two by position as well as by
    keyword, and exports the class list so a test can require the shim to have each one.
- **Consequences.**
  - The eval harness no longer swaps `signal.pause` in for the scores: the model sees what the scores
    judge.
  - Nothing changes a part's input during a `run_code_in_sim`, so a callback that waits for an
    edge on a pin does not run there: the run shows that the program sets up and waits for the
    time it was given. Input changes during a run are not a parameter of the tool.
  - SPEC 13.2 lists the old five classes and wants the line updated.

## ADR-0109 Build Mode draws a document derived from the circuit, and never writes to it

- **Context.** SPEC 11.7 grows the bench step by step, and SPEC 11.9 makes a tutorial a read-only
  template. The Studio draws `circuit.getSnapshot()`, and `circuit.open()` settles the cables
  afresh each time.
- **Options.** (a) Dispatch each step's ops into the CircuitStore: the tutorial opens empty, the
  undo history fills, the Workbench reloads its simulation on every step, and leaving mid-way
  leaves a half-built project. (b) Open `docUpTo(step)` as the document each time: nothing is
  incremental and the cables reset. (c) Draw a derived document and leave the circuit alone.
- **Decision.** (c). At step *i* the stage draws `docUpTo(doc, steps, i - 1)` (the steps done) and
  step *i*'s part or lead as one more ghost (`studio/build.ts`, `stepScene`). The view's reads of
  the document go through `base()`, the document the bench holds as committed (Build Mode's, else
  the app's), and `conn()`, its connectivity (`computeState` of that document): hover, picking,
  the insertion animation, the cables and the tooltip. A step done adds its part or lead to the
  base, which drops in over 150 ms (ADR-0051) while the solver starts its lead and lets it settle
  (ADR-0070); going Back turns it into the ghost again. Once the last step is passed the base is
  `docUpTo` of the last step, which equals the tutorial's document.
  - While a build is played the canvas refuses edits (`refuseWhileLocked`, and `edit()` for anything
    but `SetCode` and `SetMeta`), presses switch nothing and the pin menu stays shut: they would act
    on parts that are not drawn.
  - Nothing glows or moves from the simulation until the build is finished (the visuals get no
    snapshot), and Board Sense's tint is off. Both compare against the finished document, so every
    net not yet built reads as diverged, and the overlay then asks the sim worker for the causes of
    each (one `rankCandidates` of the whole document per net), which starved the mock sweeps. The
    step card reports what the sweeps say of the step in hand instead.
- **Consequences.**
  - `docUpTo` keys on bare refs (a part and a lead sharing an id would both appear with either's
    step). A test checks that no shipped tutorial shares one.
  - Opening another project or tutorial ends Build Mode; an edit of the same one (undo, the
    assistant) regenerates the steps and keeps the step in hand where it still exists.

## ADR-0110 The step's holes are ringed by DOM elements, so a held step draws no frames

- **Context.** SPEC 11.7 asks for a pulsing ghost at the exact holes; SPEC 10.2 and 10.8 ask for
  zero frames when the scene is static. A pulse drawn in the scene renders the whole post stack
  (two geometry passes, GTAO, TRAA) at the display rate for as long as a step is read.
- **Decision.** The ghost itself is the assistant's ghost (violet, hovering 4 mm over its holes,
  tinted, never simulated). The pulse is a ring per hole or module pin (`studio/stepMarks.ts`): a
  DOM element over the canvas, positioned from the camera on each drawn frame as the labels are,
  animated by a CSS keyframe (`step-pulse`, 1.4 s; none under `prefers-reduced-motion`), with a dot
  that stays where the ring fades. It is outside the element the orbit controls listen on. Rings
  stand on the holes, so the part hovering above does not hide them. The T-board step has no part
  to ghost (the T-board belongs to the bench), so its rings mark pin 1 and pin 40 and its frame is
  the T-board and the Pi. Board Sense's likeliest cause for a diverged step adds red rings at its
  holes.
- **Consequences.** A held step costs no frame once the camera and TRAA settle (an e2e test counts
  them over 1.5 s). Rings that stand where they stood are not rebuilt, so the pulse keeps its beat.
  The tone classes are written out in `stepMarks.ts`: the stylesheet's content scan does not see a
  class assembled from a template string (the first version lost its colours that way).

## ADR-0111 Framing, and depth of field as an option that is off until asked for

- **Decision.**
  - A step's frame is the bounding sphere of its marks and its part's box, at least 25 mm across
    (`FOCUS_MIN_RADIUS_MM`), seen from the direction the camera already has, reached by the
    preset tween (`PRESET_MS`, 500 ms, eased). `report().build.framingMs` is the time from setting
    off to the frame that ended the tween; an e2e test holds it to 600 ms on every step of every
    tutorial. Reopening the Studio in the middle of a build puts the camera there at once.
  - Depth of field (`Post.setFocus`, ADR-0025) follows the camera's target: the focus distance is
    the camera-to-target distance, set on each frame, so orbiting and the tween keep the target
    sharp. It is a checkbox in the panel, off by default and remembered, because it blurs the rest
    of the circuit the reader may want to see, and is the first thing SPEC 10.8 scales back. It is
    skipped on the finished bench, which has no target, and `setFocus(null)` runs when Build Mode
    ends.
- **Consequences.** `Post.setFocus` had no caller before; an e2e test exercises it (the output node
  swaps to the depth-of-field output and back) and a screenshot in Chromium on WebGPU shows the
  background soften with the step sharp.

## ADR-0112 Step confirmation: signatures once per step, two sweeps to believe, a stricter "changed"

- **Context.** `checkStep` simulates the board before and after the step on every call: 0.15 to
  6.8 s per call on the shipped tutorials (led-dot-matrix 6.8 s, four-digit-seven-segment 3.1 s),
  and a sweep arrives every 250 ms. It also counts GPIO2 and GPIO3, observable through their board
  pull-ups, as changed by any step that alters how another pin answers them in the pair table; they
  always match. On a full probe it therefore confirms 34 steps of the shipped tutorials, 24 of them
  with no evidence about the step (the Blinking LED's last lead, eight of led-bar-graph's, eight of
  flowing-leds', the Button's W2, among others), where SPEC 14.5 says an LED path is never shown as
  verified. On four-digit-seven-segment, `probeSignature` throws (`gmin stepping stalled`) for the
  partly built boards of steps 45 to 51.
- **Decision.**
  - `StepChecker` (`state/buildSense.ts`) loads `docUpTo(i)` into a sim worker of Build Mode's own
    and takes its probe signature, once per step and pin set, one request at a time; the main
    thread only judges. `judge` (`state/buildCheck.ts`) is `checkStep`'s verdict on those
    signatures, except that a pin counts as changed when its own reading changed or its reading
    against another observable pin did; it confirms 10 of the 34. A test holds it equal to
    `checkStep` on the three-pin fixtures and pins the difference on the full probe (that test
    fails once core is fixed, which is the cue to delete the difference). A board that does not
    simulate shows "Board Sense cannot check this step" and waits for Done.
  - A verdict shows once two sweeps in a row give it (SPEC 14.5: a change counts once it persists).
    A step confirmed that way is marked done, ticks in the list as sensed, and the build moves on,
    unless it was done already (Back revisits a step; sweeps do not carry the build off it). A
    diverged step shows what each differing pin reads against what the step should leave, and the
    ranked causes of the board as the step should leave it, found by the same worker.
  - Build Mode only reads `senseStore` (a new read-only `sweep` field). It never starts, stops,
    pauses or configures sensing, and does not set `mockBoard`; tests and the walkthrough do.
  - The mock timer waits for a sweep in flight instead of queueing another every 250 ms: a sweep
    can take seconds on a busy machine, and the backlog left the sweeps describing the board as it
    stood a minute before.
- **Consequences.** Core's `checkStep` should adopt the stricter rule and expose its two
  signatures so a caller can compute them once (see the lane report).

## ADR-0113 Progress is kept in browser storage, by project

- **Decision.** The steps done and the step in hand (by step key, so edits elsewhere do not move
  them) are written to `localStorage` under `gpio.build.progress.project:<file id>` once the
  document is one of my projects, else `gpio.build.progress.tutorial:<tutorial id>` for a template;
  a document that is neither (a new, unsaved project) keeps its progress for the session only. The
  blur choice is `gpio.build.blur`. Storage that is missing or full is ignored.
- **Why not the settings.** The plain settings are an allowlist in Rust (`SETTINGS_ALLOWLIST`); a
  new key is a Rust change outside this lane. The app is served from one loopback origin
  (ADR-0008), so the storage persists between runs.
- **Back, Next and Done.** Back and Next only move; Done marks the step in hand done and moves on;
  Board Sense does what Done does for a step it confirms. A finished build reopens finished, with
  Start over.

## ADR-0114 Tutorials open as templates and fork as themselves

- **Decision.** `openTemplate` opens a tutorial's document with no project file (so `isTemplate()`
  holds and `edit()` refuses it), named by the tutorial's id for Run on Pi. `forkTemplate` writes
  the document, unchanged but for `meta.created` and `meta.updated`, as a project file of its own
  and opens it. It still names `sourceTutorialId`, which records where it came from and no longer
  makes it a template once it has a file. The Tutorials page has "Build in the Studio", "Open in
  Studio" and "Fork to my projects"; the Studio shows a template badge with the same fork button.
- **Consequences.** A fork equals its tutorial in everything the circuit, the code and the notes
  hold (an e2e test compares them), and the tutorial is left as it was. Run through the real
  `projects_write`, `projects_list` and `projects_delete` in the Tauri window, a fork gave the same
  document.

## ADR-0115 A hardware checkpoint has a place in the step, and it is empty

- **Decision.** `useBuild.checkpoint` is the tutorial checkpoint (`Checkpoint`, from the tutorial
  schema's `checkpoints`) that follows the step in hand, and the panel renders one under the step
  when it is set. It is `null` until M11, which fills it from the tutorial's
  `checkpoints[].afterStep` and runs the I2C scan, the press watch or the LED toggle (SPEC 14.4).

## ADR-0116 A step is confirmed by the pins its own change reads on, and its signatures are computed once

- **Context.**
  - `checkStep` counted a pin as changed when its whole row of the pair table differed. GPIO2 and
    GPIO3 are observable on any board, through the Pi's 1.8 kΩ board pull-ups (ADR-0013), and always
    match. A step that only changed how some other pin answers them (an LED path to 3V3, say) put
    them in `changed` and was confirmed. On a full 26-pin probe 34 steps of the shipped tutorials
    were confirmed, 24 of them on no evidence about the step, where SPEC 14.5 says an LED path is
    never shown as verified. The core test passed because it probed three pins.
  - It simulated the board before and after the step on every call: 0.15 to 0.5 s on most
    tutorials, 3.1 s on four-digit-seven-segment, 6.8 s on led-dot-matrix, against a sweep every
    250 ms. Build Mode (ADR-0112) worked round both with a copy of the rule and a worker.
- **Decision.**
  - `changedPins(before, after, pins)` is the rule: a pin counts when it is observable after the
    step and its own bias reading changed, or its reading against another observable pin changed, in
    either direction. A step that changes no such pin is "not electrically verifiable" and waits for
    Done or a checkpoint.
  - The check is two halves. `stepSignatures(doc, steps, index, pins, defs)` simulates the board
    before and after the step once and returns `{ before, after, changed }`; `stepSignaturesOf` does
    the same from two signatures a worker already computed. `judgeStep(signatures, measured)` compares
    one sweep with them and does no simulation (0.1 to 0.5 ms on a full probe). `checkStep` is the
    two in one call.
  - `state/buildCheck.ts` is `judgeStep` on `stepSignaturesOf` and holds no rule of its own.
    `StepChecker` (`state/buildSense.ts`) still asks its worker for one signature per step and pin
    set and is otherwise as it was.
  - The pins of a full probe are the finished document's probed GPIOs, which is what Board Sense
    senses (`senseStore` probes `signature.probed` of the open document).
- **Consequences.**
  - On a full probe 10 of the 34 confirm and 24 read "not electrically verifiable". The 10 are the
    pull-up or tie lead of the active buzzer, passive buzzer, Button, tilt switch, morse code and
    ultrasonic tutorials (one each), and W30 to W33 of four-digit-seven-segment.
  - ADR-0112's request of core is met, and the test it asked for, which pinned the difference
    between the local rule and core's, is replaced by tests of core on the shipped tutorials
    (ADR-0119).
  - Per-step cost for Build Mode is the signatures, once per step and pin set; judging is free.

## ADR-0117 A probe that cannot converge reports a board it knows nothing about

- **Context.** `probeSignature` threw `ConvergenceError: gmin stepping stalled at 1e-12` on
  four-digit-seven-segment steps 45 to 51 (W34, W21, W22, W25, W27, W29, W24). The bias and
  precharge solves converge there. Two corners of the pair test's transient stall: GPIO5 driving
  high at 37 kΩ with 10 pF, and at 86 kΩ with 100 pF. The trapezoidal rule rings in the LED network
  and Newton does not reach its relative tolerance of 1e-6. A finer step helps only one of the two;
  1e-4 relative with 0.1 µV on a node settles both in 9 ms.
- **Decision.**
  - Every solve in `probeSignature` runs at the default tolerances and, if Newton does not
    converge, once more at `reltol` 1e-4 and `vntol` 1e-7. A reading is classified against 0.8 V and
    2.0 V and the pull range alone moves one by volts, so 0.1 mV on 1 V matters only to a reading
    already on a threshold.
  - If that stalls too, `probeSignature` returns an unsolved signature instead of throwing: the
    probed and skipped pins as usual, every reading ambiguous, no net observable, and `unsolved`
    holding the reason. Any other error still throws.
  - `changedPins` finds nothing changed for a step with an unsolved board on either side, so
    `judgeStep` says "not electrically verifiable": with one board unknown, what the step changed is
    unknown. Build Mode's "Board Sense cannot check this step" remains for an error from its worker.
  - `mockSweep` throws for an unsolved board. A pad always reads something, and a stand-in that
    invented a reading would hide the board.
- **Consequences.**
  - All 56 boards of four-digit-seven-segment solve on the pins Board Sense probes there. Steps 45
    to 51 read "not electrically verifiable", as 52 of its 56 steps do.
  - Ranking candidate causes no longer aborts on a candidate that does not solve; it scores lowest.
    The Board tab shows every net of an unsolvable twin as unobserved instead of failing.
  - A board that stalls at both tolerances still has no readings. The test for that stubs the solve,
    because no shipped board stalls any more.

## ADR-0118 `docUpTo` finds a step by its key

- **Context.** `docUpTo` kept the parts and leads whose id was among the `refs` of steps 0 to the
  index. Part ids and lead ids are unique only within their own lists (ADR-0092), so a part and a
  lead with one id both appeared with either one's step.
- **Decision.** It keeps a part when `stepKey('part', id)` is the key of one of those steps and a
  lead when `stepKey('wire', id)` is. The signature is as it was, so the Studio and the e2e tests
  call it unchanged. `refs` stays for tutorial checkpoints.
- **Consequences.** The T-board step, whose key is `tboard`, adds nothing to the document, even to
  a part named `tboard`.

## ADR-0119 The full-probe check of the shipped tutorials is split over four files, and two tutorials are opt-in

- **Context.** SPEC 14.5 and 18 ask for the observability rule to hold on the tutorials, not on
  three probed pins. That needs a signature of the board at every step of all 26 tutorials, 26
  candidate GPIOs each: 411 steps. A signature costs 0.1 s to 3 s, in one file the set takes about
  190 s of simulation (led-dot-matrix 80 s over 36 steps, four-digit-seven-segment 59 s over 56, the
  other 24 about 61 s), and the rest of the suite runs in 7 s.
- **Decision.**
  - `core/sense/tutorialSteps.ts` runs one tutorial: the pins are the finished document's probed
    GPIOs, as Board Sense probes them; one signature per step; and for every step, the signatures
    are joined and judged.
  - A step in `SEEN` must change an observable pin other than GPIO2 and GPIO3, confirm against the
    mock agent's board as built, and read "waiting" against its board one step short. Every other
    step must change nothing, and read "not electrically verifiable" against a board that agrees with
    its prediction exactly. The 24 steps the old check confirmed on no evidence are also judged
    against the mock agent's board as built. Every board must solve.
  - Three test files take a third of the tutorials each by position (about 29 s together, run in
    parallel). `buildStepsTutorialsHeavy.test.ts` takes led-dot-matrix and
    four-digit-seven-segment and runs only with `FULL_PROBE=1` (about 150 s); otherwise vitest
    reports it skipped.
- **Consequences.**
  - A new tutorial or a changed one is checked on a full probe with no list to extend, unless it has
    a step Board Sense can see, which goes in `SEEN`.
  - Neither opt-in tutorial has a step in `FORMERLY_CONFIRMED`. Four-digit-seven-segment's four
    seen steps (W30 to W33) are checked only when `FULL_PROBE=1`; two of its boards that stalled
    (steps 45 and 48) are solved on every run by `buildSteps.test.ts`.

## ADR-0120 Live Pi state is the telemetry store, seen through the connection

- **Context.** SPEC 11.2 and 14.4 want the Pi's pins on the bench. Telemetry already reaches the app:
  the agent sends `gpio_state` about ten times a second, `ws.rs` drops a frame identical to the last,
  and `store/gpioStore.js` keeps the pins. The Rust side sends nothing for a state that has not
  changed, so a subscriber that starts late sees nothing until a pin moves: a feed started by the
  Inspect toggle would start empty.
- **Decision.**
  - `state/liveStore.ts` (`useLive`) reads `gpioStore` rather than listening to the bridge again. A pin
    is `{ bcm, level, direction: in | out | alt | none, pull, function, consumer }`, where `function`
    is the alternate function pinctrl names ("SDA1") and null for a plain GPIO. A pin whose state did
    not change keeps its object, and a frame that changes nothing publishes nothing.
  - It holds pins only while `ssh` is `connected` and the agent `running`. When either goes, the
    store and `gpioStore` are emptied (`clearPins`), so a new connection never starts from the last
    one's frame. Nothing is polled and no command is sent.
  - `gpioStore` now treats a changed pull or alternate function as news. Before, a program setting a
    pull-up, or I2C being turned on, changed neither level nor direction and was dropped.
    `store/gpioStore.d.ts` types it for the TypeScript callers.
- **Consequences.** The twin and the Monitor page see the same telemetry. PWM and fast toggling show as
  whatever the 10 Hz sampling catches: a duty cycle is not visible, and an LED on a PWM pin flickers
  between its lit and dark states.

## ADR-0121 The bench is painted from the pins, and lit by a simulation of its own

- **Context.** SPEC 11.5 asks for "Live Pi state" as an Inspect toggle that tints the header pins and the
  T-board strips from telemetry, and lights LEDs and other outputs from the real pin levels in place of
  the simulation's. It is read only, and a still scene renders no frame.
- **Decision.**
  - `studio/livepins.ts` (`LivePins`) colours each GPIO's header pin (`BenchLayer.setPiPin`) and the five
    holes of its T-board strip (a `Markers` set lifted 0.2 mm, 1.4 mm squares, smaller than Board
    Sense's 2 mm tint so both read on one strip). An output is saturated and an input pale; warm is
    high and cool is low; an alternate function is violet whatever its level; a pin with no function
    is left bare. The key is in the Inspect panel, with the pins that matter to the document (wired,
    driven or alternate) and their state in words. Hovering a strip adds "Pi: output, low" to its
    tooltip. Each sync compares a key of the pins' colours and the board placement with the last and
    does nothing when they match, so repeated telemetry draws no frame (an e2e test counts them).
  - `state/liveSim.ts` runs the open document in a sim worker of its own with every pin set as the Pi
    reports it: an output at its level, and any other pin (an alternate function too) as an input
    with the pull pinctrl shows. While the toggle is on and the Pi is there, `view.syncVisuals` feeds
    SimVisuals that snapshot (and its issues) instead of the Workbench's, so LEDs glow, parts move and
    current dashes run from the real pins. The Workbench's own simulation, its GPIO states and the Sim
    panel are untouched. Pin changes queue and only the newest state is solved, since each request
    costs a solve and an ERC pass.
  - A bench shown as built so far (Build Mode in progress) keeps its pins painted but nothing glows
    and no badge shows, as for Board Sense's tint (ADR-0109).
- **Consequences.** Inputs the real world drives (a button held, a sensor) are not known to the
  simulation, so they sit at their defaults in the lit bench; the pins' own colours show their real
  levels. The Pi's header pins sit under the ribbon's IDC socket in the iso view; the strips are the
  readable part.

## ADR-0122 Telemetry divergences: four kinds, held for 600 ms

- **Context.** SPEC 14.4 compares live pins with what the document and its code expect: an output
  driven where the netlist says input, or a level the simulation says cannot happen.
- **Decision.** `state/liveCheck.ts` is a pure comparison; `state/liveDivergence.ts` keeps it current
  while the toggle is on and shows a divergence once it has held 600 ms, because pins change between
  two frames when a program starts or ends. What a pin should be is the code's word if it names the
  pin (`codePins`), else what is wired to its net through series resistors, switches and LEDs: a
  switch contact or a part's output pin is read; a part's input pin, a transistor base or an LED is
  driven. Four kinds, each with a plain reason and likely cause:
  - **drives-input** (error): the Pi drives a pin the circuit reads (a button, a sensor).
  - **not-driven** (warning): a program has run 3 s and a pin its code drives is still an input.
  - **wrong-function** (warning): an I2C part on GPIO2 or GPIO3 whose pin has no SDA or SCL function
    (I2C is off), or a plain GPIO with an alternate function (serial console, an overlay).
  - **impossible-level** (warning): an input reads the other level from the live simulation, and the
    net has no switch, sensor or part output on it that could change it.
- **Not done.** A switch's orientation ("GPIO18 expected HIGH while SW1 is released but reads LOW") is
  not a continuous check: the app cannot know whether the button is held. It is the press checkpoint
  (ADR-0125), which asks for rest first and then the press.

## ADR-0123 Badges are buttons outside the orbit element, and open a card

- **Context.** SPEC 14.4 and 14.5 want divergences badged in 3D, each linking to its explanation, and
  everything clickable outside the orbit controls' element (their pointer capture takes clicks).
- **Decision.**
  - `studio/badges.ts` (`BadgeLayer`) puts one `<button>` over each badge's net, positioned by the
    camera each frame as the labels are, in a layer that is a sibling of the stage element, drawn
    above it with `pointer-events: none` except on the buttons. Badges on one pin stand side by side.
    A badge sits at the net's first part pin, else its first lead end, else its strip.
  - `state/badges.ts` makes them: from telemetry divergences (while Live Pi state is on, the Pi is
    there, and the bench is not drawn as built so far) and from Board Sense's diverged nets (while its
    overlay is on and sensing runs, outside Build Mode), the latter with up to three ranked causes and
    their holes. Board Sense's diverged-net text tag stays; the badge is what opens the explanation.
  - A click opens `BadgeCard` in `Studio.tsx`: what differs, the likeliest cause, the ranked causes,
    the parts involved, and "Open the Board tab". It closes when its badge goes and does not reopen.
- **Consequences.** An e2e test asserts the stage element holds no button and the badge sits inside
  the canvas rectangle.

## ADR-0124 A checkpoint hangs on the first step that completes what it checks

- **Context.** SPEC 11.7 lets a step define a hardware checkpoint, and ADR-0115 left the slot empty,
  to be filled from the tutorial's `checkpoints[].afterStep`. Those lists are written by hand, and
  six checkpoints in five of them name a step before the circuit is complete (below): a check
  offered then runs on a circuit with no return path. Projects, forks and assistant builds have no
  list at all.
- **Decision.** The rule is derived from the document (`state/checkpoints.ts`, `deriveCheckpoints`),
  and the slot is `useBuild.plan` (the build's checkpoints) and `useBuild.checkpoints` (those on the
  step in hand), in place of ADR-0115's single `checkpoint`. A checkpoint hangs on the first step
  after which the board as built to that step has:
  - **i2c-scan**: an I2C module (a part whose definition gives `i2cAddress`) with SDA on GPIO2, SCL on
    GPIO3, VCC on 3V3 or 5V and GND on GND. The module's own address and its strap alternative
    (`i2cAddressAlt`, for the LCD backpack) are accepted as any-of.
  - **press**: a tact switch with a GPIO on one side (its terminals are joined in pairs) and a supply
    or ground on the other, or a joystick whose SW is on a GPIO with its VCC and GND connected.
  - **toggle-led**: an LED, RGB LED or LED bar pin with a GPIO at one end of its current path and a
    supply or ground at the other, through series resistors only, or through a relay module's NO to
    COM contacts, which the GPIO on the module's S pin closes. At most three per build, in the order
    they complete, and never on GPIO0 to GPIO3 (the ID EEPROM, and the I2C bus with its board
    pull-ups).
  Because it reads the circuit, a half-built circuit offers nothing, and the card appears once the
  wiring is there to check.
- **Against the hand-written lists.** The rule agrees with every checkpoint a tutorial lists, by kind,
  part and pin (a test holds that), and with 16 of the 22 on the step. In the other six the list is
  earlier than the rule: tilt-switch (W4 and W2; the ground leads come after), potentiometer and
  photoresistor (W9; the 3V3 lead W8 comes after), morse-code (W6 is step 8 of 12; the ground lead is
  step 11) and joystick's press (W11; the module's ground is step 13). The bar graph and flowing LEDs
  get three toggles where their lists give one. Those lists can be dropped or kept as notes; nothing
  reads them.
- **Consequences.** `Checkpoint` is still the tutorial schema's type, so a hand-written list can be
  checked against `deriveCheckpoints`.

## ADR-0125 How a checkpoint runs: one click, and what it touches

- **Context.** SPEC 1 (principle 5) and 18: only the user's click runs code on the Pi or touches a
  pin, and never the assistant.
- **Decision.** `state/checkpointStore.ts` is called only by the buttons of the step card
  (`panels/Checkpoints.tsx`); the assistant's tools cannot reach it (lint keeps `assistant/` off
  `state/`). Opening a step, moving between steps and loading a project start nothing.
  - **I2C scan** calls `ssh_i2c_scan(1)` and compares the addresses with the module's. A kernel-held
    address (`UU`) counts as answering. A miss lists what answered instead and what to check; an
    error (no `i2c-tools`) says so.
  - **Press** touches nothing: it needs telemetry, asks the document's simulation what the pin reads
    with the button released and pressed (with the pin's real pull), waits for the rest level, then
    the pressed level. A pin that reads the pressed level for 1.5 s before any press fails with the
    orientation cause from SPEC 14.4 ("pins 1–2 are always connected"). It gives up after 30 s, stops
    when the step changes, and refuses a pin that is an output. Without a definite prediction any
    change counts.
  - **Toggle LED** asks the simulation which level lights the part (low for an LED between 3V3 and
    the pin), generates a three-cycle program that drives that pin and gives it back
    (`GPIO.cleanup(PIN)`), and passes it to `runStore.run` with the ERC of the document and that code:
    the same upload to `/tmp/gpio_dashboard/project_checkpoint-<part>-gpio<n>.py`, Board Sense pause,
    ERC override dialog and Stop as any run. It refuses a pin that has an alternate function, and a
    start while another program runs. The Pi's telemetry during the run is reported ("drove GPIO17
    high and low"), and the user's yes or no decides: a no lists the LED's polarity with its hole,
    the series resistor, its return and the LED itself.
  - **The step.** SPEC 11.7 lets a step Board Sense cannot see fall back to a checkpoint. When every
    checkpoint on the step in hand has passed, `useBuild.markChecked` ticks the step ("done, checked
    on the Pi") and keeps it in hand, so the result stays on screen; a "no", a miss or an error
    confirms nothing. The step stays done with the rest of the progress (ADR-0113); the "checked"
    label lasts for the session, as Board Sense's "sensed" does.
- **Consequences.** A toggle drives a pin as an output, so what is wired to it on the bench matters:
  the card says so before the click, and the ERC gate stands in for what the document knows.

## ADR-0126 One set of hardware-in-the-loop flows, on a mock Pi or a real one

- **Context.** SPEC 18 and 19 (M11): the automated HIL flows pass when the Pi is reachable, otherwise
  against mocks, and are limited to flows that neither drive nor probe a pin.
- **Decision.** `e2e/pi.ts` gives the page the same `window.api` either way. The mock records every
  native call and lets a test push telemetry, an I2C result and the end of a run. The real adapter
  (when `PI_HOST` is set; `PI_USER`, `PI_KEY` and `PI_SSH` are optional) forwards the calls to Node,
  which runs `ssh` with key authentication and shared connections. It may run only `pinctrl get`,
  `i2cdetect -y <bus>`, an upload of a `project_*.py` script, and `python3 -u` and `pkill -f` of it;
  it refuses a script that mentions a GPIO library, a path outside `/tmp/gpio_dashboard`, an invalid
  bus, and a cleanup that would set a pin. `e2e/pi.spec.ts` proves that against a stand-in `ssh` that
  logs every command, and `e2e/hil.spec.ts` runs the three flows (telemetry through the tunnel, the
  I2C scan from the checkpoint, a print-only run and stop) on the mock always. On the real Pi, when
  `PI_HOST` is set, it runs only the two that neither drive nor probe a pin: the I2C scan clocks
  address probes out on SDA and SCL, so on the real Pi it stays a hand check; a skip note shows when
  `PI_HOST` is not set. Press, toggle and Board Sense need the user's
  hands or drive a pin: they are on `docs/v2/HIL_CHECKLIST.md`.
- **Consequences.** The tunnel, the agent and the Rust commands are still proved by the Rust tests and
  the checklist; the browser flows prove the app's reading of what they return.

## ADR-0127 A part's lead tubes are kept while its board moves

- **Context.** ADR-0082 left three binding buffers (80, 256 and 448 bytes) created about 6.4 times
  each per frame and 19 vertex and index buffers created mapped at creation, and put the awake
  scenes about 1.5 ms above the quiet ones in geometry and binding updates. The Mac session was
  locked (`CGSSessionScreenIsLocked` = Yes), so the Tauri window would have drawn nothing; every
  number in these ADRs is headless Chromium on the Metal GPU (the `chromium` channel, WebGPU), a
  1200 x 800 viewport at a pixel ratio of 2 (a canvas of 1440 x 1321, against the window's
  1376 x 1189), scripted drags of the first breadboard at 0.8 Hz and 40 px for 4 s after 1 s of
  warm-up, every cable awake (`e2e/frameRate.spec.ts`, with the load average beside each figure).
  The origin was found by counting `GPUDevice.createBuffer` calls (75 a frame on the four-digit
  seven-segment, 13 on the LED dot matrix, 73 on the shift register) and tracing which attributes
  were being created: the `position`, `normal` and `index` of plain meshes with 8-sided tubes,
  16.8 meshes a frame. Not the cables (`Tube` refits in place, and so does `ribbonGeometry`): the
  part leads. `PartLayer.drawLeads` keyed a part's lead mesh on its corners in scene coordinates, so
  every pointer move of a dragged board rebuilt every lead of every part on it: `TubeGeometry`,
  `mergeGeometries`, a new geometry with new attributes (a buffer mapped at creation each, the 1.0 ms
  of `getMappedRange` in ADR-0082's trace), a new `Mesh` and with it a new render object and
  bindings in the colour pass and in the shadow pass. Dragging the Pi or a module created none.
- **Decision.** The corners are taken in the body's pose (the frame the part's model is placed in)
  and compared with the drawn lead's within 1 um; equal, the mesh keeps its geometry and only its
  position and rotation follow the body. A rigid move of the board carries the part and its holes
  together, so it leaves the corners as they were. A part with no model has no body, and its stubs
  are taken in the scene as before. The lead's end holes are refreshed on each draw, because
  `leadEnds()` measures against them.
- **Consequences.**
  - GPU buffers created a frame during the board drag: 75 to 0, 13 to 0, 73 to 0.
  - Main thread, mean ms a frame, three interleaved rounds each, before then after, with the main
    thread slowed 3x through CDP (`Emulation.setCPUThrottlingRate`), which stands in for a slower
    webview and brings the drag under the 60 Hz cap; load 4.6 to 10.7, the machine busier in this
    batch. Four-digit seven-segment: 18.7 to 29.8 fps, `view.frame` 15.6 to 10.4, the render call
    11.8 to 7.1, the pointer handler 13.8 to 7.1. LED dot matrix: 25.2 to 31.6 fps, 11.4 to 9.6,
    8.3 to 6.8, 9.1 to 5.5. Shift register: 20.1 to 39.7 fps, 12.1 to 7.5, 10.2 to 5.5, 13.3 to 5.2.
    Unthrottled the four-digit held the 60 Hz cap before and after (two rounds, load 4.7 to 5.1):
    `view.frame` 4.3 to 3.0 ms and the render call 3.2 to 2.1.
  - A lead's 8-gon is no longer turned by the world axes `TubeGeometry` takes its first normal from
    but by the body's; no visible difference.
  - Changing a part's pin holes (dragging the part, a leg, or a lead's end) still rebuilds its
    leads, once per change of hole, not once per pixel.

## ADR-0128 Part leads and pieces under 4 mm do not cast shadows

- **Context.** ADR-0082 counted 145 of 151 meshes as shadow casters, each a draw, and a pass through
  three's per-object path, in the shadow pass, which is redrawn every second frame. The key light's
  map is 2048 texels over 900 mm: 0.44 mm a texel, softened over several. A part's lead is 0.5 mm
  across, and many pieces of the part models are a few mm (colour bands, segment dots, matrix dots,
  a seven-segment's decimal points). The Dupont leads are 1.0 mm and throw faint lines across the
  boards in the Top view.
- **Decision.** The lead mesh of a part (`PartLayer`) does not cast. A piece of a model drawn by
  `ModelInstances` casts only when its bounding box, in the model's frame, is 4 mm or more along some
  direction (`SHADOW_MIN_MM`). Boards, the Pi, the T-board, the bodies of parts, modules, the Dupont
  leads and housings, the ribbon and the Pi's header pins still cast. The Dupont leads were tried
  without a shadow too: they are 37 of the 145 casters in the heaviest scene, the saving was within
  noise, and the Top view lost the faint lines they cast, so they keep theirs.
- **Consequences.**
  - Casters: 145 to 118 (four-digit seven-segment), 145 to 78 (LED dot matrix, whose 64 matrix dots
    were casters), 88 to 66 (shift register).
  - The main thread gains little. With every caster off (a test, not shipped) the render call fell
    from 6.75 to 5.77 ms with the main thread slowed 3x (load 4.8 to 6.0): all of them cost about
    0.33 ms of real time, so a third of them about 0.1. Three interleaved rounds with the thread
    slowed 3x, before then after, load 4.0 to 4.9: the render call 6.6 to 6.6 (four-digit), 6.7 to
    6.4 (dot matrix), 4.7 to 4.5 (shift register); `view.frame` 9.8 to 9.8, 9.5 to 9.3, 6.7 to 6.4.
    Kept because it costs no look and shrinks the shadow pass; most of an object's cost is in
    three's path for it, not in the draw.
  - Look, from captures of the three tutorials at the Iso and Top presets and zoomed in, before and
    after (1440 x 1321): the mean absolute difference was 0.01 to 0.24 of 255, with 0.002% to 0.14%
    of pixels differing by more than 8 levels. Two captures of the unchanged build differ by 0.07 to
    0.20 (0.02% to 0.19%), and by 1.9 (5%) in one zoomed view whose cables settled differently.
    Nothing visible changed.

## ADR-0129 The bloom is drawn only while something passes its threshold

- **Context.** ADR-0082 measured the bloom at 4.3 to 4.8 ms of GPU pass time with nothing above its
  threshold of 2 (twelve passes: a high pass, ten blurs and the composite). Three things in the
  Studio can exceed 2 in scene-linear light: a part's emission (`glowOf`), a halo (its colour
  reaches 3) and the dashes of a lead with current (2.5). The key light's highlights on metal
  reach above 1 and not 2 (ADR-0067). No model carries an emissive material (every GLB was read).
- **Decision.** `Post.setBloom(on)` leaves the bloom nodes out of the frame. Off: their strength goes
  to 0, the frame that follows draws the composite as black, and then `updateBeforeType` is `NONE`,
  so no pass is drawn. On: the strength and `FRAME` are back before the frame that needs them, so
  the first lit frame already has its bloom. three reads `getUpdateBeforeType` on each update, so no
  graph is rebuilt and no shader compiles. `view.frame` sets it from `SimVisuals.glowing`: a halo is
  drawn, a lead carries current (`WireLayer.flowing`), or a part emits at least `BLOOM_GATE` =
  `BLOOM_THRESHOLD / 2` in some channel, which leaves room for the light on the surface to be added
  to it. The depth-of-field graph's own bloom is gated alike.
- **Consequences.**
  - The image does not change. The Blinking LED, dark: captured with the gate and with the bloom
    forced on, the two are identical (maximum difference 0 of 255). Lit, before and after the
    change: mean difference 0.08 of 255, the capture floor. The state follows the LED: off dark, on
    lit, off dark again. An emission between the gate and the threshold turns the bloom on and adds
    nothing visible, since the high pass is a smoothstep from 2 over luminance.
  - GPU pass sum from timestamp queries, ten frames each, a still scene, three interleaved
    repeats, load 4.5 to 5.1, the origin's build then this one: 43.8 to 10.6 ms (four-digit), 41.8 to
    10.5 (dot matrix), 45.0 to 9.5 (shift register). Between the commit before the bloom change and
    the one with it, measured after a drag: 43.0 to 9.2, 41.2 to 8.7, 45.3 to 9.4. The sums are
    generous (ADR-0082) and the bloom's share is larger here than in the Tauri trace (4.3 to 4.8 of
    11.4), so the window should show about 4 to 5 ms less. The main thread saves the encoding of
    those passes: the render call 2.0 to 1.8, 2.0 to 1.8 and 1.4 to 1.3 ms (unthrottled, three
    rounds, load 3.5 to 4.9).
  - A new source of light over the gate must register in `SimVisuals.glowing`, or it will not bloom.

## ADR-0130 The strip index is shared across a drag, and live pins repaint only when one is painted

- **Context.** A profile of the drag (V8's sampling profiler over CDP, 4 s, four-digit seven-
  segment) put `stripIndex` at 46 ms of self time, 0.19 ms a frame, with `LivePins.sync` and
  `syncBadges` beside it in `draw`, which runs on every pointer move. `stripIndex` walks every hole
  of every board and copied the strip's array for each hole. It was called by the badges (before
  checking whether there are any), by the live pins (whose key held the boards' transforms, so a
  moved board repainted the header and the strips and asked for a frame even with no pin to paint)
  and by the voltage tags.
- **Decision.** `stripIndex` keeps the last index while the boards' ids and models are the same (the
  strips follow from which boards there are, not from where they stand), and builds each strip's
  array once. `LivePins` has an empty key while no pin is painted, so a drag leaves it alone.
- **Consequences.** `draw` fell from 248 to 186 ms of the profile. The pointer handler's mean time,
  with the main thread slowed 3x, three rounds each, load 4.3 to 5.9: 6.5 to 5.8 ms (four-digit),
  5.3 to 4.9 (dot matrix), 4.6 to 4.1 (shift register), with 31.5 to 32.0, 34.4 to 35.0 and 41.2 to
  42.6 fps. Callers read the index and do not change it.

## ADR-0131 Render bundles are not used, and where the frame goes now

- **Context.** ADR-0082 listed a render bundle for the static boards and models as a lever. three
  0.186 has `BundleGroup` (the WebGPU backend records a `GPURenderBundle` per camera and render
  context). Its replay path still runs, for each object, `needsRefresh`, `nodes.updateBefore`,
  `geometries.updateForRender`, `nodes.updateForRender`, `bindings.updateForRender` and
  `updateAfter`: of ADR-0082's 15.7 us an object, 11.6 (bindings 4.8, geometries 5.0, nodes 1.8)
  stay; what it spares is `RenderObjects.get` and the draw, 4.1, with the WebGPU calls (2.0 ms of
  ADR-0082's frame for all 150 meshes).
- **Decision.** Not used. A `BundleGroup` holding the table and the sweep (alone, and with the Pi),
  put into the scene under the full pipeline, throws "Cannot read properties of null (reading
  'isDepthTexture')" in `WebGPUTextureUtils.updateSampler`, called from `Bindings._createBindings`
  for a shadow receiver, on every frame, and the frame then takes 0.4 s (1.3 s with the main thread
  slowed 3x). 0.186's bundle path does not give a receiver recorded in a bundle the shadow map with
  this pipeline (a shadow-casting key light, `builtinAOContext`). What a bundle could save here is
  the Pi and the stage, a fifth of the meshes at most: about 0.2 ms of a frame.
- **Where the frame goes now** (main thread, 4 s of a four-digit drag, CPU profile, load 4 to 7;
  headless Chromium's figures, whose `view.frame` ADR-0082's Tauri frames exceeded by about
  2.8 times): the render call 1.8 ms (the geometry pass over about 150 objects, the shadow pass on
  every second frame, the TRAA, GTAO and bloom nodes, and the cable tubes' buffer uploads, 0.5 ms);
  the refit of 37 tubes 0.8 ms (`Tube.fit` 0.7); the pointer handler 1.7 ms, in which the engine's
  netlist for the preview (0.65) and the document check (0.3) are core's; React's development
  build 2.3 to 3.0 ms, in which the part library, redrawn on every preview (0.8 to 1.2 ms), is not in
  the Studio's files. About 45% of the run was idle.
- **Consequences.** Left undone, each costing more look or code than it saves: one merged mesh for
  all the Dupont tubes (it would save 37 draws and uploads, and would need per-vertex colour, the
  taut tint and the flow overlay on a shared geometry); skipping the refit of a sleeping lead whose
  ends have not moved (it saves nothing in a board drag, where every lead is awake).

## ADR-0132 The assistant's import boundary is an allowlist over every import form and script type

- **Context.** SPEC 4.5 limits assistant/ to core/, native/anthropic and the AssistantContext the
  Claude panel injects. The lint rule matched only `*.{ts,tsx}`, and ESLint's `no-restricted-imports`
  does not see `import()`. An independent review showed `await import('../native/ssh')` in a `.ts`
  file and `export * from '../native/ssh'` in a `.js` file both passed lint and the boundary test.
- **Decision.** The assistant/ block applies to `js, jsx, mjs, cjs, ts, tsx`. A local rule,
  `assistant-boundary/imports`, resolves the specifier of every import declaration, export-from,
  export-all and `import()` against the importing file, and allows only paths inside assistant/,
  core/ or native/anthropic, and packages other than React, three, @react-three and @tauri-apps.
  A second review showed the first version, which checked only `import()`, still let a static
  import reach data/ or content/; a list of denied directories cannot cover what it does not name.
  An `import()` specifier that is not a plain string literal cannot be checked and is rejected.
- **Consequences.** `boundaries.test.ts` runs static imports, re-exports and dynamic imports through
  every file type, TypeScript import types (`import('…').T`, a third review's finding) through
  `.ts` and `.tsx`, and the reviewers' probes through ESLint. Not covered: `import.meta.glob`,
  `require`, and `.mts` or `.cts` files, which the lint configuration does not read at all and the
  repository does not have; core/ and physics/ keep the same blind spot for `import()`.

## ADR-0133 Run on Pi is gated on the simulated currents of the program's worst-case drive

- **Context.** SPEC 11.6 blocks Run on Pi on ERC errors unless the user overrides. PIN_OVERCURRENT,
  RAIL_BUDGET and the current check of LED_NO_LIMIT are ERC errors computed from a simulation, and
  `runOnPi` passed only the static ERC. The Blinking LED with R1 at 10 Ω uploaded and ran with
  GPIO17 near 34 mA, over the 16 mA a pin may supply.
- **Decision.** `driveChecks` simulates the document with every output or PWM pin the code sets up
  driven HIGH, then all driven LOW, each in a fresh session, and keeps one issue per code and refs.
  `runOnPi` adds them to the ERC issues, so the existing dialog lists and blocks them. A simulation
  that fails adds none. "Run anyway" is unchanged.
- **Consequences.** A click costs two small simulations on the main thread. Mixed levels (one pin
  high into another driven low) are not simulated, and pins the code reader cannot resolve are not
  driven. Checked on the real Pi: the 10 Ω case is blocked with PIN_OVERCURRENT on GPIO17 and
  LED_NO_LIMIT on D1.

## ADR-0134 Board Sense puts each pin's bias back before releasing it

- **Context.** Releasing a libgpiod request keeps the last bias applied, so Board Sense left every
  pin it had probed with the bias of its last step: a pin that was pull-up could end pull-down. The
  test fake hid this by clearing a pin's bias on release.
- **Decision.** Each sweep records the pull pinctrl reports for the pins it will claim. Before any
  release (the end of a sweep, pause, stop, an error, and the per-pin trial requests when the kernel
  refuses the batch) the held lines are reconfigured to those biases, still as inputs, and then
  released, even if the restore fails. A pin whose pull pinctrl does not report is skipped with that
  reason. Direction is not restored: only inputs and unconfigured pins are probed, and libgpiod has
  no setting that returns a pin to unconfigured.
- **Consequences.** On the real Pi a sweep of 23 pins left every one with the pull it had before
  (pull-up on GPIO4 to GPIO8, pull-down on the rest); they read as inputs instead of unconfigured,
  which is electrically the same. Pause and stop do one more reconfigure before the release.

## ADR-0135 A known host's key of another algorithm is a changed key

- **Context.** russh 0.64's `check_known_hosts_path` returns `Ok(false)` both for a host with no
  entry and for one whose recorded keys are all of another algorithm. `verify_host_key` read every
  `Ok(false)` as a new host and recorded the key, so a server presenting another key type was trusted
  without a warning. This was in `main` before v2.
- **Decision.** On `Ok(false)` the app reads the keys on file for that host and port. If there are
  any, the presented key is refused with the same changed-key error as a mismatch of one algorithm,
  and `known_hosts` is not modified. Only a host and port with no entry is learned on first use.
- **Consequences.** A Pi that moves to another host-key type is refused until its old line is
  deleted, as after a reinstall. Another port of the same host is still a new host.

## ADR-0136 The agent's start command backgrounds only nohup

- **Context.** `cd dir && nohup python3 agent.py > agent.log 2>&1 &` backgrounds the whole list in a
  subshell that keeps the SSH channel's stdout and stderr open while the agent runs. On the Pi's
  OpenSSH the exec then lasted as long as the agent: `agent_start` hit its 30 s timeout, returned no
  token, and the telemetry socket connected without auth and was dropped every 5 s. macOS's sshd
  returns at once, so the live test against the local sshd passed, and the bug showed only on the
  first deploy to a real Pi.
- **Decision.** `cd dir && { nohup … > agent.log 2>&1 < /dev/null & }`: only nohup goes to the
  background, with every stream redirected.
- **Consequences.** On the Pi the start command returns in 0.2 s and Deploy & Start Agent takes 6 s
  instead of 53 s. A unit test holds the command's shape, with its reason, since the local sshd
  cannot show the hang.

## ADR-0137 The app icon is rendered in Blender and shipped both as Icon Composer and as icns

- **Context.** The bundle still carried Electron's atom logo from before the move to Tauri, and the
  Dock showed it. macOS 26 and later draw an app's icon from an Icon Composer asset named by
  `CFBundleIconName`, and frame a legacy icns that does not provide one.
- **Decision.** `scripts/icon/app_icon.py` models a breadboard with a lit green LED and a jumper,
  renders it with Cycles, and composites it onto an 824 px superellipse on Apple's 1024 px grid with
  a drop shadow and the LED's bloom, plus a foreground-only layer. `tauri icon` makes the PNGs, icns
  and ico from the full render; `src-tauri/icons/AppIcon.icon` holds the layer and a fill, actool
  compiles it to `Assets.car`, `bundle.macOS.files` copies that into Resources, and `src-tauri/
  Info.plist` sets `CFBundleIconName`. Earlier macOS keeps `CFBundleIconFile` (icon.icns).
- **Consequences.** Rebuilding the icon needs Blender and Xcode's actool; both steps are in the
  script's header. Nothing in it comes from an external model, texture or HDRI. In `tauri dev` the
  Dock labels the unbundled binary by its file name, `gpio-dashboard`; the bundle shows "GPIO
  Dashboard" from `CFBundleName`.

## ADR-0138 Programs run with the agent's venv Python, which gets rpi-lgpio where apt has no lgpio

- **Context.** Tutorial programs and the Toggle LED checkpoint import RPi.GPIO or gpiozero. On a
  Pi 5 both reach the header through lgpio: Raspberry Pi OS ships python3-lgpio and
  python3-rpi-lgpio, and install.sh adds the latter when apt has it. Kali and Debian have neither,
  their RPi.GPIO is the pre-RP1 0.7.1, and gpiozero falls back to it, so on the bench Pi (Kali,
  Python 3.14) no tutorial could drive a pin. pip's lgpio 0.2.2.0 did not build either: its SWIG
  interface calls Python 2's `PyInt_FromLong`, `PyInt_AsLong`, `PyInt_Check` and
  `PyString_FromString`, which SWIG 4.3 stopped mapping to their Python 3 equivalents.
- **Decision.** When neither the system Python nor the agent's venv can import lgpio, install.sh
  makes the venv (with the system's packages visible, as for gpiod 2) and installs rpi-lgpio into
  it, building lgpio with those four names defined to `PyLong_FromLong`, `PyLong_AsLong`,
  `PyLong_Check` and `PyUnicode_FromString`. It installs swig, python3-dev and gcc for the build,
  and only warns if the build fails. Run on Pi runs a program with the agent's venv Python when
  there is one (`agent::python_in`, the same choice the agent's own start makes), else `python3`.
- **Consequences.** On the bench Pi the deploy builds it in about 10 s, and the shipped Breathing
  LED tutorial, unmodified, drove GPIO18 from Run on Pi (telemetry saw it pulse), and Stop returned
  the pin to an input. RPi.GPIO and gpiozero in the venv shadow the system's for the app's programs
  only; nothing outside `~/gpio-dashboard-agent` changes. On Raspberry Pi OS lgpio imports already,
  so no venv is made for it.

## ADR-0139 An off-board module rests on the board it is laid over

- **Context.** The studio laid an off-board module where the pointer's ray met the table, so a
  module dropped over a breadboard was drawn inside it: the joystick's PCB sat in the bb-830's
  8.5 mm body with its pins below the board's top, and its selection box, its pins' lead ends
  and the plane a move dragged it along were all at table height. The rebuilt HC-SR04 and DHT11
  breakout carry right-angle headers whose pins lie flat 0.3 mm above the module's lowest point,
  so a 2.54 mm Dupont housing on them reached about 1 mm into whatever the module lay on.
- **Decision.**
  - A module rests on the top of the highest board that one of its model's rigid pieces
    overlaps (no edge of either outline separates them), else on the table (`restHeightMm` in
    `core/reach`, `moduleRestMm` in `studio/coords`). The flexible pieces, a servo's or motor's
    cable and a keypad's tail, take no part, so a servo whose housing and case lie on the table
    either side of a board stays on the table.
  - The drawn module, its pins' frames, the leads ending on them, its selection box and a move's
    drag plane all use that height. A module with a pin lying flat is raised by however far that
    pin sits below half a housing's width; a module whose pins point up is not.
  - A drop or move meets the pointer's ray with each surface's rest height, highest first, and
    takes the first pose that rests the module on that surface, so the module stays under the
    pointer and a still pointer leaves it where it is.
  - Reach's lead ends take the board under the module's position, and the 10 mm assumed pin
    height above it.
- **Consequences.** A module can lie across a board's edge, resting on its top; nothing models it
  tipping, or resting on parts already on the board. The model is rigid, so a cable or tail does
  not drape: where both its ends lie on the table it passes through a board it crosses, and where
  one end rests on a board the other is held at that height. Where a footprint crosses a board's
  edge within the parallax between the two heights, no pose rests it under the pointer and the
  table's is taken, so it steps onto the board a few millimetres from the pointer. Physics stays
  visual (SPEC principle 8), so the rest height is geometry, not a simulated contact. Moving a
  module off a board drops it back to the table.

## ADR-0140 The side panels fold away for an immersive bench

- **Context.** The Studio's part library and properties panels take about 30% of a laptop
  window's width, and while arranging or looking over a bench they are not needed.
- **Decision.** Each panel has a toggle in the top bar (left for the library, right for the
  properties, each naming what it hides or shows and reporting its state as pressed), and the
  keys `[` and `]` fold one each and `\` folds both, or shows both if either is hidden. The
  canvas takes the freed width. The state lives in the studio store and is not saved with a
  project.
- **Consequences.** Placing a part needs the library shown; the keys bring it back without the
  mouse. The run-blocked dialog anchors to the canvas's right edge either way.

## ADR-0141 The app opens on the Studio, connected, with the agent running when the Pi has this app's

- **Context.** The app opened on the Connect tab, disconnected: every launch took a Connect click
  and a Deploy & Start Agent click before the bench was live, though the connection was saved.
  SPEC principle 5 kept running code on the Pi behind a click.
- **Decision.**
  - The app opens on the Studio tab.
  - At launch it reads the saved connection and, when there is one, connects with it. It then
    asks the Pi whether the agent there is this app's: `agent::check` reads back every file
    `deploy` would put there and compares them byte for byte with the copies compiled into the
    app. When they match it starts the agent, as Start Agent would. SPEC principle 5 names this
    as its one exception, at the owner's choice.
  - When the agent is missing or differs (after an app update), launch stops at connected and the
    Connect tab says which, because Deploy & Start Agent runs `install.sh`, and with it
    `sudo apt-get`, on a Pi that is also a home server. Those stay a click.
  - The saved connection is read once at launch (`loadSaved` in the connection store), not when
    the Connect tab first shows.
- **Consequences.** A launch with the Pi unreachable shows the connection's error in the top
  bar, as a failed click would. The agent reads pins and drives none, and quitting the app,
  Cmd+Q included, stops it (`main.rs`'s exit handler). An update to `pi-agent/` takes one Deploy
  & Start Agent click per Pi. Without a saved host nothing is attempted.

## ADR-0142 The interface wears the night-lab HUD through remapped tokens

- **Context.** The interface was a dark indigo Tailwind theme, and SPEC 2.3 forbade any other
  palette. The Studio facelift takes the exhibit-3d skill's night-lab house style for every page:
  dark navy glass on ink, a cool text ramp, five accents with fixed meanings, Outfit and DM Mono.
  About two dozen files colour themselves through theme classes (`bg-surface-800`,
  `text-gray-400`, `text-red-400`, `bg-accent`) and the component classes in `index.css`.
- **Decision.**
  - One colour source, `src/renderer/src/styles/palette.cjs`: ink `#0b0f1a`, the HUD's text
    ramp, cyan, amber, coral, violet and green, the glass stops, and on-bg/on-text for a selected
    segment. `tailwind.config.js` requires it and emits it as `:root` CSS variables.
  - The theme's existing names take its values: `surface` the ink ramp, `accent` cyan, `gray`
    the text ramp, `red` coral, `amber` amber, `emerald` and `green` green, `sky` cyan and
    `violet` violet, each accent's ramp tinted toward white and shaded toward ink around it. The
    `pin` and `state` colours stay. Most files take the new look with no edit.
  - The component classes keep their names: `.card` and `.glass-panel` are a glass gradient over
    a 10 px blur with a hairline and a long shadow, `.section-title` the HUD's group label,
    `.tab-button` a segment (selected: on-bg/on-text), `.btn-success` the cyan play style that
    Simulate wears, `.btn-danger` coral, `.btn-primary` on-bg/on-text; buttons do not wrap, and
    keyboard focus is a cyan outline.
  - Outfit (variable) and DM Mono 400 and 500 come from `@fontsource` packages pinned to exact
    versions and imported in `main.jsx`, so `font-src 'self'` holds. Inter is removed. System
    faces follow both in their stacks, because Outfit has no Ω, → or ⌘. The terminal keeps
    Menlo, which has the box-drawing glyphs xterm needs.
  - Code that needs a colour as a value reads the CSS variables (xterm's theme) or writes
    `var()` (CodeMirror's theme, the Monitor's bars). The Tauri window's background is ink, so
    the first paint matches.
  - The Studio's world labels, hover tooltip, dialogs and backdrop take the kit's HUD classes from
    `styles/hud.css`, which holds class rules only (no page rules). A label is a pill with a
    status dot, its name in Outfit and its reading, when it has one, in DM Mono. Divergence badges
    are coral and amber, and the hover marks are the palette's cyan, with a ghost's holes green
    and coral; those are written in `view.ts` as values, since the 3D scene does not read CSS.
- **Consequences.** A theme class now means its HUD colour: `text-red-400` is coral and
  `bg-emerald-500` green, and Tailwind's default reds, greens and blues no longer appear. A new
  colour goes into the palette. `palette.test.ts` checks that every text shade and accent reads at
  4.5:1 on surfaces 950, 900 and 800, and on-text at 7:1 on on-bg. The fonts add about 62 KB of
  WOFF2 (Outfit's Latin Extended file, 15 KB more, loads only for a character that needs it).

## ADR-0143 Two looks, Lab and Studio, switched by changing values

- **Context.**
  - The Studio had one look, ADR-0067's neutral studio, calibrated to the reference photos. A
    second look after the exhibit house style's night lab was chosen as the default: a warm key,
    cool fog and ambient light, ACES, a faint grain, a vignette, and later a furnished room
    (ADR-0144) and depth of field (ADR-0145). The neutral look stays, one switch away, because
    LOOKDEV's photo checks are made against it.
  - In three 0.186.1 a new scene environment texture, fog object or light set changes the cache
    key of every lit material and rebuilds its shader. `RenderPipeline.render()` sets
    `NoToneMapping` while it draws, so a look's tone mapping has to be in the pipeline's own
    output graph. Pointing the pipeline at another output node releases the GPU pipeline of the
    node it leaves, once no render object uses it, and builds it again on the way back: two
    render pipelines for each Lab, Studio and Lab round, measured with a counted
    `createRenderPipeline`.
- **Decision.**
  - `studio/look.ts` holds both looks as data: background, fog, environment and its intensity,
    key, hemisphere and rim lights, tone mapping, exposure and grade, grain, bloom strength and
    radius, vignette, table and sweep colours, and the camera's reach.

    | | Studio | Lab |
    |---|---|---|
    | Background | `#24272c` | `#0b0f1a` |
    | Fog (exponential squared) | density 0 | `#3a3d62`, 0.6e-4 per mm |
    | Environment | the HDRI, 0.6 | a dusk scene (`lab/dusk.ts`), 0.85 |
    | Key | white, 2.2 | `#ffc98f`, 1, same place |
    | Hemisphere, rim | 0, 0 | `#8fa6d8` over `#3a3026` at 0.6; `#a8b8ff` at 1.6 from behind |
    | Tone and grade | AgX, exposure 1.7, the chroma stretch of 1.2 | saturation 1.35, then ACES Filmic at exposure 1.5 |
    | Grain, vignette | none | 0.06, the house vignette in full |
    | Bloom (threshold 2 in both) | 0.35, radius 0.4 | 1.6, radius 0.85, by a pixel's largest channel |
    | Table, sweep | `#505153`, `#6a6b6d` | walnut `#22170f` under an ESD mat, hidden |
    | Camera reach | 3000 mm | 2200 mm |

    The Lab fog, exposure, key and vignette started at 2.2e-4, 1.3, 2.1 and full opacity; the
    lookdev rounds of ADR-0145 moved them, because the room read as a flat indigo haze and the
    white breadboard matched a lit LED.

  - `StageRig` (`studio/rig.ts`) owns the table, sweep and lights with Stage.tsx's old numbers,
    one `FogExp2`, one background `Color` and one PMREM target. `apply(look)` sets values; the
    environment is rendered into the same target again (the HDRI through
    `fromEquirectangular`, the dusk scene through `fromScene`), so the scene's environment
    texture never changes. The hemisphere and rim lights stay in the scene at 0 in the Studio
    look.
  - `Post` builds one output that holds both looks' finishes and picks one with a uniform
    (`select`). The Studio finish is ADR-0067's. The Lab finish is bloom, a saturation of 1.35,
    ACES Filmic at exposure 1.5, film grain of 0.06 and the sRGB encoding. Two departures keep a
    lit LED's colour. The bloom's high pass reads luminance, which left a red LED at 5 mA (3.5
    in its red channel, about 0.7 in luminance) under the threshold while a yellow one passed
    it; the Lab bloom's input scales a pixel whose largest channel passes the threshold toward
    a luminance equal to that channel, at most three times. And ACES maps each channel toward
    white, which clipped a lit red core to peach; past 1 after exposure the brightest pixels
    keep their hue, their largest channel mapped and the others scaled with it. Nothing in the
    room passes the threshold, so neither touches it. Each look's blooms
    are left out of the other look's frames (`updateBeforeType` NONE) and gated as ADR-0129
    within their own.
  - The right column's first row, View, has Lab and Studio buttons; L switches too; the view
    reports the look drawn and `__studio.setLook` sets it. The choice is stored in
    `localStorage` (`gpio.studio.look`), a preference of the machine and not part of a project.
  - A switch fades an ink veil (`#0b0f1a`) in over the stage for 200 ms, applies the look under
    it, and fades it out over 220 ms after the first frame drawn in the new look, which hides a
    first switch's compile. Under reduced motion it is instant. The vignette is an HTML layer
    in the stage, at 60% opacity in the Lab look and hidden in the Studio look, so Studio
    captures are unchanged. Halos are drawn without fog.
  - The camera keeps its 35° field of view and has no idle drift in both looks: a field of view
    per look would turn each switch into a dolly zoom, and drift would draw frames while still.
- **Consequences.**
  - The Studio look draws as before. `e2e/lookdiff.spec.ts` (`LOOKDIFF=1`) captures three
    tutorials at iso, top and front against a dev server on 6538594; each capture's settling
    runs start at TRAA's first jitter offset and on GTAO's 12-frame noise cycle, which takes the
    floor (6538594 against itself) from up to 0.11 to at most 0.005 of 255. The mean difference
    is 0.001 to 0.003 of 255.
  - A second Lab, Studio, Lab round makes no GPU pipeline (`e2e/look.spec.ts`), and a switch
    settles to no frames.
  - Both finishes' arithmetic runs in the last pass in either look (some dozens of operations a
    pixel); the other look's passes do not run.
  - ADR-0067 now governs the Studio look only, and LOOKDEV's photo checks are made in it.

## ADR-0144 The Lab look's workroom: baked into a few merged meshes, with bounds and a cutaway

- **Context.**
  - The exhibit house style sets its Lab look in a room finished on every side, because the
    camera circles it, with something to read on every wall, practical lamps, and the topic
    echoed faintly in the dressing. The tabletop is the table plane, y = 0, which the physics
    floor and the camera presets assume.
  - The frame budget (SPEC 10.8) has little room for a heavy set: ADR-0131 put the render call
    at about 150 objects. A practical lamp drawn above the bloom's threshold would bloom with the
    LEDs dark and break ADR-0129's gate, and the lit circuit has to stay the brightest thing.
- **Decision.**
  - The set sentence is "a Pi breadboard bench in an electronics workroom at dusk". The floor is
    900 mm below the tabletop; the inside runs x ±2400 mm and z -1700 to +2600 mm, and the
    ceiling is at +1900 mm (`studio/lab/bounds.ts`).

    | Side | Contents |
    |---|---|
    | North, behind the first views | the dusk window (1000 x 1100 mm, navy-violet and lavender over a thin dusty-rose band) right of the bench's line between amber light bars, the GPIO pinout left of it, a dark board whose pins glow a faint cool white: the background echo, a walnut credenza under it, a plant in the corner |
    | West | a pegboard of pliers, cutters, drivers and wire spools over a wall bench lit by an amber strip under its top, with a desk lamp, an oscilloscope and a power supply on it, their screens dim |
    | East | a parts-drawer cabinet, a shelf lit from below by an amber strip, a soldering station on a side table |
    | South | the door, a brass sconce beside it, and a stool |
    | Ceiling | two dim pendants over the bench |
    | Floor | tiles and a rug, and the bench's legs, apron and lower shelf under its table |

  - Builders in `lab/pieces.ts` draw each piece in millimetres, after the house style's furniture
    language (bevelled engineered parts, faceted low-poly plants), written for this app.
    `lab/bake.ts` places each piece's geometry in the room, colours it per vertex with roughness
    and metalness as attributes, darkens it by an occlusion term baked from where each vertex
    stands (height above the floor, distance to a wall or a corner, under the bench, facing
    down), and merges every piece of one kind on one side into one geometry.
  - Three materials serve the whole room (`lab/materials.ts`): a lit vertex-colour standard
    material; an unlit emitter material for lamps, bars and screens, at most 1.5 in linear light;
    and additive glow cards, at most 0.16, without fog, fading from their centres and when
    seen edge-on. A bulb's three crossed cards over the bulb stay under 2. Metal in the room is
    at least 0.5 rough, so the key's highlight on it stays under the threshold too. As drawn, the
    brightest emitter is 1.2 and the brightest card 0.1.
  - Besides the furniture, a thin amber strip under the bench's front lip, a warm pool on the
    mat around the bench, and warm light under the door.
  - The room is 18 meshes (three kinds on each of six groups) and 24,288 triangles; none casts
    or takes a shadow, as the key's
    shadow map covers the bench. It is built the first time the Lab look is applied (about 50
    ms), and hidden in the Studio look.
  - `view.frame` follows the orbit and any preset move with `clampToRoom`, which keeps the target
    in the room and shortens the camera's distance along its line to the target until it stands
    150 mm inside the walls, floor and ceiling; the south is open, as a stage's front. The target
    keeps 200 mm further in than the camera: on the camera's own bound, a target panned to a wall
    with the camera beyond it would leave no distance between them. The orbit
    goes on from its own position at the next frame, so passing a wall does not shorten its
    distance for good. Then the cutaway hides each side, a wall with its furniture or the ceiling
    with its pendants, that the camera stands within 900 mm of or behind: farther than any piece
    stands out from its wall, so the camera is never inside one.
  - The Lab look orbits at most 2200 mm from its target, and it is the default look.
  - The bench in the Lab look is a walnut top under a matte slate ESD mat, 457 x 381 mm (18 x 15
    inches) and 2 mm thick (`StageRig`'s mat, shown when the look names one), so the walnut
    frames it; matte, as a vinyl mat is, since a sheen mirrored the dusk window at a low view.
    A uniform dark plane at the working
    distance had nothing to give the breadboard its size: the mat's edge, its border and a grid
    printed every 10 and 50 mm do, as a real bench's mat does, and its ground snap and cord over
    the back edge mark it as an electronics bench. The grid is drawn in the mat's material, its
    lines antialiased against the pixel's footprint and the 10 mm ones fading once they are
    thinner than a pixel. The mat's top is the table plane, y = 0, where parts rest and physics'
    floor is, so the table drops 2 mm while the mat shows; in the Studio look the mat is hidden
    and the table stays where ADR-0067 calibrated it.
- **Consequences.**
  - Every preset of every tutorial stands inside the room, with no side cut, at canvas aspects
    from 0.6 to 2.4 (`lab/bounds.test.ts`). An orbit all the way round at full reach stays
    inside and opens the north, west and east sides in turn (`e2e/lab.spec.ts`).
  - With the LEDs dark and the bloom forced on, the Lab bloom's high pass is empty at the iso,
    top and front presets; the forced and gated frames differ by 0.006 to 0.011 of 255, the
    settling floor (`e2e/lab.spec.ts`).
  - The room's cost, measured with the depth of field, is in ADR-0145.

## ADR-0145 The Lab look focuses on the bench with a depth-aware bokeh, and what it costs

- **Context.**
  - The exhibit house style keeps its hero in focus and lets the room melt into bokeh, the far
    blur stronger than the near, so the bench reads as a miniature. three 0.186's `dof()`
    gathers neighbours without weighing them by depth: a sharp edge smears into the blurred
    background behind it as halos and stepped copies, worst on the white breadboard against
    the dark room. The Studio look's Build Mode focus uses `dof()` and stays as it is.
  - SPEC 10.8 asks for 60 fps at the window's pixel ratio with physics awake and the full post
    stack, and to scale effect quality first, recording what changed. The ladder for the Lab
    look: the bokeh's taps 48 to 32, then no depth of field while cables are awake.
- **Decision.**
  - `studio/bokeh.ts` is a single gather after the house style's stage (Gustafsson's 2018
    single pass), written for this app. A tap counts only if its own blur reaches the pixel,
    and a tap behind the pixel may not out-blur it by more than twice. 32 taps on a golden-angle
    spiral at half resolution; taps farther than 4 device pixels read a quarter-resolution
    box-filtered copy, so a thin bright strip does not break into beads. Each pixel counts in that
    copy by its own blur, so the sharp bench does not halo into the blur behind it. A
    full-resolution composite keeps in-focus pixels from the sharp image. Blur grows with the
    distance from the focus, 1.6 times as fast behind it as 0.9 in front, over a band as long
    as the camera's distance to the bench, up to 10 CSS pixels (three quarters of that from
    1.33 m out, so a wide view's room stays shapes rather than smears): as a lens's, the blur
    grows the closer it focuses, so a close view melts its foreground and the room and a wide
    one keeps the bench's surroundings.
  - The Lab look's output is the Lab finish of the bokeh of TRAA's image, with the scene pass's
    depth. `view.frame` focuses it at the camera's distance from its target every frame
    (`Post.setBenchFocus`). Build Mode's focus narrows the same node's band to 320 mm; its output
    is another graph, so the pipeline's output differs from `sharp` while focused. The bokeh's
    two passes are left out of the Studio look's frames.
  - GTAO runs at 0.5 of the drawing buffer in both looks. A resolution per look reallocated its
    targets on every switch, and 0.35 in the Lab look gave no measurable gain (below). The bokeh
    has 32 taps, the ladder's first step; the second, no depth of field while cables are awake,
    is not taken.
  - The look was dialled in three critic rounds: a separate reviewer saw only the captures, the
    house style's exemplars and the rubric's rows A1 to A6 (look and light), scored them and
    named the largest gaps. 13.5 of 25 (54%), then 15.5 (62%), then 17 (68%). Between rounds
    the window, bars, strips, screens and pendants were dimmed so the lit circuit leads, a warm
    pool went onto the mat and a strip under the bench's lip, the walls moved from indigo to a
    lighter teal-grey, the fog thinned (2.2e-4 to 1.2e-4 per mm), the exposure rose (1.3 to
    1.5), the vignette eased to 60%, and the far blur weakened (14 to 10 px, band 2400 to 4000
    mm). Five more rounds, each scored by a fresh critic that saw nothing of the others: 60%,
    60%, 66%, 62% and 16 of 25 (64%), the scores moving by about as much from one critic to the
    next as from one round to the next. They added the walnut top and the ESD mat (ADR-0144),
    dimmed the key from 2.1 to 1, deepened the vignette to full, thinned the fog to 0.6e-4 per
    mm, dimmed every practical to a fraction of a lit LED's core, put the pinout on the north
    wall as a backlit diagram beside a smaller window, scaled the depth of field with the
    camera's distance, and let a lit LED bloom and keep its colour by its largest channel (ADR-0143).
    The hierarchy row rose from 2 of 5 to 3: a lit LED now leads every close frame, red as
    readily as yellow. A satin mat and a 14 px blur were tried and went back: the sheen mirrored
    the window at a low view, and the wider gather read the quarter-resolution copy as blocks.
    The rubric's pass mark is 80. Its remaining gaps are the wide orbits, where a lit LED at
    1.6 m is a speck under the room's instrument faces; the room's furniture, plain bevelled
    blocks without lacquer or texture; and the room falling to black in the close views. The
    loop closed there, after a last unscored pass on what the critics marked down round after
    round: the instrument faces and strips dimmed further, a darker mat, a brighter window, a
    muted plant pot, and less blur in a wide view. The furniture's detail is open in LOOKDEV,
    for a later round.
- **Consequences.**
  - Measured in headless Chromium on WebGPU (`FRAME_RATE=1 FRAME_RATE_LOOKS=lab,studio`, 1200 x
    800 at a pixel ratio of 2, three interleaved rounds, a board dragged with every cable
    awake), on a machine at load 7 to 25 from other work (a Rust build, iOS simulators):
    - LEDs dark, 48 taps and GTAO at 0.5 in both looks: 60.0 fps in every run of both looks.
      GPU pass sums, Lab against Studio: 15.7 against 10.9 ms (four-digit), 10.4 against 9.8 (dot
      matrix), 13.6 against 8.3 (shift register).
    - LEDs lit (`FRAME_RATE_LIT=1`), the same settings: 59.8, 58.8 and 60.0 fps in the Lab look
      against 60.0, 59.1 and 60.0 in the Studio look; sums 39.0, 45.4 and 44.3 against 28.0, 26.8
      and 25.5 ms.
    - LEDs lit, GTAO at 0.35 and 32 taps in the Lab look: 59.8, 59.3 and 60.0 fps against 60.0,
      59.0 and 60.0; sums 41.8, 40.3 and 40.3 against 27.7, 26.5 and 27.5 ms.
    - With vsync and the frame-rate cap off, the camera moving every frame, LEDs lit, after the
      ladder: a median 2.09 ms a frame in the Lab look against 1.81 in the Studio look (three
      rounds, four-digit).
  - The per-pass times show why the sums are not a measure of cost here: each of the bloom's
    passes, down to its 45 x 23 blur, reads 1.6 to 2.9 ms, because a pass is timed from its
    first stage to its last and waits on the one before it (ADR-0082). The sums exceed SPEC
    10.8's 13 ms in both looks, the Studio look's included, so they cannot decide the third
    step. The frame rate held, and the uncapped frame time puts the Lab look about 15% over
    the Studio look. Whether to take the third step is for a measurement in the Tauri window
    with physics awake (`HIL_CHECKLIST.md`'s drag).
  - The bokeh's passes are named `Bokeh.prefilter` and `Bokeh.gather`, and the frame-rate
    measurement prints every pass's time by its target.
  - The Studio look draws as before: LOOKDIFF against 6538594 at 0.001 to 0.002 of 255 opened in
    the Studio look, and 0.001 to 0.014 opened in the Lab look and switched (`LOOKDIFF_FROM=lab`).

## ADR-0146 A title column reads the bench: three readouts and a sentence

- **Context.** The Studio showed the simulation's currents only in the drawer's Sim/Probes tab
  and its problems in the ERC tab, so with the drawer closed nothing on the stage said whether the
  circuit was within the Pi's limits or what it was doing. The night-lab HUD (ADR-0142) frames a
  stage with a title column: a name, three live numbers and one live sentence.
- **Decision.**
  - The title column sits over the stage's top left: the project's name under "Breadboard
    Studio", then three readouts, then a sentence (`studio/readouts.ts`, `studio/Hud.tsx`).
  - The readouts are GPIO DRAW (every GPIO's current together, in cyan as the headline), PEAK
    with the busiest pin's name, and CHECKS (errors, else warnings, else OK). A total over
    `RP1.totalGpioCurrentMaxA` or a pin over `RP1.pinCurrentMaxA`, the limits `simChecks` also
    reports, turns its readout coral; currents read in whole µA below 1 mA, then mA to one
    decimal.
  - They read the snapshot the bench shows, chosen as the view chooses it: the Pi's while Live Pi
    state follows it, else the simulation's, none while a build is part of the way.
  - The sentence names controls and pins but no live numbers, in a fixed order: an empty bench,
    a build part-way, a simulation error, a pin over its limit, the total over its limit, ERC
    errors, Live Pi state, a run on the Pi, a simulation running, idle. It changes only with the
    bench's state, so as `aria-live` text a screen reader hears it once; it carries no role, so
    the page keeps one `role="status"`.
  - The column takes no pointer input except Claude's note, which moved into it; it is mounted
    after the stage element, so the stage holds no button and the world labels stay first in the
    document. Container queries hide the sentence, then the name, as the stage gets short.
- **Consequences.** With the drawer open the stage is short, so the sentence folds away and the
  readouts stay. The column covers the stage's top left: the default framing can put the bench's
  far end under it.

## ADR-0147 An opening tour shows the bench in its room, and gives way to the first input

- **Context.** The app opens on the Studio (ADR-0141), and the Lab look (ADR-0143 to ADR-0145)
  sets the bench in a furnished workroom that its first framing, the iso preset close on the
  bench, barely shows. The exhibit house style opens with a short tour that the first input
  takes over. Three constraints hold it in: the Studio draws no frames when nothing moves (SPEC
  10.8), test automation must see the Studio as it was, and nothing the user does may be lost.
- **Decision.**
  - `studio/tour.ts` plans the tour from the bench (`benchOf`, `planShots`) and runs it (`Tour`):
    the room from about 1.4 m over 5 s, low along the bench from the Pi to the breadboard over
    5 s, close on the brightest lit part or else the T-board over 4.5 s, then 1.2 s eased home to
    the iso preset. Each shot turns 1.6 to 3 degrees a second; the veil dips to black over
    350 ms into each cut and lifts over 350 ms after it. The Lab look's depth of field follows
    the camera's distance (ADR-0145), so the close-up melts the room without a focus pull of its
    own.
  - The view runs it in `frame()` beside the preset tween, which keeps the frame loop's rule:
    frames while it plays, none once it ends.
  - It plays once a launch, at the Studio's first opening, in the Lab look, on a bench, unless
    `navigator.webdriver` is set, reduced motion is asked for, Build Mode is on, an assistant's
    turn is running, or View's Opening tour button has turned it off (`gpio.studio.tour` on this
    machine). C plays it at any time.
  - The first press or wheel turn on the stage is swallowed in the capture phase, before the
    orbit controls see it, and eases the camera to the iso preset from wherever the tour put it.
    A key ends the tour and then acts as it always does, so a preset key lands on its preset. A
    look switch, an edit or a capture ends it; a document opened under it re-plans it.
  - While it plays, `studioStore.presenting` steps the side panels back (opacity 0 and `inert`,
    in their place, so the stage does not resize) and shows one line under the stage. The line
    has no status role, so the page keeps one.
- **Consequences.**
  - Every tutorial's tour stays inside the room, turns at that pace, ends exactly on the iso
    preset and runs under 16 s (`tour.test.ts`). `e2e/tour.spec.ts` plays it as C does: the
    camera moves, the panels step back and take no input, the first click selects nothing, the
    camera lands on the iso preset, and the scene is still within 2 s.
  - Under automation the tour never starts by itself, so the rest of the suite opens the Studio
    as before.
