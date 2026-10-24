## How it works

A tilt switch is a small metal can with a ball inside. When the switch stands upright the ball
rests on both contacts and the switch is closed. Tilt it far enough and the ball rolls away
from the contacts, and the switch is open. It has no polarity.

The switch sits between {{net S1.2}} and ground, through a {{value R1}} resistor:

- **Upright (closed):** {{net S1.2}} is connected to ground through {{value R1}}. The Pi's
  internal pull-up (about 55 kΩ) tries to raise it, but the pin settles near
  3.3 V × {{value R1}} ÷ ({{value R1}} + 55 kΩ), about half a volt, so it reads **LOW**.
- **Tilted (open):** nothing holds the pin down, so the internal pull-up raises it to 3.3 V
  and it reads **HIGH**.

There is no external pull-up in this circuit. The code must switch on the internal one, or an
open switch would leave the pin floating.

## The LEDs

Each LED's anode is fed from a GPIO pin ({{net D2.A}} for green, {{net D1.A}} for red) and its
cathode returns to ground through a {{value R2}} resistor. A pin driven HIGH lights its LED
with a few milliamps. The code lights green while the switch is closed and red, with a
message, while it is open.

## Debouncing

When the ball moves it bounces on the contacts for a few milliseconds. The code reads the pin
twice, 10 ms apart, and only acts when both reads agree.
