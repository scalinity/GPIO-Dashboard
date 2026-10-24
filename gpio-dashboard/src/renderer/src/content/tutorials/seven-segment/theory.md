## How it works

A 7-segment display is eight LEDs in one package: seven bars, labelled a to g, and a decimal
point, dp. This one is _common cathode_, so the cathodes of all eight LEDs are joined and come
out on two common pins (3 and 8, which are one connection inside). The common pin goes to GND
through {{part R1}}, and each segment lights when its own pin is driven HIGH. Lighting the right
combination of segments draws a digit: segments b and c make a 1, all of a to g make an 8.

## One byte per picture

Each segment pin is wired to one output of a 74HC595 shift register: QA drives a, QB drives b, and
so on up to QG for g and QH for dp. A picture is therefore one byte, with bit 0 for segment a and
bit 6 for segment g. The digit 0 lights a to f, which is 00111111 in binary, or 0x3F.

The program sends that byte down one wire, one bit at a time:

- {{net U1.14}} carries the bit (the chip's SER input).
- {{net U1.11}} pulses once per bit, and each pulse shifts every bit along by one place (SRCLK).
- {{net U1.12}} pulses once at the end, and the eight shifted bits appear on the outputs together
  (RCLK, the latch).

Three GPIO pins therefore control all eight segments. OE is tied to GND so the outputs are
enabled, and SRCLR is tied to 3V3 so the register is never cleared.

## One resistor for all the segments

Every lit segment sends its current through the same {{value R1}} resistor, so that resistor
limits the total, not each segment. With one segment lit it passes about 4 mA, but with all
eight lit the same total is shared out and each segment gets under 1 mA. A 1 therefore looks
brighter than an 8. The current stays far below every limit, so nothing can be damaged. If you
want even brightness, give each segment its own resistor instead.
