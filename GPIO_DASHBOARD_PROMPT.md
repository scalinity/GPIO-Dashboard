# GPIO Dashboard - Desktop Application Build Prompt

## How To Use This Prompt
Paste this entire document into a new Claude Code session in **plan mode**. It contains everything needed to plan and build the application from scratch. After the plan is approved, exit plan mode and begin implementation phase by phase.

---

## 1. Context & Vision

**Who I am:** A complete beginner to Raspberry Pi, breadboards, GPIO pins, and electronics. I have a Raspberry Pi 5 and a SunFounder Basic Starter Kit (https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/index.html).

**What I want:** A polished desktop application called **GPIO Dashboard** that runs on my Mac and connects to my Raspberry Pi 5 over the local network. It should be my single learning hub — showing me what every GPIO pin does, visualizing my breadboard + T-cobbler wiring, walking me through each kit tutorial step-by-step, and letting me deploy & run code on the Pi with one click while watching the GPIO states change in real-time.

**Why not a webpage:** I want native desktop features — SSH tunneling, persistent connections, system tray presence, native notifications when code finishes running, and no browser tab management. This should feel like a real tool, not a web page.

**Core value propositions:**
1. **Interactive Reference** — Never Google a pin number again. The full GPIO pinout is always one click away, with all 3 numbering systems (BCM, Board, WiringPi), color-coded by function.
2. **Live Hardware Mirror** — See real-time HIGH/LOW states of every GPIO pin overlaid on the breadboard/T-cobbler diagram. When I press a button wired to GPIO17, I see it go LOW on screen instantly.
3. **One-Click Tutorial Runner** — Select a tutorial, see the wiring diagram, click "Run," and the Python code deploys to the Pi and executes. Terminal output streams back live. A "Stop" button kills it cleanly.
4. **Learn By Doing** — Each tutorial has theory, component explanations, wiring tables, and annotated Python code. The breadboard view highlights exactly which pins and rows to wire for the selected tutorial.

---

## 2. Tech Stack

### Desktop Framework: Electron
- **Why Electron:** Mature ecosystem, excellent SSH libraries (ssh2, node-ssh), built-in terminal emulation (xterm.js), proven for developer tools. The ~200MB size is acceptable for a learning tool.
- **Frontend:** React 18+ with Vite (for fast HMR during development)
- **Styling:** Tailwind CSS 3+ (dark theme, utility-first)
- **State Management:** Zustand (lightweight, minimal boilerplate)
- **Icons:** Lucide React
- **Code Editor:** CodeMirror 6 (for viewing/editing tutorial Python code)
- **Terminal:** xterm.js (for embedded SSH terminal)
- **SSH:** ssh2 (Node.js native SSH2 client, runs in Electron main process)
- **Packaging:** electron-builder (for creating .dmg/.app)

### Pi-Side Agent: Python
- **GPIO Library:** `gpiod` (libgpiod Python bindings) — this is CRITICAL because RPi.GPIO does NOT work on Raspberry Pi 5. The Pi 5 uses the RP1 chip and requires gpiod with `/dev/gpiochip4`.
- **WebSocket Server:** `websockets` (async Python WebSocket library)
- **Process Management:** Managed by systemd (auto-start optional)
- The desktop app auto-deploys this agent to the Pi on first connection via SCP.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                 DESKTOP APP (Mac)                     │
│  ┌───────────────────────────────────────────────┐   │
│  │           Electron Main Process                │   │
│  │  ┌─────────────┐  ┌──────────────────────┐    │   │
│  │  │ SSH Manager  │  │ WebSocket Client     │    │   │
│  │  │ (ssh2)       │  │ (connects to Pi agent)│   │   │
│  │  │ - Connect    │  │ - GPIO state stream   │   │   │
│  │  │ - Execute    │  │ - System metrics      │   │   │
│  │  │ - SCP files  │  │ - 10Hz update rate    │   │   │
│  │  └──────┬───────┘  └──────────┬───────────┘   │   │
│  └─────────┼─────────────────────┼────────────────┘  │
│            │ IPC (contextBridge) │                     │
│  ┌─────────┼─────────────────────┼────────────────┐  │
│  │         ▼   Electron Renderer Process          │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │              React App                    │  │  │
│  │  │  ┌────────┐ ┌────────┐ ┌──────────────┐  │  │  │
│  │  │  │GPIO    │ │Bread-  │ │ Tutorials    │  │  │  │
│  │  │  │Pinout  │ │board   │ │ + Code Runner│  │  │  │
│  │  │  │View    │ │Live    │ │ + Terminal   │  │  │  │
│  │  │  │        │ │View    │ │              │  │  │  │
│  │  │  └────────┘ └────────┘ └──────────────┘  │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────┬────────────────────────────────┘
                       │ SSH + WebSocket (LAN)
                       ▼
┌──────────────────────────────────────────────────────┐
│              RASPBERRY PI 5                           │
│  ┌────────────────────────────────────────────────┐  │
│  │           Pi Agent (Python)                     │  │
│  │  ┌─────────────────┐  ┌─────────────────────┐  │  │
│  │  │ GPIO Monitor    │  │ WebSocket Server    │  │  │
│  │  │ (gpiod)         │  │ (port 8765)         │  │  │
│  │  │ - Read all pins │  │ - Stream states     │  │  │
│  │  │ - Detect changes│  │ - Accept commands   │  │  │
│  │  │ - Track mode    │  │ - Report metrics    │  │  │
│  │  └─────────────────┘  └─────────────────────┘  │  │
│  │  ┌─────────────────┐                           │  │
│  │  │ Code Executor   │                           │  │
│  │  │ - Sandbox runs  │                           │  │
│  │  │ - Capture stdout│                           │  │
│  │  │ - Clean shutdown│                           │  │
│  │  └─────────────────┘                           │  │
│  └────────────────────────────────────────────────┘  │
│  ┌─────────────┐                                     │
│  │ 40-Pin GPIO │──── Ribbon Cable ──── T-Cobbler     │
│  │   Header    │                      on Breadboard  │
│  └─────────────┘                                     │
└──────────────────────────────────────────────────────┘
```

### Data Flow for Live GPIO Monitoring
1. Pi Agent reads all GPIO pin states via `gpiod` at 10Hz
2. Agent sends JSON state updates over WebSocket to desktop app
3. Electron main process receives WebSocket data, forwards via IPC to renderer
4. React components update the GPIO pinout diagram and breadboard view in real-time
5. Pins that change state get a brief animation/pulse effect

### Data Flow for Tutorial Code Execution
1. User selects a tutorial and clicks "Run"
2. Electron main process SCPs the Python file to the Pi (`/tmp/gpio_dashboard/`)
3. Main process sends SSH exec command: `python3 /tmp/gpio_dashboard/<script>.py`
4. stdout/stderr streams back via SSH channel → IPC → React terminal component
5. User clicks "Stop" → SSH sends SIGINT to the process
6. GPIO state changes from the running code are visible in real-time on the breadboard view

---

## 4. Project Structure

```
gpio-dashboard/
├── package.json
├── electron-builder.yml
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── electron/
│   ├── main.js                  # Electron main process entry
│   ├── preload.js               # Context bridge (IPC API)
│   ├── ssh-manager.js           # SSH connection, exec, SCP
│   ├── ws-client.js             # WebSocket client to Pi agent
│   └── pi-agent-deployer.js     # Deploy agent to Pi via SCP
├── pi-agent/                    # Deployed to the Pi
│   ├── agent.py                 # Main agent entry point
│   ├── gpio_monitor.py          # GPIO state monitoring (gpiod)
│   ├── code_executor.py         # Safe code execution
│   ├── requirements.txt         # Python dependencies
│   └── install.sh               # Agent installation script
├── src/                         # React frontend
│   ├── main.jsx                 # React entry
│   ├── index.css                # Tailwind directives + custom styles
│   ├── App.jsx                  # Root component with navigation
│   ├── store/
│   │   ├── connectionStore.js   # Pi connection state (Zustand)
│   │   ├── gpioStore.js         # Live GPIO state (Zustand)
│   │   └── tutorialStore.js     # Active tutorial state (Zustand)
│   ├── data/
│   │   ├── pins.js              # Complete 40-pin GPIO reference
│   │   └── tutorials.js         # All 17 kit tutorials
│   ├── components/
│   │   ├── Navbar.jsx           # Top navigation bar
│   │   ├── ConnectionStatus.jsx # Pi connection indicator
│   │   ├── GpioHeader.jsx       # Interactive 40-pin GPIO diagram
│   │   ├── PinDetail.jsx        # Pin detail panel/popup
│   │   ├── Breadboard.jsx       # Breadboard + T-cobbler SVG
│   │   ├── BreadboardPin.jsx    # Individual breadboard pin (with live state)
│   │   ├── TutorialCard.jsx     # Tutorial list item
│   │   ├── TutorialDetail.jsx   # Full tutorial view
│   │   ├── CodeEditor.jsx       # CodeMirror Python editor
│   │   ├── Terminal.jsx         # xterm.js SSH terminal
│   │   └── LiveMonitor.jsx      # GPIO state table
│   └── pages/
│       ├── ConnectPage.jsx      # Pi connection setup
│       ├── PinoutPage.jsx       # GPIO pinout reference
│       ├── BreadboardPage.jsx   # Live breadboard view
│       ├── TutorialsPage.jsx    # Tutorial browser
│       └── MonitorPage.jsx      # Live GPIO monitor table
├── public/
│   └── icons/                   # App icons
└── index.html
```

---

## 5. Feature Specifications

### 5.1 Connection Manager (ConnectPage)
**Purpose:** First screen the user sees. Connect to the Pi over the local network.

**UI Elements:**
- Large, friendly heading: "Connect to your Raspberry Pi"
- Input fields: Hostname/IP (default: `raspberrypi.local`), Port (default: `22`), Username (default: `pi`), Password
- "Connect" button with loading spinner
- Connection status: disconnected (red dot), connecting (yellow pulse), connected (green dot)
- After first successful connection, show "Install GPIO Agent" button
- Agent status indicator: not installed, installing, running, stopped
- Save connection settings locally (electron-store) so user doesn't re-enter every time

**Backend (main process):**
- Use `ssh2` library to establish SSH connection
- Test connection before marking as connected
- Deploy pi-agent via SCP to `/home/<user>/gpio-dashboard-agent/`
- Run `install.sh` which: installs Python deps (gpiod, websockets), creates systemd service
- Start WebSocket client to connect to agent on Pi port 8765
- Handle connection drops gracefully with auto-reconnect

### 5.2 GPIO Pinout Reference (PinoutPage)
**Purpose:** Interactive visual reference of all 40 GPIO pins.

**Layout:**
- Center: Large visual representation of the 40-pin header (2 columns × 20 rows)
- Each pin is a rounded rectangle/circle, color-coded by type
- Pin labels show: BCM number, physical pin number, and function name
- Left column = odd pins (1, 3, 5, ..., 39), Right column = even pins (2, 4, 6, ..., 40)
- Above the header: small Raspberry Pi 5 board outline for orientation

**Interactions:**
- **Hover:** Pin enlarges slightly, shows tooltip with full pin details
- **Click:** Opens detail panel on the right side showing:
  - Pin name, all numbering systems
  - Electrical specs (3.3V logic, max current)
  - Available alternate functions
  - Which kit tutorials use this pin
  - Current live state (if connected to Pi): direction, value, pull-up/down
- **Search bar:** Filter pins by name, number, or function (e.g., typing "SPI" highlights all SPI pins)
- **Filter buttons:** Toggle visibility by type (Power, Ground, GPIO, I2C, SPI, UART, PWM)
- **Live overlay (when connected):** Small arrow icon on each pin showing direction (IN/OUT), colored dot showing HIGH (green) / LOW (dim)

**Color scheme for pin types:**
- 3.3V Power: `#F97316` (orange-500)
- 5V Power: `#EF4444` (red-500)
- Ground: `#374151` (gray-700) with white text
- GPIO (general): `#10B981` (emerald-500)
- I2C (SDA/SCL): `#3B82F6` (blue-500)
- SPI (MOSI/MISO/SCLK/CE): `#8B5CF6` (violet-500)
- UART (TX/RX): `#06B6D4` (cyan-500)
- PWM: `#F59E0B` (amber-500)
- EEPROM (ID_SD/ID_SC): `#6B7280` (gray-500)

### 5.3 Breadboard + T-Cobbler Live View (BreadboardPage)
**Purpose:** Visual representation of the physical breadboard with the T-cobbler plugged in, showing live GPIO states.

**Breadboard Layout (half-size 400 tie-point):**
- Top and bottom power rails: red (+) and blue (-) strips
- Main area: columns a-e (left of center gap) and f-j (right of center gap)
- Rows numbered 1-30
- Center gap separates the two halves

**T-Cobbler Placement:**
- The T-cobbler body spans across the center gap (columns e and f)
- It occupies rows 1-20 (20 rows for 40 pins, 20 per side)
- Left side (column e, rows 1-20) = odd physical pins: 1, 3, 5, ..., 39
- Right side (column f, rows 1-20) = even physical pins: 2, 4, 6, ..., 40
- The ribbon cable extends from the top of the cobbler (visual indicator showing it connects to the Pi)
- Each pin on the cobbler is labeled with its BCM name and color-coded by type

**Live State Indicators:**
- Each GPIO pin on the cobbler shows a small LED-like indicator
- GREEN glow = HIGH (3.3V), DIM/OFF = LOW (0V)
- Subtle pulse animation when a pin changes state
- Input pins show a different icon than output pins (arrow in vs arrow out)
- Power pins (3.3V, 5V) always show as active (bright)
- Ground pins show as dark/neutral

**Tutorial Wiring Overlay:**
- When a tutorial is selected (from the Tutorials tab), the breadboard view highlights:
  - The specific cobbler pins used (pulsing outline)
  - Jumper wire paths drawn from cobbler pins to component positions
  - Component symbols placed on the breadboard (LED symbol, resistor symbol, etc.)
  - Color-coded jumper wires matching the wiring instructions
- This overlay helps the user wire up the circuit before running the tutorial

### 5.4 Tutorial System (TutorialsPage)
**Purpose:** Step-by-step guided tutorials for all 17 projects in the SunFounder Basic Starter Kit.

**Tutorial Browser (list view):**
- Card grid showing all tutorials organized by category:
  - **Output (9 tutorials):** Blinking LED, RGB LED, LED Dot Matrix, 7-Segment Display, Active Buzzer, Passive Buzzer, Motor, Relay, LED Bar Graph
  - **Input (6 tutorials):** Button, Tilt Switch, Potentiometer, Photoresistor, Thermistor, DHT-11
  - **Extension (2 tutorials):** Adjustable Fan, Morse Code Generator
- Each card shows: tutorial number, title, difficulty badge (Beginner/Intermediate/Advanced), component icons, brief description
- Filter by category and difficulty
- Progress tracking: completed tutorials get a checkmark

**Tutorial Detail View (when a tutorial is selected):**
Split into sections with a vertical stepper/progress indicator:

1. **Introduction** — What you'll learn, what you'll build
2. **Components Needed** — List with brief descriptions of each component (what it is, how it works)
3. **Theory / How It Works** — Beginner-friendly explanation of the electronics concepts
4. **Wiring** — Pin connection table (T-Board Name, Physical Pin, WiringPi, BCM) + "View on Breadboard" button that switches to the Breadboard tab with the overlay active
5. **Code** — Python code displayed in CodeMirror editor with syntax highlighting. Fully annotated with comments. User can edit the code before running.
6. **Run** — Action section:
   - "Deploy & Run" button → sends code to Pi and executes
   - Live terminal output panel (xterm.js, shows stdout/stderr in real-time)
   - "Stop" button → sends SIGINT
   - Status indicator: idle, deploying, running, completed, error
7. **Tips & Troubleshooting** — Common issues and solutions
8. **Next Steps** — Link to the next tutorial in the sequence

**Code Execution Flow:**
1. Click "Deploy & Run"
2. Code from the editor is saved to a temp file
3. SCP transfers file to Pi at `/tmp/gpio_dashboard/tutorial_<id>.py`
4. SSH exec: `cd /tmp/gpio_dashboard && python3 tutorial_<id>.py`
5. stdout/stderr piped back to the terminal component in real-time
6. GPIO state changes reflected on the breadboard view simultaneously
7. "Stop" sends `kill -SIGINT <pid>` via SSH
8. On completion, show success message with output summary

### 5.5 Live GPIO Monitor (MonitorPage)
**Purpose:** Table view of all GPIO pin states in real-time. Think of it as a digital multimeter for all pins at once.

**UI:**
- Table with columns: BCM #, Physical Pin #, Name, Direction (IN/OUT/ALT), State (HIGH/LOW), Pull (UP/DOWN/NONE)
- Only shows the 28 GPIO pins (not power/ground)
- Rows highlight/flash when state changes
- Filter: show all, show only active, show only inputs, show only outputs
- Refresh rate indicator: "10 Hz" with live sparkline showing update rate
- System info sidebar: Pi model, CPU temp, memory usage, uptime, IP address

### 5.6 Embedded Terminal
**Purpose:** Full SSH terminal for direct Pi access when tutorials aren't enough.

**Implementation:**
- xterm.js with a proper shell session (not just command execution)
- Accessible as a slide-up panel from any page (toggle with keyboard shortcut)
- Command history persists across sessions
- Supports colors, cursor movement, full PTY emulation
- Pre-configured with the SSH connection from the Connection Manager

---

## 6. Pi-Side Agent Specification

### agent.py — Main Entry Point
```python
#!/usr/bin/env python3
"""
GPIO Dashboard Pi Agent
Monitors GPIO pin states and serves them over WebSocket.
Designed for Raspberry Pi 5 (RP1 chip, /dev/gpiochip4).
"""
import asyncio
import json
import signal
import subprocess
import gpiod
import websockets

PI5_GPIO_CHIP = "/dev/gpiochip4"  # Pi 5 specific
WEBSOCKET_PORT = 8765
UPDATE_INTERVAL = 0.1  # 10Hz

# GPIO pins to monitor (BCM numbers, all user-accessible GPIOs)
MONITOR_PINS = [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27]
```

### Key Agent Behaviors:
1. **On start:** Open gpiod chip, request all GPIO lines as inputs (non-exclusive, just monitoring)
2. **Every 100ms:** Read all pin values, build state JSON, broadcast to WebSocket clients
3. **Handle "execute" commands:** Receive code execution requests via WebSocket, spawn subprocess, pipe stdout back
4. **Graceful shutdown:** Release all GPIO lines, close WebSocket server
5. **Health check:** Respond to ping with system info (model, temp, memory, uptime)

### State JSON format (sent 10x/second):
```json
{
  "type": "gpio_state",
  "timestamp": 1710300000.123,
  "pins": {
    "2":  {"value": 1, "direction": "in"},
    "3":  {"value": 1, "direction": "in"},
    "4":  {"value": 0, "direction": "out"},
    "17": {"value": 1, "direction": "out"}
  },
  "system": {
    "cpu_temp": 45.2,
    "memory_percent": 32.5,
    "uptime_seconds": 3600
  }
}
```

### install.sh
```bash
#!/bin/bash
# Install GPIO Dashboard agent on Raspberry Pi 5
sudo apt-get update && sudo apt-get install -y python3-gpiod python3-websockets
# Create systemd service for optional auto-start
# Make agent executable
chmod +x agent.py
```

### CRITICAL Pi 5 Notes:
- **Must use `/dev/gpiochip4`** for user GPIO on Pi 5 (NOT gpiochip0 which is the RP1 internal)
- **RPi.GPIO does NOT work on Pi 5** — always use `gpiod` or `lgpio`
- **The tutorial Python code uses RPi.GPIO** — the agent should NOT interfere with tutorial code. The agent monitors pin states in read-only mode. When a tutorial script runs and uses RPi.GPIO/lgpio/gpiozero, the agent reads the resulting pin states via gpiod.
- **Permission:** User may need to be in the `gpio` group, or the agent runs with appropriate permissions

---

## 7. Complete GPIO Pin Reference Data (Raspberry Pi 5)

This is the COMPLETE 40-pin header data. Use this as the source of truth for `src/data/pins.js`.

```
Physical | Name/Function     | BCM | WiringPi | Type     | Alt Functions           | Description
---------|-------------------|-----|----------|----------|-------------------------|------------------------------------------
1        | 3.3V Power        | -   | -        | power33  | -                       | 3.3V power supply (max 50mA shared)
2        | 5V Power          | -   | -        | power5   | -                       | 5V power supply (from USB-C input)
3        | GPIO2 / SDA1      | 2   | 8        | i2c      | SDA1, I2C               | I2C data line (1.8kΩ pull-up to 3.3V)
4        | 5V Power          | -   | -        | power5   | -                       | 5V power supply
5        | GPIO3 / SCL1      | 3   | 9        | i2c      | SCL1, I2C               | I2C clock line (1.8kΩ pull-up to 3.3V)
6        | Ground            | -   | -        | ground   | -                       | Ground reference (0V)
7        | GPIO4 / GPCLK0    | 4   | 7        | gpio     | GPCLK0                  | General purpose clock
8        | GPIO14 / TXD0     | 14  | 15       | uart     | TXD0, UART transmit     | UART serial transmit
9        | Ground            | -   | -        | ground   | -                       | Ground reference
10       | GPIO15 / RXD0     | 15  | 16       | uart     | RXD0, UART receive      | UART serial receive
11       | GPIO17            | 17  | 0        | gpio     | SPI1_CE1                | General purpose I/O (most used in tutorials)
12       | GPIO18 / PWM0     | 18  | 1        | pwm      | PCM_CLK, PWM0           | Hardware PWM channel 0
13       | GPIO27            | 27  | 2        | gpio     | -                       | General purpose I/O
14       | Ground            | -   | -        | ground   | -                       | Ground reference
15       | GPIO22            | 22  | 3        | gpio     | -                       | General purpose I/O
16       | GPIO23            | 23  | 4        | gpio     | -                       | General purpose I/O
17       | 3.3V Power        | -   | -        | power33  | -                       | 3.3V power supply
18       | GPIO24            | 24  | 5        | gpio     | -                       | General purpose I/O
19       | GPIO10 / SPI_MOSI | 10  | 12       | spi      | SPI0_MOSI               | SPI master-out-slave-in
20       | Ground            | -   | -        | ground   | -                       | Ground reference
21       | GPIO9 / SPI_MISO  | 9   | 13       | spi      | SPI0_MISO               | SPI master-in-slave-out
22       | GPIO25            | 25  | 6        | gpio     | -                       | General purpose I/O
23       | GPIO11 / SPI_SCLK | 11  | 14       | spi      | SPI0_SCLK               | SPI serial clock
24       | GPIO8 / SPI_CE0   | 8   | 10       | spi      | SPI0_CE0                | SPI chip enable 0
25       | Ground            | -   | -        | ground   | -                       | Ground reference
26       | GPIO7 / SPI_CE1   | 7   | 11       | spi      | SPI0_CE1                | SPI chip enable 1
27       | GPIO0 / ID_SD     | 0   | 30       | eeprom   | ID_SD, I2C EEPROM data  | HAT ID EEPROM (reserved, do not use)
28       | GPIO1 / ID_SC     | 1   | 31       | eeprom   | ID_SC, I2C EEPROM clock | HAT ID EEPROM (reserved, do not use)
29       | GPIO5             | 5   | 21       | gpio     | -                       | General purpose I/O
30       | Ground            | -   | -        | ground   | -                       | Ground reference
31       | GPIO6             | 6   | 22       | gpio     | -                       | General purpose I/O
32       | GPIO12 / PWM0     | 12  | 26       | pwm      | PWM0                    | Hardware PWM channel 0 (alt)
33       | GPIO13 / PWM1     | 13  | 23       | pwm      | PWM1                    | Hardware PWM channel 1
34       | Ground            | -   | -        | ground   | -                       | Ground reference
35       | GPIO19 / SPI1_MISO| 19  | 24       | spi      | SPI1_MISO, PCM_FS       | SPI1 master-in-slave-out
36       | GPIO16 / SPI1_CE2 | 16  | 27       | spi      | SPI1_CE2                | SPI1 chip enable 2
37       | GPIO26            | 26  | 25       | gpio     | -                       | General purpose I/O
38       | GPIO20 / SPI1_MOSI| 20  | 28       | spi      | SPI1_MOSI               | SPI1 master-out-slave-in
39       | Ground            | -   | -        | ground   | -                       | Ground reference
40       | GPIO21 / SPI1_SCLK| 21  | 29       | spi      | SPI1_SCLK               | SPI1 serial clock
```

### T-Cobbler Pin Layout on Breadboard
When the T-cobbler is placed across the breadboard center gap with the ribbon cable going toward the Pi:

```
        Left (col e)              Right (col f)
Row 1:  3V3     (Pin 1)          5V      (Pin 2)
Row 2:  GPIO2   (Pin 3)  SDA     5V      (Pin 4)
Row 3:  GPIO3   (Pin 5)  SCL     GND     (Pin 6)
Row 4:  GPIO4   (Pin 7)          GPIO14  (Pin 8)  TXD
Row 5:  GND     (Pin 9)          GPIO15  (Pin 10) RXD
Row 6:  GPIO17  (Pin 11)         GPIO18  (Pin 12) PWM
Row 7:  GPIO27  (Pin 13)         GND     (Pin 14)
Row 8:  GPIO22  (Pin 15)         GPIO23  (Pin 16)
Row 9:  3V3     (Pin 17)         GPIO24  (Pin 18)
Row 10: GPIO10  (Pin 19) MOSI    GND     (Pin 20)
Row 11: GPIO9   (Pin 21) MISO    GPIO25  (Pin 22)
Row 12: GPIO11  (Pin 23) SCLK    GPIO8   (Pin 24) CE0
Row 13: GND     (Pin 25)         GPIO7   (Pin 26) CE1
Row 14: GPIO0   (Pin 27) ID_SD   GPIO1   (Pin 28) ID_SC
Row 15: GPIO5   (Pin 29)         GND     (Pin 30)
Row 16: GPIO6   (Pin 31)         GPIO12  (Pin 32) PWM
Row 17: GPIO13  (Pin 33) PWM     GND     (Pin 34)
Row 18: GPIO19  (Pin 35)         GPIO16  (Pin 36)
Row 19: GPIO26  (Pin 37)         GPIO20  (Pin 38)
Row 20: GND     (Pin 39)         GPIO21  (Pin 40)
```

---

## 8. Complete Kit Tutorial Data (17 Projects)

Use this data for `src/data/tutorials.js`. Each tutorial should include all fields shown.

### OUTPUT TUTORIALS

#### 1.1.1 Blinking LED
- **Category:** Output > Displays
- **Difficulty:** Beginner (start here!)
- **Description:** Your first GPIO project. Control an LED by toggling a GPIO pin between HIGH and LOW. Learn how digital output works.
- **Components:** 1x LED (any color), 1x 220Ω resistor, jumper wires, breadboard
- **Theory:** An LED (Light Emitting Diode) only allows current to flow in one direction. The long leg is the anode (+), the short leg is the cathode (-). A resistor limits current to protect the LED. When GPIO17 goes LOW (0V), current flows from 3.3V through the resistor and LED to ground, turning it on.
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM |
  |---|---|---|---|
  | GPIO17 | 11 | 0 | 17 |
  - Connect 220Ω resistor from 3.3V rail to LED anode (long leg)
  - Connect LED cathode (short leg) to GPIO17 on the T-cobbler
  - LED turns ON when GPIO17 is LOW (sinking current)
- **Python Code:**
```python
#!/usr/bin/env python3
import RPi.GPIO as GPIO
import time

LED_PIN = 17  # BCM pin number (physical pin 11)

def setup():
    GPIO.setmode(GPIO.BCM)       # Use BCM pin numbering
    GPIO.setup(LED_PIN, GPIO.OUT) # Set pin as output
    GPIO.output(LED_PIN, GPIO.HIGH) # Start with LED off

def main():
    setup()
    print("LED Blinking! Press Ctrl+C to stop.")
    try:
        while True:
            GPIO.output(LED_PIN, GPIO.LOW)  # LED ON (active low)
            print("LED ON")
            time.sleep(0.5)
            GPIO.output(LED_PIN, GPIO.HIGH) # LED OFF
            print("LED OFF")
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        GPIO.cleanup()

if __name__ == '__main__':
    main()
```
- **Tips:** If LED doesn't light up, try reversing it (swap anode/cathode). Always use a resistor! Without one, too much current will destroy the LED.

#### 1.1.2 RGB LED
- **Category:** Output > Displays
- **Difficulty:** Beginner
- **Description:** Control a common-cathode RGB LED to create any color by mixing red, green, and blue. Introduces PWM (Pulse Width Modulation) for variable brightness.
- **Components:** 1x RGB LED (common cathode), 3x 220Ω resistor, jumper wires
- **Theory:** An RGB LED contains 3 tiny LEDs (red, green, blue) in one package. By varying the brightness of each using PWM, you can mix colors. PWM rapidly switches a pin on/off — the ratio of on-time to off-time (duty cycle) controls perceived brightness.
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM |
  |---|---|---|---|
  | GPIO17 | 11 | 0 | 17 |
  | GPIO18 | 12 | 1 | 18 |
  | GPIO27 | 13 | 2 | 27 |
  - GPIO17 → 220Ω → Red leg
  - GPIO18 → 220Ω → Green leg
  - GPIO27 → 220Ω → Blue leg
  - Longest leg (common cathode) → GND
- **Python Code:**
```python
#!/usr/bin/env python3
import RPi.GPIO as GPIO
import time

RED_PIN = 17
GREEN_PIN = 18
BLUE_PIN = 27

def setup():
    GPIO.setmode(GPIO.BCM)
    GPIO.setup([RED_PIN, GREEN_PIN, BLUE_PIN], GPIO.OUT, initial=GPIO.HIGH)

def set_color(r, g, b):
    """Set RGB values (0-255). Using software PWM."""
    GPIO.output(RED_PIN, GPIO.LOW if r > 128 else GPIO.HIGH)
    GPIO.output(GREEN_PIN, GPIO.LOW if g > 128 else GPIO.HIGH)
    GPIO.output(BLUE_PIN, GPIO.LOW if b > 128 else GPIO.HIGH)

def main():
    setup()
    print("RGB LED Color Cycle! Ctrl+C to stop.")
    colors = [
        (255, 0, 0, "Red"), (0, 255, 0, "Green"), (0, 0, 255, "Blue"),
        (255, 255, 0, "Yellow"), (0, 255, 255, "Cyan"), (255, 0, 255, "Magenta"),
        (255, 255, 255, "White")
    ]
    try:
        while True:
            for r, g, b, name in colors:
                set_color(r, g, b)
                print(f"Color: {name}")
                time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        GPIO.cleanup()

if __name__ == '__main__':
    main()
```
- **Tips:** If colors look wrong, check which leg is which. RGB LEDs have 4 legs — the longest is the common cathode (connect to GND).

#### 1.1.3 LED Dot Matrix
- **Category:** Output > Displays
- **Difficulty:** Intermediate
- **Description:** Control an 8x8 LED dot matrix using a 74HC595 shift register. Learn about serial-to-parallel data conversion.
- **Components:** 1x 8x8 LED matrix, 1x 74HC595 shift register, 8x 220Ω resistor, jumper wires
- **Theory:** A shift register takes serial data (one bit at a time) and outputs it in parallel (all 8 bits at once). The 74HC595 has 3 key pins: DS (data), SH_CP (shift clock), and ST_CP (storage clock). We clock bits in one at a time, then latch them to the outputs all at once.
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM |
  |---|---|---|---|
  | GPIO17 (DS) | 11 | 0 | 17 |
  | GPIO18 (ST_CP) | 12 | 1 | 18 |
  | GPIO27 (SH_CP) | 13 | 2 | 27 |
- **Tips:** Make sure the dot on the shift register IC matches your wiring diagram for pin 1 orientation.

#### 1.1.4 7-Segment Display
- **Category:** Output > Displays
- **Difficulty:** Intermediate
- **Description:** Display numbers 0-9 on a 7-segment display using a 74HC595 shift register.
- **Components:** 1x 7-segment display (common cathode), 1x 74HC595 shift register, 8x 220Ω resistor, jumper wires
- **Theory:** A 7-segment display has 7 LEDs arranged in a figure-8 pattern (segments a-g) plus a decimal point. By turning on specific combinations, you display digits. The shift register lets us control all 8 segments with just 3 GPIO pins.
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM | Role |
  |---|---|---|---|---|
  | GPIO17 | 11 | 0 | 17 | DS (Serial Data) |
  | GPIO18 | 12 | 1 | 18 | ST_CP (Latch/Storage Clock) |
  | GPIO27 | 13 | 2 | 27 | SH_CP (Shift Clock) |
- **Tips:** If segments display incorrectly, the display might be common-anode instead of common-cathode. Check your component.

#### 1.2.1 Active Buzzer
- **Category:** Output > Sound
- **Difficulty:** Beginner
- **Description:** Make sound with an active buzzer controlled by a transistor switch. Learn how transistors work as electronic switches.
- **Components:** 1x active buzzer, 1x S8050 NPN transistor, 1x 1kΩ resistor, jumper wires
- **Theory:** An active buzzer has a built-in oscillator — just apply power and it beeps. We use a transistor as a switch because the GPIO pin can't supply enough current directly. When GPIO17 goes LOW, current flows through the base resistor into the transistor, switching it ON and connecting the buzzer to ground.
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM |
  |---|---|---|---|
  | GPIO17 | 11 | 0 | 17 |
  - GPIO17 → 1kΩ resistor → transistor base
  - Buzzer (+) → 3.3V, Buzzer (-) → transistor collector
  - Transistor emitter → GND
- **Tips:** Active buzzers have a built-in tone. If yours doesn't beep, check polarity — the (+) pin is usually longer or marked.

#### 1.2.2 Passive Buzzer
- **Category:** Output > Sound
- **Difficulty:** Beginner
- **Description:** Play musical notes with a passive buzzer using PWM to control frequency. Unlike the active buzzer, you control the pitch!
- **Components:** 1x passive buzzer, 1x S8050 NPN transistor, 1x 1kΩ resistor, jumper wires
- **Theory:** A passive buzzer has no built-in oscillator — you must provide the frequency yourself using PWM. Different frequencies produce different musical notes (e.g., 262Hz = middle C, 330Hz = E, 392Hz = G).
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM |
  |---|---|---|---|
  | GPIO17 | 11 | 0 | 17 |
  - Same wiring as active buzzer (transistor circuit)
- **Tips:** Passive buzzers look almost identical to active buzzers. The passive one usually has an exposed PCB on the bottom. If it just clicks instead of playing tones, you may have an active buzzer.

#### 1.3.1 Motor
- **Category:** Output > Drivers
- **Difficulty:** Intermediate
- **Description:** Control a DC motor's speed and direction using GPIO pins and an L293D motor driver or transistor circuit. Learn about H-bridges and PWM speed control.
- **Components:** 1x DC motor, 1x L293D or transistor array, 1x power supply module, 1x 9V battery with connector, jumper wires
- **Theory:** Motors need more current than GPIO pins can provide, so we use a driver chip. The L293D is an H-bridge that can control motor direction by changing which pins are HIGH/LOW, and speed via PWM on the enable pin.
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM | Role |
  |---|---|---|---|---|
  | GPIO17 | 11 | 0 | 17 | Motor direction pin 1 |
  | GPIO27 | 13 | 2 | 27 | Motor direction pin 2 |
  | GPIO22 | 15 | 3 | 22 | Motor enable (speed/PWM) |
  - Power supply module provides 5V to the motor (NOT from Pi's GPIO!)
- **Tips:** ALWAYS use a separate power supply for motors. Never power a motor directly from the Pi's GPIO pins — it can damage your Pi. Connect the 9V battery to the power supply module and set it to 5V output.

#### 1.3.2 Relay
- **Category:** Output > Drivers
- **Difficulty:** Intermediate
- **Description:** Use a relay as an electronic switch to control high-power devices. The relay isolates the Pi's low-voltage circuit from higher-voltage loads.
- **Components:** 1x relay module, 1x S8050 NPN transistor, 1x 1kΩ resistor, 1x 1N4007 diode, 1x LED (indicator), 1x 220Ω resistor, jumper wires
- **Theory:** A relay is an electromagnetic switch. When current flows through its coil, a magnetic field pulls a metal contact, closing (or opening) a separate circuit. This lets your 3.3V Pi control devices that run on much higher voltages (up to 250V AC). The diode protects against voltage spikes when the relay coil switches off.
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM |
  |---|---|---|---|
  | GPIO17 | 11 | 0 | 17 |
  - GPIO17 → 1kΩ → transistor base → relay coil
  - Flyback diode across relay coil
  - LED as visual indicator on the relay output side

#### 1.3.3 LED Bar Graph
- **Category:** Output > Drivers
- **Difficulty:** Intermediate
- **Description:** Control a 10-segment LED bar graph to create a visual level display (like a volume meter). Uses 10 GPIO pins.
- **Components:** 1x 10-segment LED bar graph, 10x 220Ω resistor, jumper wires
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM |
  |---|---|---|---|
  | GPIO17 | 11 | 0 | 17 |
  | GPIO18 | 12 | 1 | 18 |
  | GPIO27 | 13 | 2 | 27 |
  | GPIO22 | 15 | 3 | 22 |
  | GPIO23 | 16 | 4 | 23 |
  | GPIO24 | 18 | 5 | 24 |
  | GPIO25 | 22 | 6 | 25 |
  | GPIO12 | 32 | 26 | 12 |
  | GPIO13 | 33 | 23 | 13 |
  | GPIO19 | 35 | 24 | 19 |
  - Each LED segment → 220Ω → corresponding GPIO pin
- **Tips:** The bar graph has a notch or dot marking pin 1. Make sure it's oriented correctly.

### INPUT TUTORIALS

#### 2.1.1 Button
- **Category:** Input > Controllers
- **Difficulty:** Beginner
- **Description:** Read a button press to toggle an LED on and off. Learn about digital input, pull-up resistors, and debouncing.
- **Components:** 1x tactile push button, 1x LED, 1x 220Ω resistor, 1x 10kΩ resistor (pull-up), jumper wires
- **Theory:** A button is the simplest input device — it connects two points when pressed. We use a "pull-up" configuration: the GPIO pin is pulled to 3.3V through a resistor normally (reading HIGH). When the button is pressed, it connects the pin to GND (reading LOW). The Pi also has internal pull-up resistors you can enable in software.
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM | Role |
  |---|---|---|---|---|
  | GPIO17 | 11 | 0 | 17 | LED output |
  | GPIO18 | 12 | 1 | 18 | Button input |
  - LED: GPIO17 → 220Ω → LED → GND
  - Button: GPIO18 → button → GND (using internal pull-up)
- **Python Code:**
```python
#!/usr/bin/env python3
import RPi.GPIO as GPIO
import time

LED_PIN = 17
BUTTON_PIN = 18

def setup():
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    GPIO.setup(LED_PIN, GPIO.OUT)
    GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)

def main():
    setup()
    print("Press the button to toggle the LED! Ctrl+C to stop.")
    led_state = False
    try:
        while True:
            if GPIO.input(BUTTON_PIN) == GPIO.LOW:  # Button pressed
                led_state = not led_state
                GPIO.output(LED_PIN, GPIO.LOW if led_state else GPIO.HIGH)
                print(f"LED {'ON' if led_state else 'OFF'}")
                time.sleep(0.3)  # Simple debounce
            time.sleep(0.01)
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        GPIO.cleanup()

if __name__ == '__main__':
    main()
```
- **Tips:** Buttons can "bounce" (register multiple presses from one physical press). The `time.sleep(0.3)` acts as a simple debounce. For production code, use edge detection with `GPIO.add_event_detect()`.

#### 2.1.2 Tilt Switch
- **Category:** Input > Controllers
- **Difficulty:** Beginner
- **Description:** Detect tilting motion using a tilt switch (ball-in-tube sensor). When tilted, a small metal ball rolls and connects two contacts.
- **Components:** 1x tilt switch (ball switch), 2x LED, 2x 220Ω resistor, jumper wires
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM | Role |
  |---|---|---|---|---|
  | GPIO17 | 11 | 0 | 17 | Tilt switch input |
  | GPIO27 | 13 | 2 | 27 | LED 1 |
  | GPIO22 | 15 | 3 | 22 | LED 2 |
- **Tips:** Tilt switches are simple but imprecise. They're good for detecting general orientation (upright vs tilted) but not exact angles.

#### 2.1.3 Potentiometer (with ADC)
- **Category:** Input > Controllers
- **Difficulty:** Intermediate
- **Description:** Read an analog value from a potentiometer using an ADC0834 analog-to-digital converter. Learn about analog vs digital signals.
- **Components:** 1x potentiometer (10kΩ), 1x ADC0834 chip, jumper wires
- **Theory:** The Pi's GPIO pins are digital-only (HIGH or LOW). To read analog values (like a knob position), we need an ADC (Analog-to-Digital Converter). The ADC0834 converts analog voltage (0-3.3V) to a digital number (0-255). The potentiometer creates a variable voltage by acting as a voltage divider.
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM | Role |
  |---|---|---|---|---|
  | GPIO17 | 11 | 0 | 17 | ADC CS (chip select) |
  | GPIO18 | 12 | 1 | 18 | ADC CLK (clock) |
  | GPIO27 | 13 | 2 | 27 | ADC DIO (data in/out) |
  - Potentiometer: one outer pin → 3.3V, other outer pin → GND, middle pin (wiper) → ADC CH0 input

#### 2.2.1 Photoresistor
- **Category:** Input > Sensors
- **Difficulty:** Intermediate
- **Description:** Measure light intensity using a photoresistor (LDR) and the ADC0834. Build a light-sensing circuit.
- **Components:** 1x photoresistor (LDR), 1x 10kΩ resistor, 1x ADC0834, jumper wires
- **Theory:** A photoresistor (Light Dependent Resistor) changes its resistance based on light. In bright light, resistance drops (a few hundred Ω). In darkness, resistance rises (up to MΩ). Paired with a fixed resistor as a voltage divider, the ADC reads the varying voltage.
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM | Role |
  |---|---|---|---|---|
  | GPIO17 | 11 | 0 | 17 | ADC CS |
  | GPIO18 | 12 | 1 | 18 | ADC CLK |
  | GPIO27 | 13 | 2 | 27 | ADC DIO |
  - Photoresistor + 10kΩ voltage divider → ADC CH0

#### 2.2.2 Thermistor
- **Category:** Input > Sensors
- **Difficulty:** Intermediate
- **Description:** Measure temperature using a thermistor (temperature-dependent resistor) and the ADC0834. Convert raw readings to Celsius/Fahrenheit.
- **Components:** 1x thermistor (NTC 10kΩ), 1x 10kΩ resistor, 1x ADC0834, jumper wires
- **Theory:** A thermistor (NTC = Negative Temperature Coefficient) has resistance that decreases as temperature increases. Using the Steinhart-Hart equation or a simpler lookup, we convert the ADC reading to actual temperature.
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM | Role |
  |---|---|---|---|---|
  | GPIO17 | 11 | 0 | 17 | ADC CS |
  | GPIO18 | 12 | 1 | 18 | ADC CLK |
  | GPIO27 | 13 | 2 | 27 | ADC DIO |
  - Thermistor + 10kΩ voltage divider → ADC CH0

#### 2.2.3 DHT-11 (Temperature & Humidity Sensor)
- **Category:** Input > Sensors
- **Difficulty:** Intermediate
- **Description:** Read temperature and humidity from a DHT-11 digital sensor. This all-in-one sensor sends calibrated digital data — no ADC needed!
- **Components:** 1x DHT-11 sensor module, jumper wires
- **Theory:** The DHT-11 contains both a humidity sensor and a thermistor, plus a small chip that digitizes the readings. It communicates using a custom single-wire protocol: the Pi sends a start signal, then the DHT-11 replies with 40 bits of data (humidity integer, humidity decimal, temperature integer, temperature decimal, checksum).
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM | Role |
  |---|---|---|---|---|
  | GPIO17 | 11 | 0 | 17 | DATA pin |
  - VCC → 3.3V, GND → GND, DATA → GPIO17
  - Some modules have a built-in pull-up resistor; if using a bare sensor, add a 10kΩ pull-up between DATA and 3.3V
- **Tips:** The DHT-11 can only be read once every 2 seconds. If you read too fast, you'll get errors or stale data. The sensor is ±2°C accuracy and ±5% humidity — good for learning, not for precision.

### EXTENSION TUTORIALS

#### 3.1.1 Adjustable Fan
- **Category:** Extension
- **Difficulty:** Intermediate
- **Description:** Build a fan with adjustable speed using a potentiometer to control a motor via PWM. Combines analog input (ADC + potentiometer) with motor output.
- **Components:** 1x DC motor (with fan blade), 1x L293D motor driver or transistor, 1x potentiometer, 1x ADC0834, 1x power supply module, jumper wires
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM | Role |
  |---|---|---|---|---|
  | GPIO17 | 11 | 0 | 17 | ADC CS |
  | GPIO18 | 12 | 1 | 18 | ADC CLK |
  | GPIO27 | 13 | 2 | 27 | ADC DIO |
  | GPIO22 | 15 | 3 | 22 | Motor enable (PWM) |
  | GPIO23 | 16 | 4 | 23 | Motor direction 1 |
  | GPIO24 | 18 | 5 | 24 | Motor direction 2 |
- **Tips:** This combines concepts from the Potentiometer and Motor tutorials. Complete those first.

#### 3.1.2 Morse Code Generator
- **Category:** Extension
- **Difficulty:** Intermediate
- **Description:** Convert text input into Morse code, output as beeps on a buzzer and flashes on an LED. Combines output (LED + buzzer) with string processing.
- **Components:** 1x active buzzer, 1x LED, 1x 220Ω resistor, 1x 1kΩ resistor, 1x S8050 transistor, jumper wires
- **Wiring:**
  | T-Board Name | Physical Pin | WiringPi | BCM | Role |
  |---|---|---|---|---|
  | GPIO17 | 11 | 0 | 17 | Buzzer control |
  | GPIO27 | 13 | 2 | 27 | LED indicator |
- **Tips:** A dot (dit) is one unit long. A dash (dah) is three units. The gap between parts of the same letter is one unit. Between letters is three units. Between words is seven units.

---

## 9. UI/UX Design System

### Theme: Dark Mode (primary)
- **Background:** `#0F172A` (slate-950)
- **Surface/Cards:** `#1E293B` (slate-800)
- **Elevated surface:** `#334155` (slate-700)
- **Border:** `#475569` (slate-600)
- **Primary text:** `#F1F5F9` (slate-100)
- **Secondary text:** `#94A3B8` (slate-400)
- **Accent/Primary:** `#3B82F6` (blue-500)
- **Success:** `#10B981` (emerald-500)
- **Warning:** `#F59E0B` (amber-500)
- **Error:** `#EF4444` (red-500)

### Layout
```
┌──────────────────────────────────────────────────────┐
│  ● ● ●   GPIO Dashboard    [Connected: 192.168.1.50]│
├──────────────────────────────────────────────────────┤
│  [Pinout] [Breadboard] [Tutorials] [Monitor]         │
├──────────────────────────────────────────────────────┤
│                                                      │
│                   Main Content Area                   │
│                   (changes per tab)                   │
│                                                      │
│                                                      │
│                                                      │
├──────────────────────────────────────────────────────┤
│  ▲ Terminal (collapsible, drag to resize)             │
│  $ pi@raspberrypi:~ $ _                              │
└──────────────────────────────────────────────────────┘
```

### Typography
- **Headings:** Inter or system-ui (sans-serif)
- **Code/Terminal:** JetBrains Mono or Fira Code (monospace)
- **Pin labels:** Monospace, small (11-12px)

### Animations
- Pin state change: brief green pulse (HIGH) or dim fade (LOW), 200ms transition
- Tutorial wiring overlay: jumper wires draw in with a subtle animation
- Connection status: gentle pulse on the green dot
- Tab transitions: smooth fade/slide

### Component Design Notes
- **GPIO Header pins:** 24x24px rounded squares in a grid, 4px gap between columns, 2px gap between rows. Color-coded. Hover: scale(1.15) with shadow. Active pin: ring outline.
- **Breadboard:** Use SVG for the breadboard body. CSS Grid for the tie-point holes. The T-cobbler is a styled div overlay positioned across the center gap. Holes are 6px circles with 8px spacing.
- **Tutorial cards:** 280px min-width, gradient left border indicating category color (green=output, blue=input, purple=extension). Shadow on hover.
- **Terminal:** Dark background (#0D1117), green text for stdout, red for stderr, gray for system messages. Minimum 6 rows, expandable to half screen.

---

## 10. Development Phases

### Phase 1: Project Scaffolding + GPIO Pinout
1. Initialize Electron + Vite + React + Tailwind project
2. Configure Electron main/renderer process with IPC bridge
3. Build the Navbar with tab navigation
4. Create `pins.js` data file with all 40 pins
5. Build the interactive GPIO Header component (the 2x20 pin grid)
6. Build the PinDetail panel (click a pin → see details)
7. Add search and filter functionality
8. Style everything with the dark theme

### Phase 2: Breadboard + T-Cobbler Visualization
1. Build the SVG/CSS breadboard component (power rails, tie-point grid, center gap)
2. Build the T-cobbler overlay with all 40 pin labels
3. Color-code cobbler pins by type
4. Add pin tooltips on hover
5. Placeholder for live state indicators (dots on each pin)

### Phase 3: SSH Connection + Pi Agent
1. Build the Connection Manager page (hostname, user, password inputs)
2. Implement SSH connection in the Electron main process using ssh2
3. Build the preload.js IPC bridge for SSH operations
4. Write the Pi-side agent (Python: gpio_monitor.py, agent.py)
5. Implement SCP file transfer for deploying the agent
6. Implement agent installation (install.sh) and startup
7. Store connection settings with electron-store

### Phase 4: Live GPIO Monitoring
1. Implement WebSocket client in Electron main process
2. Connect to Pi agent's WebSocket server
3. Create Zustand store for live GPIO state
4. Wire live state data to the GPIO Header component (live overlay)
5. Wire live state data to the Breadboard component (pin indicators)
6. Build the Monitor page (full GPIO state table)
7. Add system info display (CPU temp, memory, uptime)

### Phase 5: Tutorial System + Code Execution
1. Create `tutorials.js` data file with all 17 tutorials
2. Build TutorialCard component (list view)
3. Build TutorialDetail component (step-by-step view)
4. Integrate CodeMirror for Python code display/editing
5. Implement code deployment (SCP to Pi) and execution (SSH exec)
6. Build terminal output component (xterm.js for live stdout/stderr)
7. Implement "Stop" functionality (SSH kill signal)
8. Build tutorial wiring overlay on the Breadboard view
9. Add progress tracking (completed tutorials)

### Phase 6: Embedded Terminal + Polish
1. Integrate xterm.js as a slide-up terminal panel
2. Connect to Pi via SSH PTY session
3. Add keyboard shortcut toggle
4. Polish all animations and transitions
5. Add onboarding/welcome screen for first-time users
6. Package with electron-builder for macOS .dmg
7. Test end-to-end with real Pi 5 hardware

---

## 11. Critical Technical Notes

### Raspberry Pi 5 GPIO Specifics
- Pi 5 uses the **RP1 southbridge chip** for GPIO, NOT the BCM2835/2711 SoC
- GPIO character device is **`/dev/gpiochip4`** (NOT gpiochip0)
- **RPi.GPIO has limited Pi 5 support** — the tutorial code may need `lgpio` or `gpiozero` instead
- For the Pi agent's monitoring, always use `gpiod` with the correct chip
- The Pi 5 has the same 40-pin header pinout as Pi 4, so all pin numbers are identical

### Important Library Notes
- `gpiod` Python bindings v2.x have a different API than v1.x — check which version is installed
- `lgpio` is another Pi 5 compatible option if gpiod causes issues
- `gpiozero` works on Pi 5 when configured with the lgpio backend: `export GPIOZERO_PIN_FACTORY=lgpio`
- WiringPi is deprecated and has limited Pi 5 support — the tutorials reference it for C code but we focus on Python

### Electron IPC Security
- Use `contextBridge.exposeInMainWorld()` in preload.js — never expose `ipcRenderer` directly
- All SSH operations happen in the main process, never in the renderer
- Sanitize all data received from the Pi before rendering

### SSH Connection Best Practices
- Support both password and SSH key authentication
- Implement connection timeout (10 seconds)
- Handle network drops with auto-reconnect (exponential backoff)
- Keep-alive packets to prevent SSH timeout
- Multiple SSH channels: one for the terminal, one for command execution, one for SCP

---

## 12. Reference Links

- **Kit Documentation:** https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/index.html
- **Raspberry Pi 5 GPIO Docs:** https://www.raspberrypi.com/documentation/computers/raspberry-pi.html
- **gpiod Python:** https://pypi.org/project/gpiod/
- **Electron:** https://www.electronjs.org/docs
- **ssh2 (Node.js):** https://github.com/mscdex/ssh2
- **xterm.js:** https://xtermjs.org/
- **CodeMirror 6:** https://codemirror.net/
- **Zustand:** https://github.com/pmndrs/zustand

---

## Instructions for Claude Code

1. **Start in plan mode.** Read this entire spec and create a detailed implementation plan broken into phases.
2. **Follow the phase order** (1 through 6). Each phase should result in a working, testable state.
3. **Use the dark theme** from Section 9. The app should look polished, not prototype-y.
4. **Include ALL 40 pins** from Section 7 in the pins data file.
5. **Include ALL 17 tutorials** from Section 8 in the tutorials data file.
6. **Pi 5 compatibility is critical** — use gpiod, not RPi.GPIO, for the agent.
7. **Test each phase** before moving to the next.
8. After each phase, ask me to review before proceeding.
