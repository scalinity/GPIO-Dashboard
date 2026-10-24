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

## Board Sense (M6)

Bench fixtures for Board Sense, with exact holes, are added in M6.

## Not shipped, pending a part

- The LCD1602 tutorial needs a bidirectional I2C level shifter between the 5 V backpack and
  the Pi (AUDIT.md lcd1602-1). Its draft is on local branch `held/lcd1602-tutorial`.
