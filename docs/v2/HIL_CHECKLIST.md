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
- [ ] **Header pin-1 end of the T-board.** With the ribbon plugged in, note which end of the
  T-board's box header the brown conductor (conductor 1) sits at. The model reads photo 5 as
  pin 1 at the column-h end of the row beside the key slot (ADR-0037); if the brown edge is at
  the column-d end instead, `tboard.py`, `idc.py` and their checks change together.
- [ ] **How far the IDC socket sits in the box header.** Measure how far the socket's lower
  body goes down inside the shroud, and whether its latch ears rest on the shroud's end walls.
  The model seats the lower body 5.08 mm below the rim (the 3M 891 sheet's 0.200 in step) with
  its ears on the end walls (ADR-0065); if the real socket sits deeper or shallower, change
  `SOCKET_SEAT` in `tboard.py` and `PLUG` in `idc.py` together.

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

### 8. Sensing a circuit with transistor bases behind resistors

- [ ] **Watch the digits while sensing the 4-Digit 7-Segment build.** GPIO5, 6, 12 and 13 reach the
  S8550 PNP bases through 1 kΩ resistors (R9–R12). The probe skips a pin whose own net holds a part
  that must not be disturbed, but these bases sit one resistor away, so Board Sense's pull changes
  reach them (ADR-0116). It never drives a pin, but a pull of about 50 kΩ could turn a PNP on a
  little. Build the circuit, start sensing from the Board tab, and note whether any digit glows or
  flickers between sweeps. If one does, record it; the skip rule should then look through series
  resistors to transistor bases.


## Hardware twin (M11)

The browser flows in `e2e/hardware.spec.ts` prove the app's reading of telemetry, scans and runs
against a mock Pi. These items need the real Pi, the kit, or your hands. Several drive a pin; do
them with only the parts each one names on the bench. Record the results in `docs/v2/hil/`.

### Automated flows on the real Pi (reads only; none drives or probes a pin)

- [ ] **The two automated HIL flows pass against the Pi.** Prerequisites: your SSH key logs in as
  the Pi's user without a prompt, and the Pi is already in `~/.ssh/known_hosts`.
  From `gpio-dashboard/`, run
  `PI_HOST=<host> PI_USER=<user> PI_KEY=<private key file> E2E_PORT=<free port> npx playwright test e2e/hil.spec.ts`.
  Expect the two "against the real Pi" tests to pass, and "HIL: ran the flows against <host>".
  They read `pinctrl get`, and upload, run and stop a script that only prints. The I2C scan clocks
  probes out on the bus, so it is not automated on the Pi: the checkpoint items below cover it.
  Record the pass count and the Pi's OS release. They do not use the Pi agent or the Rust tunnel;
  the next item covers those.

### Live Pi state in the app window

Use `npm run dev` (the Tauri window) with the agent deployed and running. Toggle Inspect → Live Pi
state. If the window cannot be seen (the screen is locked), say so in the result.

- [ ] **Telemetry reaches the twin through the tunnel (D18).** Connect, Deploy agent, open the
  Blinking LED tutorial in the Studio, switch Live Pi state on. Expect the T-board's GPIO strips to
  take pale colours within a second (inputs: pale yellow high, pale blue low), the Inspect list to
  show the pins, and hovering a GPIO17 strip hole to end its tooltip with "Pi: input, low" or "high".
  Record the tooltip text and a screenshot.
- [ ] **Outputs light the bench from the real pin.** Build the Blinking LED (HIGH keeps the LED dark,
  LOW lights it) and Run on Pi. Expect GPIO17's strip to swing between orange (high) and blue (low),
  and the 3D LED to glow when the real LED does, within about a quarter of a second. Record any lag
  or any moment the two disagree. Then run the Breathing LED: the 3D LED flickers where the real one
  fades (10 Hz sampling cannot show a duty cycle); note what you see.
- [ ] **A pull change reaches the twin.** Run the Button tutorial. Expect GPIO18 to change from
  "input, low" to "input, high, pull-up" when the program sets its pull-up. Confirms the telemetry
  store now reports a pull change without a level change.
- [ ] **The alternate function is named.** On the Pi, `pinctrl get 2`, with I2C enabled
  (`sudo raspi-config`, Interface Options, I2C) and then disabled. Enabled it should read
  `a3 pu | hi // GPIO2 = SDA1`; the Inspect list should say "alternate SDA1, high" and the pin
  should be violet. Record both `pinctrl` lines.
- [ ] **I2C off raises a badge.** Open the Adjustable Fan tutorial (an ADS7830 on GPIO2 and GPIO3), Live
  Pi state on, I2C disabled in raspi-config. Within about a second a red-orange badge "GPIO2 is not
  an I2C pin right now" (and one for GPIO3) should stand over each net. Click one: the card names
  `raspi-config` and the part. Enable I2C: the badges go and the card closes.
- [ ] **An output on a pin the circuit reads raises a badge.** Open the Button tutorial in the Studio
  (do not build it) with the T-board's GPIO18 strip empty, and Live Pi state on. On the Pi, run
  `pinctrl set 18 op dh`; this drives GPIO18, so make sure nothing is wired to it. Within about a
  second a red badge "GPIO18 is driven as an output" should appear, and its card should say the Pi
  drives it HIGH and that SW1 is on the net. Then `pinctrl set 18 ip pd` to give the pin back: the
  badge and card go. Record the card's text.
- [ ] **Board Sense's diverged net gets a badge.** With the fixture 3 circuit (below) built with one
  fault (W1 one row off), Board Sense on, and the fixture as the twin: a red badge over GPIO18 says
  Board Sense sees a missing path; its card lists the three likeliest causes with their holes, the
  true fault among them.
- [ ] **Idle costs nothing.** With Live Pi state on and the telemetry unchanged for a few seconds, the
  dev overlay's "frames rendered while idle" stays at 0 once the scene settles. Record the overlay.
- [ ] **Header pin visibility.** Look at the Pi's header from the Top and Iso presets. The IDC socket
  covers the header pins in Iso, so note whether any tinted header pin is visible in any view
  (ADR-0121); the T-board strips are the paint you can rely on.

### Build Mode checkpoints on the bench

Each checkpoint appears only on the step that completes its wiring, and runs only when you click
its button. Build the tutorial step by step with Build Mode and check that the card is absent
before that step.

- [ ] **I2C scan finds the module.** Build the Potentiometer (or Photoresistor, Thermistor, Adjustable
  Fan) as far as the ADS7830's four leads, VCC to 3V3, GND to GND, SDA to GPIO2, SCL to GPIO3. At the
  step the card appears on (W4), click "Scan the I2C bus". Expect "Found a device at 0x48 on bus 1".
  Record `i2cdetect -y 1` from a shell for comparison. If the module answers at another address, note
  it: the part definition says 0x48, and another vendor's module is reported at 0x4B.
- [ ] **I2C scan names what is wrong.** Pull the SDA lead and scan again: expect "Nothing answered at
  0x48 (the bus is empty)" with the SDA, power and raspi-config causes. Disable I2C and scan: expect
  the same message with the raspi-config cause (or the `i2cdetect` error text on a Pi without
  `i2c-tools`).
- [ ] **Press the button, rest to pressed.** Build the Button as far as W5 (SW1 to GPIO18 and ground).
  Click "Watch GPIO18" with no program running. Expect "GPIO18 reads HIGH at rest. Press and hold SW1
  now." (the 10 kΩ pull-up holds it), then, on pressing, "GPIO18 went HIGH to LOW when SW1 was
  pressed." Record both messages and whether the pin's pull in the Inspect list was "none".
- [ ] **A button turned a quarter turn is caught.** Rotate SW1 90° in its holes so GPIO18 is held at
  ground, and watch again: after about 1.5 s expect "GPIO18 reads LOW with SW1 released; it should
  read HIGH." with "pins 1–2 are always connected" first among the causes. Put it back and watch
  again: it passes.
- [ ] **Press with the program running.** Run the Button program, then watch GPIO18: the pin is an input
  and the card behaves as above. Stop on Pi, then watch: same.
- [ ] **Toggle LED lights it.** Build the Blinking LED. On its last step click "Toggle D1 on GPIO17".
  Expect the run to upload `/tmp/gpio_dashboard/project_checkpoint-D1-gpio17.py`, the LED to light
  three times (1 s on, 1 s off), then "The run is over. The Pi drove GPIO17 high and low. Did the LED
  light and go dark three times?". Answer yes: "You saw D1 light on GPIO17." After it, `pinctrl get 17`
  on the Pi should read an input (`ip`): the script handed the pin back. Record the run's output lines.
- [ ] **Toggle LED with a wrong LED.** Turn the LED round and run it again, answering no: expect the
  causes to start with the LED's polarity and its hole (the anode, "longer leg").
- [ ] **Each toggle works on its own circuit.** Run the Toggle checkpoint on: the RGB LED (three
  toggles, GPIO17, GPIO18 and GPIO27, each lighting one colour), the Relay (the relay clicks and its LED lights; the
  toggle drives the S pin), the Tilt Switch (D1 on GPIO22, then D2 on GPIO27), the PIR (D1 on GPIO18),
  the LED Bar Graph and Flowing LEDs (the first three LEDs). Record any that does not light and the
  pin it used.
- [ ] **ERC still gates the toggle.** In a document with a SHORT_SUPPLY error, click Toggle: the dialog
  lists the error and nothing uploads until "Run anyway". Cancel it: nothing runs and the card is
  ready again.
- [ ] **Stop ends a toggle.** Click Toggle, then Stop on Pi during the run: the LED goes dark, the pin
  returns to an input (`pinctrl get 17`), and the card asks what you saw.
- [ ] **Board Sense pauses for a toggle.** With Board Sense on the Pi, click Toggle: sensing pauses
  (the Board tab shows it stopped sweeping) before the upload, and resumes after the run.
- [ ] **No checkpoint runs by itself.** Step through a whole build with the Pi connected and watch the
  terminal and `pinctrl get`: nothing runs and no pin changes except when you click a checkpoint's
  button.

## Not shipped, pending a part

- The LCD1602 tutorial needs a bidirectional I2C level shifter between the 5 V backpack and
  the Pi (AUDIT.md lcd1602-1). Its draft is on local branch `held/lcd1602-tutorial`.
