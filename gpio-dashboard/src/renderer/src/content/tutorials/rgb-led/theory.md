## How it works

An RGB LED packs three LEDs into one 5 mm body: a red one, a green one and a blue one. This
one is a **common cathode** part, so the three cathodes are joined inside and come out as a
single lead, the longest of the four. The other three leads are the anodes. Reading the leads
from the end, the order is red, the common cathode, green and blue.

The common lead goes to GND. Each anode is fed through its own {{value R1}} resistor from a GPIO
pin: {{net R1.1}} for red, {{net R2.1}} for green and {{net R3.1}} for blue. A pin driven
**HIGH** pushes current through its resistor and colour and the LED lights that colour. A pin
driven **LOW** leaves it dark. This is _active high_, the opposite of the Blinking LED circuit.

## Mixing colours with PWM

A pin can only be fully HIGH or fully LOW, so the program flips each pin on and off thousands of
times a second. The share of each cycle that the pin is HIGH is the _duty cycle_. At 50% duty a
colour is on for half of every cycle, its average current is half of the full value, and your
eye sees about half the brightness. Setting a different duty on each of the three pins mixes
the colours: red and green together make yellow, red and blue make purple, and all three make
white. RPi.GPIO makes this PWM in software, which is accurate enough for an LED but not for a
precise signal.

## Why the colours are not equal

The red die drops about 2 V when it conducts, so from 3.3 V through {{value R1}} it carries a few
milliamps. The green and blue dies need about 3.2 V, which leaves almost nothing for the
resistor to drop, so they carry only a milliamp or so on the same 3.3 V supply. At full duty the
red channel is therefore much brighter than the other two, and white looks reddish. The
resistors still protect each die and each pin: every channel stays far below a pin's 16 mA
limit.
