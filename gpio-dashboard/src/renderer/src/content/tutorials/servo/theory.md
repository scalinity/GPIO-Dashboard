## How it works

A hobby servo holds a shaft at an angle you choose. Inside it are a small motor, a gear train,
a position sensor and a control circuit. The control circuit watches the signal wire for a
pulse every 20 ms and compares the pulse's **width** with the shaft's position, turning the
motor until the two agree.

For the SG90:

| Pulse width | Position       |
| ----------- | -------------- |
| 1.0 ms      | about −90°     |
| 1.5 ms      | the middle, 0° |
| 2.0 ms      | about +90°     |

A 50 Hz signal has a 20 ms period, so each width is a duty cycle: 5 % for 1 ms, 7.5 % for
1.5 ms and 10 % for 2 ms. The code on {{net SV1.PWM}} sets the duty cycle to turn the shaft.

## Wiring

The servo's three wires end in a plug with female sockets, so male–male leads go from them to
the T-board. Brown is ground, red is the supply and orange is the signal. The supply comes
from {{net SV1.VCC}}, because the SG90 wants 4.8 V or more.

## Power

The signal pin carries almost no current. The supply does: an SG90 draws around 100 mA while
moving, and published figures for a stalled shaft run from 360 mA to 700 mA. If the Pi resets
or the servo twitches, power the servo from its own 5 V supply and join that supply's ground
to the Pi's.

## Going slack

The servo only holds its position while pulses keep arriving. If they stop, the control circuit
lets go, and the shaft can be turned by hand. Keep the PWM running for as long as you want the
servo to hold.
