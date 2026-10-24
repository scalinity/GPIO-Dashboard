## How it works

The DHT11 senses temperature and relative humidity and reports both on a single data wire. It reads humidity from 20 to 90 %RH (±5) and temperature from 0 to 50 °C (±2), in whole units; its humidity element is resistive, not capacitive. The module has three pins: the middle one is the supply, one end is ground and the end marked S is DATA. Here DATA is wired to {{net DHT1.DATA}}, and the supply is the Pi's 3.3 V.

## The pull-up

The data wire is shared: the Pi and the sensor take turns pulling it LOW, and neither drives it HIGH. A pull-up resistor lifts the wire to 3.3 V whenever nobody is pulling it down. The {{value R1}} resistor R1 does that here. The module carries a pull-up of its own as well, so the two together act as a pull-up of about 5 kΩ, which is harmless. With both in place DATA idles at 3.3 V, and that is what the idle check measures. The sensor itself accepts 3.3 to 5.5 V, but the module's own pull-up goes to its supply, so at 5 V it would pull DATA, and the GPIO pin with it, up toward 5 V. That is why it is powered from 3.3 V.

## How a reading is asked for

1. The Pi pulls DATA LOW for at least 18 ms. This wakes the sensor.
2. The Pi lets go. The pull-up raises DATA, and 20 to 40 µs later the sensor pulls it LOW for 80 µs and then lets it rise for 80 µs, to say it heard.
3. The sensor then sends 40 bits. Each bit starts with 50 µs LOW. The length of the HIGH that follows is the bit: about 27 µs is a 0 and about 70 µs is a 1.
4. The 40 bits are five bytes: humidity, a zero byte, temperature, a zero byte and a checksum. The checksum is the sum of the first four bytes, kept to 8 bits. If it does not match, the reading is thrown away.

## What the simulator checks

The simulation checks the wiring and the timing that can be shown without running the code: the sensor is powered, DATA idles HIGH, a 20 ms start makes the sensor answer, and a start shorter than 18 ms is ignored. Decoding the bits is the job of the code, which comes in a later step.

The sensor needs about 2 s between readings, and the code's timing is tight for Python, so it simply retries a failed frame.
