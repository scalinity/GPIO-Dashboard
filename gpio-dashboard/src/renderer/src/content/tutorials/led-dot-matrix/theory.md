## How it works

An 8×8 matrix holds 64 LEDs but has only 16 pins, because the LEDs are wired as a grid. The
eight LEDs in one row share a single **row** pin, and the eight LEDs in one column share a
single **column** pin. This matrix is _common anode_: the row pins connect to the anodes and the
column pins to the cathodes. The LED where row r crosses column c lights when row r is driven
**HIGH** and column c is driven **LOW**. Any other combination leaves it dark, because there is
no forward voltage across it.

## Sixteen outputs from three pins

Sixteen lines would take sixteen GPIO pins, so two 74HC595 shift registers supply them. Three
GPIO pins run both chips:

- {{net U1.14}} sends the bits one at a time into the first chip's SER input.
- {{net U1.11}} is the shift clock (SRCLK). Each rising edge moves every bit along by one place.
- {{net U1.12}} is the latch (RCLK). A rising edge copies the shifted bits to the outputs.

The first chip's QH′ output feeds the second chip's SER input, so the two chips behave as one
16-bit register. After 16 clock pulses the first byte has moved on into the second chip and the
second byte sits in the first. The code therefore sends the **column** byte first, then the
**row** byte, and pulses the latch once. The first chip's eight outputs are the rows, selected
with a 1 bit. The second chip's are the columns, lit with a 0 bit. Bit n of each byte drives
row n + 1 or column n + 1.

OE is tied to GND so the outputs stay enabled, and SRCLR is tied to 3V3 so the registers are
never cleared.

## Drawing a picture

Every row shares the same eight column lines, so the matrix can only show one row's pattern at
a time. The program shows a picture by lighting its rows one after another, a fraction of a
millisecond each, and repeating fast enough that your eye sees all eight at once. This is
_multiplexing_, and it keeps one row of LEDs lit at any moment.

## Current and the missing resistors

This circuit has no series resistors, as in the kit. The 74HC595 outputs have a resistance of
their own, which limits each LED to a few milliamps from a 3.3 V supply. A single lit LED
carries about 8 mA. A whole row shares one output, so each of its eight LEDs gets less, about
1.5 mA, and the output carries about 12 mA in total. That is well inside the chip's 35 mA
per-output limit, but above the 6 mA at which it guarantees its output levels, so brightness
depends on the chip and on how many LEDs share an output. Keep to one row at a time, as the
code does.
