# GPIO Dashboard

A desktop app (Tauri 2, React, Rust) for learning Raspberry Pi 5 GPIO with the SunFounder Basic
Starter Kit: verified breadboard tutorials, a circuit simulator, and a live connection to the Pi.

> **Status.** Version 2 ("Breadboard Studio") is in development on the `v2-breadboard-studio`
> branch; its specification is [`docs/v2/SPEC.md`](../docs/v2/SPEC.md) and its progress
> [`docs/v2/PROGRESS.md`](../docs/v2/PROGRESS.md). This README describes what exists today. The
> 3D studio, Board Sense on real hardware, and the Claude assistant are planned and not yet built.

## What it does

- **Connect** to a Pi over SSH (key or password) and open a terminal in the app (Ctrl/Cmd + \`).
- **Pinout**: the 40-pin header with each pin's name, BCM and WiringPi numbers, and its RP1
  functions, checked against the official Raspberry Pi documentation and the RP1 datasheet.
- **Tutorials**: the kit's projects, then extras tagged when they need parts the kit lacks. Each
  is a circuit document on the bench's breadboard placement (the T-board on columns d/h from
  row 1). On every test run it must pass the electrical rule check (ERC) with no errors, its
  simulation assertions, a code-versus-wiring pin check, and the kit's own polarity. Build
  steps and the hole-by-hole wiring table are generated from the document. Each tutorial's
  findings against the baseline are in [`docs/v2/AUDIT.md`](../docs/v2/AUDIT.md).
- **Workbench**: open a tutorial, sample or project file and
  - check it with the ERC, which covers shorts, 5 V into a GPIO, missing LED resistors,
    floating inputs, pin current limits, and lead reach;
  - simulate it: a modified-nodal-analysis solver, matched to ngspice within 2 % on its
    reference circuits, with models for the kit's parts and modules;
  - drive GPIOs, press buttons and move sliders, and see LED currents, rail draw and readings;
  - preview what Board Sense would read from each GPIO;
  - run the Python in the simulator (Pyodide, in virtual time) or on the Pi.
- **Run on Pi**: uploads the program, streams its output, and stops it on request, returning the
  pins it used to inputs. ERC errors block a run unless you override them.
- **Monitor**: live pin levels, modes and pulls from `pinctrl`, plus temperature, memory, disk
  and uptime, sent by a small agent on the Pi. The agent listens only on the Pi's loopback
  address; the app reaches it through the SSH connection.

## SSH host keys

Host keys are trusted on first use, like OpenSSH's `accept-new`. The first connection to a host and port records its key in `known_hosts` in the app config directory (`~/Library/Application Support/com.gpio-dashboard/` on macOS); later connections must present the same key. A changed key is refused with a message naming the file and line, and is never retried automatically. After reinstalling a Pi, delete that line to connect again. Servers that present a host certificate are refused, since the certificate authority is not checked.

## Getting started

Prerequisites: Node.js 20+, npm 10+, and the Rust stable toolchain ([rustup](https://rustup.rs)). On macOS, install the Xcode Command Line Tools; other platforms need the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). On the Pi: a Raspberry Pi 5 running Raspberry Pi OS with SSH enabled.

```bash
npm install
npm run dev        # the app, with the renderer hot-reloading
npm run web:dev    # just the renderer, in a browser at localhost:5173 (no Pi connection)
```

The Pi agent files in `pi-agent/` are compiled into the app (`src-tauri/src/agent.rs`), so restart `npm run dev` after editing them.

First run: open **Connect**, enter the Pi's address and user, choose key or password, and connect. Then deploy, install and start the agent from the same tab; **Monitor** shows live pins once it is running.

## Testing

```bash
npm test                         # Node tests for the bridge, then the Vitest suite
npm run lint && npm run typecheck
(cd src-tauri && cargo test)     # backend unit tests, and WebSocket and Anthropic-proxy tests against mock servers
src-tauri/live-tests.sh          # SSH tests against throwaway local sshd servers (macOS)
(cd pi-agent && python3 -m unittest -v)
```

`live-tests.sh` starts two OpenSSH servers on `127.0.0.1` with freshly generated keys (one refuses PTYs), runs the ignored integration tests against them, and removes everything afterwards.

## Building

```bash
npm run build                    # macOS: .app and .dmg in src-tauri/target/release/bundle/
npm run build -- --bundles app   # just the .app
```

On macOS the bundle is ad-hoc signed. Keychain access is tied to the app's code signature, so macOS may ask you to re-approve access to the saved SSH password after a rebuild. Set `APPLE_SIGNING_IDENTITY` to a certificate in your keychain before building to keep a stable identity across rebuilds.
