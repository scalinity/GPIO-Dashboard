## How it works

Each of the eight LEDs has its own GPIO pin and its own {{value R1}} resistor. The pin feeds the
resistor, the resistor feeds the LED's anode (the longer leg), and the cathode (the shorter leg)
goes to a shared GND rail. Driving a pin **HIGH** pushes a few milliamps through its LED and
lights it. Driving it **LOW** turns it off. The pins are, in order along the row, {{net R1.1}},
{{net R2.1}}, {{net R3.1}}, {{net R4.1}}, {{net R5.1}}, {{net R6.1}}, {{net R7.1}} and
{{net R8.1}}.

## Making the light move

Nothing in the wiring moves. The program lights one LED, waits a tenth of a second, lights the
next one instead, and carries on to the end of the row and back. Your eye joins the separate
positions into a single moving light, the way it does with a string of chasing bulbs. Every
step sets all eight pins, one HIGH and seven LOW, and the sweep does not light an end LED twice
in a row on the way back, so it keeps an even rhythm.

## Why every LED has its own resistor

The LEDs here are different colours, and each colour needs a slightly different voltage across
it. With a resistor per LED, each one settles at its own current: about 5 mA for all of them,
well under the 16 mA a pin can carry. A resistor shared by several LEDs would let the one with
the lowest voltage drop take most of the current.

## The current budget

All eight GPIO pins together are rated for 50 mA. One LED at a time takes about 5 mA. All eight
at once would take about 43 mA, which is inside the limit but not by much, so this circuit
is a good place to stop adding LEDs on direct pins. For more outputs, use a shift register
(the Shift Register tutorial).
