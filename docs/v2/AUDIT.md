# Correctness audit (SPEC 16.1)

Every item in the baseline (52639d9): each tutorial in `data/tutorials.js` (circuit, wiring
text, diagram, code, theory, quoted values and GPIO numbers), each component and module
depiction, `data/pins.js` and the other hard-coded electrical facts, and the README's claims.

**Method, per item.** Find the governing sources (the SunFounder kit page for the project, the
part's datasheet, the official Raspberry Pi documentation) and record them. Rebuild the circuit
as a `.gpiob` document on the bench's T-board placement (columns d/h, pin 1 in row 1, header
toward row 0) following the wiring convention (SPEC 6.5). The rebuilt document must pass ERC
with zero errors, its sim assertions, and the code/netlist pin check. Those checks run on every
commit in `content/tutorials/tutorials.test.ts`, which is the test named under "Guarded by"
unless another is given.

**Severity.** *Unsafe for hardware* (can damage the Pi or a part) · *Doesn't work* (the build
as described cannot work on this bench) · *Misleading* (works, but teaches something wrong or
contradicts the kit) · *Cosmetic*. Unsafe findings are listed first.

**Code and theory** in the rebuilt tutorials are written for this app (ADR-0016): they follow
the kit's pins, polarity and behaviour, and copy no code or prose from the kit.

## Unsafe for hardware

Every finding of that severity, gathered from the sections below once the audit is complete.

## Tutorials

Each section covers one rebuilt tutorial and the baseline tutorial it replaces (if any). Its
findings are numbered `<tutorial id>-<n>`.

<!-- section:blinking-led -->
### Blinking LED (`blinking-led`, kit 1.1.1; baseline `blinking-led`)

Sources: [kit 1.1.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.1.1%20Blinking_LED.html),
Kingbright WP7113ID (red 5 mm LED), Yageo CFR (resistor), Raspberry Pi GPIO documentation.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| blinking-led-1 | placement | LED anode in row 23 column e, resistor in rows 22–23 | On the bench the T-board body covers columns d–h of rows 21–23 (`tboardBlockedHoles`), so 23e cannot take a lead. The rebuild uses rows 30–35 | SPEC 6.6; `content/controllers/tboard.json` (ADR-0004) | Doesn't work | placement check (`validateDoc`) | Fixed |
| blinking-led-2 | circuit | GPIO17 → 220 Ω → LED → GND, active high | 3.3 V → 220 Ω → LED anode; cathode → GPIO17, active low | [Kit 1.1.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.1.1%20Blinking_LED.html) | Misleading | sim: "GPIO17 LOW lights D1…", "GPIO17 HIGH turns D1 off" | Fixed |
| blinking-led-3 | code | `GPIO.HIGH` turns the LED on; no initial level | With the kit's wiring LOW lights it; the pin starts HIGH (dark) | Kit 1.1.1 | Misleading | the same sim assertions; code/netlist pin check | Fixed |
| blinking-led-4 | theory | "The longer leg … connects toward the GPIO pin"; "When GPIO17 outputs HIGH … lighting it up" | The anode goes to 3.3 V through the resistor and the cathode to GPIO17; LOW lights it. Values are templated from the doc | Kit 1.1.1 | Misleading | theory renders from the doc | Fixed |

Generated wiring table and build steps:

<!-- generated:blinking-led -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 30 column b | 3V3 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 34 column b | N1 |
| D1 | red 5 mm LED | Anode (+) | row 34 column c | N1 |
| D1 | red 5 mm LED | Cathode (−) | row 35 column c | GPIO17 |
| W1 | red male–male jumper | end a | row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | row 30 column a | 3V3 |
| W2 | yellow male–male jumper | end a | row 35 column a | GPIO17 |
| W2 | yellow male–male jumper | end b | row 6 column a | GPIO17 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 220 Ω resistor (red, red, brown, gold), from row 30 column b to row 34 column b.
3. Insert D1, the red 5 mm LED: anode (longer leg) in row 34 column c, cathode (shorter leg, flat side) in row 35 column c.
4. Use a red 20 cm male–male jumper (W1) from row 1 column a to row 30 column a.
5. Use a yellow 20 cm male–male jumper (W2) from row 35 column a to row 6 column a.
<!-- /generated:blinking-led -->
<!-- /section:blinking-led -->
