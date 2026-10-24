## How it works

The LED is wired from GPIO18 through {{part R1}} to its anode, and its cathode goes to GND. When
{{net R1.1}} is **HIGH** current flows through the resistor and the LED lights. When it is
**LOW** the LED is dark. This is _active high_, so the pin supplies the current: a few
milliamps, well under the 16 mA a single pin can carry.

## Brightness from PWM

A pin has only two levels, so to dim the LED the program switches the pin on and off 1000
times a second. The share of each cycle spent HIGH is the _duty cycle_. At 25% duty the LED is
on for a quarter of every cycle, so its average current is a quarter of the full value. The
eye cannot follow 1000 flashes a second, and it sees a dimmer, steady light.

RPi.GPIO makes this PWM in software, on any pin. GPIO18 gets no hardware assistance from this
library, so the pulses are as accurate as the program's timing. That is plenty for an LED.

## The breathing curve

The program changes the duty cycle smoothly over a four-second cycle: up from 0% and back down,
easing in and out like a cosine wave. The eye does not judge brightness linearly, because
doubling the current looks much less than twice as bright. Squaring the level before using it
as the duty cycle makes the fade look more even from dark to bright and back.

## Why the resistor

An LED's voltage barely changes as its current rises, so without a resistor nothing limits the
current except the pin itself. The {{value R1}} resistor keeps it near 5 mA at full duty, safe
for the LED and for the pin.
