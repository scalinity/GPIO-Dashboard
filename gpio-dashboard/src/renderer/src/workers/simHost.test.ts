// The sim worker's host on the samples (PLAN 3.5: blink and button behave).
import { describe, expect, it } from 'vitest'
import { SAMPLES } from '../core/defs/samples'
import { SimHost, type SimResponse } from './simHost'

const doc = (id: string) => SAMPLES.find((s) => s.id === id)!.doc
const state = (r: SimResponse) => {
  if (r.type !== 'state') throw new Error(JSON.stringify(r))
  return r
}

describe('SimHost', () => {
  it('blinks the sample LED', () => {
    const host = new SimHost()
    state(host.handle({ type: 'load', doc: doc('sample-blink') }))
    const on = state(host.handle({ type: 'gpio', bcm: 17, state: { mode: 'out', level: true } }))
    expect(on.snapshot.dies['D1.D']!.brightness).toBeGreaterThan(0.5)
    expect(on.issues.filter((i) => i.severity === 'error')).toEqual([])
    const off = state(host.handle({ type: 'gpio', bcm: 17, state: { mode: 'out', level: false } }))
    expect(off.snapshot.dies['D1.D']!.brightness).toBeLessThan(1e-6)
  })

  it('reads the sample button as the user presses it', () => {
    const host = new SimHost()
    host.handle({ type: 'load', doc: doc('sample-button') })
    expect(
      state(host.handle({ type: 'gpio', bcm: 18, state: { mode: 'in', pull: 'off' } })).reads
    ).toEqual({ 18: 'low' })
    expect(
      state(host.handle({ type: 'input', part: 'SW1', key: 'pressed', value: true })).reads
    ).toEqual({ 18: 'high' })
  })

  it('predicts the sample button net as observable to Board Sense', () => {
    const host = new SimHost()
    host.handle({ type: 'load', doc: doc('sample-button') })
    const r = host.handle({ type: 'probe', pins: [17, 18] })
    if (r.type !== 'probe') throw new Error(JSON.stringify(r))
    // Released, the 10 kΩ pull-down holds GPIO18 low under either bias.
    expect(r.signature.bias[18]!.class).toBe('tied-low')
    expect(r.signature.observable).toEqual({ 17: false, 18: true })
  })

  it('answers with an error, not a throw, before anything is loaded', () => {
    expect(new SimHost().handle({ type: 'advance', t: 1 })).toEqual({
      type: 'error',
      message: 'No circuit is loaded'
    })
  })
})
