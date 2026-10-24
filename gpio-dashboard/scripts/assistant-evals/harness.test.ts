// The harness itself, with no recorded run: the app's hand-written blink conversation goes through
// the same client, context and scores a live run does, and the seeds build their documents.
import sampleBlink from '@renderer/content/samples/sample-blink.gpiob?raw'
import { partDef } from '@renderer/core/defs/parts'
import { parse } from '@renderer/core/serialize/gpiob'
import { BLINK_SCRIPT } from '@renderer/assistant/testing/blinkScript'
import { scriptedFetch, testClient } from '@renderer/assistant/testing/sse'
import { beforeAll, describe, expect, it } from 'vitest'
import { erc } from '@renderer/core/erc/erc'
import { PythonRuntime } from './nodeContext'
import { promptById } from './prompts'
import { execute, score } from './runner'

let python: PythonRuntime
beforeAll(async () => {
  python = await PythonRuntime.load(`${import.meta.dirname}/../../node_modules/pyodide/`)
}, 60_000)

describe('the blink conversation through the Node context', () => {
  it('passes every score a live run is held to', async () => {
    const prompt = promptById('blink-led')!
    const outcome = await execute(
      prompt,
      undefined,
      testClient(scriptedFetch(BLINK_SCRIPT).fetch),
      python
    )
    const checks = score(outcome.run)
    expect(checks.filter((c) => !c.pass)).toEqual([])
    expect(checks.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'erc',
        'convention',
        'code.pins',
        'sim.on',
        'sim.program',
        'undo.all'
      ])
    )
    expect(outcome.requests).toBe(BLINK_SCRIPT.length)
  }, 60_000)
})

describe('run_code_in_sim', () => {
  const blink = () => {
    const doc = parse(sampleBlink)
    doc.code.source = [
      'from gpiozero import LED',
      'from time import sleep',
      'led = LED(17)',
      'try:',
      '    while True:',
      '        led.on()',
      '        sleep(0.5)',
      '        led.off()',
      '        sleep(0.5)',
      'finally:',
      '    led.off()',
      ''
    ].join('\n')
    return doc
  }

  it('stops where the virtual clock says, the same every time', () => {
    const ends = [1, 2, 3].map(() => python.run(blink(), partDef, 3).events.at(-1))
    expect(ends[0]).toMatchObject({ bcm: 17, event: 'low' })
    expect(ends[0]!.t).toBeCloseTo(3, 2)
    expect(ends[1]).toEqual(ends[0])
    expect(ends[2]).toEqual(ends[0])
  })

  it('reports an error in the program, and a normal stop as no error', () => {
    const doc = blink()
    expect(python.run(doc, partDef, 1).error).toBeNull()
    doc.code.source = 'import nothing_here_exists\n'
    expect(python.run(doc, partDef, 1).error).toMatch(/nothing_here_exists/)
  })

  it('runs an event-driven program to the end of its time: pause() waits in virtual time', () => {
    const doc = parse(sampleBlink)
    doc.code.source = [
      'from signal import pause',
      'from gpiozero import LED',
      'led = LED(17)',
      'try:',
      '    led.on()',
      '    pause()',
      'finally:',
      '    led.off()',
      ''
    ].join('\n')
    expect(python.run(doc, partDef, 2).events.at(-1)!.t).toBeGreaterThanOrEqual(2)
    // Each run starts from a fresh interpreter state.
    expect(python.run(doc, partDef, 1).events.at(-1)!.t).toBeGreaterThanOrEqual(1)
  })
})

describe('the seeds', () => {
  it('give the debugging prompt a diverged GPIO18 and candidates that name the missing lead', () => {
    const seed = promptById('debug-board-sense')!.seed!(partDef)
    expect(seed.sense?.on).toBe(true)
    const states = new Map(seed.sense!.states)
    expect(states.get(18)).toMatchObject({ state: 'diverged' })
    const text = (seed.sense!.candidates[18] ?? [])
      .flatMap((r) => r.candidates.map((c) => c.text))
      .join(' | ')
    expect(text).toMatch(/W2/)
    expect(erc(seed.doc, partDef).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('give the explanation prompt the blink sample', () => {
    const seed = promptById('explain-no-change')!.seed!(partDef)
    expect(seed.doc.parts.map((p) => p.defId)).toEqual(['resistor', 'led'])
  })
})
