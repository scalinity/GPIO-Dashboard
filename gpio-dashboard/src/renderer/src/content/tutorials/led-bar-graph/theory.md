## How it works

An LED bar graph is ten separate LEDs in one 20-pin body, with no pin shared between them. LED n
has its anode on pin n (pins 1 to 10 along one side) and its cathode on pin 21 minus n (pins 20
down to 11 along the other side). That makes it easy to build a level meter or a loading bar:
each bar is switched on its own.

## Active low

Each anode connects through its own {{value R1}} resistor to 3V3, and each cathode connects to a
GPIO pin: {{net B1.20}} for the first bar, {{net B1.19}} for the second, and so on. The LED is
therefore between 3.3 V and the pin. When the code drives a pin **LOW** the pin sinks current,
about (3.3 V − 1.9 V) ÷ {{value R1}}, a few milliamps, and the bar lights. When it drives the
pin **HIGH** both ends of the LED sit near 3.3 V and the bar stays dark. LOW means on, as in
the Blinking LED circuit, so the code starts every pin HIGH.

## Staying inside the Pi's limits

One bar carries about 6 mA, well under the 16 mA a single pin can handle. All the GPIO pins
together are rated for 50 mA, though, and ten bars at 6 mA each come to about 61 mA. Up to eight
bars lit together stay inside that total, but all ten do not, so the code lights one bar at a
time and never all ten at once.

## Two pins with a pull-up

The last three bars use GPIO2, GPIO3 and GPIO8. GPIO2 and GPIO3 are the I²C pins and carry a
fixed 1.8 kΩ pull-up resistor to 3.3 V on the Pi itself. The pull-up adds about 1.7 mA when
the pin is LOW and does nothing while it is HIGH, so those bars work like the rest. While
this project runs, leave the I²C and SPI interfaces switched off, because their drivers would
otherwise own these pins.
