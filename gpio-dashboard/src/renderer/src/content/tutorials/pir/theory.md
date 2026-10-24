## How it works

A passive infrared (PIR) sensor does not send anything out. It watches for changes in the
infrared that warm things such as people give off. A lens in front splits the view into zones,
and the module raises its output when something warm moves from one zone to another.

The HC-SR501 module has three pins. VCC takes about 5 V ({{net U1.VCC}} here), GND goes to
ground, and OUT goes to {{net U1.OUT}}. OUT swings between 0 V and 3.3 V, which a GPIO pin can
read safely even though the module itself runs from 5 V.

## What the module does

- **Warm-up:** for about a minute after power-up the module settles, and its output is not
  reliable. The code waits for it.
- **Hold time:** after it sees movement OUT stays HIGH for a set time, from about 5 s up to
  several minutes, set by one of the two trimmers on the back.
- **Block time:** after OUT falls it ignores movement for a couple of seconds.
- **Retrigger jumper:** in the H position, more movement during the hold time restarts it. In
  the L position OUT falls when the hold time ends however much movement there is.
- **Sensitivity:** the other trimmer sets the range, about 3 m to 7 m.

## The alert LED

The code copies OUT to an LED on {{net R1.1}}: its anode is fed through a {{value R1}}
resistor and its cathode returns to ground, so HIGH lights it.
