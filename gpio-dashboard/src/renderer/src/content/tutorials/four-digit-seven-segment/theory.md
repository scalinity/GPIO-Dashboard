## How it works

This display packs four 7-segment digits into one body. It would need 4 × 8 = 32 pins if every
segment were separate, so the four digits share their segment lines: all the segments marked a
are joined, all the segments marked b are joined, and so on. Each digit also has its own
anode pin, D1 to D4. This part is _common anode_: a segment lights when its anode (the digit
pin) is HIGH and its own segment line is pulled LOW.

## Multiplexing

Because the segment lines are shared, only one digit can show its own pattern at a time. The
program lights digit 1 with its pattern, then switches to digit 2 with its pattern, then 3, then
4, and goes round again. Each digit is on for about 3 ms, so each one refreshes about 80 times a
second. Your eye cannot see the flicker and reads all four digits as lit together. Each digit
is on for a quarter of the time, so it looks dimmer than a display that is on all the time.

## The segment lines

A 74HC595 shift register drives the eight segment lines, as in the 7-Segment Display project,
from {{net U1.14}} (data), {{net U1.11}} (shift clock) and {{net U1.12}} (latch). Each output
sinks the current of its segment through its own {{value R1}} resistor, which holds a lit
segment near 5 mA. The shift register sinks current, so a lit segment is a **0** bit and an
unlit one is a **1** bit.

## Switching a digit

One digit with all eight segments lit passes about 40 mA, which a GPIO pin must never be asked
to supply (a pin is rated for 16 mA, and the whole set for 50 mA). So each digit anode is
fed by a PNP transistor, an S8550, whose emitter is on 3V3. When its base is pulled LOW through
a {{value R9}} resistor, the transistor turns on and passes the whole digit current from 3V3
to the anode. The GPIO supplies only the base current, about 2.5 mA. The four select pins are
{{net R9.2}}, {{net R10.2}}, {{net R11.2}} and {{net R12.2}} for digits 1 to 4, and a LOW pin
selects its digit.

## A second breadboard

The display body is about 50 mm long, much longer than the row of pins it plugs into, so it
would sit on top of everything around it. It goes on a second breadboard by itself, joined to
the first by jumper leads.
