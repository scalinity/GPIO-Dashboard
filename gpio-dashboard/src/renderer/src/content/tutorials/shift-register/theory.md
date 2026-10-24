## How it works

The 74HC595 turns a stream of bits arriving on one wire into eight steady outputs, QA to QH. It
holds the bits in two places. The **shift register** takes in the bits one at a time, and the
**storage register** feeds the output pins. They are separate so the outputs stay still while
a new byte is being shifted in.

Three GPIO pins run it:

- {{net U1.14}} is the data line (SER). The program puts the next bit on it.
- {{net U1.11}} is the shift clock (SRCLK). Each rising edge reads the bit on the data line
  into the first stage and moves all the earlier bits along by one.
- {{net U1.12}} is the latch (RCLK). A rising edge copies the whole shift register into the
  storage register, and the outputs change together.

To show a byte the program sends its eight bits, most significant first, pulsing the shift clock
after each one, and then pulses the latch once. The last bit sent ends up on QA and the first
on QH, so bit 0 of the byte drives QA and bit 7 drives QH. Sending 0xA5, which is 10100101 in
binary, lights the LEDs for bits 0, 2, 5 and 7.

## The control pins you do not drive

SRCLR (pin 10) clears the shift register when it is pulled LOW, so it is tied to 3V3 to keep
it from clearing. OE (pin 13) switches the outputs off when it is HIGH, so it is tied to GND to
keep them on. The chip runs from 3V3, which is inside its 2 V to 6 V supply range and matches
the 3.3 V logic of the GPIO pins.

## Why each output has a resistor

Each output drives its LED through a {{value R1}} resistor. The output then supplies about
4 mA, which is under the 6 mA the datasheet rates it for, and all eight together draw about
34 mA from the chip's supply, well inside its 70 mA limit. Without the resistors an output
would be limited only by its own resistance, which is not something to rely on.

## More outputs

The chip's last stage is also brought out on QH′ (pin 9). Wiring QH′ to the next chip's data
input chains the registers into a longer one, which is how the LED Dot Matrix project
reaches sixteen outputs with the same three GPIO pins.
