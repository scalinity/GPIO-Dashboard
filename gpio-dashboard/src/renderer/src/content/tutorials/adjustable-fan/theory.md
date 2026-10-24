## How it works

The potentiometer sets two things at once: which way the motor turns, and how fast. The ADS7830 module reads the knob on input A0 as a number from 0 to 255. The code treats 128, the middle, as stopped. Above it the motor turns forward and below it backward, and the further the knob is from the middle the higher the PWM duty cycle and the faster the motor.

## Why an L293D

A motor draws far more current than a GPIO pin can supply, and it kicks voltage spikes back when it is switched. The {{part U2}} is built for that: each of its two drivers has its own output stage and clamp diodes. The Pi only supplies the small logic signals.

- {{net U2.2}} drives input 1A, and {{net U2.7}} drives input 2A. Each output follows its input, so 1Y and 2Y are either high or low.
- With 1A HIGH and 2A LOW the motor has voltage across it one way. With 1A LOW and 2A HIGH, the other way, so it turns the other way. With both inputs LOW there is no voltage across it and it stops.
- {{net U2.1}} drives the enable pin. Both drivers only work while it is HIGH, so pulsing it with PWM at 1 kHz switches the motor on and off fast enough to set its average power. This is how the speed is set.

## Two supplies

The chip has two supply pins. VCC1 powers its logic and VCC2 powers the motor outputs, and both need at least 4.5 V. Both come from the power module's 5 V. The motor does not run from the Pi's 5 V pin: it draws about 70 mA free-running and up to 500 mA stalled, and its noise would reach the Pi's supply.

The power module's ground is connected to the Pi's ground. Without that, the logic signals from the Pi would have no reference at the chip, and nothing would work reliably.

## What the chip costs

At the motor's current the output stage drops about 1 V when it drives high and a little over 0.6 V when it drives low, so the motor sees roughly 3.3 V from a 5 V supply in the simulation. That is enough to start the motor, which begins turning at about 2 V.

## The ADC

The ADS7830 divides its 3.3 V supply into 256 steps. {{net U1.SDA}} is the I2C data line and {{net U1.SCL}} the clock, and the module answers at 0x48. It stays on 3.3 V because its I2C pull-ups are not documented and could put 5 V on the Pi's pins.
