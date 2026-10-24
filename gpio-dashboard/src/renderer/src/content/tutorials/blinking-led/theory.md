## How it works

An LED conducts in one direction only, from its anode (the longer leg) to its cathode. Here
the anode is fed from 3.3 V through the {{part R1}}, and the cathode goes to {{net D1.K}}.

- When the code drives {{net D1.K}} **HIGH**, both ends of the LED path sit near 3.3 V. No
  current flows, and the LED stays dark.
- When it drives {{net D1.K}} **LOW**, the pin sinks current: about (3.3 V − 1.9 V) ÷ {{value R1}},
  a few milliamps. The LED lights.

This is called *active low*: LOW means on. Many circuits wire LEDs this way, so always check
which way round the LED sits before reading the code.

## Why the resistor

An LED's voltage barely changes as its current rises, so without a resistor nothing limits the
current except the GPIO pin itself. The {{value R1}} resistor keeps the current to a few
milliamps, well under the LED's rating and the 16 mA a Raspberry Pi GPIO pin can carry.
