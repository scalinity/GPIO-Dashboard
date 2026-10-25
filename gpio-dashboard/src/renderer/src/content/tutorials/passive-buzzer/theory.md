## How it works

A passive buzzer is only a coil and a small diaphragm. It has no oscillator: it makes a sound
each time the current through the coil changes. A steady voltage gives a click when it is
switched on and another when it is switched off, then nothing. To hear a note, the coil
current must switch on and off at that note's frequency.

The circuit is the same as the active buzzer's. The buzzer's + lead is fed from {{net BZ1.+}}
and its − lead goes to the collector of the {{part Q1}}, whose emitter is on {{net Q1.1}}. The
code sends a square wave out of {{net R1.2}}; each HIGH half-cycle drives a base current of a
couple of milliamps through {{value R1}} and the transistor passes the coil's current.

## Frequency and duty

- The **frequency** of the square wave is the pitch: 262 Hz is middle C, 440 Hz is the A above
  it.
- The **duty cycle** is the share of each cycle that the pin is HIGH. At 50 % the coil is
  driven half of the time. A lower duty gives a quieter, thinner sound at the same pitch.

## Why stop between notes

The coil is a few tens of ohms, so a steady HIGH from the pin would put roughly a tenth of an
amp through it with no sound at all. Measure your own buzzer's coil with a multimeter; the
value varies between makers. The code switches the signal off between notes, and the pin sits
LOW whenever nothing is playing.
