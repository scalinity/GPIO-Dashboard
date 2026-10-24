## How it works

A small DC motor can take far more current than a GPIO pin can supply, and it runs in either
direction depending on which lead is more positive. The {{part U1}} deals with both. It holds
four half-bridges, each of which connects its output to the motor supply or to ground, and
this circuit uses two of them, one for each motor lead.

- **Enable** ({{net U1.1}}): while it is HIGH, each output follows its input. While it is LOW
  the outputs let go and the motor coasts.
- **Direction inputs** ({{net U1.7}} and {{net U1.2}}): if one is HIGH and the other LOW, the
  supply is across the motor one way; swap them and the current reverses. If both inputs are
  the same, both leads sit at the same level and the motor brakes.

The chip's switches are not perfect. At full load they drop roughly 1.4 V on the high side and
1.2 V on the low side, so a motor on a 5 V supply sees noticeably less than 5 V.

## Two supplies, one ground

The chip has two supply pins. VCC1 (pin 16) powers its logic and VCC2 (pin 8) powers the
motor outputs. Here both come from the 5 V output of the power module, so the motor's current
comes from the module and its battery, not from the Pi. The Pi only feeds the three small
logic signals.

The power module's ground and the Pi's ground are joined at {{net U1.5}}. Without that
connection the chip would have no common reference for the Pi's 3.3 V signals.

## Direction

The same wiring and code can turn the shaft clockwise or the other way; which one a given
polarity gives depends on how the motor's two leads meet the chip's outputs. Swap the two motor
leads if the "forward" direction is the wrong way round for you.
