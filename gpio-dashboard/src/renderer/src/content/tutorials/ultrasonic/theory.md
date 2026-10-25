## How it works

The HC-SR04 measures distance with sound. A pulse of at least 10 µs on TRIG makes it send eight bursts of 40 kHz ultrasound. It then raises ECHO and holds it HIGH until the echo returns. The HIGH time is the time the sound took to go out and come back, so

distance = HIGH time × speed of sound ÷ 2.

At about 343 m/s the echo takes about 58 µs for each centimetre of distance. The module reads from 2 cm to 4 m.

The code makes the pulse on {{net HC1.TRIG}} and times ECHO on {{net R2.2}}. The 3.3 V from the Pi is enough to trigger the module even though it is a 5 V part.

## ECHO is a 5 V signal

The module runs from 5 V and its ECHO output swings to 5 V. The Pi's GPIO pins are 3.3 V only and are not 5 V tolerant, so ECHO must never go straight to a pin. A resistor divider brings it down.

Here the upper half of the divider is the {{value R1}} resistor R1 and the {{value R2}} resistor R2 in series, and the lower half is the {{value R3}} resistor R3 and the {{value R4}} resistor R4 in series, from the junction to ground. With 5 V on ECHO the junction sits at

5 V × 2 kΩ ÷ (1.22 kΩ + 2 kΩ) ≈ 3.1 V,

which is at most 3.3 V even if the module's supply is a little high, and well above the 2 V the Pi needs to see a HIGH. A common 1 kΩ and 2 kΩ divider gives 3.33 V, slightly over the limit, and the kit has no 2 kΩ resistor. In the simulation the output stays below 3.3 V with ECHO at its high level.

The divider does not load the output noticeably: it draws about 1.5 mA from ECHO.

## The code

The code waits for ECHO to be LOW, sends the trigger pulse, times how long ECHO stays HIGH and converts that to centimetres. It gives up after 50 ms with no echo. TRIG idles LOW so the module does not start on its own, and the code only measures about every 0.3 s because the module needs about 60 ms between measurements.
