# Hardware-in-the-loop checklist

Checks that need the real Pi 5, the kit or the bench, and that the coding agent may not run:
anything that drives or probes a pin, Board Sense, or a physical build (SPEC 18). Each item
says what to do, what to expect, and which part of the app it confirms. Record results in
`docs/v2/hil/` (date, Pi OS version, outcome).

## Bench geometry

- [ ] **3V3 (pin 1) is in column d.** Seat the T-board as the app shows (pin 1 in row 1,
  columns d and h, header toward row 0). Probe d1 to a GND strip with a meter: 3.3 V.
  Confirms `content/controllers/tboard.json` (ADR-0004) and the bench placement every
  tutorial uses.
- [ ] **A male Dupont seats in column c beside the T-board.** Push a male lead into c6. It
  should seat fully with the T-board in place. Confirms the edge-column lean allowance.
- [ ] **Header pin-1 end of the T-board.** Note which end of the T-board's header the ribbon's
  red stripe sits at. The photo-based model assumes the end nearest row 1 (ADR-0004).

## Pi agent and monitor

- [ ] **The agent installs and has the libgpiod 2 binding.** Press **Deploy agent** in the
  dashboard. The install log should end with "Installation complete!". On Bookworm it should
  also say "apt's gpiod binding is 1.x; installing gpiod 2 into …/venv" with no warning after
  it; on Trixie it should say neither. Then on the Pi, `cd ~/gpio-dashboard-agent` and run
  `$([ -x venv/bin/python3 ] && echo venv/bin/python3 || echo python3) -c 'import gpiod;
  print(gpiod.__version__)'`; it should print 2.x. Record the OS release and that version
  (SPEC 14.5 asks for the binding version).
- [ ] **Output pins appear in the Live Monitor.** Run any tutorial that drives an LED (Blinking
  LED). The Monitor should list GPIO17 as an output, with its level changing. Confirms the
  `pinctrl` parser fix for output lines (`op dh pd | hi`).
- [ ] **gpiod enrichment finds the header chip.** With the agent running, a claimed line (for
  example GPIO17 while a script holds it) shows its consumer name in the Monitor. Confirms that
  `_detect_chip` finds `pinctrl-rp1` by label on the installed kernel.
- [ ] **System Info shows real values.** Temperature, memory, disk and uptime are filled in
  (not 0.0 °C, "--" or "NaNm").

## Run on Pi

- [ ] **A project runs and stops.** Open Blinking LED, Run on Pi: the LED blinks and output
  streams. Stop: the process ends on the Pi (`pgrep -f project_blinking-led.py` finds
  nothing).
- [ ] **Stop returns the program's pins to inputs.** After Stop, `pinctrl get 17` on the Pi
  shows `ip pn`. Confirms that `pinctrl set` runs without `sudo` for the app's user. If it
  needs root, the cleanup command must change.
- [ ] **ERC errors block a run.** Open a document with a SHORT_SUPPLY error (in the Workbench,
  wire 3V3 to GND). Run on Pi shows the override dialog and does nothing until "Run anyway".

## Tutorials whose numbers come from stand-in datasheets

- [ ] **Active buzzer at 5 V.** The kit's buzzer sounds when GPIO17 drives the PN2222 (Active
  Buzzer). The model uses the TMB12A05's 4 V minimum; note whether the kit's buzzer also
  sounds from 3.3 V.
- [ ] **DHT-11 read in pure Python.** Run the DHT-11 tutorial on the Pi: readings appear and the
  checksum passes. Python bit-banging on a Pi 5 is untested; note the failure rate.
- [ ] **Relay module polarity.** S HIGH energises the coil (the module's LED lights and NO
  closes). Settled from SunFounder's module page and Davinci lesson; confirm on the board.

## Board Sense bench fixtures (SPEC 18)

Run each through the Workbench's **Board** tab: choose the fixture, press **Use as the twin**,
build it on the bench, press **Sense the Pi's board**, then **It is built: record what Board
Sense sees**, and copy the results into `docs/v2/hil/`. Sensing changes only the pull on input
pins, never drives a pin, and pauses for any Run on Pi. Never leave a part on the bench that a
fixture does not list: bias changes reach it too. The holes below are generated from the
fixture documents in `core/sense/fixtures.ts`.

### 1. An empty board

- [ ] Every probed net follows its bias; the Board tab verifies nothing.

<!-- generated:empty -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
<!-- /generated:empty -->

### 2a. Calibration: GPIO17 to GND through 10 kΩ

- [ ] Record GPIO17 under pull-up and pull-down.

<!-- generated:calibration-10k -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 1 | row 30 column b | GPIO17 |
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 2 | row 34 column b | GND |
| W1 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W1 | yellow male–male jumper | end b | row 30 column a | GPIO17 |
| W2 | black male–male jumper | end a | row 34 column a | GND |
| W2 | black male–male jumper | end b | row 5 column b | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 10 kΩ resistor (brown, black, orange, gold), from row 30 column b to row 34 column b.
3. Use a yellow 20 cm male–male jumper (W1) from row 6 column a to row 30 column a.
4. Use a black 20 cm male–male jumper (W2) from row 34 column a to row 5 column b.
<!-- /generated:calibration-10k -->

### 2b. Calibration: GPIO17 to GND through 47 kΩ

- [ ] Record GPIO17 under pull-up and pull-down.

<!-- generated:calibration-47k -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| R1 | 47 kΩ resistor (yellow, violet, orange, gold) | Lead 1 | row 30 column b | GPIO17 |
| R1 | 47 kΩ resistor (yellow, violet, orange, gold) | Lead 2 | row 34 column b | GND |
| W1 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W1 | yellow male–male jumper | end b | row 30 column a | GPIO17 |
| W2 | black male–male jumper | end a | row 34 column a | GND |
| W2 | black male–male jumper | end b | row 5 column b | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 47 kΩ resistor (yellow, violet, orange, gold), from row 30 column b to row 34 column b.
3. Use a yellow 20 cm male–male jumper (W1) from row 6 column a to row 30 column a.
4. Use a black 20 cm male–male jumper (W2) from row 34 column a to row 5 column b.
<!-- /generated:calibration-47k -->

### 2c. Calibration: GPIO17 to GND through 100 kΩ

- [ ] Record GPIO17 under pull-up and pull-down.

<!-- generated:calibration-100k -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| R1 | 100 kΩ resistor (brown, black, yellow, gold) | Lead 1 | row 30 column b | GPIO17 |
| R1 | 100 kΩ resistor (brown, black, yellow, gold) | Lead 2 | row 34 column b | GND |
| W1 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W1 | yellow male–male jumper | end b | row 30 column a | GPIO17 |
| W2 | black male–male jumper | end a | row 34 column a | GND |
| W2 | black male–male jumper | end b | row 5 column b | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 100 kΩ resistor (brown, black, yellow, gold), from row 30 column b to row 34 column b.
3. Use a yellow 20 cm male–male jumper (W1) from row 6 column a to row 30 column a.
4. Use a black 20 cm male–male jumper (W2) from row 34 column a to row 5 column b.
<!-- /generated:calibration-100k -->

### 2d. Calibration: GPIO17 to GND through 220 kΩ

- [ ] Record GPIO17 under pull-up and pull-down. Together, 2a–2d narrow the pull-to-threshold ratio on this Pi (SPEC 9).

<!-- generated:calibration-220k -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| R1 | 220 kΩ resistor (red, red, yellow, gold) | Lead 1 | row 30 column b | GPIO17 |
| R1 | 220 kΩ resistor (red, red, yellow, gold) | Lead 2 | row 34 column b | GND |
| W1 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W1 | yellow male–male jumper | end b | row 30 column a | GPIO17 |
| W2 | black male–male jumper | end a | row 34 column a | GND |
| W2 | black male–male jumper | end b | row 5 column b | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 220 kΩ resistor (red, red, yellow, gold), from row 30 column b to row 34 column b.
3. Use a yellow 20 cm male–male jumper (W1) from row 6 column a to row 30 column a.
4. Use a black 20 cm male–male jumper (W2) from row 34 column a to row 5 column b.
<!-- /generated:calibration-220k -->

### 3. GPIO18 with a 10 kΩ pull-up and a button

- [ ] Released: GPIO18 tied high, matched. Hold the button: tied low.

<!-- generated:pull-up-button -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 1 | row 30 column b | GPIO18 |
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 2 | row 34 column b | 3V3 |
| SW1 | 6 mm tactile switch (4-pin) | Terminal 1 | row 40 column e | GPIO18 |
| SW1 | 6 mm tactile switch (4-pin) | Terminal 2 | row 40 column f | GPIO18 |
| SW1 | 6 mm tactile switch (4-pin) | Terminal 3 | row 42 column e | GND |
| SW1 | 6 mm tactile switch (4-pin) | Terminal 4 | row 42 column f | GND |
| P1 | red male–male jumper | end a | row 1 column a | 3V3 |
| P1 | red male–male jumper | end b | the bottom + rail at row 3 | 3V3 |
| P2 | black male–male jumper | end a | row 5 column a | GND |
| P2 | black male–male jumper | end b | the bottom − rail at row 4 | GND |
| W1 | yellow male–male jumper | end a | row 6 column j | GPIO18 |
| W1 | yellow male–male jumper | end b | row 30 column a | GPIO18 |
| W2 | red male–male jumper | end a | row 34 column a | 3V3 |
| W2 | red male–male jumper | end b | the bottom + rail at row 33 | 3V3 |
| W3 | yellow male–male jumper | end a | row 30 column c | GPIO18 |
| W3 | yellow male–male jumper | end b | row 40 column a | GPIO18 |
| W4 | black male–male jumper | end a | row 42 column a | GND |
| W4 | black male–male jumper | end b | the bottom − rail at row 39 | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Use a red 20 cm male–male jumper (P1) from row 1 column a to the bottom + rail at row 3.
3. Use a black 20 cm male–male jumper (P2) from row 5 column a to the bottom − rail at row 4.
4. Use a red 20 cm male–male jumper (W2) from row 34 column a to the bottom + rail at row 33.
5. Use a black 20 cm male–male jumper (W4) from row 42 column a to the bottom − rail at row 39.
6. Insert R1, the 10 kΩ resistor (brown, black, orange, gold), from row 30 column b to row 34 column b.
7. Insert SW1, the 6 mm tactile switch (4-pin), across the trench with pin 1 (Terminal 1) in row 40 column e and pin 4 (Terminal 4) in row 42 column f.
8. Use a yellow 20 cm male–male jumper (W1) from row 6 column j to row 30 column a.
9. Use a yellow 20 cm male–male jumper (W3) from row 30 column c to row 40 column a.
<!-- /generated:pull-up-button -->

### 4. A lead between GPIO17 and GPIO27

- [ ] With this fixture as the twin: matched. With an empty twin: GPIO17 and GPIO27 diverge as a gpio-short.

<!-- generated:gpio-short -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| W1 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W1 | yellow male–male jumper | end b | row 7 column a | GPIO17 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Use a yellow 20 cm male–male jumper (W1) from row 6 column a to row 7 column a.
<!-- /generated:gpio-short -->

### 5. Faults on fixture 3

With fixture 3 as the twin, build it with one fault at a time. Each should diverge on GPIO18,
and **Find likely causes** should list the true fault among the top three:
- [ ] W1's end in row 31 column a instead of row 30 (missing path).
- [ ] W2 left out, so there is no pull-up (missing path).
- [ ] W4's end on the bottom + rail instead of the bottom − rail; then hold the button (wrong
  level).

### 6. The kit's Blinking LED

- [ ] Open the Blinking LED tutorial in the Workbench and build it. GPIO17 must show
  unobserved (an LED path), never matched or diverged. Then run its Toggle LED checkpoint and
  confirm the LED lights.

### 7. Presence (not built)

Presence sensing needs a timing spike on the Pi (ADR-0018). It is not part of this build.


## Not shipped, pending a part

- The LCD1602 tutorial needs a bidirectional I2C level shifter between the 5 V backpack and
  the Pi (AUDIT.md lcd1602-1). Its draft is on local branch `held/lcd1602-tutorial`.
