## How it works

The 6 mm button has four legs. The two on one side are joined inside, and so are the two on
the other, and pressing the button joins the two sides. Here one side goes to {{net SW1.1}}
and the other to {{net SW1.3}}.

A GPIO input must always be held at a definite level. The {{value R2}} resistor pulls
{{net SW1.1}} up to {{net R2.1}} while the button is open, so the pin reads **HIGH**. Pressing
the button ties the pin straight to {{net SW1.3}}, and the pin reads **LOW**. This is a
_pull-up_ arrangement, and it gives an input that is LOW when pressed.

- Released: the pin sits at 3.3 V, with almost no current flowing.
- Pressed: the pin is at 0 V, and the resistor passes 3.3 V ÷ {{value R2}}, about a third of a
  milliamp, to ground. A large resistor keeps that tiny.

The Pi has its own pull-up resistor, which the code turns on. The external resistor does the
same job independently, so the circuit would still work if the code did not turn it on.

## The LED

The LED sits between 3V3 and {{net D1.K}}, through a {{value R1}} resistor. It lights when
the code drives {{net D1.K}} **LOW**, which is when the button is pressed. Because the LED is
wired to 3V3 rather than to ground, LOW means on: check which way round each LED sits before
reading the code.

## Why not leave the pin open?

An input with nothing connected picks up stray charge and reads either level at random. A
pull-up or pull-down resistor settles that. Pull-ups are popular because the button then
needs only one wire to ground.
