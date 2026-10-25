## How it works

A photoresistor, or LDR, is a resistor whose resistance falls as light on it rises. The photoresistor R2 is a cadmium-sulphide cell, most likely the common GL5528 type, which measures about 10 to 20 kΩ at 10 lux and about 1 MΩ in the dark. The kit does not name its model, so treat these numbers as typical.

A resistance cannot be read by a GPIO pin, so it is turned into a voltage. The {{value R1}} resistor R1 and the photoresistor R2 form a voltage divider between 3.3 V and ground, and the voltage at their junction goes to input A0 of the ADS7830 module.

## Which way the reading moves

R2 is the lower half of the divider, so the voltage at A0 is 3.3 V × R2 ÷ (R1 + R2). More light means a smaller R2 and a lower voltage. In the dark R2 is much larger than R1, so A0 sits close to 3.3 V and the reading climbs toward 255. In bright light it falls toward 0.

## Reading it over I2C

The Pi cannot measure voltages, so the ADS7830 does it and reports an 8-bit number over I2C: {{net U1.SDA}} is the data line, {{net U1.SCL}} the clock, and the module answers at 0x48. The converter divides its 3.3 V supply into 256 steps, about 12.9 mV each. The module runs from 3.3 V, not 5 V, because its I2C pull-ups are not documented and could put 5 V on the Pi's pins.

## The LED

The LED is wired as in Blinking LED: 3.3 V through the {{value R3}} resistor to the anode, and the cathode to {{net D1.K}}, so it lights when that pin is LOW. The code sets the PWM duty cycle, the share of each cycle the pin is HIGH, from the reading. Bright light gives a small reading, a short HIGH time and a bright LED. A night light would do the opposite, so it would use 100 minus the duty cycle.
