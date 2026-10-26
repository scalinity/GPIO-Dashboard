# GPIO Dashboard v2 — Breadboard Studio: Specification

Status: target-state specification. Implement all of it, end to end.
Location: docs/v2/SPEC.md at the repository root (next to gpio-dashboard/).
Source of truth: this file is the source of truth for v2.
Revision: 2026-10-24. This revision:
- puts correctness first: the audit comes before any 3D work
- adds Board Sense, a live connectivity engine for both the twin and my physical board
- adds the male–male wiring convention through the T-board
- adds real-time physical 3D and the Blender asset pipeline
- corrects the T-board geometry, with bench-confirmed columns and ribbon orientation
- adds verified references (section 22)

Order of work: correctness audit → Board Sense → the 3D Studio (19).

Baseline:
- v2 builds on origin/main at 52639d9 ("docs(readme): correct the capability claim and describe host keys and testing").
- That commit completes the Electron → Tauri migration. The Electron history ends at a4d765f and is reference-only.
- Code paths are relative to gpio-dashboard/ at 52639d9 unless stated otherwise. Paths that start with docs/ are relative to the repository root.

────────────────────────────────────────
0. SUMMARY
────────────────────────────────────────
GPIO Dashboard is my desktop learning and lab tool for:
- a Raspberry Pi 5
- a SunFounder Basic Starter Kit
- standard solderless breadboards
- a 40-pin T-shaped GPIO extension board (the "T-board") on a 40-wire rainbow ribbon cable

v2 turns it into Breadboard Studio, a documented, physical digital twin of my bench:
- Every breadboard, the Pi 5, the T-board, the ribbon, the jumper leads, and every part are modeled in 3D and electrically. The sources are published standards, datasheets, and my reference photos.
- The 3D space runs in real time, like the reference video. It is not a gallery of stills. The ribbon and every flexible lead are simulated. When I drag the Pi, a board, the T-board, or a module, the attached cables follow, drape over what's around them, slide off things that move, and settle.
- It looks cinematic in real time. Hero assets are authored and baked in Blender, then rendered live with three.js WebGPU, PBR materials, and a post-processing stack.
- Every part lead and wire end sits in a real hole or on a real header pin.
- Wiring follows my bench:
  - The ribbon takes the Pi header, so every GPIO is reached through the T-board's breadboard strips with male–male leads.
  - Nothing plugs into the Pi header directly.
- Correct before pretty. The baseline was abandoned because its tutorials and its module and sensor depictions were electrically wrong. v2 first audits and re-derives every circuit, part, and code sample from sources. Only then does it build the 3D Studio on that verified content.
- Board Sense reads connectivity live:
  - In the twin, every insertion and removal is tracked to the exact hole.
  - On my real board, the Pi probes its GPIOs through their internal pulls. It works out which nets connect to what, and where the physical board differs from the twin.
- A deterministic engine derives the netlist, runs electrical rule checks (ERC), and simulates the circuit.
- A Claude API agent builds and edits circuits from natural language through typed tools. The 3D scene updates live while each tool call streams in.
- Tutorials are circuit documents, so the instructions, the 3D view, the checks, and the code can't disagree.
- My real Pi closes the loop in two ways:
  - live GPIO telemetry mirrored onto the twin
  - one-click execution of the project's code on hardware

The app is already a Tauri 2 desktop app (macOS first). It has a working Rust backend for SSH, telemetry, Pi-agent deployment, settings, and the Keychain. v2 extends that backend; it doesn't rebuild it.

Naming: "agent" in the existing code means the Python Pi agent:
- window.api.agent
- src-tauri/src/agent.rs
- pi-agent/

So in code, the Claude agent is called the assistant: module assistant/, Tauri namespace anthropic, UI tab "Claude". In this document, "Claude agent" and "assistant" mean the same thing.

────────────────────────────────────────
1. PRINCIPLES
────────────────────────────────────────
1. Ground truth is computed, never asserted.
   - The LLM decides intent and topology.
   - Deterministic code owns geometry, connectivity, validation, and electrical simulation.
   - Tools return holes, nets, ERC results, and sim numbers. The assistant reasons over those and quotes them.
2. One writer.
   - A single op dispatcher is the only code that mutates a circuit document.
   - User gestures, assistant tool calls, tutorial loading, and undo/redo all go through it as validated transactions.
3. Documented, not guessed.
   - Every physical dimension, pinout, and electrical limit comes from one of these:
     - a standard
     - an official Raspberry Pi document
     - a datasheet
   - Two items have no published drawing: the T-board and the jumper leads. Their geometry comes from my measurements, or from calibrated measurements of my reference photos, and the method is recorded.
   - Each value is recorded with its source in a constants or definition file. Nothing is hard-coded from memory.
4. Generated, not hand-typed. Wiring text, build steps, and theory values (GPIO numbers, resistor values) are generated from the circuit document.
5. Hardware stays behind my hand.
   - The assistant can simulate anything.
   - Only my explicit clicks run code on the Pi or touch GPIO. The one exception: launching the app starts the GPIO agent on the saved Pi when the Pi already has this app's agent. The agent reads pins and drives none, and quitting the app stops it.
   - Board Sense probing is off until I switch it on. It never drives a pin as an output (14.5).
6. Capability first.
   - This is a personal, experimental tool. Add no enterprise process.
   - Keep the safeguards that protect correctness, my hardware, and my secrets.
7. Extend the baseline.
   - Keep the working Tauri backend and its tests green.
   - Change existing modules only where v2 needs it, and never regress the existing hardware features.
8. Physical in real time.
   - The scene behaves like the bench. Cables have length, weight, and stiffness. Moving something moves what's attached to it. Flexible things rest on whatever they touch, and slide off when it moves.
   - Physics is visual. It never changes the circuit document, the netlist, ERC, or the sim.
   - Some physical facts matter to correctness or buildability, such as a lead that's too short or two bodies that collide. core/ computes those deterministically from geometry.
9. Reproducible assets.
   - Every shipped 3D asset rebuilds headlessly with one command, from committed scripts and pinned sources.
   - Blender is the authoring and baking stage. Interactive Blender sessions are for exploration; anything I keep goes into the scripts.
10. Correct before pretty.
    - No circuit, part, module depiction, or code sample ships until it passes the audit (16): it must be sourced, pass ERC, pass sim assertions, and match its code.
    - The 3D Studio renders verified content. It never papers over wrong content.

────────────────────────────────────────
2. REFERENCE AND ADAPTATION
────────────────────────────────────────
2.1 The video
The reference is a screen recording of Diode, a browser 3D circuit simulator. It shows:
- A PBR-quality 3D Arduino Uno and breadboard on a light studio stage.
- A live 3D space. Orbiting, dragging, and placing all happen in real time, with no loading between states.
- A left "Insert Part" palette: Arduino Uno, Wire, Resistor, LED, Motor, 555 Timer, 8-pin custom chip, Tactile Switch, Capacitor, NPN, PNP, Breadboard.
- Parts and jumpers seated in real holes. Wires are arcing tubes with Dupont pin ends.
- Click-to-select with a wireframe bounding box, and drag to move.
- An orbit camera with preset buttons (fit, isometric, top, orbit) and rotate-selection buttons.
- An "Inspect" section: Show Labels (floating tags such as "Cathode (−)") and Show Voltages.
- A contextual properties panel:
  - Resistor: Resistance 1.00 kΩ
  - LED: Color
  - Wire: Color, Height, Show Current
  - Switch: Retain Press
  - Arduino: Code Editor, with a status dot
- Simulate, Explore, Fork, and Embed.

2.2 My reference photos
Location in the main checkout (checked on 2026-10-24; single spaces throughout):
  "/Users/danny/Documents/Tools/GPIO Dashboard/docs/v2/3D Reference Images/T-Cobbler and BreadBoard"
Shell-escaped:
  /Users/danny/Documents/Tools/GPIO\ Dashboard/docs/v2/3D\ Reference\ Images/T-Cobbler\ and\ BreadBoard

The folder holds six product photos of my T-board kit. Read each one with vision:
1. "Ribbon and BreadBoard - Image 2.jpg": the T-board and ribbon plugged into a full-size breadboard, at an angle. Shows placement, ribbon drape, and IDC socket orientation.
2. "Ribbon and BreadBoard.jpg": the listing graphic. Text: "Size: 200*50mm" (the ribbon), "T-type GPIO adapter: 73mm*59mm", "1Pcs 400-hole breadboard", "10Pin male to female DuPont line", "10Pin male to male DuPont line".
3. "T-Cobbler and BreadBoard - Image 1.jpg": a top-down layout of the kit, showing:
   - the T-board labels
   - the breadboard (rows numbered to 60+, columns a–j, four rails)
   - two 10-lead Dupont bundles
   - the ribbon with two IDC sockets
4. "T-Cobbler and BreadBoard - Image 2.jpg": dimension callouts:
   - T-board: 59 mm across the top bar and 60 mm along the stem. The header end has 11 mm and 14.5 mm callouts.
   - breadboard: 160 mm
   - ribbon: 200 mm
   - Dupont leads: 200 mm
   - The "5.5mm" width callouts are wrong by an order of magnitude. Ignore them.
5. "T-Type Board - Bottom.jpg": the T-board underside, showing two male pin strips with yellow plastic spacers. Section 6.3 uses this photo for the pin-row spacing.
6. "T-Type Board - Single Subject.jpg": an angled T-board view, showing:
   - the grey shrouded 2×20 box header with its key slot
   - red solder mask with visible traces
   - white silkscreen
   - tinned pads
   - the male pins under the stem

Use them for two things:
- The look-dev target: materials, colors, proportions, and label text.
- Evidence for the T-board, ribbon, and lead geometry.

Findings already taken from them:
- The breadboard is a full-size 830-point board with 63 rows, despite the listing's "400-hole" text.
- The T-board label order (6.3).
- The pin-row spacing is about 6 pitches (6.3).
- The Dupont leads are 200 mm long.

Confirmed on my bench (2026-10-23):
- The T-board sits on columns d and h (6.3).
- At the Pi, the ribbon's brown conductor is on the edge away from the USB and Ethernet ports (6.4).

These are vendor product photos.
- Commit them only if the repository is private (check with `gh repo view --json visibility`).
- Otherwise, reference them in place.
- Either way, record each file's name, size, SHA-256, and a one-line description in docs/v2/reference/IMAGES.md.

2.3 Adaptation
- The controller is the Pi 5 + ribbon + T-board, not an Arduino.
- The UI chrome is the night-lab HUD (ADR-0142):
  - an ink ground (`#0b0f1a`) under dark navy glass cards, with a cool text ramp from `#eef2fa` down to the key hints' `#7d87a4`;
  - five accents with fixed meanings: cyan `#7fe3ff` for measurement and selection, amber `#ffb454` for hardware and events, coral `#ff6b86` for limits and faults, violet `#b99cff` for the assistant and a second series, and green `#8fe8a8` for OK;
  - Outfit for the interface and DM Mono for values, both served by the app, each followed by system faces for the glyphs it lacks; the terminal sets Menlo;
  - one colour source, `styles/palette.cjs`, mapped into the Tailwind theme and onto CSS variables. Every text shade and accent reads at 4.5:1 or more on the surfaces it sits on.
- The 3D stage is a neutral studio that reads well against the dark chrome.
- No Embed. Explore/Fork becomes local Projects plus "Fork tutorial into my projects".
- v2 goes beyond the reference with:
  - a real netlist, ERC, and an MNA simulator
  - an assistant that builds circuits
  - a live hardware twin
  - real-time cable physics

────────────────────────────────────────
3. PLATFORM AND STACK
────────────────────────────────────────
3.1 Baseline (exists at 52639d9; keep it)
Tauri and the Rust backend:
- Tauri 2 (locked at 2.12.5), with the overlay title bar and the navbar as the drag region.
- Rust backend crates:
  - russh 0.64, for SSH exec, streaming exec, and PTY shells. Uploads stream into `cat > file` over an exec channel; there is no SFTP.
  - tokio-tungstenite 0.30, for the Pi-agent WebSocket feed, with raw-payload dedupe.
  - reqwest 0.13 (native-tls).
  - keyring 4.2, for secrets in the macOS Keychain under the service com.gpio-dashboard.
  - tauri-plugin-dialog.
  - the open crate, for external links.
- Settings live in a JSON settings file plus the Keychain (src-tauri/src/settings.rs). The settings_set allowlist is in commands.rs.
- Host keys use trust-on-first-use and are stored in known_hosts in the app config dir. Reconnect uses backoff. Auth errors and changed host keys suppress reconnect.
- The Pi-agent files are compiled in with include_bytes! (src-tauri/src/agent.rs).

Frontend:
- React 19, Vite 7, Tailwind 3, Zustand 5, CodeMirror 6, xterm.js 6.
- Vite's root is src/renderer, with the alias @renderer → src/renderer/src. So static files go in src/renderer/public/.
- The JS/JSX renderer talks to Rust through window.api, which src/renderer/src/api.js implements over invoke/listen.

Tests:
- cargo test: unit tests plus mock WebSocket and HTTP servers.
- src-tauri/live-tests.sh: ignored integration tests against a throwaway local sshd.
- npm test: node --test for the bridge.

3.2 v2 additions
Frontend:
- TypeScript in strict mode for all new modules. Vite compiles TS alongside the existing JSX.
- Migrate an existing JSX file to TS only when you substantially rewrite it.
- Libraries:
  - three.js WebGPURenderer with TSL node materials, through @react-three/fiber
  - Immer
  - zod
  - Pyodide in a Web Worker
  - @anthropic-ai/sdk v1.x, which speaks API version 2026-10-21
- Vitest for TypeScript tests. Playwright for e2e.

Physics:
- An in-house XPBD solver in TypeScript (physics/), run in a Web Worker that shares state through SharedArrayBuffer.
- No third-party physics engine. Rigid-body engines model ribbon and thin wire poorly, and the solver needed here is small.

Build-time asset tools (scripts only, never shipped in the app):
- Blender 5.2 LTS, the current LTS as of 2026-10-23, run headless.
  - Use the LTS, not a newer feature release.
  - The build scripts find it through BLENDER_BIN.
- occt-import-js (OpenCascade compiled to WASM) to read STEP files, because Blender has no STEP importer.
- @gltf-transform, for dedupe, weld, prune, meshopt compression, and KTX2 textures.
- KTX-Software (toktx), which gltf-transform's KTX2 encoding requires.

Rust:
- Add these modules:
  - anthropic.rs: the streaming proxy, built on the existing reqwest
  - projects.rs: project file I/O
  - i2c support in ssh.rs
- Add no new crates unless needed. Record any you add in docs/v2/DECISIONS.md.

No new Tauri plugins are exposed to the webview. Project files go through our own commands, which keeps the current minimal capability surface.

Versions: use the latest stable release of every new dependency and tool, except Blender, which stays on the LTS. Record each version, with the reason, in docs/VERSIONS.md.

3.3 Local environment (my Mac)
Main checkout:
- /Users/danny/Documents/Tools/GPIO Dashboard. Checked on 2026-10-24, it contains .git, .env, gpio-dashboard/, and docs/v2/ (this spec, KICKOFF.md, and the reference photos).
- Confirm it with `git rev-parse --show-toplevel`.

Reference photos: see 2.2.

Secrets:
- The main checkout's root holds a .env file containing ANTHROPIC_API_KEY.
- At 52639d9 the root .gitignore (.DS_Store, .playwright-mcp/, OpenRouter Docs/, .claude/) does not ignore .env; only gpio-dashboard/.gitignore does. Add .env and .env.* (keeping !.env.example) to the root .gitignore in the first v2 commit.
- Only two kinds of process use the key, and each reads it from that file into its own memory:
  - the live assistant evals
  - one ignored live test of the Rust proxy (18)
- Never put the key into the app's Keychain. Adding it in Settings is my job.
- Never do any of these with the key:
  - copy the .env file into the worktree
  - print it or log it
  - write it into transcripts, fixtures, screenshots, or reports
- The app never reads .env. It reads the key from the Keychain (12.1).

Blender MCP:
- I may have a Blender MCP server connected (github.com/ahujasid/mcp-for-blender, formerly blender-mcp).
- It's optional. Its role is limited by 10.3.

────────────────────────────────────────
4. ARCHITECTURE
────────────────────────────────────────
4.1 Process model

  ┌──────────────────────────── Tauri app (macOS) ─────────────────────────────┐
  │ Webview: React 19 (JSX + new TypeScript modules)                           │
  │   UI gestures ──┐                                                          │
  │   Assistant ────┼──► circuitStore (single-writer op dispatcher)            │
  │   Tutorials ────┘        │ validates and commits transactions              │
  │                          ▼                                                 │
  │              core/ (pure TS): model · netlist · ERC · sim · steps · reach  │
  │                          │ doc + live drag state (read-only)               │
  │                          ▼                                                 │
  │   physics.worker (XPBD) ◄──► SharedArrayBuffer ──► 3D Studio               │
  │   ribbon · leads · contacts                        (R3F + WebGPURenderer)  │
  │   sim.worker · pyodide.worker · panels                                     │
  │   window.api (api.js) + typed wrappers in native/                          │
  │─────────── invoke · events (existing) · Channels (new streams) ────────────│
  │ Rust: ssh.rs (russh exec/PTY/upload, TOFU) · ws.rs (telemetry) ·           │
  │       agent.rs (Pi agent deploy) · settings.rs (JSON + Keychain) ·         │
  │       anthropic.rs (NEW proxy) · projects.rs (NEW) · commands.rs           │
  └────────────────────────────────────────────────────────────────────────────┘
         │ HTTPS                      │ SSH :22 (exec, PTY, upload, and the agent WebSocket tunnel, D18)
   api.anthropic.com            Raspberry Pi 5 ── pi-agent (Python, bound to 127.0.0.1:8765)

  Build time only (never shipped):
    pinned sources (STEP, datasheet dimensions, content/*.json)
      → occt-import-js → Blender, headless (model · materials · bake)
      → gltf-transform → src/renderer/public/models/*.glb + manifests + colliders

4.2 Why the assistant loop runs in the webview
- Its tools mutate and query the circuit document, which lives in the webview. Running the loop there means:
  - tool execution needs no IPC round-trips
  - the official TypeScript SDK's streaming and accumulation helpers still apply
- The API key never enters the webview:
  - The SDK is constructed with a placeholder key and a custom fetch that sends each request through the Rust command anthropic_request.
  - That command validates the path, strips any Authorization or X-Api-Key header from the webview, and injects the real key from the Keychain.
  - It streams the response back over a Tauri Channel.
- Set dangerouslyAllowBrowser: true. It's safe here only because Rust injects the real credential.
- Use Channels for new per-request streams, because they are ordered and scoped to the request. Keep the existing global events (gpio:state, terminal:data:<id>, tutorial:output, and the rest) as they are.

4.3 Why physics runs in a worker
- The worker keeps the main thread free for React and rendering.
- It shares particle positions through SharedArrayBuffer, double-buffered so the renderer never reads a half-written step.
  - SharedArrayBuffer needs cross-origin isolation. The app isn't isolated at 52639d9; M0 adds the COOP/COEP headers (13.2), which Pyodide needs too.
- Inputs: kinematic anchors, derived from the doc plus any drag in progress, and collider proxies.
- Outputs: particle positions and per-island sleep flags.
- It never sees or writes the CircuitDoc.

4.4 Layout (new and changed paths)

  docs/v2/                      SPEC, PLAN, PROGRESS, DECISIONS, BASELINE, LOOKDEV, HIL_CHECKLIST, FINAL_REPORT
    reference/                  IMAGES.md (photo manifest); tboard/ (my measurements, if I add them)
    lookdev/                    optional small material-library .blend (10.3)
  gpio-dashboard/
    src/renderer/src/
      core/                     circuit-core: pure TS, zero React/DOM/Tauri imports
        model/ defs/ ops/ netlist/ erc/ sim/ steps/ reach/ serialize/ constants/
      content/
        parts/*.part.json  boards/*.board.json  controllers/*.json  leads/*.json  tutorials/*.gpiob  inventory.json
      state/                    circuitStore.ts (dispatcher, undo), next to the existing store/ (kept)
      studio/                   3D: stage, lighting, post, boards, controller, parts, leads, ribbon, picking, overlays, camera
      physics/                  pure TS XPBD: particles, constraints, contacts, islands, sleep
      panels/                   PartLibrary, Properties, Inspect, Claude, Code, ERC, Sim, BuildSteps
      assistant/                client, loop, context.ts (AssistantContext), tools (zod), streaming previews, transcripts, system-prompt.md
      workers/                  sim.worker.ts, pyodide.worker.ts (+ Python shims), physics.worker.ts
      native/                   typed TS wrappers over window.api: ssh, gpio, terminal, piAgent, settings, anthropic, projects
      pages/                    WorkbenchPage (interim, M3–M6); StudioPage (new, M7); Tutorials (rebuilt); Connect, Pinout, Monitor and the other existing pages (kept)
      api.js                    extended with the new namespaces (anthropic, projects); the ai namespace removed
    src/renderer/public/models/ shipped GLBs, manifests, colliders
    src-tauri/src/
      anthropic.rs (new)  projects.rs (new)  commands.rs (extended)  settings.rs (extended)  ssh.rs (i2c)
      ai.rs (removed)
    scripts/
      assets/                   build.ts, check.ts, step-to-glb.ts, sources.json, blender/*.py (+ shared lib)
      assistant-evals/  hil.ts  ngspice/
    pi-agent/                   Python source of truth (compiled in); adds sense.py (Board Sense, 14.5)
    e2e/

4.5 Invariants (each enforced by tests or lint)
- core/ and physics/ import nothing from React, the DOM, Tauri, or window.api. Enforce this with an ESLint boundary rule.
- physics/ never imports state/, assistant/, or native/, and can't dispatch.
- Only circuitStore.dispatch(transaction) mutates a CircuitDoc. A rejected transaction leaves the document unchanged.
- assistant/ imports only core/, native/anthropic, and its own AssistantContext interface.
  - The Claude panel implements AssistantContext and injects it. It provides:
    - circuitStore.dispatch
    - the sim worker
    - Pyodide compile and run-in-sim
    - the studio hooks for capture_view, focus, highlight, and ghosts
    - a read-only Board Sense snapshot. The assistant can't start, stop, or configure sensing.
  - An ESLint rule forbids assistant/ from importing state/, studio/, workers/, or any native/ module other than native/anthropic, and from touching window.api. Use no-restricted-imports, plus no-restricted-syntax on window.api.
  - So the assistant can reach the ssh, gpio, terminal, piAgent, and projects-write APIs by no path.
  - A test asserts that the rule exists and passes.
- The Anthropic key never reaches the webview, and its commands return booleans only.
  - The existing SSH password round-trip through settings_get is unchanged and out of scope for this rule. At 52639d9, commands.rs returns it for ConnectPage's form.
- 3D geometry comes from the same data files as core geometry. Tests prove that modeled holes and pins coincide with logical holes and pins (18).

────────────────────────────────────────
5. DATA MODEL (core/model)
────────────────────────────────────────
Conventions:
- Units are millimetres in board space.
- The breadboard pitch is 2.54 mm.
- IDs are stable strings.
Refine the details, but keep these semantics.

  CircuitDoc {
    schemaVersion,
    meta { name, created, updated, sourceTutorialId?, revision },   // revision: bumped by every committed transaction
    boards: BoardInstance[],
    controller: ControllerInstance,
    parts: PartInstance[],
    wires: Wire[],
    code { language: 'python', library: 'RPi.GPIO' | 'gpiozero', source },
    buildStepAnnotations?: Record<stepKey, { why?, mistake? }>,
    assistant?: { transcriptFile }
  }

  BoardInstance { id, defId: 'bb-830' | 'bb-400', transform { position, rotationDeg } }

  ControllerInstance {
    pi:     { transform { position, rotationDeg } },          // the Pi 5 on the table
    tboard: { board, pin1Row, colPair: 'b/f' | 'c/g' | 'd/h' | 'e/i',   // mine is d/h (6.3)
              orientation: 'header-toward-row-0' | 'header-toward-last-row' },
              // header toward row 0: odd pins take the a–e column of the pair; reversed: the f–j column
    ribbon: { lengthMm }                                       // 200 for my cable (6.4)
  }

  HoleRef =
      { board, area: 'main', row: int, col: 'a'..'j' }
    | { board, area: 'rail', rail: 'top+' | 'top-' | 'bottom+' | 'bottom-', index: int }

  Endpoint = { hole: HoleRef } | { pin: { part, pin } }   // pin endpoints only for off-board module connector pins (male pin or female socket)

  PartDef {
    id, name, category, kitTags[],
    pins: { id, label, role, offsetPitch: [x, y], electricalType }[],
    internalConnections: pinId[][],
    footprint: { kind: 'flex-2lead', minSpan, maxSpan }
             | { kind: 'rigid', straddleTrench?: boolean }
             | { kind: 'offboard', header? },
    sim { model: SimModelId, params },
    properties: JSON Schema for editable props,
    geometry: { family: BlenderFamilyId, params } | { gltf: assetPath } | { procedural: GeneratorId, params },
    colliders?: assetPath,
    provenance { sources: url[] }            // datasheet / official doc URLs; required
  }

  PartInstance {
    id (R1, D1, Q1, U1, SW1…), defId, props,
    placement { pins: Record<pinId, HoleRef | null>, offboardPose?, bend? }
  }

  Wire {
    id, a: Endpoint, b: Endpoint, color,
    kind: 'dupont-mm' | 'dupont-mf' | 'dupont-ff' | 'solid-arc' | 'solid-flat',
    lengthMm: number | 'auto',      // Dupont: real lead length; solid: cut length
    heightMm?,                      // solid-arc bend height
    routeHints?: Vec3[]             // at most 3 soft targets set by dragging mid-span; visual only
  }
  Lead ends mate by gender (6.5).

  Op = AddBoard | MoveBoard | SetControllerPlacement
     | AddPart | MovePart | RotatePart | RemovePart | SetPartProps
     | AddWire | MoveWireEnd | SetWireProps | RemoveWire | SetCode | SetMeta

  Transaction { id, author: 'user' | 'assistant' | 'system', label, ops: Op[], inverse: Op[], assistantTurnId? }

Derived values (pure, memoized):
- occupancy(doc) → Map<HoleKey, occupant>
- netlist(doc) → nets with members and canonical names (GND, 3V3, 5V, GPIOnn, else N1…)
- erc(doc, netlist) → Issue[]
- simulate(doc, netlist, stimulus) → OperatingPoint | Transient
- buildSteps(doc) → Step[]
- reach(doc) → lead and ribbon reach checks (feeds LEAD_TOO_SHORT)

File format: .gpiob, which is JSON with schemaVersion. Migrations live in core/serialize, with fixture tests.

────────────────────────────────────────
6. DIGITAL TWIN: GEOMETRY AND ELECTRICAL CONTRACT
────────────────────────────────────────
All values below live in data files with source URLs and are covered by tests. Section 22 lists the sources and the numbers already extracted from them.

6.1 Standard breadboards
Common to both sizes:
- 2.54 mm pitch, square holes.
- Each numbered row has two 5-hole strips, a–e and f–j.
- The centre trench puts 0.3" (3 pitches) between columns e and f, so 0.3" DIP packages straddle it.
- Terminology: BusBoard's datasheets call our rows "columns".

bb-830 (full size; BusBoard BB830):
- Body: 165.1 × 54.6 × 8.5 mm.
- 63 rows × 10 holes = 630 tie points.
- Four rails of 50 holes each (200 tie points), arranged as:
  - groups of 5 holes, then a gap
  - rail holes in line with the circuit rows
  - positioned 0.05" further outward than 0.1" centres from the circuit area
- Rails are continuous by default. A split-rail flag covers boards that break the rail mid-length.
- Contacts are phosphor bronze, nickel plated.
- Accepts 21–26 AWG wire (0.4–0.7 mm); standard 0.64 mm square header pins fit.
- Rated 36 V, 2 A.
- Body material: white ABS with a color legend.

bb-400 (half size; BusBoard BB400):
- 30 rows.
- Four rails of 25 holes each, in groups of 5. The rails sit 0.25" from the circuit area, with their holes offset 0.050" from the circuit-area holes.
- Body dimensions come from the BB300/BB400 datasheet.

My board is a generic 830-point board; the listing photo says 160 mm long.
- Use the BB830 values as the standard geometry, then check the proportions against my reference photos.
- Record any differences in DECISIONS.md. Never change the hole pitch.

A project can hold multiple boards. New projects default to one bb-830, which matches my bench.

6.2 Raspberry Pi 5
Official sources (Raspberry Pi product information portal, https://pip.raspberrypi.com/categories/892-raspberry-pi-5):
- 3D model, STEP, with graphics: https://pip-assets.raspberrypi.com/categories/892-raspberry-pi-5/documents/RP-010082-CA-1-rpi-5%203D%20STEP%20-%20With%20Graphics%20large%20file.zip
- 3D model, STEP, no graphics: https://pip-assets.raspberrypi.com/categories/892-raspberry-pi-5/documents/RP-010083-CA-1-rpi-5%203D%20STEP%20-%20No%20Graphics%20small%20file.zip
- Mechanical drawing: https://pip-assets.raspberrypi.com/categories/892-raspberry-pi-5/documents/RP-008347-DS-1-raspberry-pi-5-mechanical-drawing.pdf
- Product brief: https://pip-assets.raspberrypi.com/categories/892-raspberry-pi-5/documents/RP-008348-DS-8-raspberry-pi-5-product-brief.pdf
- RP1 peripherals: https://pip-assets.raspberrypi.com/categories/892-raspberry-pi-5/documents/RP-008370-DS-1-rp1-peripherals.pdf

The 3D model is the official STEP, converted through the asset pipeline (10.3). Don't model the Pi by hand.

Use the mechanical drawing and the product documentation for:
- The board outline, mounting holes, and port and header positions in 3D.
  - Text extraction of the drawing gives only unlabeled numbers (85, 56, 58, 49, 3.5, ø2.7, 29, 29.1).
  - Read the drawing visually, and record which dimension you used for what.
- The 40-pin header pinout: physical pin, BCM number, name, and alternate functions.
- The electrical constants, from the official GPIO documentation and the RP1 peripherals datasheet:
  - 3.3 V logic, not 5 V tolerant
  - pad drive strength settings
  - input thresholds
  - internal pull resistor values
  - recommended per-pin and total current
  - 3V3 rail capability

src/renderer/src/data/pins.js is only a starting point. Verify every row and test it.

6.3 T-board (SunFounder GPIO Extension Board)
Identity:
- A red PCB printed "GPIO Extension Board", with 40 pins.
- Labels use BCM names, with I2C and SPI names where printed (SunFounder docs, section 22).
- SunFounder publishes no CAD model and no dimensional drawing.

Evidence, in priority order:
1. My measurements, a README plus photos, if present.
   - They live in the main checkout's docs/v2/reference/tboard/. docs/ isn't tracked at 52639d9, so the worktree starts without them.
   - Copy them into the worktree in the first commit.
2. Calibrated measurements from my reference photos (2.2). Use a known dimension in the same photo as the scale: the 2.54 mm pin pitch or the 2×20 header.
3. The Adafruit T-Cobbler Plus board file (section 22), as the geometric prior.
   - The SunFounder board matches Adafruit's envelope within about 1 mm: the listing says 73 × 59 mm, Adafruit is 73.66 × 58.42 mm.
   - It also matches Adafruit's pin-row spacing (below).
   - It is a different product. Use the Adafruit file as a prior, never as truth over sources 1 and 2.

Pin rows:
- Two 1×20 rows at 2.54 mm pitch, 15.24 mm (0.6", 6 pitches) apart.
  - Evidence: in the underside photo the two pin strips are 6.05 pitches apart, using the header pitch in the same photo as the scale.
  - The Adafruit board puts its rows at x = 21.59 mm and x = 36.83 mm, symmetric about the board centreline.
- My original spec assumed the rows land in e and f. That's impossible, because e and f are 3 pitches apart.
- The trench puts 3 pitches between e and f, so a 6-pitch span can land only on b/f, c/g, d/h, or e/i.
  - The board's centreline therefore sits off the trench centre: half a pitch for c/g or d/h, 1.5 pitches for b/f or e/i.
  - That offset is expected, not an error.
- Data: content/controllers/tboard.json stores:
  - rowSpacingPitches: 6
  - the pin table
  - the outline
  - the provenance of every number
- The placement stores the column pair (b/f, c/g, d/h, or e/i) and the orientation.
  - With the header toward row 0, the odd pins take the a–e column of the pair.
  - Rotated 180°, they take the f–j column.

Column pair on my bench: d/h (confirmed 2026-10-23).
- New projects and all tutorials use d/h, with the header toward row 0. That puts the odd pins (3V3 first) in column d and the even pins in column h.
- My photos are consistent with this orientation: 3V3 is on the left when the header is at the top, and the a–e side is on the left when row 1 is at the top.
- Add one item to HIL_CHECKLIST.md: "confirm 3V3 (pin 1) is in column d, not h".
- Other pairs stay legal for custom builds. Changing the pair is a one-field edit.

Rows:
- By default, pin 1 sits at row 1 and pin 39 at row 20. The header and the ribbon overhang the row-0 end of the board.
- The stem runs about 3 pitches past pin 39 (Adafruit prior: the outline ends 7.62 mm past the last pad, and the mounting holes sit 5.08 mm past it).
- The stem is about 20 mm wide.
  - Measured from the top-down photo, its edges sit about 0.9 pitch outside each pin row. That's just short of the c and i hole centres for d/h.
  - In rows 1–20, columns e, f, and g are under the stem and blocked.
  - Columns a, b, and j are free.
  - Columns c and i sit at the stem's edges.
- I plug leads into b or c beside a d pin. That bench fact wins over the geometry.
  - A 2.54 mm housing in column c overlaps the stem edge by about 1 mm at PCB height, so on the bench it leans slightly away from the T-board.
  - tboard.json carries edgeColumnsUsable: true. The collision check honors it by allowing that lean for Dupont housings in the edge columns (c and i for d/h), and the Studio renders the lean.
  - Add "confirm a male Dupont seats in column c beside the T-board" to HIL_CHECKLIST.md. If it doesn't, I set the flag to false, and tutorials use a and b instead.
- Collision between the actual lead or part and the T-board body decides every other hole near the T-board, including rows 21–23 under the stem in the default placement.
- Legal alternatives:
  - the reversed orientation
  - any start row that keeps all 40 pins on the board

Labels, from the reference photos. Pins are counted from the header end. The odd row is on the a–e side when placed as default.
- Odd pins 1–39: 3V3, SDA1, SCL1, GPIO4, GND, GPIO17, GPIO27, GPIO22, 3V3, SPIMOSI, SPIMISO, SPISCLK, GND, ID_SD, GPIO5, GPIO6, GPIO13, GPIO19, GPIO26, GND
- Even pins 2–40: 5V0, 5V0, GND, TXD0, RXD0, GPIO18, GND, GPIO23, GPIO24, GND, GPIO25, SPICE0, SPICE1, ID_SC, GND, GPIO12, GND, GPIO16, GPIO20, GPIO21
- Each T-board pin connects to the Pi header pin with the same physical number, through the straight-through ribbon. Tests verify this mapping against the official Pi 5 pinout.

Body (prior values; calibrate each one):
- Outline (Adafruit prior):
  - top bar ≈ 58.4 × 15.2 mm
  - stem ≈ 20.3 mm wide
  - overall length ≈ 73.7 mm
  - 2.54 mm corner radii
- Listing values: 73 × 59 mm overall; a 60 mm stem callout; 11 mm and 14.5 mm callouts at the header end.
- PCB thickness: 1.6 mm unless measured.
- A grey shrouded 2×20 box header on the top bar, with a central key slot.
  - Size: about 58.4–58.5 × 8.5–9.0 mm, and about 11–11.5 mm tall. Sources: the Adafruit outline, the DC3-40P listing, and the photo callout.
  - Take the long wall that carries the key slot from the angled photo.
- Two plated mounting holes at the stem end. The Adafruit prior puts 2.5 mm holes at x = 21.59 and 36.83 mm, 2.54 mm from the end.
- Under the stem: two 1×20 male pin strips with yellow plastic spacers (from the photos). Pins are 0.64 mm square.
- Finish:
  - red solder mask with visible traces
  - white silkscreen
  - tinned pads

Record every number in tboard.json with its source: a measurement, a photo calibration, or the Adafruit prior.

6.4 Ribbon cable and IDC sockets
Cable:
- 40 conductors on a 1.27 mm pitch.
- 50.8 mm wide (±0.4), about 0.95 mm thick.
- 28 AWG (7/0.127 mm tinned stranded copper), PVC insulation.
- Color sequence: brown, red, orange, yellow, green, blue, violet, grey, white, black, repeated four times.
  - In the standard code, conductor 1 is brown.
  - Confirmed on my bench (2026-10-23): at the Pi, the brown conductor sits on the edge away from the USB and Ethernet ports.
  - That edge should be the header's pin-1 end, so brown is pin 1 at both sockets. Verify the pin-1 end against the Pi 5 mechanical drawing and pinout, and render it that way.
- Length: 200 mm, from the listing.

Sockets:
- Two 2×20 female IDC sockets on a 2.54 mm grid.
- Each has a strain relief, a pin-1 triangle, and a polarization bump.
- The body reference is the 3M 891-series drawing. Use the vendor listing as a cross-check.

Wiring and assembly:
- The cable is straight-through: socket pin n connects to socket pin n.
- One socket seats on the Pi 5 header. The other seats in the T-board's shrouded header, keyed by the polarization bump.
- The ribbon itself is simulated (10.5). Only the sockets are static assets.

6.5 Jumper leads
My kit's leads:
- 10-lead bundles of Dupont jumpers, in male–male and male–female, 200 mm long (from the listing photo).
- Bundles peel apart into single leads. Model single leads.

Ends:
- 2.54 mm square single-pin housings. The Pololu housing drawing gives B = 2.54 mm for a 1×1 housing.
- Male pins are 0.64 mm square.
- Calibrate the housing length, pin protrusion, and wire diameter from the photos, using the 2.54 mm housing width as the scale. Record the results.

Wire:
- Stranded, typically 26–28 AWG, and flexible. It is simulated.

Pre-cut solid jumpers:
- 22 AWG solid core. They aren't in my kit, but they are available for custom builds as the kinds solid-arc and solid-flat.
- They keep their bent shape.

Data: content/leads/*.json. Inventory lengths come from inventory.json.

Wiring convention (my bench; tutorials, the placer, and the assistant all follow it):
- The ribbon occupies the Pi's 40-pin header. No lead ever attaches to the Pi header directly.
- A GPIO, 3V3, 5V, or GND is reached from its T-board pin's breadboard strip: a male–male lead goes from a free hole in that strip (a, b, or c beside a d pin; i or j beside an h pin) to the circuit.
- Power rails get their supply the same way: male–male leads from the T-board's 3V3/5V/GND strips to the rails.
- Breadboard-to-breadboard wiring is male–male.
- Modules with male header pins use male–female leads: female end on the module pin, male end in a breadboard hole.
- Modules with female sockets, like the SG90 servo's connector and the keypad's, use male–male leads: one male end in the socket, the other in a breadboard hole.
- Each module's part def records its connector gender per pin: male pin or female socket.
- Ends mate by gender. A male end goes into a breadboard hole or a female socket. A female end goes onto a male pin.
- Off-board modules never connect straight to the Pi.
- core/ enforces this:
  - An Endpoint {pin} may name only an off-board module's header pin.
  - The lead kind must match the genders at both ends.
  - Violations are validation errors, not warnings.

6.6 Placement rules (validated on every op)
- Each part pin occupies exactly one hole, or is null (unplaced).
- Each hole holds at most one lead: a pin, a T-board pin, or a wire end, never more than one.
- Rigid footprints rotate in 90° steps. A DIP must straddle the trench.
- Boards and the Pi may not overlap on the table. Their outlines may meet. An edit that adds an
  overlap is refused; a project saved with one still opens.
- A flexible two-lead part must span between minSpan and maxSpan.
- Part bodies may not collide. Check this with bounding volumes.
- T-board placement:
  - the column pair is b/f, c/g, d/h, or e/i
  - all 40 pins land on the board
  - none of its 40 holes holds another lead
  - no lead or part sits in a hole that the collision rule blocks (6.3)
- Lead ends mate by gender (6.5): male ends go into holes or female module sockets, and female ends onto male module pins. Nothing attaches to the Pi header.
- With the T-board in its default placement on a bb-830:
  - rows 24–63 are fully free
  - rows 21–23 are free only outside the T-board outline
  - When a build won't fit, the placer and the assistant add a second board.

────────────────────────────────────────
7. PART LIBRARY (content/parts)
────────────────────────────────────────
Every definition comes from its datasheet, with:
- source URLs
- tests on pin order
- 3D dimensions taken from the datasheet's mechanical drawing. These dimensions drive the Blender family scripts (10.3).

Kit and common parts:
- resistors: E12/E24 values, 1/4 W
- LEDs: red, green, blue, yellow, white; 3 mm and 5 mm
- RGB LED: common anode and common cathode, with 4 adjacent leads
- 6 mm tact switch: 4-pin, with its internal always-connected pairs modeled
- tilt (ball) switch
- 10 kΩ potentiometer
- LDR
- 10 kΩ NTC
- ceramic capacitors, and polarized electrolytic capacitors
- 1N4007
- S8050 and S8550. Take the pin order from the specific datasheet, because TO-92 pin orders vary.
- active and passive buzzers
- 74HC595, ADC0834, L293D
- 7-segment display, common anode and common cathode
- 4-digit 7-segment display
- 8×8 dot matrix
- 10-segment bar graph
- 5 V relay module
- DC motor + fan blade
- breadboard power supply module
- DHT11: module and bare 4-pin

Extras, tagged "not in kit":
- analog joystick module: two potentiometers plus a push switch
- SG90 servo
- HC-SR04
- HC-SR501
- LCD1602 with I2C backpack
- 4×4 membrane keypad
- ADS1115

Inventory:
- An editable "My inventory" list. Seed it from:
  - the SunFounder kit docs (https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/index.html)
  - my T-board kit: 1 ribbon, 1 T-board, 1 830-point breadboard, 10 male–female and 10 male–male Dupont leads, all 200 mm
- The kit's component list is an image. Transcribe it with vision into content/inventory.json.
- Quantities are optional. The seed records no lead counts, so leads are unlimited unless I set a count. "Inventory respected" in the evals checks part types and lead kinds, not lead counts.
- The assistant prefers inventory parts and asks before using others.

Custom parts:
- The assistant or I can create a PartDef from templates: 2-lead, TO-92, DIP-N, SIP header module, or off-board module with header.
- Choose the sim model from the supported set, or 'none'.
- The assistant must find and cite the datasheet, using the web tools (section 12).
- A part saved without a datasheet source shows a "no datasheet" tag, and ERC treats its pin roles as hints.
- 3D for a custom part:
  - a template family with datasheet dimensions
  - a manufacturer STEP through the pipeline
  - otherwise, a clearly labeled generic body

────────────────────────────────────────
8. NETLIST AND ERC (core/netlist, core/erc, core/reach)
────────────────────────────────────────
Netlist: union-find over:
- (a) breadboard strips
- (b) rail segments
- (c) wires
- (d) part internal connections
- (e) T-board ↔ Pi pin identity through the straight-through ribbon. All GND pins form one net, all 3V3 pins one net, and all 5V pins one net.

Connectivity engine (core/netlist/engine.ts; the twin half of Board Sense, 14.5):
- It keeps a live state for:
  - every hole: empty, occupied (by part pin, T-board pin, or lead end, with the occupant), or blocked (under a body)
  - every strip and rail segment: its net
- Every committed transaction, undo, redo, and ghost preview produces a diff of typed events:
  - HoleOccupied and HoleVacated, carrying the hole and the occupant
  - StripJoined, carrying the strip and the net
  - NetsMerged and NetSplit
  - PartPlaced and LeadRouted
  - ReachChanged
- Ghost previews produce provisional events. Commits produce final ones. A rejected transaction produces none.
- Consumers subscribe to the diff stream, not to the whole document:
  - hover and strip highlights
  - incremental ERC
  - sim invalidation
  - Build Mode step tracking
  - Board Sense's expected signatures
  - the assistant (get_circuit_state can return "changes since")
- Performance: computing a diff, including a full net recompute when a removal splits a net, takes at most 1 ms on a full bb-830 scene. This is measured in tests.

Every ERC rule has:
- a code
- a severity: error, warning, or info
- the involved refs
- a plain-language explanation and a fix hint
- positive and negative fixtures

Rules:
- SHORT_SUPPLY: 3V3 or 5V joined to GND, or 3V3 joined to 5V.
- GPIO_TO_SUPPLY_DIRECT: a GPIO used or configured as an output that sits directly on a supply or GND net.
- OVERVOLTAGE_GPIO: a GPIO net reachable from 5V without a limiting or divider path. This includes I2C modules whose pull-ups go to 5V; warn, explain, and give the fix.
- LED_NO_LIMIT: an LED path with no series resistance. Confirm it with the sim current.
- LED_REVERSED: an LED reverse-biased relative to its intended drive.
- COMPONENT_SHORTED: both leads of a two-lead part in the same strip or net.
- FLOATING_INPUT: a GPIO input with no external pull and no internal pull in the code.
- PIN_OVERCURRENT and RAIL_BUDGET: sim currents above the documented limits in constants.
- INDUCTIVE_NO_DRIVER: a motor, relay coil, or buzzer driven directly from a GPIO, or a bare coil without a flyback diode.
- BJT_NO_BASE_RESISTOR.
- DANGLING: a lead or wire end in a strip with no other connection, and any unplaced pins.
- RAIL_UNPOWERED: a rail that parts use but that isn't tied to a supply or GND.
- CODE_PIN_MISMATCH: code that uses unwired GPIOs, or wired GPIOs that the code never configures.
- PHYSICAL_COLLISION: overlapping part bodies.
- LEAD_TOO_SHORT (warning): a lead's endpoints, or the ribbon's two sockets, are farther apart than its length allows.
  - The check accounts for the housings and a minimum bend at each end.
  - It is computed from geometry in core/reach, not from physics.
- PART_WITHOUT_DATASHEET: info.

────────────────────────────────────────
9. SIMULATION (core/sim, run in workers/sim.worker.ts)
────────────────────────────────────────
Solver:
- Modified Nodal Analysis with dense LU.
- DC operating point and transient, using backward Euler and trapezoidal companion models.
- Newton–Raphson with junction voltage limiting, damping, and a gmin-stepping fallback.
- Non-convergence is a visible sim error, never a silent fallback.

Models:
- resistor
- voltage sources: rails, and GPIO outputs whose output resistance comes from the documented drive strength
- switch (Ron/Roff)
- Shockley diode and LED with series R, using per-color parameters fitted to the datasheet Vf at the rated If
- BJT at Ebers–Moll level, with the datasheet β
- capacitor
- coil (R+L)
- DC motor: R+L plus back-EMF proportional to speed
- potentiometer
- LDR, and NTC (Beta or Steinhart–Hart from the datasheet)
- active buzzer as a datasheet current sink; passive buzzer as a coil

Mixed-mode behavioral ICs. Digital events step state machines, and analog solves run between events:
- 74HC595: shift and latch
- L293D: logic inputs drive bridge outputs from VCC2
- ADC0834: its serial protocol
- relay module: a coil threshold with hysteresis switches the contacts
- 7-segment, dot matrix, and bar graph: LED arrays
- DHT11, HC-SR04, HC-SR501: protocol and behavior models, driven by environment props
- SG90 servo: the PWM pulse width sets a target angle, reached at the datasheet slew rate, with the datasheet supply current
- LCD1602 with an I2C backpack: the PCF8574 expander drives an HD44780 state machine in 4-bit mode. Its display RAM feeds the screen texture (10.6).
- ADS1115: an I2C register model with PGA ranges and data rates
- 4×4 membrane keypad: a switch matrix
- analog joystick: two potentiometers plus a switch, driven by environment props

PWM:
- Average-value brightness drives the real-time display.
- An optional slow-motion scope shows the instantaneous waveforms on any net.

Stimulus comes from any of:
- manual toggles
- inputs: switches, sliders, and environment props
- Pyodide code
- live telemetry, for the twin comparison

Probe-signature mode (for Board Sense, 14.5):
- It models each GPIO as an input with a selectable bias: pull-up, pull-down, or none (true high impedance).
- Neither the RP1 peripherals datasheet nor the Pi docs give the pull resistance or the input thresholds. Checked on 2026-10-24: the datasheet gives only the PUE, PDE, and SCHMITT bits and the drive settings. So:
  - The threshold band is JESD8C.01's 3.3 V levels: LOW at or below 0.8 V, HIGH at or above 2.0 V. Anything in between is ambiguous.
  - The pull resistance is a range, chosen and recorded by ADR, and carried through every prediction.
  - A bench calibration fixture (18) narrows the effective pull-to-threshold ratio on my Pi, once I run it.
- It includes the Pi board's own fixed pull-ups on GPIO2/3, with values from the official Pi documentation (verify them).
- Pair-test predictions are transients that start from the precharge state, with a node-capacitance range. An isolated net holds its precharge.
  - Never use a DC solve here: gmin would pull an isolated node to 0 V, and every precharged-high pin would show a false divergence.
- For each probe configuration, it predicts every probed GPIO's reading: LOW, HIGH, or ambiguous. Board Sense compares those predictions with what the Pi actually reads.

Validation:
- Fixtures: a divider, LED + resistor for each color, an RC step, a BJT switch, and button + pull-down.
- Each must match ngspice within ±2%.
- ngspice comes from Homebrew and runs in the reference script. Commit the reference outputs.

────────────────────────────────────────
10. 3D STUDIO: REAL TIME, CINEMATIC, PHYSICAL (studio/, physics/)
────────────────────────────────────────
10.1 Target
- The reference video's interaction model, at a higher visual standard.
- The scene is always live. There are no pre-rendered stills or videos anywhere in the product.
- "Cinematic" means real-time rendering quality:
  - physically based materials, authored and baked in Blender
  - image-based lighting and soft shadows
  - ambient occlusion
  - bloom on lit LEDs
  - temporal anti-aliasing
  - smooth, eased camera motion
- Two looks, one switch apart (10.7), each a complete preset of stage, lights, environment, fog,
  tone mapping, grade and finish:
  - Lab, the default: the bench in a furnished electronics workroom at dusk, after the exhibit
    house style. A warm key light, cool fog and ambient light, a procedural dusk environment, a
    saturation lift then ACES Filmic, a faint film grain, a vignette, and depth of field that
    keeps the bench sharp while the room melts. The lit circuit is the brightest thing in the
    frame.
  - Studio: a neutral studio, tone-mapped with AgX and graded after it (ADR-0067), with no grain
    and no vignette. It is the look checked against the photos:
    - my reference photos (2.2), for the T-board, ribbon, IDC sockets, breadboard, and Dupont leads
    - official imagery, for the Pi 5
- No chromatic aberration or lens dirt in either look.

10.2 Renderer and frame loop
Renderer:
- three.js WebGPURenderer with TSL node materials, through @react-three/fiber's async renderer factory. Never use the legacy WebGLRenderer.
- At startup, log the active backend and show it in a dev overlay: WebGPU, or WebGPURenderer's WebGL2 fallback.
  - On my Mac the backend must be WebGPU, unless the Tauri webview doesn't expose navigator.gpu.
  - If it doesn't, demonstrate that and document it.
- Verify rendering in the real Tauri window (WKWebView), not only in Chromium.
- Don't use drei helpers that depend on a GLSL ShaderMaterial. Write TSL equivalents.

Post-processing:
- Use three.js's node pipeline, RenderPipeline. It was called PostProcessing before r183.
- Effects:
  - a scene pass with MRT (output, normals, and velocity as needed)
  - GTAO
  - TRAA
  - bloom of whatever passes 2 in scene-linear light, in both looks, drawn only while something
    passes it (ADR-0129)
  - each look's tone mapping and grade, in the pipeline's last pass: RenderPipeline draws without
    the renderer's tone mapping
  - film grain, in the Lab look
  - depth of field in the Lab look: a depth-aware bokeh focused on the bench, the far blur
    stronger than the near, which keeps sharp edges out of the blurred background
  - depth of field for focus in Build Mode: the Lab look's bokeh narrowed to the step, and in
    the Studio look three's depth of field
- Verify every class name and import path against the installed three.js version (section 22).

Stage:
- Scene units are millimetres, with Y up.
- Studio look: a neutral studio stage, a matte table surface plus a soft cyclorama, lit by a CC0
  studio HDRI (Poly Haven or similar; record the license) and one shadow-casting key light.
- Lab look: the same table as a walnut bench top on a bench frame, under a matte slate ESD mat (457
  x 381 mm, 2 mm thick, a grid printed every 10 and 50 mm, a ground snap and its cord) whose top is
  the table plane, so the table sits 2 mm lower while it shows; in "a Pi breadboard bench in an
  electronics workroom at dusk", lit by the same key light, warmer, with a cool hemisphere light,
  a rim light from behind the bench, a procedural dusk environment and a lavender fog.
  - The room: the floor 900 mm below the tabletop, inside x ±2400 mm and z -1700 to +2600 mm, the
    ceiling 1900 mm above the tabletop. Every side is finished and furnished: the dusk window
    between amber light bars with a faint backlit GPIO pinout beside it, a credenza and a plant
    (north); a pegboard of tools and wire spools over a wall bench lit from under its top, with a
    desk lamp, an oscilloscope and a power supply (west); a parts-drawer cabinet, a shelf lit from
    below and a soldering station (east); the door with a sconce beside it and a stool (south);
    two dim pendants (ceiling); the bench's legs, apron and lower shelf.
  - At most 18 meshes and 60k triangles; nothing in it casts or takes a shadow.
  - Its practical lamps and screens are drawn at most 1.5 in linear light and glow through
    additive cards, so nothing on the set passes the bloom's threshold.
- Looks switch by changing values only, so no shader recompiles once both have been drawn: one
  fog, one background colour, one environment target rendered again in place, every light kept
  in the scene (at 0 where a look does not use it), and one output graph that picks a look by a
  uniform. The switch happens under a veil, instantly under reduced motion.

Frame loop:
- Render on demand.
- Render continuously only while something moves: the camera, a drag, an awake physics island, or a sim-driven animation.
- When everything sleeps, render up to 16 more frames so TRAA converges, then stop. After that, no frames render.
- The camera has no idle drift in either look, and a look switch settles like any other change.

10.3 Asset pipeline (scripts/assets/)
Commands:
- npm run assets:build rebuilds every shipped asset.
- npm run assets:check verifies them.

Stages:
1. Sources.
   - scripts/assets/sources.json pins every downloaded input with its URL, SHA-256, retrieval date, and license or terms.
   - Download, verify, and cache the inputs outside git.
2. STEP.
   - step-to-glb.ts reads a STEP file with occt-import-js and writes an intermediate GLB that keeps the STEP colors.
   - It covers the Pi 5, and any manufacturer STEP for modules.
3. Blender. For each asset, run Blender headless:
     "$BLENDER_BIN" -b --factory-startup --python-exit-code 1 -P scripts/assets/blender/<asset>.py -- <args>
   - Flags:
     - --factory-startup ignores my user preferences and startup file.
     - --python-exit-code 1 makes any script error fail the build.
     - Arguments after -- reach the script through sys.argv.
   - The scripts read geometry from the same data files the app uses:
     - content/boards/*.board.json
     - content/controllers/tboard.json
     - content/parts/*.part.json
     - content/leads/*.json
     So the modeled holes and pins coincide with the logical holes and pins by construction.
   - The scripts model, assign Principled BSDF materials, UV-unwrap, bake, build LODs where needed, and export glTF Binary.
   - Baking uses Cycles with fixed samples and a fixed seed:
     - Ambient occlusion goes into the glTF occlusion slot. The exporter writes occlusion only through a custom node group named "glTF Material Output" that has an Occlusion input.
     - Tangent-space normal maps (Tangent, +X/+Y/+Z) are baked from high-poly detail: molded hole recesses, IDC ridges, solder-mask traces, and the ribbon's conductor ridges.
   - Materials must survive glTF export, so use only what the exporter supports:
     - core metal/rough
     - clearcoat
     - transmission + volume + IOR
     - specular
     - sheen
     - emissive strength
     - texture transform
   - Real-time transmission is expensive. Use it only where you can see it (LED lenses), and check it in the Tauri window.
   - Cycles is only a baker here. It never renders stills or videos for the product.
4. Optimize, with gltf-transform:
   - dedupe, weld, and prune
   - meshopt compression
   - KTX2 textures: UASTC for normal and ORM maps, ETC1S for color, resized to budget
   - If the KTX2 tooling is unavailable, fall back to WebP and record an ADR.
5. Write the outputs to src/renderer/public/models/:
   - <name>.glb
   - <name>.manifest.json, recording:
     - sources and hashes
     - the Blender version
     - the script hash and parameters
     - the triangle count and texture budgets met
   - <name>.colliders.json: simplified boxes and capsules for physics, exported from Blender

Rules:
- Commit the scripts, sources.json, GLBs, manifests, and collider files.
- Never commit generated .blend files or cached downloads.
- A small look-dev material library may live in docs/v2/lookdev/ as a .blend file, if it stays under 20 MB and the scripts load from it.
- Rebuilds are reproducible:
  - geometry hashes match exactly
  - baked textures match within SSIM ≥ 0.99, because GPU baking isn't bit-exact
- Pin the Blender version in the manifests. Scripts fail on a different major.minor version unless passed --allow-version-drift.
- Commit regenerated GLBs at milestone boundaries, or when they change materially. This keeps git history small.

Blender MCP (optional):
- Use it to explore looks interactively in a live Blender session.
- Port everything you keep into the scripts, and prove it with a clean headless rebuild.
- Never use its downloaders for generated or third-party models (Hyper3D, Sketchfab, and similar).
- CC0 HDRIs and textures (Poly Haven) are fine, with the license recorded.

10.4 Assets
Breadboards (bb-830, bb-400), modeled in Blender:
- body with chamfers
- molded square hole recesses, as real geometry
- the centre trench and the rail channels
- the printed legend, generated from data into a texture: row numbers every 5 rows, letters a–j, red and blue rail lines, + and −
- a glimpse of the nickel contact at the bottom of each hole
- white ABS with a slightly translucent look

Pi 5:
- Pipeline: official STEP → occt-import-js → Blender → GLB.
- In Blender:
  - materials per STEP color group
  - clearcoat on the solder mask
  - metals and plastics
  - bake and LOD
- Budget: at most 200k triangles and at most 8 MB.
- Hide the STEP's own header pins. Render the 40 pins as instanced, addressable pins at the drawing's coordinates, for highlighting and live state.

T-board, modeled in Blender from tboard.json:
- red solder mask with clearcoat and trace relief
- white silkscreen labels from the pin table
- tinned plated holes and the two mounting holes
- the grey shrouded box header with its key slot
- the male pin strips with yellow spacers
- matched to the reference photos

IDC sockets, modeled in Blender: grey, with the pin-1 triangle, polarization bump, and strain relief.

Ribbon:
- Generated at runtime along the simulated strip (10.5).
- Blender bakes its cross-section detail: a tileable normal map for the 40 conductor ridges, and a 40-texel color lookup in the standard sequence.

Dupont leads:
- Blender models the male and female housings and the pins. They are instanced at runtime.
- The wire is a runtime tube along the simulated rod.

Solid jumpers: runtime tubes with a solid-core insulation material.

Parts:
- One Blender family script per footprint family, parameterized by the datasheet dimensions in the part defs. Families:
  - axial resistor
  - LED, 3 mm and 5 mm
  - tact switch
  - TO-92
  - DIP-N
  - ceramic and electrolytic capacitors
  - potentiometer, LDR, NTC
  - buzzers
  - 7-segment, bar graph, dot matrix
  - modules
- Value-dependent detail stays dynamic in TSL:
  - resistor color bands, from the value
  - LED emission, from current
  - segment and matrix emission, from state
- Leads are generated at runtime and bend deterministically from body to hole, at the real lead diameter.
- A family may stay runtime-procedural only if a Blender version adds no visible fidelity at close range. Record that decision per family in DECISIONS.md.

Off-board modules, in order of preference:
- the manufacturer's official STEP, through stages 2–5
- Blender-modeled from the datasheet drawing
- a CC0 model
No unlicensed models.

10.5 Real-time physics (physics/, workers/physics.worker.ts)
Method:
- Extended position-based dynamics (XPBD) with small steps: each frame is split into n substeps, with one constraint iteration per substep (Macklin et al. 2019; section 22).
- Units: mm, g, s. Gravity is 9810 mm/s².
- Fixed timestep: a 1/60 s frame with 12 substeps by default (tune this).
- Seeded, and deterministic for the same inputs in the same runtime.

Bodies:
- Ribbon: a particle grid, about 5 mm apart along its length and 5–9 columns across.
  - Stretch and shear constraints keep it inextensible and rigid in its own plane; a ribbon can't curve sideways.
  - Bending is soft out of plane along its length, and stiff across its width.
  - Long-range attachments prevent stretching.
  - The first and last ≈6 mm are clamped in the socket frames. The sockets follow the Pi header and the T-board header rigidly.
- Dupont leads: rods with particles about 3 mm apart.
  - Stretch constraints keep each lead at its length; it doesn't stretch.
  - Bending constraints are tuned against the photos.
  - The housings are clamped end frames, aligned with their hole or header pin. A plugged-in male housing stands vertical, so leads leave the board upward and arc naturally.
- Solid jumpers: rods whose rest shape is the authored bend. They hold their shape, and deflect only elastically when pushed. Flat jumpers are static.
- Part leads and part bodies are not simulated. Part bodies are colliders.

Contacts:
- Particles collide with static and kinematic colliders, all taken from the *.colliders.json proxies:
  - the table
  - board bodies
  - the Pi
  - the T-board
  - IDC sockets and Dupont housings
  - part bodies
- Leads collide with other leads and with the ribbon. Use capsule–capsule and point–triangle tests in a spatial hash.
- Position-based friction applies against surfaces.
- Tolerance: no visible penetration, and at most 0.5 mm in the test scenes.

Behavior:
- Kinematic anchors come from the doc plus the live drag.
  - Dragging the Pi, a board, the T-board, a module, or a wire end moves its anchors every frame.
  - The attached cables follow, swing, drape over parts, and slide off parts that move.
  - A lead resting on a part reacts when that part is dragged away.
- Lead length:
  - A Dupont lead has a real length (lengthMm). The inventory default is 200 mm.
  - 'auto' picks the shortest inventory length that reaches with some slack.
  - Over-span: the ends are clamped and LEAD_TOO_SHORT is only a warning, so a doc can hold a lead or ribbon whose ends are farther apart than its length allows.
    - Its stretch constraints then relax, so it renders as a straight, taut, red-tinted span between its end frames.
    - LEAD_TOO_SHORT (section 8) explains why.
    - The flagged lead is exempt from the stretch tolerance until it is back in span.
- Route hints: dragging a lead mid-span sets a soft target point, stored in the doc through SetWireProps.routeHints (at most 3 per lead). A reopened project then looks the same.
- On open: settle offscreen from a design-curve initial guess until asleep (at most 1 s), then show the settled scene.
- Sleep: an island sleeps when every particle stays below 0.5 mm/s for 30 frames. Any anchor change wakes it.
- Assistant ghosts are non-simulated design curves. On commit, a lead becomes physical and drops into place.
- Isolation: physics reads anchors and colliders, and writes only render buffers. It never touches the doc, the netlist, ERC, or the sim.

Rendering:
- Leads are tubes with parallel-transport frames (no twist pops), smoothed between particles.
- The ribbon is a strip mesh using the baked ridge normal map and color lookup.
- Build the geometry one of two ways: on the CPU each frame, or in a TSL vertex stage that reads particle positions from a storage buffer. Measure both, choose one, and record an ADR.

10.6 Animated parts (driven by sim state, not physics)
- tact switch: plunger travel when pressed, by click or by stimulus
- potentiometer: shaft angle from the wiper %
- servo: horn angle from the PWM pulse width, using the datasheet mapping
- DC motor and fan blade: angular velocity from the motor model
- relay module: the armature and its indicator LED
- LEDs, 7-segment, dot matrix, bar graph: emission from current or state, with bloom
- LCD1602: characters from the HD44780 model, drawn into its screen texture
- placement: parts seat into holes with a short eased insertion (about 150 ms), and leads plug in the same way

10.7 Interaction and camera
Picking:
- Holes: intersect the ray with the board plane, then take the nearest hole within tolerance.
- Parts: by bounding volume.
- Leads: by capsule.
Selection shows an accent-colored wireframe box.

Looks:
- The right column's first row, View, switches between the Lab and Studio looks; the key L does
  too. The choice is a preference of the machine, not part of a project.
- The camera orbits at most 2200 mm from its target in the Lab look and 3000 mm in the Studio look.
- In the Lab look the camera stays inside the room: a view farther than the room allows is
  shortened along its line to the target, 150 mm inside the walls, floor and ceiling, and the
  target keeps 200 mm further in, so the camera's least distance always fits; the front (south) is
  open. The side the camera stands within 900 mm of, or behind, is cut away with its
  furniture, and so is the ceiling. Every preset of every tutorial stands inside the room.

Opening tour:
- The first time the Studio opens in a launch, in the Lab look and on a bench, the camera takes
  three slow shots: the bench small in its room, low along the bench from the Pi to the
  breadboard, and close on the brightest lit part (else the T-board), the veil dipping to black
  at each cut; then it eases to the iso preset, about 16 s in all. Each shot turns 1.6 to 3
  degrees a second, and every pose stands inside the room.
- While it plays the side panels slide away and the stage takes their room, and one line under
  the stage says "Drag, click or press a key to take over". The first press or wheel
  turn on the stage only takes over: the camera eases home from where it is. A key ends it and
  still does what it does. A look switch, an edit, a capture, entering Build Mode or any other
  move of the camera ends it too; a document opened under it plans it again for the new bench.
- It does not start under test automation, with reduced motion asked for, in Build Mode or
  during an assistant's turn, or once turned off: View's Opening tour button keeps that choice on
  the machine. C plays it at any time. It counts as motion: frames are drawn while it plays and
  none once it ends.

Camera:
- A damped orbit, with a 35° vertical field of view in both looks.
- Presets animate with easing, in at most 600 ms.
- Build Mode frames each step, and may use depth of field to focus.

10.8 Budgets
- Frame rate: at least 60 fps at the window's native pixel ratio, in the Tauri window on my M-series Mac, in both looks. This holds for tutorial scenes with physics awake and the full post stack, LEDs lit.
  - Lab look: the GPU at most 13 ms a frame, median, at a pixel ratio of 2 with LEDs lit.
  - If a scene misses it, scale effect quality first and record what changed. In the Lab look: the bokeh's taps from 48 to 32, then no depth of field while cables are awake. GTAO keeps one resolution in both looks, since a resolution per look would reallocate its targets on every switch. GTAO runs at 0.35 and the bokeh at 32 taps.
- The Lab look's room: at most 18 meshes and 60k triangles, built once, the first time the look shows.
- Physics: at most 4 ms per frame in the worker, for the heaviest tutorial scene (about 40 leads plus the ribbon).
- Idle: zero frames rendered when the scene is static.
- Assets:
  - Pi 5: at most 200k triangles and at most 8 MB
  - all of src/renderer/public/models: at most 40 MB
  - textures in KTX2
- Instance repeated meshes, and dispose of resources on unmount.

────────────────────────────────────────
11. PRODUCT BEHAVIOR
────────────────────────────────────────
11.1 Pages
- Workbench (interim, M3–M6):
  - a project or tutorial picker
  - generated wiring tables and build steps
  - the ERC, Sim/Probes, Code, and Board panels
  - It lets me use and check the verified content before the 3D Studio exists. Its panels become the Studio's drawer in M7.
- Studio (new, M7): replaces the Breadboard page.
- Tutorials: rebuilt around circuit documents and Build Mode.
- Connect, Pinout, and Monitor: kept.
- The terminal drawer is kept (Cmd+`).
- The app's bar (the brand, the page tabs, and the connection status away from the Studio) stays
  one row at every width the window allows: below 1100 px the tabs show their icons alone,
  keeping their names for assistive technology and a tooltip.

11.2 Studio layout
- Top bar: an editable project name and menu, Simulate, Run on Pi, Undo/Redo, and the connection pill.
  - It stays one row at every width the window allows. In a narrower window the project name gives up width first; below 1280 px Wire, Build and Fork show their icons alone, and below 1100 px Simulate, Run on Pi and their Stops do too, and the pill shows its dot alone. Stop on Pi shows the Pi's chip, so it reads apart from the simulation's Stop. Each keeps its name for screen readers.
- Left: the Part Library, with search, categories, an "In my inventory" filter, kit tags, and "Create custom part…", which hands off to Claude.
- Center: the 3D stage.
  - Over its top left, a title column: the project's name, three readouts (GPIO draw, the busiest pin's current, and the checks) and one sentence on what the bench is doing. They read the snapshot the bench shows: the Pi's while Live Pi state follows it, else the simulation's, and none while a build is part of the way. A total over 50 mA or a pin over 16 mA turns its readout coral. The sentence names things and changes only with the bench's state, so a screen reader hears it once. The column takes no clicks but for Claude's note under it, and folds the sentence, then the name, away as the stage shrinks.
- Right:
  - contextual Properties
  - Inspect toggles: Labels, Voltages, Current flow, Nets, Live Pi state
  - camera presets: Fit, Iso, Top, Front
  - rotate selection ±90°
- Each side panel folds from the top bar or with `[` and `]`, and `\` folds or shows both. A
  panel slides over the stage's edge as the stage eases into its room over 280 ms. The canvas
  resizes once a fold, and the picture stays centred in what is visible throughout.
- Bottom drawer tabs: Claude, Code, ERC, Sim/Probes, Build Steps, Board (Board Sense, 14.5).
- Keys: Delete, R (rotate), Esc, Cmd+Z / Cmd+Shift+Z, W (wire tool), F (fit), 1–4 (camera presets).

11.3 Placing, wiring, and moving by hand
- Dragging from the library shows a ghost snapped to the grid. Legal footprint holes glow green and illegal ones glow coral. Dropping commits, and the part seats with its insertion animation.
  - A rigid part snaps to the hole nearest the pointer from which it fits, across the trench if it must straddle it. It stays where pin 1 points when it fits there.
  - A part that fits but may not go there (another part's holes, under the T-board) is drawn there ringed in red, and dropping it places nothing.
- Hovering a hole highlights its whole strip or rail segment, plus every lead and wire on its net, with a tooltip such as "Row 23 · column e · net GPIO17".
  - This is the most important feature for breadboard literacy. Make it instant.
- Wire tool: click a hole, then another hole (or a module header pin).
  - The new lead is the default kind from my inventory: a male–male Dupont with length 'auto'.
  - It drops in and settles.
- Wire properties:
  - kind: Dupont M–M, M–F, F–F, solid arc, or solid flat
  - color, with suggested conventions: red for 3V3/5V, black for GND
  - length, for Dupont leads
  - height, for solid arcs
- Wire ends are draggable. Dragging a lead mid-span sets a route hint.
- Moving things is live:
  - Dragging a board carries everything plugged into it. A board or the Pi stops against what it would overlap.
  - Dragging the Pi or the T-board re-drapes the ribbon.
  - Dragging a module drags its leads.
  - All cables follow and collide in real time, then settle.
- Flexible two-lead parts are placed by anchor plus span, and their legs bend to reach.
- Off-board modules sit beside the board. They connect to breadboard holes with leads that mate with their connectors (6.5), never to the Pi.
- The wire tool offers only the holes that the wiring convention and the collision rules allow.

11.4 Properties (schema-driven)
- Resistor: an E12/E24 value picker with the exact 4-band colors rendered (5-band optional), plus tolerance.
- LED: color, which sets the Vf model and the lens, and size.
- Switch: momentary or retain-press.
- Potentiometer, LDR, NTC, DHT11, HC-SR04, and PIR get environment sliders: wiper %, lux, °C, %RH, distance, motion.
- Wire: as in 11.3.
- T-board: column pair, start row, orientation.

11.5 Inspect and simulate
- Labels: pin tags such as "Anode (+)", "Cathode (−)", "E B C", "VCC DATA GND", and the T-board names, plus row and column guides.
- Voltages: per-net tags.
- Current flow: animated dashes along wires (a TSL UV offset). Speed is proportional to current, and direction follows conventional current.
- LEDs glow with brightness derived from their current.
- A part over its rating shows a warning halo, linked to its ERC issue.
- During Simulate I can:
  - click switches
  - drag sliders
  - toggle GPIOs from the T-board pin context menu, when no code is running
- Animated parts respond as in 10.6.
- Board Sense overlay: each net is tinted by its Board Sense state (14.5): matched, diverged, unobserved, or ambiguous. A diverged net shows its ranked candidate causes.

11.6 Code
- CodeMirror is bound to the project.
- The code's GPIO usage is cross-checked live against the netlist, with squiggles plus CODE_PIN_MISMATCH.
- Run in Sim uses Pyodide (13.2).
- Run on Pi uses the existing SSH upload-and-run path (14.3). ERC errors block it unless I confirm an override dialog that lists them.

11.7 Build Mode
- Ordered steps are generated from the doc: T-board → power rails → passives → semiconductors and ICs → signal wires → ground wires, respecting dependencies.
- Each step:
  - auto-frames the camera, with optional depth of field on the target
  - shows a pulsing ghost at the exact holes
  - has generated text, e.g. "Insert the 220 Ω resistor (red, red, brown, gold) from row 25 column c to row 26 column c", or "Use a 20 cm male–male jumper from row 6 column a to row 25 column a"
  - has a "why" note and a common-mistake callout
  - may have a hardware checkpoint (14.4)
- With Board Sense on, each step that changes an observable net (14.5) confirms itself as soon as the expected change is sensed.
  - If the sensed change differs, the step shows the divergence and the candidate causes.
  - A step whose nets aren't observable (LED paths, for example) falls back to my "Done" click or a checkpoint, and is labeled "not electrically verifiable".
- Progress persists per project.

11.8 Claude drawer
- Chat with streamed text, tool chips, and compact result cards (ERC, sim tables).
- Each assistant turn is one undo group, with a review strip: "Claude added 9 parts, 14 wires · Keep · Undo all".
- Changed items stay tinted until kept.
- While the assistant runs:
  - the canvas is read-only, with a visible Stop
  - Stop aborts the request
  - committed ops stay, and remain undoable

11.9 Projects
- .gpiob files live in the app data directory, with a gallery.
- Save As and Open use native dialogs, through the existing dialog plugin called from Rust.
- Tutorials are read-only templates with "Fork to my projects".
- The assistant's transcript is saved next to the project.

────────────────────────────────────────
12. CLAUDE AGENT (assistant/ + src-tauri/src/anthropic.rs)
────────────────────────────────────────
Verify each API point against platform.claude.com/docs during implementation.

12.1 Transport
@anthropic-ai/sdk v1.x:
- sends anthropic-version 2026-10-21
- sends the key as Authorization: Bearer
- must not send the sampling parameters temperature, top_p, or top_k, which this API version removes

Construct the client with:
- apiKey: a placeholder string
- dangerouslyAllowBrowser: true
- fetch: nativeAnthropicFetch

nativeAnthropicFetch:
- Serializes the request and calls the Rust command anthropic_request(req, channel).
- Returns a web Response:
  - its status and headers come from the first Channel message
  - its body is a ReadableStream fed by the byte-chunk messages
- On AbortSignal, calls anthropic_abort(id).

anthropic_request (Rust, reqwest):
- Gets the key through a key-provider seam. In the app, the provider reads the Keychain. Tests inject one.
- Allows only:
  - POST /v1/messages
  - POST /v1/messages/count_tokens
  - GET /v1/models
- Removes any authorization or x-api-key header that comes from the webview.
- Sets Authorization: Bearer <key> from the Keychain entry anthropic.apiKey.
- Forwards anthropic-version, anthropic-beta, and content-type unchanged.
- Streams bytes back without buffering.
- Maps errors to {code, message}.

Keys and settings:
- The key is stored through the settings.rs helpers under the Keychain service com.gpio-dashboard, entry anthropic.apiKey.
- Leave the legacy OpenRouter entry (ai.apiKey) untouched, and never read it.

12.2 Models and settings
Settings keys:
- assistant.model
- assistant.effort
- assistant.webTools

Add them to SETTINGS_ALLOWLIST. Replace the ai.model and ai.thinkingLevel defaults in settings.rs.

Model picker:
- claude-opus-5-5 (default)
- claude-sonnet-5-5 (fast edits)
- claude-haiku-5-5 (explanations)
- claude-fable-5-1 (hardest builds)
- a free-text model ID

Effort: output_config.effort, one of low | medium | high | xhigh | max. Default to high for builds and medium for explanations.

Opus 5.5 always has adaptive thinking on, so never send thinking: disabled.

max_tokens: 64k, because thinking counts toward it.

Show token usage and estimated cost per turn in a subtle footer. Keep prices in an editable constants file.

12.3 Loop
- Messages API with streaming and a manual tool loop.
- Preserve every assistant content block exactly as received, including thinking blocks and server-tool blocks with encrypted_content.
- Handle every stop_reason: tool_use, end_turn, max_tokens, pause_turn, refusal.
- Prompt caching: cache the system prompt, the tools, and the part catalog summary.
- Server tools are on by default, controlled by assistant.webTools: web_search_20260318 and web_fetch_20260318, with sensible max_uses, for datasheet lookups. Read the server-tools docs for:
  - allowed_callers
  - mixing server and client tool calls in one turn
- Iteration guard: a soft cap of 60 tool calls per turn. At the cap, summarize and ask whether to continue.

12.4 Tool definitions
- Generate the schemas from zod in assistant/tools. The same definitions validate input at runtime.
- Set strict: true on every client tool:
  - additionalProperties: false
  - stay within the supported JSON Schema subset
- Set eager_input_streaming: true on the mutation tools, so ghosts appear before the input completes.
- If the API rejects strict and eager together on a tool:
  - keep strict and drop eager on that tool
  - record the decision in docs/v2/DECISIONS.md
- Fine-grained streaming can yield invalid JSON:
  - accumulate the deltas and guard the parse
  - on failure, return a tool_result with is_error: true and content {"INVALID_JSON": "<raw>"}, built with JSON.stringify

12.5 Tools
- get_circuit_state {detail: 'summary' | 'full', since?: revision} → compact text plus JSON. With since, it returns only the connectivity-engine changes after that revision. It covers:
  - boards and free regions
  - the T-board placement
  - parts, with pin → hole → net
  - wires (kind, length, ends) and nets
  - the ERC summary
  - the code's pin usage
- search_parts {query} → PartDefs, with inventory status and a pinout summary.
- define_custom_part {template, name, pins[], internalConnections, simModel, datasheetUrl?} → a PartDef.
- add_board {defId, position?} → a board.
- place_tboard {board, pin1Row, colPair, orientation} → the 40 pin → hole map.
- place_part {defId, ref?, props, at: {board, row, col} | 'auto', orientation, span?} → the pin → hole map, plus warnings.
  - 'auto' uses the deterministic placer.
  - The placer prefers free strips near related nets, and keeps the trench rule.
- move_part {ref, at, orientation}
- remove_part {ref}
- set_part_props {ref, props}
- connect {from: EndpointSpec, to: EndpointSpec, kind?, color?, lengthMm?}
  - EndpointSpec = {hole} | {partPin: {ref, pin}} | {net: 'GND' | '3V3' | '5V' | 'GPIOnn'}
  - The engine picks concrete free holes and returns the concrete wire, including the resolved length.
- set_wire_props {id, kind?, color?, lengthMm?, heightMm?}
- remove_wire {id}
- run_erc {} → issues.
- simulate {stimulus?, mode: 'op' | 'transient', durationMs?}
  - stimulus = {gpio?: {GPIOnn: 'high' | 'low' | {pwm: {freqHz, duty}}}, inputs?: {SW1: 'pressed'}, env?: {...}}
  - returns per-part currents, voltages, and power; LED brightness; warnings.
- write_code {library, source} → a pin cross-check against the netlist, plus a syntax check (Pyodide compile). It never runs anything on hardware.
- run_code_in_sim {seconds} → a pin event trace and stdout.
- capture_view {preset: 'top' | 'iso'} → a PNG of the 3D stage, as an image block, for visual layout checks. It waits for physics to sleep (at most 2 s) before capturing.
- read_board_sense {} → the latest Board Sense state (14.5), read-only:
  - per-net states, divergences, and ranked candidate causes
  - "unobserved" nets
  - whether sensing is on
- focus {refs[], note?} and highlight {refs[], note} → camera and teaching cues.
- annotate_build_steps {annotations[]} → why/mistake text for the generated steps.
- ask_user {question, options[]} → blocks until I answer in the chat.

12.6 Streaming previews
- On tool_use start, show a chip ("Placing R1…").
- As the partial input parses, render non-committing ghosts:
  - a part at its anchor
  - a wire, as a design curve, once both endpoints parse
  - Use the SDK's partial-JSON snapshot if it provides one. Otherwise use a tolerant partial parser.
- Commit only complete, validated input. On commit, a ghost becomes the real object; leads become physical and settle.
- Clear ghosts on error or abort.

12.7 Assistant rules (assistant/system-prompt.md)
- Call get_circuit_state before editing an existing project.
- After each batch of mutations, run_erc and then simulate. Iterate until there are no errors, or until it needs a decision from me.
- Never claim a circuit is correct, safe, or will work unless the latest ERC and sim results support it. Quote the numbers.
- Prefer inventory parts and lead kinds, and ask before using others. For new parts, find and cite the datasheet.
- Follow the wiring convention (6.5): reach the Pi only through T-board strips, using male–male leads, and male–female leads for modules with male headers.
- When I'm debugging my real board, call read_board_sense first. Reason from the measured divergences and their candidate causes, not from guesses.
  - Say plainly what the Pi can't observe.
- Respect the documented Pi limits:
  - transistor drivers for buzzers, relays, and motors
  - dividers or level shifting for 5 V signals
  - an external supply for motors
  - flyback diodes on bare coils
- Default summary: what Claude built, how it works, what to check.

12.8 Safety
- The assistant has no hardware tools. It reaches the app only through core/, native/anthropic, and the injected AssistantContext. It can't reach the ssh, gpio, terminal, piAgent, or projects-write APIs (4.5).
- Each assistant turn is one undo group. "Undo all" restores a prior document that is deep-equal to the original.
- In the app, the key exists only in the Keychain and in Rust memory.

────────────────────────────────────────
13. TUTORIALS AND CODE IN THE LOOP
────────────────────────────────────────
13.1 Tutorials (content/tutorials)
Each tutorial is a CircuitDoc (.gpiob) plus Markdown theory, code, and checkpoint definitions. No hole coordinates are hand-typed outside the doc; the wiring text and the steps are generated.

Curriculum order:
1. The kit projects, listed in GPIO_DASHBOARD_PROMPT.md §8 (repo root): Blinking LED, RGB LED, LED Dot Matrix, 7-Segment, Active Buzzer, Passive Buzzer, Motor, Relay, LED Bar Graph, Button, Tilt Switch, Potentiometer, Photoresistor, Thermistor, DHT-11, Adjustable Fan, Morse Code.
2. Then the current extras: breathing LED, flowing LEDs, 4-digit 7-segment, standalone shift register, servo, LCD1602, PIR, ultrasonic, keypad, joystick. Tag them "needs parts not in the kit" where that's true.

Every tutorial passes:
- ERC with zero errors.
- Its own sim assertions. Examples:
  - Blinking LED (the kit wires 3V3 → 220 Ω → LED → GPIO17, active-low): GPIO17 LOW gives a D1 current within its rated range and at least 1 mA, and GPIO17 HIGH turns D1 off.
  - Button (the kit's pull-up configuration): the GPIO18 net reads HIGH while SW1 is released and LOW while it's pressed.
  - Write every assertion in the polarity the kit's own docs use. Never assume active-high.
  - ultrasonic: the ECHO divider output stays at or below 3.3 V with a 5 V input
- Code/netlist pin agreement.
- No LEAD_TOO_SHORT warnings with my inventory leads.

Theory keeps the good existing material, with GPIO numbers and component values templated from the doc.

13.2 Pyodide (workers/pyodide.worker.ts)
Bundle Pyodide locally, with no CDN, because the app is cross-origin isolated.

Shims drive the sim stimulus:
- RPi.GPIO: setmode; setup with pull_up_down; output; input; PWM (start, ChangeDutyCycle, ChangeFrequency, stop); add_event_detect; wait_for_edge; cleanup.
- A gpiozero subset: LED, PWMLED, Button, Buzzer, TonalBuzzer.
- smbus2/I2C stubs for the LCD1602 and ADS1115 models.

Blocking sleep uses SharedArrayBuffer and Atomics.wait, with a selectable time scale.

Cross-origin isolation (it also enables SharedArrayBuffer for the physics worker):
- Production: app.security.headers in tauri.conf.json (Tauri ≥ 2.1; the lock has 2.12.5), with:
  - Cross-Origin-Opener-Policy: same-origin
  - Cross-Origin-Embedder-Policy: require-corp
- Dev: the same two headers in vite.config.js server.headers, because `tauri dev` loads the devUrl from Vite.
- Verify crossOriginIsolated === true in both modes.

────────────────────────────────────────
14. HARDWARE LINK AND TWIN
────────────────────────────────────────
14.1 SSH (existing ssh.rs; keep)
- russh with password or key auth.
- Trust-on-first-use known_hosts.
- Keepalive, and reconnect with backoff.
- Multiplexed PTY shells.
- Streaming exec.
- Uploads through `cat >` over exec.
- Graceful shutdown that stops the Pi agent and closes shells, bounded to 5 s.

v2 adds ssh_i2c_scan(bus), which runs `i2cdetect -y <bus>` over exec and parses the address grid.

14.2 Pi agent and telemetry (existing agent.rs and ws.rs; keep, plus the D18 fix)
- Deploy, install, and start/stop, with token capture and log scrubbing.
- The gpio:state and gpio:system-info events, with Rust-side dedupe.
- Fix D18. The agent binds 127.0.0.1, but the app dials the Pi's address directly, so telemetry can't connect as deployed.
  - Tunnel the WebSocket through the SSH session: a russh direct-tcpip channel to 127.0.0.1:8765.
  - Keep the agent bound to 127.0.0.1. Never bind it to 0.0.0.0, because the agent executes code on request.
- Extend pi-agent only where a checkpoint needs a new message type, keeping the existing auth and validation discipline.

14.3 Run on Pi (existing commands, generalized to projects)
- Upload the project code with ssh_scp_buffer to /tmp/gpio_dashboard/project_<projectId>.py.
  - The existing validation applies: the filename regex, the /tmp/gpio_dashboard/ prefix, and no "..".
  - Project IDs are generated from [a-zA-Z0-9_-], so the name always passes.
- Run it with ssh_run_tutorial_script(filename). The command is already filename-generic.
- Stop with ssh_kill_process and an optional ssh_gpio_cleanup.
- Remove the fixed 120 s deadline (D17).
  - A run streams until the script exits or I press Stop.
  - An optional time limit is a setting, off by default.
- On Stop or on the time limit, always run the kill command, so the remote process can't outlive the stream.
- Generalize the renderer's run path in store/tutorialStore.js into a project-level run. Only UI handlers trigger it.
- When Board Sense is on, a run waits for the agent's sense_paused acknowledgement before it launches (14.5).

14.4 Twin features
- Live pin levels and modes from pinctrl light the 3D T-board pins and the Pi header pins, and tint the matching nets.
- Sim vs real: while code runs on the Pi, compare the expected levels on input and output nets with telemetry.
  - Show divergence badges with a likely cause.
  - Example: "GPIO18 expected HIGH while SW1 is released but reads LOW → check switch orientation: pins 1–2 are always connected". With the kit's pull-up wiring, a switch rotated 90° holds the pin at GND.
- Build Mode checkpoints:
  - (a) An I2C scan confirms the expected addresses.
  - (b) "Press the button now" watches telemetry for the edge.
  - (c) "Toggle LED" runs a tiny script after my click, then asks me to confirm I saw it.

14.5 Board Sense (live connectivity)
Purpose: know what's actually connected, as it happens, and where my physical board differs from the twin.

What can be known, and how precisely (the Board tab states this too):
- Twin: exact holes, through the connectivity engine (8).
- Physical board: the electrical unit is the strip.
  - The 5 holes of a strip are one node, so no electrical measurement can tell which hole in a strip a lead is in.
  - That also means it doesn't matter electrically. A lead one hole over in the same strip is the same circuit.
  - A lead one row over is on a different net.
- A net is observable only when bias probing can tell its expected state apart from "nothing attached". That holds when, for some probe configuration, the predicted reading:
  - falls outside the threshold band (9) across the whole pull-resistance range
  - and differs from the no-path reading
- Usually observable:
  - direct leads to GND, 3V3, or another probed GPIO
  - switches and buttons to a rail
  - resistors to a rail that are well below the internal pull, about 10 kΩ or less
  - passive dividers that land clearly outside the band
- Usually not observable: LED paths.
  - At the microamps an internal pull passes, an LED's forward voltage lands in or near the threshold band, or reads the same as no path.
  - So LED presence and polarity can't be sensed this way. My "Toggle LED" checkpoint (14.4 c) verifies them.
- Every net that isn't observable is "unobserved", and is never shown as verified.
- Together:
  - the twin supplies the hole-level layout
  - Board Sense confirms or refutes the observable nets
  - Build Mode steps tie the two together in time, because they record which lead was just added
- Example: GPIO18's T-board pin is in h6. A lead runs from j6 to a30. Row 30 has a 10 kΩ pull-up to 3V3 and a button to GND.
  - Released: GPIO18's net reads tied-high even under the internal pull-down. That matches the simulated signature, which confirms the lead and the pull-up at strip level.
  - Pressed: the net reads tied-low, which confirms the button.
  - If the lead were one row off (a31), the net would follow the bias instead. That's a missing-path divergence, with "lead end moved one row" as the top candidate.
  - The twin says where in rows 6 and 30 everything sits.

Physical sensing (pi-agent/sense.py):
- Switching:
  - Off by default. A toggle in the Board tab (my click) turns it on, and disconnecting turns it off.
  - Neither the assistant nor the coding agent's automated tests on my real Pi can switch it on (18).
- Pins:
  - all user GPIOs on the T-board, excluding GPIO0/1 (the ID EEPROM)
  - excluding any pin the OS has claimed (for example the serial console, or an active I2C or SPI overlay), read from the live pinctrl state
  - GPIO2/3 are probed with their board pull-ups modeled (9).
- Safety:
  - Pins stay in input mode. Sensing changes only the bias: pull-up, pull-down, or none. It never sets a pin as an output.
  - "None" must be true high impedance. RP1 pads also support a bus-keeper mode (RP1 peripherals datasheet), and sensing must never leave a pad in it.
  - The internal pulls bound the current through any path.
  - Bias edges still reach whatever is on the net. A transistor base switches in microseconds, and a logic IC sees edges on its inputs.
  - So nets are skipped by pin role, as the twin knows it:
    - transistor bases
    - the inputs and outputs of driver and logic ICs (74HC595, ADC0834, L293D)
    - relay and motor driver inputs
    - module signal pins
  - Skipped nets are listed with the reason. I can allow one in the Board tab.
  - The skips come from the twin. The Board tab warns me that parts on my bench the twin doesn't know about will still see bias edges.
- Coexistence with code on the Pi:
  - Sensing requests GPIO lines only for the duration of a sweep, and releases them between sweeps.
  - Before any Run on Pi, the app sends sense_pause. It waits for the agent's sense_paused acknowledgement, which means every line is released, before it launches the script.
  - After the run ends, or I press Stop, the app sends sense_resume.
  - If the acknowledgement doesn't arrive within 1 s, the run doesn't start, and the app says why.
  - While sensing is paused, the passive pinctrl telemetry keeps showing levels.
- Access:
  - libgpiod line requests with bias control. Check which binding version the Pi's OS ships, and record it.
  - Fall back to pinctrl only if needed.

One sweep:
1. Bias test, per pin: read with pull-up, then with pull-down.
   - Classes: follows-bias (nothing low-impedance attached), tied-low, tied-high, ambiguous.
2. Pair test, per driving pin A:
   - Precharge every other probed pin to the opposite level through its own pull, then release those pulls (bias none).
   - Apply A's pull, wait a settle time, and read.
   - Pins that follow A share a low-impedance path with A. Floating pins keep their precharge.
   - Repeat with the opposite polarity.
   - Result: a GPIO-to-GPIO connectivity matrix.
3. Presence (stretch; gated by a spike in M6):
   - Time each pin's charge under its pull, with 10 ns resolution or better, from PIO cycle counts on RP1 through piolib.
   - A dangling lead adds only a few pF, which shifts the charge time by roughly a tenth of a microsecond. Microsecond timing can't see that.
   - A calibrated capacitance change means something new is attached to that GPIO's net, even a lead whose far end touches nothing.
   - If the spike shows it's unreliable (noise, hand proximity, ribbon motion), drop it and record an ADR.

Cadence:
- Target a full sweep in at most 250 ms on the Pi 5. The fixture-check walkthrough measures it and records it when I run it.
- Emit an event once a change persists across 2 consecutive sweeps. A change can therefore take up to 3 sweep periods to report.

Expected signatures:
- core/sim's probe-signature mode (9) predicts every measurement from the doc. It carries the pull-resistance range through, so a prediction can come out ambiguous.
- Pair-test predictions are transients that start from the precharge state. So an isolated net holds its precharge, as it does on the board.
- The connectivity engine's diff stream invalidates only the affected predictions.

Reconciliation state machine, per net:
- States:
  - unobserved: not observable, as defined above
  - matched
  - diverged (with a kind)
  - ambiguous
  - skipped (with the pin-role reason)
  - settling: a change seen once, awaiting confirmation
- Transitions on:
  - sweep results
  - doc diffs
  - Build Mode step advances
  - run start and stop
  - sensing on and off
- Divergence kinds:
  - missing-path: an expected path doesn't show up
  - extra-path: the board shows a path the doc lacks
  - wrong-level: a pin reads tied-high or tied-low unexpectedly
  - gpio-short: two GPIO nets are joined
  - presence: something new is attached (presence mode only)

Candidate causes:
- For a diverged net, generate single-fault edits of the doc near that net:
  - a lead end moved one row
  - a lead end on the other side of the trench
  - a two-lead polar part reversed
  - a part shifted one row
  - a missing lead, or an extra lead
  - a module pin off by one
  - a lead on the wrong rail
- Simulate each candidate's signature, and rank the ones that match the measurement.
- Show the top 3, each mapped to the exact holes involved.
- Candidates whose signatures can't be told apart are reported as a tie, never ranked arbitrarily.

Physical events reach the app as typed events. Examples:
- "GPIO18 net gained a path to 3V3"
- "GPIO17 and GPIO27 are now joined"
- "something attached to the GPIO22 net" (presence mode)

Fixture checks (how I validate Board Sense on my bench):
- The Board tab has a fixture-check walkthrough. For each fixture in 18, it:
  - shows the exact holes to wire
  - waits for me to confirm the fixture is built
  - runs the sweeps after my click
  - records the results
- I can export the results to a file, for example in docs/v2/hil/.

Optional probe lead:
- I can assign one spare GPIO as a probe, with a male–male lead in its strip.
- Touching a hole with the lead's free end joins that strip's net to the probe.
- Board Sense reports which observable net the probe joined, such as a rail or a GPIO net, and the twin highlights the candidate strips.

UI:
- The Board tab exists before the 3D Studio does. It shows:
  - the sensing toggle
  - skipped pins and nets, and why each was skipped
  - per-net states
  - the event log
  - divergences, with their candidate causes and holes
  - the fixture-check walkthrough
- The 3D overlay comes later (11.5).

Transport:
- The app reaches the pi-agent's WebSocket through an SSH tunnel (D18).
  - The agent stays bound to 127.0.0.1:8765.
  - ws.rs connects over a russh direct-tcpip channel to that address.
  - Never bind the agent to 0.0.0.0, because the agent executes code on request.
- New message types: sense_start {config}, sense_stop, sense_pause, sense_paused, sense_resume, sense_sweep, sense_event.
- ws.rs gains a send path for them. At 52639d9 it sends only the auth frame.
- agent.rs deploys sense.py with the other agent files.

Mock: a mock sense agent driven by core/sim, so every Board Sense flow can be tested without a Pi, injected faults included.

────────────────────────────────────────
15. RUST INTERFACE (commands.rs, api.js, native/)
────────────────────────────────────────
Kept as is (52639d9):
- ssh_select_key_file
- ssh_connect, ssh_disconnect, ssh_get_status
- ssh_run_tutorial_script, ssh_kill_process, ssh_gpio_cleanup, ssh_scp_buffer
- gpio_connect, gpio_disconnect
- terminal_create, terminal_write, terminal_resize, terminal_destroy
- agent_deploy, agent_install, agent_start, agent_stop, agent_get_status
- settings_get, settings_set, settings_set_password, settings_get_all
- open_external
- the events ssh:status-change, tutorial:output, gpio:state, gpio:system-info, terminal:data:<id>, agent:log, agent:status

Added:
- anthropic_request(req {id, method, path, headers, body}, channel: Channel). Messages arrive in order:
  1. {status, headers}
  2. {chunk: bytes}, repeated
  3. {end} or {error}
- anthropic_abort(id)
- settings_set_anthropic_key(value) → {success}
- settings_has_anthropic_key() → bool
- settings_clear_anthropic_key()
- projects_list() → [{id, name, updated}]
- projects_read(id) → doc
- projects_write(id, doc)
- projects_delete(id)
- projects_export(doc) (native save dialog)
- projects_import() (native open dialog) → doc
- ssh_i2c_scan(bus) → addresses[]
- sense_start(config) and sense_stop(). These send to the pi-agent through ws.rs's new send path. Only UI handlers call them.
- the event gpio:sense, carrying Board Sense sweeps and events, with Rust-side dedupe like gpio:state

Removed:
- ai_generate, ai_abort
- settings_set_api_key, settings_has_api_key (the OpenRouter key)
- the ai:chunk, ai:done, and ai:error events
- src-tauri/src/ai.rs and its tests

Bridge:
- api.js gains the window.api.anthropic and window.api.projects namespaces, and loses window.api.ai.
- Keep createApi testable with injected invoke/listen, as today.
- The TypeScript wrappers in native/ give typed access.

Config:
- Capabilities: an unchanged surface; no new plugins are exposed to the webview.
- CSP:
  - production: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost
    - The 52639d9 production CSP sets connect-src without 'self'. That blocks same-origin fetches, which v2 needs for its models, the HDRI, the KTX2 transcoder, and Pyodide's wasm and stdlib.
    - The devCsp already allows http://localhost:5173, so dev runs and Playwright won't catch this. Verify it in a production build.
  - devCsp: the same additions on top of the existing devCsp
- Headers: COOP/COEP, as in 13.2.
- Agent markdown renders without raw HTML.

────────────────────────────────────────
16. CORRECTNESS AUDIT AND DEFECT REGISTER
────────────────────────────────────────
16.1 The audit (M4, before any 3D work)
Why: the baseline was abandoned because its tutorials and its module and sensor depictions were electrically wrong. D1–D18 (16.2) are the defects already found. They are a floor, not the full list.

Scope: every item in the baseline, nothing skipped.
- every tutorial in data/tutorials.js: its circuit, wiring text, diagram, code, theory text, and the component values and GPIO numbers it quotes
- every component and module depiction (WiringOverlay and related code): pinout, pin order, polarity, supply voltage, required driver or divider, and lead gender
- data/pins.js, and every other hard-coded electrical fact
- the README's claims (D16)

Method, per item:
1. Find the governing sources and record their URLs:
   - the SunFounder kit docs for that project
   - the part's datasheet
   - the official Raspberry Pi docs
2. Rebuild the circuit as a .gpiob doc, on my bench's T-board placement (6.3) and following the wiring convention (6.5).
3. The rebuilt doc must pass:
   - ERC with zero errors
   - its sim assertions (13.1)
   - the code/netlist pin check
   - its code run in the sim, once M5 lands
4. Record each finding in docs/v2/AUDIT.md:
   - the item
   - what the baseline said, and what's correct
   - the source
   - severity: unsafe for hardware, doesn't work, misleading, or cosmetic. List unsafe-for-hardware findings first.
   - the test that now guards it
5. Sometimes the SunFounder docs are themselves wrong, or unsafe for a Pi 5 (for example, a 5 V signal into a GPIO). Then follow the datasheet and the Pi's limits, and note the conflict.

AUDIT.md also carries, for each tutorial, the generated hole-by-hole wiring table and build steps. That lets me check them against my bench before any 3D exists.

The fix lands as verified content: circuit docs, part defs, code, and theory, which everything downstream consumes. Don't patch the old SVG renderer; it gets replaced (17).

16.2 Known defects (regression targets; present at 52639d9)
Paths are relative to gpio-dashboard/src/renderer/src/ unless shown in full. Each item gets a v2 regression test that proves the correct behavior.

D1. components/breadboardCoords.js
- NUM_ROWS = 30, while the README claims 63 rows.
- With the T-board on rows 1–20, only 10 rows were free.

D2. cobblerPinCoord() puts T-board pins between holes:
- odd pins between columns d and e (GPIO17 at x=154, between d=142 and e=166)
- even pins between f and g

D3. resolveCoord('power:…') resolves off the drawn rails after rotate(-90):
- x lands at 65 or 845, against a rail span of 90–806
- y lands at 160 or 300, in the tie-point field
- No tutorial uses the rails, even where the text says "GND rail".

D4. components/Breadboard.jsx mixes two coordinate systems: rails outside the rotated group, and everything else inside it.

D5. components/WiringOverlay.jsx:
- renders 6 component types, and unknown types render nothing
- draws schematic glyphs, not physical parts
- the button is a single point, with its dots between holes
- the buzzer has one connection point

D6. pages/BreadboardPage.jsx falls back to tutorial id 'led_blink'. The real id is 'blinking-led'.

D7. 10 of the 18 diagrams in data/tutorials.js draw zero components: flowing-leds, relay, motor, servo, lcd-display, seven-segment, four-digit-seven-segment, shift-register, joystick, keypad.

D8. buzzer:
- The buzzer sits in column h (the f–j strip) with its negative leg in row 23, but GND goes to 23a (the a–e strip), so the circuit is open.
- It drives the buzzer straight from a GPIO, while the kit design uses an S8050 with a 1 kΩ base resistor.

D9. button-led: the 10 kΩ pull-down spans rows 28–29 while GPIO18 is on row 27. The code's internal PUD_DOWN masks the error.

D10. rgb-led: the text puts the legs in non-adjacent rows 23/25/27/28, and the diagram draws one LED across rows 27–28.

D11. four-digit-seven-segment: the wiring is copied from flowing-leds, and there are no digit-select lines.

D12. ultrasonic:
- No HC-SR04 is drawn, and the ECHO wire is missing.
- The 5V and TRIG wires end on rows that connect to nothing.

D13. The curriculum drifted from the kit's project list to non-kit parts.

D14. AI (gpio-dashboard/src-tauri/src/ai.rs, components/AiChatPanel.jsx, store/tutorialStore.js):
- single-turn OpenRouter
- pins restricted to the tutorial
- the stream overwrites the editor with no undo
- runs only work for tutorials

D15. There is no netlist or connectivity model.

D16. The README overstates the product: "photo-realistic breadboard", "63-row", and the 18-project kit curriculum claim.

D17. Run deadline (gpio-dashboard/src-tauri/src/commands.rs):
- ssh_run_tutorial_script passes TUTORIAL_TIMEOUT = 120 s to execute_streaming, which closes the output stream at the deadline.
- So a long-running script, such as any blink loop, loses its output and its Stop/twin tracking after two minutes.
- Verify whether the remote python process survives the channel close. Either way, fix it as described in 14.3.

D18. Telemetry can't connect as deployed (gpio-dashboard/pi-agent/agent.py, src-tauri/src/agent.rs, src-tauri/src/ws.rs, store/connectionStore.js):
- agent.py binds os.environ.get("AGENT_HOST", "127.0.0.1"), and nothing sets AGENT_HOST:
  - agent.rs starts it with a plain `nohup python3 agent.py`
  - install.sh's systemd service is commented out
- ws.rs dials ws://<Pi host>:8765 from the Mac, and ssh.rs has no port forward, so the connection is refused.
- That breaks the live telemetry the README advertises, and it would break Board Sense.
- Fix it with the SSH tunnel in 14.2. Add a test against the live sshd harness that the WebSocket connects through the tunnel while the agent is bound to 127.0.0.1.

────────────────────────────────────────
17. BASELINE → v2 CHANGE MAP
────────────────────────────────────────
Paths are relative to gpio-dashboard/ unless they start with docs/ or are the repository root.

Keep:
- src-tauri/src/main.rs (register the new commands and state)
- pi-agent/ (plus sense.py and its message types)
- src-tauri/live-tests.sh
- the existing cargo tests
- pages Connect, Pinout, Monitor
- components Terminal, TerminalPanel, CodeEditor, GpioHeader, GpioPin, PinDetail, LiveMonitor, SystemInfo, ConnectionStatus, Navbar, ErrorBoundary
- stores: connection, gpio, ui

Extend:
- ssh.rs: the direct-tcpip tunnel (D18) and the i2c scan
- ws.rs: connect through the tunnel (D18), and the send path for agent commands
- agent.rs: deploy sense.py with the other agent files. AGENT_FILES is a fixed six-file array at 52639d9.
- commands.rs: new commands and SETTINGS_ALLOWLIST
- settings.rs: the anthropic key and new defaults
- tauri.conf.json: CSP and headers
- vite.config.js: dev headers, and worker/wasm config for the sim, Pyodide, and physics workers
- package.json:
  - scripts: typecheck, test (Vitest plus the existing node tests), e2e, evals, assets:build, assets:check
  - new dependencies
- eslint.config.mjs: TypeScript, and the boundary rules for core/, physics/, and assistant/
- api.js and api.test.js: new namespaces
- store/tutorialStore.js: project-level run
- the repository root .gitignore: .env and .env.* (keep !.env.example)

Add:
- src/renderer/src/{core, content, state, studio, physics, panels, assistant, workers, native}
- src/renderer/public/models/
- scripts/assets/, scripts/assistant-evals/, scripts/hil.ts, scripts/ngspice/
- docs/v2/AUDIT.md, docs/v2/LOOKDEV.md, and docs/v2/reference/IMAGES.md
- pi-agent/sense.py (Board Sense), plus its message types in pi-agent/agent.py
- the ws.rs send path, and the sense_start/sense_stop commands

Replace:
- components Breadboard.jsx, TCobbler.jsx, WiringOverlay.jsx, and breadboardCoords.js
- pages BreadboardPage.jsx (→ StudioPage) and TutorialsPage.jsx
- components TutorialDetail.jsx and TutorialCard.jsx (→ Build Mode)
- the data/tutorials.js wiringDiagram format (→ content/tutorials/*.gpiob)
- components AiChatPanel.jsx (→ panels/Claude)

Remove: src-tauri/src/ai.rs, the OpenRouter settings and commands, and window.api.ai.

Rewrite: README.md, to describe what exists with no unverified claims (fixes D16).

────────────────────────────────────────
18. TESTING AND VERIFICATION
────────────────────────────────────────
Baseline suites (must stay green throughout):
- cargo test
- src-tauri/live-tests.sh
- npm test (node --test bridge tests)
- npm run lint

Vitest for core/ covers:
- board geometry: holes, strips, trench, rail groups and offsets, against the BB830 values
- the Pi 5 header table, against the official docs
- the T-board: the 6-pitch rule, legal column pairs, the label table, and the pin identity through the ribbon
- op/inverse round-trips, property-based with fast-check
- netlists
- every ERC rule, positive and negative, including LEAD_TOO_SHORT
- sim fixtures vs the committed ngspice references
- resistor bands for all E24 values
- schema migrations
- D1–D15 regressions, each added in the milestone that builds the code it covers (19)
- the connectivity engine: event diffs for every op kind, undo/redo symmetry, and the 1 ms budget
- D16 is verified by review in M12. D17 and D18 are covered in the Rust tests.

Asset tests (npm run assets:check, plus Vitest):
- Manifests are valid, sources are hashed, and the Blender version is recorded.
- The Pi GLB's PCB footprint matches the drawing's 85 × 56 mm outline within 0.5 mm, measured on the board mesh rather than the connectors that overhang it.
- The Pi GLB's mounting holes, header pin 1's position, and the 2.54 mm pitch match the drawing.
- The breadboard GLB:
  - body within 0.3 mm of 165.1 × 54.6 × 8.5 mm
  - every modeled hole centre within 0.05 mm of core's hole coordinates
- The T-board GLB: its outline and all 40 pin positions match tboard.json within 0.05 mm.
- Budgets are met.
- A clean rebuild reproduces the geometry hashes exactly, and the textures within SSIM ≥ 0.99.

Physics tests (Vitest, pure TS):
- Inextensibility: in-span leads stretch at most 1% at rest, and the ribbon at most 0.5%. Over-span leads flagged LEAD_TOO_SHORT are exempt (10.5).
- Attachments: clamped ends stay within 0.05 mm of their frames.
- Contacts: at most 0.5 mm of penetration in scripted scenes:
  - a lead over a part
  - a pile of leads
  - the ribbon over the breadboard edge
  - the T-board dragged across the board
- Sleep: within 2 s of the last input; wakes on an anchor change.
- Determinism: an identical settled-state hash across two runs in one runtime.
- Agreement: the taut state and LEAD_TOO_SHORT agree on the same geometry.
- Performance: step time measured in the Tauri window and recorded.

Look-dev (docs/v2/LOOKDEV.md):
- Side-by-side screenshots, Tauri window vs reference photo at an approximately matched camera, for:
  - the T-board top
  - the T-board underside
  - the ribbon with its sockets
  - the breadboard, top-down
  - the Dupont leads
- A checklist covering label text and order, ribbon color order and the pin-1 edge, legend placement, proportions, and colors.
- Read both images with vision, and fix whatever differs.

Tool contracts:
- zod → JSON Schema output is strict-compatible.
- Fuzzed invalid inputs return structured errors and never mutate the doc.

Golden tutorials: the checks in 13.1, plus the wiring convention (6.5). Every GPIO is reached through a T-board strip with male–male leads, and nothing touches the Pi header.

Audit (16.1):
- Every AUDIT.md finding names its source and its guarding test, and that test passes.
- A script cross-checks that every baseline tutorial and component depiction has an AUDIT.md entry.

Board Sense (14.5):
- pi-agent unit tests, with a fake gpiod. They cover:
  - bias classes
  - the pair test's precharge logic
  - the excluded pins and pin-role skips
  - pause and resume with their acknowledgement
  - that lines are released between sweeps
  - that no code path ever requests an output line or leaves a pad in bus-keeper mode
- core tests:
  - probe-signature predictions against hand-worked fixtures, across the pull-resistance range
  - the observability rule: LED paths come out unobserved, and a 10 kΩ resistor to a rail comes out observable
  - the pair-test transient: isolated nets hold their precharge
  - the reconciliation state machine's transitions
  - candidate ranking: the true fault ranks in the top 3 on every injected observable single fault, and indistinguishable candidates tie
- Mock-agent e2e: toggle sensing, build a fixture step by step, inject faults, and check the events, states, and candidates.
- Bench fixtures. I run these through the Board tab's fixture-check walkthrough; HIL_CHECKLIST.md lists them with exact holes:
  1. An empty board: every net follows bias.
  2. Calibration: GPIO17 to GND through 10 kΩ, 47 kΩ, 100 kΩ, and 220 kΩ in turn. This narrows the pull-to-threshold ratio (9).
  3. GPIO18 → male–male lead → row 30, with a 10 kΩ pull-up to 3V3 and a button to GND. Check it released, then pressed.
  4. A direct lead between GPIO17 and GPIO27: gpio-short.
  5. Faults on fixture 3: the lead one row off, the pull-up's lead missing, and the button's GND lead on the 3V3 rail instead.
  6. The kit's Blinking LED circuit. It must come out unobserved (LED path), never matched or diverged. Then the Toggle LED checkpoint, which I trigger, verifies it.
  7. A dangling lead on GPIO22 (presence mode, if it survives its spike).

New Rust tests (cargo test):
- anthropic_request against a local mock server:
  - header stripping and injection
  - the path allowlist
  - streaming
  - abort
  - error mapping
- projects I/O
- i2cdetect output parsing
- a test that no Anthropic key command returns the key
- one ignored live test that sends a count_tokens request through the real proxy code path
  - It injects the key through the key-provider seam, from the environment of that test process only.
  - It never touches the Keychain.
  - Run it when the key is available (3.3).

Frontend e2e:
- Run Playwright against the Vite dev build in Chromium. Fake the native layer with createApi using injected invoke/listen fakes, or with @tauri-apps/api/mocks.
- Use a recorded-transcript mock of the assistant.
- Flows:
  - place, wire, simulate, undo
  - assistant build replay
  - Build Mode
  - project save/open
  - dragging the Pi and the T-board: the ribbon stays attached and re-settles
- Screenshot checks of the stage, taken after physics sleeps, are stable across runs.

Native window:
- WebDriver doesn't drive WKWebView on macOS (verify this).
- Instead, do a scripted smoke pass in the real app, plus a dev overlay showing:
  - the rendering backend
  - FPS, with physics awake
  - physics step time
  - frames rendered while idle (must be 0 once settled and TRAA has converged)
  - crossOriginIsolated

Assistant evals (scripts/assistant-evals):
- Run live when the key is available (3.3); otherwise run mock replay.
- At least 10 prompts, including:
  - "blink an LED on GPIO17"
  - "button toggles the LED"
  - "parking sensor with HC-SR04 + passive buzzer + 3 LEDs"
  - "add a second button that changes blink speed"
  - "I have a BMP280 breakout; read temperature over I2C": should create a custom part with a cited datasheet
- Score each on:
  - zero ERC errors
  - sim assertions passing
  - inventory respected
  - code pins matching the netlist
  - turns and tokens
- Save transcripts, with no headers or secrets in them.

Hardware in the loop (scripts/hil.ts):
- Automated runs against my real Pi happen only when PI_HOST is set and reachable. Even then, they're limited to flows that neither drive nor probe a pin, because I can't know what's wired on my bench at that moment:
  - connect
  - deploy the agent
  - the tunnel and telemetry (D18)
  - system info
  - the I2C scan
  - run and stop of a script that only prints (D17)
- Everything that drives a pin or runs Board Sense goes on docs/v2/HIL_CHECKLIST.md with exact hole-by-hole steps, for me to run:
  - tutorial runs on hardware
  - checkpoints
  - the Board Sense fixture checks, through the Board tab
- Without a reachable Pi, run the same flows against a mock pi-agent and the mock sense agent.

Performance: report frame time and physics step time from a scripted camera orbit and a scripted drag.

────────────────────────────────────────
19. MILESTONES AND IMPLEMENTATION ORDER
────────────────────────────────────────
Each milestone ends runnable, tested, and committed. Proceed straight through.

The order is deliberate: correctness first (M2–M5), Board Sense second (M6), then the 3D Studio (M7 onward). Don't start 3D work early, apart from the M0 availability check.

M0 Baseline and foundations
- Record the baseline suite results in docs/v2/BASELINE.md.
- TypeScript config (strict) and the ESLint boundary rules.
- Vitest wired into npm test alongside the node tests.
- Dependency and tool versions recorded, including Blender and KTX-Software.
- The .env patterns added to the root .gitignore.
- The reference photo manifest in docs/v2/reference/IMAGES.md.
- COOP/COEP headers (prod and dev) and the CSP update. Verify crossOriginIsolated.
- A WebGPU availability check in the Tauri window: navigator.gpu and the adapter info, recorded in BASELINE.md. No 3D work yet.
- T-board evidence: check docs/v2/reference/tboard/, the photos, and the Adafruit prior. Record an ADR for the body geometry (6.3). The d/h column pair is already confirmed.

M1 Native additions
- anthropic.rs proxy with Channel streaming and abort.
- The anthropic key commands.
- projects.rs.
- ssh_i2c_scan.
- api.js namespaces plus the typed native/ wrappers.
- Remove ai.rs, OpenRouter, and the AiChatPanel wiring.
- Fix D17: no fixed run deadline, and a kill on Stop or timeout.
- Fix D18: tunnel the agent WebSocket over SSH (14.2).
Exit: new cargo tests green (including D17 and D18 tests against the live sshd harness), and the baseline suites still green.

M2 circuit-core
- Data model, including the controller placement and wire kinds and lengths.
- Board, Pi, T-board, ribbon, and lead defs from the documentation.
- Kit part defs from datasheets.
- Ops, transactions, and undo.
- Occupancy, netlist, the connectivity engine (8), reach, and ERC v1.
- Wiring-convention validation (6.5).
- Serialization and migrations.
Exit: unit tests green, including the connectivity-engine tests and the D1–D4 and D15 regressions.

M3 Simulation
- The MNA engine and all models, in the sim worker, including the probe-signature mode (9).
- An interim Workbench page in the existing app shell. It hosts the ERC and Sim/Probes panels, with inputs and environment sliders, for any project or tutorial doc.
- The Workbench's panels move into the Studio's drawer in M7.
Exit:
- fixtures within ±2% of ngspice
- the blink and button circuits behave correctly
- probe-signature predictions match the hand-worked fixtures

M4 Correctness audit and verified content (16.1)
- Audit every baseline tutorial, component and module depiction, and hard-coded electrical fact.
- Rebuild each tutorial and extra as a verified .gpiob doc on my bench's T-board placement, following the wiring convention.
- Verify every part and module def against its datasheet.
- Generate wiring text, hole-by-hole wiring tables, and build-step text (core/steps).
- Write docs/v2/AUDIT.md.
- Retire the old breadboard SVG diagrams. Until the Studio exists, the Tutorials page shows the audited wiring tables, steps, code, and theory through the Workbench. Never show wrong content.
Exit:
- every baseline item has an AUDIT.md entry with a source, and zero findings are open
- every tutorial passes 13.1 (code-in-sim follows in M5)
- the D6–D13 regressions pass

M5 Code in the loop
- The Pyodide worker and shims, time scaling, the compile check, and Run in Sim, in the Workbench's Code panel.
- ERC-gated, project-level Run on Pi (14.3) in the Workbench's Code panel. It replaces the tutorial-only run path, and baseline run/stop keeps working through M4.
Exit:
- Every tutorial's code drives the sim the way its assertions require, which completes 13.1.
- Syntax errors surface as compile diagnostics.
- Run on Pi works for projects and tutorials, and ERC errors block it unless I override.
- The project-level run part of the D14 regression passes.

M6 Board Sense (14.5)
- pi-agent/sense.py and its message types.
- The ws.rs send path, sense_start/sense_stop, sense_pause/sense_resume with the acknowledgement, and gpio:sense.
- Run on Pi waits for sense_paused before it launches (14.5).
- The reconciliation state machine and candidate ranking.
- The Board tab in the Workbench, with the fixture-check walkthrough.
- Build-step confirmation logic (headless; its UI comes in M10).
- The mock sense agent.
- The presence-sensing spike, kept or dropped by ADR.
Exit:
- the Board Sense tests pass
- the mock sense agent passes every bench-fixture scenario
- the fixture-check walkthrough works end to end against the mock
- HIL_CHECKLIST.md lists the bench fixtures for me, with exact holes
- tests prove that sensing never requests an output line, and always releases lines before a run
- The coding agent never switches sensing on against my real Pi (14.5).

M7 3D Studio and hero assets
- The WebGPU renderer and the asset pipeline (10.3), including the Pi 5 STEP conversion.
- Blender assets: breadboards, T-board, IDC sockets, the ribbon detail maps, Dupont housings, and the part families.
- Stage, HDRI lighting, shadows, and the post stack.
- Picking, drag-place with the legality glow, and strip-hover highlighting.
- Selection and Properties, camera presets, and Labels.
- Voltages and Current overlays, LED glow, animated parts (10.6), and the Board Sense overlay.
- The Workbench panels move into the Studio drawer.
- Projects gallery, save, and open.
- LOOKDEV.md side-by-sides.
Exit:
- I can hand-build the blinking LED circuit with live ERC.
- The asset checks pass.
- The look-dev checklist passes.
- The D5 regression passes: every part type renders.

M8 Real-time physics
- The XPBD solver, ribbon, Dupont leads, solid jumpers, contacts, islands and sleep.
- Route hints, settle-on-open, taut-lead feedback, and live response while dragging.
Exit: the physics tests pass, the drag e2e flows pass, and the budgets hold in the Tauri window.

M9 Assistant
- Client with nativeAnthropicFetch.
- The loop, zod tools, and the AssistantContext, including read_board_sense.
- Streaming ghosts that become physical on commit.
- The Claude drawer and review strip.
- Settings: key, model, effort, web tools.
- Transcripts, capture_view, mock replay.
Exit:
- "blink an LED on GPIO17" from an empty project ends ERC-clean in one turn, with matching code and wiring that follows the convention.
- Undo all restores the empty doc exactly.
- The assistant and undo parts of the D14 regression pass.

M10 Build Mode in the Studio
- The step UI with camera framing, ghosts, and depth of field.
- Board Sense step confirmations in 3D.
- Tutorials open in the Studio, with "Fork to my projects".
Exit:
- Every tutorial plays through Build Mode.
- Against the mock sense agent, and on my Pi when I run it, observable steps confirm themselves and unobservable ones are labeled.

M11 Hardware twin
- Live state in 3D.
- Divergence badges in 3D, from telemetry (14.4) and from Board Sense.
- Build Mode checkpoints (14.4).
Exit: the automated HIL flows (18) pass when the Pi is reachable, otherwise against the mocks, and HIL_CHECKLIST.md lists everything that needs my hands.

M12 Polish and acceptance
- Visual pass: materials, AO, bloom, depth of field, and the camera.
- The performance budgets.
- README rewrite (D16), and docs/ARCHITECTURE.md with a diagram.
- The final acceptance run.

────────────────────────────────────────
20. ACCEPTANCE CRITERIA (frozen)
────────────────────────────────────────
1. No project or tutorial can contain a lead or wire end that isn't in a real hole or on a real header pin. Validation plus tests enforce this.
2. Board, Pi 5, T-board, ribbon, lead, and part geometry, and the electrical constants, come from cited sources and are covered by tests:
   - The Pi 5 model is the converted official STEP, with a committed manifest.
   - The T-board uses the 6-pitch row spacing and my bench's d/h column pair. Any remaining geometry assumptions are recorded in DECISIONS.md and HIL_CHECKLIST.md.
3. Every tutorial: zero ERC errors, sim assertions pass, generated wiring text matches the doc, and code pins match the netlist.
4. D1–D18 each have a passing regression test, or a verified fix (D16).
5. The assistant builds with visible incremental ghosts, each appearing before its tool input completes, and never commits an invalid op (fuzz-tested).
6. The parking-sensor eval ends ERC-clean, with ECHO protected by a divider or level shifter. If ECHO is first wired directly, OVERVOLTAGE_GPIO catches it and the assistant fixes it in the same turn.
7. Undoing an assistant turn restores a deep-equal prior document.
8. Hovering a hole highlights its strip and net within one frame. Labels, Voltages, and Current work during Simulate.
9. Rendering uses WebGPURenderer in the Tauri window:
   - the backend is shown in the overlay
   - the backend is WebGPU on my Mac, unless navigator.gpu is demonstrably absent in the webview
   - at least 60 fps on the tutorial scenes, with physics awake and the full post stack
   - zero frames rendered when static, once TRAA has converged
10. Run on Pi works for projects and tutorials, and ERC errors block it unless I override.
11. Secrets and safety:
    - The Anthropic key never reaches the webview, and its commands never return it.
    - The assistant can't trigger hardware actions.
    - No secret appears in git, transcripts, or reports.
12. The baseline suites (cargo test, live-tests.sh, npm test, lint) stay green, and connect, deploy, telemetry, pinout, monitor, terminal, and run/stop keep working.
13. The cables are physical in real time:
    - Dragging the Pi, a board, the T-board, a module, or a wire end makes the ribbon and leads follow and re-settle live.
    - In the test scenes, nothing penetrates boards, parts, the table, or other cables by more than 0.5 mm.
    - The scene stops rendering within 2 s of the last input.
14. The assets are reproducible. npm run assets:build regenerates every committed GLB headlessly from committed scripts and pinned sources. assets:check confirms the geometry hashes, the texture SSIM, the dimensions, and that holes and pins coincide.
15. Look fidelity: every item on the LOOKDEV.md checklist passes against my reference photos, with side-by-side screenshots from the Tauri window.
16. Correctness audit:
    - AUDIT.md covers every baseline tutorial, component and module depiction, and hard-coded electrical fact.
    - Every finding has a source and a passing guard test, and none are open.
    - The audit finished before 3D work began, as the git history shows.
17. Wiring convention: every tutorial and every assistant build reaches the Pi only through T-board strips, with male–male leads, or male–female leads for modules with male headers. Nothing attaches to the Pi header. Validation enforces this.
18. Board Sense:
    - In the twin, every insertion and removal yields hole-exact events within the 1 ms budget.
    - Against the mock sense agent, on every bench-fixture scenario (18):
      - It reports any change that alters an observable net within 3 sweep periods.
      - Its classes and GPIO-to-GPIO connections match the simulated signatures.
      - It localizes divergences to strips and holes.
      - Each injected observable fault appears in its top 3 candidates.
      - It reports unobservable nets, including LED paths, as unobserved.
    - It never configures a pin as an output, and always releases its lines before a run (tests).
    - The fixture-check walkthrough is ready for me. My bench results count once I run them and export them. The coding agent never runs Board Sense on my real Pi.

────────────────────────────────────────
21. OUT OF SCOPE
────────────────────────────────────────
- Pre-rendered stills or videos, from Cycles, EEVEE, or anything else, as product features.
- Camera-based reading of the physical board.
- Hole-level sensing of the physical board. It's impossible electrically, because a strip's 5 holes are one node.
- Instrumented breadboards with per-row sensing hardware. A possible future path; not now.
- Board Sense probing that drives any pin as an output.
- Physics that affects electrical results, such as leads popping out or contact failures.
- Soft-body part leads. They bend deterministically.
- Cloth simulation for anything except the ribbon.
- Arduino and ESP32 controllers. Keep ControllerDef generic so they can be added as data later.
- PCB or schematic editors; the Nets inspector list suffices.
- Cloud sync, accounts, sharing, and embedding.
- Multi-provider AI.
- Multi-Pi.
- Windows/Linux packaging, beyond not breaking cross-platform builds.

────────────────────────────────────────
22. VERIFIED REFERENCES
────────────────────────────────────────
These were retrieved on 2026-10-23 with firecrawlpi. A scraper extracted the numbers below. Wherever an entry says to read something visually, read it from the original drawing. Re-verify anything you depend on, and record it with its source in the data files.

Breadboards
- BusBoard BB830/BB830T datasheet, which includes application note AN0002: https://datasheet.octopart.com/BB830T-BusBoard-datasheet-10603672.pdf (original: http://www.busboard.us/pdfs/BPS-MAR-BB830+BB830T-001.pdf)
  - Size 6.5 × 2.2 × 0.3 in (165.1 × 54.6 × 8.5 mm).
  - 630 tie points in the circuit area, 200 in the distribution strips.
  - 0.1" (2.54 mm) pitch, square holes.
  - Phosphor bronze contacts with nickel plating, rated for 50,000 insertions.
  - Rated 36 V, 2 A.
  - Wire 21–26 AWG (0.4–0.7 mm). A standard 0.1" header's square pin is typically 0.025" wide.
  - 0.8 mm metal back plate.
  - The circuit area is 63 "columns" (our rows) × 5 holes on each side.
  - Strips have groups of 5 holes, then a space with no hole. Their holes line up with the circuit-area columns. They sit an additional 0.05" further outward than 0.1" centres.
  - Body: white ABS with a color legend (the BB830T is transparent).
- BusBoard BB300/BB400 datasheet: http://www.busboard.us/pdfs/BPS-MAR-BB300+BB400-001.pdf
  - Per AN0002: the BB400's outer strips sit 0.25" from the circuit area, with their holes offset 0.050" from the circuit-area holes.

Raspberry Pi 5
- Section 6.2 lists the official URLs: STEP, mechanical drawing, product brief, RP1 peripherals. All five are linked from the portal page as of 2026-10-23.
- The drawing's text layer contains only unlabeled values (85, 56, 58, 49, 3.5, ø2.7, 29, 29.1). Read it visually.

T-board
- SunFounder, GPIO Extension Board: https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/preparation/GPIO_Extension_Board.html
  - The board uses BCM naming, except that the I2C and SPI pins carry their own names.
  - The pin table is an image (gpio_board.png). There is no CAD and no drawing.
- The Adafruit T-Cobbler Plus EagleCAD board, used as the geometric prior: https://github.com/adafruit/Adafruit-Pi-Cobber-PCBs, file "Adafruit T-Cobbler Plus.brd" (Eagle 6.6.0; Creative Commons Attribution/Share-Alike per the README). Values parsed from the file:
  - Outline 58.42 × 73.66 mm: the top bar spans y 0–15.24 mm, and the stem runs x 19.05–39.37 mm (20.32 mm wide), with 2.54 mm corner arcs.
  - 2×20 header, package RASPBERRYPI_B+_IDC: centred at (29.21, 5.08), rotated 90°, with pads on 2.54 mm, a 1.0 mm drill, and a 1.6764 mm pad diameter. Its outline layer spans about 9.0 × 58.4 mm.
  - Pin rows, package 1X20_ROUND: JP2 at x = 21.59 and JP1 at x = 36.83, so 15.24 mm (0.6") apart. Pads run y = 17.78 to 66.04 mm, and pad 1 is at the header end.
  - 2.5 mm plated mounting holes at (21.59, 71.12), (36.83, 71.12), (2.54, 12.7), (55.88, 12.7).
- Adafruit product page: https://www.adafruit.com/product/2028

Ribbon and IDC
- Farnell, color-coded ribbon cables, 1.27 mm: https://www.farnell.com/datasheets/296632.pdf
  - Color sequence: brown, red, orange, yellow, green, blue, violet, grey, white, black.
  - 28 AWG, 7/0.127 mm tinned stranded copper. PVC insulation, 9 mil average.
  - 40-way width 50.80 mm (±0.40).
  - 300 V, 105 °C.
- CP-40 multicolor ribbon: https://agelectronica.lat/pdfs/textos/C/CP-40-MULTICOLOR.PDF
  - 40 cores, 28 AWG, thickness 0.95 ± 0.1 mm, width 50.80 mm, pitch 1.27 mm.
  - Same color order.
- Hitachi rainbow ribbon: https://cdn.thomasnet.com/ccp/01041195/111575.pdf (same color code; 28 AWG 7/36).
- 3M IDC socket, 891 series, .100" × .100" for .050" cable: https://www.farnell.com/datasheets/1801392.pdf
  - Read the drawing visually for the body dimensions, the strain relief, the pin-1 triangle, and the polarization.
- 40-pin female IDC listing: https://www.cablesonline.com/40pinfemidcs.html (a cross-check only).
- 2×20 shrouded box header DC3-40P listing: https://www.harfington.com/en-de/products/p-2080975 (58.5 × 8.5 × 11.5 mm, 2.54 mm pitch, straight).
- Sullins box headers: https://datasheet.octopart.com/SBH11-PBPC-D10-RA-BK-Sullins-datasheet-181250547.pdf (centered polarizing key; .100" contact centers).

Dupont leads
- Pololu 0.1" crimp housings: https://www.pololu.com/product/1900. For a 1×n housing, B = n × 2.54 mm (1×1 → 2.54 mm).
- Typical jumper wire is 26–28 AWG (secondary source: https://keszoox.com/blogs/news/dupont-connector-complete-guide). Calibrate against the photos.

Blender
- Command-line arguments, 5.2 LTS manual: https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html
  - -b/--background
  - --factory-startup
  - -P/--python <file>
  - --python-exit-code <code>
  - -- passes the remaining args to sys.argv
  - -E/--engine
  - --cycles-device (CPU, METAL, …), placed after --
  - -c/--command, which implies background mode
- glTF 2.0 add-on, 5.2 LTS manual: https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html
  - Export supports Principled BSDF and unlit materials.
  - Occlusion is exported only through a "glTF Material Output" node group with an Occlusion input.
  - AO and tangent-space normals are baked with Cycles.
  - Export extensions:
    - KHR_draco_mesh_compression
    - KHR_lights_punctual
    - KHR_materials_clearcoat, transmission, unlit, emissive_strength, volume, sheen, specular, anisotropy, dispersion, ior, and variants
    - KHR_texture_transform
    - EXT_mesh_gpu_instancing
    - EXT_meshopt_compression and KHR_meshopt_compression
  - Images are PNG, JPEG, or WebP.
  - The manual notes that real-time support for transmission is not yet widespread.
- Blender MCP: https://github.com/ahujasid/mcp-for-blender (formerly blender-mcp). A Blender add-on runs a socket server, and an MCP server drives it. It can execute arbitrary Python in Blender.

Physics
- Macklin, Storey, Lu, Terdiman, Chentanez, Jeschke, Müller, "Small Steps in Physics Simulation", SCA 2019: https://mmacklin.com/smallsteps.pdf
  - n substeps with one XPBD iteration each are more effective than n iterations in one step.
- Müller, Ten Minute Physics, "Extended Position Based Dynamics": https://matthias-research.github.io/pages/tenMinutePhysics/09-xpbd.pdf
  - Series index: https://matthias-research.github.io/pages/tenMinutePhysics/index.html. The relevant episodes have code and demos in JavaScript:
    - 11, spatial hashing: 11-hashing.pdf
    - 14, cloth: 14-cloth.pdf
    - 15, cloth self-collision: 15-selfCollision.pdf
    - 25, joints with XPBD, useful for the clamped end frames: 25-joints.pdf
- Macklin, Müller, Chentanez, "XPBD: Position-Based Simulation of Compliant Constrained Dynamics", MIG 2016.
- Kim, Chentanez, Müller-Fischer, "Long Range Attachments — A Method to Simulate Inextensible Clothing in Computer Games", SCA 2012.

Board Sense
- RP1 peripherals datasheet (6.2). Checked on 2026-10-24, its pad description gives:
  - pull-up, pull-down, bus-keeper, and high-impedance modes
  - optional Schmitt hysteresis
  - drive strengths of 2, 4, 8, and 12 mA
  - input thresholds valid for a VDDIO between 2.5 V and 3.3 V by default
  - It gives no pull-resistor values and no VIH/VIL voltages.
- JEDEC JESD8C.01 (3.3 V interface levels): https://www.jedec.org/sites/default/files/docs/jesd8c-01.pdf. VIH minimum 2.0 V and VIL maximum 0.8 V, used as the ambiguity band (9).
- SunFounder kit polarity, used by 13.1:
  - 1.1.1 Blinking LED (https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.1.1%20Blinking_LED.html): 3.3 V → 220 Ω → LED anode, with the cathode on GPIO17. The LED lights when GPIO17 is low.
  - 2.1.1 Button (https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.1.1%20Button.html): pull-up configuration. GPIO18 reads HIGH released and LOW pressed. The LED on GPIO17 is active-low.
- Raspberry Pi, "PIOLib: A userspace library for PIO control": https://www.raspberrypi.com/news/piolib-a-userspace-library-for-pio-control/
  - The rp1-pio kernel driver gives user space access to RP1's PIO. Most calls are messages to RP1 firmware.
  - Only the state-machine FIFOs are reachable by DMA.
  - It's relevant to the presence-sensing spike (14.5).
- Prior art for row-level electrical sensing: Jumperless V5 scans every row's voltage and toggles pull-ups to tell floating rows from grounded ones (https://docs.jumperless.org/07-debugging/). That's the same principle Board Sense applies through the Pi's GPIOs.

Rendering
- three.js manual, Post-Processing with WebGPURenderer: https://threejs.org/manual/pages/webgpu-postprocessing.html
  - RenderPipeline with pass()
  - mrt({output, velocity})
  - TRAA from three/addons/tsl/display/TRAANode.js
  - Per a secondary source, PostProcessing was renamed RenderPipeline in r183, and depth of field was reimplemented in r181. Verify both against the installed version.
