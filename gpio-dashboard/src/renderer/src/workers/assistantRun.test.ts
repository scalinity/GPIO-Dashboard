// The assistant's run_code_in_sim on Pyodide: a program runs for a set time in virtual time, and
// every pin change it makes comes back in order.
import type { PyodideInterface } from 'pyodide'
import { beforeAll, describe, expect, it } from 'vitest'
import { BLINK_CODE } from '../assistant/testing/blinkScript'
import { newDoc } from '../core/model/defaults'
import type { CircuitDoc } from '../core/model/types'
import { Output, runFor } from './assistantRun'
import { createPython } from './python'

let py: PyodideInterface
const output = new Output()
beforeAll(async () => {
  py = await createPython({
    stdout: (t) => output.write('stdout', t),
    stderr: (t) => output.write('stderr', t)
  })
}, 30_000)

const withCode = (source: string): CircuitDoc => {
  const doc = newDoc('Test', '2026-10-24T00:00:00.000Z')
  return { ...doc, code: { ...doc.code, library: 'gpiozero', source } }
}

const run = (source: string, seconds: number) =>
  runFor(py, output, withCode(source), seconds, new Int32Array(new SharedArrayBuffer(4)))

describe('the assistant’s run in the simulator', () => {
  it('runs a blinking LED for the time asked and records each change of the pin', () => {
    const result = run(BLINK_CODE, 2.2)
    expect(result.error).toBeNull()
    const pin17 = result.events.filter((e) => e.bcm === 17)
    expect(pin17.map((e) => e.event)).toEqual(['low', 'high', 'low', 'high', 'low', 'high'])
    const times = pin17.slice(1).map((e) => Math.round(e.t * 10) / 10)
    expect(times).toEqual([0, 0.5, 1, 1.5, 2])
    expect(result.truncated).toBe(false)
  })

  it('returns what the program printed, and the error that ended it', () => {
    const result = run('print("hello")\nraise ValueError("nope")\n', 5)
    expect(result.stdout).toContain('hello')
    expect(result.error).toMatch(/ValueError: nope/)
  })

  it('stops a program that polls without sleeping once its time is up', () => {
    const result = run(
      'import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(4, GPIO.IN, pull_up_down=GPIO.PUD_UP)\nwhile True:\n    GPIO.input(4)\n',
      0.01
    )
    expect(result.error).toBeNull()
    expect(result.events).toEqual([{ t: expect.any(Number), bcm: 4, event: 'input, pull-up' }])
  })
})
