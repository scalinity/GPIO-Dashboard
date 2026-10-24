## How it works

The joystick module holds two potentiometers, one for each axis, and a push button under the stick. Each potentiometer is connected across the module's supply, so the voltage on VRX or VRY goes from 0 V to the supply as the stick moves, and sits near half the supply when centred. The button connects SW to ground when pressed and leaves it floating otherwise.

## Why the supply is 3.3 V

The joystick outputs reach the module's own supply voltage. At 5 V they would reach 5 V, which the ADS7830 module and the Pi must not see. Both run from 3.3 V, so the axes stay between 0 V and 3.3 V.

## Reading the axes

The Pi has no analogue inputs, so the ADS7830 module measures the two axis voltages and sends 8-bit numbers over I2C: {{net U1.SDA}} is the data line, {{net U1.SCL}} the clock, and the module answers at 0x48. VRX goes to input A0 and VRY to input A1. The converter divides 3.3 V into 256 steps, so a centred stick reads about 128, one end of an axis reads close to 0 and the other end close to 255.

Both signals pass through a breadboard row on their way, because the module pins and the ADC pins are male and the leads from the kit plug into a breadboard.

## The button

The module has no pull-up resistor on SW, so the line floats until the button is pressed. The code turns on the Pi's internal pull-up on {{net J1.SW}}, so SW reads HIGH when released and LOW when pressed.

## In the code

The code reads A0 and A1 and treats readings within 30 of 128 as centred. Outside that, the side of 128 gives the direction: low X is left, high X is right. The Y axis direction names depend on how the module is turned, so up and down may need swapping on your board.
