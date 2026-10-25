## How it works

A relay is a switch worked by an electromagnet. Current through the coil pulls a metal arm
across, and the arm's contact moves from one terminal to another. The coil circuit and the
contact circuit are separate, so a small signal can switch something quite different from
itself.

The three screw terminals are the contact:

- **COM** is the moving contact.
- **NC**, normally closed, is joined to COM while the coil is off.
- **NO**, normally open, is joined to COM only while the coil is energised.

Here COM is fed from {{net K1.COM}} and NO goes through a {{value R1}} resistor to the
{{part D1}}. When the relay is off, COM rests on NC, which is unused, and the LED is dark. When
the relay is energised COM moves to NO, the LED circuit closes and the LED lights.

## The module

The module around the relay holds a transistor that switches the coil, a resistor to the
transistor's base, a diode that absorbs the voltage spike when the coil is switched off and
an indicator LED. Its coil needs 5 V and about 70 mA, far more than a GPIO pin offers, so the
transistor carries that current and the signal pin on {{net K1.S}} supplies only a few
milliamps. The module is **active high**: HIGH on the signal pin energises the coil.

## Timing

The contact does not move at once. The relay's datasheet allows up to 10 ms to operate and
5 ms to release, so the contact circuit changes a few milliseconds after the signal does. You
will hear a click when it moves.

## Ratings

The relay in this module is rated for mains-level switching, but that is no job for a
breadboard. Keep to low-voltage loads such as this LED until you have a proper enclosure and
mains experience.
