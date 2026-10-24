## How it works

Morse code spells text with two signals: a short one, a _dot_, and a long one, a _dash_. This
circuit sends each signal to an LED and a buzzer together, so you can see it and hear it.

- The LED's anode is fed from {{net R2.2}} through a {{value R2}} resistor, and its cathode
  goes to {{net D1.K}}. HIGH on the pin lights it.
- The buzzer is an active one, switched by the {{part Q1}} exactly as in the Active Buzzer
  project: its + lead is on {{net BZ1.+}}, the emitter is on {{net Q1.1}}, and the base is fed
  from {{net R1.2}} through a {{value R1}} resistor. HIGH on the pin sounds it.

## Timing

All of the timing comes from one length, the _unit_:

| Part                                          | Length  |
| --------------------------------------------- | ------- |
| dot                                           | 1 unit  |
| dash                                          | 3 units |
| gap between the dots and dashes of one letter | 1 unit  |
| gap between letters                           | 3 units |
| gap between words                             | 7 units |

The code sends each letter as a run of dots and dashes looked up from a table, with the unit
set at 0.1 s.

## Why 5 V for the buzzer

The kit's buzzer is rated for 5 V, and the closest published datasheet for it gives a minimum
operating voltage of 4 V, so it takes its supply from the 5 V pin. The GPIO pins only switch the transistor.
