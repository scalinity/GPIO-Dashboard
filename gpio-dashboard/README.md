# GPIO Dashboard

### A Desktop IDE for Raspberry Pi GPIO — Visual Wiring, Live Monitoring, and AI-Assisted Tutorials

![Electron 39](https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite 7](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Tailwind 3](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)
![Zustand 5](https://img.shields.io/badge/Zustand-5-764ABC)
![Python 3](https://img.shields.io/badge/Python-3-3776AB?logo=python&logoColor=white)
![Raspberry Pi 5](https://img.shields.io/badge/Raspberry%20Pi-5-C51A4A?logo=raspberrypi&logoColor=white)
![OpenRouter AI](https://img.shields.io/badge/AI-OpenRouter-8A2BE2)

**GPIO Dashboard** is a production-grade cross-platform desktop application (macOS, Windows, Linux) that transforms a developer laptop into a fully instrumented IDE for Raspberry Pi hardware development. It fuses an Electron + React control plane with a self-deploying Python agent on the Pi to deliver **10 Hz live GPIO telemetry**, a **photo-realistic breadboard** with animated wiring overlays, an **interactive 40-pin pinout explorer**, an **embedded xterm.js SSH terminal**, an **in-app Python editor** with remote execution, and a **multi-model AI coding assistant** grounded in per-tutorial hardware context. The system ships with an **18-project SunFounder Basic Starter Kit curriculum** — each project carrying theory, wiring diagram, runnable code, and AI-generated variants — designed to take a learner from "blink an LED" to "read a temperature sensor over I2C" without leaving the window.

---

## Table of Contents

- [Motivation](#motivation)
- [Core Capabilities](#core-capabilities)
- [Tutorial Curriculum](#tutorial-curriculum)
- [AI Code Generation](#ai-code-generation)
- [Architecture](#architecture)
- [Pi Agent Internals](#pi-agent-internals)
- [Security Model](#security-model)
- [Technical Highlights](#technical-highlights)
- [Tech Stack](#tech-stack)
- [Project Scale](#project-scale)
- [Getting Started](#getting-started)
- [Building](#building)
- [Roadmap](#roadmap)
- [License](#license)

---

## Motivation

Learning hardware is bottlenecked by friction: toggling between a schematic PDF, a wiring tutorial tab, an SSH session, a text editor, a datasheet, and a multimeter breaks flow every few minutes and makes it hard to form the mental model of what the pins are actually doing. The GPIO sysfs and `pinctrl` tools answer "is the pin high or low right now?" but only when you ask — they give no temporal picture and no visual mapping to the breadboard in front of you.

GPIO Dashboard closes that loop. It brings the **wiring diagram, the live pin state, the code, the terminal, and an AI tutor** onto a single canvas, then keeps them in sync in real time. You point at physical pin 11 on the visual header; the renderer highlights BCM17, the breadboard shows exactly which row the jumper goes to, the live monitor shows the pin switching HIGH at 2 Hz, and your editor is one keystroke away from running the same script on the physical Pi. When something is wrong, you can describe it in natural language and the AI panel generates the fix with the tutorial's theory, components, and wiring already in its context window.

This is the project I wanted when I was starting with microcontrollers — an honest learning environment that respects that hardware is visual, temporal, and unforgiving, and that the right answer to "which pin is pin 11?" is to just show you, in color, on the device.

---

## Core Capabilities

### Live GPIO Monitoring at 10 Hz

A Python agent runs on the Pi and streams the state of all 28 BCM GPIO pins to the desktop app over WebSocket ten times a second. State is read via `pinctrl` — a hardware register read that **does not claim the pin**, so monitoring never conflicts with running scripts, `gpiod` consumers, or kernel drivers. When `gpiod` is available, line state is enriched with consumer name, friendly line name, and `used` flag so you can see *who* owns a pin, not just what voltage it's at.

- **Fast path deduplication** in the main process skips `JSON.parse` on unchanged payloads (the hottest code path in the system)
- **Per-pin change tracking** in the Zustand store flashes only mutated pins, avoiding whole-table repaints
- **Pin subscription filtering** — clients can request state for a subset of pins to reduce bandwidth during focused work
- **Animated change highlight** with a 200ms decay visually reinforces every edge without being distracting

### Interactive 40-Pin Pinout Explorer

Complete Raspberry Pi 5 header with physical, BCM, and WiringPi numbering, color-coded by pin type (GPIO / 3V3 / 5V / GND / I2C / SPI / UART / PCM / EEPROM), with alt-function listings and real-world usage notes (e.g. *"GPIO2: I2C1 Data, has 1.8kΩ pull-up to 3.3V"*). Clicking a pin opens a detail drawer with live state, pull-up/down configuration, direction, and current function. Connected pins fade in with a glow animation tied to the live telemetry stream.

### Photo-Realistic Breadboard Canvas

An SVG breadboard component renders the classic 63-row, 10-column layout with power rails and an authoritative coordinate system. A T-Cobbler adapter glyph maps every header pin to a breadboard tie-point. The **WiringOverlay** component overlays tutorial wiring as animated Bézier-curved jumpers — each wire draws itself in sequence using SVG stroke-dasharray animation, with color cues that match jumper conventions (red = power, black = ground, orange = GPIO signal). Components (LEDs, resistors, sensors, buttons) render as inline SVG primitives at the exact row/column they belong in.

### Embedded SSH Terminal & Python Editor

- **xterm.js terminal** with WebLinks + FitAddon running against a full PTY on the Pi (`xterm-256color`), resizable via `IPC → shell.setWindow`, and keyboard-toggleable via <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>`</kbd>
- **CodeMirror 6 editor** with Python language support, One-Dark theme, multi-cursor, and direct remote execution
- **Streaming remote execution**: code is SCP'd to `/tmp/gpio_dashboard/` via an SFTP stream (no temp files on disk), launched via `python3 -u` with line-buffered stdout/stderr, and output is piped back to the renderer in real time
- **Graceful process termination**: per-tutorial `pkill -f` scoped to the uploaded filename, followed by a safe `GPIO.cleanup()` kicked from a one-liner to reset any pins the script left in OUTPUT mode

### Multi-Session Shell Management

The `SSHManager` maintains a `Map<sessionId, Shell>` so multiple terminal panes can multiplex over a single SSH connection. Each shell has independent resize, data streaming, and lifecycle. Graceful shutdown drains up to 3 seconds per shell before the SSH client itself is terminated.

### System Info HUD

CPU temperature, memory usage, uptime, IP, hostname, Pi model, and disk usage are broadcast every 5 seconds via a parallel WebSocket channel. Displayed in the navbar so you always know the state of the machine you're pushing code to.

---

## Tutorial Curriculum

The app ships with **18 fully-authored tutorials** adapted from the SunFounder Basic Starter Kit, spanning six categories:

| Category     | Count | Representative Projects                                                        |
| ------------ | ----- | ------------------------------------------------------------------------------ |
| **Output**   | 6     | Blinking LED · RGB LED (PWM) · Breathing LED · Flowing LEDs · Active Buzzer · Relay Module |
| **Input**    | 2     | Button-Controlled LED · 4×4 Matrix Keypad                                      |
| **Display**  | 3     | LCD1602 via I2C · 7-Segment Display · 4-Digit 7-Segment Display                |
| **Sensor**   | 4     | PIR Motion Sensor · DHT11 Temperature & Humidity · Ultrasonic Distance · Analog Joystick (ADC) |
| **Motor**    | 2     | DC Motor with L293D H-Bridge · Servo Motor                                     |
| **Advanced** | 1     | Shift Register (74HC595)                                                       |

Each tutorial is a self-contained specification containing:

- **Components BOM** (quantity + part)
- **Theory section** (2-4 paragraphs of clinical explanation — *how the LED's forward voltage drop works, why PWM tricks the eye, what I2C's pull-ups do*)
- **Wiring table** (human-readable step-by-step instructions)
- **Declarative wiring diagram** — a structured object describing `wires[]`, `components[]`, `highlightPins[]`, `highlightRows[]` that the renderer turns into an animated SVG overlay
- **Canonical Python source** using `RPi.GPIO` in BCM mode with `try/finally` cleanup discipline
- **Difficulty** (Beginner / Intermediate / Advanced) with color-coded pills
- **Tips** — gotchas the student will hit if they skim

Completion state is persisted to `electron-store` so the library remembers what you've finished across launches.

---

## AI Code Generation

A per-tutorial chat panel powered by OpenRouter generates custom Python code tailored to the tutorial's hardware context. The system prompt is constructed from the tutorial's structured fields — title, description, components (`"1x RGB LED, 3x 220Ω Resistor"`), wiring table, theory excerpt (first 2000 chars), and the user's current editor buffer (first 8000 chars) — then bounded by a set of invariants that keep the output runnable:

```
Rules:
- Output ONLY valid Python code, no markdown fences
- Use import RPi.GPIO as GPIO
- Use BCM pin numbering: GPIO.setmode(GPIO.BCM)
- Always include GPIO.cleanup() in a try/finally block
- Use only the GPIO pins mentioned in the wiring above
- Keep code simple, well-commented, and educational
```

### Supported Models

| Model                         | Provider     | Notes                                  |
| ----------------------------- | ------------ | -------------------------------------- |
| `claude-opus-4.6`             | Anthropic    | Default — strongest reasoning          |
| `gpt-5.4`                     | OpenAI       | Fast general-purpose                   |
| `minimax-m2.5`                | MiniMax      | Cost-effective                         |
| `gemini-3.1-pro-preview`      | Google       | Strong at Python library knowledge     |
| `grok-4.20-multi-agent-beta`  | xAI          | Multi-agent variant                    |

### Configurable Reasoning Effort

Thinking level (`off` / `low` / `medium` / `high`) is passed through via OpenRouter's `reasoning.effort` parameter, letting the user trade latency for solution quality based on tutorial difficulty.

### Streaming Response Pipeline

- Server-Sent Events (SSE) stream token-by-token over `fetch` with `ReadableStream`
- In-flight `AbortController` is cancelled on every new request (no overlapping completions)
- Per-chunk deltas are forwarded to the renderer as `ai:chunk` IPC events and appended to the editor buffer live
- Trailing decoder flush ensures no partial UTF-8 multi-byte sequences are dropped

### Hardened Against Abuse

- **Model allowlist** — only whitelisted IDs are forwarded to OpenRouter; unknown models silently fall back to the default
- **Thinking level allowlist** — enum-validated before hitting the API
- **Prompt length cap** — 4000 character hard limit to prevent token stuffing
- **API key encryption** — stored via Electron's `safeStorage` (OS-level keychain-backed) and never returned to the renderer process
- **No key in renderer** — all outbound HTTPS from the main process; renderer only sees the streamed content

---

## Architecture

```
   ┌────────────────────────────────────────────────┐
   │                Electron Desktop App             │
   │                                                 │
   │  ┌─────────────────────────────────────────┐   │
   │  │        Renderer Process (React 19)       │   │
   │  │                                          │   │
   │  │  Pages:     Connect · Pinout ·           │   │
   │  │             Breadboard · Tutorials ·     │   │
   │  │             Monitor                      │   │
   │  │  Stores:    uiStore · connectionStore ·  │   │
   │  │             gpioStore · tutorialStore    │   │
   │  │  Editors:   CodeMirror 6 · xterm.js      │   │
   │  │  Canvas:    SVG breadboard + overlays    │   │
   │  └───────────────────┬─────────────────────┘   │
   │                      │ contextBridge (api.*)     │
   │  ┌───────────────────▼─────────────────────┐   │
   │  │     Preload (scoped, sandboxed)          │   │
   │  │   ssh · gpio · terminal · agent ·        │   │
   │  │   settings · ai                          │   │
   │  └───────────────────┬─────────────────────┘   │
   │                      │ ipcRenderer.invoke/on     │
   │  ┌───────────────────▼─────────────────────┐   │
   │  │          Main Process (Node.js)          │   │
   │  │                                          │   │
   │  │  SSHManager   (ssh2: connect/exec/shell) │   │
   │  │  WSClient     (ws: GPIO stream / auth)    │   │
   │  │  PiAgentDeployer (upload/install/start)  │   │
   │  │  electron-store + safeStorage            │   │
   │  │  OpenRouter SSE proxy                     │   │
   │  └──────┬───────────────────┬──────────────┘   │
   └─────────┼───────────────────┼──────────────────┘
             │ SSH port 22       │ WebSocket port 8765
             │ (SCP + exec)      │ (GPIO + sysinfo + exec)
   ┌─────────▼───────────────────▼──────────────────┐
   │             Raspberry Pi (Debian/RPi OS)        │
   │                                                 │
   │  ┌─────────────────────────────────────────┐   │
   │  │         pi-agent (Python asyncio)        │   │
   │  │                                          │   │
   │  │   agent.py         — WebSocket server    │   │
   │  │   gpio_monitor.py  — pinctrl + gpiod     │   │
   │  │   code_executor.py — subprocess + SIGINT │   │
   │  │   system_info.py   — /proc + /sys        │   │
   │  └──────────────────┬──────────────────────┘   │
   │                     │                           │
   │                 /dev/gpiochipN                   │
   │                 /sys/class/thermal                │
   │                 /proc/meminfo                     │
   │                     │                           │
   │  ┌──────────────────▼──────────────────────┐   │
   │  │       40-pin GPIO Header                 │   │
   │  │       28 BCM pins · I2C · SPI · UART    │   │
   │  └─────────────────────────────────────────┘   │
   └─────────────────────────────────────────────────┘
```

### Desktop App (Electron + React)

Strict three-tier Electron architecture with **`contextIsolation: true`**, **`sandbox: false`** (to enable `ssh2` native module access in main), and no direct `nodeIntegration` in the renderer. All privileged operations — file I/O, SSH, WebSocket, OpenRouter API calls, keychain access — execute in the main process; the renderer talks to them only through an explicit, namespaced `contextBridge` API (`window.api.ssh`, `window.api.gpio`, `window.api.terminal`, `window.api.agent`, `window.api.settings`, `window.api.ai`).

### Control Plane (SSH) vs. Data Plane (WebSocket)

**Two separate channels** to the Pi:

- **SSH (port 22)** — used for trust-establishing operations: agent deploy, install, start/stop, code SCP, shell sessions, one-shot commands, GPIO cleanup
- **WebSocket (port 8765)** — used for high-frequency streaming: 10 Hz GPIO telemetry, 0.2 Hz system info, live stdout from running scripts, agent status

The WebSocket is token-authenticated with a `secrets.token_urlsafe(32)` generated at agent startup, printed to the agent log, scraped by the desktop app via `head -5 agent.log`, then **immediately scrubbed from the file** with `sed -i '/AUTH_TOKEN=/d'` so the token never persists on disk.

### State Management (Zustand)

Four disjoint stores with narrow responsibilities:

| Store              | Concern                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `uiStore`          | Active tab, terminal visibility, panel layout                          |
| `connectionStore`  | SSH + agent status, connection config draft, error surface             |
| `gpioStore`        | 28-pin live state, per-pin change set, system info snapshot            |
| `tutorialStore`    | Selected tutorial, editor buffer, execution status, AI stream, history |

Per-pin selectors (`usePinState(bcm)`, `usePinChanged(bcm)`) ensure each `<PinRow>` only re-renders on changes to *its own* pin — the live monitor scales cleanly to all 28 pins changing every 100ms without frame drops.

---

## Pi Agent Internals

A compact asyncio Python server (~565 lines across four modules) that runs on the Pi and exposes three capabilities over a single WebSocket connection.

### GPIO Monitor (`gpio_monitor.py`)

Reads pin state via the `pinctrl` command — which queries hardware registers and **does not claim any pin**, so monitoring can coexist with running scripts. Parses the output with a compiled regex against lines like `2: ip    pd | hi // GPIO2 = input`, mapping:

| Field     | Values                                          |
| --------- | ----------------------------------------------- |
| Direction | `ip` → IN · `op` → OUT · (other) → ALT function |
| Pull      | `pu` → UP · `pd` → DOWN · `pn`/`--` → NONE      |
| Level     | `hi` → HIGH · `lo` → LOW                        |

Auto-detects the correct `gpiochip` based on Pi model — `gpiochip4` on Pi 5, `gpiochip0` on Pi 4 and earlier — by reading `/sys/firmware/devicetree/base/model`.

When `gpiod` is available, enriches each pin with `consumer`, `name`, and `used` fields read via `Chip.get_line_info()` — giving you visibility into *which process or kernel driver* is holding a pin.

### Code Executor (`code_executor.py`)

Async subprocess manager for running user scripts with proper POSIX process group handling:

- Scripts run with `start_new_session=True` so signals hit the entire process group, not just the Python interpreter
- `stop()` sends `SIGINT` to the whole group (matching Ctrl+C semantics — respects `KeyboardInterrupt` handlers that let scripts do `GPIO.cleanup()`)
- Falls back to `SIGKILL` after a 3-second grace window
- Stdout and stderr are read concurrently via `asyncio.Queue` and `asyncio.wait(return_when=FIRST_COMPLETED)` — no deadlocks, no line interleaving within a stream

### System Info (`system_info.py`)

Collects host vitals from `/sys` and `/proc` with no external dependencies:

- **CPU temp** — `/sys/class/thermal/thermal_zone0/temp` (milli-°C → °C)
- **Memory** — `/proc/meminfo` (MemTotal, MemAvailable → percent used)
- **Uptime** — `/proc/uptime` (→ "2d 3h 45m")
- **IP** — UDP socket trick to find the interface that would route to 8.8.8.8
- **Disk** — `os.statvfs('/')` (total/used/free GB + percent)
- **Model** — `/sys/firmware/devicetree/base/model`

### Idempotent Install Script (`install.sh`)

`bash install.sh` installs `python3-gpiod`, `python3-websockets`, `python3-rpi-lgpio` (RPi.GPIO drop-in for the Pi 5's new pinctrl framework), and `raspi-utils` / `raspberrypi-utils` for `pinctrl`. Adds the install user to the `gpio` group if it exists. Safe to re-run.

---

## Security Model

Defense-in-depth for a tool that connects to a remote machine and executes arbitrary code.

### Credential Protection

- **OS-native encryption** via Electron `safeStorage` for both SSH passwords and the OpenRouter API key — backed by macOS Keychain, Windows DPAPI, or `libsecret` on Linux
- **Renderer never sees secrets** — `settings:getAll` strips `connection.password` and `ai.apiKey` before returning
- **Keys stay in main process** — renderer only sees `hasApiKey: boolean`, never the key itself
- **`.pub` handling** — if the user selects `id_rsa.pub` as the SSH key, the app automatically reads the private key alongside it, matching OpenSSH's behavior
- **Dedicated `settings:setPassword` / `settings:setApiKey` channels** — writes go through `safeStorage.encryptString()` before hitting disk

### Input Validation & Allowlisting

| Surface                 | Allowlist / Validator                                                  |
| ----------------------- | ---------------------------------------------------------------------- |
| Tutorial script filename | `/^[a-zA-Z0-9_-]+\.py$/` — rejects path separators, `..`, shell metacharacters |
| SCP remote path         | Must start with `/tmp/gpio_dashboard/`, no `..`                        |
| SSH username (deploy)   | `/^[a-zA-Z0-9_-]+$/` — prevents path injection via `/home/${user}`     |
| Settings keys           | Hard-coded allowlist of 9 `ui.*` / `connection.*` / `ai.*` keys        |
| AI model                | Set-membership check against 5 known OpenRouter model IDs              |
| AI thinking level       | Enum: `off` / `low` / `medium` / `high`                                |
| AI prompt               | `typeof === 'string'` + non-empty + ≤ 4000 chars                       |

### Process Isolation

- **Context isolation** enabled; **no nodeIntegration** in renderer
- **Content Security Policy** in production: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`
- **Window open handler** forces all `target=_blank` / `window.open` URLs through `shell.openExternal` — no in-window navigation away from the app
- **Built-in pinch-zoom disabled** so wheel events reach the breadboard's pan/zoom handler, preventing silent DOM scaling surprises

### Automatic Reconnection with Safety Limits

- **SSH** — exponential backoff (1s → 2s → … → 30s cap), max 10 attempts, **auth errors suppress reconnect** (otherwise brute-force amplification)
- **WebSocket** — same backoff schedule, same 10-attempt ceiling
- **Graceful teardown** on `window-all-closed` — stops the remote agent, drains shells, then disconnects SSH

### GPIO Cleanup Guardrail

After any tutorial exits — whether via normal completion, Ctrl+C, or kill — the app can fire `GPIO.setmode(BCM); GPIO.cleanup()` over SSH to reset every pin to INPUT with no pull. This recovers from the classic "I left pin 17 as OUTPUT HIGH and now it's stuck at 3.3V" failure mode that damages circuits and confuses debugging.

---

## Technical Highlights

- **Hot-path dedup** in the WebSocket client compares raw JSON strings before parsing — a measurable CPU win at 10 Hz × 28 pins × 6+ fields per pin
- **Per-pin Zustand selectors** mean the live monitor's table rows are individually memoized; changing one pin re-renders exactly one `<PinRow>`
- **SVG wiring overlays** use `stroke-dasharray` animation for the classic "draw-in" effect with a staggered `begin` offset per wire
- **Coordinate system** (`breadboardCoords.js`) — a single source of truth for the breadboard's row/column geometry, shared by the static render, the wiring overlay, and the T-Cobbler glyph
- **Auto-detected Pi model** — runtime detection via device tree so the agent works on Pi 4, Pi 5, and Zero without configuration
- **Streaming code execution with process-group kill** — scripts respond to Ctrl+C semantics (so user `finally:` blocks that call `GPIO.cleanup()` actually run) instead of being SIGKILL'd
- **Pin subscription protocol** — clients can send `{"type":"subscribe","pins":[17,18,22]}` to get filtered state updates, reducing bandwidth when focused on a small set of pins
- **Agent log auth-token scrubbing** — token is scraped once on startup, then `sed -i '/AUTH_TOKEN=/d'` removes the line from the log file so subsequent `head agent.log` calls can't recover it
- **SCP via SFTP stream** — file uploads go through `sftp.createWriteStream()` so binary buffers stream directly without temp files on either host
- **Multi-session shell muxing** — one SSH client, many concurrent PTY streams, each with independent resize and lifecycle
- **Abortable AI streaming** — every new prompt cancels the previous `AbortController`, guaranteeing exactly one in-flight completion per tutorial

---

## Tech Stack

| Layer                  | Technology                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------- |
| **Desktop Shell**      | Electron 39 (`contextIsolation`, `safeStorage`, `dialog`, `shell.openExternal`)    |
| **Renderer**           | React 19, Vite 7 (electron-vite), Tailwind CSS 3                                   |
| **State**              | Zustand 5 with per-pin selectors                                                   |
| **Code Editor**        | CodeMirror 6 (`@codemirror/lang-python`, `@codemirror/theme-one-dark`)             |
| **Terminal Emulator**  | xterm.js 6 with FitAddon and WebLinksAddon                                         |
| **Iconography**        | lucide-react                                                                       |
| **Typography**         | Inter Variable (self-hosted) + JetBrains Mono                                      |
| **SSH**                | `ssh2` (pure-JS SSH2 client with SFTP, exec, shell, keepalive)                     |
| **WebSocket (client)** | `ws` 8.x                                                                           |
| **Persistence**        | `electron-store` with JSON-schema validation + `safeStorage` encryption layer      |
| **Build / Package**    | `electron-builder` (dmg, NSIS, AppImage, snap, deb)                                |
| **Pi Agent**           | Python 3, `asyncio`, `websockets` 12, `gpiod` 2, `pinctrl` (raspi-utils)           |
| **AI Provider**        | OpenRouter (Claude, GPT, Gemini, Grok, MiniMax) with SSE streaming                 |
| **Linting / Format**   | ESLint 9 (flat config, @electron-toolkit presets), Prettier 3                      |

---

## Project Scale

| Metric                              | Count                                     |
| ----------------------------------- | ----------------------------------------- |
| JS / JSX source files (app)         | ~40                                       |
| JS / JSX lines of code              | ~6,900                                    |
| Python source files (agent)         | 4                                         |
| Python lines of code                | ~565                                      |
| React components                    | 17                                        |
| Zustand stores                      | 4                                         |
| IPC channels                        | 30+                                       |
| `contextBridge` API namespaces      | 6 (ssh · gpio · terminal · agent · settings · ai) |
| Tutorials shipped                   | 18                                        |
| Tutorial categories                 | 6                                         |
| GPIO pins monitored                 | 28 (BCM 0-27)                             |
| Header pins modeled                 | 40                                        |
| Pin type classifications            | 9 (GPIO / 3V3 / 5V / GND / I2C / SPI / UART / PCM / EEPROM) |
| GPIO polling rate                   | 10 Hz                                     |
| System info rate                    | 0.2 Hz (every 5s)                         |
| OpenRouter models supported         | 5                                         |
| AI reasoning levels                 | 4 (off · low · medium · high)             |
| Packaging targets                   | 5 (dmg · NSIS · AppImage · snap · deb)    |

---

## Getting Started

### Prerequisites

- **Desktop:** Node.js 20+, npm 10+ (or bun/pnpm — a lockfile is included for npm)
- **Raspberry Pi:** Pi 4 or Pi 5 running Debian/Raspberry Pi OS with SSH enabled
- **OpenRouter API key** (optional — only needed for the AI panel)

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

Launches Vite's HMR for the renderer, hot-reloads the main process on changes, and opens the Electron window.

### First-Run Flow

1. Open the **Connect** tab. Enter your Pi's hostname or IP, username (`pi`), and pick SSH key or password auth.
2. Click **Connect** — the app establishes SSH and verifies the session.
3. Click **Deploy Agent** — `pi-agent/` is SCP'd to `/home/<user>/gpio-dashboard-agent/`.
4. Click **Install Agent** — runs `bash install.sh` on the Pi (installs Python deps + pinctrl).
5. Click **Start Agent** — launches `agent.py` under `nohup`, captures the one-time auth token, opens the WebSocket.
6. The GPIO, Pinout, Breadboard, and Tutorials tabs are now fully live.

---

## Building

```bash
# macOS (dmg + unsigned .app)
npm run build:mac

# Windows (NSIS installer)
npm run build:win

# Linux (AppImage + .deb + .snap)
npm run build:linux
```

Outputs land in `dist/` per the `electron-builder.yml` configuration.

---

## Roadmap

| Direction                         | Description                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Logic Analyzer View**           | Time-series chart of pin transitions with configurable buffer, CSV export, and trigger conditions          |
| **mDNS Discovery**                | Auto-discover Pis on the LAN via `_workstation._tcp.local` so connection setup is zero-config              |
| **systemd Service Install**       | Optional `install.sh` flag to register the agent as a system service for always-on monitoring              |
| **I2C / SPI Bus Explorer**        | `i2cdetect`-style visualization + live read/write for connected peripherals (sensors, displays, EEPROMs)  |
| **PWM Scope**                     | Oscilloscope-style visualization of PWM outputs with measured frequency and duty cycle                     |
| **Breadboard Editor**             | Drag-and-drop component placement that generates the declarative `wiringDiagram` object automatically     |
| **Tutorial Authoring UI**         | In-app editor for the tutorial JSON schema so users can publish their own projects                         |
| **Multi-Pi Support**              | Named connections, per-Pi state, fast switching between multiple target boards                            |
| **Hardware Abstraction Layer**    | Plugin API for non-Pi SBCs (Jetson, Rock Pi, Orange Pi) using the same renderer and tutorial format       |
| **On-Device LLM Option**          | Route AI requests through a local `llama.cpp` server for offline / air-gapped learning environments        |

---

## License

See repository license file.

---

<p align="center">
  <em>Making the invisible visible — because the best way to learn a pin is to watch it flip.</em>
</p>
