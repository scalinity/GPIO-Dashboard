// The Python shims on Pyodide, driving the simulator in virtual time (SPEC 13.2, ADR-0017).
import type { PyodideInterface } from 'pyodide'
import { beforeAll, describe, expect, it } from 'vitest'
import { partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import type { CircuitDoc } from '../core/model/types'
import { BEHAVIORS } from '../core/sim/behaviors'
import { Circuit } from '../core/sim/circuit'
import { SimSession } from '../core/sim/session'
import { emptyDoc } from '../core/testing/fixtures'
import { Bridge } from './bridge'
import { compileCheck, createPython, runProgram } from './python'

let py: PyodideInterface
const out: string[] = []
beforeAll(async () => {
  py = await createPython({ stdout: (t) => out.push(t), stderr: (t) => out.push(t) })
}, 30_000)

/** Runs a program for up to `seconds` of virtual time, sampling the circuit at every sleep. */
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

describe('Python shims', () => {
  it('report a syntax error with its line', () => {
    expect(compileCheck(py, 'x = 1\nif x\n    pass\n')).toEqual([
      { line: 2, column: 5, message: "expected ':'" }
    ])
    expect(compileCheck(py, 'x = 1\n')).toEqual([])
  })

  it("run Blinking LED's own code: D1 lights and goes dark in turn, and Ctrl+C ends it cleanly", () => {
    const tutorial = TUTORIALS.find((t) => t.meta.id === 'blinking-led')!
    const currents: number[] = []
    const bridge = run(tutorial.doc, tutorial.doc.code.source, 2.2, (b) =>
      currents.push(b.session.snapshot().dies['D1.D']!.currentA)
    )
    expect(currents.some((i) => i >= 1e-3)).toBe(true)
    expect(currents.some((i) => i < 1e-6)).toBe(true)
    expect(out.filter((l) => l === 'LED on').length).toBeGreaterThanOrEqual(2)
    expect(bridge.now()).toBeGreaterThanOrEqual(2.2)
  })

  it('keep virtual time: a busy loop advances the clock call by call', () => {
    const bridge = run(
      emptyDoc(),
      'import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(17, GPIO.IN)\nfor _ in range(1000):\n    GPIO.input(17)\n',
      10
    )
    expect(bridge.now()).toBeCloseTo(1001 * 5e-6, 9)
  })

  it('raise what RPi.GPIO raises when the numbering mode is not set', () => {
    expect(() => run(emptyDoc(), 'import RPi.GPIO as GPIO\nGPIO.setup(17, GPIO.OUT)\n', 1)).toThrow(
      /Please set pin numbering mode/
    )
  })

  it('raise OSError 121 for an I2C device that is not on the bus, as Linux does', () => {
    run(
      emptyDoc(),
      'import smbus\nbus = smbus.SMBus(1)\ntry:\n    bus.read_byte(0x48)\nexcept OSError as e:\n    print(e.errno)\n',
      1
    )
    expect(out).toEqual(['121'])
  })

  it("run gpiozero's background blink as PWM on the pin", () => {
    const bridge = run(
      emptyDoc(),
      'from gpiozero import LED\nled = LED(17)\nled.blink(0.25, 0.75)\n',
      1
    )
    expect(bridge.session.snapshot().gpio[17]).toBeDefined()
  })

  it('end input() with EOFError instead of waiting for a keyboard', () => {
    run(emptyDoc(), 'try:\n    input("Text: ")\nexcept EOFError:\n    print("eof")\n', 1)
    expect(out.join('')).toMatch(/eof$/)
  })

  it('clear a stop raised during a run, so the next call is not interrupted', () => {
    const interrupt = new Int32Array(new SharedArrayBuffer(4))
    const bridge = new Bridge(new SimSession(new Circuit(emptyDoc(), partDef, BEHAVIORS)))
    // The stop arrives inside the program's last sleep, as a passing code check sends it.
    const stopNow = () => (interrupt[0] = 2)
    try {
      runProgram(py, bridge, 'import time\ntime.sleep(1)\n', stopNow, interrupt)
    } catch {
      // KeyboardInterrupt, if Python checked the flag before the program ended.
    }
    expect(interrupt[0]).toBe(0)
    expect(compileCheck(py, 'z = 3\n')).toEqual([])
  })
})
