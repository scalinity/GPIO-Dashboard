## How it works

A thermistor is a resistor that changes with temperature. The thermistor RT1 ({{part RT1}}) is an NTC type: its resistance falls as it warms. It measures 10 kΩ at 25 °C, about 32.8 kΩ at 0 °C and about 3.6 kΩ at 50 °C.

The {{value R1}} resistor R1 and the thermistor RT1 form a voltage divider between 3.3 V and ground, and their junction goes to input A0 of the ADS7830 module. RT1 is the lower half, so the voltage at A0 is 3.3 V × RT1 ÷ (R1 + RT1).

## Which way the reading moves

Warmer means a smaller RT1 and so a lower voltage at A0. At 25 °C the thermistor equals R1 and A0 sits at half of 3.3 V, a reading of about 128. Colder than that the reading rises, and warmer than that it falls: the voltage at A0 falls as the temperature rises.

## From a reading to degrees

The code turns the reading back into a resistance with the divider formula, then into a temperature with the thermistor's beta equation:

1 / T = 1 / T25 + ln(RT / R25) / B

T25 is 298.15 K (25 °C), R25 is 10 kΩ and B is 3950 K for this part. The result is in kelvin, so the code subtracts 273.15. The beta equation fits best between about 25 and 50 °C, and is a few degrees off at the ends of the range.

## Reading it over I2C

The ADS7830 module measures the voltage and reports an 8-bit number over I2C: {{net U1.SDA}} is the data line, {{net U1.SCL}} the clock, and the module answers at 0x48. With 3.3 V as full scale one step is about 12.9 mV. The module stays on 3.3 V because its I2C pull-ups are not documented and could put 5 V on the Pi's pins.
