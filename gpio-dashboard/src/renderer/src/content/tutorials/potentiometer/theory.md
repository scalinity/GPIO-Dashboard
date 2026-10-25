## How it works

A potentiometer is a resistor with a sliding contact. The potentiometer R1 ({{part R1}}) has three pins. The two outer pins are the ends of a 10 kΩ track, and the middle pin, the wiper, touches the track at a point you move with the knob. Here one end goes to ground and the other to 3.3 V, so the wiper sits at a voltage between 0 V and 3.3 V that follows the knob.

This is a voltage divider: the track above the wiper and the track below it split the 3.3 V in proportion to how far the knob is turned.

## Why the Pi needs an ADC

The Pi's GPIO pins only tell HIGH from LOW. To read a voltage in between, the ADS7830 module measures it and sends the result over I2C. {{net U1.SDA}} carries the data and {{net U1.SCL}} carries the clock, and the module answers at address 0x48.

The converter has 8 bits, so it divides its supply into 256 steps. The module's full scale is its own supply, and it runs from 3.3 V, so one step is about 12.9 mV and a reading of 128 means about half of 3.3 V. The module's I2C pull-ups are not documented, so it stays on 3.3 V: a 5 V supply could put 5 V on the Pi's I2C pins.

## Reading a value

To read input A0 the code writes one command byte, 0x84, and then reads one byte back. The command's bits choose a single-ended reading and the input number, and keep the converter on. The select codes for the eight inputs are not in numerical order, so the code looks them up in a table.

## The LED

The LED is wired as in Blinking LED: 3.3 V through the {{value R2}} resistor to the anode, and the cathode to {{net D1.K}}. It lights when the pin is LOW. The code drives the pin with PWM at 1 kHz and sets the duty cycle, the share of each cycle spent HIGH, from the reading. A larger reading means more time HIGH and a dimmer LED.
