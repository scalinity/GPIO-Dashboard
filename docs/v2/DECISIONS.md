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
- **Consequences.** These numbers live in `core/constants` with this source. The spec's
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
    RGB LED: common cathode, inferred from project 1.1.2's wiring and code; no page
    states it.
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
