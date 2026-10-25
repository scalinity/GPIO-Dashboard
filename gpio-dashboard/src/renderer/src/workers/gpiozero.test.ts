// The gpiozero shim and signal.pause on Pyodide, against the simulator's own part models
// (SPEC 13.2, ADR-0017). Each program is real gpiozero code; the circuit under it is a tutorial's.
import type { PyodideInterface } from 'pyodide'
import { beforeAll, describe, expect, it } from 'vitest'
import { GPIOZERO_CLASSES } from '../core/code/pins'
import { partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import type { CircuitDoc } from '../core/model/types'
import { BEHAVIORS } from '../core/sim/behaviors'
import { Circuit } from '../core/sim/circuit'
import { SimSession } from '../core/sim/session'
import { emptyDoc } from '../core/testing/fixtures'
import { Bridge } from './bridge'
import { createPython, runProgram } from './python'

let py: PyodideInterface
const out: string[] = []
beforeAll(async () => {
  py = await createPython({ stdout: (t) => out.push(t), stderr: (t) => out.push(t) })
}, 30_000)

/** A tutorial's circuit, copied so a test can set a part's property. */
const tutorial = (id: string): CircuitDoc =>
  structuredClone(TUTORIALS.find((t) => t.meta.id === id)!.doc)

/**
 * Runs a program for up to `seconds` of virtual time and ends it as Ctrl+C would. `sample` runs at
 * every sleep, where a test changes a part's input.
 */
function run(doc: CircuitDoc, source: string, seconds: number, sample?: (b: Bridge) => void) {
  const bridge = new Bridge(new SimSession(new Circuit(doc, partDef, BEHAVIORS)))
  const interrupt = new Int32Array(new SharedArrayBuffer(4))
  const sleep = (s: number) => {
    bridge.sleep(s)
    sample?.(bridge)
    if (bridge.now() >= seconds) interrupt[0] = 2
  }
  out.length = 0
  runProgram(py, bridge, source, sleep, interrupt)
  return bridge
}

/** A program that waits for its run to end, then returns, as `signal.pause()` does on a Pi. */
const pauseThen = (...lines: string[]) =>
  [
    'from signal import pause',
    ...lines,
    'try:',
    '    pause()',
    'except KeyboardInterrupt:',
    '    pass',
    ''
  ].join('\n')

/** Presses and releases the tutorial button's switch at the given virtual times. */
const press = (at: number, release: number) => {
  const done = { down: false, up: false }
  return (b: Bridge) => {
    if (!done.down && b.now() >= at) {
      done.down = true
      b.setInput('SW1', 'pressed', true)
    } else if (done.down && !done.up && b.now() >= release) {
      done.up = true
      b.setInput('SW1', 'pressed', false)
    }
  }
}

describe('signal.pause', () => {
  it('waits in virtual time until the run ends, instead of returning at once', () => {
    const bridge = run(
      emptyDoc(),
      'import signal\ntry:\n    signal.pause()\nexcept KeyboardInterrupt:\n    print("interrupted")\n',
      3
    )
    expect(bridge.now()).toBeGreaterThanOrEqual(3)
    expect(out).toEqual(['interrupted'])
  })

  it('lets a callback run when an input changes while the program pauses', () => {
    const bridge = run(
      tutorial('button'),
      pauseThen(
        'from gpiozero import Button',
        'button = Button(18)',
        'button.when_pressed = lambda: print("pressed")',
        'button.when_released = lambda: print("released")'
      ),
      2,
      press(0.5, 1)
    )
    expect(bridge.now()).toBeGreaterThanOrEqual(2)
    expect(out).toEqual(['pressed', 'released'])
  })
})

describe('the gpiozero shim', () => {
  it('has every class that the code reader knows', () => {
    run(emptyDoc(), `from gpiozero import ${GPIOZERO_CLASSES.join(', ')}\nprint("imported")\n`, 1)
    expect(out).toEqual(['imported'])
  })

  it('passes the device to a callback that takes one', () => {
    run(
      tutorial('button'),
      pauseThen(
        'from gpiozero import Button',
        'b = Button(18)',
        'b.when_pressed = lambda device: print(type(device).__name__, device.is_pressed)'
      ),
      2,
      press(0.5, 5)
    )
    expect(out).toEqual(['Button True'])
  })

  it('reads a LineSensor, InputDevice and DigitalInputDevice, and drives the output devices', () => {
    const bridge = run(
      tutorial('button'),
      [
        'from gpiozero import LineSensor, OutputDevice, PWMOutputDevice, InputDevice, DigitalInputDevice',
        'line = LineSensor(18)',
        'print(line.line_detected, line.value)',
        'out = OutputDevice(17)',
        'out.on()',
        'print(out.value)',
        'pwm = PWMOutputDevice(12, frequency=200, initial_value=0.25)',
        'print(pwm.value, pwm.is_active)',
        'plain = InputDevice(22, pull_up=True)',
        'print(plain.is_active, plain.value)',
        'digital = DigitalInputDevice(23, pull_up=None, active_state=True)',
        'print(digital.is_active)',
        ''
      ].join('\n'),
      1
    )
    // GPIO18 idles high (the tutorial's pull-up), which a LineSensor reads as no line.
    expect(out).toEqual(['False 1', '1', '0.25 True', 'False 0', 'False'])
    expect(bridge.session.snapshot().gpio[17]).toBeDefined()
  })

  it('measures distance with a DistanceSensor on the HC-SR04 model, in metres', () => {
    for (const cm of [50, 120, 300]) {
      const doc = tutorial('ultrasonic')
      doc.parts.find((p) => p.id === 'HC1')!.props.distanceCm = cm
      run(
        doc,
        'from gpiozero import DistanceSensor\ns = DistanceSensor(echo=18, trigger=17, max_distance=4)\nprint(s.distance, s.value)\n',
        5
      )
      const [metres, value] = out[0]!.split(' ').map(Number)
      // The module's 58 us per cm against gpiozero's 343.26 m/s, and one 5 us step of the clock.
      expect(Math.abs(metres! - cm / 100) / (cm / 100), `${cm} cm`).toBeLessThan(0.01)
      expect(value).toBeCloseTo(metres! / 4, 9)
    }
  })

  it('reads the maximum, with a warning, when nothing answers on the echo pin', () => {
    run(
      emptyDoc(),
      'from gpiozero import DistanceSensor\ns = DistanceSensor(echo=18, trigger=17)\nprint(s.distance)\n',
      5
    )
    expect(out.join('\n')).toMatch(/DistanceSensorNoEcho/)
    expect(out.at(-1)).toBe('1')
  })

  it('runs when_in_range and when_out_of_range as the distance crosses the threshold', () => {
    const doc = tutorial('ultrasonic')
    doc.parts.find((p) => p.id === 'HC1')!.props.distanceCm = 80
    let step = 0
    run(
      doc,
      pauseThen(
        'from gpiozero import DistanceSensor',
        'sensor = DistanceSensor(echo=18, trigger=17, threshold_distance=0.3)',
        'sensor.when_in_range = lambda: print("in range", round(sensor.distance, 1))',
        'sensor.when_out_of_range = lambda: print("out of range", round(sensor.distance, 1))'
      ),
      4,
      (bridge) => {
        if (step === 0 && bridge.now() >= 1) {
          step = 1
          bridge.setInput('HC1', 'distanceCm', 10)
        } else if (step === 1 && bridge.now() >= 2) {
          step = 2
          bridge.setInput('HC1', 'distanceCm', 100)
        }
      }
    )
    expect(out).toEqual(['in range 0.1', 'out of range 1.0'])
  })

  it('drives a servo by pulse width: Servo and AngularServo reach the SG90 angle they ask for', () => {
    const angle = (source: string) => {
      const bridge = run(
        tutorial('servo'),
        `${source}import time\ntry:\n    time.sleep(5)\nexcept KeyboardInterrupt:\n    pass\n`,
        1.5
      )
      return (bridge.session.snapshot().parts.SV1 as { angleDeg: number }).angleDeg
    }
    expect(angle('from gpiozero import Servo\ns = Servo(18)\ns.max()\n')).toBeCloseTo(90, 0)
    expect(angle('from gpiozero import Servo\ns = Servo(18)\ns.min()\n')).toBeCloseTo(-90, 0)
    expect(
      angle('from gpiozero import AngularServo\ns = AngularServo(18)\ns.angle = 45\n')
    ).toBeCloseTo(45, 0)
    expect(
      angle(
        'from gpiozero import AngularServo\ns = AngularServo(18, min_angle=0, max_angle=180)\ns.angle = 135\n'
      )
    ).toBeCloseTo(45, 0)
  })

  it('lights each colour of an RGBLED on its own pin', () => {
    const lit = (source: string) => {
      const dies: Record<string, number> = {}
      run(
        tutorial('rgb-led'),
        `from gpiozero import RGBLED\n${source}import time\ntry:\n    time.sleep(1)\nexcept KeyboardInterrupt:\n    pass\n`,
        0.2,
        (b) => {
          for (const [key, die] of Object.entries(b.session.snapshot().dies))
            dies[key] = Math.max(dies[key] ?? 0, die.currentA)
        }
      )
      return Object.keys(dies)
        .filter((key) => dies[key]! > 1e-3)
        .sort()
    }
    expect(lit('led = RGBLED(17, 18, 27)\nled.color = (0, 1, 0)\n')).toEqual(['D1.G'])
    expect(lit('led = RGBLED(17, 18, 27)\nled.red = 1\nled.blue = 1\n')).toEqual(['D1.B', 'D1.R'])
    expect(lit('led = RGBLED(17, 18, 27, pwm=False)\nled.color = (1, 0, 1)\n')).toEqual([
      'D1.B',
      'D1.R'
    ])
  })

  it('calls when_motion from a MotionSensor on the HC-SR501 once its warm-up is over', () => {
    const doc = tutorial('pir')
    doc.parts.find((p) => p.id === 'U1')!.props.motion = true
    run(
      doc,
      pauseThen(
        'from gpiozero import MotionSensor',
        'pir = MotionSensor(17)',
        'pir.when_motion = lambda: print("motion", pir.motion_detected)'
      ),
      70
    )
    expect(out).toEqual(['motion True'])
  })
})
