// SunFounder Basic Starter Kit - 17 Tutorial Projects
// Each tutorial uses python3-rpi-lgpio (RPi.GPIO drop-in for Pi 5)

export const CATEGORIES = {
  output: { label: 'Output', color: '#22C55E' },
  input: { label: 'Input', color: '#3B82F6' },
  display: { label: 'Display', color: '#A855F7' },
  sensor: { label: 'Sensor', color: '#F97316' },
  motor: { label: 'Motor', color: '#EC4899' },
  advanced: { label: 'Advanced', color: '#14B8A6' }
}

export const DIFFICULTIES = {
  beginner: { label: 'Beginner', color: '#22C55E' },
  intermediate: { label: 'Intermediate', color: '#F59E0B' },
  advanced: { label: 'Advanced', color: '#EF4444' }
}

const TUTORIALS = [
  {
    id: 'blinking-led',
    title: 'Blinking LED',
    category: 'output',
    difficulty: 'beginner',
    description:
      'Your first circuit! Make an LED blink on and off. Learn basic GPIO output, digital HIGH/LOW, and circuit fundamentals.',
    components: [
      { name: 'LED (Red)', quantity: 1 },
      { name: '220Ω Resistor', quantity: 1 },
      { name: 'Jumper Wires', quantity: 2 }
    ],
    theory:
      'An LED (Light Emitting Diode) only allows current to flow in one direction. The longer leg is the anode (+) and connects toward the GPIO pin through a resistor. The shorter leg is the cathode (-) and connects to ground. The 220Ω resistor limits current to protect both the LED and the GPIO pin (max 16mA per pin on Pi 5). When GPIO17 outputs HIGH (3.3V), current flows through the resistor and LED to ground, lighting it up.',
    wiring: [
      { from: 'GPIO17 (cobbler)', to: 'Row 22a', description: 'Jumper wire from cobbler to breadboard' },
      { from: 'Row 22c → Row 23c', to: '220Ω Resistor', description: 'Place resistor spanning rows 22–23' },
      { from: 'Row 24c (anode +)', to: 'Row 25c (cathode −)', description: 'Place LED — long leg in row 24, short leg in row 25' },
      { from: 'Row 25a', to: 'GND (cobbler)', description: 'Jumper wire from LED cathode row to ground' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO17', to: 'row:22:a', color: '#F97316' },
        { from: 'row:25:a', to: 'cobbler:GND', color: '#333333' }
      ],
      components: [
        { type: 'resistor', row: 22, endRow: 23, col: 'c', value: '220Ω' },
        { type: 'led', row: 24, endRow: 25, col: 'c', color: '#EF4444', label: 'Red LED' }
      ],
      highlightPins: ['GPIO17', 'GND'],
      highlightRows: [22, 23, 24, 25]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

# Use BCM pin numbering
GPIO.setmode(GPIO.BCM)

# Set GPIO17 as output
LED_PIN = 17
GPIO.setup(LED_PIN, GPIO.OUT)

print("Blinking LED on GPIO17...")
print("Press Ctrl+C to stop")

try:
    while True:
        GPIO.output(LED_PIN, GPIO.HIGH)  # LED ON
        print("LED ON")
        time.sleep(1)

        GPIO.output(LED_PIN, GPIO.LOW)   # LED OFF
        print("LED OFF")
        time.sleep(1)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    GPIO.cleanup()  # Reset all GPIO pins
    print("GPIO cleaned up")
`,
    tips: [
      'If the LED does not light up, try flipping it around - LEDs only work in one direction.',
      'Never connect an LED directly to GPIO without a resistor - it can burn out the LED and damage the Pi.',
      'GPIO.cleanup() is important - it resets pins to input mode so they do not stay powered.'
    ]
  },
  {
    id: 'rgb-led',
    title: 'RGB LED',
    category: 'output',
    difficulty: 'beginner',
    description:
      'Control a full-color RGB LED. Learn PWM (Pulse Width Modulation) to mix any color by varying brightness of red, green, and blue channels.',
    components: [
      { name: 'RGB LED (Common Cathode)', quantity: 1 },
      { name: '220Ω Resistor', quantity: 3 },
      { name: 'Jumper Wires', quantity: 4 }
    ],
    theory:
      'An RGB LED has 3 tiny LEDs inside (Red, Green, Blue) with a common cathode (ground). By controlling the brightness of each color with PWM, you can mix any color. PWM rapidly switches the pin on and off - the duty cycle (0-100%) controls perceived brightness. At 1000Hz, your eye sees a steady brightness proportional to the duty cycle.',
    wiring: [
      { from: 'GPIO17 (cobbler)', to: 'Row 22a', description: 'Red channel jumper wire' },
      { from: 'GPIO18 (cobbler)', to: 'Row 23a', description: 'Green channel jumper wire' },
      { from: 'GPIO27 (cobbler)', to: 'Row 24a', description: 'Blue channel jumper wire' },
      { from: 'Row 22c → Row 22e', to: '220Ω Resistor', description: 'Red channel resistor in row 22' },
      { from: 'Row 23c → Row 23e', to: '220Ω Resistor', description: 'Green channel resistor in row 23' },
      { from: 'Row 24c → Row 24e', to: '220Ω Resistor', description: 'Blue channel resistor in row 24' },
      { from: 'Row 23g', to: 'RGB LED', description: 'RGB LED — red/green/blue legs in rows 22–24 (right side), longest leg (cathode) in row 25' },
      { from: 'Row 25a', to: 'GND (cobbler)', description: 'Jumper wire from common cathode row to ground' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO17', to: 'row:22:a', color: '#EF4444' },
        { from: 'cobbler:GPIO18', to: 'row:24:a', color: '#22C55E' },
        { from: 'cobbler:GPIO27', to: 'row:26:a', color: '#3B82F6' },
        { from: 'row:28:a', to: 'cobbler:GND', color: '#333333' }
      ],
      components: [
        { type: 'resistor', row: 22, endRow: 23, col: 'c', value: '220Ω' },
        { type: 'resistor', row: 24, endRow: 25, col: 'c', value: '220Ω' },
        { type: 'resistor', row: 26, endRow: 27, col: 'c', value: '220Ω' },
        { type: 'led', row: 28, endRow: 29, col: 'g', color: '#FFFFFF', label: 'RGB LED' }
      ],
      highlightPins: ['GPIO17', 'GPIO18', 'GPIO27', 'GND'],
      highlightRows: [22, 23, 24, 25, 26, 27, 28, 29]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

# RGB LED pins
RED = 17
GREEN = 18
BLUE = 27

GPIO.setup(RED, GPIO.OUT)
GPIO.setup(GREEN, GPIO.OUT)
GPIO.setup(BLUE, GPIO.OUT)

# Create PWM instances at 1000Hz
pwm_red = GPIO.PWM(RED, 1000)
pwm_green = GPIO.PWM(GREEN, 1000)
pwm_blue = GPIO.PWM(BLUE, 1000)

# Start with 0% duty cycle (off)
pwm_red.start(0)
pwm_green.start(0)
pwm_blue.start(0)

def set_color(r, g, b):
    """Set RGB color (0-255 for each channel)"""
    pwm_red.ChangeDutyCycle(r / 255 * 100)
    pwm_green.ChangeDutyCycle(g / 255 * 100)
    pwm_blue.ChangeDutyCycle(b / 255 * 100)

print("RGB LED Color Cycle")
print("Press Ctrl+C to stop")

try:
    while True:
        set_color(255, 0, 0)    # Red
        print("Red")
        time.sleep(1)
        set_color(0, 255, 0)    # Green
        print("Green")
        time.sleep(1)
        set_color(0, 0, 255)    # Blue
        print("Blue")
        time.sleep(1)
        set_color(255, 255, 0)  # Yellow
        print("Yellow")
        time.sleep(1)
        set_color(0, 255, 255)  # Cyan
        print("Cyan")
        time.sleep(1)
        set_color(255, 0, 255)  # Magenta
        print("Magenta")
        time.sleep(1)
        set_color(255, 255, 255)  # White
        print("White")
        time.sleep(1)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    pwm_red.stop()
    pwm_green.stop()
    pwm_blue.stop()
    GPIO.cleanup()
`,
    tips: [
      'Common cathode RGB LEDs have the longest leg as ground. Common anode LEDs are wired differently (longest leg to 3.3V).',
      'PWM frequency of 1000Hz eliminates visible flickering.',
      'Try creating a smooth rainbow fade by gradually changing duty cycles.'
    ]
  },
  {
    id: 'button-led',
    title: 'Button-Controlled LED',
    category: 'input',
    difficulty: 'beginner',
    description:
      'Read a button press and control an LED. Learn GPIO input, pull-up/pull-down resistors, and event-driven programming.',
    components: [
      { name: 'LED (Red)', quantity: 1 },
      { name: '220Ω Resistor', quantity: 1 },
      { name: 'Tactile Push Button', quantity: 1 },
      { name: '10kΩ Resistor', quantity: 1 },
      { name: 'Jumper Wires', quantity: 5 }
    ],
    theory:
      'A push button is a simple switch. When pressed, it connects two pins. Without a pull-down resistor, the GPIO input would "float" and read random values. The 10kΩ pull-down resistor keeps the pin LOW when the button is not pressed. When pressed, current flows from 3.3V through the button to the GPIO pin, reading HIGH. The Pi also has internal pull-up/pull-down resistors you can enable in software.',
    wiring: [
      { from: 'GPIO17 (cobbler)', to: 'Row 22a', description: 'LED control signal jumper wire' },
      { from: 'Row 22c → Row 22e', to: '220Ω Resistor', description: 'Current-limiting resistor in row 22' },
      { from: 'Row 22e → Row 24e', to: 'Jumper wire', description: 'Connect resistor output to LED row' },
      { from: 'Row 24c', to: 'LED', description: 'Place LED — anode in row 24, cathode toward row 24a' },
      { from: 'Row 24a', to: 'GND (cobbler)', description: 'LED ground jumper wire' },
      { from: 'GPIO18 (cobbler)', to: 'Row 26a', description: 'Button input signal jumper wire' },
      { from: 'Row 26e', to: 'Tactile button', description: 'Place button straddling center channel at row 26' },
      { from: 'Row 26j', to: '3V3 (cobbler)', description: 'Button power jumper wire' },
      { from: 'Row 26a → Row 28a', to: '10kΩ Resistor', description: 'Pull-down resistor spanning rows 26–28' },
      { from: 'Row 28a', to: 'GND (cobbler)', description: 'Pull-down resistor ground jumper wire' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO17', to: 'row:22:a', color: '#F97316' },
        { from: 'row:25:a', to: 'cobbler:GND', color: '#333333' },
        { from: 'cobbler:GPIO18', to: 'row:27:a', color: '#3B82F6' },
        { from: 'row:27:j', to: 'cobbler:3V3', color: '#EF4444' },
        { from: 'row:29:a', to: 'cobbler:GND', color: '#333333' }
      ],
      components: [
        { type: 'resistor', row: 22, endRow: 23, col: 'c', value: '220Ω' },
        { type: 'led', row: 24, endRow: 25, col: 'c', color: '#EF4444', label: 'Red LED' },
        { type: 'button', row: 27, col: 'e', label: 'Button' },
        { type: 'resistor', row: 28, endRow: 29, col: 'c', value: '10kΩ' }
      ],
      highlightPins: ['GPIO17', 'GPIO18', 'GND', '3V3'],
      highlightRows: [22, 23, 24, 25, 27, 28, 29]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

LED_PIN = 17
BUTTON_PIN = 18

GPIO.setup(LED_PIN, GPIO.OUT)
GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

print("Button LED Control")
print("Press the button to toggle the LED")
print("Press Ctrl+C to stop")

try:
    while True:
        if GPIO.input(BUTTON_PIN) == GPIO.HIGH:
            GPIO.output(LED_PIN, GPIO.HIGH)
            print("Button pressed - LED ON")
        else:
            GPIO.output(LED_PIN, GPIO.LOW)
        time.sleep(0.05)  # Small delay to debounce
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    GPIO.cleanup()
`,
    tips: [
      'The internal pull-down (GPIO.PUD_DOWN) means you can skip the external 10kΩ resistor for testing.',
      'Button bounce can cause multiple triggers - the 50ms delay helps debounce.',
      'Try using GPIO.add_event_detect() for interrupt-driven button handling instead of polling.'
    ]
  },
  {
    id: 'breathing-led',
    title: 'Breathing LED',
    category: 'output',
    difficulty: 'beginner',
    description:
      'Create a smooth breathing/pulsing LED effect. Master PWM duty cycle control for analog-like behavior from digital pins.',
    components: [
      { name: 'LED (any color)', quantity: 1 },
      { name: '220Ω Resistor', quantity: 1 },
      { name: 'Jumper Wires', quantity: 2 }
    ],
    theory:
      'PWM (Pulse Width Modulation) rapidly switches a pin between HIGH and LOW. By changing the duty cycle (percentage of time HIGH), we control the average voltage. At 0% duty cycle, the LED is off. At 100%, it is fully bright. By smoothly ramping the duty cycle up and down, we create a breathing effect. The math.sin() function creates a natural-looking ease-in/ease-out curve.',
    wiring: [
      { from: 'GPIO18 (cobbler)', to: 'Row 22a', description: 'PWM signal jumper wire' },
      { from: 'Row 22c → Row 22e', to: '220Ω Resistor', description: 'Current-limiting resistor in row 22' },
      { from: 'Row 22e → Row 24e', to: 'Jumper wire', description: 'Connect resistor to LED row' },
      { from: 'Row 24c', to: 'LED', description: 'Place LED — anode in row 24, cathode toward row 24a' },
      { from: 'Row 24a', to: 'GND (cobbler)', description: 'Ground jumper wire' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO18', to: 'row:22:a', color: '#F97316' },
        { from: 'row:25:a', to: 'cobbler:GND', color: '#333333' }
      ],
      components: [
        { type: 'resistor', row: 22, endRow: 23, col: 'c', value: '220Ω' },
        { type: 'led', row: 24, endRow: 25, col: 'c', color: '#3B82F6', label: 'LED' }
      ],
      highlightPins: ['GPIO18', 'GND'],
      highlightRows: [22, 23, 24, 25]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time
import math

GPIO.setmode(GPIO.BCM)

LED_PIN = 18
GPIO.setup(LED_PIN, GPIO.OUT)

pwm = GPIO.PWM(LED_PIN, 1000)  # 1kHz PWM
pwm.start(0)

print("Breathing LED effect on GPIO18")
print("Press Ctrl+C to stop")

try:
    t = 0
    while True:
        # Sine wave for smooth breathing (0 to 100 duty cycle)
        brightness = (math.sin(t) + 1) / 2 * 100
        pwm.ChangeDutyCycle(brightness)
        t += 0.05
        time.sleep(0.02)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    pwm.stop()
    GPIO.cleanup()
`,
    tips: [
      'GPIO18 supports hardware PWM for smoother output, but software PWM works on any GPIO pin.',
      'Adjust the increment (0.05) to change breathing speed.',
      'Try using an exponential curve instead of sine for a different feel.'
    ]
  },
  {
    id: 'flowing-leds',
    title: 'Flowing LEDs',
    category: 'output',
    difficulty: 'beginner',
    description:
      'Create a Knight Rider / larson scanner effect with a row of LEDs that light up in sequence.',
    components: [
      { name: 'LED (Red)', quantity: 8 },
      { name: '220Ω Resistor', quantity: 8 },
      { name: 'Jumper Wires', quantity: 9 }
    ],
    theory:
      'By connecting 8 LEDs to separate GPIO pins and turning them on/off in sequence with short delays, we create the illusion of a light flowing back and forth. This is the same principle behind LED matrix displays and LED strips - persistence of vision makes rapid sequential lighting appear as smooth motion.',
    wiring: [
      { from: 'GPIO17 (cobbler)', to: 'Row 22a', description: 'LED 1 signal — resistor row 22c, LED row 22h' },
      { from: 'GPIO18 (cobbler)', to: 'Row 23a', description: 'LED 2 signal — resistor row 23c, LED row 23h' },
      { from: 'GPIO27 (cobbler)', to: 'Row 24a', description: 'LED 3 signal — resistor row 24c, LED row 24h' },
      { from: 'GPIO22 (cobbler)', to: 'Row 25a', description: 'LED 4 signal — resistor row 25c, LED row 25h' },
      { from: 'GPIO23 (cobbler)', to: 'Row 26a', description: 'LED 5 signal — resistor row 26c, LED row 26h' },
      { from: 'GPIO24 (cobbler)', to: 'Row 27a', description: 'LED 6 signal — resistor row 27c, LED row 27h' },
      { from: 'GPIO25 (cobbler)', to: 'Row 28a', description: 'LED 7 signal — resistor row 28c, LED row 28h' },
      { from: 'GPIO5 (cobbler)', to: 'Row 29a', description: 'LED 8 signal — resistor row 29c, LED row 29h' },
      { from: 'Row 22c–29c', to: '220Ω Resistors (x8)', description: 'One resistor per row between signal and LED' },
      { from: 'All LED cathodes', to: 'GND rail', description: 'Connect all LED short legs to breadboard ground rail' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO17', to: 'row:22:a', color: '#EF4444' },
        { from: 'cobbler:GPIO18', to: 'row:23:a', color: '#EF4444' },
        { from: 'cobbler:GPIO27', to: 'row:24:a', color: '#EF4444' },
        { from: 'cobbler:GPIO22', to: 'row:25:a', color: '#EF4444' },
        { from: 'cobbler:GPIO23', to: 'row:26:a', color: '#EF4444' },
        { from: 'cobbler:GPIO24', to: 'row:27:a', color: '#EF4444' },
        { from: 'cobbler:GPIO25', to: 'row:28:a', color: '#EF4444' },
        { from: 'cobbler:GPIO5', to: 'row:29:a', color: '#EF4444' }
      ],
      components: [],
      highlightPins: ['GPIO17', 'GPIO18', 'GPIO27', 'GPIO22', 'GPIO23', 'GPIO24', 'GPIO25', 'GPIO5', 'GND'],
      highlightRows: [22, 23, 24, 25, 26, 27, 28, 29]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

# 8 LED pins
LEDS = [17, 18, 27, 22, 23, 24, 25, 5]

for pin in LEDS:
    GPIO.setup(pin, GPIO.OUT)
    GPIO.output(pin, GPIO.LOW)

print("Flowing LEDs (Knight Rider effect)")
print("Press Ctrl+C to stop")

def all_off():
    for pin in LEDS:
        GPIO.output(pin, GPIO.LOW)

try:
    while True:
        # Flow forward
        for pin in LEDS:
            all_off()
            GPIO.output(pin, GPIO.HIGH)
            time.sleep(0.1)
        # Flow backward
        for pin in reversed(LEDS):
            all_off()
            GPIO.output(pin, GPIO.HIGH)
            time.sleep(0.1)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    GPIO.cleanup()
`,
    tips: [
      'Adjust the delay (0.1s) to change the flow speed.',
      'Try keeping the previous LED dimly lit with PWM for a trailing effect.',
      'This pattern is the basis for LED matrix displays and scrolling text.'
    ]
  },
  {
    id: 'buzzer',
    title: 'Active Buzzer',
    category: 'output',
    difficulty: 'beginner',
    description:
      'Make sounds with an active buzzer. Learn the difference between active and passive buzzers, and create simple alert patterns.',
    components: [
      { name: 'Active Buzzer', quantity: 1 },
      { name: 'Jumper Wires', quantity: 2 }
    ],
    theory:
      'An active buzzer has a built-in oscillator - just apply voltage and it beeps at a fixed frequency. A passive buzzer needs an external signal (PWM) to produce sound at different frequencies. Active buzzers are simpler (just HIGH/LOW) but can only make one tone. The "+" marking indicates the positive terminal.',
    wiring: [
      { from: 'GPIO17 (cobbler)', to: 'Row 22a', description: 'Signal jumper wire' },
      { from: 'Row 22h', to: 'Buzzer (+)', description: 'Place buzzer — positive leg in row 22, negative in row 23' },
      { from: 'Row 23a', to: 'GND (cobbler)', description: 'Buzzer ground jumper wire' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO17', to: 'row:22:a', color: '#F97316' },
        { from: 'row:22:e', to: 'row:22:f', color: '#F97316' },
        { from: 'row:23:a', to: 'cobbler:GND', color: '#333333' }
      ],
      components: [
        { type: 'buzzer', row: 22, col: 'h', label: 'Buzzer' }
      ],
      highlightPins: ['GPIO17', 'GND'],
      highlightRows: [22, 23]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

BUZZER_PIN = 17
GPIO.setup(BUZZER_PIN, GPIO.OUT)

print("Active Buzzer Demo")
print("Press Ctrl+C to stop")

try:
    # Pattern: short beeps
    for i in range(3):
        GPIO.output(BUZZER_PIN, GPIO.HIGH)
        print("BEEP")
        time.sleep(0.2)
        GPIO.output(BUZZER_PIN, GPIO.LOW)
        time.sleep(0.2)

    time.sleep(0.5)

    # Long beep
    GPIO.output(BUZZER_PIN, GPIO.HIGH)
    print("BEEEEEP")
    time.sleep(1)
    GPIO.output(BUZZER_PIN, GPIO.LOW)

    time.sleep(0.5)

    # SOS pattern (... --- ...)
    print("SOS Pattern:")
    sos = [0.1, 0.1, 0.1, 0.3, 0.3, 0.3, 0.1, 0.1, 0.1]
    for duration in sos:
        GPIO.output(BUZZER_PIN, GPIO.HIGH)
        time.sleep(duration)
        GPIO.output(BUZZER_PIN, GPIO.LOW)
        time.sleep(0.1)

    print("Done!")
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    GPIO.output(BUZZER_PIN, GPIO.LOW)
    GPIO.cleanup()
`,
    tips: [
      'Active buzzers have a white sticker on top and a "+" marking.',
      'If no sound, check polarity - the "+" pin goes to GPIO.',
      'For different tones, use a passive buzzer with PWM frequency control.'
    ]
  },
  {
    id: 'relay',
    title: 'Relay Module',
    category: 'output',
    difficulty: 'intermediate',
    description:
      'Control high-power devices with a relay. Learn how relays isolate circuits and safely switch AC or high-current DC loads.',
    components: [
      { name: '5V Relay Module', quantity: 1 },
      { name: 'LED (as load indicator)', quantity: 1 },
      { name: '220Ω Resistor', quantity: 1 },
      { name: 'Jumper Wires', quantity: 4 }
    ],
    theory:
      'A relay is an electrically-operated switch. When the control pin goes HIGH, an electromagnet inside pulls a contact, connecting or disconnecting the load circuit. This lets a 3.3V GPIO pin control much higher voltage/current devices (up to 250V AC / 10A on most modules). The relay module includes a transistor driver and flyback diode for safe GPIO connection. NO = Normally Open, NC = Normally Closed, COM = Common.',
    wiring: [
      { from: 'GPIO17 (cobbler)', to: 'Relay IN', description: 'Control signal — jumper wire to relay module input' },
      { from: '5V (cobbler)', to: 'Relay VCC', description: 'Power — jumper wire to relay module VCC' },
      { from: 'GND (cobbler)', to: 'Relay GND', description: 'Ground — jumper wire to relay module GND' },
      { from: 'Relay COM', to: 'Relay NO', description: 'Load circuit — wire through NO (normally open) and COM for the demo LED' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO17', to: 'row:22:a', color: '#F97316' },
        { from: 'cobbler:5V', to: 'row:23:a', color: '#EF4444' },
        { from: 'cobbler:GND', to: 'row:24:a', color: '#333333' }
      ],
      components: [],
      highlightPins: ['GPIO17', '5V', 'GND'],
      highlightRows: [22, 23, 24]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

RELAY_PIN = 17
GPIO.setup(RELAY_PIN, GPIO.OUT)

print("Relay Control Demo")
print("Press Ctrl+C to stop")

try:
    while True:
        GPIO.output(RELAY_PIN, GPIO.HIGH)
        print("Relay ON (circuit closed)")
        time.sleep(2)

        GPIO.output(RELAY_PIN, GPIO.LOW)
        print("Relay OFF (circuit open)")
        time.sleep(2)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    GPIO.output(RELAY_PIN, GPIO.LOW)
    GPIO.cleanup()
`,
    tips: [
      'You should hear a click when the relay switches.',
      'NEVER connect mains AC voltage while learning - use the LED demo circuit instead.',
      'Some relay modules are active-LOW (triggered by LOW signal). Check your module documentation.'
    ]
  },
  {
    id: 'motor',
    title: 'DC Motor with L293D',
    category: 'motor',
    difficulty: 'intermediate',
    description:
      'Control a DC motor direction and speed using the L293D motor driver chip. Learn H-bridge concepts and motor speed control with PWM.',
    components: [
      { name: 'L293D Motor Driver IC', quantity: 1 },
      { name: 'DC Motor', quantity: 1 },
      { name: 'External Power Supply (6-9V)', quantity: 1 },
      { name: 'Jumper Wires', quantity: 8 }
    ],
    theory:
      'The L293D is an H-bridge motor driver. It has 4 half-bridges that can drive 2 motors. For one motor: Enable (PWM for speed), Input1 and Input2 control direction. When IN1=HIGH, IN2=LOW: motor spins one way. When IN1=LOW, IN2=HIGH: motor reverses. When both same: motor brakes. The enable pin accepts PWM to control speed. Always use an external power supply for motors - they draw too much current for the Pi.',
    wiring: [
      { from: 'GPIO17 (cobbler)', to: 'L293D Pin 1 (Enable)', description: 'Speed control (PWM) — row 22' },
      { from: 'GPIO27 (cobbler)', to: 'L293D Pin 2 (Input 1)', description: 'Direction A — row 23' },
      { from: 'GPIO22 (cobbler)', to: 'L293D Pin 7 (Input 2)', description: 'Direction B — row 24' },
      { from: '5V (cobbler)', to: 'L293D Pin 16 (Vcc1)', description: 'Logic power for the driver chip' },
      { from: 'External 6–9V', to: 'L293D Pin 8 (Vcc2)', description: 'Motor power — separate supply required' },
      { from: 'GND (cobbler)', to: 'L293D Pins 4, 5, 12, 13', description: 'All four GND pins tied together' },
      { from: 'L293D Pins 3, 6 (Output)', to: 'Motor terminals', description: 'Motor connects to driver output pair' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO17', to: 'row:22:a', color: '#F97316' },
        { from: 'cobbler:GPIO27', to: 'row:23:a', color: '#3B82F6' },
        { from: 'cobbler:GPIO22', to: 'row:24:a', color: '#22C55E' }
      ],
      components: [],
      highlightPins: ['GPIO17', 'GPIO27', 'GPIO22', '5V', 'GND'],
      highlightRows: [22, 23, 24]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

ENABLE = 17  # PWM speed control
IN1 = 27     # Direction pin 1
IN2 = 22     # Direction pin 2

GPIO.setup(ENABLE, GPIO.OUT)
GPIO.setup(IN1, GPIO.OUT)
GPIO.setup(IN2, GPIO.OUT)

pwm = GPIO.PWM(ENABLE, 1000)
pwm.start(0)

def motor_forward(speed=75):
    GPIO.output(IN1, GPIO.HIGH)
    GPIO.output(IN2, GPIO.LOW)
    pwm.ChangeDutyCycle(speed)

def motor_backward(speed=75):
    GPIO.output(IN1, GPIO.LOW)
    GPIO.output(IN2, GPIO.HIGH)
    pwm.ChangeDutyCycle(speed)

def motor_stop():
    GPIO.output(IN1, GPIO.LOW)
    GPIO.output(IN2, GPIO.LOW)
    pwm.ChangeDutyCycle(0)

print("DC Motor Control Demo")
print("Press Ctrl+C to stop")

try:
    print("Forward at 50% speed")
    motor_forward(50)
    time.sleep(3)

    print("Forward at 100% speed")
    motor_forward(100)
    time.sleep(3)

    print("Stopping...")
    motor_stop()
    time.sleep(1)

    print("Backward at 75% speed")
    motor_backward(75)
    time.sleep(3)

    motor_stop()
    print("Done!")
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    motor_stop()
    pwm.stop()
    GPIO.cleanup()
`,
    tips: [
      'NEVER power the motor from the Pi 5V pin - use an external supply.',
      'If the motor direction is reversed, swap the motor wire connections.',
      'Add a capacitor (0.1uF) across motor terminals to reduce electrical noise.'
    ]
  },
  {
    id: 'servo',
    title: 'Servo Motor',
    category: 'motor',
    difficulty: 'intermediate',
    description:
      'Control a servo motor to precise angles. Learn about servo PWM signals and position control.',
    components: [
      { name: 'SG90 Micro Servo', quantity: 1 },
      { name: 'Jumper Wires', quantity: 3 }
    ],
    theory:
      'A servo motor rotates to a specific angle (typically 0-180°) based on a PWM signal. The standard servo signal is a 50Hz PWM where the pulse width determines the angle: 0.5ms = 0°, 1.5ms = 90°, 2.5ms = 180°. In terms of duty cycle at 50Hz: 2.5% = 0°, 7.5% = 90°, 12.5% = 180°. The servo has 3 wires: brown/black=GND, red=5V, orange/yellow=signal.',
    wiring: [
      { from: 'GPIO18 (cobbler)', to: 'Servo signal (orange wire)', description: 'PWM control — row 22' },
      { from: '5V (cobbler)', to: 'Servo power (red wire)', description: 'Servo power — row 23' },
      { from: 'GND (cobbler)', to: 'Servo ground (brown wire)', description: 'Servo ground — row 24' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO18', to: 'row:22:a', color: '#F97316' },
        { from: 'cobbler:5V', to: 'row:23:a', color: '#EF4444' },
        { from: 'cobbler:GND', to: 'row:24:a', color: '#333333' }
      ],
      components: [],
      highlightPins: ['GPIO18', '5V', 'GND'],
      highlightRows: [22, 23, 24]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

SERVO_PIN = 18
GPIO.setup(SERVO_PIN, GPIO.OUT)

# Servo needs 50Hz PWM
pwm = GPIO.PWM(SERVO_PIN, 50)
pwm.start(0)

def set_angle(angle):
    """Set servo to specific angle (0-180)"""
    duty = 2.5 + (angle / 180) * 10  # Map 0-180 to 2.5-12.5
    pwm.ChangeDutyCycle(duty)
    time.sleep(0.5)
    pwm.ChangeDutyCycle(0)  # Stop sending signal to prevent jitter

print("Servo Motor Control")
print("Press Ctrl+C to stop")

try:
    print("Moving to 0 degrees")
    set_angle(0)
    time.sleep(1)

    print("Moving to 90 degrees")
    set_angle(90)
    time.sleep(1)

    print("Moving to 180 degrees")
    set_angle(180)
    time.sleep(1)

    # Sweep back and forth
    print("Sweeping...")
    while True:
        for angle in range(0, 181, 10):
            set_angle(angle)
            time.sleep(0.05)
        for angle in range(180, -1, -10):
            set_angle(angle)
            time.sleep(0.05)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    pwm.stop()
    GPIO.cleanup()
`,
    tips: [
      'Setting duty cycle to 0 after moving prevents jitter/buzzing.',
      'The SG90 servo can only rotate 0-180 degrees. Continuous rotation servos work differently.',
      'If the servo jitters, try a separate 5V power supply instead of the Pi.'
    ]
  },
  {
    id: 'lcd-display',
    title: 'LCD Display (I2C)',
    category: 'display',
    difficulty: 'intermediate',
    description:
      'Display text on a 16x2 LCD screen via I2C. Learn I2C communication protocol and character display basics.',
    components: [
      { name: '16x2 LCD with I2C Adapter', quantity: 1 },
      { name: 'Jumper Wires', quantity: 4 }
    ],
    theory:
      'I2C (Inter-Integrated Circuit) is a 2-wire protocol: SDA (data) and SCL (clock). Multiple devices can share the same bus, each with a unique address (the LCD adapter is usually 0x27 or 0x3F). The I2C LCD adapter converts I2C commands into the parallel signals the LCD controller needs. Enable I2C in raspi-config before using. The LCD has 2 rows of 16 characters each.',
    wiring: [
      { from: 'GPIO2/SDA (Pin 3)', to: 'LCD SDA', description: 'I2C data' },
      { from: 'GPIO3/SCL (Pin 5)', to: 'LCD SCL', description: 'I2C clock' },
      { from: '5V (Pin 2)', to: 'LCD VCC', description: 'LCD power' },
      { from: 'GND (Pin 6)', to: 'LCD GND', description: 'LCD ground' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO2', to: 'row:22:a', color: '#3B82F6' },
        { from: 'cobbler:GPIO3', to: 'row:23:a', color: '#3B82F6' },
        { from: 'cobbler:5V', to: 'row:24:a', color: '#EF4444' },
        { from: 'cobbler:GND', to: 'row:25:a', color: '#333333' }
      ],
      components: [],
      highlightPins: ['GPIO2', 'GPIO3', '5V', 'GND'],
      highlightRows: [22, 23, 24, 25]
    },
    pythonCode: `import smbus2
import time

# I2C LCD constants
LCD_ADDR = 0x27  # Try 0x3F if 0x27 doesn't work
LCD_WIDTH = 16
LCD_CHR = 1  # Data mode
LCD_CMD = 0  # Command mode
LCD_BACKLIGHT = 0x08
ENABLE = 0b00000100

# LCD commands
LCD_LINE_1 = 0x80  # Row 1
LCD_LINE_2 = 0xC0  # Row 2

bus = smbus2.SMBus(1)  # I2C bus 1

def lcd_byte(bits, mode):
    """Send byte to LCD in 4-bit mode"""
    high = mode | (bits & 0xF0) | LCD_BACKLIGHT
    low = mode | ((bits << 4) & 0xF0) | LCD_BACKLIGHT
    bus.write_byte(LCD_ADDR, high)
    lcd_toggle(high)
    bus.write_byte(LCD_ADDR, low)
    lcd_toggle(low)

def lcd_toggle(bits):
    time.sleep(0.0005)
    bus.write_byte(LCD_ADDR, bits | ENABLE)
    time.sleep(0.0005)
    bus.write_byte(LCD_ADDR, bits & ~ENABLE)
    time.sleep(0.0005)

def lcd_init():
    lcd_byte(0x33, LCD_CMD)
    lcd_byte(0x32, LCD_CMD)
    lcd_byte(0x06, LCD_CMD)
    lcd_byte(0x0C, LCD_CMD)
    lcd_byte(0x28, LCD_CMD)
    lcd_byte(0x01, LCD_CMD)
    time.sleep(0.005)

def lcd_string(message, line):
    lcd_byte(line, LCD_CMD)
    message = message.ljust(LCD_WIDTH)
    for char in message:
        lcd_byte(ord(char), LCD_CHR)

print("LCD Display Demo")
print("Press Ctrl+C to stop")

try:
    lcd_init()
    lcd_string("GPIO Dashboard", LCD_LINE_1)
    lcd_string("Hello World!", LCD_LINE_2)
    time.sleep(3)

    count = 0
    while True:
        lcd_string("Counter:", LCD_LINE_1)
        lcd_string(str(count), LCD_LINE_2)
        count += 1
        time.sleep(1)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    lcd_byte(0x01, LCD_CMD)  # Clear display
    bus.close()
`,
    tips: [
      'Run "sudo i2cdetect -y 1" to find your LCD address (usually 0x27 or 0x3F).',
      'Enable I2C in raspi-config: Interface Options > I2C > Enable.',
      'Adjust the contrast potentiometer on the I2C adapter if the display is blank.'
    ]
  },
  {
    id: 'seven-segment',
    title: '7-Segment Display',
    category: 'display',
    difficulty: 'intermediate',
    description:
      'Drive a single 7-segment display to show digits 0-9. Learn how segment displays work and digit encoding.',
    components: [
      { name: '7-Segment Display (Common Cathode)', quantity: 1 },
      { name: '220Ω Resistor', quantity: 8 },
      { name: 'Jumper Wires', quantity: 9 }
    ],
    theory:
      'A 7-segment display has 7 LEDs (segments a-g) plus a decimal point (dp) arranged in a figure-8 pattern. By lighting specific segments, we can display digits 0-9 and some letters. Each segment connects to a GPIO pin through a resistor. Common cathode displays share ground; common anode share power. We define each digit as a pattern of which segments to light.',
    wiring: [
      { from: 'GPIO17 (cobbler)', to: 'Row 22 → Segment a', description: '220Ω resistor in-line, row 22' },
      { from: 'GPIO18 (cobbler)', to: 'Row 23 → Segment b', description: '220Ω resistor in-line, row 23' },
      { from: 'GPIO27 (cobbler)', to: 'Row 24 → Segment c', description: '220Ω resistor in-line, row 24' },
      { from: 'GPIO22 (cobbler)', to: 'Row 25 → Segment d', description: '220Ω resistor in-line, row 25' },
      { from: 'GPIO23 (cobbler)', to: 'Row 26 → Segment e', description: '220Ω resistor in-line, row 26' },
      { from: 'GPIO24 (cobbler)', to: 'Row 27 → Segment f', description: '220Ω resistor in-line, row 27' },
      { from: 'GPIO25 (cobbler)', to: 'Row 28 → Segment g', description: '220Ω resistor in-line, row 28' },
      { from: 'GPIO5 (cobbler)', to: 'Row 29 → Segment dp', description: '220Ω resistor in-line, row 29' },
      { from: 'Common cathode', to: 'GND (cobbler)', description: 'Display ground pin to GND rail' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO17', to: 'row:22:a', color: '#EF4444' },
        { from: 'cobbler:GPIO18', to: 'row:23:a', color: '#EF4444' },
        { from: 'cobbler:GPIO27', to: 'row:24:a', color: '#EF4444' },
        { from: 'cobbler:GPIO22', to: 'row:25:a', color: '#EF4444' },
        { from: 'cobbler:GPIO23', to: 'row:26:a', color: '#EF4444' },
        { from: 'cobbler:GPIO24', to: 'row:27:a', color: '#EF4444' },
        { from: 'cobbler:GPIO25', to: 'row:28:a', color: '#EF4444' },
        { from: 'cobbler:GPIO5', to: 'row:29:a', color: '#EF4444' }
      ],
      components: [],
      highlightPins: ['GPIO17', 'GPIO18', 'GPIO27', 'GPIO22', 'GPIO23', 'GPIO24', 'GPIO25', 'GPIO5', 'GND'],
      highlightRows: [22, 23, 24, 25, 26, 27, 28, 29]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

# Segments: a, b, c, d, e, f, g, dp
SEGMENTS = [17, 18, 27, 22, 23, 24, 25, 5]

# Digit patterns (a,b,c,d,e,f,g)
DIGITS = {
    0: [1,1,1,1,1,1,0],
    1: [0,1,1,0,0,0,0],
    2: [1,1,0,1,1,0,1],
    3: [1,1,1,1,0,0,1],
    4: [0,1,1,0,0,1,1],
    5: [1,0,1,1,0,1,1],
    6: [1,0,1,1,1,1,1],
    7: [1,1,1,0,0,0,0],
    8: [1,1,1,1,1,1,1],
    9: [1,1,1,1,0,1,1],
}

for pin in SEGMENTS:
    GPIO.setup(pin, GPIO.OUT)
    GPIO.output(pin, GPIO.LOW)

def display_digit(digit):
    pattern = DIGITS.get(digit, [0]*7)
    for i, val in enumerate(pattern):
        GPIO.output(SEGMENTS[i], val)
    GPIO.output(SEGMENTS[7], GPIO.LOW)  # dp off

print("7-Segment Display Counter")
print("Press Ctrl+C to stop")

try:
    while True:
        for d in range(10):
            display_digit(d)
            print(f"Displaying: {d}")
            time.sleep(1)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    for pin in SEGMENTS:
        GPIO.output(pin, GPIO.LOW)
    GPIO.cleanup()
`,
    tips: [
      'Check your display datasheet for the pinout - they vary between manufacturers.',
      'Common cathode: segments light when HIGH. Common anode: segments light when LOW (invert the pattern).',
      'For more digits, use a shift register (74HC595) to reduce GPIO pin usage.'
    ]
  },
  {
    id: 'four-digit-seven-segment',
    title: '4-Digit 7-Segment Display',
    category: 'display',
    difficulty: 'advanced',
    description:
      'Drive a 4-digit 7-segment display using multiplexing. Learn time-division multiplexing to control multiple digits with fewer pins.',
    components: [
      { name: '4-Digit 7-Segment Display', quantity: 1 },
      { name: '220Ω Resistor', quantity: 8 },
      { name: 'Jumper Wires', quantity: 12 }
    ],
    theory:
      'Multiplexing rapidly cycles through each digit, lighting one at a time. At fast enough speed (>100Hz per digit), persistence of vision makes all digits appear lit simultaneously. Each digit has its own cathode pin (D1-D4) that we pull LOW to enable. The segment pins (a-g,dp) are shared between all digits. We rapidly cycle: enable D1 + set segments, disable D1, enable D2 + set segments, etc.',
    wiring: [
      { from: 'GPIO17 (cobbler)', to: 'Row 22 → Segment a', description: '220Ω resistor in-line, row 22' },
      { from: 'GPIO18 (cobbler)', to: 'Row 23 → Segment b', description: '220Ω resistor in-line, row 23' },
      { from: 'GPIO27 (cobbler)', to: 'Row 24 → Segment c', description: '220Ω resistor in-line, row 24' },
      { from: 'GPIO22 (cobbler)', to: 'Row 25 → Segment d', description: '220Ω resistor in-line, row 25' },
      { from: 'GPIO23 (cobbler)', to: 'Row 26 → Segment e', description: '220Ω resistor in-line, row 26' },
      { from: 'GPIO24 (cobbler)', to: 'Row 27 → Segment f', description: '220Ω resistor in-line, row 27' },
      { from: 'GPIO25 (cobbler)', to: 'Row 28 → Segment g', description: '220Ω resistor in-line, row 28' },
      { from: 'GPIO16 (cobbler)', to: 'Row 29 → Segment dp', description: '220Ω resistor in-line, row 29' },
      { from: 'GPIO5 (cobbler)', to: 'Row 30 → Digit 1 cathode', description: 'Digit select D1' },
      { from: 'GPIO6 (cobbler)', to: 'Row 31 → Digit 2 cathode', description: 'Digit select D2' },
      { from: 'GPIO12 (cobbler)', to: 'Row 32 → Digit 3 cathode', description: 'Digit select D3' },
      { from: 'GPIO13 (cobbler)', to: 'Row 33 → Digit 4 cathode', description: 'Digit select D4' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO17', to: 'row:22:a', color: '#EF4444' },
        { from: 'cobbler:GPIO5', to: 'row:26:a', color: '#22C55E' },
        { from: 'cobbler:GPIO6', to: 'row:27:a', color: '#22C55E' },
        { from: 'cobbler:GPIO12', to: 'row:28:a', color: '#22C55E' },
        { from: 'cobbler:GPIO13', to: 'row:29:a', color: '#22C55E' }
      ],
      components: [],
      highlightPins: ['GPIO17', 'GPIO18', 'GPIO27', 'GPIO22', 'GPIO23', 'GPIO24', 'GPIO25', 'GPIO16', 'GPIO5', 'GPIO6', 'GPIO12', 'GPIO13'],
      highlightRows: [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time
import threading

GPIO.setmode(GPIO.BCM)

# Segment pins (a through g + dp)
SEGMENTS = [17, 18, 27, 22, 23, 24, 25, 16]
# Digit select pins (D1-D4, active LOW)
DIGITS_PINS = [5, 6, 12, 13]

DIGIT_PATTERNS = {
    0: [1,1,1,1,1,1,0], 1: [0,1,1,0,0,0,0],
    2: [1,1,0,1,1,0,1], 3: [1,1,1,1,0,0,1],
    4: [0,1,1,0,0,1,1], 5: [1,0,1,1,0,1,1],
    6: [1,0,1,1,1,1,1], 7: [1,1,1,0,0,0,0],
    8: [1,1,1,1,1,1,1], 9: [1,1,1,1,0,1,1],
    ' ': [0,0,0,0,0,0,0],
}

for pin in SEGMENTS + DIGITS_PINS:
    GPIO.setup(pin, GPIO.OUT)

display_value = [' ', ' ', ' ', ' ']
running = True

def multiplex():
    while running:
        for i, dpin in enumerate(DIGITS_PINS):
            # Disable all digits
            for dp in DIGITS_PINS:
                GPIO.output(dp, GPIO.HIGH)

            # Set segments for this digit
            pattern = DIGIT_PATTERNS.get(display_value[i], [0]*7)
            for j, val in enumerate(pattern):
                GPIO.output(SEGMENTS[j], val)

            # Enable this digit
            GPIO.output(dpin, GPIO.LOW)
            time.sleep(0.003)  # 3ms per digit = ~83Hz refresh

# Start multiplexing in background thread
thread = threading.Thread(target=multiplex, daemon=True)
thread.start()

print("4-Digit 7-Segment Counter")
print("Press Ctrl+C to stop")

try:
    count = 0
    while True:
        # Convert number to 4 digits
        s = str(count).rjust(4)
        display_value[:] = [int(c) if c != ' ' else ' ' for c in s]
        print(f"Displaying: {count}")
        count = (count + 1) % 10000
        time.sleep(0.1)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    running = False
    thread.join(timeout=1)
    GPIO.cleanup()
`,
    tips: [
      'If digits flicker, decrease the delay between digit switches.',
      'Use a threading approach to keep multiplexing smooth while your main code runs.',
      'For a real clock display, use a dedicated chip like TM1637 which handles multiplexing for you.'
    ]
  },
  {
    id: 'shift-register',
    title: 'Shift Register (74HC595)',
    category: 'advanced',
    difficulty: 'intermediate',
    description:
      'Expand GPIO outputs with a shift register. Control 8 LEDs using only 3 GPIO pins. Learn serial-to-parallel conversion.',
    components: [
      { name: '74HC595 Shift Register', quantity: 1 },
      { name: 'LED', quantity: 8 },
      { name: '220Ω Resistor', quantity: 8 },
      { name: 'Jumper Wires', quantity: 11 }
    ],
    theory:
      'The 74HC595 converts serial data (one bit at a time) into 8 parallel outputs. It uses 3 control pins: Data (DS/SER), Clock (SHCP/SRCLK), and Latch (STCP/RCLK). To send a byte: set Data pin to bit value, pulse Clock to shift it in, repeat for 8 bits, then pulse Latch to output all 8 bits simultaneously. You can chain multiple 595s for even more outputs.',
    wiring: [
      { from: 'GPIO17 (cobbler)', to: '74HC595 Pin 14 (DS)', description: 'Serial data — row 22' },
      { from: 'GPIO18 (cobbler)', to: '74HC595 Pin 11 (SHCP)', description: 'Shift clock — row 23' },
      { from: 'GPIO27 (cobbler)', to: '74HC595 Pin 12 (STCP)', description: 'Latch clock — row 24' },
      { from: '3V3 (cobbler)', to: '74HC595 Pin 16 (VCC) + Pin 10 (MR)', description: 'Power + master reset HIGH' },
      { from: 'GND (cobbler)', to: '74HC595 Pin 8 (GND) + Pin 13 (OE)', description: 'Ground + output enable LOW' },
      { from: '74HC595 Q0–Q7', to: '220Ω resistors → 8 LEDs', description: 'Each output through a resistor to an LED' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO17', to: 'row:22:a', color: '#F97316' },
        { from: 'cobbler:GPIO18', to: 'row:23:a', color: '#3B82F6' },
        { from: 'cobbler:GPIO27', to: 'row:24:a', color: '#22C55E' }
      ],
      components: [],
      highlightPins: ['GPIO17', 'GPIO18', 'GPIO27', '3V3', 'GND'],
      highlightRows: [22, 23, 24]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

DATA = 17   # DS / SER
CLOCK = 18  # SHCP / SRCLK
LATCH = 27  # STCP / RCLK

GPIO.setup(DATA, GPIO.OUT)
GPIO.setup(CLOCK, GPIO.OUT)
GPIO.setup(LATCH, GPIO.OUT)

def shift_out(byte):
    """Shift out 8 bits, MSB first"""
    GPIO.output(LATCH, GPIO.LOW)
    for i in range(7, -1, -1):
        bit = (byte >> i) & 1
        GPIO.output(DATA, bit)
        GPIO.output(CLOCK, GPIO.HIGH)
        GPIO.output(CLOCK, GPIO.LOW)
    GPIO.output(LATCH, GPIO.HIGH)

print("Shift Register LED Pattern")
print("Press Ctrl+C to stop")

try:
    # Binary counter
    print("Binary counter 0-255:")
    for i in range(256):
        shift_out(i)
        print(f"Value: {i:3d} = {i:08b}")
        time.sleep(0.05)

    # Single LED chase
    print("\\nLED chase:")
    while True:
        for i in range(8):
            shift_out(1 << i)
            time.sleep(0.1)
        for i in range(6, 0, -1):
            shift_out(1 << i)
            time.sleep(0.1)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    shift_out(0)
    GPIO.cleanup()
`,
    tips: [
      'Pin 10 (MR/SRCLR) must be HIGH for normal operation - tie it to VCC.',
      'Pin 13 (OE) must be LOW to enable outputs - tie it to GND.',
      'You can daisy-chain multiple 74HC595s: connect Q7S (pin 9) to the next chip DS input.'
    ]
  },
  {
    id: 'pir-sensor',
    title: 'PIR Motion Sensor',
    category: 'sensor',
    difficulty: 'beginner',
    description:
      'Detect motion with a PIR sensor. Build a simple motion alarm system. Learn digital sensor input and event detection.',
    components: [
      { name: 'HC-SR501 PIR Sensor', quantity: 1 },
      { name: 'LED (Red)', quantity: 1 },
      { name: '220Ω Resistor', quantity: 1 },
      { name: 'Buzzer (optional)', quantity: 1 },
      { name: 'Jumper Wires', quantity: 5 }
    ],
    theory:
      'PIR (Passive Infrared) sensors detect changes in infrared radiation from warm bodies (humans, animals). The HC-SR501 has a Fresnel lens that focuses IR onto a pyroelectric sensor. When motion is detected, the output pin goes HIGH for a configurable duration (adjustable via potentiometer). Two trimpots control: sensitivity (detection range 3-7m) and output delay time (5s-5min).',
    wiring: [
      { from: '5V (cobbler)', to: 'PIR VCC', description: 'Sensor power — row 22' },
      { from: 'GPIO17 (cobbler)', to: 'PIR OUT', description: 'Motion signal input — row 23' },
      { from: 'GND (cobbler)', to: 'PIR GND', description: 'Sensor ground — row 24' },
      { from: 'GPIO18 (cobbler)', to: 'Row 26a', description: 'Alert LED signal jumper wire' },
      { from: 'Row 26c → Row 26e', to: '220Ω Resistor', description: 'LED current-limiting resistor in row 26' },
      { from: 'Row 26e → Row 28e', to: 'Jumper wire', description: 'Connect resistor to LED row' },
      { from: 'Row 28c', to: 'LED', description: 'Alert LED — anode in row 28' },
      { from: 'Row 28a', to: 'GND (cobbler)', description: 'LED ground jumper wire' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:5V', to: 'row:22:a', color: '#EF4444' },
        { from: 'cobbler:GPIO17', to: 'row:23:a', color: '#F97316' },
        { from: 'cobbler:GND', to: 'row:24:a', color: '#333333' },
        { from: 'cobbler:GPIO18', to: 'row:26:a', color: '#22C55E' },
        { from: 'row:29:a', to: 'cobbler:GND', color: '#333333' }
      ],
      components: [
        { type: 'resistor', row: 26, endRow: 27, col: 'c', value: '220Ω' },
        { type: 'led', row: 28, endRow: 29, col: 'c', color: '#EF4444', label: 'Alert LED' }
      ],
      highlightPins: ['GPIO17', 'GPIO18', '5V', 'GND'],
      highlightRows: [22, 23, 24, 26, 27, 28, 29]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

PIR_PIN = 17
LED_PIN = 18

GPIO.setup(PIR_PIN, GPIO.IN)
GPIO.setup(LED_PIN, GPIO.OUT)

print("PIR Motion Sensor")
print("Warming up sensor (30 seconds)...")
time.sleep(2)  # Short delay for demo (normally 30s)
print("Ready! Monitoring for motion...")
print("Press Ctrl+C to stop")

motion_count = 0

try:
    while True:
        if GPIO.input(PIR_PIN):
            motion_count += 1
            GPIO.output(LED_PIN, GPIO.HIGH)
            print(f"Motion detected! (#{motion_count})")
            time.sleep(2)  # Keep LED on briefly
        else:
            GPIO.output(LED_PIN, GPIO.LOW)
        time.sleep(0.1)
except KeyboardInterrupt:
    print(f"\\nTotal motions detected: {motion_count}")
    print("Stopping...")
finally:
    GPIO.cleanup()
`,
    tips: [
      'PIR sensors need 30-60 seconds to calibrate on startup. Be patient.',
      'Adjust the sensitivity and delay trimpots on the sensor module.',
      'The sensor has two modes (jumper): H = repeat trigger, L = single trigger.'
    ]
  },
  {
    id: 'ultrasonic',
    title: 'Ultrasonic Distance Sensor',
    category: 'sensor',
    difficulty: 'intermediate',
    description:
      'Measure distances with the HC-SR04 ultrasonic sensor. Learn pulse timing and the speed of sound.',
    components: [
      { name: 'HC-SR04 Ultrasonic Sensor', quantity: 1 },
      { name: '1kΩ Resistor', quantity: 1 },
      { name: '2kΩ Resistor', quantity: 1 },
      { name: 'Jumper Wires', quantity: 4 }
    ],
    theory:
      'The HC-SR04 sends a 40kHz ultrasonic pulse and measures the time for the echo to return. Distance = (time × speed_of_sound) / 2. Speed of sound ≈ 343 m/s at 20°C. The sensor needs a 10μs trigger pulse on TRIG, then measures the HIGH duration on ECHO. IMPORTANT: ECHO outputs 5V but Pi GPIO is 3.3V, so use a voltage divider (1kΩ + 2kΩ) to reduce ECHO voltage to ~3.3V.',
    wiring: [
      { from: '5V (cobbler)', to: 'HC-SR04 VCC', description: 'Sensor power (must be 5V) — row 22' },
      { from: 'GPIO17 (cobbler)', to: 'HC-SR04 TRIG', description: 'Trigger pulse output — row 23' },
      { from: 'HC-SR04 ECHO', to: 'Row 24f', description: 'Echo signal (5V!) into voltage divider' },
      { from: 'Row 24f → Row 24h', to: '1kΩ Resistor', description: 'Upper resistor of voltage divider — row 24' },
      { from: 'Row 24h', to: 'GPIO18 (cobbler)', description: 'Divided signal (~3.3V) to Pi input' },
      { from: 'Row 25f → Row 25h', to: '2kΩ Resistor', description: 'Lower resistor of voltage divider — row 25' },
      { from: 'Row 25h', to: 'GND (cobbler)', description: 'Voltage divider ground' },
      { from: 'GND (cobbler)', to: 'HC-SR04 GND', description: 'Sensor ground — row 25' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:5V', to: 'row:22:a', color: '#EF4444' },
        { from: 'cobbler:GPIO17', to: 'row:23:a', color: '#F97316' },
        { from: 'cobbler:GPIO18', to: 'row:25:a', color: '#3B82F6' },
        { from: 'cobbler:GND', to: 'row:27:a', color: '#333333' }
      ],
      components: [
        { type: 'resistor', row: 24, endRow: 25, col: 'g', value: '1kΩ' },
        { type: 'resistor', row: 26, endRow: 27, col: 'g', value: '2kΩ' }
      ],
      highlightPins: ['GPIO17', 'GPIO18', '5V', 'GND'],
      highlightRows: [22, 23, 24, 25, 26, 27]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

TRIG = 17
ECHO = 18

GPIO.setup(TRIG, GPIO.OUT)
GPIO.setup(ECHO, GPIO.IN)

GPIO.output(TRIG, False)
print("Ultrasonic Distance Sensor")
print("Waiting for sensor to settle...")
time.sleep(2)
print("Ready! Measuring distance...")
print("Press Ctrl+C to stop")

def measure_distance():
    """Measure distance in centimeters"""
    # Send 10us trigger pulse
    GPIO.output(TRIG, True)
    time.sleep(0.00001)
    GPIO.output(TRIG, False)

    # Wait for echo to start
    timeout = time.time() + 0.1
    while GPIO.input(ECHO) == 0:
        pulse_start = time.time()
        if pulse_start > timeout:
            return -1

    # Wait for echo to end
    timeout = time.time() + 0.1
    while GPIO.input(ECHO) == 1:
        pulse_end = time.time()
        if pulse_end > timeout:
            return -1

    # Calculate distance
    duration = pulse_end - pulse_start
    distance = duration * 34300 / 2  # Speed of sound = 343 m/s
    return round(distance, 1)

try:
    while True:
        dist = measure_distance()
        if dist >= 0:
            bar = "#" * min(int(dist / 2), 50)
            print(f"Distance: {dist:6.1f} cm  {bar}")
        else:
            print("Out of range")
        time.sleep(0.3)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    GPIO.cleanup()
`,
    tips: [
      'CRITICAL: Use the voltage divider on ECHO pin! 5V will damage your Pi.',
      'The sensor range is 2-400cm. Below 2cm readings are unreliable.',
      'For more accuracy, take multiple readings and average them.'
    ]
  },
  {
    id: 'joystick',
    title: 'Analog Joystick (with ADC)',
    category: 'sensor',
    difficulty: 'advanced',
    description:
      'Read an analog joystick using an ADC (ADS1115 or MCP3008). Learn analog-to-digital conversion since the Pi has no built-in ADC.',
    components: [
      { name: 'Analog Joystick Module', quantity: 1 },
      { name: 'ADS1115 ADC Module', quantity: 1 },
      { name: 'Jumper Wires', quantity: 8 }
    ],
    theory:
      'The Raspberry Pi has no analog input pins - it can only read digital HIGH/LOW. An ADC (Analog-to-Digital Converter) bridges this gap. The ADS1115 is a 16-bit I2C ADC with 4 channels. The joystick has two potentiometers (X and Y axes) that output 0-3.3V based on position, plus a digital button. The ADC reads these voltages and converts them to numbers (0-32767) that the Pi can process.',
    wiring: [
      { from: 'GPIO2/SDA', to: 'ADS1115 SDA', description: 'I2C data' },
      { from: 'GPIO3/SCL', to: 'ADS1115 SCL', description: 'I2C clock' },
      { from: '3V3', to: 'ADS1115 VDD + Joystick VCC', description: 'Power' },
      { from: 'GND', to: 'ADS1115 GND + Joystick GND', description: 'Ground' },
      { from: 'Joystick VRx', to: 'ADS1115 A0', description: 'X axis analog' },
      { from: 'Joystick VRy', to: 'ADS1115 A1', description: 'Y axis analog' },
      { from: 'Joystick SW', to: 'GPIO17', description: 'Button (digital)' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO2', to: 'row:22:a', color: '#3B82F6' },
        { from: 'cobbler:GPIO3', to: 'row:23:a', color: '#3B82F6' },
        { from: 'cobbler:3V3', to: 'row:24:a', color: '#F97316' },
        { from: 'cobbler:GND', to: 'row:25:a', color: '#333333' },
        { from: 'cobbler:GPIO17', to: 'row:26:a', color: '#22C55E' }
      ],
      components: [],
      highlightPins: ['GPIO2', 'GPIO3', 'GPIO17', '3V3', 'GND'],
      highlightRows: [22, 23, 24, 25, 26]
    },
    pythonCode: `import RPi.GPIO as GPIO
import smbus2
import time

GPIO.setmode(GPIO.BCM)

# ADS1115 I2C ADC
ADS_ADDR = 0x48
bus = smbus2.SMBus(1)

# Joystick button
BUTTON = 17
GPIO.setup(BUTTON, GPIO.IN, pull_up_down=GPIO.PUD_UP)

def read_adc(channel):
    """Read ADS1115 single-ended channel (0-3)"""
    config = 0x4000 | (0x4000 + channel * 0x1000) | 0x0200 | 0x0100 | 0x0080 | 0x0003
    bus.write_i2c_block_data(ADS_ADDR, 0x01, [(config >> 8) & 0xFF, config & 0xFF])
    time.sleep(0.01)
    data = bus.read_i2c_block_data(ADS_ADDR, 0x00, 2)
    value = (data[0] << 8) | data[1]
    if value > 32767:
        value -= 65536
    return value

print("Joystick Reader (ADS1115 ADC)")
print("Move the joystick and press the button")
print("Press Ctrl+C to stop")

try:
    while True:
        x = read_adc(0)  # X axis on A0
        y = read_adc(1)  # Y axis on A1
        button = not GPIO.input(BUTTON)  # Active LOW

        # Map to -100 to +100 range
        x_pct = int((x / 32767) * 100)
        y_pct = int((y / 32767) * 100)

        btn_str = "PRESSED" if button else "       "
        print(f"X: {x_pct:+4d}%  Y: {y_pct:+4d}%  Button: {btn_str}", end="\\r")
        time.sleep(0.1)
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    bus.close()
    GPIO.cleanup()
`,
    tips: [
      'Enable I2C in raspi-config first.',
      'Run "sudo i2cdetect -y 1" to verify the ADS1115 is detected (usually at 0x48).',
      'The joystick center position should read approximately half of the max value.'
    ]
  },
  {
    id: 'keypad',
    title: '4x4 Matrix Keypad',
    category: 'input',
    difficulty: 'intermediate',
    description:
      'Read a 4x4 matrix keypad using row-column scanning. Learn matrix scanning technique to read 16 keys with only 8 GPIO pins.',
    components: [
      { name: '4x4 Membrane Keypad', quantity: 1 },
      { name: 'Jumper Wires', quantity: 8 }
    ],
    theory:
      'A matrix keypad arranges buttons in rows and columns. A 4x4 keypad has 16 keys but only 8 connections (4 rows + 4 columns). To detect a key press: set one row HIGH, then read all 4 columns. If a column reads HIGH, the key at that row/column intersection is pressed. Cycle through all 4 rows rapidly to scan the entire keypad. This row-column scanning technique is used in keyboards, calculator keypads, and control panels.',
    wiring: [
      { from: 'GPIO17', to: 'Row 1', description: 'Keypad row 1' },
      { from: 'GPIO18', to: 'Row 2', description: 'Keypad row 2' },
      { from: 'GPIO27', to: 'Row 3', description: 'Keypad row 3' },
      { from: 'GPIO22', to: 'Row 4', description: 'Keypad row 4' },
      { from: 'GPIO23', to: 'Col 1', description: 'Keypad column 1' },
      { from: 'GPIO24', to: 'Col 2', description: 'Keypad column 2' },
      { from: 'GPIO25', to: 'Col 3', description: 'Keypad column 3' },
      { from: 'GPIO5', to: 'Col 4', description: 'Keypad column 4' }
    ],
    wiringDiagram: {
      wires: [
        { from: 'cobbler:GPIO17', to: 'row:22:a', color: '#EF4444' },
        { from: 'cobbler:GPIO18', to: 'row:23:a', color: '#EF4444' },
        { from: 'cobbler:GPIO27', to: 'row:24:a', color: '#EF4444' },
        { from: 'cobbler:GPIO22', to: 'row:25:a', color: '#EF4444' },
        { from: 'cobbler:GPIO23', to: 'row:22:j', color: '#3B82F6' },
        { from: 'cobbler:GPIO24', to: 'row:23:j', color: '#3B82F6' },
        { from: 'cobbler:GPIO25', to: 'row:24:j', color: '#3B82F6' },
        { from: 'cobbler:GPIO5', to: 'row:25:j', color: '#3B82F6' }
      ],
      components: [],
      highlightPins: ['GPIO17', 'GPIO18', 'GPIO27', 'GPIO22', 'GPIO23', 'GPIO24', 'GPIO25', 'GPIO5'],
      highlightRows: [22, 23, 24, 25]
    },
    pythonCode: `import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)

# Row pins (output)
ROWS = [17, 18, 27, 22]
# Column pins (input with pull-down)
COLS = [23, 24, 25, 5]

# Key map
KEYS = [
    ['1', '2', '3', 'A'],
    ['4', '5', '6', 'B'],
    ['7', '8', '9', 'C'],
    ['*', '0', '#', 'D']
]

for row in ROWS:
    GPIO.setup(row, GPIO.OUT)
    GPIO.output(row, GPIO.LOW)

for col in COLS:
    GPIO.setup(col, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

def scan_keypad():
    """Scan keypad and return pressed key or None"""
    for i, row in enumerate(ROWS):
        GPIO.output(row, GPIO.HIGH)
        for j, col in enumerate(COLS):
            if GPIO.input(col) == GPIO.HIGH:
                GPIO.output(row, GPIO.LOW)
                return KEYS[i][j]
        GPIO.output(row, GPIO.LOW)
    return None

print("4x4 Keypad Scanner")
print("Press keys on the keypad")
print("Press Ctrl+C to stop")

last_key = None
try:
    while True:
        key = scan_keypad()
        if key and key != last_key:
            print(f"Key pressed: {key}")
        last_key = key
        time.sleep(0.05)  # Debounce delay
except KeyboardInterrupt:
    print("\\nStopping...")
finally:
    GPIO.cleanup()
`,
    tips: [
      'The debounce delay (50ms) prevents reading the same key press multiple times.',
      'Check your keypad pinout - some have rows and columns in different orders.',
      'For more responsive input, use interrupt-driven detection instead of polling.'
    ]
  }
]

export default TUTORIALS

// Helper: get tutorial by ID
export function getTutorialById(id) {
  return TUTORIALS.find((t) => t.id === id)
}

// Helper: get tutorials by category
export function getTutorialsByCategory(category) {
  return TUTORIALS.filter((t) => t.category === category)
}
