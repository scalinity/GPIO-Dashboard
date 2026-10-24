// "Blink an LED on GPIO17" as Claude would build it: a scripted conversation, for tests that run
// the assistant end to end.
import { text, toolUse, type Reply } from './sse'

export const BLINK_CODE = `from gpiozero import LED
from time import sleep

led = LED(17)

while True:
    led.on()
    sleep(0.5)
    led.off()
    sleep(0.5)
`

const tools = (...blocks: Reply['blocks']): Reply => ({ blocks, stop: 'tool_use' })

export const BLINK_SCRIPT: Reply[] = [
  tools(
    text('A red LED with a 220 ohm resistor on GPIO17.'),
    toolUse('t1', 'search_parts', { query: 'led' }),
    toolUse('t2', 'get_circuit_state', { detail: 'summary' })
  ),
  tools(
    toolUse('t3', 'place_part', {
      defId: 'resistor',
      at: 'auto',
      orientation: 0,
      props: [{ name: 'resistance', value: 220 }]
    }),
    toolUse('t4', 'place_part', {
      defId: 'led',
      at: 'auto',
      orientation: 0,
      props: [{ name: 'color', value: 'red' }]
    })
  ),
  tools(
    toolUse('t5', 'connect', { from: { net: 'GPIO17' }, to: { partPin: { ref: 'R1', pin: '1' } } }),
    toolUse('t6', 'connect', {
      from: { partPin: { ref: 'R1', pin: '2' } },
      to: { partPin: { ref: 'D1', pin: 'A' } }
    }),
    toolUse('t7', 'connect', { from: { partPin: { ref: 'D1', pin: 'K' } }, to: { net: 'GND' } })
  ),
  tools(toolUse('t8', 'write_code', { library: 'gpiozero', source: BLINK_CODE })),
  tools(
    toolUse('t9', 'run_erc', {}),
    toolUse('t10', 'simulate', {
      mode: 'op',
      durationMs: 0,
      stimulus: { gpio: [{ pin: 17, level: 'high', freqHz: 0, duty: 0 }], inputs: [] }
    })
  ),
  { blocks: [text('Built: GPIO17 -> 220 ohm -> LED -> GND.')], stop: 'end_turn' }
]
