## How it works

An active buzzer has a small oscillator built in. Give it a supply of about 5 V with the
right polarity and it makes its one fixed tone; take the supply away and it stops. The longer
lead, marked +, goes to the supply: here {{net BZ1.+}}.

The buzzer draws about 30 mA, too much to take from a GPIO pin, which should stay under 16 mA.
So the pin does not power the buzzer. It switches it through the {{part Q1}}:

- The buzzer's − lead goes to the transistor's collector, and the emitter goes to {{net Q1.1}}.
- A transistor like this conducts from collector to emitter while a small current flows into
  its base. When the code drives {{net R1.2}} **HIGH**, about (3.3 V − 0.7 V) ÷ {{value R1}},
  a couple of milliamps, flows through the base resistor. The buzzer then gets nearly all of
  the 5 V and sounds.
- When the code drives {{net R1.2}} **LOW**, no base current flows, the transistor stops
  conducting and the buzzer falls silent.

Here HIGH means on. The transistor sits between the buzzer and ground, so it switches the
buzzer's ground side.

## Why the transistor and the resistor

The transistor lets a 2 mA signal control a 30 mA load, and keeps the buzzer's current out of
the Pi's pin. The {{value R1}} base resistor limits the base current: without it the pin would
push current into a forward-biased junction until something gave way.

## Active or passive

An active buzzer decides its own pitch, so the code can only turn it on and off. A passive
buzzer (the next project) has no oscillator and plays whatever frequency you send it.
