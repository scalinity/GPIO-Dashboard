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

<!-- section:rgb-led -->
### RGB LED (`rgb-led`, kit 1.1.2; baseline `rgb-led`)

Sources: [kit 1.1.2](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.1.2%20RGB%20LED.html),
[YSL-R596CR3G4B5C-C10](https://www.sparkfun.com/datasheets/Components/YSL-R596CR3G4B5C-C10.pdf) (the 5 mm common-cathode RGB LED),
Yageo CFR (resistor), Raspberry Pi GPIO documentation.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| rgb-led-1 | placement | LED legs in rows 23, 25, 27 and 28, the red one in row 23 column e | On the bench the T-board body covers columns d–h of rows 21–23 (`tboardBlockedHoles`), so 23e cannot take a lead. The rebuild uses rows 26–29 | SPEC 6.6; `content/controllers/tboard.json` (ADR-0004) | Doesn't work | placement check (`validateDoc`) | Fixed |
| rgb-led-2 | LED leads | Anodes in rows 23, 25 and 27 and the cathode ("longest leg") in row 28, as if the leads could be spread over non-adjacent rows with the cathode at the end | The four leads sit in four consecutive holes in the order red, common cathode, green, blue. The cathode (the longest lead) is the second one | [YSL-R596CR3G4B5C-C10](https://www.sparkfun.com/datasheets/Components/YSL-R596CR3G4B5C-C10.pdf) p.2 pin drawing; kit 1.1.2 | Doesn't work | D1's rigid footprint in `validateDoc`; sim: "GPIO17 HIGH lights the red die alone…" | Fixed |
| rgb-led-3 | diagram | `wiringDiagram` draws the LED in rows 27–28 and the resistors in rows 22–27, which contradicts the wiring text, and it draws leads from `cobbler:` pins of a different board | The diagram is replaced by the generated hole-by-hole table and build steps | SPEC 6.5, 16.1 | Misleading | "matches AUDIT.md's generated table and steps" | Fixed |
| rgb-led-4 | colour balance | The description says the LED can "mix any color" and the theory treats the three channels alike; nothing says that green and blue run at the edge of what a 3.3 V pin can drive | At 3.3 V through 220 Ω the red die carries about 5.3 mA and the green and blue dies about 1.3 mA each, because their forward voltage (3.0–3.4 V at 20 mA) is close to the supply. All stay within the 20 mA die rating and the 16 mA pin limit; white looks reddish | [YSL-R596CR3G4B5C-C10](https://www.sparkfun.com/datasheets/Components/YSL-R596CR3G4B5C-C10.pdf) p.1 | Misleading | sim: "All three HIGH mix white…" and the per-colour assertions | Fixed |
| rgb-led-5 | code | PWM at 1000 Hz; the pins carry no initial level | 2 kHz as the kit uses, and every pin set up LOW so the LED is dark until the program lights it | Kit 1.1.2 | Cosmetic | code/netlist pin check; sim: "All three LOW leaves the LED dark" | Fixed |
| rgb-led-6 | kit code | (Kit, not the baseline) the kit's own code sets each pin HIGH at set-up, which with a common cathode lights all three colours at full brightness until PWM starts | The code in this app sets the pins up LOW | Kit 1.1.2 | Cosmetic | the same assertions | Fixed |
| rgb-led-7 | GPIOs, resistors, polarity | GPIO17, GPIO18 and GPIO27 for red, green and blue; three 220 Ω resistors; common cathode to GND, HIGH lights a colour; four leads | Correct, and the same as the kit | Kit 1.1.2 | None | per-colour sim assertions | Correct |

Generated wiring table and build steps:

<!-- generated:rgb-led -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 26 column b | GPIO17 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 26 column f | N3 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 28 column b | GPIO18 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 28 column f | N2 |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 29 column b | GPIO27 |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 29 column f | N1 |
| D1 | RGB LED, 5 mm, common cathode | Red anode (pin 1) | row 26 column h | N3 |
| D1 | RGB LED, 5 mm, common cathode | Common cathode (pin 2, longest lead) | row 27 column h | GND |
| D1 | RGB LED, 5 mm, common cathode | Green anode (pin 3) | row 28 column h | N2 |
| D1 | RGB LED, 5 mm, common cathode | Blue anode (pin 4) | row 29 column h | N1 |
| W1 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W1 | yellow male–male jumper | end b | row 26 column a | GPIO17 |
| W2 | green male–male jumper | end a | row 6 column j | GPIO18 |
| W2 | green male–male jumper | end b | row 28 column a | GPIO18 |
| W3 | blue male–male jumper | end a | row 7 column a | GPIO27 |
| W3 | blue male–male jumper | end b | row 29 column a | GPIO27 |
| W4 | black male–male jumper | end a | row 3 column j | GND |
| W4 | black male–male jumper | end b | row 27 column j | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 220 Ω resistor (red, red, brown, gold), from row 26 column b to row 26 column f.
3. Insert R2, the 220 Ω resistor (red, red, brown, gold), from row 28 column b to row 28 column f.
4. Insert R3, the 220 Ω resistor (red, red, brown, gold), from row 29 column b to row 29 column f.
5. Insert D1, the RGB LED, 5 mm, common cathode, with pin R (Red anode (pin 1)) in row 26 column h and pin B (Blue anode (pin 4)) in row 29 column h.
6. Use a yellow 20 cm male–male jumper (W1) from row 6 column a to row 26 column a.
7. Use a green 20 cm male–male jumper (W2) from row 6 column j to row 28 column a.
8. Use a blue 20 cm male–male jumper (W3) from row 7 column a to row 29 column a.
9. Use a black 20 cm male–male jumper (W4) from row 3 column j to row 27 column j.
<!-- /generated:rgb-led -->
<!-- /section:rgb-led -->

<!-- section:led-dot-matrix -->
### LED Dot Matrix (`led-dot-matrix`, kit 1.1.3; no baseline tutorial)

Sources: [kit 1.1.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.1.3%20LED%20Dot%20Matrix.html)
(page text, pin tables, schematic and wiring image),
[Toplite TOP-CA-788BS](https://www.ledtoplite.com/uploadfile/2017/TOP-CA-788BS.pdf) (the 788BS matrix),
[TI SN74HC595](https://www.ti.com/lit/ds/symlink/sn74hc595.pdf), Raspberry Pi GPIO documentation.
The baseline has no dot-matrix tutorial, so the "Baseline" column holds what the kit page says.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| led-dot-matrix-1 | output current | (Kit) The 74HC595 outputs go straight to the matrix with no series resistors, and the page does not say what limits the current | Only the chip's own output resistance limits it. In the simulation one lit LED carries 7.7 mA, a lit row 1.5 mA per LED (11.7 mA through its one output), a lit column 2.4 mA per LED (19.5 mA through its one output), and all 64 LEDs 1.05 mA each (8.4 mA per output, 67 mA through each chip's VCC or GND). That is inside the SN74HC595's 35 mA per output and 70 mA VCC/GND absolute maxima, but above the 6 mA it rates its output levels at, with thin margin at the supply. The kit circuit is followed as it is, and the assertions bound each shared output; the code lights one row at a time | [SN74HC595](https://www.ti.com/lit/ds/symlink/sn74hc595.pdf) §6.1, §6.5 | Misleading | sim: "ROW 1 selected…", "COL 8 low…" and "All 64 LEDs on at once…" | Fixed |
| led-dot-matrix-2 | pin map | (Kit) Row pins 9, 14, 8, 12, 1, 7, 2, 5 are the anodes; column pins 13, 3, 4, 10, 6, 11, 15, 16 are the cathodes. The page's schematic joins the first chip's QA to QH to rows 1 to 8 and the second chip's QA to QH to columns 1 to 8 | Correct: the pin tables agree with the Toplite circuit diagram, and the wiring in the rebuild follows the schematic output by output | Kit 1.1.3; TOP-CA-788BS p.2 | None | sim: "ROW 3 selected with COL 5 low lights that one LED and no other" (all 64 dies checked) | Correct |
| led-dot-matrix-3 | polarity | (Kit) Common anode: a row HIGH and a column LOW light the LED where they cross | Correct. The first byte shifted goes to the second chip (columns, 0 lights) and the second byte to the first chip (rows, 1 selects) | Kit 1.1.3 | None | the same sim assertions | Correct |
| led-dot-matrix-4 | GPIOs and control pins | (Kit) GPIO17 to the first chip's SER, GPIO18 to RCLK and GPIO27 to SRCLK on both chips, QH′ of the first chip to SER of the second, SRCLR (MR) to 3.3 V, OE (CE) to GND, VCC 3.3 V | Correct. The chips run from 3.3 V, inside their 2–6 V supply range; the GPIO's 2.9 V minimum high level is above the input threshold, which the datasheet tabulates only at 2, 4.5 and 6 V (the 3.3 V figure is interpolated, about 2.4 V) | Kit 1.1.3; SN74HC595 §6.3; Raspberry Pi GPIO documentation | None | code/netlist pin check; sim: the shift-register states in the assertions | Correct |

Generated wiring table and build steps:

<!-- generated:led-dot-matrix -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| U1 | 74HC595 8-bit shift register (DIP-16) | QB | row 25 column e | N6 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QC | row 26 column e | N15 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QD | row 27 column e | N4 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QE | row 28 column e | N1 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QF | row 29 column e | N14 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QG | row 30 column e | N9 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QH | row 31 column e | N12 |
| U1 | 74HC595 8-bit shift register (DIP-16) | GND | row 32 column e | GND |
| U1 | 74HC595 8-bit shift register (DIP-16) | QH' | row 32 column f | N17 |
| U1 | 74HC595 8-bit shift register (DIP-16) | SRCLR | row 31 column f | 3V3 |
| U1 | 74HC595 8-bit shift register (DIP-16) | SRCLK | row 30 column f | GPIO27 |
| U1 | 74HC595 8-bit shift register (DIP-16) | RCLK | row 29 column f | GPIO18 |
| U1 | 74HC595 8-bit shift register (DIP-16) | OE | row 28 column f | GND |
| U1 | 74HC595 8-bit shift register (DIP-16) | SER | row 27 column f | GPIO17 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QA | row 26 column f | N16 |
| U1 | 74HC595 8-bit shift register (DIP-16) | VCC | row 25 column f | 3V3 |
| U2 | 74HC595 8-bit shift register (DIP-16) | QB | row 35 column e | N10 |
| U2 | 74HC595 8-bit shift register (DIP-16) | QC | row 36 column e | N11 |
| U2 | 74HC595 8-bit shift register (DIP-16) | QD | row 37 column e | N2 |
| U2 | 74HC595 8-bit shift register (DIP-16) | QE | row 38 column e | N13 |
| U2 | 74HC595 8-bit shift register (DIP-16) | QF | row 39 column e | N3 |
| U2 | 74HC595 8-bit shift register (DIP-16) | QG | row 40 column e | N7 |
| U2 | 74HC595 8-bit shift register (DIP-16) | QH | row 41 column e | N8 |
| U2 | 74HC595 8-bit shift register (DIP-16) | GND | row 42 column e | GND |
| U2 | 74HC595 8-bit shift register (DIP-16) | QH' | row 42 column f | N18 |
| U2 | 74HC595 8-bit shift register (DIP-16) | SRCLR | row 41 column f | 3V3 |
| U2 | 74HC595 8-bit shift register (DIP-16) | SRCLK | row 40 column f | GPIO27 |
| U2 | 74HC595 8-bit shift register (DIP-16) | RCLK | row 39 column f | GPIO18 |
| U2 | 74HC595 8-bit shift register (DIP-16) | OE | row 38 column f | GND |
| U2 | 74HC595 8-bit shift register (DIP-16) | SER | row 37 column f | N17 |
| U2 | 74HC595 8-bit shift register (DIP-16) | QA | row 36 column f | N5 |
| U2 | 74HC595 8-bit shift register (DIP-16) | VCC | row 35 column f | 3V3 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | ROW5 | row 45 column b | N1 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | ROW7 | row 46 column b | N9 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | COL2 | row 47 column b | N10 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | COL3 | row 48 column b | N11 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | ROW8 | row 49 column b | N12 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | COL5 | row 50 column b | N13 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | ROW6 | row 51 column b | N14 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | ROW3 | row 52 column b | N15 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | ROW1 | row 52 column f | N16 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | COL4 | row 51 column f | N2 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | COL6 | row 50 column f | N3 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | ROW4 | row 49 column f | N4 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | COL1 | row 48 column f | N5 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | ROW2 | row 47 column f | N6 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | COL7 | row 46 column f | N7 |
| M1 | 8x8 LED dot matrix, common anode (788BS, 20 mm) | COL8 | row 45 column f | N8 |
| W1 | red male–male jumper | end a | row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | the top + rail at row 3 | 3V3 |
| W2 | black male–male jumper | end a | row 3 column j | GND |
| W2 | black male–male jumper | end b | the top − rail at row 3 | GND |
| W3 | red male–male jumper | end a | row 25 column j | 3V3 |
| W3 | red male–male jumper | end b | the top + rail at row 25 | 3V3 |
| W4 | red male–male jumper | end a | row 31 column j | 3V3 |
| W4 | red male–male jumper | end b | the top + rail at row 31 | 3V3 |
| W5 | black male–male jumper | end a | row 32 column a | GND |
| W5 | black male–male jumper | end b | the top − rail at row 31 | GND |
| W6 | black male–male jumper | end a | row 28 column j | GND |
| W6 | black male–male jumper | end b | the top − rail at row 28 | GND |
| W7 | red male–male jumper | end a | row 35 column j | 3V3 |
| W7 | red male–male jumper | end b | the top + rail at row 35 | 3V3 |
| W8 | red male–male jumper | end a | row 41 column j | 3V3 |
| W8 | red male–male jumper | end b | the top + rail at row 41 | 3V3 |
| W9 | black male–male jumper | end a | row 42 column a | GND |
| W9 | black male–male jumper | end b | the top − rail at row 42 | GND |
| W10 | black male–male jumper | end a | row 38 column j | GND |
| W10 | black male–male jumper | end b | the top − rail at row 37 | GND |
| W11 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W11 | yellow male–male jumper | end b | row 27 column j | GPIO17 |
| W12 | green male–male jumper | end a | row 6 column j | GPIO18 |
| W12 | green male–male jumper | end b | row 29 column j | GPIO18 |
| W13 | green male–male jumper | end a | row 29 column i | GPIO18 |
| W13 | green male–male jumper | end b | row 39 column j | GPIO18 |
| W14 | blue male–male jumper | end a | row 7 column a | GPIO27 |
| W14 | blue male–male jumper | end b | row 30 column j | GPIO27 |
| W15 | blue male–male jumper | end a | row 30 column i | GPIO27 |
| W15 | blue male–male jumper | end b | row 40 column j | GPIO27 |
| W16 | white male–male jumper | end a | row 32 column j | N17 |
| W16 | white male–male jumper | end b | row 37 column j | N17 |
| W17 | brown male–male jumper | end a | row 26 column j | N16 |
| W17 | brown male–male jumper | end b | row 52 column j | N16 |
| W18 | violet male–male jumper | end a | row 25 column a | N6 |
| W18 | violet male–male jumper | end b | row 47 column j | N6 |
| W19 | grey male–male jumper | end a | row 26 column a | N15 |
| W19 | grey male–male jumper | end b | row 52 column a | N15 |
| W20 | white male–male jumper | end a | row 27 column a | N4 |
| W20 | white male–male jumper | end b | row 49 column j | N4 |
| W21 | yellow male–male jumper | end a | row 28 column a | N1 |
| W21 | yellow male–male jumper | end b | row 45 column a | N1 |
| W22 | green male–male jumper | end a | row 29 column a | N14 |
| W22 | green male–male jumper | end b | row 51 column a | N14 |
| W23 | blue male–male jumper | end a | row 30 column a | N9 |
| W23 | blue male–male jumper | end b | row 46 column a | N9 |
| W24 | violet male–male jumper | end a | row 31 column a | N12 |
| W24 | violet male–male jumper | end b | row 49 column a | N12 |
| W25 | white male–male jumper | end a | row 36 column j | N5 |
| W25 | white male–male jumper | end b | row 48 column j | N5 |
| W26 | yellow male–male jumper | end a | row 35 column a | N10 |
| W26 | yellow male–male jumper | end b | row 47 column a | N10 |
| W27 | green male–male jumper | end a | row 36 column a | N11 |
| W27 | green male–male jumper | end b | row 48 column a | N11 |
| W28 | blue male–male jumper | end a | row 37 column a | N2 |
| W28 | blue male–male jumper | end b | row 51 column j | N2 |
| W29 | violet male–male jumper | end a | row 38 column a | N13 |
| W29 | violet male–male jumper | end b | row 50 column a | N13 |
| W30 | brown male–male jumper | end a | row 39 column a | N3 |
| W30 | brown male–male jumper | end b | row 50 column j | N3 |
| W31 | violet male–male jumper | end a | row 40 column a | N7 |
| W31 | violet male–male jumper | end b | row 46 column j | N7 |
| W32 | grey male–male jumper | end a | row 41 column a | N8 |
| W32 | grey male–male jumper | end b | row 45 column j | N8 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Use a red 20 cm male–male jumper (W1) from row 1 column a to the top + rail at row 3.
3. Use a black 20 cm male–male jumper (W2) from row 3 column j to the top − rail at row 3.
4. Use a red 20 cm male–male jumper (W3) from row 25 column j to the top + rail at row 25.
5. Use a red 20 cm male–male jumper (W4) from row 31 column j to the top + rail at row 31.
6. Use a black 20 cm male–male jumper (W5) from row 32 column a to the top − rail at row 31.
7. Use a black 20 cm male–male jumper (W6) from row 28 column j to the top − rail at row 28.
8. Use a red 20 cm male–male jumper (W7) from row 35 column j to the top + rail at row 35.
9. Use a red 20 cm male–male jumper (W8) from row 41 column j to the top + rail at row 41.
10. Use a black 20 cm male–male jumper (W9) from row 42 column a to the top − rail at row 42.
11. Use a black 20 cm male–male jumper (W10) from row 38 column j to the top − rail at row 37.
12. Insert U1, the 74HC595 8-bit shift register (DIP-16), across the trench with pin 1 (QB) in row 25 column e and pin 16 (VCC) in row 25 column f.
13. Insert U2, the 74HC595 8-bit shift register (DIP-16), across the trench with pin 1 (QB) in row 35 column e and pin 16 (VCC) in row 35 column f.
14. Insert M1, the 8x8 LED dot matrix, common anode (788BS, 20 mm), across the trench with pin 1 (ROW5) in row 45 column b and pin 16 (COL8) in row 45 column f.
15. Use a yellow 20 cm male–male jumper (W11) from row 6 column a to row 27 column j.
16. Use a green 20 cm male–male jumper (W12) from row 6 column j to row 29 column j.
17. Use a blue 20 cm male–male jumper (W14) from row 7 column a to row 30 column j.
18. Use a violet 20 cm male–male jumper (W18) from row 25 column a to row 47 column j.
19. Use a brown 20 cm male–male jumper (W17) from row 26 column j to row 52 column j.
20. Use a grey 20 cm male–male jumper (W19) from row 26 column a to row 52 column a.
21. Use a white 20 cm male–male jumper (W20) from row 27 column a to row 49 column j.
22. Use a yellow 20 cm male–male jumper (W21) from row 28 column a to row 45 column a.
23. Use a green 20 cm male–male jumper (W13) from row 29 column i to row 39 column j.
24. Use a green 20 cm male–male jumper (W22) from row 29 column a to row 51 column a.
25. Use a blue 20 cm male–male jumper (W15) from row 30 column i to row 40 column j.
26. Use a blue 20 cm male–male jumper (W23) from row 30 column a to row 46 column a.
27. Use a violet 20 cm male–male jumper (W24) from row 31 column a to row 49 column a.
28. Use a white 20 cm male–male jumper (W16) from row 32 column j to row 37 column j.
29. Use a yellow 20 cm male–male jumper (W26) from row 35 column a to row 47 column a.
30. Use a white 20 cm male–male jumper (W25) from row 36 column j to row 48 column j.
31. Use a green 20 cm male–male jumper (W27) from row 36 column a to row 48 column a.
32. Use a blue 20 cm male–male jumper (W28) from row 37 column a to row 51 column j.
33. Use a violet 20 cm male–male jumper (W29) from row 38 column a to row 50 column a.
34. Use a brown 20 cm male–male jumper (W30) from row 39 column a to row 50 column j.
35. Use a violet 20 cm male–male jumper (W31) from row 40 column a to row 46 column j.
36. Use a grey 20 cm male–male jumper (W32) from row 41 column a to row 45 column j.
<!-- /generated:led-dot-matrix -->
<!-- /section:led-dot-matrix -->

<!-- section:seven-segment -->
### 7-Segment Display (`seven-segment`, kit 1.1.4; baseline `seven-segment`)

Sources: [kit 1.1.4](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.1.4%207-segment%20Display.html)
(page text, schematic and wiring image), Kingbright
[SC56-11EWA](https://www.kingbrightusa.com/images/catalog/SPEC/SC56-11EWA.pdf) (the pin-compatible common-cathode display),
[TI SN74HC595](https://www.ti.com/lit/ds/symlink/sn74hc595.pdf), Yageo CFR (resistor), Raspberry Pi GPIO documentation.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| seven-segment-1 | wiring text | "Row 22a → Segment a" and so on (rows 22 to 29 in column a, which the T-board body does not cover): no hole is given for the display or for any of the eight resistors ("220Ω resistor in-line"), and `wiringDiagram` lists no components at all, so the circuit cannot be built from the page | The generated table gives every hole, and the display, the chip and the resistor are placed on rows 25–43 | SPEC 16.1 | Doesn't work | placement check (`validateDoc`); "matches AUDIT.md's generated table and steps" | Fixed |
| seven-segment-2 | circuit | Eight GPIOs (17, 18, 27, 22, 23, 24, 25 and 5) each drive one segment through its own 220 Ω; the theory says "each segment connects to a GPIO pin through a resistor" | The kit uses three GPIOs and a 74HC595: GPIO17 to SER, GPIO18 to RCLK, GPIO27 to SRCLK, outputs QA to QH on segments a, b, c, d, e, f, g and dp, and one 220 Ω from the common pins to GND. The baseline circuit is electrically sound, at roughly 6 mA a pin, but it is not the kit's and it uses most of the 50 mA total the GPIO documentation allows (about 40 mA with seven segments lit, 46 mA with the point) | [Kit 1.1.4](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.1.4%207-segment%20Display.html); Raspberry Pi GPIO documentation | Misleading | sim: "Byte 0x3F lights the segments of "0"…" and the other pattern assertions | Fixed |
| seven-segment-3 | brightness | (Kit) One resistor in the common line, so the current is set for the whole display and not per segment | Followed, but the page does not say what it means: brightness depends on how many segments are lit. In the simulation a lone decimal point carries 4.4 mA, a "1" 2.7 mA a segment, a "0" 1.1 mA, an "8" 0.93 mA and all eight 0.83 mA. All are far below the 30 mA rating and below the 10 mA at which the datasheet specifies brightness, so the display is dimmer than its datasheet figures. The theory explains it | [SC56-11EWA](https://www.kingbrightusa.com/images/catalog/SPEC/SC56-11EWA.pdf) p.2 | Misleading | sim: "Byte 0x7F lights…", "Byte 0x06…", "All eight segments on at once…" | Fixed |
| seven-segment-4 | kit text | (Kit) The page says the kit display is common cathode, but its code comments call the code table "common-anode… a low bit turns a segment ON", although the table sets a bit to light a segment and the schematic ties the common pin to GND | The page text and the schematic govern (ADR-0011): common cathode, a 1 bit lights a segment | Kit 1.1.4; `content/parts/seven-segment-cc.part.json` provenance | Cosmetic | the pattern assertions (a 1 bit lights its segment) | Fixed |
| seven-segment-5 | kit schematic | (Kit) The schematic labels the bottom-left pin of the display "c", twice | That pin is segment e. The part follows the Kingbright pin map: a is pin 7, b 6, c 4, d 2, e 1, f 9, g 10, dp 5, and pins 3 and 8 are the common cathode | SC56-11EWA p.1 | Cosmetic | sim: the pattern assertions name every segment | Fixed |
| seven-segment-6 | code | Digits 0 to 9 only, the point forced off, a table of seven values for each | Digits 0 to F, as the kit shows, from the lit segments of each glyph, with every pin set up LOW so the display is dark until the program lights it | Kit 1.1.4 | Cosmetic | code/netlist pin check | Fixed |
| seven-segment-7 | patterns, polarity, parts | The segment patterns for 0 to 9, common cathode with HIGH lighting a segment, one 7-segment display and 220 Ω resistors | Correct: the patterns match the kit's table, and the part is the kit's common-cathode display | Kit 1.1.4 | None | sim: "Byte 0x3F…", "Byte 0x06…", "Byte 0x7F…", "Byte 0x71…" | Correct |

Generated wiring table and build steps:

<!-- generated:seven-segment -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| U1 | 74HC595 8-bit shift register (DIP-16) | QB | row 25 column e | N7 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QC | row 26 column e | N5 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QD | row 27 column e | N3 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QE | row 28 column e | N1 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QF | row 29 column e | N9 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QG | row 30 column e | N2 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QH | row 31 column e | N6 |
| U1 | 74HC595 8-bit shift register (DIP-16) | GND | row 32 column e | GND |
| U1 | 74HC595 8-bit shift register (DIP-16) | QH' | row 32 column f | N10 |
| U1 | 74HC595 8-bit shift register (DIP-16) | SRCLR | row 31 column f | 3V3 |
| U1 | 74HC595 8-bit shift register (DIP-16) | SRCLK | row 30 column f | GPIO27 |
| U1 | 74HC595 8-bit shift register (DIP-16) | RCLK | row 29 column f | GPIO18 |
| U1 | 74HC595 8-bit shift register (DIP-16) | OE | row 28 column f | GND |
| U1 | 74HC595 8-bit shift register (DIP-16) | SER | row 27 column f | GPIO17 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QA | row 26 column f | N8 |
| U1 | 74HC595 8-bit shift register (DIP-16) | VCC | row 25 column f | 3V3 |
| DS1 | 7-segment display, common cathode (0.56 in, 1 digit) | e | row 36 column b | N1 |
| DS1 | 7-segment display, common cathode (0.56 in, 1 digit) | d | row 37 column b | N3 |
| DS1 | 7-segment display, common cathode (0.56 in, 1 digit) | COM | row 38 column b | N4 |
| DS1 | 7-segment display, common cathode (0.56 in, 1 digit) | c | row 39 column b | N5 |
| DS1 | 7-segment display, common cathode (0.56 in, 1 digit) | dp | row 40 column b | N6 |
| DS1 | 7-segment display, common cathode (0.56 in, 1 digit) | b | row 40 column f | N7 |
| DS1 | 7-segment display, common cathode (0.56 in, 1 digit) | a | row 39 column f | N8 |
| DS1 | 7-segment display, common cathode (0.56 in, 1 digit) | COM | row 38 column f | N4 |
| DS1 | 7-segment display, common cathode (0.56 in, 1 digit) | f | row 37 column f | N9 |
| DS1 | 7-segment display, common cathode (0.56 in, 1 digit) | g | row 36 column f | N2 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 38 column i | N4 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 43 column i | GND |
| W1 | red male–male jumper | end a | row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | the top + rail at row 3 | 3V3 |
| W2 | black male–male jumper | end a | row 3 column j | GND |
| W2 | black male–male jumper | end b | the top − rail at row 3 | GND |
| W3 | red male–male jumper | end a | row 25 column j | 3V3 |
| W3 | red male–male jumper | end b | the top + rail at row 25 | 3V3 |
| W4 | red male–male jumper | end a | row 31 column j | 3V3 |
| W4 | red male–male jumper | end b | the top + rail at row 31 | 3V3 |
| W5 | black male–male jumper | end a | row 32 column a | GND |
| W5 | black male–male jumper | end b | the top − rail at row 31 | GND |
| W6 | black male–male jumper | end a | row 28 column j | GND |
| W6 | black male–male jumper | end b | the top − rail at row 28 | GND |
| W7 | black male–male jumper | end a | row 43 column j | GND |
| W7 | black male–male jumper | end b | the top − rail at row 43 | GND |
| W8 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W8 | yellow male–male jumper | end b | row 27 column j | GPIO17 |
| W9 | green male–male jumper | end a | row 6 column j | GPIO18 |
| W9 | green male–male jumper | end b | row 29 column j | GPIO18 |
| W10 | blue male–male jumper | end a | row 7 column a | GPIO27 |
| W10 | blue male–male jumper | end b | row 30 column j | GPIO27 |
| W11 | brown male–male jumper | end a | row 26 column j | N8 |
| W11 | brown male–male jumper | end b | row 39 column j | N8 |
| W12 | violet male–male jumper | end a | row 25 column a | N7 |
| W12 | violet male–male jumper | end b | row 40 column j | N7 |
| W13 | grey male–male jumper | end a | row 26 column a | N5 |
| W13 | grey male–male jumper | end b | row 39 column a | N5 |
| W14 | white male–male jumper | end a | row 27 column a | N3 |
| W14 | white male–male jumper | end b | row 37 column a | N3 |
| W15 | yellow male–male jumper | end a | row 28 column a | N1 |
| W15 | yellow male–male jumper | end b | row 36 column a | N1 |
| W16 | green male–male jumper | end a | row 29 column a | N9 |
| W16 | green male–male jumper | end b | row 37 column j | N9 |
| W17 | blue male–male jumper | end a | row 30 column a | N2 |
| W17 | blue male–male jumper | end b | row 36 column j | N2 |
| W18 | violet male–male jumper | end a | row 31 column a | N6 |
| W18 | violet male–male jumper | end b | row 40 column a | N6 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Use a red 20 cm male–male jumper (W1) from row 1 column a to the top + rail at row 3.
3. Use a black 20 cm male–male jumper (W2) from row 3 column j to the top − rail at row 3.
4. Use a red 20 cm male–male jumper (W3) from row 25 column j to the top + rail at row 25.
5. Use a red 20 cm male–male jumper (W4) from row 31 column j to the top + rail at row 31.
6. Use a black 20 cm male–male jumper (W5) from row 32 column a to the top − rail at row 31.
7. Use a black 20 cm male–male jumper (W6) from row 28 column j to the top − rail at row 28.
8. Use a black 20 cm male–male jumper (W7) from row 43 column j to the top − rail at row 43.
9. Insert R1, the 220 Ω resistor (red, red, brown, gold), from row 38 column i to row 43 column i.
10. Insert U1, the 74HC595 8-bit shift register (DIP-16), across the trench with pin 1 (QB) in row 25 column e and pin 16 (VCC) in row 25 column f.
11. Insert DS1, the 7-segment display, common cathode (0.56 in, 1 digit), across the trench with pin 1 (e) in row 36 column b and pin 10 (g) in row 36 column f.
12. Use a yellow 20 cm male–male jumper (W8) from row 6 column a to row 27 column j.
13. Use a green 20 cm male–male jumper (W9) from row 6 column j to row 29 column j.
14. Use a blue 20 cm male–male jumper (W10) from row 7 column a to row 30 column j.
15. Use a violet 20 cm male–male jumper (W12) from row 25 column a to row 40 column j.
16. Use a brown 20 cm male–male jumper (W11) from row 26 column j to row 39 column j.
17. Use a grey 20 cm male–male jumper (W13) from row 26 column a to row 39 column a.
18. Use a white 20 cm male–male jumper (W14) from row 27 column a to row 37 column a.
19. Use a yellow 20 cm male–male jumper (W15) from row 28 column a to row 36 column a.
20. Use a green 20 cm male–male jumper (W16) from row 29 column a to row 37 column j.
21. Use a blue 20 cm male–male jumper (W17) from row 30 column a to row 36 column j.
22. Use a violet 20 cm male–male jumper (W18) from row 31 column a to row 40 column a.
<!-- /generated:seven-segment -->
<!-- /section:seven-segment -->

<!-- section:led-bar-graph -->
### LED Bar Graph (`led-bar-graph`, kit 1.3.3; no baseline tutorial)

Sources: [kit 1.3.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.3.3%20LED%20Bar%20Graph.html)
(page text, pin table, schematic and wiring image), Kingbright
[DC10EWA](https://www.kingbrightusa.com/images/catalog/spec/DC10EWA.pdf) (the pin-compatible 10-segment bar; the kit part is
marked 2510SR-1 and no datasheet for that marking was found), Yageo CFR (resistor), Raspberry Pi GPIO documentation.
The baseline has no bar-graph tutorial, so the "Baseline" column holds what the kit page says.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| led-bar-graph-1 | current budget | (Kit) The code lights one bar at a time, and the page says nothing about how many can be on together | One lit bar passes about 5.8 mA through its pin (7.3 mA for GPIO2 and GPIO3, which have fixed 1.8 kΩ pull-ups). That is far below the 16 mA pin limit, but all ten together pass 61 mA, above the 50 mA total the GPIO documentation allows. Up to eight lit together stay inside it (49 mA at the worst). The code lights one bar at a time, and the theory says why | Raspberry Pi GPIO documentation ("Outputs"); `core/constants/rp1.ts` (ADR-0009) | Misleading | sim: every "GPIO… LOW lights bar…" assertion (each pin within 16 mA) | Fixed |
| led-bar-graph-2 | bar order | (Kit) The table lists GPIO17, 18, 27, 22, 23, 24, 25, SDA1, SCL1 and SPICE0 as "LED 1 to 10" but does not say which physical bar each one drives | Read from the wiring image: bar n has its anode on pin n and its cathode on pin 21 − n, so GPIO17 drives pins 1 and 20 and GPIO8 drives pins 10 and 11, in order along the body. The rebuild follows that | Kit 1.3.3 (wiring image); DC10EWA p.1 internal circuit | Cosmetic | sim: each assertion names the one bar its GPIO lights | Fixed |
| led-bar-graph-3 | kit text | (Kit) The code comments call the bar "common anode", although the ten LEDs share no pin | The LEDs are independent. LOW lights a bar because each cathode is on a GPIO and each anode is fed from 3.3 V through a resistor | Kit 1.3.3; DC10EWA p.1 | Cosmetic | sim: "All ten pins HIGH leaves every bar dark" | Fixed |
| led-bar-graph-4 | GPIO2, GPIO3, GPIO8 | (Kit) Bars 8, 9 and 10 use SDA1, SCL1 and SPICE0 as ordinary outputs | Works: the fixed pull-ups on GPIO2 and GPIO3 add about 1.7 mA to the pin while it is LOW and nothing while it is HIGH. The I²C and SPI interfaces must stay off while the project runs, because their drivers own these pins when enabled | Raspberry Pi GPIO documentation ("Inputs") | Cosmetic | sim: "GPIO2 LOW lights bar 8…", "GPIO3 LOW lights bar 9…" | Fixed |
| led-bar-graph-5 | circuit | (Kit) Ten 220 Ω resistors from 3.3 V to the anodes, the cathodes on ten GPIOs, a LOW pin lights its bar | Correct, and the same as the kit | Kit 1.3.3 | None | per-bar sim assertions | Correct |

Generated wiring table and build steps:

<!-- generated:led-bar-graph -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| B1 | 10-segment LED bar graph (20-pin) | A1 | row 27 column e | N1 |
| B1 | 10-segment LED bar graph (20-pin) | A2 | row 28 column e | N3 |
| B1 | 10-segment LED bar graph (20-pin) | A3 | row 29 column e | N4 |
| B1 | 10-segment LED bar graph (20-pin) | A4 | row 30 column e | N5 |
| B1 | 10-segment LED bar graph (20-pin) | A5 | row 31 column e | N6 |
| B1 | 10-segment LED bar graph (20-pin) | A6 | row 32 column e | N7 |
| B1 | 10-segment LED bar graph (20-pin) | A7 | row 33 column e | N8 |
| B1 | 10-segment LED bar graph (20-pin) | A8 | row 34 column e | N9 |
| B1 | 10-segment LED bar graph (20-pin) | A9 | row 35 column e | N10 |
| B1 | 10-segment LED bar graph (20-pin) | A10 | row 36 column e | N2 |
| B1 | 10-segment LED bar graph (20-pin) | K10 | row 36 column f | GPIO8 |
| B1 | 10-segment LED bar graph (20-pin) | K9 | row 35 column f | GPIO3 |
| B1 | 10-segment LED bar graph (20-pin) | K8 | row 34 column f | GPIO2 |
| B1 | 10-segment LED bar graph (20-pin) | K7 | row 33 column f | GPIO25 |
| B1 | 10-segment LED bar graph (20-pin) | K6 | row 32 column f | GPIO24 |
| B1 | 10-segment LED bar graph (20-pin) | K5 | row 31 column f | GPIO23 |
| B1 | 10-segment LED bar graph (20-pin) | K4 | row 30 column f | GPIO22 |
| B1 | 10-segment LED bar graph (20-pin) | K3 | row 29 column f | GPIO27 |
| B1 | 10-segment LED bar graph (20-pin) | K2 | row 28 column f | GPIO18 |
| B1 | 10-segment LED bar graph (20-pin) | K1 | row 27 column f | GPIO17 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 27 column a | N1 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | the bottom + rail at row 27 | 3V3 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 28 column a | N3 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | the bottom + rail at row 28 | 3V3 |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 29 column a | N4 |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | the bottom + rail at row 29 | 3V3 |
| R4 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 30 column a | N5 |
| R4 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | the bottom + rail at row 30 | 3V3 |
| R5 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 31 column a | N6 |
| R5 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | the bottom + rail at row 31 | 3V3 |
| R6 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 32 column a | N7 |
| R6 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | the bottom + rail at row 33 | 3V3 |
| R7 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 33 column a | N8 |
| R7 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | the bottom + rail at row 34 | 3V3 |
| R8 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 34 column a | N9 |
| R8 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | the bottom + rail at row 35 | 3V3 |
| R9 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 35 column a | N10 |
| R9 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | the bottom + rail at row 36 | 3V3 |
| R10 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 36 column a | N2 |
| R10 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | the bottom + rail at row 37 | 3V3 |
| W1 | red male–male jumper | end a | row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | the bottom + rail at row 3 | 3V3 |
| W2 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W2 | yellow male–male jumper | end b | row 27 column j | GPIO17 |
| W3 | green male–male jumper | end a | row 6 column j | GPIO18 |
| W3 | green male–male jumper | end b | row 28 column j | GPIO18 |
| W4 | blue male–male jumper | end a | row 7 column a | GPIO27 |
| W4 | blue male–male jumper | end b | row 29 column j | GPIO27 |
| W5 | violet male–male jumper | end a | row 8 column a | GPIO22 |
| W5 | violet male–male jumper | end b | row 30 column j | GPIO22 |
| W6 | white male–male jumper | end a | row 8 column j | GPIO23 |
| W6 | white male–male jumper | end b | row 31 column j | GPIO23 |
| W7 | brown male–male jumper | end a | row 9 column j | GPIO24 |
| W7 | brown male–male jumper | end b | row 32 column j | GPIO24 |
| W8 | grey male–male jumper | end a | row 11 column j | GPIO25 |
| W8 | grey male–male jumper | end b | row 33 column j | GPIO25 |
| W9 | yellow male–male jumper | end a | row 2 column a | GPIO2 |
| W9 | yellow male–male jumper | end b | row 34 column j | GPIO2 |
| W10 | green male–male jumper | end a | row 3 column a | GPIO3 |
| W10 | green male–male jumper | end b | row 35 column j | GPIO3 |
| W11 | blue male–male jumper | end a | row 12 column j | GPIO8 |
| W11 | blue male–male jumper | end b | row 36 column j | GPIO8 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Use a red 20 cm male–male jumper (W1) from row 1 column a to the bottom + rail at row 3.
3. Insert R1, the 220 Ω resistor (red, red, brown, gold), from row 27 column a to the bottom + rail at row 27.
4. Insert R2, the 220 Ω resistor (red, red, brown, gold), from row 28 column a to the bottom + rail at row 28.
5. Insert R3, the 220 Ω resistor (red, red, brown, gold), from row 29 column a to the bottom + rail at row 29.
6. Insert R4, the 220 Ω resistor (red, red, brown, gold), from row 30 column a to the bottom + rail at row 30.
7. Insert R5, the 220 Ω resistor (red, red, brown, gold), from row 31 column a to the bottom + rail at row 31.
8. Insert R6, the 220 Ω resistor (red, red, brown, gold), from row 32 column a to the bottom + rail at row 33.
9. Insert R7, the 220 Ω resistor (red, red, brown, gold), from row 33 column a to the bottom + rail at row 34.
10. Insert R8, the 220 Ω resistor (red, red, brown, gold), from row 34 column a to the bottom + rail at row 35.
11. Insert R9, the 220 Ω resistor (red, red, brown, gold), from row 35 column a to the bottom + rail at row 36.
12. Insert R10, the 220 Ω resistor (red, red, brown, gold), from row 36 column a to the bottom + rail at row 37.
13. Insert B1, the 10-segment LED bar graph (20-pin), across the trench with pin 1 (A1) in row 27 column e and pin 20 (K1) in row 27 column f.
14. Use a yellow 20 cm male–male jumper (W9) from row 2 column a to row 34 column j.
15. Use a green 20 cm male–male jumper (W10) from row 3 column a to row 35 column j.
16. Use a yellow 20 cm male–male jumper (W2) from row 6 column a to row 27 column j.
17. Use a green 20 cm male–male jumper (W3) from row 6 column j to row 28 column j.
18. Use a blue 20 cm male–male jumper (W4) from row 7 column a to row 29 column j.
19. Use a violet 20 cm male–male jumper (W5) from row 8 column a to row 30 column j.
20. Use a white 20 cm male–male jumper (W6) from row 8 column j to row 31 column j.
21. Use a brown 20 cm male–male jumper (W7) from row 9 column j to row 32 column j.
22. Use a grey 20 cm male–male jumper (W8) from row 11 column j to row 33 column j.
23. Use a blue 20 cm male–male jumper (W11) from row 12 column j to row 36 column j.
<!-- /generated:led-bar-graph -->
<!-- /section:led-bar-graph -->

<!-- section:breathing-led -->
### Breathing LED (`breathing-led`, extra; baseline `breathing-led`)

Sources: Kingbright [WP7113ID](https://www.kingbrightusa.com/images/catalog/SPEC/WP7113ID.pdf) (red 5 mm LED) and
[WP7113QBC-D](https://www.kingbrightusa.com/images/catalog/SPEC/WP7113QBC-D.pdf) (blue), Yageo CFR (resistor),
[Raspberry Pi GPIO documentation](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc)
(header table and output limits), kit [1.1.2](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.1.2%20RGB%20LED.html)
(its PWM code). The kit has no breathing-LED page, so the circuit is the baseline's, checked against the datasheets.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| breathing-led-1 | placement | Resistor in rows 22–23 and the LED anode in row 23 column e | On the bench the T-board body covers columns d–h of rows 21–23 (`tboardBlockedHoles`), so 23e cannot take a lead. The rebuild uses rows 26–31 | SPEC 6.6; `content/controllers/tboard.json` (ADR-0004) | Doesn't work | placement check (`validateDoc`) | Fixed |
| breathing-led-2 | tip | "GPIO18 supports hardware PWM for smoother output, but software PWM works on any GPIO pin" | The Pi's header table lists the PWM0 and PWM1 outputs on GPIO12 and GPIO13 and describes GPIO18 as the PCM clock or SPI chip enable. The library the tutorial uses, RPi.GPIO, makes software PWM on every pin (the kit's own PWM code says so), so GPIO18 gives no smoother output than any other pin | Raspberry Pi GPIO documentation, header table; kit 1.1.2 | Misleading | prose; the theory states what the library does | Fixed |
| breathing-led-3 | LED colour | `wiringDiagram` draws a blue LED, and the parts list says "LED (any color)" | A blue LED needs about 3.3 V, the supply itself, so through 220 Ω it carries only about 1 mA against about 5.5 mA for a red one. The rebuild uses a red LED so the fade is easy to see | WP7113QBC-D (VF 3.3 V typical); WP7113ID | Misleading | sim: "GPIO18 HIGH lights D1…" | Fixed |
| breathing-led-4 | code | `pwm.start(0)`, then the first pass of the loop sets `(sin(0) + 1) / 2`, which is 50% duty, so the LED jumps from dark to half brightness; the duty cycle follows the sine linearly, though the eye does not judge brightness linearly | The cycle starts at 0% and eases up and down like a cosine, and the level is squared before it becomes the duty cycle so the fade looks even | PWM average current is proportional to duty | Cosmetic | sim: "PWM at 25%…", "50%…" and "75% duty…" | Fixed |
| breathing-led-5 | circuit | GPIO18, 220 Ω, one LED with its long leg toward the resistor and its short leg to GND, two jumper leads; HIGH lights it | Correct. At full duty the LED carries about 5.5 mA, within its 30 mA rating and the pin's 16 mA | WP7113ID; Raspberry Pi GPIO documentation | None | sim: "GPIO18 HIGH lights D1…", "GPIO18 LOW leaves D1 dark" | Correct |

Generated wiring table and build steps:

<!-- generated:breathing-led -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 26 column b | GPIO18 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 30 column b | N1 |
| D1 | red 5 mm LED | Anode (+) | row 30 column c | N1 |
| D1 | red 5 mm LED | Cathode (−) | row 31 column c | GND |
| W1 | green male–male jumper | end a | row 6 column j | GPIO18 |
| W1 | green male–male jumper | end b | row 26 column a | GPIO18 |
| W2 | black male–male jumper | end a | row 5 column a | GND |
| W2 | black male–male jumper | end b | row 31 column a | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 220 Ω resistor (red, red, brown, gold), from row 26 column b to row 30 column b.
3. Insert D1, the red 5 mm LED: anode (longer leg) in row 30 column c, cathode (shorter leg, flat side) in row 31 column c.
4. Use a green 20 cm male–male jumper (W1) from row 6 column j to row 26 column a.
5. Use a black 20 cm male–male jumper (W2) from row 5 column a to row 31 column a.
<!-- /generated:breathing-led -->
<!-- /section:breathing-led -->

<!-- section:flowing-leds -->
### Flowing LEDs (`flowing-leds`, extra; baseline `flowing-leds`)

Sources: Kingbright [WP7113ID](https://www.kingbrightusa.com/images/catalog/SPEC/WP7113ID.pdf) (red),
[WP7113YD](https://www.kingbrightusa.com/images/catalog/SPEC/WP7113YD.pdf) (yellow) and
[WP7113GD](https://www.kingbrightusa.com/images/catalog/SPEC/WP7113GD.pdf) (green) 5 mm LEDs, Yageo CFR (resistor),
[Raspberry Pi GPIO documentation](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc)
(output limits). The kit has no flowing-LED page, so the circuit is the baseline's, checked against the datasheets.
The kit's component list shows LEDs in five colours but not how many of each, so the build uses a mix (two green,
two yellow, four red) that needs no more than four of any colour.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| flowing-leds-1 | placement | "Signal … resistor row 22c, LED row 22h" and the same for rows 23 to 29; LEDs 1 and 2 are in rows 22 and 23 column h | On the bench the T-board body covers columns d–h of rows 21–23 (`tboardBlockedHoles`), so 22h and 23h cannot take a lead. The rebuild starts at row 26 | SPEC 6.6; `content/controllers/tboard.json` (ADR-0004) | Doesn't work | placement check (`validateDoc`) | Fixed |
| flowing-leds-2 | connection | The resistor is in column c (strip a–e) and the LED in column h (strip f–j) of the same row, and nothing joins them: the strips are on opposite sides of the trench, and the text gives only one hole for each resistor | A resistor crosses the trench from column b to column f, so its far end shares a strip with the LED's anode in column h | Breadboard strip layout (SPEC 6.1) | Doesn't work | the netlist the sim runs on: each "GPIO… HIGH lights LED…" assertion | Fixed |
| flowing-leds-3 | ground path | The text says to connect "all LED short legs to breadboard ground rail", the diagram draws GND to row 30 column a, and neither joins the rail to the T-board's GND or to the cathodes | The cathodes go to the top − rail, and one lead takes that rail to a GND strip on the T-board | SPEC 6.5 | Misleading | ERC `RAIL_UNPOWERED`; sim: every LED assertion needs the GND path | Fixed |
| flowing-leds-4 | current budget | (not stated) | Each LED carries about 5.1–5.5 mA through its pin, far under the 16 mA limit, and all eight together would carry about 43 mA, inside the 50 mA total with little room to add more | Raspberry Pi GPIO documentation ("Outputs") | Misleading | sim: "Four LEDs on together…" and the per-LED pin-current checks | Fixed |
| flowing-leds-5 | code and theory | The sweep runs the eight LEDs forward and then reversed, so each end LED lights twice in a row; the theory credits "persistence of vision" and compares the effect to a multiplexed matrix | The sweep bounces without repeating the end LEDs. Nothing is multiplexed here: each step lights one LED for 0.1 s and the eye joins the positions into a moving light | Prose | Cosmetic | code/netlist pin check | Fixed |
| flowing-leds-6 | pins, values, polarity | GPIO17, 18, 27, 22, 23, 24, 25 and 5, one 220 Ω resistor per LED, a HIGH pin lights its LED, nine jumper leads (eight signals and one ground) | Correct | WP7113 series; Raspberry Pi GPIO documentation | None | sim: per-LED assertions | Correct |

Generated wiring table and build steps:

<!-- generated:flowing-leds -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 26 column b | GPIO17 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 26 column f | N1 |
| D1 | green 5 mm LED | Anode (+) | row 26 column h | N1 |
| D1 | green 5 mm LED | Cathode (−) | the top − rail at row 25 | GND |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 29 column b | GPIO18 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 29 column f | N2 |
| D2 | yellow 5 mm LED | Anode (+) | row 29 column h | N2 |
| D2 | yellow 5 mm LED | Cathode (−) | the top − rail at row 29 | GND |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 32 column b | GPIO27 |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 32 column f | N3 |
| D3 | red 5 mm LED | Anode (+) | row 32 column h | N3 |
| D3 | red 5 mm LED | Cathode (−) | the top − rail at row 31 | GND |
| R4 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 35 column b | GPIO22 |
| R4 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 35 column f | N4 |
| D4 | red 5 mm LED | Anode (+) | row 35 column h | N4 |
| D4 | red 5 mm LED | Cathode (−) | the top − rail at row 35 | GND |
| R5 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 38 column b | GPIO23 |
| R5 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 38 column f | N5 |
| D5 | red 5 mm LED | Anode (+) | row 38 column h | N5 |
| D5 | red 5 mm LED | Cathode (−) | the top − rail at row 37 | GND |
| R6 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 41 column b | GPIO24 |
| R6 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 41 column f | N6 |
| D6 | red 5 mm LED | Anode (+) | row 41 column h | N6 |
| D6 | red 5 mm LED | Cathode (−) | the top − rail at row 41 | GND |
| R7 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 44 column b | GPIO25 |
| R7 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 44 column f | N7 |
| D7 | yellow 5 mm LED | Anode (+) | row 44 column h | N7 |
| D7 | yellow 5 mm LED | Cathode (−) | the top − rail at row 43 | GND |
| R8 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 47 column b | GPIO5 |
| R8 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 47 column f | N8 |
| D8 | green 5 mm LED | Anode (+) | row 47 column h | N8 |
| D8 | green 5 mm LED | Cathode (−) | the top − rail at row 47 | GND |
| W1 | black male–male jumper | end a | row 3 column j | GND |
| W1 | black male–male jumper | end b | the top − rail at row 3 | GND |
| W2 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W2 | yellow male–male jumper | end b | row 26 column a | GPIO17 |
| W3 | green male–male jumper | end a | row 6 column j | GPIO18 |
| W3 | green male–male jumper | end b | row 29 column a | GPIO18 |
| W4 | blue male–male jumper | end a | row 7 column a | GPIO27 |
| W4 | blue male–male jumper | end b | row 32 column a | GPIO27 |
| W5 | violet male–male jumper | end a | row 8 column a | GPIO22 |
| W5 | violet male–male jumper | end b | row 35 column a | GPIO22 |
| W6 | white male–male jumper | end a | row 8 column j | GPIO23 |
| W6 | white male–male jumper | end b | row 38 column a | GPIO23 |
| W7 | brown male–male jumper | end a | row 9 column j | GPIO24 |
| W7 | brown male–male jumper | end b | row 41 column a | GPIO24 |
| W8 | grey male–male jumper | end a | row 11 column j | GPIO25 |
| W8 | grey male–male jumper | end b | row 44 column a | GPIO25 |
| W9 | yellow male–male jumper | end a | row 15 column a | GPIO5 |
| W9 | yellow male–male jumper | end b | row 47 column a | GPIO5 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Use a black 20 cm male–male jumper (W1) from row 3 column j to the top − rail at row 3.
3. Insert R1, the 220 Ω resistor (red, red, brown, gold), from row 26 column b to row 26 column f.
4. Insert R2, the 220 Ω resistor (red, red, brown, gold), from row 29 column b to row 29 column f.
5. Insert R3, the 220 Ω resistor (red, red, brown, gold), from row 32 column b to row 32 column f.
6. Insert R4, the 220 Ω resistor (red, red, brown, gold), from row 35 column b to row 35 column f.
7. Insert R5, the 220 Ω resistor (red, red, brown, gold), from row 38 column b to row 38 column f.
8. Insert R6, the 220 Ω resistor (red, red, brown, gold), from row 41 column b to row 41 column f.
9. Insert R7, the 220 Ω resistor (red, red, brown, gold), from row 44 column b to row 44 column f.
10. Insert R8, the 220 Ω resistor (red, red, brown, gold), from row 47 column b to row 47 column f.
11. Insert D1, the green 5 mm LED: anode (longer leg) in row 26 column h, cathode (shorter leg, flat side) in the top − rail at row 25.
12. Insert D2, the yellow 5 mm LED: anode (longer leg) in row 29 column h, cathode (shorter leg, flat side) in the top − rail at row 29.
13. Insert D3, the red 5 mm LED: anode (longer leg) in row 32 column h, cathode (shorter leg, flat side) in the top − rail at row 31.
14. Insert D4, the red 5 mm LED: anode (longer leg) in row 35 column h, cathode (shorter leg, flat side) in the top − rail at row 35.
15. Insert D5, the red 5 mm LED: anode (longer leg) in row 38 column h, cathode (shorter leg, flat side) in the top − rail at row 37.
16. Insert D6, the red 5 mm LED: anode (longer leg) in row 41 column h, cathode (shorter leg, flat side) in the top − rail at row 41.
17. Insert D7, the yellow 5 mm LED: anode (longer leg) in row 44 column h, cathode (shorter leg, flat side) in the top − rail at row 43.
18. Insert D8, the green 5 mm LED: anode (longer leg) in row 47 column h, cathode (shorter leg, flat side) in the top − rail at row 47.
19. Use a yellow 20 cm male–male jumper (W2) from row 6 column a to row 26 column a.
20. Use a green 20 cm male–male jumper (W3) from row 6 column j to row 29 column a.
21. Use a blue 20 cm male–male jumper (W4) from row 7 column a to row 32 column a.
22. Use a violet 20 cm male–male jumper (W5) from row 8 column a to row 35 column a.
23. Use a white 20 cm male–male jumper (W6) from row 8 column j to row 38 column a.
24. Use a brown 20 cm male–male jumper (W7) from row 9 column j to row 41 column a.
25. Use a grey 20 cm male–male jumper (W8) from row 11 column j to row 44 column a.
26. Use a yellow 20 cm male–male jumper (W9) from row 15 column a to row 47 column a.
<!-- /generated:flowing-leds -->
<!-- /section:flowing-leds -->

<!-- section:four-digit-seven-segment -->
### 4-Digit 7-Segment (`four-digit-seven-segment`, extra, needs parts not in the kit; baseline `four-digit-seven-segment`)

Sources: Kingbright [CA56-12EWA](https://www.kingbrightusa.com/images/catalog/SPEC/CA56-12EWA.pdf) (the 4-digit common-anode display in
the part library; SunFounder's own 4-digit page states common anode with the same pin numbers),
[TI SN74HC595](https://www.ti.com/lit/ds/symlink/sn74hc595.pdf), onsemi
[SS8550](https://www.onsemi.com/download/data-sheet/pdf/ss8550-d.pdf) (the S8550 PNP transistor), Yageo CFR (resistors),
[Raspberry Pi GPIO documentation](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc)
(16 mA per pin, 50 mA in total), the kit's [component list](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/component_list.html).
The kit has no 4-digit display, so the circuit is the baseline's, corrected against the datasheets.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| four-digit-seven-segment-1 | digit current | Each digit's common pin is "pulled LOW to enable" straight from GPIO5, GPIO6, GPIO12 or GPIO13, so one pin carries every lit segment of that digit: roughly 5 mA a segment, 35–40 mA with seven or eight lit, against the 16 mA a pin can take. With the eight segment GPIOs sourcing the same current the pins together pass about 70–80 mA against the 50 mA total | Each digit anode is switched by an S8550 PNP transistor from 3V3 through a 1 kΩ base resistor. The transistor passes about 40 mA (its collector-current rating is 500 mA or more, depending on the maker) and the GPIO supplies only the base current, about 2.5 mA. A 74HC595 sinks the eight segment lines through 220 Ω, about 5 mA an output, under its 6 mA rating | Raspberry Pi GPIO documentation ("Outputs"); S8550 datasheets (hFE 85–300); SN74HC595 §6.5 | Unsafe for hardware | sim: "Digit 2 with all eight segments on…" (segments under 6 mA, GPIO6 at base current only) | Fixed |
| four-digit-seven-segment-2 | polarity | The code drives the segment pins HIGH to light and the digit pins LOW to enable, and the theory says each digit "has its own cathode pin": the logic of a common-cathode display, though the text never says which type it is | The display in the library, like SunFounder's own 4-digit part, is common anode: a lit segment is pulled LOW and its digit pin is driven HIGH. On that display the baseline logic leaves every segment dark. The rebuild drives a digit HIGH through its transistor (the select pin is LOW) and sinks each lit segment | CA56-12EWA p.1 internal circuit | Doesn't work | sim: "Digit 1 selected with the pattern for "1"…" and the other digit assertions | Fixed |
| four-digit-seven-segment-3 | wiring text | The wiring is the Flowing LEDs text copied over: it lists eight "LED 1…8" signals on GPIO17, 18, 27, 22, 23, 24, 25 and 5, "LED row 22h", and the ground rail, and never mentions the four digit pins. The code instead puts the decimal point on GPIO16 and uses GPIO5 as digit 1 | The rebuild's table lists every hole, and the code and wiring agree: GPIO17, 18 and 27 for the shift register, GPIO5, 6, 12 and 13 for digits 1 to 4 | SPEC 16.1 | Doesn't work | code/netlist pin check; "matches AUDIT.md's generated table and steps" | Fixed |
| four-digit-seven-segment-4 | placement | LED rows 22 to 29 in column h: 22h and 23h are under the T-board body (columns d–h of rows 21–23) | Everything starts below row 23. The display body is about 50 mm long, so it would sit over the chip, resistors and transistors on the same board; the rebuild puts it alone on a second breadboard and joins it with jumper leads | SPEC 6.6; `content/controllers/tboard.json` (ADR-0004) | Doesn't work | placement check (`validateDoc`) | Fixed |
| four-digit-seven-segment-5 | parts | Listed among the SunFounder Basic Starter Kit projects with "4-Digit 7-Segment Display", 220 Ω resistors and jumper wires | The kit's component list has no 4-digit display, and the corrected circuit adds four S8550 transistors, which the kit also lacks (it has two PN2222 NPN). The tutorial is tagged "needs parts not in the kit" | Kit component list; ADR-0011 | Misleading | the tag in `tutorial.json` (the tutorials test rejects it on kit projects) | Fixed |
| four-digit-seven-segment-6 | digit patterns, refresh | Patterns for 0 to 9 as seven values for a to g; 3 ms a digit, about 83 refreshes a second | Correct patterns and refresh rate; the rebuild builds the patterns from each glyph's lit segments and inverts them for the common-anode display | Prose; CA56-12EWA | None | sim: the pattern assertions | Correct |

Generated wiring table and build steps:

<!-- generated:four-digit-seven-segment -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| U1 | 74HC595 8-bit shift register (DIP-16) | QB | board bb1, row 25 column e | N18 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QC | board bb1, row 26 column e | N19 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QD | board bb1, row 27 column e | N20 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QE | board bb1, row 28 column e | N21 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QF | board bb1, row 29 column e | N22 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QG | board bb1, row 30 column e | N23 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QH | board bb1, row 31 column e | N24 |
| U1 | 74HC595 8-bit shift register (DIP-16) | GND | board bb1, row 32 column e | GND |
| U1 | 74HC595 8-bit shift register (DIP-16) | QH' | board bb1, row 32 column f | N25 |
| U1 | 74HC595 8-bit shift register (DIP-16) | SRCLR | board bb1, row 31 column f | 3V3 |
| U1 | 74HC595 8-bit shift register (DIP-16) | SRCLK | board bb1, row 30 column f | GPIO27 |
| U1 | 74HC595 8-bit shift register (DIP-16) | RCLK | board bb1, row 29 column f | GPIO18 |
| U1 | 74HC595 8-bit shift register (DIP-16) | OE | board bb1, row 28 column f | GND |
| U1 | 74HC595 8-bit shift register (DIP-16) | SER | board bb1, row 27 column f | GPIO17 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QA | board bb1, row 26 column f | N17 |
| U1 | 74HC595 8-bit shift register (DIP-16) | VCC | board bb1, row 25 column f | 3V3 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | e | board bb2, row 30 column b | N1 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | d | board bb2, row 31 column b | N5 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | dp | board bb2, row 32 column b | N6 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | c | board bb2, row 33 column b | N7 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | g | board bb2, row 34 column b | N8 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | D4 | board bb2, row 35 column b | N9 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | b | board bb2, row 35 column f | N10 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | D3 | board bb2, row 34 column f | N11 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | D2 | board bb2, row 33 column f | N12 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | f | board bb2, row 32 column f | N2 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | a | board bb2, row 31 column f | N3 |
| DS1 | 4-digit 7-segment display, common anode (0.56 in, 12-pin) | D1 | board bb2, row 30 column f | N4 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | board bb1, row 34 column b | N17 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | board bb1, row 34 column f | N3 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | board bb1, row 35 column b | N18 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | board bb1, row 35 column f | N10 |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | board bb1, row 36 column b | N19 |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | board bb1, row 36 column f | N7 |
| R4 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | board bb1, row 37 column b | N20 |
| R4 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | board bb1, row 37 column f | N5 |
| R5 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | board bb1, row 38 column b | N21 |
| R5 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | board bb1, row 38 column f | N1 |
| R6 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | board bb1, row 39 column b | N22 |
| R6 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | board bb1, row 39 column f | N2 |
| R7 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | board bb1, row 40 column b | N23 |
| R7 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | board bb1, row 40 column f | N8 |
| R8 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | board bb1, row 41 column b | N24 |
| R8 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | board bb1, row 41 column f | N6 |
| Q1 | S8550 PNP transistor (TO-92) | Emitter | board bb1, row 44 column b | 3V3 |
| Q1 | S8550 PNP transistor (TO-92) | Base | board bb1, row 45 column b | N13 |
| Q1 | S8550 PNP transistor (TO-92) | Collector | board bb1, row 46 column b | N4 |
| R9 | 1 kΩ resistor (brown, black, red, gold) | Lead 1 | board bb1, row 45 column d | N13 |
| R9 | 1 kΩ resistor (brown, black, red, gold) | Lead 2 | board bb1, row 45 column g | GPIO5 |
| Q2 | S8550 PNP transistor (TO-92) | Emitter | board bb1, row 47 column b | 3V3 |
| Q2 | S8550 PNP transistor (TO-92) | Base | board bb1, row 48 column b | N14 |
| Q2 | S8550 PNP transistor (TO-92) | Collector | board bb1, row 49 column b | N12 |
| R10 | 1 kΩ resistor (brown, black, red, gold) | Lead 1 | board bb1, row 48 column d | N14 |
| R10 | 1 kΩ resistor (brown, black, red, gold) | Lead 2 | board bb1, row 48 column g | GPIO6 |
| Q3 | S8550 PNP transistor (TO-92) | Emitter | board bb1, row 50 column b | 3V3 |
| Q3 | S8550 PNP transistor (TO-92) | Base | board bb1, row 51 column b | N15 |
| Q3 | S8550 PNP transistor (TO-92) | Collector | board bb1, row 52 column b | N11 |
| R11 | 1 kΩ resistor (brown, black, red, gold) | Lead 1 | board bb1, row 51 column d | N15 |
| R11 | 1 kΩ resistor (brown, black, red, gold) | Lead 2 | board bb1, row 51 column g | GPIO12 |
| Q4 | S8550 PNP transistor (TO-92) | Emitter | board bb1, row 53 column b | 3V3 |
| Q4 | S8550 PNP transistor (TO-92) | Base | board bb1, row 54 column b | N16 |
| Q4 | S8550 PNP transistor (TO-92) | Collector | board bb1, row 55 column b | N9 |
| R12 | 1 kΩ resistor (brown, black, red, gold) | Lead 1 | board bb1, row 54 column d | N16 |
| R12 | 1 kΩ resistor (brown, black, red, gold) | Lead 2 | board bb1, row 54 column g | GPIO13 |
| W1 | red male–male jumper | end a | board bb1, row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | board bb1, the top + rail at row 3 | 3V3 |
| W2 | black male–male jumper | end a | board bb1, row 3 column j | GND |
| W2 | black male–male jumper | end b | board bb1, the top − rail at row 3 | GND |
| W3 | red male–male jumper | end a | board bb1, row 25 column j | 3V3 |
| W3 | red male–male jumper | end b | board bb1, the top + rail at row 25 | 3V3 |
| W4 | red male–male jumper | end a | board bb1, row 31 column j | 3V3 |
| W4 | red male–male jumper | end b | board bb1, the top + rail at row 31 | 3V3 |
| W5 | black male–male jumper | end a | board bb1, row 32 column a | GND |
| W5 | black male–male jumper | end b | board bb1, the top − rail at row 31 | GND |
| W6 | black male–male jumper | end a | board bb1, row 28 column j | GND |
| W6 | black male–male jumper | end b | board bb1, the top − rail at row 28 | GND |
| W7 | red male–male jumper | end a | board bb1, row 44 column a | 3V3 |
| W7 | red male–male jumper | end b | board bb1, the top + rail at row 43 | 3V3 |
| W8 | red male–male jumper | end a | board bb1, row 47 column a | 3V3 |
| W8 | red male–male jumper | end b | board bb1, the top + rail at row 47 | 3V3 |
| W9 | red male–male jumper | end a | board bb1, row 50 column a | 3V3 |
| W9 | red male–male jumper | end b | board bb1, the top + rail at row 49 | 3V3 |
| W10 | red male–male jumper | end a | board bb1, row 53 column a | 3V3 |
| W10 | red male–male jumper | end b | board bb1, the top + rail at row 53 | 3V3 |
| W11 | yellow male–male jumper | end a | board bb1, row 6 column a | GPIO17 |
| W11 | yellow male–male jumper | end b | board bb1, row 27 column j | GPIO17 |
| W12 | green male–male jumper | end a | board bb1, row 6 column j | GPIO18 |
| W12 | green male–male jumper | end b | board bb1, row 29 column j | GPIO18 |
| W13 | blue male–male jumper | end a | board bb1, row 7 column a | GPIO27 |
| W13 | blue male–male jumper | end b | board bb1, row 30 column j | GPIO27 |
| W14 | brown male–male jumper | end a | board bb1, row 26 column j | N17 |
| W14 | brown male–male jumper | end b | board bb1, row 34 column a | N17 |
| W15 | violet male–male jumper | end a | board bb1, row 25 column a | N18 |
| W15 | violet male–male jumper | end b | board bb1, row 35 column a | N18 |
| W16 | grey male–male jumper | end a | board bb1, row 26 column a | N19 |
| W16 | grey male–male jumper | end b | board bb1, row 36 column a | N19 |
| W17 | white male–male jumper | end a | board bb1, row 27 column a | N20 |
| W17 | white male–male jumper | end b | board bb1, row 37 column a | N20 |
| W18 | yellow male–male jumper | end a | board bb1, row 28 column a | N21 |
| W18 | yellow male–male jumper | end b | board bb1, row 38 column a | N21 |
| W19 | green male–male jumper | end a | board bb1, row 29 column a | N22 |
| W19 | green male–male jumper | end b | board bb1, row 39 column a | N22 |
| W20 | blue male–male jumper | end a | board bb1, row 30 column a | N23 |
| W20 | blue male–male jumper | end b | board bb1, row 40 column a | N23 |
| W21 | violet male–male jumper | end a | board bb1, row 31 column a | N24 |
| W21 | violet male–male jumper | end b | board bb1, row 41 column a | N24 |
| W22 | brown male–male jumper | end a | board bb1, row 34 column j | N3 |
| W22 | brown male–male jumper | end b | board bb2, row 31 column j | N3 |
| W23 | violet male–male jumper | end a | board bb1, row 35 column j | N10 |
| W23 | violet male–male jumper | end b | board bb2, row 35 column j | N10 |
| W24 | grey male–male jumper | end a | board bb1, row 36 column j | N7 |
| W24 | grey male–male jumper | end b | board bb2, row 33 column a | N7 |
| W25 | white male–male jumper | end a | board bb1, row 37 column j | N5 |
| W25 | white male–male jumper | end b | board bb2, row 31 column a | N5 |
| W26 | yellow male–male jumper | end a | board bb1, row 38 column j | N1 |
| W26 | yellow male–male jumper | end b | board bb2, row 30 column a | N1 |
| W27 | green male–male jumper | end a | board bb1, row 39 column j | N2 |
| W27 | green male–male jumper | end b | board bb2, row 32 column j | N2 |
| W28 | blue male–male jumper | end a | board bb1, row 40 column j | N8 |
| W28 | blue male–male jumper | end b | board bb2, row 34 column a | N8 |
| W29 | violet male–male jumper | end a | board bb1, row 41 column j | N6 |
| W29 | violet male–male jumper | end b | board bb2, row 32 column a | N6 |
| W30 | yellow male–male jumper | end a | board bb1, row 15 column a | GPIO5 |
| W30 | yellow male–male jumper | end b | board bb1, row 45 column j | GPIO5 |
| W31 | green male–male jumper | end a | board bb1, row 16 column a | GPIO6 |
| W31 | green male–male jumper | end b | board bb1, row 48 column j | GPIO6 |
| W32 | blue male–male jumper | end a | board bb1, row 16 column j | GPIO12 |
| W32 | blue male–male jumper | end b | board bb1, row 51 column j | GPIO12 |
| W33 | violet male–male jumper | end a | board bb1, row 17 column a | GPIO13 |
| W33 | violet male–male jumper | end b | board bb1, row 54 column j | GPIO13 |
| W34 | white male–male jumper | end a | board bb1, row 46 column a | N4 |
| W34 | white male–male jumper | end b | board bb2, row 30 column j | N4 |
| W35 | grey male–male jumper | end a | board bb1, row 49 column a | N12 |
| W35 | grey male–male jumper | end b | board bb2, row 33 column j | N12 |
| W36 | brown male–male jumper | end a | board bb1, row 52 column a | N11 |
| W36 | brown male–male jumper | end b | board bb2, row 34 column j | N11 |
| W37 | violet male–male jumper | end a | board bb1, row 55 column a | N9 |
| W37 | violet male–male jumper | end b | board bb2, row 35 column a | N9 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Use a red 20 cm male–male jumper (W1) from board bb1, row 1 column a to board bb1, the top + rail at row 3.
3. Use a black 20 cm male–male jumper (W2) from board bb1, row 3 column j to board bb1, the top − rail at row 3.
4. Use a red 20 cm male–male jumper (W3) from board bb1, row 25 column j to board bb1, the top + rail at row 25.
5. Use a red 20 cm male–male jumper (W4) from board bb1, row 31 column j to board bb1, the top + rail at row 31.
6. Use a black 20 cm male–male jumper (W5) from board bb1, row 32 column a to board bb1, the top − rail at row 31.
7. Use a black 20 cm male–male jumper (W6) from board bb1, row 28 column j to board bb1, the top − rail at row 28.
8. Use a red 20 cm male–male jumper (W7) from board bb1, row 44 column a to board bb1, the top + rail at row 43.
9. Use a red 20 cm male–male jumper (W8) from board bb1, row 47 column a to board bb1, the top + rail at row 47.
10. Use a red 20 cm male–male jumper (W9) from board bb1, row 50 column a to board bb1, the top + rail at row 49.
11. Use a red 20 cm male–male jumper (W10) from board bb1, row 53 column a to board bb1, the top + rail at row 53.
12. Insert R1, the 220 Ω resistor (red, red, brown, gold), from board bb1, row 34 column b to board bb1, row 34 column f.
13. Insert R2, the 220 Ω resistor (red, red, brown, gold), from board bb1, row 35 column b to board bb1, row 35 column f.
14. Insert R3, the 220 Ω resistor (red, red, brown, gold), from board bb1, row 36 column b to board bb1, row 36 column f.
15. Insert R4, the 220 Ω resistor (red, red, brown, gold), from board bb1, row 37 column b to board bb1, row 37 column f.
16. Insert R5, the 220 Ω resistor (red, red, brown, gold), from board bb1, row 38 column b to board bb1, row 38 column f.
17. Insert R6, the 220 Ω resistor (red, red, brown, gold), from board bb1, row 39 column b to board bb1, row 39 column f.
18. Insert R7, the 220 Ω resistor (red, red, brown, gold), from board bb1, row 40 column b to board bb1, row 40 column f.
19. Insert R8, the 220 Ω resistor (red, red, brown, gold), from board bb1, row 41 column b to board bb1, row 41 column f.
20. Insert R9, the 1 kΩ resistor (brown, black, red, gold), from board bb1, row 45 column d to board bb1, row 45 column g.
21. Insert R10, the 1 kΩ resistor (brown, black, red, gold), from board bb1, row 48 column d to board bb1, row 48 column g.
22. Insert R11, the 1 kΩ resistor (brown, black, red, gold), from board bb1, row 51 column d to board bb1, row 51 column g.
23. Insert R12, the 1 kΩ resistor (brown, black, red, gold), from board bb1, row 54 column d to board bb1, row 54 column g.
24. Insert U1, the 74HC595 8-bit shift register (DIP-16), across the trench with pin 1 (QB) in board bb1, row 25 column e and pin 16 (VCC) in board bb1, row 25 column f.
25. Insert DS1, the 4-digit 7-segment display, common anode (0.56 in, 12-pin), across the trench with pin 1 (e) in board bb2, row 30 column b and pin 12 (D1) in board bb2, row 30 column f.
26. Insert Q1, the S8550 PNP transistor (TO-92), with pin 1 (Emitter) in board bb1, row 44 column b and pin 3 (Collector) in board bb1, row 46 column b.
27. Insert Q2, the S8550 PNP transistor (TO-92), with pin 1 (Emitter) in board bb1, row 47 column b and pin 3 (Collector) in board bb1, row 49 column b.
28. Insert Q3, the S8550 PNP transistor (TO-92), with pin 1 (Emitter) in board bb1, row 50 column b and pin 3 (Collector) in board bb1, row 52 column b.
29. Insert Q4, the S8550 PNP transistor (TO-92), with pin 1 (Emitter) in board bb1, row 53 column b and pin 3 (Collector) in board bb1, row 55 column b.
30. Use a yellow 20 cm male–male jumper (W11) from board bb1, row 6 column a to board bb1, row 27 column j.
31. Use a green 20 cm male–male jumper (W12) from board bb1, row 6 column j to board bb1, row 29 column j.
32. Use a blue 20 cm male–male jumper (W13) from board bb1, row 7 column a to board bb1, row 30 column j.
33. Use a yellow 20 cm male–male jumper (W30) from board bb1, row 15 column a to board bb1, row 45 column j.
34. Use a green 20 cm male–male jumper (W31) from board bb1, row 16 column a to board bb1, row 48 column j.
35. Use a blue 20 cm male–male jumper (W32) from board bb1, row 16 column j to board bb1, row 51 column j.
36. Use a violet 20 cm male–male jumper (W33) from board bb1, row 17 column a to board bb1, row 54 column j.
37. Use a violet 20 cm male–male jumper (W15) from board bb1, row 25 column a to board bb1, row 35 column a.
38. Use a brown 20 cm male–male jumper (W14) from board bb1, row 26 column j to board bb1, row 34 column a.
39. Use a grey 20 cm male–male jumper (W16) from board bb1, row 26 column a to board bb1, row 36 column a.
40. Use a white 20 cm male–male jumper (W17) from board bb1, row 27 column a to board bb1, row 37 column a.
41. Use a yellow 20 cm male–male jumper (W18) from board bb1, row 28 column a to board bb1, row 38 column a.
42. Use a green 20 cm male–male jumper (W19) from board bb1, row 29 column a to board bb1, row 39 column a.
43. Use a blue 20 cm male–male jumper (W20) from board bb1, row 30 column a to board bb1, row 40 column a.
44. Use a yellow 20 cm male–male jumper (W26) from board bb1, row 38 column j to board bb2, row 30 column a.
45. Use a white 20 cm male–male jumper (W34) from board bb1, row 46 column a to board bb2, row 30 column j.
46. Use a violet 20 cm male–male jumper (W21) from board bb1, row 31 column a to board bb1, row 41 column a.
47. Use a brown 20 cm male–male jumper (W22) from board bb1, row 34 column j to board bb2, row 31 column j.
48. Use a white 20 cm male–male jumper (W25) from board bb1, row 37 column j to board bb2, row 31 column a.
49. Use a green 20 cm male–male jumper (W27) from board bb1, row 39 column j to board bb2, row 32 column j.
50. Use a violet 20 cm male–male jumper (W29) from board bb1, row 41 column j to board bb2, row 32 column a.
51. Use a grey 20 cm male–male jumper (W24) from board bb1, row 36 column j to board bb2, row 33 column a.
52. Use a grey 20 cm male–male jumper (W35) from board bb1, row 49 column a to board bb2, row 33 column j.
53. Use a blue 20 cm male–male jumper (W28) from board bb1, row 40 column j to board bb2, row 34 column a.
54. Use a brown 20 cm male–male jumper (W36) from board bb1, row 52 column a to board bb2, row 34 column j.
55. Use a violet 20 cm male–male jumper (W23) from board bb1, row 35 column j to board bb2, row 35 column j.
56. Use a violet 20 cm male–male jumper (W37) from board bb1, row 55 column a to board bb2, row 35 column a.
<!-- /generated:four-digit-seven-segment -->
<!-- /section:four-digit-seven-segment -->

<!-- section:shift-register -->
### Shift Register (`shift-register`, extra; baseline `shift-register`)

Sources: [TI SN74HC595](https://www.ti.com/lit/ds/symlink/sn74hc595.pdf) (pins, supply range, output ratings),
Kingbright [WP7113ID](https://www.kingbrightusa.com/images/catalog/SPEC/WP7113ID.pdf) (LEDs), Yageo CFR (resistor),
[Raspberry Pi GPIO documentation](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc),
and the kit's [1.1.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.1.3%20LED%20Dot%20Matrix.html) and
[1.1.4](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.1.4%207-segment%20Display.html) pages for the control-pin wiring.
The kit has no standalone shift-register page, so the circuit is the baseline's, checked against the datasheet.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| shift-register-1 | placement | The three signal wires go to rows 22, 23 and 24 for DS, SHCP and STCP, and no hole is given for the chip, the resistors or the LEDs | On any DIP-16 placement with pin 1 in row r, pins 14, 11 and 12 are in rows r + 2, r + 5 and r + 4, so they cannot be rows 22, 23 and 24 in that order. Column f of rows 21–23 is also under the T-board body (`tboardBlockedHoles`), which a chip across the trench would need. The rebuild puts the chip in rows 25–32 and the LEDs in rows 36–57 | SN74HC595 §5 (pin numbers); SPEC 6.6; `content/controllers/tboard.json` (ADR-0004) | Doesn't work | placement check (`validateDoc`); "matches AUDIT.md's generated table and steps" | Fixed |
| shift-register-2 | circuit | The text ends at "74HC595 Q0–Q7 → 220Ω resistors → 8 LEDs", so the LEDs have no return path to GND, and `wiringDiagram` draws only three wires and no chip, resistor or LED | Each LED's cathode goes to the GND rail, which one lead joins to the T-board's GND strip; the 3V3 and GND supplies and the four fixed control pins (SRCLR, OE, VCC, GND) are all wired | SN74HC595 §5 | Doesn't work | sim: "Byte 0xA5 lights LEDs 1, 3, 6 and 8…" needs the full circuit | Fixed |
| shift-register-3 | clock and latch pins | GPIO18 on the shift clock (pin 11) and GPIO27 on the latch (pin 12) | Electrically sound, but the kit's 1.1.3 and 1.1.4 projects wire GPIO18 to the latch (RCLK) and GPIO27 to the shift clock (SRCLK). The rebuild uses the kit's assignment so the same wiring and code carry between the projects | Kit 1.1.3, 1.1.4 | Cosmetic | code/netlist pin check | Fixed |
| shift-register-4 | shift and latch | "Shift out 8 bits, MSB first … then raise the latch" | Correct: the bits go in most significant first, each rising edge on SRCLK shifts one place, and the rising edge on RCLK copies them to the outputs. The rebuild adds an assertion that shifting without a latch pulse leaves the outputs alone | SN74HC595 §8.4 function table | None | sim: "Shifting a new byte in without a latch pulse…", "Byte 0x01…", "Byte 0x80…" | Correct |
| shift-register-5 | supply, MR, OE, current | 3V3 on VCC and MR (pins 16 and 10), GND on pins 8 and 13, 220 Ω to each LED, QH′ (pin 9) as the chain output | Correct. 3.3 V is inside the 2–6 V supply range and matches the GPIO logic level. Each output supplies about 4 mA, under its 6 mA rating, and all eight carry about 34 mA through VCC against the 70 mA maximum | SN74HC595 §6.1, §6.5 | None | sim: "Byte 0xFF lights all eight LEDs, each output under its 6 mA rating" | Correct |

Generated wiring table and build steps:

<!-- generated:shift-register -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| U1 | 74HC595 8-bit shift register (DIP-16) | QB | row 25 column e | N10 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QC | row 26 column e | N11 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QD | row 27 column e | N12 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QE | row 28 column e | N13 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QF | row 29 column e | N14 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QG | row 30 column e | N15 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QH | row 31 column e | N16 |
| U1 | 74HC595 8-bit shift register (DIP-16) | GND | row 32 column e | GND |
| U1 | 74HC595 8-bit shift register (DIP-16) | QH' | row 32 column f | N17 |
| U1 | 74HC595 8-bit shift register (DIP-16) | SRCLR | row 31 column f | 3V3 |
| U1 | 74HC595 8-bit shift register (DIP-16) | SRCLK | row 30 column f | GPIO27 |
| U1 | 74HC595 8-bit shift register (DIP-16) | RCLK | row 29 column f | GPIO18 |
| U1 | 74HC595 8-bit shift register (DIP-16) | OE | row 28 column f | GND |
| U1 | 74HC595 8-bit shift register (DIP-16) | SER | row 27 column f | GPIO17 |
| U1 | 74HC595 8-bit shift register (DIP-16) | QA | row 26 column f | N9 |
| U1 | 74HC595 8-bit shift register (DIP-16) | VCC | row 25 column f | 3V3 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 36 column b | N9 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 36 column f | N1 |
| D1 | green 5 mm LED | Anode (+) | row 36 column h | N1 |
| D1 | green 5 mm LED | Cathode (−) | the top − rail at row 36 | GND |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 39 column b | N10 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 39 column f | N2 |
| D2 | yellow 5 mm LED | Anode (+) | row 39 column h | N2 |
| D2 | yellow 5 mm LED | Cathode (−) | the top − rail at row 39 | GND |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 42 column b | N11 |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 42 column f | N3 |
| D3 | red 5 mm LED | Anode (+) | row 42 column h | N3 |
| D3 | red 5 mm LED | Cathode (−) | the top − rail at row 42 | GND |
| R4 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 45 column b | N12 |
| R4 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 45 column f | N4 |
| D4 | red 5 mm LED | Anode (+) | row 45 column h | N4 |
| D4 | red 5 mm LED | Cathode (−) | the top − rail at row 45 | GND |
| R5 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 48 column b | N13 |
| R5 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 48 column f | N5 |
| D5 | red 5 mm LED | Anode (+) | row 48 column h | N5 |
| D5 | red 5 mm LED | Cathode (−) | the top − rail at row 48 | GND |
| R6 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 51 column b | N14 |
| R6 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 51 column f | N6 |
| D6 | red 5 mm LED | Anode (+) | row 51 column h | N6 |
| D6 | red 5 mm LED | Cathode (−) | the top − rail at row 51 | GND |
| R7 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 54 column b | N15 |
| R7 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 54 column f | N7 |
| D7 | yellow 5 mm LED | Anode (+) | row 54 column h | N7 |
| D7 | yellow 5 mm LED | Cathode (−) | the top − rail at row 54 | GND |
| R8 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 57 column b | N16 |
| R8 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 57 column f | N8 |
| D8 | green 5 mm LED | Anode (+) | row 57 column h | N8 |
| D8 | green 5 mm LED | Cathode (−) | the top − rail at row 57 | GND |
| W1 | red male–male jumper | end a | row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | the top + rail at row 3 | 3V3 |
| W2 | black male–male jumper | end a | row 3 column j | GND |
| W2 | black male–male jumper | end b | the top − rail at row 3 | GND |
| W3 | red male–male jumper | end a | row 25 column j | 3V3 |
| W3 | red male–male jumper | end b | the top + rail at row 25 | 3V3 |
| W4 | red male–male jumper | end a | row 31 column j | 3V3 |
| W4 | red male–male jumper | end b | the top + rail at row 31 | 3V3 |
| W5 | black male–male jumper | end a | row 32 column a | GND |
| W5 | black male–male jumper | end b | the top − rail at row 31 | GND |
| W6 | black male–male jumper | end a | row 28 column j | GND |
| W6 | black male–male jumper | end b | the top − rail at row 28 | GND |
| W7 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W7 | yellow male–male jumper | end b | row 27 column j | GPIO17 |
| W8 | green male–male jumper | end a | row 6 column j | GPIO18 |
| W8 | green male–male jumper | end b | row 29 column j | GPIO18 |
| W9 | blue male–male jumper | end a | row 7 column a | GPIO27 |
| W9 | blue male–male jumper | end b | row 30 column j | GPIO27 |
| W10 | brown male–male jumper | end a | row 26 column j | N9 |
| W10 | brown male–male jumper | end b | row 36 column a | N9 |
| W11 | violet male–male jumper | end a | row 25 column a | N10 |
| W11 | violet male–male jumper | end b | row 39 column a | N10 |
| W12 | grey male–male jumper | end a | row 26 column a | N11 |
| W12 | grey male–male jumper | end b | row 42 column a | N11 |
| W13 | white male–male jumper | end a | row 27 column a | N12 |
| W13 | white male–male jumper | end b | row 45 column a | N12 |
| W14 | yellow male–male jumper | end a | row 28 column a | N13 |
| W14 | yellow male–male jumper | end b | row 48 column a | N13 |
| W15 | green male–male jumper | end a | row 29 column a | N14 |
| W15 | green male–male jumper | end b | row 51 column a | N14 |
| W16 | blue male–male jumper | end a | row 30 column a | N15 |
| W16 | blue male–male jumper | end b | row 54 column a | N15 |
| W17 | violet male–male jumper | end a | row 31 column a | N16 |
| W17 | violet male–male jumper | end b | row 57 column a | N16 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Use a red 20 cm male–male jumper (W1) from row 1 column a to the top + rail at row 3.
3. Use a black 20 cm male–male jumper (W2) from row 3 column j to the top − rail at row 3.
4. Use a red 20 cm male–male jumper (W3) from row 25 column j to the top + rail at row 25.
5. Use a red 20 cm male–male jumper (W4) from row 31 column j to the top + rail at row 31.
6. Use a black 20 cm male–male jumper (W5) from row 32 column a to the top − rail at row 31.
7. Use a black 20 cm male–male jumper (W6) from row 28 column j to the top − rail at row 28.
8. Insert R1, the 220 Ω resistor (red, red, brown, gold), from row 36 column b to row 36 column f.
9. Insert R2, the 220 Ω resistor (red, red, brown, gold), from row 39 column b to row 39 column f.
10. Insert R3, the 220 Ω resistor (red, red, brown, gold), from row 42 column b to row 42 column f.
11. Insert R4, the 220 Ω resistor (red, red, brown, gold), from row 45 column b to row 45 column f.
12. Insert R5, the 220 Ω resistor (red, red, brown, gold), from row 48 column b to row 48 column f.
13. Insert R6, the 220 Ω resistor (red, red, brown, gold), from row 51 column b to row 51 column f.
14. Insert R7, the 220 Ω resistor (red, red, brown, gold), from row 54 column b to row 54 column f.
15. Insert R8, the 220 Ω resistor (red, red, brown, gold), from row 57 column b to row 57 column f.
16. Insert D1, the green 5 mm LED: anode (longer leg) in row 36 column h, cathode (shorter leg, flat side) in the top − rail at row 36.
17. Insert D2, the yellow 5 mm LED: anode (longer leg) in row 39 column h, cathode (shorter leg, flat side) in the top − rail at row 39.
18. Insert D3, the red 5 mm LED: anode (longer leg) in row 42 column h, cathode (shorter leg, flat side) in the top − rail at row 42.
19. Insert D4, the red 5 mm LED: anode (longer leg) in row 45 column h, cathode (shorter leg, flat side) in the top − rail at row 45.
20. Insert D5, the red 5 mm LED: anode (longer leg) in row 48 column h, cathode (shorter leg, flat side) in the top − rail at row 48.
21. Insert D6, the red 5 mm LED: anode (longer leg) in row 51 column h, cathode (shorter leg, flat side) in the top − rail at row 51.
22. Insert D7, the yellow 5 mm LED: anode (longer leg) in row 54 column h, cathode (shorter leg, flat side) in the top − rail at row 54.
23. Insert D8, the green 5 mm LED: anode (longer leg) in row 57 column h, cathode (shorter leg, flat side) in the top − rail at row 57.
24. Insert U1, the 74HC595 8-bit shift register (DIP-16), across the trench with pin 1 (QB) in row 25 column e and pin 16 (VCC) in row 25 column f.
25. Use a yellow 20 cm male–male jumper (W7) from row 6 column a to row 27 column j.
26. Use a green 20 cm male–male jumper (W8) from row 6 column j to row 29 column j.
27. Use a blue 20 cm male–male jumper (W9) from row 7 column a to row 30 column j.
28. Use a violet 20 cm male–male jumper (W11) from row 25 column a to row 39 column a.
29. Use a brown 20 cm male–male jumper (W10) from row 26 column j to row 36 column a.
30. Use a grey 20 cm male–male jumper (W12) from row 26 column a to row 42 column a.
31. Use a white 20 cm male–male jumper (W13) from row 27 column a to row 45 column a.
32. Use a yellow 20 cm male–male jumper (W14) from row 28 column a to row 48 column a.
33. Use a green 20 cm male–male jumper (W15) from row 29 column a to row 51 column a.
34. Use a blue 20 cm male–male jumper (W16) from row 30 column a to row 54 column a.
35. Use a violet 20 cm male–male jumper (W17) from row 31 column a to row 57 column a.
<!-- /generated:shift-register -->
<!-- /section:shift-register -->

<!-- section:active-buzzer -->
### Active Buzzer (`active-buzzer`, kit 1.2.1; baseline `buzzer`)

Sources: [kit 1.2.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.2.1%20Active%20Buzzer.html)
(page text, diagram `_images/1.2.1.png`), [kit 3.1.2](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/3.1.2%20Morse%20Code%20Generator.html)
(same circuit, its code drives the pin HIGH to sound), Huawha TMB12A05 ([12 mm active buzzer](https://stacktronics.com/wp-content/uploads/2024/12/TMB12A05.pdf)),
onsemi [PN2222A](https://www.megastar.com/content/pdfs/PN2222A-D.pdf), Yageo CFR (resistor), Raspberry Pi GPIO documentation.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| active-buzzer-1 | circuit (D8) | GPIO17 drives the buzzer directly (`GPIO.output(BUZZER_PIN, HIGH)`); the parts are the buzzer and three jumpers | GPIO17 → 1 kΩ (R1) → base of Q1, a PN2222A; the buzzer runs from 5V0 to Q1's collector and Q1's emitter is on GND. The pin supplies about 2.5 mA instead of the buzzer's rated 30 mA, nearly twice a pin's 16 mA limit, and the closest published datasheet gives the buzzer a 4 V minimum to sound | Kit 1.2.1; TMB12A05 (30 mA, 4 V minimum); Pi GPIO documentation (16 mA per pin) | Unsafe for hardware | sim: "GPIO17 HIGH saturates Q1, so BZ1 sounds and the pin supplies only a few milliamps"; ERC (`INDUCTIVE_NO_DRIVER`, `BJT_NO_BASE_RESISTOR`) has zero errors | Fixed |
| active-buzzer-2 | circuit (D8) | Buzzer + in row 22 column h and − in row 23 column h (strip f–j), but the GND jumper is in 23a (strip a–e): nothing joins them, so the circuit is open | Both buzzer leads sit in nets the circuit closes: + on 5V0, − on Q1's collector, Q1's emitter on GND | Kit 1.2.1 diagram | Doesn't work | sim: "GPIO17 HIGH saturates Q1…" (BZ1 has 4.9 V across it and `sounding: true`) | Fixed |
| active-buzzer-3 | placement | Row 22 columns e, f and h, and the − leg in row 23 column h | On the bench the T-board body covers columns d–h of rows 21–23 (`tboardBlockedHoles`), so none of those holes can take a lead. The rebuild uses rows 29–38 | SPEC 6.6; `content/controllers/tboard.json` (ADR-0004) | Doesn't work | placement check (`validateDoc`) | Fixed |
| active-buzzer-4 | placement | + leg in row 22 and − leg in row 23, adjacent rows | The buzzer's leads are 7.6 mm apart, 3 holes: + in row 29 column j and − in row 32 column j | TMB12A05 (lead pitch 7.6 mm); kit diagram | Doesn't work | placement check (rigid footprint) | Fixed |
| active-buzzer-5 | parts list | Active Buzzer ×1, Jumper Wires ×3 | Buzzer, PN2222A transistor (Q1), 1 kΩ resistor (R1) and four jumpers, all from the kit | Kit 1.2.1 diagram; `content/inventory.json` | Misleading | generated wiring table and steps match the document | Fixed |
| active-buzzer-6 | tip | "If no sound, check polarity - the '+' pin goes to GPIO." | The + lead goes to 5V0 and the − lead to Q1's collector; no buzzer lead goes to a GPIO pin | Kit 1.2.1 diagram; TMB12A05 | Misleading | build-step annotation on BZ1 | Fixed |
| active-buzzer-7 | diagram (D5) | `wiringDiagram` draws the buzzer as one connection point (row 22, column h) and its wires reach only rows 22 and 23 | Hole-by-hole table and build steps generated from the document, with both buzzer leads, the transistor and the resistor placed | SPEC 16.2 D5 | Misleading | generated wiring table and steps match the document | Fixed |
| active-buzzer-8 | polarity and supply | Kit page: the text says LOW turns the transistor on, puts the buzzer + at the collector and − on 3.3 V, and its code starts at HIGH "off" and ends on HIGH "off"; its diagram feeds + from 5V0 with the PN2222A's emitter on GND | An NPN with its emitter on GND conducts on HIGH, as the kit's own Morse project drives the same transistor circuit. The rebuild follows the diagram: + on 5V0 (the closest datasheet gives a 4 V minimum), HIGH = on, the code starts and ends LOW | Kit 1.2.1 (text, diagram, code); kit 3.1.2 code; TMB12A05; PN2222A | Misleading | sim: "GPIO17 HIGH saturates Q1…", "GPIO17 LOW turns Q1 off…"; code/netlist pin check | Fixed |
| active-buzzer-9 | tip | "Active buzzers have a white sticker on top and a "+" marking" | The kit says an active buzzer usually has black tape over it, as against the passive one's visible green board; the + mark and the longer lead identify the polarity | Kit 1.2.1 | Cosmetic | theory renders from the doc | Fixed |

Generated wiring table and build steps:

<!-- generated:active-buzzer -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| BZ1 | Active buzzer (12 mm, 5 V) | + (long lead) | row 29 column j | 5V |
| BZ1 | Active buzzer (12 mm, 5 V) | - (short lead) | row 32 column j | N1 |
| Q1 | PN2222A NPN transistor (TO-92) | Emitter | row 36 column j | GND |
| Q1 | PN2222A NPN transistor (TO-92) | Base | row 37 column j | N2 |
| Q1 | PN2222A NPN transistor (TO-92) | Collector | row 38 column j | N1 |
| R1 | 1 kΩ resistor (brown, black, red, gold) | Lead 1 | row 37 column f | N2 |
| R1 | 1 kΩ resistor (brown, black, red, gold) | Lead 2 | row 37 column d | GPIO17 |
| W1 | red male–male jumper | end a | row 1 column j | 5V |
| W1 | red male–male jumper | end b | row 29 column h | 5V |
| W2 | blue male–male jumper | end a | row 32 column h | N1 |
| W2 | blue male–male jumper | end b | row 38 column i | N1 |
| W3 | black male–male jumper | end a | row 36 column g | GND |
| W3 | black male–male jumper | end b | row 5 column a | GND |
| W4 | green male–male jumper | end a | row 37 column a | GPIO17 |
| W4 | green male–male jumper | end b | row 6 column a | GPIO17 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 1 kΩ resistor (brown, black, red, gold), from row 37 column f to row 37 column d.
3. Insert BZ1, the Active buzzer (12 mm, 5 V): + (longer leg) in row 29 column j, − (shorter leg) in row 32 column j.
4. Insert Q1, the PN2222A NPN transistor (TO-92), with pin 1 (Emitter) in row 36 column j and pin 3 (Collector) in row 38 column j.
5. Use a red 20 cm male–male jumper (W1) from row 1 column j to row 29 column h.
6. Use a green 20 cm male–male jumper (W4) from row 37 column a to row 6 column a.
7. Use a blue 20 cm male–male jumper (W2) from row 32 column h to row 38 column i.
8. Use a black 20 cm male–male jumper (W3) from row 36 column g to row 5 column a.
<!-- /generated:active-buzzer -->
<!-- /section:active-buzzer -->

<!-- section:passive-buzzer -->
### Passive Buzzer (`passive-buzzer`, kit 1.2.2; no baseline tutorial)

Sources: [kit 1.2.2](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.2.2%20Passive%20Buzzer.html)
(page text, diagram `_images/1.2.2.png`), Soberton [WT-1209T](https://www.soberton.com/wp-content/uploads/2022/03/WT-1209T.pdf)
(the closest published 12 mm magnetic transducer), onsemi [PN2222A](https://www.megastar.com/content/pdfs/PN2222A-D.pdf),
Yageo CFR (resistor), Raspberry Pi GPIO documentation. The baseline has no passive-buzzer tutorial, so the findings
below are conflicts in the kit's own page.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| passive-buzzer-1 | polarity and supply | Kit page text: positive pin to the collector, negative pin to 3.3 V; its diagram feeds the + lead from 5V0 and puts the − lead on the collector | The coil is driven low-side from 5V0, the same circuit as the active buzzer. The kit's 3.3 V wording would leave the coil below its 4 V minimum operating voltage; the swapped polarity wording is harmless for a coil, which has no polarity | Kit 1.2.2 (text, diagram); WT-1209T (rated 5 V, operating 4 to 7 V) | Misleading | sim: "A 440 Hz, 50 % PWM signal switches the coil on half the time" | Fixed |
| passive-buzzer-2 | code | The kit's cleanup drives the pin HIGH, commented as "off", before `GPIO.cleanup()` | With this NPN switch HIGH is on: it puts the supply across the coil, about 0.1 A for a 45 Ω coil, while the pin stays HIGH. The rebuilt code stops the PWM and leaves the pin LOW | Kit 1.2.2 code; WT-1209T (coil 45 Ω, to be measured on the real part) | Misleading | sim: "A steady HIGH puts almost the whole 5 V across the coil…", "GPIO17 LOW leaves the coil with no current"; code/netlist pin check | Fixed |
| passive-buzzer-3 | theory | "By changing how quickly we turn the signal on and off… This is called Pulse Width Modulation" | The pitch comes from the signal's frequency; PWM's duty cycle (the share of each cycle spent HIGH) stays at 50 % for a note and only sets how loud it is | Kit 1.2.2 | Cosmetic | sim: "A 440 Hz, 50 % PWM signal…", "A 440 Hz, 10 % PWM signal…" | Fixed |
| passive-buzzer-4 | code values | Note table: its sixth bass note is 211 Hz, and mid-octave notes are 350, 393, 441 and 495 Hz | Equal-tempered values: A3 is 220 Hz, and F4, G4, A4 and B4 are 349, 392, 440 and 494 Hz. The rebuilt code uses one octave of C major from standard pitch | Kit 1.2.2 code; [Piano key frequencies](https://en.wikipedia.org/wiki/Piano_key_frequencies) | Cosmetic | code/netlist pin check | Fixed |

Generated wiring table and build steps:

<!-- generated:passive-buzzer -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| BZ1 | Passive buzzer (12 mm magnetic transducer) | + (marked lead) | row 29 column j | 5V |
| BZ1 | Passive buzzer (12 mm magnetic transducer) | - (unmarked lead) | row 32 column j | N1 |
| Q1 | PN2222A NPN transistor (TO-92) | Emitter | row 36 column j | GND |
| Q1 | PN2222A NPN transistor (TO-92) | Base | row 37 column j | N2 |
| Q1 | PN2222A NPN transistor (TO-92) | Collector | row 38 column j | N1 |
| R1 | 1 kΩ resistor (brown, black, red, gold) | Lead 1 | row 37 column f | N2 |
| R1 | 1 kΩ resistor (brown, black, red, gold) | Lead 2 | row 37 column d | GPIO17 |
| W1 | red male–male jumper | end a | row 1 column j | 5V |
| W1 | red male–male jumper | end b | row 29 column h | 5V |
| W2 | blue male–male jumper | end a | row 32 column h | N1 |
| W2 | blue male–male jumper | end b | row 38 column i | N1 |
| W3 | black male–male jumper | end a | row 36 column g | GND |
| W3 | black male–male jumper | end b | row 5 column a | GND |
| W4 | green male–male jumper | end a | row 37 column a | GPIO17 |
| W4 | green male–male jumper | end b | row 6 column a | GPIO17 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 1 kΩ resistor (brown, black, red, gold), from row 37 column f to row 37 column d.
3. Insert BZ1, the Passive buzzer (12 mm magnetic transducer): + (longer leg) in row 29 column j, − (shorter leg) in row 32 column j.
4. Insert Q1, the PN2222A NPN transistor (TO-92), with pin 1 (Emitter) in row 36 column j and pin 3 (Collector) in row 38 column j.
5. Use a red 20 cm male–male jumper (W1) from row 1 column j to row 29 column h.
6. Use a green 20 cm male–male jumper (W4) from row 37 column a to row 6 column a.
7. Use a blue 20 cm male–male jumper (W2) from row 32 column h to row 38 column i.
8. Use a black 20 cm male–male jumper (W3) from row 36 column g to row 5 column a.
<!-- /generated:passive-buzzer -->
<!-- /section:passive-buzzer -->

<!-- section:motor -->
### Motor (`motor`, kit 1.3.1; baseline `motor`)

Sources: [kit 1.3.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.3.1%20Motor.html)
(page text, code, diagram `_images/1.3.1.png`), TI [L293D](https://www.ti.com/lit/ds/symlink/l293d.pdf) (SLRS008D),
the [130-size toy motor sheet](https://components101.com/sites/default/files/component_datasheet/Toy%20DC%20motor%20Datasheet.pdf),
the MB102 [breadboard power supply](https://alessandra-flammini.unibs.it/EG_FED/EG_AA2324/FE/Laboratorio/Datasheet%20componenti/alimentatore%20per%20breadboard%20mb102-ps.pdf),
Raspberry Pi GPIO documentation.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| motor-1 | circuit | "External 6–9V → L293D Pin 8 (Vcc2)" and "GND → L293D Pins 4, 5, 12, 13"; the supply's ground is never joined to the Pi's | The power module's GND and the Pi's GND meet on the L293D's ground strip, so the motor current returns to its supply and the logic inputs share the chip's ground | TI L293D (pins 4, 5, 12, 13 are the device ground); kit 1.3.1 diagram | Doesn't work | sim: "VCC1 and VCC2 sit at the power module's 5 V, and the chip's GND meets the Pi's GND"; "Enable HIGH with GPIO17 HIGH and GPIO27 LOW drives M1…" | Fixed |
| motor-2 | wiring and diagram (D7) | GPIO17, GPIO27 and GPIO22 go to "row 22", "row 23" and "row 24"; `wiringDiagram` draws no components | The chip straddles the trench in rows 41–48 with pin 1 in 41e, and every GPIO, supply, ground and motor lead is a placed lead with a hole-by-hole table. The chip's pins 1, 2 and 7 are in rows 41, 42 and 47, not in three adjacent rows | SPEC 16.2 D7; TI L293D pin table | Doesn't work | placement check (`validateDoc`); generated wiring table and steps | Fixed |
| motor-3 | GPIO numbers | GPIO17 is the enable (pin 1, PWM) and GPIO22 is IN2 (pin 7); GPIO27 is IN1 (pin 2) | GPIO22 is the enable (pin 1) and GPIO17 drives 2A (pin 7), the other way round; GPIO27 drives 1A (pin 2) as in the baseline | Kit 1.3.1 diagram and code | Misleading | code/netlist pin check; sim: "Enable (GPIO22) LOW releases both outputs…" | Fixed |
| motor-4 | supply | "External Power Supply (6-9V)", a part the kit does not contain, for Vcc2, with Vcc1 from the Pi's 5V | The kit's MB102 power module, fed from the 9 V battery connector and set to 5 V, supplies both VCC1 and VCC2, so the motor's current never passes through the Pi | Kit 1.3.1 (diagram, note); `content/inventory.json` (power module ×1, 9 V connector ×1); MB102 sheet | Misleading | sim: "VCC1 and VCC2 sit at the power module's 5 V…" | Fixed |
| motor-5 | wiring text | "L293D Pins 3, 6 (Output) → Motor terminals" | The motor's two leads end in male Dupont pins, so they take male–female leads: female end on the motor, male end in the strips of pins 3 and 6 | Kit 1.3.1; SPEC 6.5 | Cosmetic | generated build steps (lead kinds checked by `validateDoc`) | Fixed |
| motor-6 | kit text | Kit page: "the motor first rotates clockwise for 5s then stops for 5s" | The kit's own code runs and stops for 3 s each; the rebuilt code follows the code | Kit 1.3.1 (text, code) | Cosmetic | code/netlist pin check | Fixed |

Generated wiring table and build steps:

<!-- generated:motor -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| U1 | L293D quadruple half-H driver (DIP-16) | 1,2EN | row 41 column e | GPIO22 |
| U1 | L293D quadruple half-H driver (DIP-16) | 1A | row 42 column e | GPIO27 |
| U1 | L293D quadruple half-H driver (DIP-16) | 1Y | row 43 column e | N1 |
| U1 | L293D quadruple half-H driver (DIP-16) | GND | row 44 column e | GND |
| U1 | L293D quadruple half-H driver (DIP-16) | GND | row 45 column e | GND |
| U1 | L293D quadruple half-H driver (DIP-16) | 2Y | row 46 column e | N2 |
| U1 | L293D quadruple half-H driver (DIP-16) | 2A | row 47 column e | GPIO17 |
| U1 | L293D quadruple half-H driver (DIP-16) | VCC2 | row 48 column e | N4 |
| U1 | L293D quadruple half-H driver (DIP-16) | 3,4EN | row 48 column f | N9 |
| U1 | L293D quadruple half-H driver (DIP-16) | 3A | row 47 column f | N5 |
| U1 | L293D quadruple half-H driver (DIP-16) | 3Y | row 46 column f | N6 |
| U1 | L293D quadruple half-H driver (DIP-16) | GND | row 45 column f | GND |
| U1 | L293D quadruple half-H driver (DIP-16) | GND | row 44 column f | GND |
| U1 | L293D quadruple half-H driver (DIP-16) | 4Y | row 43 column f | N7 |
| U1 | L293D quadruple half-H driver (DIP-16) | 4A | row 42 column f | N8 |
| U1 | L293D quadruple half-H driver (DIP-16) | VCC1 | row 41 column f | N4 |
| M1 | DC motor with fan blade (130 size) | Red lead | module pin | N2 |
| M1 | DC motor with fan blade (130 size) | Black lead | module pin | N1 |
| PM1 | MB102 breadboard power supply module (3.3 V / 5 V) | 3V3 (J6 pin 1) | module pin | N3 |
| PM1 | MB102 breadboard power supply module (3.3 V / 5 V) | GND (J6 pin 2) | module pin | GND |
| PM1 | MB102 breadboard power supply module (3.3 V / 5 V) | 3V3 (J6 pin 3) | module pin | N3 |
| PM1 | MB102 breadboard power supply module (3.3 V / 5 V) | GND (J6 pin 4) | module pin | GND |
| PM1 | MB102 breadboard power supply module (3.3 V / 5 V) | 5V (J6 pin 5) | module pin | N4 |
| PM1 | MB102 breadboard power supply module (3.3 V / 5 V) | GND (J6 pin 6) | module pin | GND |
| PM1 | MB102 breadboard power supply module (3.3 V / 5 V) | 5V (J6 pin 7) | module pin | N4 |
| PM1 | MB102 breadboard power supply module (3.3 V / 5 V) | GND (J6 pin 8) | module pin | GND |
| W1 | grey male–male jumper | end a | row 8 column a | GPIO22 |
| W1 | grey male–male jumper | end b | row 41 column a | GPIO22 |
| W2 | orange male–male jumper | end a | row 7 column a | GPIO27 |
| W2 | orange male–male jumper | end b | row 42 column a | GPIO27 |
| W3 | brown male–male jumper | end a | row 6 column a | GPIO17 |
| W3 | brown male–male jumper | end b | row 47 column a | GPIO17 |
| W4 | black male–male jumper | end a | row 5 column a | GND |
| W4 | black male–male jumper | end b | row 45 column a | GND |
| W5 | red male–female jumper | end a | PM1's 5V (J6 pin 5) pin | N4 |
| W5 | red male–female jumper | end b | row 48 column a | N4 |
| W6 | red male–female jumper | end a | PM1's 5V (J6 pin 7) pin | N4 |
| W6 | red male–female jumper | end b | row 41 column i | N4 |
| W7 | black male–female jumper | end a | PM1's GND (J6 pin 6) pin | GND |
| W7 | black male–female jumper | end b | row 45 column b | GND |
| W8 | yellow male–female jumper | end a | M1's Black lead pin | N1 |
| W8 | yellow male–female jumper | end b | row 43 column b | N1 |
| W9 | green male–female jumper | end a | M1's Red lead pin | N2 |
| W9 | green male–female jumper | end b | row 46 column b | N2 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert U1, the L293D quadruple half-H driver (DIP-16), across the trench with pin 1 (1,2EN) in row 41 column e and pin 16 (VCC1) in row 41 column f.
3. Place M1, the DC motor with fan blade (130 size), beside the board; leads connect it in later steps.
4. Place PM1, the MB102 breadboard power supply module (3.3 V / 5 V), beside the board; leads connect it in later steps.
5. Use a brown 20 cm male–male jumper (W3) from row 6 column a to row 47 column a.
6. Use a orange 20 cm male–male jumper (W2) from row 7 column a to row 42 column a.
7. Use a grey 20 cm male–male jumper (W1) from row 8 column a to row 41 column a.
8. Use a red 20 cm male–female jumper (W6) with its female end on PM1's 5V (J6 pin 7) pin and its male end in row 41 column i.
9. Use a yellow 20 cm male–female jumper (W8) with its female end on M1's Black lead pin and its male end in row 43 column b.
10. Use a green 20 cm male–female jumper (W9) with its female end on M1's Red lead pin and its male end in row 46 column b.
11. Use a red 20 cm male–female jumper (W5) with its female end on PM1's 5V (J6 pin 5) pin and its male end in row 48 column a.
12. Use a black 20 cm male–male jumper (W4) from row 5 column a to row 45 column a.
13. Use a black 20 cm male–female jumper (W7) with its female end on PM1's GND (J6 pin 6) pin and its male end in row 45 column b.
<!-- /generated:motor -->
<!-- /section:motor -->

<!-- section:relay -->
### Relay (`relay`, kit 1.3.2; baseline `relay`)

Sources: [kit 1.3.2](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.3.2%20Relay.html)
(page text, code, diagram `_images/1.3.4.png`), Songle [SRD-05VDC-SL-C](https://www.circuitbasics.com/wp-content/uploads/2015/11/SRD-05VDC-SL-C-Datasheet.pdf),
Kingbright WP7113ID (red 5 mm LED), Yageo CFR (resistor), Raspberry Pi GPIO documentation.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| relay-1 | circuit | "Relay COM → Relay NO: wire through NO (normally open) and COM for the demo LED"; the LED and its 220 Ω resistor are in the parts list but never wired, and the load has no supply | 5V0 → COM; NO → 220 Ω → LED → GND. The contact is open until the coil is energised, then the 5 V reaches the LED | Kit 1.3.2 diagram; Songle sheet | Doesn't work | sim: "S HIGH: after the operate time COM joins NO and D1 lights within its rating" | Fixed |
| relay-2 | diagram (D7) | `wiringDiagram` draws no components; its wires take GPIO17, 5V and GND to rows 22, 23 and 24, where nothing is connected | The module sits off the board and connects through male–female leads to its S, + and − header pins and male–male leads to its COM and NO screw terminals, all placed and listed | SPEC 16.2 D7; SPEC 6.5 | Doesn't work | generated wiring table and steps match the document; `validateDoc` checks every lead's genders | Fixed |
| relay-3 | polarity | Baseline code: HIGH energises the relay, with a tip that "some relay modules are active-LOW". The kit's own code comments say LOW closes the relay and start HIGH, but its printed messages put the LED on when the pin is HIGH | The module is active high: S HIGH drives the transistor, which energises the coil. The rebuilt code starts LOW and the assertions use HIGH = closed | Kit 1.3.2 code and component description; SunFounder relay-module documentation cited in `core/sim/behaviors/relay-module.ts` | Misleading | sim: "S LOW: the relay rests on NC…", "S HIGH: after the operate time…", "S as a pulled-down input…" | Fixed |
| relay-4 | quoted values | "up to 250V AC / 10A on most modules" | The SRD-05VDC-SL-C is rated 10 A at 125 V AC, and 7 A at 240 V AC or 28 V DC (resistive) | Songle sheet | Misleading | theory renders from the doc (theory keeps to low-voltage loads) | Fixed |
| relay-5 | wiring text | Module pins called "IN", "VCC" and "GND" | The header is marked S (signal), + (5 V) and −; the screw terminals read NC, COM, NO from the top | Kit 1.3.2 diagram; part definition | Cosmetic | generated wiring table and steps | Fixed |
| relay-6 | timing | The code switches every 2 s and says the circuit is closed at once | The contact moves up to 10 ms after the coil is energised and up to 5 ms after it is released | Songle sheet (operate 10 ms, release 5 ms maximum) | Cosmetic | sim: "S HIGH: 5 ms later the contact has not moved yet…", "S back to LOW: after the release time…" | Fixed |

Generated wiring table and build steps:

<!-- generated:relay -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| K1 | 5 V relay module (SRD-05VDC-SL-C) | S (signal input) | module pin | GPIO17 |
| K1 | 5 V relay module (SRD-05VDC-SL-C) | + (5 V supply) | module pin | 5V |
| K1 | 5 V relay module (SRD-05VDC-SL-C) | - (ground) | module pin | GND |
| K1 | 5 V relay module (SRD-05VDC-SL-C) | NC (normally closed, screw terminal) | module pin | N2 |
| K1 | 5 V relay module (SRD-05VDC-SL-C) | COM (common, screw terminal) | module pin | 5V |
| K1 | 5 V relay module (SRD-05VDC-SL-C) | NO (normally open, screw terminal) | module pin | N3 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 30 column b | N3 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 34 column b | N1 |
| D1 | red 5 mm LED | Anode (+) | row 34 column c | N1 |
| D1 | red 5 mm LED | Cathode (−) | row 35 column c | GND |
| W1 | red male–female jumper | end a | K1's + (5 V supply) pin | 5V |
| W1 | red male–female jumper | end b | row 1 column i | 5V |
| W2 | black male–female jumper | end a | K1's - (ground) pin | GND |
| W2 | black male–female jumper | end b | row 3 column i | GND |
| W3 | blue male–female jumper | end a | K1's S (signal input) pin | GPIO17 |
| W3 | blue male–female jumper | end b | row 6 column a | GPIO17 |
| W4 | red male–male jumper | end a | K1's COM (common, screw terminal) pin | 5V |
| W4 | red male–male jumper | end b | row 2 column i | 5V |
| W5 | yellow male–male jumper | end a | K1's NO (normally open, screw terminal) pin | N3 |
| W5 | yellow male–male jumper | end b | row 30 column a | N3 |
| W6 | black male–male jumper | end a | row 35 column a | GND |
| W6 | black male–male jumper | end b | row 3 column j | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 220 Ω resistor (red, red, brown, gold), from row 30 column b to row 34 column b.
3. Insert D1, the red 5 mm LED: anode (longer leg) in row 34 column c, cathode (shorter leg, flat side) in row 35 column c.
4. Place K1, the 5 V relay module (SRD-05VDC-SL-C), beside the board; leads connect it in later steps.
5. Use a red 20 cm male–female jumper (W1) with its female end on K1's + (5 V supply) pin and its male end in row 1 column i.
6. Use a red 20 cm male–male jumper (W4) from K1's COM (common, screw terminal) pin to row 2 column i.
7. Use a blue 20 cm male–female jumper (W3) with its female end on K1's S (signal input) pin and its male end in row 6 column a.
8. Use a yellow 20 cm male–male jumper (W5) from K1's NO (normally open, screw terminal) pin to row 30 column a.
9. Use a black 20 cm male–female jumper (W2) with its female end on K1's - (ground) pin and its male end in row 3 column i.
10. Use a black 20 cm male–male jumper (W6) from row 35 column a to row 3 column j.
<!-- /generated:relay -->
<!-- /section:relay -->

<!-- section:button -->
### Button (`button`, kit 2.1.1; baseline `button-led`)

Sources: [kit 2.1.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.1.1%20Button.html)
(page text, code, diagram `_images/2.1.1.png`), Omron [B3F](https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf)
(6 mm tactile switch), Kingbright WP7113ID (red 5 mm LED), Yageo CFR (resistor), Raspberry Pi GPIO documentation.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| button-1 | circuit (D9) | The 10 kΩ "pull-down" spans rows 28–29, but GPIO18 is on row 27, so it is on a different strip and never touches GPIO18 | The 10 kΩ pull-up (R2) shares the strip of GPIO18 and the switch (row 38 f–j), and its other end goes to 3V3. With the pin's internal pull switched off, the resistor alone holds GPIO18 HIGH when the button is open | Kit 2.1.1 diagram; SPEC 16.2 D9 | Doesn't work | sim: "Released, with no internal pull at all: the 10 kΩ pull-up alone holds GPIO18 HIGH" and "Pressed, with no internal pull at all: the switch alone pulls GPIO18 LOW" | Fixed |
| button-2 | placement | LED anode in row 23 column e | On the bench the T-board body covers columns d–h of rows 21–23, so 23e cannot take a lead. The rebuild uses rows 26–40 | SPEC 6.6; `content/controllers/tboard.json` (ADR-0004) | Doesn't work | placement check (`validateDoc`) | Fixed |
| button-3 | placement | "Button straddling center channel at row 27", GPIO18 on 27a and 3V3 on 27j | The switch's legs 1 and 2 (and 3 and 4) are joined inside, and they are the pairs across the trench. In one row the switch joins 27a–e to 27f–j permanently, so GPIO18 would sit on 3V3 whether or not the button is pressed. The switch spans two rows: 1 and 2 in row 38 (e and f), 3 and 4 in row 40 | Omron B3F terminal drawing; part definition | Doesn't work | placement check (rigid footprint, trench); sim: "Pressed, with the code's internal pull-up on: GPIO18 reads LOW" | Fixed |
| button-4 | circuit polarity | Pull-down: 3V3 → button → GPIO18, with the 10 kΩ to GND, so pressing makes the pin HIGH | The kit's pull-up configuration: the pin reads HIGH while the button is released and LOW while it is pressed | Kit 2.1.1 page text and code (SPEC 13.1) | Misleading | sim: "Released, with the code's internal pull-up on: GPIO18 reads HIGH", "Pressed…reads LOW" | Fixed |
| button-5 | LED polarity | GPIO17 → 220 Ω → LED → GND, lit by HIGH | 3V3 → 220 Ω → LED anode, cathode → GPIO17, lit by LOW | Kit 2.1.1 diagram and code (`LED_ON = GPIO.LOW`) | Misleading | sim: "GPIO17 LOW lights D1 with at least 1 mA…", "GPIO17 HIGH turns D1 off" | Fixed |
| button-6 | tip | "The internal pull-down (GPIO.PUD_DOWN) means you can skip the external 10kΩ resistor for testing" | The external resistor is part of the circuit: the code's internal pull-up only repeats what R2 already does, and a wiring mistake in R2 must not be hidden by it | Kit 2.1.1; SPEC 16.2 D9 | Misleading | the same two "no internal pull at all" assertions | Fixed |
| button-7 | diagram (D5) | `wiringDiagram` draws the button as a single point at row 27 column e | Both switch pairs placed in two rows, with the hole-by-hole table generated from the document | SPEC 16.2 D5 | Misleading | generated wiring table and steps match the document | Fixed |
| button-8 | code | Prints "Button pressed - LED ON" every 50 ms while the button is held | Reports each change once, as the kit does | Kit 2.1.1 code (behaviour) | Cosmetic | code/netlist pin check | Fixed |

Generated wiring table and build steps:

<!-- generated:button -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 26 column b | 3V3 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 30 column b | N1 |
| D1 | red 5 mm LED | Anode (+) | row 30 column c | N1 |
| D1 | red 5 mm LED | Cathode (−) | row 31 column c | GPIO17 |
| R2 | 10 kΩ resistor (brown, black, orange, gold) | Lead 1 | row 34 column i | 3V3 |
| R2 | 10 kΩ resistor (brown, black, orange, gold) | Lead 2 | row 38 column i | GPIO18 |
| SW1 | 6 mm tactile switch (4-pin) | Terminal 1 | row 38 column e | GPIO18 |
| SW1 | 6 mm tactile switch (4-pin) | Terminal 2 | row 38 column f | GPIO18 |
| SW1 | 6 mm tactile switch (4-pin) | Terminal 3 | row 40 column e | GND |
| SW1 | 6 mm tactile switch (4-pin) | Terminal 4 | row 40 column f | GND |
| W1 | red male–male jumper | end a | row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | row 26 column a | 3V3 |
| W2 | green male–male jumper | end a | row 31 column a | GPIO17 |
| W2 | green male–male jumper | end b | row 6 column a | GPIO17 |
| W3 | red male–male jumper | end a | row 9 column a | 3V3 |
| W3 | red male–male jumper | end b | row 34 column f | 3V3 |
| W4 | blue male–male jumper | end a | row 6 column j | GPIO18 |
| W4 | blue male–male jumper | end b | row 38 column j | GPIO18 |
| W5 | black male–male jumper | end a | row 40 column a | GND |
| W5 | black male–male jumper | end b | row 5 column a | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 220 Ω resistor (red, red, brown, gold), from row 26 column b to row 30 column b.
3. Insert R2, the 10 kΩ resistor (brown, black, orange, gold), from row 34 column i to row 38 column i.
4. Insert D1, the red 5 mm LED: anode (longer leg) in row 30 column c, cathode (shorter leg, flat side) in row 31 column c.
5. Insert SW1, the 6 mm tactile switch (4-pin), across the trench with pin 1 (Terminal 1) in row 38 column e and pin 4 (Terminal 4) in row 40 column f.
6. Use a red 20 cm male–male jumper (W1) from row 1 column a to row 26 column a.
7. Use a green 20 cm male–male jumper (W2) from row 31 column a to row 6 column a.
8. Use a blue 20 cm male–male jumper (W4) from row 6 column j to row 38 column j.
9. Use a red 20 cm male–male jumper (W3) from row 9 column a to row 34 column f.
10. Use a black 20 cm male–male jumper (W5) from row 40 column a to row 5 column a.
<!-- /generated:button -->
<!-- /section:button -->

<!-- section:tilt-switch -->
### Tilt Switch (`tilt-switch`, kit 2.1.2; no baseline tutorial)

Sources: [kit 2.1.2](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.1.2%20Tilt%20Switch.html)
(page text, code, diagram `_images/2.1.3.png`), SW-520D [ball switch](https://www.tme.com/Document/f1e6cedd8cb7feeb250b353b6213ec6c/SW-520D.pdf),
Kingbright WP7113ID (red) and WP7113GD (green) 5 mm LEDs, Yageo CFR (resistor), Raspberry Pi GPIO documentation.
The baseline has no tilt-switch tutorial, so the findings below are errors in the kit's own page.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| tilt-switch-1 | circuit | Kit diagram: the "ground" lead goes to the T-board's ID_SD pin (header pin 27, GPIO0) instead of a GND pin, and the 3V3 lead goes to a rail nothing uses | GND comes from the T-board's GND strip (pin 9). With the lead on ID_SD the three resistors would have no path to ground, so neither LED could light | Kit 2.1.2 diagram `_images/2.1.3.png`; Pi 5 header pinout | Doesn't work | sim: "GPIO27 HIGH lights the green LED…", "GPIO22 HIGH lights the red LED…" (current flows to GND) | Fixed |
| tilt-switch-2 | code | Kit code treats LOW as "tilted" (red) and HIGH as "upright" (green) | The ball closes the switch when it stands upright (the kit's own prose), so the pin reads LOW when upright and HIGH when tilted. The rebuilt code lights green when the pin is LOW and red, with "Tilt!", when it is HIGH | Kit 2.1.2 (text, code); SW-520D sheet | Misleading | sim: "Upright, the ball closes S1 and the pin reads LOW…", "Tilted, S1 opens and the internal pull-up makes the pin read HIGH" | Fixed |
| tilt-switch-3 | wiring text | The connect table lists "GPIO17 – Pin 27" | GPIO17 is header pin 11; pin 27 is ID_SD. The kit's own code uses pin 11 | Kit 2.1.2 (table, code); Pi 5 header pinout | Misleading | code/netlist pin check; the generated table puts GPIO17 on pin 11's strip (row 6) | Fixed |
| tilt-switch-4 | code comment | "Assumes an external pull-up or pull-down resistor is part of the module" | There is no module: the switch is bare, with no pull-up outside the Pi. The internal pull-up is what lifts the pin when the switch is open, which is why the code sets `PUD_UP` | Kit 2.1.2 code and diagram | Cosmetic | sim: "Without the internal pull-up an open S1 leaves the pin floating" | Fixed |

Generated wiring table and build steps:

<!-- generated:tilt-switch -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| S1 | Ball tilt switch (SW-520D) | Lead 1 | row 40 column c | N3 |
| S1 | Ball tilt switch (SW-520D) | Lead 2 | row 41 column c | GPIO17 |
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 1 | row 40 column a | N3 |
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 2 | row 44 column a | GND |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 29 column b | N1 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 25 column b | GND |
| D1 | red 5 mm LED | Anode (+) | row 30 column c | GPIO22 |
| D1 | red 5 mm LED | Cathode (−) | row 29 column c | N1 |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 35 column b | N2 |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 31 column b | GND |
| D2 | green 5 mm LED | Anode (+) | row 36 column c | GPIO27 |
| D2 | green 5 mm LED | Cathode (−) | row 35 column c | N2 |
| W1 | black male–male jumper | end a | row 25 column a | GND |
| W1 | black male–male jumper | end b | row 5 column a | GND |
| W2 | grey male–male jumper | end a | row 30 column a | GPIO22 |
| W2 | grey male–male jumper | end b | row 8 column a | GPIO22 |
| W3 | black male–male jumper | end a | row 31 column a | GND |
| W3 | black male–male jumper | end b | row 5 column b | GND |
| W4 | orange male–male jumper | end a | row 36 column a | GPIO27 |
| W4 | orange male–male jumper | end b | row 7 column a | GPIO27 |
| W5 | blue male–male jumper | end a | row 41 column e | GPIO17 |
| W5 | blue male–male jumper | end b | row 6 column a | GPIO17 |
| W6 | black male–male jumper | end a | row 44 column b | GND |
| W6 | black male–male jumper | end b | row 5 column c | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R2, the 220 Ω resistor (red, red, brown, gold), from row 29 column b to row 25 column b.
3. Insert R3, the 220 Ω resistor (red, red, brown, gold), from row 35 column b to row 31 column b.
4. Insert R1, the 10 kΩ resistor (brown, black, orange, gold), from row 40 column a to row 44 column a.
5. Insert D1, the red 5 mm LED: anode (longer leg) in row 30 column c, cathode (shorter leg, flat side) in row 29 column c.
6. Insert D2, the green 5 mm LED: anode (longer leg) in row 36 column c, cathode (shorter leg, flat side) in row 35 column c.
7. Insert S1, the Ball tilt switch (SW-520D), from row 40 column c to row 41 column c.
8. Use a blue 20 cm male–male jumper (W5) from row 41 column e to row 6 column a.
9. Use a orange 20 cm male–male jumper (W4) from row 36 column a to row 7 column a.
10. Use a grey 20 cm male–male jumper (W2) from row 30 column a to row 8 column a.
11. Use a black 20 cm male–male jumper (W1) from row 25 column a to row 5 column a.
12. Use a black 20 cm male–male jumper (W3) from row 31 column a to row 5 column b.
13. Use a black 20 cm male–male jumper (W6) from row 44 column b to row 5 column c.
<!-- /generated:tilt-switch -->
<!-- /section:tilt-switch -->

<!-- section:morse-code -->
### Morse Code Generator (`morse-code`, kit 3.1.2; no baseline tutorial)

Sources: [kit 3.1.2](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/3.1.2%20Morse%20Code%20Generator.html)
(page text, diagram `_images/3.1.7.png`; the code is in the kit's repository, read for its pins and timing only),
Huawha [TMB12A05](https://stacktronics.com/wp-content/uploads/2024/12/TMB12A05.pdf), onsemi [PN2222A](https://www.megastar.com/content/pdfs/PN2222A-D.pdf),
Kingbright WP7113ID (red 5 mm LED), Yageo CFR (resistor), [ITU-R M.1677-1](https://www.itu.int/dms_pubrec/itu-r/rec/m/R-REC-M.1677-1-200910-I!!PDF-E.pdf)
(International Morse code), Raspberry Pi GPIO documentation. The baseline has no Morse tutorial.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| morse-code-1 | supply | Kit diagram: the buzzer's + lead goes to the 3V3 pin, while the kit's Active and Passive Buzzer diagrams use 5V0 | The buzzer's primary datasheet gives a 4 V minimum operating voltage (another sheet 3 V) and 5 V rated. The rebuild feeds + from 5V0, as in 1.2.1; the transistor keeps the 5 V off the GPIO pins | Kit 3.1.2, 1.2.1 diagrams; TMB12A05 | Misleading | sim: "GPIO22 HIGH saturates Q1 so BZ1 sounds, and leaves D1 dark" (the buzzer sounds only from 4 V) | Fixed |
| morse-code-2 | wiring text | The connect table lists GPIO17 and GPIO22 without saying which drives the LED and which the buzzer | GPIO17 drives the LED through a 220 Ω resistor and GPIO22 drives the buzzer's transistor through 1 kΩ, as the diagram and the kit's code have them | Kit 3.1.2 diagram and code | Cosmetic | code/netlist pin check; generated wiring table and steps | Fixed |
| morse-code-3 | code values | Kit code: a dash lasts twice a dot (0.25 s against 0.125 s), with one dot's pause after every signal, a further 0.25 s after each letter and 0.5 s for a space | International Morse: a dash is three dots, the gap inside a letter one dot, between letters three, and between words seven. The rebuilt code uses a 0.1 s unit | Kit 3.1.2 code; ITU-R M.1677-1 | Misleading | code/netlist pin check | Fixed |

Generated wiring table and build steps:

<!-- generated:morse-code -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| BZ1 | Active buzzer (12 mm, 5 V) | + (long lead) | row 29 column j | 5V |
| BZ1 | Active buzzer (12 mm, 5 V) | - (short lead) | row 32 column j | N1 |
| Q1 | PN2222A NPN transistor (TO-92) | Emitter | row 36 column j | GND |
| Q1 | PN2222A NPN transistor (TO-92) | Base | row 37 column j | N3 |
| Q1 | PN2222A NPN transistor (TO-92) | Collector | row 38 column j | N1 |
| R1 | 1 kΩ resistor (brown, black, red, gold) | Lead 1 | row 37 column f | N3 |
| R1 | 1 kΩ resistor (brown, black, red, gold) | Lead 2 | row 37 column d | GPIO22 |
| D1 | red 5 mm LED | Anode (+) | row 42 column j | N2 |
| D1 | red 5 mm LED | Cathode (−) | row 41 column j | GND |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 42 column f | N2 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 42 column d | GPIO17 |
| W1 | red male–male jumper | end a | row 1 column j | 5V |
| W1 | red male–male jumper | end b | row 29 column h | 5V |
| W2 | blue male–male jumper | end a | row 32 column h | N1 |
| W2 | blue male–male jumper | end b | row 38 column i | N1 |
| W3 | black male–male jumper | end a | row 36 column g | GND |
| W3 | black male–male jumper | end b | row 5 column a | GND |
| W4 | green male–male jumper | end a | row 37 column a | GPIO22 |
| W4 | green male–male jumper | end b | row 8 column a | GPIO22 |
| W5 | black male–male jumper | end a | row 41 column g | GND |
| W5 | black male–male jumper | end b | row 5 column b | GND |
| W6 | yellow male–male jumper | end a | row 42 column c | GPIO17 |
| W6 | yellow male–male jumper | end b | row 6 column a | GPIO17 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 1 kΩ resistor (brown, black, red, gold), from row 37 column f to row 37 column d.
3. Insert R2, the 220 Ω resistor (red, red, brown, gold), from row 42 column f to row 42 column d.
4. Insert BZ1, the Active buzzer (12 mm, 5 V): + (longer leg) in row 29 column j, − (shorter leg) in row 32 column j.
5. Insert Q1, the PN2222A NPN transistor (TO-92), with pin 1 (Emitter) in row 36 column j and pin 3 (Collector) in row 38 column j.
6. Insert D1, the red 5 mm LED: anode (longer leg) in row 42 column j, cathode (shorter leg, flat side) in row 41 column j.
7. Use a red 20 cm male–male jumper (W1) from row 1 column j to row 29 column h.
8. Use a yellow 20 cm male–male jumper (W6) from row 42 column c to row 6 column a.
9. Use a green 20 cm male–male jumper (W4) from row 37 column a to row 8 column a.
10. Use a blue 20 cm male–male jumper (W2) from row 32 column h to row 38 column i.
11. Use a black 20 cm male–male jumper (W3) from row 36 column g to row 5 column a.
12. Use a black 20 cm male–male jumper (W5) from row 41 column g to row 5 column b.
<!-- /generated:morse-code -->
<!-- /section:morse-code -->

<!-- section:servo -->
### Servo (`servo`, extra, needs parts not in the kit; baseline `servo`)

Sources: no kit page (the SG90 is not in the kit). TowerPro SG90 [data sheet](https://www.friendlywire.com/projects/ne555-servo-safe/SG90-datasheet.pdf)
and [product page](https://towerpro.com.tw/product/sg90-7/), Raspberry Pi GPIO documentation.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| servo-1 | wiring and diagram (D7) | GPIO18, 5V and GND go to rows 22, 23 and 24; `wiringDiagram` draws no components | The SG90's plug has female sockets, so three male–male leads run from them to the T-board's GPIO18, 5V0 and GND strips, all placed and listed | SPEC 16.2 D7; SPEC 6.5; SG90 data sheet | Doesn't work | generated wiring table and steps; `validateDoc` checks the lead genders | Fixed |
| servo-2 | quoted values | "0.5ms = 0°, 1.5ms = 90°, 2.5ms = 180°", duty 2.5 % to 12.5 % at 50 Hz | 1.5 ms is the middle, and about 1 ms and 2 ms are the two ends (±90°): duty 5 % to 10 %. A 2.5 ms pulse is past the 2.4 ms limit the sheet gives, so the horn is driven against its end stop | SG90 data sheet (the SunFounder SG90 page gives 0.5 to 2.5 ms, so the sources disagree and the data sheet is followed) | Misleading | sim: "A 1.5 ms pulse every 20 ms holds the horn at the middle, 0°", "A 1 ms pulse…−90°", "A 2 ms pulse…+90°" | Fixed |
| servo-3 | code | After every move `ChangeDutyCycle(0)` stops the pulses "to prevent jitter" | An analog servo drives its motor only while pulses arrive, so without them it holds nothing against a load. The rebuilt code keeps the PWM running and stops it only at exit | SG90 data sheet (the servo needs a pulse every 20 ms) | Misleading | sim: "When the pulses stop the servo goes slack where it was, no longer holding" | Fixed |
| servo-4 | supply | The servo takes 5V from the Pi, with no word on the current | 4.8 to 6 V; about 100 mA while moving and, in published figures, 360 to 700 mA stalled. The theory says when to use a separate supply | SG90 data sheet; servodatabase figures (not a manufacturer value) | Misleading | theory renders from the doc | Fixed |
| servo-5 | quoted values | "orange/yellow=signal, red=5V, brown/black=GND" | The SG90 is brown (GND), red (VCC) and orange (signal); yellow and black belong to other makes | SG90 data sheet; SunFounder SG90 page | Cosmetic | generated wiring table and steps (pin labels name the colours) | Fixed |
| servo-6 | tag | Listed as a kit tutorial, with no mention that the SG90 is not in the kit | Tagged "needs parts not in the kit": the kit's component list has no servo | `content/inventory.json`; [kit component list](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/component_list.html) | Misleading | `tutorial.json` tag; the "cites its kit page, or is tagged as an extra" check | Fixed |

Generated wiring table and build steps:

<!-- generated:servo -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| SV1 | TowerPro SG90 micro servo (9 g) | Brown (GND) | module pin | GND |
| SV1 | TowerPro SG90 micro servo (9 g) | Red (VCC) | module pin | 5V |
| SV1 | TowerPro SG90 micro servo (9 g) | Orange (signal) | module pin | GPIO18 |
| W1 | red male–male jumper | end a | SV1's Red (VCC) pin | 5V |
| W1 | red male–male jumper | end b | row 1 column i | 5V |
| W2 | black male–male jumper | end a | SV1's Brown (GND) pin | GND |
| W2 | black male–male jumper | end b | row 3 column i | GND |
| W3 | orange male–male jumper | end a | SV1's Orange (signal) pin | GPIO18 |
| W3 | orange male–male jumper | end b | row 6 column i | GPIO18 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Place SV1, the TowerPro SG90 micro servo (9 g), beside the board; leads connect it in later steps.
3. Use a red 20 cm male–male jumper (W1) from SV1's Red (VCC) pin to row 1 column i.
4. Use a orange 20 cm male–male jumper (W3) from SV1's Orange (signal) pin to row 6 column i.
5. Use a black 20 cm male–male jumper (W2) from SV1's Brown (GND) pin to row 3 column i.
<!-- /generated:servo -->
<!-- /section:servo -->

<!-- section:pir -->
### PIR Motion Sensor (`pir`, extra, needs parts not in the kit; baseline `pir-sensor`)

Sources: no kit page (the HC-SR501 is not in the kit). HC-SR501 [specification](https://electronilab.co/wp-content/uploads/2013/12/HC-SR501.pdf)
and the other copies cited in its part definition, Kingbright WP7113ID (red 5 mm LED), Yageo CFR (resistor), Raspberry Pi GPIO documentation.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| pir-1 | wiring and diagram (D5) | 5V, GPIO17 and GND go to rows 22, 23 and 24 with no sensor placed; `wiringDiagram` draws only the resistor and the LED | The module is off the board and takes three male–female leads from its VCC, OUT and GND pins to the T-board's 5V0, GPIO17 and GND strips | SPEC 16.2 D5; SPEC 6.5 | Doesn't work | generated wiring table and steps; `validateDoc` checks the lead genders | Fixed |
| pir-2 | code and quoted values | "PIR sensors need 30-60 seconds to calibrate"; the code waits 2 s ("normally 30s") before it reads | The module's initialisation takes about a minute, and its output is not valid before then. The rebuilt code waits 60 s | HC-SR501 specification (initial time about 1 minute) | Misleading | sim: "During the warm-up OUT stays LOW even with movement in view" | Fixed |
| pir-3 | quoted values | Output delay "5s-5min" | 5 s to about 200 s in the specification table (the same sheet's note and one copy say up to about 300 s); the theory says "from about 5 s up to several minutes" | HC-SR501 specification and its copies | Cosmetic | theory renders from the doc | Fixed |
| pir-4 | parts list | "Buzzer (optional)" and five jumper wires, with no wiring or code for the buzzer | No buzzer. A buzzer wired straight from a GPIO pin would repeat D8; the Active Buzzer tutorial shows the transistor driver | SPEC 16.2 D8; kit 1.2.1 | Misleading | generated wiring table and steps match the document | Fixed |
| pir-5 | code | `GPIO.setup(PIR_PIN, GPIO.IN)` with no pull | `PUD_DOWN`: the module drives OUT itself, and the pull-down keeps the pin LOW, not floating, if the lead works loose (ERC reports FLOATING_INPUT without it) | Pi GPIO documentation (inputs); ERC `FLOATING_INPUT` | Misleading | ERC has no warnings; sim: "After the warm-up, with nothing moving, OUT is LOW" | Fixed |
| pir-6 | code | After a detection the code sleeps 2 s, holding the LED on whatever the sensor does | The LED follows OUT on every loop, so it shows the module's own hold time | HC-SR501 specification | Cosmetic | sim: "When the movement stops OUT falls after the hold time, then the sensor is blocked briefly" | Fixed |
| pir-7 | tag | Listed as a kit tutorial, with no mention that the sensor is not in the kit | Tagged "needs parts not in the kit": the kit's component list has no PIR | `content/inventory.json`; [kit component list](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/component_list.html) | Misleading | `tutorial.json` tag | Fixed |

Generated wiring table and build steps:

<!-- generated:pir -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| U1 | HC-SR501 PIR motion sensor module | VCC | module pin | 5V |
| U1 | HC-SR501 PIR motion sensor module | OUT | module pin | GPIO17 |
| U1 | HC-SR501 PIR motion sensor module | GND | module pin | GND |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 30 column b | GPIO18 |
| R1 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 34 column b | N1 |
| D1 | red 5 mm LED | Anode (+) | row 34 column c | N1 |
| D1 | red 5 mm LED | Cathode (−) | row 35 column c | GND |
| W1 | red male–female jumper | end a | U1's VCC pin | 5V |
| W1 | red male–female jumper | end b | row 2 column i | 5V |
| W2 | black male–female jumper | end a | U1's GND pin | GND |
| W2 | black male–female jumper | end b | row 3 column i | GND |
| W3 | green male–female jumper | end a | U1's OUT pin | GPIO17 |
| W3 | green male–female jumper | end b | row 6 column b | GPIO17 |
| W4 | yellow male–male jumper | end a | row 30 column a | GPIO18 |
| W4 | yellow male–male jumper | end b | row 6 column j | GPIO18 |
| W5 | black male–male jumper | end a | row 35 column a | GND |
| W5 | black male–male jumper | end b | row 5 column a | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 220 Ω resistor (red, red, brown, gold), from row 30 column b to row 34 column b.
3. Insert D1, the red 5 mm LED: anode (longer leg) in row 34 column c, cathode (shorter leg, flat side) in row 35 column c.
4. Place U1, the HC-SR501 PIR motion sensor module, beside the board; leads connect it in later steps.
5. Use a red 20 cm male–female jumper (W1) with its female end on U1's VCC pin and its male end in row 2 column i.
6. Use a green 20 cm male–female jumper (W3) with its female end on U1's OUT pin and its male end in row 6 column b.
7. Use a yellow 20 cm male–male jumper (W4) from row 30 column a to row 6 column j.
8. Use a black 20 cm male–female jumper (W2) with its female end on U1's GND pin and its male end in row 3 column i.
9. Use a black 20 cm male–male jumper (W5) from row 35 column a to row 5 column a.
<!-- /generated:pir -->
<!-- /section:pir -->

<!-- section:potentiometer -->
### Potentiometer (`potentiometer`, kit 2.1.3; no baseline tutorial)

Sources: [kit 2.1.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.1.3%20Potentiometer.html), [the kit's ADS7830 module figure](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/_images/ADS7830_Module.png),
[TI ADS7830 datasheet](https://www.ti.com/lit/ds/symlink/ads7830.pdf) (command byte checked against the kit's [ADCDevice.py](https://github.com/lafvintech/Basic-Starter-Kit-for-Raspberry-Pi/blob/main/python/ADCDevice.py), not copied),
[Alpha RV16AF-20 (10 kΩ rotary pot)](http://www.taiwanalpha.com.tw/downloads?id=97&target=products), [Kingbright WP7113ID (red LED)](https://www.kingbrightusa.com/images/catalog/SPEC/WP7113ID.pdf), Raspberry Pi GPIO documentation.
The baseline has no potentiometer tutorial, so the findings audit the kit page itself.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| potentiometer-1 | text | Kit intro: "The ADC0834 chip will then convert…". Connect note: "place the chip … the grooves on the chip should be on the left" | The project uses the ADS7830 I2C module, which the kit's own code probes at 0x48. There is no chip to orient, and an ADC0834 is a different part | [Kit 2.1.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.1.3%20Potentiometer.html); ADR-0011 | Misleading | sim: "The ADS7830 module runs from 3.3 V and answers at 0x48"; i2c-scan checkpoint | Fixed |
| potentiometer-2 | supply | The kit's ADS7830 figure lists VCC as "3.3V or 5V". The module's I2C pull-ups are unverified and may go to VCC | VCC from the T-board 3V3 strip. At 5 V the module's SDA and SCL could idle at 5 V on GPIO2 and GPIO3, which are not 5 V tolerant. The module's full scale is its supply, so 3.3 V is also the range the lesson describes | [Kit figure](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/_images/ADS7830_Module.png); [TI SBAS302C](https://www.ti.com/lit/ds/symlink/ads7830.pdf); [Pi GPIO docs](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc) | Unsafe for hardware | sim: "The ADS7830 module runs from 3.3 V and answers at 0x48" (U1.VCC is 3.3 V) | Fixed |
| potentiometer-3 | behaviour | "the intensity of LED will change accordingly". The picture wires the LED as in 1.1.1 and the code sets duty = value × 100 ÷ 255 | PWM duty is the share of each cycle spent HIGH. The LED lights when GPIO17 is LOW, so it dims as the reading rises. The rebuilt code says so | [Kit 2.1.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.1.3%20Potentiometer.html); [kit 1.1.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.1.1%20Blinking_LED.html) | Misleading | sim: "GPIO17 LOW lights D1 with at least 1 mA, within its rating"; "GPIO17 HIGH turns D1 off" | Fixed |
| potentiometer-4 | quoted values | Code: voltage = value ÷ 255 × 3.3, though the page's own table splits 3.3 V into 256 steps | One step is 3.3 ÷ 256 V (full scale ÷ 256), so voltage = value × 3.3 ÷ 256 | [TI SBAS302C](https://www.ti.com/lit/ds/symlink/ads7830.pdf); kit 2.1.3 table | Cosmetic | sim: "Wiper at 25 % reads about a quarter of full scale" | Fixed |
| potentiometer-5 | placement | The picture plugs the module straight into the breadboard | The part library models it as an off-board module, so male–female leads run from the T-board strips to its pins (SPEC 6.5) | SPEC 6.5; `content/parts/ads7830-module.part.json` | Cosmetic | placement check (`validateDoc`) | Fixed |
| potentiometer-6 | numbering | The code uses `GPIO.BOARD` (`ledPin = 11`) while the page's tables use BCM names | BCM numbering, `LED_PIN = 17`, as in the other tutorials. It is the same pin | [Kit 2.1.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.1.3%20Potentiometer.html) | Cosmetic | code/netlist pin check (CODE_PIN_MISMATCH) | Fixed |

Generated wiring table and build steps:

<!-- generated:potentiometer -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A0 | module pin | N2 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A1 | module pin | N3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A2 | module pin | N4 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A3 | module pin | N5 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A4 | module pin | N6 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A5 | module pin | N7 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A6 | module pin | N8 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A7 | module pin | N9 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | VCC | module pin | 3V3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | SDA | module pin | GPIO2 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | SCL | module pin | GPIO3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | GND | module pin | GND |
| R1 | Potentiometer 10 kΩ, rotary | End terminal 1 (pin 1) | row 30 column c | GND |
| R1 | Potentiometer 10 kΩ, rotary | Wiper (pin 2, centre) | row 32 column c | N2 |
| R1 | Potentiometer 10 kΩ, rotary | End terminal 2 (pin 3) | row 34 column c | 3V3 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 40 column b | 3V3 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 44 column b | N1 |
| D1 | red 5 mm LED | Anode (+) | row 44 column c | N1 |
| D1 | red 5 mm LED | Cathode (−) | row 45 column c | GPIO17 |
| W1 | red male–male jumper | end a | row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | row 34 column a | 3V3 |
| W2 | black male–male jumper | end a | row 3 column j | GND |
| W2 | black male–male jumper | end b | row 30 column a | GND |
| W3 | red male–female jumper | end a | row 1 column b | 3V3 |
| W3 | red male–female jumper | end b | U1's VCC pin | 3V3 |
| W4 | black male–female jumper | end a | row 5 column a | GND |
| W4 | black male–female jumper | end b | U1's GND pin | GND |
| W5 | blue male–female jumper | end a | row 2 column a | GPIO2 |
| W5 | blue male–female jumper | end b | U1's SDA pin | GPIO2 |
| W6 | yellow male–female jumper | end a | row 3 column a | GPIO3 |
| W6 | yellow male–female jumper | end b | U1's SCL pin | GPIO3 |
| W7 | green male–female jumper | end a | row 32 column a | N2 |
| W7 | green male–female jumper | end b | U1's A0 pin | N2 |
| W8 | red male–male jumper | end a | row 9 column a | 3V3 |
| W8 | red male–male jumper | end b | row 40 column a | 3V3 |
| W9 | orange male–male jumper | end a | row 6 column a | GPIO17 |
| W9 | orange male–male jumper | end b | row 45 column a | GPIO17 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the Potentiometer 10 kΩ, rotary, with pin 1 (End terminal 1 (pin 1)) in row 30 column c and pin 3 (End terminal 2 (pin 3)) in row 34 column c.
3. Insert R2, the 220 Ω resistor (red, red, brown, gold), from row 40 column b to row 44 column b.
4. Insert D1, the red 5 mm LED: anode (longer leg) in row 44 column c, cathode (shorter leg, flat side) in row 45 column c.
5. Place U1, the ADS7830 8-channel 8-bit ADC module (LAFVIN), beside the board; leads connect it in later steps.
6. Use a red 20 cm male–male jumper (W1) from row 1 column a to row 34 column a.
7. Use a red 20 cm male–female jumper (W3) with its female end on U1's VCC pin and its male end in row 1 column b.
8. Use a blue 20 cm male–female jumper (W5) with its female end on U1's SDA pin and its male end in row 2 column a.
9. Use a yellow 20 cm male–female jumper (W6) with its female end on U1's SCL pin and its male end in row 3 column a.
10. Use a orange 20 cm male–male jumper (W9) from row 6 column a to row 45 column a.
11. Use a red 20 cm male–male jumper (W8) from row 9 column a to row 40 column a.
12. Use a green 20 cm male–female jumper (W7) with its female end on U1's A0 pin and its male end in row 32 column a.
13. Use a black 20 cm male–male jumper (W2) from row 3 column j to row 30 column a.
14. Use a black 20 cm male–female jumper (W4) with its female end on U1's GND pin and its male end in row 5 column a.
<!-- /generated:potentiometer -->
<!-- /section:potentiometer -->

<!-- section:photoresistor -->
### Photoresistor (`photoresistor`, kit 2.2.1; no baseline tutorial)

Sources: [kit 2.2.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.2.1%20Photoresistor.html), [the kit's ADS7830 module figure](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/_images/ADS7830_Module.png),
[TI ADS7830 datasheet](https://www.ti.com/lit/ds/symlink/ads7830.pdf), [Senba GL55 photoresistor manual](https://evelta.com/content/datasheets/361-LDR-Senba.pdf), Kingbright WP7113ID (red LED),
Raspberry Pi GPIO documentation. The baseline has no photoresistor tutorial, so the findings audit the kit page itself.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| photoresistor-1 | supply | The kit's ADS7830 figure lists VCC as "3.3V or 5V". The module's I2C pull-ups are unverified and may go to VCC | VCC from the T-board 3V3 strip, so SDA and SCL cannot idle above 3.3 V on GPIO2 and GPIO3 | [Kit figure](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/_images/ADS7830_Module.png); [TI SBAS302C](https://www.ti.com/lit/ds/symlink/ads7830.pdf); [Pi GPIO docs](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc) | Unsafe for hardware | sim: "The ADS7830 module runs from 3.3 V and answers at 0x48" (U1.VCC is 3.3 V) | Fixed |
| photoresistor-2 | behaviour | The intro sells it as a day and night sensor for a night lamp. The code sets duty = value × 100 ÷ 255 on an LED wired active low | Bright light gives a low reading, a short HIGH time and a brighter LED, the opposite of a night lamp. The rebuilt code comments it; a night lamp would use 100 minus the duty | [Kit 2.2.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.2.1%20Photoresistor.html) | Misleading | sim: "Very bright light (1000 lux) reads lowest, about 22"; "GPIO17 LOW lights D1 with at least 1 mA, within its rating" | Fixed |
| photoresistor-3 | text | "What is ADS7830?" says it converts "the continuous voltage signals from the joystick" | It converts the photoresistor divider here; the paragraph is copied from the joystick lesson | [Kit 2.2.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.2.1%20Photoresistor.html) | Cosmetic | theory renders from the doc | Fixed |
| photoresistor-4 | quoted values | The page names no resistor values; they appear only as colour bands in the picture | R1 is 10 kΩ (brown, black, black, red, gold) and the LED resistor 220 Ω (red, red, black, black, gold), read from the picture's bands. The photoresistor model is not named, so the common GL5528 is assumed | [Kit picture](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/_images/2.2.1.png); [Senba GL55](https://evelta.com/content/datasheets/361-LDR-Senba.pdf) | Cosmetic | sim: "Room light (10 lux) reads about 153" | Fixed |
| photoresistor-5 | quoted values | Code: voltage = value ÷ 255 × 3.3, and `GPIO.BOARD` with `ledPin = 11` | value × 3.3 ÷ 256 (one step is full scale ÷ 256); BCM numbering, `LED_PIN = 17`, the same pin | [TI SBAS302C](https://www.ti.com/lit/ds/symlink/ads7830.pdf); kit 2.2.1 | Cosmetic | code/netlist pin check (CODE_PIN_MISMATCH) | Fixed |

Generated wiring table and build steps:

<!-- generated:photoresistor -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A0 | module pin | N2 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A1 | module pin | N3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A2 | module pin | N4 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A3 | module pin | N5 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A4 | module pin | N6 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A5 | module pin | N7 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A6 | module pin | N8 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A7 | module pin | N9 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | VCC | module pin | 3V3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | SDA | module pin | GPIO2 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | SCL | module pin | GPIO3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | GND | module pin | GND |
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 1 | row 28 column b | 3V3 |
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 2 | row 32 column b | N2 |
| R2 | Photoresistor (LDR), GL5528 | Lead 1 | row 32 column c | N2 |
| R2 | Photoresistor (LDR), GL5528 | Lead 2 | row 36 column c | GND |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 42 column b | 3V3 |
| R3 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 46 column b | N1 |
| D1 | red 5 mm LED | Anode (+) | row 46 column c | N1 |
| D1 | red 5 mm LED | Cathode (−) | row 47 column c | GPIO17 |
| W1 | red male–male jumper | end a | row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | row 28 column a | 3V3 |
| W2 | black male–male jumper | end a | row 3 column j | GND |
| W2 | black male–male jumper | end b | row 36 column a | GND |
| W3 | red male–female jumper | end a | row 1 column b | 3V3 |
| W3 | red male–female jumper | end b | U1's VCC pin | 3V3 |
| W4 | black male–female jumper | end a | row 5 column a | GND |
| W4 | black male–female jumper | end b | U1's GND pin | GND |
| W5 | blue male–female jumper | end a | row 2 column a | GPIO2 |
| W5 | blue male–female jumper | end b | U1's SDA pin | GPIO2 |
| W6 | yellow male–female jumper | end a | row 3 column a | GPIO3 |
| W6 | yellow male–female jumper | end b | U1's SCL pin | GPIO3 |
| W7 | green male–female jumper | end a | row 32 column a | N2 |
| W7 | green male–female jumper | end b | U1's A0 pin | N2 |
| W8 | red male–male jumper | end a | row 9 column a | 3V3 |
| W8 | red male–male jumper | end b | row 42 column a | 3V3 |
| W9 | orange male–male jumper | end a | row 6 column a | GPIO17 |
| W9 | orange male–male jumper | end b | row 47 column a | GPIO17 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 10 kΩ resistor (brown, black, orange, gold), from row 28 column b to row 32 column b.
3. Insert R3, the 220 Ω resistor (red, red, brown, gold), from row 42 column b to row 46 column b.
4. Insert R2, the Photoresistor (LDR), GL5528, from row 32 column c to row 36 column c.
5. Insert D1, the red 5 mm LED: anode (longer leg) in row 46 column c, cathode (shorter leg, flat side) in row 47 column c.
6. Place U1, the ADS7830 8-channel 8-bit ADC module (LAFVIN), beside the board; leads connect it in later steps.
7. Use a red 20 cm male–male jumper (W1) from row 1 column a to row 28 column a.
8. Use a red 20 cm male–female jumper (W3) with its female end on U1's VCC pin and its male end in row 1 column b.
9. Use a blue 20 cm male–female jumper (W5) with its female end on U1's SDA pin and its male end in row 2 column a.
10. Use a yellow 20 cm male–female jumper (W6) with its female end on U1's SCL pin and its male end in row 3 column a.
11. Use a orange 20 cm male–male jumper (W9) from row 6 column a to row 47 column a.
12. Use a red 20 cm male–male jumper (W8) from row 9 column a to row 42 column a.
13. Use a green 20 cm male–female jumper (W7) with its female end on U1's A0 pin and its male end in row 32 column a.
14. Use a black 20 cm male–male jumper (W2) from row 3 column j to row 36 column a.
15. Use a black 20 cm male–female jumper (W4) with its female end on U1's GND pin and its male end in row 5 column a.
<!-- /generated:photoresistor -->
<!-- /section:photoresistor -->

<!-- section:thermistor -->
### Thermistor (`thermistor`, kit 2.2.2; no baseline tutorial)

Sources: [kit 2.2.2](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.2.2%20Thermistor.html), [the kit's ADS7830 module figure](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/_images/ADS7830_Module.png),
[TI ADS7830 datasheet](https://www.ti.com/lit/ds/symlink/ads7830.pdf), [Semiware MF52A103F3950 NTC datasheet](https://en.semiware.com/uploads/datasheet/MF52A103F3950.pdf), Raspberry Pi GPIO documentation.
The baseline has no thermistor tutorial, so the findings audit the kit page itself.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| thermistor-1 | supply | The kit's ADS7830 figure lists VCC as "3.3V or 5V". The module's I2C pull-ups are unverified and may go to VCC | VCC from the T-board 3V3 strip, so SDA and SCL cannot idle above 3.3 V on GPIO2 and GPIO3 | [Kit figure](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/_images/ADS7830_Module.png); [TI SBAS302C](https://www.ti.com/lit/ds/symlink/ads7830.pdf); [Pi GPIO docs](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc) | Unsafe for hardware | sim: "The ADS7830 module runs from 3.3 V and answers at 0x48" (U1.VCC is 3.3 V) | Fixed |
| thermistor-2 | behaviour | "Hot environment → Lower resistance → Higher voltage reading" | The thermistor is the lower half of the divider (picture and code formula), so the voltage and the reading fall as it warms. The kit's own code, Rt = 10 × V ÷ (3.3 − V), assumes the same | [Kit 2.2.2](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.2.2%20Thermistor.html) | Misleading | sim: "At 0 C … reads high (about 197)", "At 25 C … half scale", "At 40 C … lower (about 88)", "At 60 C … lower again (about 50)" | Fixed |
| thermistor-3 | code | With V = value ÷ 255 × 3.3 the code divides by zero at a reading of 255 (a thermistor that has come loose pulls A0 to 3.3 V) and takes the log of zero at 0 | Half a step is added to the reading, so the fraction never reaches 0 or 1 and the code keeps running | [Kit 2.2.2](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.2.2%20Thermistor.html) | Doesn't work | none until the code runs in the sim (M5, 5.2) | Fixed |
| thermistor-4 | quoted values | The beta equation with B = 3950 is presented as accurate across the range | The datasheet's table fits B ≈ 3950 between 25 and 50 °C; at 0 °C the table implies about 3865, so the equation is a few degrees off at the ends | [Semiware MF52A103F3950](https://en.semiware.com/uploads/datasheet/MF52A103F3950.pdf) | Cosmetic | theory renders from the doc | Fixed |

Generated wiring table and build steps:

<!-- generated:thermistor -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A0 | module pin | N1 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A1 | module pin | N2 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A2 | module pin | N3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A3 | module pin | N4 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A4 | module pin | N5 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A5 | module pin | N6 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A6 | module pin | N7 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A7 | module pin | N8 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | VCC | module pin | 3V3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | SDA | module pin | GPIO2 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | SCL | module pin | GPIO3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | GND | module pin | GND |
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 1 | row 28 column b | 3V3 |
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 2 | row 32 column b | N1 |
| RT1 | NTC thermistor 10 kΩ, B 3950 | Lead 1 | row 32 column c | N1 |
| RT1 | NTC thermistor 10 kΩ, B 3950 | Lead 2 | row 36 column c | GND |
| W1 | red male–male jumper | end a | row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | row 28 column a | 3V3 |
| W2 | black male–male jumper | end a | row 3 column j | GND |
| W2 | black male–male jumper | end b | row 36 column a | GND |
| W3 | red male–female jumper | end a | row 1 column b | 3V3 |
| W3 | red male–female jumper | end b | U1's VCC pin | 3V3 |
| W4 | black male–female jumper | end a | row 5 column a | GND |
| W4 | black male–female jumper | end b | U1's GND pin | GND |
| W5 | blue male–female jumper | end a | row 2 column a | GPIO2 |
| W5 | blue male–female jumper | end b | U1's SDA pin | GPIO2 |
| W6 | yellow male–female jumper | end a | row 3 column a | GPIO3 |
| W6 | yellow male–female jumper | end b | U1's SCL pin | GPIO3 |
| W7 | green male–female jumper | end a | row 32 column a | N1 |
| W7 | green male–female jumper | end b | U1's A0 pin | N1 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 10 kΩ resistor (brown, black, orange, gold), from row 28 column b to row 32 column b.
3. Insert RT1, the NTC thermistor 10 kΩ, B 3950, from row 32 column c to row 36 column c.
4. Place U1, the ADS7830 8-channel 8-bit ADC module (LAFVIN), beside the board; leads connect it in later steps.
5. Use a red 20 cm male–male jumper (W1) from row 1 column a to row 28 column a.
6. Use a red 20 cm male–female jumper (W3) with its female end on U1's VCC pin and its male end in row 1 column b.
7. Use a blue 20 cm male–female jumper (W5) with its female end on U1's SDA pin and its male end in row 2 column a.
8. Use a yellow 20 cm male–female jumper (W6) with its female end on U1's SCL pin and its male end in row 3 column a.
9. Use a green 20 cm male–female jumper (W7) with its female end on U1's A0 pin and its male end in row 32 column a.
10. Use a black 20 cm male–male jumper (W2) from row 3 column j to row 36 column a.
11. Use a black 20 cm male–female jumper (W4) with its female end on U1's GND pin and its male end in row 5 column a.
<!-- /generated:thermistor -->
<!-- /section:thermistor -->

<!-- section:dht11 -->
### DHT-11 (`dht11`, kit 2.2.3; baseline `dht11`)

Sources: [kit 2.2.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.2.3%20DHT-11.html), [Aosong DHT11 manual](https://components101.com/sites/default/files/component_datasheet/DHT11-Temperature-Sensor.pdf),
[DHT11 datasheet (translated)](https://www.mouser.com/datasheet/2/758/DHT11-Technical-Data-Sheet-Translated-Version-1143054.pdf),
Yageo CFR (resistor), Raspberry Pi GPIO documentation.
The baseline's wiring text, diagram, code, theory, tips and quoted values were checked; its 3.3 V supply, the 10 kΩ pull-up between 3V3 and DATA, the 18 ms start signal, the 40-bit frame layout, the 2 s sampling period and GPIO17 are correct.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| dht11-1 | circuit | Treats the part as a bare sensor with pins VCC (row 22), DATA (row 23), GND (row 24) | The kit's part is a 3-pin module with its own pull-up resistor. Its pins are S (DATA), the middle pin (VCC) and − (GND), so the baseline order puts the module's DATA pin on the supply and its supply pin on GPIO17. The kit adds a 10 kΩ pull-up from DATA to 3V3 beside the module's own 10 kΩ | [Kit 2.2.3 picture](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/_images/2.2.3.png); `dht11-module.part.json` | Doesn't work | sim: "DHT1 is powered from 3V3 and DATA idles high through the pull-up"; "A 20 ms low start on GPIO17 wakes the sensor, which pulls DATA low to answer" | Fixed |
| dht11-2 | placement | Sensor in column e, rows 22 to 24 | Rows 21 to 23, columns d to h, are under the T-board body, so (22, e) and (23, e) cannot take a part. The module is off-board and joins by male–female leads; the resistor sits in rows 30 to 34 | SPEC 6.6; `content/controllers/tboard.json` (ADR-0004) | Doesn't work | placement check (`validateDoc`) | Fixed |
| dht11-3 | supply | Powers the sensor from 3V3 but never says why. The kit says "VCC: Power (connect to 3.3V or 5V)" | The module's own pull-up goes to its VCC. At 5 V it would pull DATA, and GPIO17, toward 5 V, and the Pi's pins are not 5 V tolerant. Power the module from 3V3, as the kit's picture does | [Kit 2.2.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.2.3%20DHT-11.html); [Pi GPIO docs](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc); `dht11-module.part.json` | Unsafe for hardware | sim: "DHT1 is powered from 3V3 and DATA idles high through the pull-up" (DHT1.VCC and DHT1.DATA at 3.3 V) | Fixed |
| dht11-4 | theory | "a humidity-sensitive capacitor and a thermistor feed readings to a small chip" | The DHT11's humidity element is resistive, with an NTC for temperature. The capacitive element belongs to the DHT22 | [Aosong DHT11 manual](https://components101.com/sites/default/files/component_datasheet/DHT11-Temperature-Sensor.pdf) | Misleading | theory renders from the doc | Fixed |
| dht11-5 | quoted values | Kit: "Humidity reading (0-100%)". The baseline's 20 to 90 % is right | 20 to 90 %RH ±5 %RH and 0 to 50 °C ±2 °C, whole units | [Aosong DHT11 manual](https://components101.com/sites/default/files/component_datasheet/DHT11-Temperature-Sensor.pdf) | Misleading | theory renders from the doc | Fixed |
| dht11-6 | code | `adafruit_dht` with `board.D17` and a `libgpiod2` install tip. The kit uses its own compiled driver, and nothing in the kit's docs shows `adafruit_dht` working on a Pi 5 | RPi.GPIO code that wakes the sensor, times the bits and checks the sum. Whether it keeps time on a Pi 5 is for the Run on Pi check | [Kit 2.2.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.2.3%20DHT-11.html) | Misleading | none until the code runs in the sim (M5, 5.2); code/netlist pin check (CODE_PIN_MISMATCH) | Fixed |

Generated wiring table and build steps:

<!-- generated:dht11 -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| DHT1 | DHT11 temperature and humidity module (3-pin) | S | module pin | GPIO17 |
| DHT1 | DHT11 temperature and humidity module (3-pin) | VCC | module pin | 3V3 |
| DHT1 | DHT11 temperature and humidity module (3-pin) | - | module pin | GND |
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 1 | row 30 column b | 3V3 |
| R1 | 10 kΩ resistor (brown, black, orange, gold) | Lead 2 | row 34 column b | GPIO17 |
| W1 | red male–male jumper | end a | row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | row 30 column a | 3V3 |
| W2 | orange male–male jumper | end a | row 6 column a | GPIO17 |
| W2 | orange male–male jumper | end b | row 34 column a | GPIO17 |
| W3 | green male–female jumper | end a | row 34 column c | GPIO17 |
| W3 | green male–female jumper | end b | DHT1's S pin | GPIO17 |
| W4 | red male–female jumper | end a | row 1 column b | 3V3 |
| W4 | red male–female jumper | end b | DHT1's VCC pin | 3V3 |
| W5 | black male–female jumper | end a | row 5 column a | GND |
| W5 | black male–female jumper | end b | DHT1's - pin | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 10 kΩ resistor (brown, black, orange, gold), from row 30 column b to row 34 column b.
3. Place DHT1, the DHT11 temperature and humidity module (3-pin), beside the board; leads connect it in later steps.
4. Use a red 20 cm male–male jumper (W1) from row 1 column a to row 30 column a.
5. Use a red 20 cm male–female jumper (W4) with its female end on DHT1's VCC pin and its male end in row 1 column b.
6. Use a orange 20 cm male–male jumper (W2) from row 6 column a to row 34 column a.
7. Use a green 20 cm male–female jumper (W3) with its female end on DHT1's S pin and its male end in row 34 column c.
8. Use a black 20 cm male–female jumper (W5) with its female end on DHT1's - pin and its male end in row 5 column a.
<!-- /generated:dht11 -->
<!-- /section:dht11 -->

<!-- section:adjustable-fan -->
### Adjustable Fan (`adjustable-fan`, kit 3.1.1; no baseline tutorial)

Sources: [kit 3.1.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/3.1.1%20Adjustable%20Fan.html), [the kit's ADS7830 module figure](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/_images/ADS7830_Module.png),
[TI ADS7830 datasheet](https://www.ti.com/lit/ds/symlink/ads7830.pdf), [TI L293D datasheet](https://www.ti.com/lit/ds/symlink/l293d.pdf),
[MB102 power module datasheet](https://alessandra-flammini.unibs.it/EG_FED/EG_AA2324/FE/Laboratorio/Datasheet%20componenti/alimentatore%20per%20breadboard%20mb102-ps.pdf),
[Alpha RV16AF-20 (pot)](http://www.taiwanalpha.com.tw/downloads?id=97&target=products),
Raspberry Pi GPIO documentation. The pins the code uses were confirmed against the kit's `3.1.1_AdjustableFan.py` (read, not copied).
No baseline tutorial is replaced by this one, so the findings audit the kit page itself.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| adjustable-fan-1 | supply | The kit's ADS7830 figure lists VCC as "3.3V or 5V". The module's I2C pull-ups are unverified and may go to VCC | VCC from the T-board 3V3 strip, so SDA and SCL cannot idle above 3.3 V on GPIO2 and GPIO3 | [Kit figure](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/_images/ADS7830_Module.png); [TI SBAS302C](https://www.ti.com/lit/ds/symlink/ads7830.pdf); [Pi GPIO docs](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc) | Unsafe for hardware | sim: "The ADS7830 module runs from 3.3 V and answers at 0x48" (U1.VCC is 3.3 V) | Fixed |
| adjustable-fan-2 | quoted values | The Connect table lists seven GPIOs (17, 18, 27, 22, 5, 6, 13), copied from the Motor project | The picture and the code use three: GPIO27 (L293D 1A), GPIO17 (2A) and GPIO22 (enable), plus GPIO2 and GPIO3 for I2C | [Kit 3.1.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/3.1.1%20Adjustable%20Fan.html) | Misleading | code/netlist pin check (CODE_PIN_MISMATCH) | Fixed |
| adjustable-fan-3 | text | "turned Left of the midpoint … ROTATE in one direction … turned Right … the opposite" | Left and right depend on which end of the pot goes to 3V3. Readings below 128 turn the motor one way and readings above 128 the other, and the rebuilt text says that | [Kit 3.1.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/3.1.1%20Adjustable%20Fan.html) | Cosmetic | sim: "Knob at 10 % reads well below 128 (backward)"; "Knob at 90 % reads well above 128 (forward)" | Fixed |
| adjustable-fan-4 | placement | The 5 V and ground feeds run through the breadboard power rails, and the module sits on the rail strips | Leads run from the power module's 5 V and ground pins to the L293D strip and to a T-board GND strip, so the module's ground is the Pi ground and no rail is unpowered | [Kit 3.1.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/3.1.1%20Adjustable%20Fan.html) | Cosmetic | sim: "The L293D logic and motor supplies are 5 V from the power module and its ground is the Pi ground" | Fixed |

Generated wiring table and build steps:

<!-- generated:adjustable-fan -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A0 | module pin | N5 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A1 | module pin | N6 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A2 | module pin | N7 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A3 | module pin | N8 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A4 | module pin | N9 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A5 | module pin | N10 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A6 | module pin | N11 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A7 | module pin | N12 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | VCC | module pin | 3V3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | SDA | module pin | GPIO2 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | SCL | module pin | GPIO3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | GND | module pin | GND |
| R1 | Potentiometer 10 kΩ, rotary | End terminal 1 (pin 1) | row 28 column c | GND |
| R1 | Potentiometer 10 kΩ, rotary | Wiper (pin 2, centre) | row 30 column c | N5 |
| R1 | Potentiometer 10 kΩ, rotary | End terminal 2 (pin 3) | row 32 column c | 3V3 |
| U2 | L293D quadruple half-H driver (DIP-16) | 1,2EN | row 40 column e | GPIO22 |
| U2 | L293D quadruple half-H driver (DIP-16) | 1A | row 41 column e | GPIO27 |
| U2 | L293D quadruple half-H driver (DIP-16) | 1Y | row 42 column e | N2 |
| U2 | L293D quadruple half-H driver (DIP-16) | GND | row 43 column e | GND |
| U2 | L293D quadruple half-H driver (DIP-16) | GND | row 44 column e | GND |
| U2 | L293D quadruple half-H driver (DIP-16) | 2Y | row 45 column e | N1 |
| U2 | L293D quadruple half-H driver (DIP-16) | 2A | row 46 column e | GPIO17 |
| U2 | L293D quadruple half-H driver (DIP-16) | VCC2 | row 47 column e | N4 |
| U2 | L293D quadruple half-H driver (DIP-16) | 3,4EN | row 47 column f | N17 |
| U2 | L293D quadruple half-H driver (DIP-16) | 3A | row 46 column f | N13 |
| U2 | L293D quadruple half-H driver (DIP-16) | 3Y | row 45 column f | N14 |
| U2 | L293D quadruple half-H driver (DIP-16) | GND | row 44 column f | GND |
| U2 | L293D quadruple half-H driver (DIP-16) | GND | row 43 column f | GND |
| U2 | L293D quadruple half-H driver (DIP-16) | 4Y | row 42 column f | N15 |
| U2 | L293D quadruple half-H driver (DIP-16) | 4A | row 41 column f | N16 |
| U2 | L293D quadruple half-H driver (DIP-16) | VCC1 | row 40 column f | N4 |
| M1 | DC motor with fan blade (130 size) | Red lead | module pin | N2 |
| M1 | DC motor with fan blade (130 size) | Black lead | module pin | N1 |
| PS1 | MB102 breadboard power supply module (3.3 V / 5 V) | 3V3 (J6 pin 1) | module pin | N3 |
| PS1 | MB102 breadboard power supply module (3.3 V / 5 V) | GND (J6 pin 2) | module pin | GND |
| PS1 | MB102 breadboard power supply module (3.3 V / 5 V) | 3V3 (J6 pin 3) | module pin | N3 |
| PS1 | MB102 breadboard power supply module (3.3 V / 5 V) | GND (J6 pin 4) | module pin | GND |
| PS1 | MB102 breadboard power supply module (3.3 V / 5 V) | 5V (J6 pin 5) | module pin | N4 |
| PS1 | MB102 breadboard power supply module (3.3 V / 5 V) | GND (J6 pin 6) | module pin | GND |
| PS1 | MB102 breadboard power supply module (3.3 V / 5 V) | 5V (J6 pin 7) | module pin | N4 |
| PS1 | MB102 breadboard power supply module (3.3 V / 5 V) | GND (J6 pin 8) | module pin | GND |
| W1 | red male–male jumper | end a | row 1 column a | 3V3 |
| W1 | red male–male jumper | end b | row 32 column a | 3V3 |
| W2 | black male–male jumper | end a | row 3 column j | GND |
| W2 | black male–male jumper | end b | row 28 column a | GND |
| W3 | red male–female jumper | end a | row 1 column b | 3V3 |
| W3 | red male–female jumper | end b | U1's VCC pin | 3V3 |
| W4 | black male–female jumper | end a | row 5 column a | GND |
| W4 | black male–female jumper | end b | U1's GND pin | GND |
| W5 | blue male–female jumper | end a | row 2 column a | GPIO2 |
| W5 | blue male–female jumper | end b | U1's SDA pin | GPIO2 |
| W6 | yellow male–female jumper | end a | row 3 column a | GPIO3 |
| W6 | yellow male–female jumper | end b | U1's SCL pin | GPIO3 |
| W7 | green male–female jumper | end a | row 30 column a | N5 |
| W7 | green male–female jumper | end b | U1's A0 pin | N5 |
| W8 | blue male–male jumper | end a | row 8 column a | GPIO22 |
| W8 | blue male–male jumper | end b | row 40 column a | GPIO22 |
| W9 | orange male–male jumper | end a | row 7 column a | GPIO27 |
| W9 | orange male–male jumper | end b | row 41 column a | GPIO27 |
| W10 | yellow male–male jumper | end a | row 6 column a | GPIO17 |
| W10 | yellow male–male jumper | end b | row 46 column a | GPIO17 |
| W11 | green male–female jumper | end a | row 42 column a | N2 |
| W11 | green male–female jumper | end b | M1's Red lead pin | N2 |
| W12 | brown male–female jumper | end a | row 45 column a | N1 |
| W12 | brown male–female jumper | end b | M1's Black lead pin | N1 |
| W13 | black male–male jumper | end a | row 13 column a | GND |
| W13 | black male–male jumper | end b | row 43 column a | GND |
| W14 | red male–female jumper | end a | row 47 column b | N4 |
| W14 | red male–female jumper | end b | PS1's 5V (J6 pin 5) pin | N4 |
| W15 | red male–male jumper | end a | row 47 column c | N4 |
| W15 | red male–male jumper | end b | row 40 column j | N4 |
| W16 | black male–female jumper | end a | row 13 column b | GND |
| W16 | black male–female jumper | end b | PS1's GND (J6 pin 2) pin | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the Potentiometer 10 kΩ, rotary, with pin 1 (End terminal 1 (pin 1)) in row 28 column c and pin 3 (End terminal 2 (pin 3)) in row 32 column c.
3. Insert U2, the L293D quadruple half-H driver (DIP-16), across the trench with pin 1 (1,2EN) in row 40 column e and pin 16 (VCC1) in row 40 column f.
4. Place U1, the ADS7830 8-channel 8-bit ADC module (LAFVIN), beside the board; leads connect it in later steps.
5. Place M1, the DC motor with fan blade (130 size), beside the board; leads connect it in later steps.
6. Place PS1, the MB102 breadboard power supply module (3.3 V / 5 V), beside the board; leads connect it in later steps.
7. Use a red 20 cm male–male jumper (W1) from row 1 column a to row 32 column a.
8. Use a red 20 cm male–female jumper (W3) with its female end on U1's VCC pin and its male end in row 1 column b.
9. Use a blue 20 cm male–female jumper (W5) with its female end on U1's SDA pin and its male end in row 2 column a.
10. Use a yellow 20 cm male–female jumper (W6) with its female end on U1's SCL pin and its male end in row 3 column a.
11. Use a yellow 20 cm male–male jumper (W10) from row 6 column a to row 46 column a.
12. Use a orange 20 cm male–male jumper (W9) from row 7 column a to row 41 column a.
13. Use a blue 20 cm male–male jumper (W8) from row 8 column a to row 40 column a.
14. Use a green 20 cm male–female jumper (W7) with its female end on U1's A0 pin and its male end in row 30 column a.
15. Use a red 20 cm male–male jumper (W15) from row 47 column c to row 40 column j.
16. Use a green 20 cm male–female jumper (W11) with its female end on M1's Red lead pin and its male end in row 42 column a.
17. Use a brown 20 cm male–female jumper (W12) with its female end on M1's Black lead pin and its male end in row 45 column a.
18. Use a red 20 cm male–female jumper (W14) with its female end on PS1's 5V (J6 pin 5) pin and its male end in row 47 column b.
19. Use a black 20 cm male–male jumper (W2) from row 3 column j to row 28 column a.
20. Use a black 20 cm male–female jumper (W4) with its female end on U1's GND pin and its male end in row 5 column a.
21. Use a black 20 cm male–male jumper (W13) from row 13 column a to row 43 column a.
22. Use a black 20 cm male–female jumper (W16) with its female end on PS1's GND (J6 pin 2) pin and its male end in row 13 column b.
<!-- /generated:adjustable-fan -->
<!-- /section:adjustable-fan -->

<!-- section:lcd1602 -->
### LCD1602 (extra, not shipped; baseline `lcd-display`)

Sources: [TI PCF8574 datasheet](https://www.ti.com/lit/ds/symlink/pcf8574.pdf), [LCD-1602A datasheet](https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/5773/CN0295D%20other%20related%20document.pdf),
[HD44780U datasheet](https://www.sparkfun.com/datasheets/LCD/HD44780.pdf),
[Silicon Chip, El Cheapo Modules part 5](https://www.siliconchip.com.au/Issue/SC/2017/March/El+Cheapo+Modules%2C+Part+5%3A+LCD+module+with+I%C2%B2C),
Raspberry Pi GPIO documentation. No kit page: the Basic Starter Kit has no LCD.

**Not shipped.** A safe build needs an I2C level shifter between the 5 V backpack and the Pi (lcd1602-1). The kit has none, and the part library has no level-shifter part, so no LCD1602 tutorial ships until one exists. The baseline tutorial is retired with the rest of `data/tutorials.js`; nothing in the app shows its wiring.
The baseline's wiring text (GPIO2 pin 3, GPIO3 pin 5, 5V pin 2, GND pin 6), PCF8574 bit layout, start-up sequence, 0x27 or 0x3F address note, contrast tip and I2C setup steps were checked and are correct.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| lcd1602-1 | circuit | Powers the backpack from 5V (pin 2) and wires SDA and SCL straight to GPIO2 and GPIO3, with no warning | The LCD1602 needs 4.5 to 5.5 V, so it stays on 5 V. The backpack pulls SDA and SCL up to that supply through 4.7 kΩ; with the Pi's 1.8 kΩ pull-ups to 3.3 V the lines idle at about 3.8 V, above what the Pi's pins may see. Removing those resistors is not enough: the PCF8574's HIGH threshold of 0.7 × VCC (3.5 V at 5 V) is above a 3.3 V bus. The build needs a bidirectional I2C level shifter | [PCF8574 datasheet](https://www.ti.com/lit/ds/symlink/pcf8574.pdf); [LCD-1602A datasheet](https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/5773/CN0295D%20other%20related%20document.pdf); [Pi GPIO docs](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc) | Unsafe for hardware | `core/erc/erc-library.test.ts` (an LCD1602 on 5V pulling SDA up warns); the baseline tutorial is removed (8c6d465) | Fixed (the unsafe baseline is retired; no LCD tutorial until a level-shifter part exists) |
| lcd1602-2 | diagram | `wiringDiagram` draws no LCD (D7). Its four wires end on rows 22 to 25, which hold nothing | Every shipped tutorial's wiring is generated from a document with every part placed; this one is held back (lcd1602-1) | SPEC 16.2 D7 | Doesn't work | `content/tutorials/regressions.test.ts` "D7: …" | Fixed (the baseline diagram is retired) |
| lcd1602-3 | curriculum | Presented as a project of "SunFounder Basic Starter Kit - 18 Tutorial Projects" | The kit has no LCD; any LCD tutorial is an extra tagged "needs parts not in the kit" | SPEC 16.2 D13; `content/inventory.json` | Misleading | `content/tutorials/regressions.test.ts` "D13: …" | Fixed |

<!-- /section:lcd1602 -->

<!-- section:ultrasonic -->
### Ultrasonic Distance (`ultrasonic`, extra; baseline `ultrasonic`)

Sources: [Elecfreaks HC-SR04 datasheet](https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf), Yageo CFR (resistor), Raspberry Pi GPIO documentation.
No kit page: the Basic Starter Kit has no HC-SR04, so the tutorial is tagged "needs parts not in the kit".
The baseline's theory (40 kHz burst, 10 µs trigger, distance = time × speed ÷ 2, 343 m/s at 20 °C, ECHO at 5 V), its 2 to 400 cm range, its GPIO17 and GPIO18 and the 5 V supply were checked and are correct.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| ultrasonic-1 | diagram | D12: no HC-SR04 is drawn and the ECHO wire is missing. The 5V and TRIG wires end on rows 22 and 23, which connect to nothing | HC1 is a part in the document with four male–female leads: VCC to the 5V strip, TRIG to GPIO17, ECHO to the divider and GND to the GND strip. ECHO is the only route from the sensor to GPIO18 | SPEC 16.2 D12; [HC-SR04 datasheet](https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf) | Doesn't work | sim: "With ECHO at its 5 V high the divider output stays at or below 3.3 V" (the divider only sees 5 V if ECHO is wired) | Fixed |
| ultrasonic-2 | circuit | 1 kΩ over 2 kΩ, "~3.3V". The kit has no 2 kΩ resistor | 5 V × 2 kΩ ÷ 3 kΩ is 3.33 V, over 3.3 V, and a 5.25 V supply gives 3.5 V. R1 1 kΩ and R2 220 Ω in series over R3 and R4, two 1 kΩ in series, give 3.1 V at 5 V and use only kit resistors | SPEC 13.1; [HC-SR04 datasheet](https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf); [Pi GPIO docs](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc) | Misleading | sim: "With ECHO at its 5 V high the divider output stays at or below 3.3 V"; "A target at 100 cm keeps the echo HIGH past 3 ms" | Fixed |
| ultrasonic-3 | code | `pulse_start` is only set inside the loop that waits for ECHO to rise, so a call that starts with ECHO already HIGH raises `NameError` | The start time is taken after the wait, and ECHO is first waited LOW, so a leftover pulse is not measured | Baseline `data/tutorials.js` | Doesn't work | none until the code runs in the sim (M5, 5.2) | Fixed |
| ultrasonic-4 | curriculum | Presented as a project of "SunFounder Basic Starter Kit - 18 Tutorial Projects" | The kit has no HC-SR04 or 2 kΩ resistor. The tutorial is an extra and is tagged "needs parts not in the kit" | SPEC 16.2 D13; `content/inventory.json` | Misleading | cites its kit page, or is tagged as an extra | Fixed |

Generated wiring table and build steps:

<!-- generated:ultrasonic -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| HC1 | HC-SR04 ultrasonic ranging module | Vcc | module pin | 5V |
| HC1 | HC-SR04 ultrasonic ranging module | Trig | module pin | GPIO17 |
| HC1 | HC-SR04 ultrasonic ranging module | Echo | module pin | N1 |
| HC1 | HC-SR04 ultrasonic ranging module | Gnd | module pin | GND |
| R1 | 1 kΩ resistor (brown, black, red, gold) | Lead 1 | row 30 column b | N1 |
| R1 | 1 kΩ resistor (brown, black, red, gold) | Lead 2 | row 34 column b | N2 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 1 | row 34 column c | N2 |
| R2 | 220 Ω resistor (red, red, brown, gold) | Lead 2 | row 38 column c | GPIO18 |
| R3 | 1 kΩ resistor (brown, black, red, gold) | Lead 1 | row 38 column b | GPIO18 |
| R3 | 1 kΩ resistor (brown, black, red, gold) | Lead 2 | row 42 column b | N3 |
| R4 | 1 kΩ resistor (brown, black, red, gold) | Lead 1 | row 42 column c | N3 |
| R4 | 1 kΩ resistor (brown, black, red, gold) | Lead 2 | row 46 column c | GND |
| W1 | red male–female jumper | end a | row 1 column j | 5V |
| W1 | red male–female jumper | end b | HC1's Vcc pin | 5V |
| W2 | orange male–female jumper | end a | row 6 column a | GPIO17 |
| W2 | orange male–female jumper | end b | HC1's Trig pin | GPIO17 |
| W3 | yellow male–female jumper | end a | row 30 column a | N1 |
| W3 | yellow male–female jumper | end b | HC1's Echo pin | N1 |
| W4 | black male–female jumper | end a | row 5 column a | GND |
| W4 | black male–female jumper | end b | HC1's Gnd pin | GND |
| W5 | green male–male jumper | end a | row 6 column j | GPIO18 |
| W5 | green male–male jumper | end b | row 38 column a | GPIO18 |
| W6 | black male–male jumper | end a | row 3 column j | GND |
| W6 | black male–male jumper | end b | row 46 column a | GND |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Insert R1, the 1 kΩ resistor (brown, black, red, gold), from row 30 column b to row 34 column b.
3. Insert R2, the 220 Ω resistor (red, red, brown, gold), from row 34 column c to row 38 column c.
4. Insert R3, the 1 kΩ resistor (brown, black, red, gold), from row 38 column b to row 42 column b.
5. Insert R4, the 1 kΩ resistor (brown, black, red, gold), from row 42 column c to row 46 column c.
6. Place HC1, the HC-SR04 ultrasonic ranging module, beside the board; leads connect it in later steps.
7. Use a red 20 cm male–female jumper (W1) with its female end on HC1's Vcc pin and its male end in row 1 column j.
8. Use a orange 20 cm male–female jumper (W2) with its female end on HC1's Trig pin and its male end in row 6 column a.
9. Use a green 20 cm male–male jumper (W5) from row 6 column j to row 38 column a.
10. Use a yellow 20 cm male–female jumper (W3) with its female end on HC1's Echo pin and its male end in row 30 column a.
11. Use a black 20 cm male–male jumper (W6) from row 3 column j to row 46 column a.
12. Use a black 20 cm male–female jumper (W4) with its female end on HC1's Gnd pin and its male end in row 5 column a.
<!-- /generated:ultrasonic -->
<!-- /section:ultrasonic -->

<!-- section:keypad -->
### Keypad (`keypad`, extra; baseline `keypad`)

Sources: [protosupplies 4x4 membrane keypad](https://protosupplies.com/product/membrane-keypad-4x4-matrix/),
[SunFounder keypad component page](https://docs.sunfounder.com/projects/newton-lab-kit/en/latest/component/component_keypad.html),
Raspberry Pi GPIO documentation. No kit page: the Basic Starter Kit has no keypad, so the tutorial is tagged "needs parts not in the kit".
The baseline's scan method (raise a row, read the columns with pull-downs), key layout, GPIO numbers (rows 17, 18, 27, 22; columns 23, 24, 25, 5), debounce note and theory were checked and are correct.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| keypad-1 | diagram | D7: `wiringDiagram` draws no keypad. Its eight wires end on rows 22 to 25 in columns a and j, which hold nothing | KP1 is a part in the document with eight male–male leads, one from each GPIO strip into a keypad socket | SPEC 16.2 D7 | Doesn't work | placement check (`validateDoc`); sim: "Key 5 joins row 2 (GPIO18) to column 2 (GPIO24)" | Fixed |
| keypad-2 | leads | "Jumper Wires ×8", with no gender | The keypad's connector is eight female sockets, so each lead is male at both ends (SPEC 6.5) | [protosupplies](https://protosupplies.com/product/membrane-keypad-4x4-matrix/); SPEC 6.5 | Misleading | placement check (`validateDoc`) (a lead of the wrong gender is rejected) | Fixed |
| keypad-3 | quoted values | Lists "Row 1 … Col 4" against GPIOs but never says which socket is which | Sockets 1 to 4 are R1 to R4 and 5 to 8 are C1 to C4 (SunFounder's schematic labels the 8-pin header R1 R2 R3 R4 C1 C2 C3 C4 left to right). R1 to R4 go to GPIO17, 18, 27, 22 and C1 to C4 to GPIO23, 24, 25, 5 | [protosupplies](https://protosupplies.com/product/membrane-keypad-4x4-matrix/); SunFounder keypad schematic | Misleading | sim: "Key 5 joins row 2 (GPIO18) to column 2 (GPIO24)"; "Key A joins row 1 (GPIO17) to column 4 (GPIO5)"; "Key # joins row 4 (GPIO22) to column 3 (GPIO25)" | Fixed |
| keypad-4 | curriculum | Presented as a project of "SunFounder Basic Starter Kit - 18 Tutorial Projects" | The kit has no keypad. The tutorial is an extra and is tagged "needs parts not in the kit" | SPEC 16.2 D13; `content/inventory.json` | Misleading | cites its kit page, or is tagged as an extra | Fixed |

Generated wiring table and build steps:

<!-- generated:keypad -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| KP1 | 4x4 membrane matrix keypad (8-pin female connector) | R1 | module pin | GPIO17 |
| KP1 | 4x4 membrane matrix keypad (8-pin female connector) | R2 | module pin | GPIO18 |
| KP1 | 4x4 membrane matrix keypad (8-pin female connector) | R3 | module pin | GPIO27 |
| KP1 | 4x4 membrane matrix keypad (8-pin female connector) | R4 | module pin | GPIO22 |
| KP1 | 4x4 membrane matrix keypad (8-pin female connector) | C1 | module pin | GPIO23 |
| KP1 | 4x4 membrane matrix keypad (8-pin female connector) | C2 | module pin | GPIO24 |
| KP1 | 4x4 membrane matrix keypad (8-pin female connector) | C3 | module pin | GPIO25 |
| KP1 | 4x4 membrane matrix keypad (8-pin female connector) | C4 | module pin | GPIO5 |
| W1 | red male–male jumper | end a | row 6 column a | GPIO17 |
| W1 | red male–male jumper | end b | KP1's R1 pin | GPIO17 |
| W2 | orange male–male jumper | end a | row 6 column j | GPIO18 |
| W2 | orange male–male jumper | end b | KP1's R2 pin | GPIO18 |
| W3 | yellow male–male jumper | end a | row 7 column a | GPIO27 |
| W3 | yellow male–male jumper | end b | KP1's R3 pin | GPIO27 |
| W4 | green male–male jumper | end a | row 8 column a | GPIO22 |
| W4 | green male–male jumper | end b | KP1's R4 pin | GPIO22 |
| W5 | blue male–male jumper | end a | row 8 column j | GPIO23 |
| W5 | blue male–male jumper | end b | KP1's C1 pin | GPIO23 |
| W6 | violet male–male jumper | end a | row 9 column j | GPIO24 |
| W6 | violet male–male jumper | end b | KP1's C2 pin | GPIO24 |
| W7 | grey male–male jumper | end a | row 11 column j | GPIO25 |
| W7 | grey male–male jumper | end b | KP1's C3 pin | GPIO25 |
| W8 | white male–male jumper | end a | row 15 column a | GPIO5 |
| W8 | white male–male jumper | end b | KP1's C4 pin | GPIO5 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Place KP1, the 4x4 membrane matrix keypad (8-pin female connector), beside the board; leads connect it in later steps.
3. Use a red 20 cm male–male jumper (W1) from row 6 column a to KP1's R1 pin.
4. Use a orange 20 cm male–male jumper (W2) from row 6 column j to KP1's R2 pin.
5. Use a yellow 20 cm male–male jumper (W3) from row 7 column a to KP1's R3 pin.
6. Use a green 20 cm male–male jumper (W4) from row 8 column a to KP1's R4 pin.
7. Use a blue 20 cm male–male jumper (W5) from row 8 column j to KP1's C1 pin.
8. Use a violet 20 cm male–male jumper (W6) from row 9 column j to KP1's C2 pin.
9. Use a grey 20 cm male–male jumper (W7) from row 11 column j to KP1's C3 pin.
10. Use a white 20 cm male–male jumper (W8) from row 15 column a to KP1's C4 pin.
<!-- /generated:keypad -->
<!-- /section:keypad -->

<!-- section:joystick -->
### Joystick (`joystick`, extra; baseline `joystick`)

Sources: [TI ADS7830 datasheet](https://www.ti.com/lit/ds/symlink/ads7830.pdf), [TI ADS1115 datasheet](https://www.ti.com/lit/ds/symlink/ads1115.pdf) (the baseline's ADC),
[SunFounder joystick component page](https://docs.sunfounder.com/projects/umsk/en/latest/01_components_basic/09-component_joystick.html),
[Joy-IT KY-023 datasheet](https://asset.conrad.com/media10/add/160267/c1/-/en/001707629DS01/datasheet-1707629-joy-it-ky023jm-1-pcs-compatible-with-development-kits-raspberry-pi-pcduino-banana-pi-arduino.pdf),
Raspberry Pi GPIO documentation. No kit page: the Basic Starter Kit has no joystick, so the tutorial is tagged "needs parts not in the kit".
The baseline's wiring text (3V3 and GND shared, VRx to A0, VRy to A1, SW to GPIO17), 0x48 address, pull-up on SW and pointer-register I2C calls were checked and are correct.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| joystick-1 | code | The ADS1115 config word is 0x4383: no OS bit (0x8000). In single-shot mode that bit starts a conversion, so no conversion ever starts and every read returns the last result, 0 at power-up | The rebuilt tutorial uses the kit's ADS7830, whose conversion starts with each read of the command byte | [TI ADS1115 datasheet](https://www.ti.com/lit/ds/symlink/ads1115.pdf), Config register bit 15 | Doesn't work | sim: "X at 0 % reads 0 on A0"; "X at 100 % reads 255 on A0"; "Y at 0 % reads 0 on A1"; "Y at 100 % reads 255 on A1" | Fixed |
| joystick-2 | quoted values | "Map to -100 to +100 range", but the code gives 0 to 100 from value ÷ 32767. At 3.3 V and a ±4.096 V range the reading peaks near 26 400, so it only reaches about 80 % | With the ADS7830 a centred stick reads about 128 and the ends read near 0 and 255; directions use a dead zone around 128 | [TI ADS1115 datasheet](https://www.ti.com/lit/ds/symlink/ads1115.pdf); [TI SBAS302C](https://www.ti.com/lit/ds/symlink/ads7830.pdf) | Misleading | sim: "X at 50 % reads about the centre on A0" | Fixed |
| joystick-3 | circuit | Uses an ADS1115 module, which is not in the kit | The kit's ADC is the ADS7830 module (ADR-0011), on the same bus at 0x48. The joystick and the module both run from 3V3, so the axes cannot exceed 3.3 V | ADR-0011; `content/inventory.json`; [SunFounder joystick page](https://docs.sunfounder.com/projects/umsk/en/latest/01_components_basic/09-component_joystick.html) | Misleading | sim: "The joystick and the ADS7830 module run from 3.3 V" | Fixed |
| joystick-4 | diagram | D7: `wiringDiagram` draws no joystick and no ADC. Its five wires end on rows 22 to 26 and nothing connects VRx, VRy or the ADC | U1 and J1 are parts in the document. VRX and VRY reach A0 and A1 through breadboard rows, and SW reaches GPIO17 by its own lead | SPEC 16.2 D7 | Doesn't work | placement check (`validateDoc`); sim: "X at 0 % reads 0 on A0"; "Y at 100 % reads 255 on A1"; "Pressing the button pulls GPIO17 LOW" | Fixed |
| joystick-5 | curriculum | Presented as a project of "SunFounder Basic Starter Kit - 18 Tutorial Projects" | The kit has no joystick. The tutorial is an extra and is tagged "needs parts not in the kit" | SPEC 16.2 D13; `content/inventory.json` | Misleading | cites its kit page, or is tagged as an extra | Fixed |

Generated wiring table and build steps:

<!-- generated:joystick -->
| Ref | Part | Pin | Hole | Net |
|-----|------|-----|------|-----|
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A0 | module pin | N1 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A1 | module pin | N2 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A2 | module pin | N3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A3 | module pin | N4 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A4 | module pin | N5 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A5 | module pin | N6 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A6 | module pin | N7 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | A7 | module pin | N8 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | VCC | module pin | 3V3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | SDA | module pin | GPIO2 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | SCL | module pin | GPIO3 |
| U1 | ADS7830 8-channel 8-bit ADC module (LAFVIN) | GND | module pin | GND |
| J1 | Dual-axis analog joystick module (5-pin) | GND | module pin | GND |
| J1 | Dual-axis analog joystick module (5-pin) | +5V | module pin | 3V3 |
| J1 | Dual-axis analog joystick module (5-pin) | VRX | module pin | N1 |
| J1 | Dual-axis analog joystick module (5-pin) | VRY | module pin | N2 |
| J1 | Dual-axis analog joystick module (5-pin) | SW | module pin | GPIO17 |
| W1 | red male–female jumper | end a | row 1 column a | 3V3 |
| W1 | red male–female jumper | end b | U1's VCC pin | 3V3 |
| W2 | red male–female jumper | end a | row 1 column b | 3V3 |
| W2 | red male–female jumper | end b | J1's +5V pin | 3V3 |
| W3 | black male–female jumper | end a | row 5 column a | GND |
| W3 | black male–female jumper | end b | U1's GND pin | GND |
| W4 | black male–female jumper | end a | row 5 column b | GND |
| W4 | black male–female jumper | end b | J1's GND pin | GND |
| W5 | blue male–female jumper | end a | row 2 column a | GPIO2 |
| W5 | blue male–female jumper | end b | U1's SDA pin | GPIO2 |
| W6 | yellow male–female jumper | end a | row 3 column a | GPIO3 |
| W6 | yellow male–female jumper | end b | U1's SCL pin | GPIO3 |
| W7 | green male–female jumper | end a | row 30 column a | N1 |
| W7 | green male–female jumper | end b | J1's VRX pin | N1 |
| W8 | green male–female jumper | end a | row 30 column b | N1 |
| W8 | green male–female jumper | end b | U1's A0 pin | N1 |
| W9 | violet male–female jumper | end a | row 32 column a | N2 |
| W9 | violet male–female jumper | end b | J1's VRY pin | N2 |
| W10 | violet male–female jumper | end a | row 32 column b | N2 |
| W10 | violet male–female jumper | end b | U1's A1 pin | N2 |
| W11 | orange male–female jumper | end a | row 6 column a | GPIO17 |
| W11 | orange male–female jumper | end b | J1's SW pin | GPIO17 |

1. Plug the ribbon into the Pi's 40-pin header and into the T-board, then seat the T-board with pin 1 (3V3) in row 1, its two pin rows in columns d and h, header toward row 0.
2. Place U1, the ADS7830 8-channel 8-bit ADC module (LAFVIN), beside the board; leads connect it in later steps.
3. Place J1, the Dual-axis analog joystick module (5-pin), beside the board; leads connect it in later steps.
4. Use a red 20 cm male–female jumper (W1) with its female end on U1's VCC pin and its male end in row 1 column a.
5. Use a red 20 cm male–female jumper (W2) with its female end on J1's +5V pin and its male end in row 1 column b.
6. Use a blue 20 cm male–female jumper (W5) with its female end on U1's SDA pin and its male end in row 2 column a.
7. Use a yellow 20 cm male–female jumper (W6) with its female end on U1's SCL pin and its male end in row 3 column a.
8. Use a orange 20 cm male–female jumper (W11) with its female end on J1's SW pin and its male end in row 6 column a.
9. Use a green 20 cm male–female jumper (W7) with its female end on J1's VRX pin and its male end in row 30 column a.
10. Use a green 20 cm male–female jumper (W8) with its female end on U1's A0 pin and its male end in row 30 column b.
11. Use a violet 20 cm male–female jumper (W9) with its female end on J1's VRY pin and its male end in row 32 column a.
12. Use a violet 20 cm male–female jumper (W10) with its female end on U1's A1 pin and its male end in row 32 column b.
13. Use a black 20 cm male–female jumper (W3) with its female end on U1's GND pin and its male end in row 5 column a.
14. Use a black 20 cm male–female jumper (W4) with its female end on J1's GND pin and its male end in row 5 column b.
<!-- /generated:joystick -->
<!-- /section:joystick -->

## Other baseline items

<!-- section:pins -->
### Pin data (data/pins.js and the Pinout page)

Sources: Raspberry Pi documentation at commit 1bf32ac, [GPIO page](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc) ("Pin names, types, and typical functions", "Pin types", "Voltage specifications"; `content/controllers/pi5-header.json` is generated from its table by `scripts/reference/pi_header_from_docs.py`), [power supplies](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/power-supplies.adoc) (GPIO current figures), [interfaces](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/configuration/interfaces.adoc) ("Primary and secondary UARTs"); alternate functions from the [RP1 peripherals datasheet](https://pip-assets.raspberrypi.com/categories/892-raspberry-pi-5/documents/RP-008370-DS-1-rp1-peripherals.pdf) Table 4 "GPIO function" (a watermarked DRAFT dated 7 Nov 2023), cross-checked against the [Compute Module 5 datasheet](https://pip.raspberrypi.com/documents/RP-008180-DS) Table 1 (RP-008180-DS, the document the GPIO page points to for Pi 5 alternate functions; also states "SIO0 is the MOSI pin ... SIO1 is the MISO pin"); WiringPi numbers from [wiringPi.c](https://github.com/WiringPi/WiringPi/blob/31f49ecdf7865c10483a91994aa51f73a7c656aa/wiringPi/wiringPi.c) (`pinToGpioR2`; WiringPi's numbering is a library convention, not a hardware fact); ADR-0014 in `docs/v2/DECISIONS.md`.

Guarded by: the tests in `src/renderer/src/data/pins.test.ts`, named by the first words of their titles.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| pins-1 | Physical numbers 1–40 and BCM numbers (28 GPIOs, GPIO0–27) | 40 pins; every BCM number as the docs | Same: the 28 BCM numbers, and none on power or ground pins | GPIO page "Pin names, types, and typical functions" (`content/controllers/pi5-header.json`) | None | pins.test "models the 40 header pins", "agrees with pi5-header.json" | Correct |
| pins-2 | Display names | `GPIOn`, `3V3`, `5V`, `GND`, `ID_SD`, `ID_SC` | The docs write `GPn` and name pins 27 and 28 `GP0` and `GP1` with the function "I2C (ID_SD)". The `GPIO` prefix and the HAT names stay: `breadboardCoords.js` resolves wires by pin name | GPIO page pin table; `components/breadboardCoords.js` | None | pins.test "agrees with pi5-header.json" (the name rule is in the test) | Correct |
| pins-3 | Supply and ground pins: 3V3 on 1 and 17, 5V on 2 and 4, GND on 6, 9, 14, 20, 25, 30, 34, 39 | Same pins, same types | Same; the docs count Power 4 (3V3 ×2, 5V ×2), Ground 8, GPIO 26, ID EEPROM 2 | GPIO page "Pin types" | None | pins.test "has the official pin counts" | Correct |
| pins-4 | WiringPi numbers, all 28 GPIO pins (pin 3 → 8 … pin 40 → 29; pins 27, 28 → 30, 31) | As WiringPi's table | Same. `wiringPiSetup` selects `pinToGpioR2` on every board except the first Pi 1 revisions, the Pi 5 included. WiringPi 17–20 (BCM 28–31) are the old Pi P5 connector, not on this header | wiringPi.c `pinToGpioR2`, `wiringPiSetup` | None | pins.test "numbers the WiringPi column" | Correct |
| pins-5 | 3V3 current (pin 1) | "3.3V power supply. Max 500mA shared across all 3.3V pins." | "3.3 V power output to attached peripherals." The docs give no limit for the 3V3 pins (ADR-0014). The 500 mA figures in the docs' power table are the USB peripheral limit and the bare-board consumption of older models, so the number has no source | power-supplies.adoc "Typical power requirements"; ADR-0014 | Misleading | pins.test "quotes in a description no current, voltage or resistance the official docs do not give", "states no 3V3 current limit" | Fixed |
| pins-6 | 5V pins (2, 4) | "5V power supply directly from USB-C input." | "5 V power: an output to peripherals, or an input that powers the Raspberry Pi (for example through a PoE+ HAT or third-party HAT)." The docs do not say the pins come directly from USB-C, and the baseline left out that they accept power | GPIO page pin table, pins 2 and 4 | Misleading | pins.test "makes no claim the docs contradict about the 5V pins or the serial console" | Fixed |
| pins-7 | Ground pins | "Ground reference. All ground pins are connected internally." | "Ground (0 V). Completes an electrical circuit connected to power." The sentence about internal connection is not in the docs and was dropped | GPIO page "Pin types" (Ground, 0 V) and pin table | Cosmetic | None: a dropped sentence | Fixed |
| pins-8 | I2C pins 3 and 5 | "I2C1 Data/Clock. Has 1.8kΩ pull-up to 3.3V. Used for HATs, sensors, displays." | The 1.8 kΩ on-board pull-up to 3.3 V is as the docs say, and RP1 puts I2C1_SDA and I2C1_SCL on GPIO2 and GPIO3 (a3). "Used for HATs" was loose: HATs identify themselves over pins 27 and 28 (I2C0). Reworded to the docs and the datasheet | GPIO page "Inputs" and pin table; RP1 Table 4 | Cosmetic | pins.test "quotes in a description no current ..." | Fixed |
| pins-9 | GPIO4 (pin 7) | "Default: GPCLK0 (general purpose clock)." | GPCLK[0] is function a0, an alternate function. After a power-on reset GPIOs are generally inputs, so GPCLK0 is not a default | GPIO page "Power-on states"; RP1 Table 4 | Misleading | pins.test "lists, for each GPIO, the RP1 datasheet functions" | Fixed |
| pins-10 | GPIO14 and GPIO15 (pins 8, 10) | "UART0 Transmit/Receive. Serial console output/input by default (disable in raspi-config)." | UART0_TX and UART0_RX (RP1 a4) is right. On a Pi 5 UART0 is disabled by default, and the primary UART (the Linux serial console) is the dedicated debug header (UART10), not GPIO14 and GPIO15 | interfaces.adoc "UART by Raspberry Pi model", "Primary and secondary UARTs"; RP1 Table 4 | Misleading | pins.test "makes no claim the docs contradict about the 5V pins or the serial console" | Fixed |
| pins-11 | GPIO18 and GPIO19 (pins 12, 35) PWM | GPIO18 "PCM Clock / PWM0 Channel 0. Hardware PWM capable.", alt `PWM0_0`; GPIO19 alt `PWM0_1` | On RP1 GPIO18 a3 is PWM0[2] and GPIO19 a3 is PWM0[3]. PWM0[0] and PWM0[1] are on GPIO12 and GPIO13 (a0). The baseline used the BCM283x channel numbers. The docs' typical function for GPIO18 is "PCM clock or SPI chip enable (CE0)" | RP1 Table 4; CM5 datasheet Table 1; GPIO page pin 12 and 35 | Misleading | pins.test "lists, for each GPIO, the RP1 datasheet functions" | Fixed |
| pins-12 | "SMI …" alternate functions | 24 pins list an SMI function (3, 5, 7, 8, 10, 11, 12, 15, 16, 18, 19, 21, 22, 23, 24, 26, 29, 31, 32, 33, 35, 36, 38, 40) | None. SMI (Secondary Memory Interface) is a BCM283x peripheral; neither the RP1 datasheet nor the CM5 function table mentions it, and no RP1 GPIO row has an SMI function | RP1 Table 4 (no SMI in the document); CM5 datasheet Table 1 | Misleading | pins.test "lists, for each GPIO, the RP1 datasheet functions and no BCM283x-only function" (asserts no SMI) | Fixed |
| pins-13 | Other non-RP1 names | `FL0`, `FL1` (GPIO16, 17), `TE0`, `TE1` (GPIO26, 27); `PCM_CLK`, `PCM_FS`, `PCM_DIN`, `PCM_DOUT`; `SD0_*`; `GPCLKn`; `SPI0_MOSI`, `SPI0_MISO`, `SPI0_CE0`, `SPI0_CE1`; `TXD0`, `RXD0`; `SDA1`, `SCL1` | FL0, FL1, TE0, TE1 are in no RP1 row. The rest are RP1 functions under BCM283x names: I2S0_SCLK, I2S0_WS, I2S0_SDI[0], I2S0_SDO[0]; SDIO0_*; GPCLK[n]; SPI0_SIO[0], SPI0_SIO[1], SPI0_CSn[0], SPI0_CSn[1]; UART0_TX, UART0_RX; I2C1_SDA, I2C1_SCL. pins.js now uses the datasheet's names | RP1 Table 4 | Misleading | pins.test "lists, for each GPIO, the RP1 datasheet functions" | Fixed |
| pins-14 | Completeness of the alternate-function lists | 1–3 entries per GPIO | Every named function a0–a4 and a8 (4–6 per GPIO: UARTn, I2Cn, SPIn, DPI, I2S, PWM, SDIO, audio). a5–a7 (SYS_RIO, PROC_RIO, PIO) are on every GPIO and are not listed; the comment in pins.js says so | RP1 Table 4 | Cosmetic | pins.test "lists, for each GPIO, the RP1 datasheet functions" | Fixed |
| pins-15 | Cells where the two datasheets disagree | n/a | GPIO16 and GPIO17 a2: MIPI0_DSI_TE and MIPI1_DSI_TE appear only in the RP1 draft. GPIO9 and GPIO10 a8: SPI4_SIO[0] and SPI4_SIO[1] in the RP1 draft, SPI4_MISO and SPI4_MOSI in the CM5 datasheet. pins.js lists none of the four until a source settles them; the RP1 PDF is a draft | RP1 Table 4; CM5 datasheet Table 1 | Cosmetic | pins.test "lists, for each GPIO ..." (the DISPUTED set: none of the four cells is shown) | Fixed (the disputed cells are left out until a final RP1 datasheet settles them) |
| pins-16 | ID_SD and ID_SC (pins 27, 28; BCM 0, 1; WiringPi 30, 31) | "HAT EEPROM I2C Data/Clock. Reserved for HAT identification. Do not use for general I/O." | As the docs: "I2C (ID_SD); used to identify a HAT", "Reserved for use with Hardware Attached on Top (HAT) boards". RP1 GPIO0 and GPIO1 a3 are I2C0_SDA and I2C0_SCL. Wording kept, close to the docs | GPIO page "Pin types" and pin table; RP1 Table 4 | None | pins.test "has the official pin counts" (the two eeprom pins), "agrees with pi5-header.json" | Correct |
| pins-17 | SPI0 pins 19, 21, 23, 24, 26 | MOSI, MISO, SCLK, CE0, CE1 on GPIO10, 9, 11, 8, 7 | Same. RP1 a0: SPI0_SIO[0] (MOSI), SPI0_SIO[1] (MISO), SPI0_SCLK, SPI0_CSn[0], SPI0_CSn[1] | GPIO page pin table; CM5 datasheet "SIO0 is the MOSI pin ... SIO1 is the MISO pin" | None | pins.test "lists, for each GPIO ..." | Correct |
| pins-18 | Colour category of GPIO17 (pin 11) and GPIO16 (pin 36) | `gpio`, with "Commonly used for LEDs and buttons in tutorials" on GPIO17 | `spi`: the docs' typical functions are "SPI chip enable (CE1)" and "SPI chip enable (CE2)" (RP1 a0: SPI1_CSn[1], SPI1_CSn[2]). The category follows the first protocol the typical function names; both pins remain usable as plain GPIOs | GPIO page pins 11 and 36; RP1 Table 4 | Cosmetic | pins.test "gives each pin the colour category its official type and typical function imply" | Fixed |
| pins-19 | Other GPIO descriptions (PWM on 32, 33; PCM on 38, 40; plain GPIO on 13, 15, 16, 18, 22, 29, 31, 37) | "General purpose GPIO.", "PCM Data In/Out", "Alternate: PWM0 Channel 0/1" | Consistent with the docs (PWM0 and PWM1 outputs, PCM_DIN, PCM_DOUT, no typical function for the rest); reworded to RP1 names (PWM0[0], PWM0[1]) | GPIO page pin table; RP1 Table 4 | None | pins.test "lists, for each GPIO ..." | Correct |
| pins-20 | Pinout page components `GpioHeader.jsx`, `GpioPin.jsx`, `PinDetail.jsx`, `PinoutPage.jsx` | Row i holds pins 2i+1 (left) and 2i+2 (right); chips show the BCM number or the supply name; the drawer shows physical, BCM, WiringPi, description, alt functions, live value, direction and pull; search by name, BCM and physical number; filter by type | The layout and numbering agree with the docs' two-row header. The page claims no board orientation. No electrical fact is hard-coded in these four files: they read `data/pins.js` and the live pin store. The drawer shows no "current function" (see readme-13) | GPIO page "Pin layout"; the four files | None | pins.test (the data they render) | Correct |
<!-- /section:pins -->

<!-- section:depictions -->
### Component and module depictions

Sources: the baseline drawing code (`components/WiringOverlay.jsx`, `TCobbler.jsx`, `Breadboard.jsx`, `breadboardCoords.js`, unchanged at 52639d9 apart from one unused constant) against the v2 definitions, each of which cites its datasheet: `content/boards/bb-830.board.json` ([BB830 datasheet](https://datasheet.octopart.com/BB830T-BusBoard-datasheet-10603672.pdf)), `content/controllers/tboard.json` ([SunFounder GPIO Extension Board](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/preparation/GPIO_Extension_Board.html), calibrated photos, ADR-0004), `content/parts/*.part.json`, `content/leads/dupont.json`, and SPEC 6.5 (wiring convention). Known defects D1–D5 and D8 are in SPEC 16.2. The four files are replaced, not patched (SPEC 17), so every status is "Replaced" and the right-hand fact now lives in the named v2 file.

The overlay draws six component types (`led`, `resistor`, `button`, `switch`, `buzzer`, `sensor`), one jumper glyph and the T-board. For each: pinout and pin order, polarity, supply voltage, required driver or divider, and lead gender. The overlay has no model of supply voltage, driver, divider or gender at all; where a row says "not shown", the v2 guard is an ERC rule or a part-definition test, named in the last column.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| depictions-1 | Breadboard length (D1) | `NUM_ROWS = 30`, so with the T-board on rows 1–20 only 10 rows are free | 63 rows (630 circuit holes plus 200 rail holes); with the T-board 40 rows are free | BB830 datasheet p.2; `content/boards/bb-830.board.json` | Doesn't work | `core/regressions.test.ts` "D1: the board has 63 rows ..."; `core/geometry/breadboard.test.ts` "has 63 rows (D1: the baseline drew 30)" | Replaced |
| depictions-2 | Columns and strips | Columns a–e and f–j, five holes joined per row and strip | Same: each row is two five-hole strips | BB830 datasheet p.2 | None | `core/geometry/breadboard.test.ts` "groups each row into two five-hole strips" | Replaced |
| depictions-3 | Trench between e and f | `CENTER_GAP = 30` px beside a 24 px pitch, so e to f is 2.25 pitches | 3 pitches (0.3 in), so a 0.3 in DIP straddles it | SPEC 6.1; `bb-830.board.json` (trenchPitches 3) | Misleading | `core/geometry/breadboard.test.ts` "spaces rows and columns on the 2.54 mm pitch with a 3-pitch trench between e and f" | Replaced |
| depictions-4 | Power rails (D3, D4) | Four 30-hole strips, evenly spaced and not grouped, drawn outside the rotated group; `resolveCoord('power:…')` lands at x = 65 or 845 against a rail span of 90–806, and at y = 160 or 300 in the tie-point field. No tutorial used a rail | Four 50-hole rails in groups of five in line with rows 3–7, 9–13 … 57–61, on the board body, in the same frame as the rows | BB830 datasheet p.1 (200 rail tie points) and p.2; SPEC 16.2 D3 and D4 | Doesn't work | `core/regressions.test.ts` "D3: every rail hole is on the board body ...", "D4: rails and the circuit area share one coordinate frame ..."; `breadboard.test.ts` "makes each rail one 50-hole strip ...", "puts rail holes in groups of five ..." | Replaced |
| depictions-5 | Rail polarity legend | Top (j side): + outer, − inner. Bottom (a side): + inner, − outer | The bench legend is the opposite on both sides: j side + inner, − outer; a side + outer, − inner (reference photos 3 and 4) | `bb-830.board.json` provenance "rails.polarity" | Misleading | `core/geometry/breadboard.test.ts` "reads the legend as the photos show: top + inner, bottom + outer" | Replaced |
| depictions-6 | T-board pin positions (D2) | Odd pins drawn between columns d and e, even pins between f and g: pin rows 3.25 pitches apart and no pin in a hole (GPIO17 at x = 154 between d = 142 and e = 166) | Pin rows are 6 pitches apart (15.27 mm measured, 6.013 pitch); on the bench the pins sit in columns d (odd) and h (even), each in a hole | `content/controllers/tboard.json` (ADR-0004, calibrated photo); SPEC 16.2 D2 | Doesn't work | `core/regressions.test.ts` "D2: every T-board pin is in a hole ..."; `core/geometry/tboard.test.ts` "allows only column pairs exactly 6 pitches apart ...", "lands every pin in a real hole (D2 ...)" | Replaced |
| depictions-7 | T-board pin order and identity | Pin 2r−1 left and pin 2r right in row r, pin 1 in row 1, rows 1–20 | Same: pin n joins header pin n through the straight-through ribbon; pin 1 is in row 1 | `tboard.json` (pins, provenance "pins") | None | `core/geometry/tboard.test.ts` "puts the bench placement on d/h: odd pins in d, even pins in h, pin 1 at row 1", "has the same name at both ends of every straight-through conductor" | Replaced |
| depictions-8 | T-board body | A rectangle over columns d–g, rows 1–20, so holes beside and below it looked free | The stem covers e, f and g in rows 1–20 (leaving a, b, c, i, j usable) and d to h in rows 21–23, where it runs past pin 39; rows 24–63 are free. A part in a covered hole cannot seat (blinking-led-1) | `tboard.json` (outline.stem, ADR-0004) | Doesn't work | `core/geometry/tboard.test.ts` "covers e, f and g under the stem in rows 1-20 ...", "covers d to h in rows 21-23 ...", "leaves rows 24-63 fully free: 40 rows" | Replaced |
| depictions-9 | T-board name and pin labels | Titled "T-Cobbler Plus"; labels are the header names cut to 6 characters (GPIO2, GPIO10) | The bench board is the SunFounder GPIO Extension Board (T-board). Its silk labels differ from the header names: SDA1, SCL1, TXD0, RXD0, SPIMOSI, SPIMISO, SPISCLK, SPICE0, SPICE1, 5V0 | `tboard.json` pins[].label | Cosmetic | `core/geometry/tboard.test.ts` "matches the alternate functions the official table gives for the named pins" | Replaced |
| depictions-10 | Supply names collapse onto one pin | `resolveCoord('cobbler:GND')` returns the last GND (pin 39), `3V3` pin 17, `5V` pin 4, whatever pin the tutorial text names | Same net, so electrically equal, but the lead goes to the strip of the pin named. Eight GND pins, two 3V3, two 5V are separate strips on one net each | `components/breadboardCoords.js` (`_cobblerLookup`); `tboard.json` | Cosmetic | `core/geometry/tboard.test.ts` "names the shared supply nets: 8 GND pins, two 3V3, two 5V" | Replaced |
| depictions-11 | LED glyph (`led`) | Two dots in adjacent rows of one column, a triangle and a bar; anode on `row`, cathode on `endRow`; colour from the tutorial. No long lead, flat side or dome; no series resistor; no supply | Pinout A and K, one pitch apart (leads 2.54 mm apart), polarity by the longer lead and the flat side, forward voltage and current from the Kingbright sheets; the polarity depends on each build (blinking-led-2). The kit LED needs a series resistor | `content/parts/led.part.json` (Kingbright WP7113ID) | Cosmetic | `batch-passives-leds.test.ts` "has anode first and cathode second on a 1-pitch minimum span"; ERC `LED_NO_LIMIT`, `LED_REVERSED` in `core/erc/erc.test.ts` | Replaced |
| depictions-12 | Resistor glyph (`resistor`) | A zigzag between adjacent rows (`endRow` defaults to `row + 1`) with the value as text; no bands | An axial resistor, body 6.3 × 2.4 mm, leads 1 to 16 pitches apart (an upright mount at 1); value shown as colour bands (220 Ω: red, red, brown, gold). It is non-polar | `content/parts/resistor.part.json` (Yageo CFR-25) | Misleading | `batch-passives-leds.test.ts` "has two interchangeable leads and spans an upright mount up to the lead reach", "takes the body from the CFR-25 dimensions table"; `core/steps/steps.test.ts` (bands for 220 Ω, 1 kΩ, 10 kΩ, 4.7 kΩ 1 %) | Replaced |
| depictions-13 | Button and switch glyph (`button`, `switch`; D5, D9) | One point at (row, col) with a rectangle and two dots 11 px to its left and right, between holes. `switch` uses the same glyph. Both dots are in one row, which is the always-joined pair of a real switch. | A 6 mm tact switch has four terminals: pairs 6.5 mm apart (across the trench) are joined, and the 4.5 mm axis runs along the rows; it straddles the trench (3 pitches across, 2 along). A slide or tilt switch is a different part | `content/parts/tact-switch-6mm.part.json` (Omron B3F, drawing B3F-1000); SPEC 16.2 D5 | Doesn't work | `batch-switches-transistors.test.ts` "numbers its four terminals 1 to 4 ...", "joins 1-2 and 3-4 internally ...", "lands each joined pair in a single row, one terminal on each side of the trench" | Replaced |
| depictions-14 | Buzzer glyph (`buzzer`; D5, D8) | A circle with one connection point; no polarity; no driver; the baseline buzzer tutorial drove it straight from GPIO17 | Two leads 7.6 mm (3 pitches) apart, + on the longer lead; rated 5 V (4–8 V), at most 30 mA on the closest datasheet (the kit unit's own current is not confirmed). A GPIO is documented to 16 mA, so the kit's lesson switches the buzzer with an NPN transistor and a base resistor (SPEC 16.2 D8). An active buzzer is a switched load, not a signal pin | `content/parts/active-buzzer.part.json` (Huawha TMB12A05 approval sheet); GPIO page "Outputs" (16 mA); [kit 1.2.1](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/1.2.1%20Active%20Buzzer.html) | Unsafe for hardware | ERC `INDUCTIVE_NO_DRIVER` ("a buzzer driven straight from a GPIO"), `BJT_NO_BASE_RESISTOR` in `core/erc/erc.test.ts`; `batch-switches-transistors.test.ts` "seats the active buzzer 3 pitches apart ...", "takes rated 5 V, 4 to 8 V, at most 30 mA ..." | Replaced |
| depictions-15 | Sensor glyph (`sensor`, used only by the DHT11) | A blue block with three dots in rows `row` to `row + 2` of one column; no pin names, no order, no supply | The kit part is the 3-pin DHT11 module: pins S (data), VCC, − in that printed order on male header pins, 3.3–5.5 V, with a 10 kΩ pull-up on the board. It sits off the breadboard and takes male–female leads | `content/parts/dht11-module.part.json` ([kit 2.2.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.2.3%20DHT-11.html)) | Misleading | `batch-modules.test.ts` "lists the breakout pins as S, VCC, GND in the printed order", "has male header pins on all three positions in a row", "runs from 3.3 V to 5.5 V ...", "has a 10 kOhm on-board pull-up from DATA to VCC" | Replaced |
| depictions-16 | HC-SR04 (no glyph; D12) | Not drawn; the baseline ultrasonic diagram had no ECHO wire | Vcc, Trig, Echo, GND on male pins; powered from 5 V (15 mA); ECHO swings to 5 V, and a Pi GPIO is not 5 V tolerant, so a divider is required | `content/parts/hc-sr04.part.json` ([HC-SR04 sheet](https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf)); GPIO page "Inputs" | Unsafe for hardware | `batch-modules.test.ts` "is powered from 5 V and draws 15 mA", "drives ECHO high at 5 V, so a 3.3 V GPIO needs a divider"; ERC `OVERVOLTAGE_GPIO` ("a 5 V module output straight into a GPIO") | Replaced |
| depictions-17 | Every other type (unknown types render nothing; D5, D7) | Nothing is drawn for the relay module, DC motor and L293D, servo, PIR, LCD1602, 4×4 keypad, joystick, 74HC595, 7-segment displays or transistors; 10 of the 18 tutorial diagrams draw zero components | Each has a part definition with pinout, supply and gender. Examples: relay module S, +, − (5 V) and NC, COM, NO screw terminals; L293D VCC1 (logic) apart from VCC2 (motor), four GND pins joined; SG90 brown GND, red VCC (4.8–6 V), orange PWM on a female socket; HC-SR501 3.3 V output, 4.5–20 V supply; LCD1602 backpack GND, VCC, SDA, SCL at 0x27 or 0x3F; S8050 and PN2222 pins E, B, C | `content/parts/*.part.json`, each citing its datasheet | Doesn't work | `batch-switches-transistors.test.ts` (relay, motor, PN2222A, S8050), `batch-ics-displays.test.ts` (74HC595, L293D, 7-segment), `batch-modules.test.ts` (SG90, HC-SR501, LCD1602, keypad, joystick); ERC `BJT_NO_BASE_RESISTOR`, `INDUCTIVE_NO_DRIVER` | Replaced |
| depictions-18 | Jumper wires and lead gender | One curved wire between any two points, colour from the tutorial text, endpoints between holes at the cobbler; no length, no gender | Dupont leads 200 mm, male–male for breadboard-to-breadboard and for T-board strips, male–female for modules with male header pins, male–male into female sockets (SG90, keypad). Nothing attaches to the Pi header | SPEC 6.5; `content/leads/dupont.json` | Misleading | `batch-modules.test.ts` "gives every off-board module pin a connector gender and a distinct position"; ERC `LEAD_TOO_SHORT` in `core/erc/erc.test.ts` | Replaced |
<!-- /section:depictions -->

<!-- section:facts -->
### Other hard-coded electrical facts

Sources: [raspberrypi/utils pinctrl](https://github.com/raspberrypi/utils/blob/b57c48e97f7f43d95d86334798650cfda1ebc8a1/pinctrl/pinctrl.c) and its [gpiolib.c](https://github.com/raspberrypi/utils/blob/b57c48e97f7f43d95d86334798650cfda1ebc8a1/pinctrl/gpiolib.c) (output format and name tables); the Raspberry Pi documentation at 1bf32ac ([GPIO page](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc), [frequency management](https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/frequency-management.adoc)); [raspberrypi/linux PR 6144](https://github.com/raspberrypi/linux/pull/6144); [libgpiod `Chip`](https://git.kernel.org/pub/scm/libs/libgpiod/libgpiod.git/tree/bindings/python/gpiod/chip.py); [RPi.GPIO basic usage](https://sourceforge.net/p/raspberry-gpio-python/wiki/BasicUsage/); [rpi-lgpio README](https://github.com/waveform80/rpi-lgpio); [i2cdetect.c](https://git.kernel.org/pub/scm/utils/i2c-tools/i2c-tools.git/tree/tools/i2cdetect.c); the [Linux thermal ABI](https://github.com/torvalds/linux/blob/master/Documentation/ABI/testing/sysfs-class-thermal). The search covered `src/renderer/src/` (components, stores, pages, `App.jsx`), `pi-agent/` and `src-tauri/src/` for pin numbers, voltages, currents, timings and I2C addresses in the baseline (52639d9) and in the files added since.

`pins.js`, the pin and breadboard components, and the tutorials have their own sections. Everything else the search found is below. In the renderer only `SystemInfo.jsx` (temperature colours) and `LiveMonitor.jsx` (the "~10Hz" label) carry such a value; the baseline's other pin-related text was the rules in the `ai.rs` system prompt.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| facts-1 | `pi-agent/gpio_monitor.py` `BCM_PINS = set(range(28))` ("BCM GPIO pins on the 40-pin header (0-27)") | GPIO0–27 | Same: 26 user GPIOs plus the two ID pins | GPIO page "Pin types" | None | `data/pins.test.ts` "has the official pin counts" | Correct (kept) |
| facts-2 | `gpio_monitor.py` pinctrl line parser (`PINCTRL_RE`) | Two fields before the `\|`, so only inputs and alternate functions parsed. An output line has a third field, the drive level, between the function and the pull (`17: op dh pd \| hi // GPIO17 = output`). Every output pin was dropped, so the Live Monitor never listed the pins a script drives, LEDs included | An optional `dh`, `dl` or `--` after the function | pinctrl.c `print_gpio_state` (prints the drive name for an output); gpiolib.c `drive_names = { "dl", "dh", "--" }` | Doesn't work | `pi-agent/test_gpio_monitor.py` (run `python3 -m unittest` in `pi-agent/`): fails on the baseline parser (KeyError for GPIO17), passes now | Fixed |
| facts-3 | pinctrl code tables: `ip`→IN, `op`→OUT; `pu`→UP, `pd`→DOWN, `pn` and `--`→NONE; `hi`→HIGH, `lo`→LOW | As listed | Same names: `pull_names = { "pn", "pd", "pu", "--" }`, fsel names `a0`…`a8`, `ip`, `op`, `gp`, `no`, level `hi` or `lo` | gpiolib.c `pull_names`, `fsel_names`; pinctrl.c | None | `pi-agent/test_gpio_monitor.py` "test_reads_inputs_and_alternate_functions" | Correct (kept) |
| facts-4 | `_parse_function`: function and direction of non-`ip`/`op` pins | `no` ("none") and `gp` are reported as direction ALT; an alternate function is reported as its code (`A3`), with the RP1 name only in the free text (`GPIO2 = SDA1`) | The code `a3` is the FUNCSEL index; the function name is in the comment field | gpiolib.c `fsel_names`; pinctrl.c | Cosmetic | `pi-agent/test_gpio_monitor.py` "names an alternate function and a pin with none" | Fixed (a `no` pin reports NONE; an alternate function is named from pinctrl's comment) |
| facts-5 | `gpio_monitor.py` `_detect_chip`: `gpiochip4` on a Pi 5, then `gpiod.Chip("gpiochip4")` for the consumer, name and used fields | Chip name `gpiochip4` | On current Raspberry Pi kernels the header GPIOs (`pinctrl-rp1`) are `gpiochip0` ("there will no longer be a gpiochip4", merged 5 Aug 2024). libgpiod 2 (the API behind `gpiod>=2.0` and the `get_line_info` call) takes a device-file path in `Chip`, not a name, so `Chip("gpiochip4")` fails on any kernel; the failure is caught and logged at debug level, so the consumer enrichment the README advertises is never shown | raspberrypi/linux PR 6144; libgpiod `chip.py` ("takes the path to the GPIO chip device file") | Misleading | `pi-agent/test_gpio_monitor.py` ChipDetection (old and new kernel layouts) | Fixed (the chip is found by its pinctrl-rp1 / pinctrl-bcm label and opened by device path; on-Pi check in HIL_CHECKLIST.md) |
| facts-6 | Rates: `GPIO_POLL_HZ = 10`, `SYSINFO_INTERVAL = 5` s, WebSocket ping 20 s and timeout 60 s (`agent.py`); `LiveMonitor.jsx` label "~10Hz"; reconnect delays 1, 2, 4 … capped at 30 s, 10 attempts, 5 s shutdown (`ssh.rs`, `ws.rs`, `main.rs`) | As listed | The same constants; they are design choices, not electrical limits. The monitor samples a snapshot every 100 ms, so an edge shorter than that (a fast blink or PWM) can be missed | `pi-agent/agent.py`; `src-tauri/src/ssh.rs` (`MAX_RECONNECT_*`); `src-tauri/src/main.rs` (`SHUTDOWN_TIMEOUT`) | None | `src-tauri/src/ws.rs` test `authenticates_reconnects_and_stops_after_disconnect` (WebSocket only); the SSH backoff and the 5 s shutdown have no test | Correct (kept) |
| facts-7 | `system_info.py` CPU temperature from `/sys/class/thermal/thermal_zone0/temp` divided by 1000 | milli-°C to °C | Same: "Unit: millidegree Celsius" | Linux ABI `sysfs-class-thermal` | None | None | Correct (kept) |
| facts-8 | `SystemInfo.jsx` field names and units against what the agent sends | Reads `cpuTemp`, `memUsed`, `memTotal` (MB), `diskUsed`, `diskTotal` (MB) and `uptime` as seconds | The agent sends `cpu_temp`, `memory.{total_mb, used_mb}`, `disk.{total_gb, used_gb}` and `uptime` as a text such as "2d 3h 4m"; `ws.rs` forwards the object unchanged. The panel shows 0.0 °C, "--" for memory and disk, and "NaNm" for uptime; only model and IP show | `pi-agent/system_info.py` `get_info`; `src-tauri/src/ws.rs` `forward`; `components/SystemInfo.jsx` | Doesn't work | `components/SystemInfo.jsx` reads the agent's fields (`cpu_temp`, `memory.*_mb`, `disk.*_gb`, `uptime` text) | Fixed |
| facts-9 | `SystemInfo.jsx` `tempColor`: green below 60 °C, yellow below 75 °C, red above | 60 and 75 °C | The docs say the Arm cores are progressively throttled between 80 and 85 °C and cores and GPU throttle at 85 °C; no source gives 60 or 75. The colours are a UI choice | frequency-management.adoc | Cosmetic | `components/SystemInfo.jsx` `tempColor` | Fixed (green below 80 °C, yellow while throttling 80–85 °C, red from 85 °C) |
| facts-10 | `code_executor.py` stop: SIGINT to the process group, SIGKILL after a 3 s wait | As listed | Same behaviour. After a SIGKILL a script's `finally: GPIO.cleanup()` has not run, so its pins keep their last state | `pi-agent/code_executor.py` `stop` | None | None | Correct (kept) |
| facts-11 | `install.sh` installs `python3-rpi-lgpio` when apt has it, plus `python3-gpiod`, `python3-websockets` and `pinctrl` (raspi-utils or raspberrypi-utils) | As listed | rpi-lgpio is needed on a Pi 5: the tutorials use `import RPi.GPIO`, which cannot reach the GPIO registers that sit on RP1, and rpi-lgpio provides that module on kernels that offer only the gpiochip device; its install step is skipped silently when apt lacks the package, and the tutorials then fail on a Pi 5. `python3-gpiod` exists in neither Debian nor archive.raspberrypi.com (checked 2026-10-24), so `apt-get install` fails and the script exits before any later step. The binding is `python3-libgpiod`: 2.2.1 (the v2 API) on Trixie, 1.6.3 (v1) on Bookworm. The agent's monitor and Board Sense use the v2 API | rpi-lgpio README; [raspberry.tips article](https://raspberry.tips/en/raspberrypi-tutorials/raspberry-pi-5-gpio-rpigpio-not-working-alternatives) (secondary source); [Debian package search](https://packages.debian.org/search?keywords=python3-gpiod&searchon=names&suite=all&section=all); [python3-libgpiod in bookworm](https://packages.debian.org/bookworm/python3-libgpiod) and [trixie](https://packages.debian.org/trixie/python3-libgpiod); archive.raspberrypi.com `Packages` for bookworm and trixie, arm64 | Doesn't work | None (on-Pi check in HIL_CHECKLIST.md) | Fixed (apt installs `python3-libgpiod` and `python3-venv`; when its binding is 1.x, gpiod 2 goes into a venv the agent starts with; ADR-0019) |
| facts-12 | `commands.rs` `ssh_gpio_cleanup`: `python3 -c "import RPi.GPIO as GPIO; GPIO.setmode(GPIO.BCM); GPIO.cleanup()"; exit 0` | Described as resetting every pin a script left as an output | `GPIO.cleanup()` "will only clean up GPIO channels that your script has used". A fresh process has used none, so the command resets nothing; it always exits 0. A killed script's pins are only reset by its own `finally` | RPi.GPIO wiki BasicUsage | Misleading | `commands::tests::gpio_cleanup_sets_only_user_gpios_to_unpulled_inputs`; `state/runStore.test.ts` "kills the remote process on Stop, then returns the program pins to inputs" | Fixed (Stop now runs `pinctrl set <the program's pins> ip pn`, pins 2–27 only; on-Pi check in HIL_CHECKLIST.md) |
| facts-13 | `commands.rs` `TUTORIAL_TIMEOUT = 120 s` passed to `execute_streaming` (D17) | The output stream closed after 120 s, so a blink loop lost its output and its Stop tracking | No fixed deadline; an optional `run.timeLimitSec` kills a limited run on the remote | SPEC 16.2 D17; `src-tauri/src/commands.rs` `run_script` | Doesn't work | `src-tauri/src/live_tests.rs` `closing_the_channel_alone_leaves_a_quiet_script_running`, `a_run_that_hits_its_time_limit_is_killed_on_the_remote` | Fixed (357e7e9) |
| facts-14 | `ai.rs` system prompt rules ("Use BCM pin numbering", "Always include GPIO.cleanup() in a try/finally block", "Use only the GPIO pins mentioned in the wiring") | As listed | BCM numbering is what `GPIO.setmode(GPIO.BCM)` selects and what `data/pins.js` uses. The file and the OpenRouter assistant are removed (D14) | `src-tauri/src/ai.rs` at 52639d9; commit 9ad6cc0 | None | n/a | Replaced (removed) |
| facts-15 | `src-tauri/src/i2c.rs` (added after the baseline): `i2cdetect -y <bus>` grid, default scan 0x08–0x77, cells `--` and `UU`, addresses of 7 bits | As listed | Same: i2c-tools scans 0x08–0x77 by default and 0x00–0x7F with `-a`; `UU` marks an address a driver holds | i2cdetect.c (`first = 0x08, last = 0x77`) | None | `i2c.rs` unit tests (`a_full_range_grid_with_every_cell_filled_lists_every_address`, `the_full_range_includes_address_zero_and_the_last_address`) | Correct (kept) |
| facts-16 | `state/workbenchStore.ts` `USER_GPIOS` = GPIO2–27; `panels/SimPanel.tsx` "PWM 1 kHz" test mode (added after the baseline) | As listed | The 26 user GPIOs are GP2 to GP27, and GP0 and GP1 are the ID pins; 1 kHz is a test setting, not a hardware claim | GPIO page "Pin types" | None | `data/pins.test.ts` "has the official pin counts" | Correct (kept) |
<!-- /section:facts -->

<!-- section:readme -->
### README claims

Sources: `gpio-dashboard/README.md` (488 lines, unchanged since 52639d9; line numbers below are its own) checked against the tree at `v2-breadboard-studio` (e015454, which already carries M0 to M3: the OpenRouter assistant removed, the SSH tunnel, the Workbench page, and the I2C scan) and against the files named in each row; SPEC 16.2 D13, D14, D16. There is no repository-root `README.md` at 52639d9 or now. The M12 rewrite replaces the README (SPEC 17), so no README text was edited; each finding is recorded for it. Not run on a Pi: `PI_HOST` is unset (`docs/v2/BASELINE.md`), so "holds" means the code and its tests agree with the claim, not that it was seen working on hardware. Not checked claim by claim: the badge row, the prose in "Motivation", and the Webview-zoom and `open_external` lines under "Process Isolation".

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| readme-1 | Root README | The task lists a root `README.md` | There is none: `git ls-tree 52639d9` and the tree list only `gpio-dashboard/README.md` | `git ls-tree 52639d9` | Cosmetic | Review in M12 (SPEC 18) | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-2 | "photo-realistic breadboard" (L15, heading L63) (D16) | A photo-realistic breadboard canvas | A flat SVG: rectangles, circles and glyphs, with no photograph, texture or 3D. The 3D breadboard is milestone M7 and is not built | `components/Breadboard.jsx`; SPEC 16.2 D16; `docs/v2/PROGRESS.md` | Misleading | Review in M12 | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-3 | "classic 63-row, 10-column layout with power rails and an authoritative coordinate system" (L65; "single source of truth" L343) (D16) | 63 rows, rails, one coordinate system | The shipped page draws 30 rows (`NUM_ROWS = 30`), rails resolve off the drawn board, and two coordinate frames are mixed (D1, D3, D4). The 63-row model exists in `core/` and is not yet drawn | `components/breadboardCoords.js`; depictions-1, -4 | Misleading | `core/regressions.test.ts` D1–D4 (for the model); review in M12 | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-4 | "A T-Cobbler adapter glyph maps every header pin to a breadboard tie-point" (L65) | Every pin to a tie-point | Pins are drawn between holes (D2). The bench board is the SunFounder T-board, not a T-Cobbler | depictions-6, -9 | Misleading | `core/geometry/tboard.test.ts` | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-5 | "Components (LEDs, resistors, sensors, buttons) render as inline SVG primitives at the exact row/column they belong in" (L65) | Parts drawn where they belong | Six schematic glyph types, a button as one point, a buzzer with one connection point; unknown types render nothing and 10 of 18 diagrams draw none (D5, D7) | depictions-11 to -17 | Misleading | Review in M12 | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-6 | "18-project SunFounder Basic Starter Kit curriculum", "adapted from the SunFounder Basic Starter Kit" (L15, L86) (D13, D16) | 18 kit projects with theory, wiring, code | 18 tutorials exist in `data/tutorials.js`. Seven of them need parts the part definitions tag "not in kit" (HC-SR501, HC-SR04, joystick, keypad, LCD1602, 4-digit display, SG90), and the baseline wiring of several is wrong (D8–D12). One tutorial is rebuilt so far. See each tutorial's section | `content/parts/*.part.json` kitTags; SPEC 16.2 D13; the tutorial sections above | Misleading | `content/tutorials/tutorials.test.ts` (rebuilt tutorials only); review in M12 | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-7 | Category counts: Output 6, Input 2, Display 3, Sensor 4, Motor 2, Advanced 1 (L88–95) | 18 in six categories | Holds: counted from the `category` field of each tutorial in `data/tutorials.js` | `data/tutorials.js` | None | n/a | Holds |
| readme-8 | "from 'blink an LED' to 'read a temperature sensor over I2C'" (L15) | An I2C temperature sensor | The temperature sensor is the DHT11, which uses a single-wire protocol, not I2C. The I2C project is the LCD1602 backpack | `content/parts/dht11.part.json` and `dht11-module.part.json`; [kit 2.2.3](https://basic-starter-kit-for-raspberry-pi.readthedocs.io/en/latest/2.2.3%20DHT-11.html) | Misleading | `batch-modules.test.ts` "records the single-wire timing" | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-9 | The AI sections: "multi-model AI coding assistant", "AI Code Generation", OpenRouter, "Supported Models", the allowlists and the AI rows of the architecture, state and scale tables (L3, L13, L15, L111–152, L187, L315–317, L371, L398–399) (D14) | A per-tutorial OpenRouter chat panel | Removed in M1: `ai.rs`, its four commands, `window.api.ai`, `AiChatPanel.jsx` (commit 9ad6cc0). There is no OpenRouter code left. The Claude assistant (an Anthropic proxy in `anthropic.rs`, key in the Keychain) has no panel yet | `git grep -i openrouter` at HEAD finds nothing under `src`, `src-tauri/src` and `pi-agent`; `docs/v2/PROGRESS.md` M1 1.6 | Misleading | Review in M12 | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-10 | "10 Hz live GPIO telemetry" (L15, L50, L226) | Ten updates a second to the app | The agent samples at 10 Hz (`GPIO_POLL_HZ`). At the baseline the app could not connect (D18, the agent binds loopback and nothing forwarded the port) and the parser dropped every output pin (facts-2). Both are fixed now: the WebSocket runs through an SSH tunnel (357e7e9) and output pins parse. Not seen on a real Pi | `pi-agent/agent.py`; `src-tauri/src/ws.rs`; facts-2 | Misleading | `src-tauri/src/live_tests.rs` (tunnel); `pi-agent/test_gpio_monitor.py` | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-11 | "streams the state of all 28 BCM GPIO pins", read with `pinctrl`, which "does not claim the pin"; "When `gpiod` is available, line state is enriched with consumer name, friendly line name, and `used` flag" (L52, L249–261) | 28 pins, no claiming, consumer names | 28 pins (BCM0–27) now that outputs parse. `pinctrl` "accesses the hardware directly, bypassing the kernel drivers", so it does not claim a pin. The enrichment does not work as written: chip name `gpiochip4` and a name passed where libgpiod 2 wants a path (facts-5) | pinctrl README; facts-1, -2, -5 | Misleading | `pi-agent/test_gpio_monitor.py` (parsing only) | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-12 | Hot-path dedupe, per-pin change tracking, 200 ms highlight, pin subscription (L54–57, L340–346) | As listed | Holds for the dedupe (`ws.rs` `forward`), the per-pin store (`gpioStore.js`) and `CHANGE_HIGHLIGHT_DURATION_MS = 200`. The agent accepts `subscribe`, but the app never sends it (no caller in `api.js` or `ws.rs`), so there is no filtering in use | `src-tauri/src/ws.rs`; `store/gpioStore.js`; `pi-agent/agent.py` | Cosmetic | `src-tauri/src/ws.rs` test `identical_consecutive_gpio_frames_are_dropped` (dedupe) | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-13 | Pinout explorer (L61, L59) | Physical, BCM and WiringPi numbers, nine type colours, alt-function listings, usage notes such as "GPIO2: I2C1 Data, has 1.8kΩ pull-up to 3.3V"; a drawer with "live state, pull-up/down configuration, direction, and current function"; "connected pins fade in with a glow" | The numbers and the 1.8 kΩ note hold. The alt-function lists were wrong (pins-12 to -14) and are fixed. The drawer shows value, direction and pull only: the current function is stored (`function`) and never shown. Live pins pulse for 200 ms when their state changes, which is all the "fade in with a glow" is | pins-1 to -20; `components/PinDetail.jsx`, `GpioPin.jsx` | Cosmetic | `data/pins.test.ts` (data only) | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-14 | Terminal, editor and remote execution (L67–72) | xterm.js PTY (`xterm-256color`, resize by window-change), Ctrl or Cmd + backtick toggle, CodeMirror 6 with Python, One Dark and multiple cursors, upload through `cat`, `python3 -u`, live output, `pkill` scoped to the file, then a GPIO cleanup | Holds except the cleanup, which resets nothing (readme-21), and "live output": since 357e7e9 there is no 120 s cut-off (D17) | `src-tauri/src/ssh.rs` (`xterm-256color`, `window_change`, `cat >`); `commands.rs`; `App.jsx`; `components/CodeEditor.jsx` (`basicSetup`, `python()`) | None | `src-tauri/src/live_tests.rs` | Holds |
| readme-15 | "The `SSHManager` maintains a `Map<sessionId, Shell>` … Graceful shutdown drains up to 3 seconds per shell" (L74–76) | A per-shell 3 s drain | Several shells share one SSH connection (a `HashMap<String, Shell>` in `ssh.rs`), but the manager is Rust, not a JavaScript class, and it has no drain: shells are dropped when the connection closes. The 3 s figure is the SIGINT wait in `code_executor.py`. Shutdown is bounded to 5 s (`SHUTDOWN_TIMEOUT`) | `src-tauri/src/ssh.rs`; `src-tauri/src/main.rs` | Cosmetic | None | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-16 | System Info HUD: "CPU temperature, memory usage, uptime, IP, hostname, Pi model, and disk usage … every 5 seconds … Displayed in the navbar" (L78–80) | A HUD in the navbar | The agent sends them every 5 s. The navbar shows only the connection status; the panel is on the Monitor page, and it reads field names and units the agent does not send, so it shows 0.0 °C, "--" and "NaNm" (facts-8) | `components/Navbar.jsx`; `pages/MonitorPage.jsx`; facts-8 | Doesn't work | None | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-17 | Architecture and state (L156–241): pages, `window.api` namespaces, "WebSocket (port 8765)", "Four disjoint stores" | Five pages; six namespaces (`ssh`, `gpio`, `terminal`, `agent`, `settings`, `ai`); direct WebSocket | Now six tabs (a Workbench was added); namespaces `anthropic` and `projects` added and `ai` gone; the WebSocket runs through the SSH tunnel to the loopback agent; stores `circuitStore` and `workbenchStore` were added to the four. The diagram's `/dev/gpiochipN` hides facts-5 | `App.jsx`, `components/Navbar.jsx`, `api.js`, `src-tauri/src/ws.rs` | Cosmetic | Review in M12 | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-18 | Auth token (L228, L347) | `secrets.token_urlsafe(32)`, printed to the log, read with `head -5 agent.log`, scrubbed with `sed -i '/AUTH_TOKEN=/d'` | Holds | `pi-agent/agent.py`; `src-tauri/src/agent.rs` | None | `agent.rs` unit tests (`finds_the_auth_token_in_the_agent_log`) | Holds |
| readme-19 | Pi agent internals (L245–285) | Four modules, "~565 lines"; the pinctrl line format and mapping table; "`gpiochip4` on Pi 5, `gpiochip0` on Pi 4 and earlier"; code executor and system info bullets; install packages, "`python3-rpi-lgpio` (RPi.GPIO drop-in for the Pi 5's new pinctrl framework)" | Four modules, 572 lines now (565 at the baseline, so "~565" still holds). The pinctrl example and table match the tool, but the parser had dropped outputs (facts-2). `gpiochip4` is wrong on current kernels (facts-5). Code executor (process group, SIGINT, 3 s, SIGKILL, queues) and system info bullets match the code. The install packages match; rpi-lgpio is a compatibility package for kernels with only the gpiochip device, not about a pinctrl framework | `pi-agent/*.py`, `install.sh`; facts-2, -5, -11 | Cosmetic | `pi-agent/test_gpio_monitor.py` | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-20 | Security model (L289–335) | Keychain for the SSH password and the OpenRouter key; trust-on-first-use host keys; allowlists (filename regex, `/tmp/gpio_dashboard/`, username, port, "9" settings keys, AI model, thinking level, prompt length); the CSP string; reconnect backoff | Keychain, host keys, the filename, path and port checks and the backoff (1 s to 30 s, 10 attempts, auth and host-key failures permanent) hold. Stale at this tree: the OpenRouter key and the AI allowlists (removed), "9" settings keys (now 11), and the CSP (now adds `'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `blob:` images and `'self'` in `connect-src`) | `src-tauri/src/commands.rs` `SETTINGS_ALLOWLIST`; `tauri.conf.json`; `ssh.rs` | Cosmetic | Review in M12 | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-21 | "GPIO Cleanup Guardrail": after a script exits the app can fire `GPIO.setmode(BCM); GPIO.cleanup()` over SSH "to reset every pin to INPUT with no pull" (L72, L332–334) | Resets pins a script left as outputs | Resets nothing: `GPIO.cleanup()` cleans only channels the calling script has used, and a fresh `python3 -c` has used none (facts-12) | RPi.GPIO wiki BasicUsage; facts-12 | Misleading | None | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-22 | Tech stack table (L354–372) | Tauri 2, React 19, Vite 7, Tailwind 3, Zustand 5, xterm.js 6, CodeMirror 6, russh, tokio-tungstenite, reqwest, keyring, `websockets` 12, `gpiod` 2, ESLint 9, Prettier 3 | Holds for the versions (`package.json`, `Cargo.toml`, `requirements.txt`) except "AI Provider: OpenRouter" (readme-9). `reqwest` now serves the Anthropic proxy | `package.json`; `src-tauri/Cargo.toml`; `pi-agent/requirements.txt` | Cosmetic | None | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-23 | "Project Scale" table (L376–400) | ~30 JS/JSX files, ~5,700 lines, 7 Rust files, ~565 Python lines, 17 components, 28 commands, 18 tutorials, 28 pins, 40 header pins, 9 pin types, 10 Hz, 0.2 Hz, 5 AI models | At 52639d9: 33 JS/JSX files and 5,832 lines, 7 Rust files, 565 Python lines, 17 components (plus `breadboardCoords.js`), 28 commands; the rest as listed. At this tree: 36 commands and no AI models. The counts are a snapshot | `git archive 52639d9` counts; `src-tauri/src/commands.rs` | Cosmetic | None | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-24 | Platforms and prerequisites: "cross-platform … (macOS, Windows, Linux)", "Node.js 20+, npm 10+", "Pi 4 or Pi 5" (L15, L408–409) | Three desktop platforms; Pi 4 and Pi 5 | Only macOS was built and run (`docs/v2/BASELINE.md`; the README itself labels `live-tests.sh` macOS, and its keychain test uses the login keychain). `package.json` has no `engines` field and the baseline ran on Node 26 and npm 11. The pin data, alternate functions and electrical constants are for the Pi 5 (RP1); a Pi 4 is untested and its pin functions differ | `docs/v2/BASELINE.md`; `package.json` | Misleading | Review in M12 | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-25 | First-run flow (L438–445) | Connect, deploy to `/home/<user>/gpio-dashboard-agent/`, install, start, then the "GPIO, Pinout, Breadboard, and Tutorials tabs" | Holds, with the paths and `nohup` from `agent.rs` and `commands.rs`. There is no GPIO tab: the live pins are on Monitor | `src-tauri/src/agent.rs`; `components/Navbar.jsx` | Cosmetic | `agent.rs` unit tests | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-26 | Testing and build sections (L428–436, L449–459) | `cargo test` "plus WebSocket and OpenRouter tests", `npm test`, `live-tests.sh` | The commands exist; `npm test` now runs Vitest as well as `node --test`, and there are no OpenRouter tests | `package.json` scripts; `docs/v2/BASELINE.md` | Cosmetic | None | Fixed (the interim README states only what exists; the full rewrite is M12) |
| readme-27 | Roadmap (L463–476) | I2C bus explorer, breadboard editor and others as future work | An I2C bus scan command and a project-file store exist now (`ssh_i2c_scan`, `projects.rs`); the breadboard editor is milestone M7. Roadmap items are plans, not claims | `src-tauri/src/i2c.rs`; `docs/v2/PLAN.md` | Cosmetic | None | Fixed (the interim README states only what exists; the full rewrite is M12) |
<!-- /section:readme -->

## Known defects (SPEC 16.2)

<!-- section:defects -->
### Defect register D1–D18

Each defect found before the audit, with its fix and the test that guards it.

| # | Item | Baseline | Correct | Source | Severity | Guarded by | Status |
|---|------|----------|---------|--------|----------|------------|--------|
| D1 | breadboard rows | `NUM_ROWS = 30` (the README claimed 63); 10 rows free beside the T-board | bb-830: 63 rows; 40 rows fully free beside the T-board | BB830 datasheet (`content/boards/bb-830.board.json`) | Doesn't work | `core/regressions.test.ts` "D1: …" | Fixed |
| D2 | T-board pin positions | Odd pins between columns d and e, even between f and g | Every T-board pin sits in a hole (d and h on the bench) | `content/controllers/tboard.json` (ADR-0004) | Doesn't work | `core/regressions.test.ts` "D2: …" | Fixed |
| D3 | rail positions | `power:` endpoints resolved off the drawn rails | Every rail hole is on its rail line | BB830 datasheet, AN0002 | Doesn't work | `core/regressions.test.ts` "D3: …" | Fixed |
| D4 | coordinate frames | Rails outside the rotated group, everything else inside | One board frame for rails and circuit area | — | Doesn't work | `core/regressions.test.ts` "D4: …" | Fixed |
| D5 | depictions | Six component types as schematic glyphs; unknown types render nothing; the button a single point; the buzzer one connection | Every part from its datasheet: pins, offsets, polarity, body, connector gender | `content/parts/*.part.json` (each cites its datasheet) | Misleading | `content/parts/parts.test.ts` and the batch facts tests | Replaced (the SVG renderer was removed) |
| D6 | default tutorial id | `BreadboardPage` fell back to `'led_blink'`; the real id is `'blinking-led'` | The Breadboard page is gone; the Tutorials page selects only ids from `content/tutorials` | — | Doesn't work | `content/tutorials/regressions.test.ts` "D6: …" | Fixed |
| D7 | empty diagrams | 10 of 18 diagrams drew zero components | Every tutorial's wiring is generated from its document, with every part placed | SPEC 1.4 | Doesn't work | `content/tutorials/regressions.test.ts` "D7: …" | Fixed |
| D8 | buzzer | Buzzer negative in row 23 h, GND at 23a: open circuit; driven straight from a GPIO | Buzzer switched by the kit's PN2222 with a base resistor, on a closed path | Kit 1.2.1; PN2222 datasheet | Doesn't work | `active-buzzer` sim assertions; `content/tutorials/regressions.test.ts` "D8: …" | Fixed |
| D9 | button pull resistor | 10 kΩ pull-down in rows 28–29, GPIO18 in row 27; `PUD_DOWN` in code masked it | The kit's pull-up configuration, proven with internal pulls off | Kit 2.1.1 | Misleading | `button` sim assertions; `content/tutorials/regressions.test.ts` "D9: …" | Fixed |
| D10 | RGB LED legs | Legs in non-adjacent rows 23/25/27/28; the diagram one LED across 27–28 | One rigid four-lead part on adjacent rows, each colour on its own GPIO | Kit 1.1.2; RGB LED datasheet | Doesn't work | `rgb-led` sim assertions; `content/tutorials/regressions.test.ts` "D10: …" | Fixed |
| D11 | 4-digit 7-segment | Wiring copied from flowing-leds; no digit-select lines | Segments and each digit's common pin wired and driven | 4-digit display datasheet | Doesn't work | `four-digit-seven-segment` sim assertions; `content/tutorials/regressions.test.ts` "D11: …" | Fixed |
| D12 | ultrasonic | No HC-SR04 drawn; ECHO wire missing; 5V and TRIG wires ending on unconnected rows | HC-SR04 wired, with ECHO through a divider that keeps the GPIO at or below 3.3 V | HC-SR04 datasheet; Raspberry Pi GPIO docs (not 5 V tolerant) | Unsafe for hardware | `ultrasonic` sim assertions; `content/tutorials/regressions.test.ts` "D12: …" | Fixed |
| D13 | curriculum | Drifted from the kit's project list to non-kit parts | The kit's 17 projects first, in the kit's order; extras after, tagged when they need parts not in the kit | Kit component list and project pages | Misleading | `content/tutorials/regressions.test.ts` "D13: …" | Fixed |
| D14 | AI and runs | Single-turn OpenRouter; pins restricted to the tutorial; streams overwrote the editor with no undo; runs only for tutorials | OpenRouter and `ai.rs` removed, and the Anthropic proxy added (M1). Runs are project-level and ERC-gated (M5). The assistant (M9) holds a multi-turn conversation, places on any user GPIO, and commits every change, code included (`write_code` is a `SetCode` op), as one undoable group per turn | SPEC 12, 14.3 | Misleading | `src-tauri` `anthropic::tests`; `state/runStore.test.ts`; `scripts/assistant-evals/replay.test.ts` (the `undo-all` eval: two turns, undoing the second restores the first's document; builds on GPIO17/18/23/24 from empty projects); `assistant/customTurn.test.ts`; `e2e/assistant.spec.ts` "blink from an empty project" (Undo all, code included, deep-equal) | Fixed |
| D15 | connectivity | No netlist or connectivity model | Union-find netlist and connectivity engine | SPEC 8 | Doesn't work | `core/regressions.test.ts` "D15: …"; `core/netlist/*.test.ts` | Fixed |
| D16 | README | "photo-realistic breadboard", "63-row", "18-project kit curriculum" | See the README section | — | Misleading | see the README section | see the README section |
| D17 | run deadline | `TUTORIAL_TIMEOUT = 120 s` closed the output stream; the script kept running unseen | No fixed deadline; an optional time limit kills the remote process | Observed against sshd (PROGRESS, M1) | Doesn't work | `commands::tests::a_run_has_no_time_limit_unless_one_is_set`; live test `a_run_that_hits_its_time_limit_is_killed_on_the_remote` | Fixed |
| D18 | telemetry | The agent bound 127.0.0.1 while ws.rs dialled the Pi's address: refused | The WebSocket runs through an SSH direct-tcpip tunnel to the loopback-only agent | Observed against sshd (PROGRESS, M1) | Doesn't work | live test `the_agent_socket_runs_through_the_ssh_tunnel_to_a_loopback_only_server` | Fixed |
<!-- /section:defects -->
