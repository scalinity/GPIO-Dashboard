// The title column's readouts and caption (SPEC 11.2): what they show for a bench's states.
import { describe, expect, it } from 'vitest'
import type { Issue } from '../core/erc/erc'
import type { Snapshot } from '../core/sim/session'
import { amps, type CaptionState, captionOf, readoutsOf } from './readouts'

function snapshot(gpio: Record<number, number>, error: string | null = null): Snapshot {
  return {
    t: 1,
    nets: {},
    dies: {},
    gpio: Object.fromEntries(
      Object.entries(gpio).map(([bcm, a]) => [bcm, { volts: 0, currentA: a }])
    ),
    rails: { '3V3': 0, '5V': 0 },
    parts: {},
    approximate: false,
    error
  }
}
const issue = (code: string, severity: Issue['severity'], refs: string[] = []): Issue => ({
  code,
  severity,
  refs,
  message: code,
  fix: ''
})
const text = (s: Partial<CaptionState>) =>
  captionOf({
    parts: 3,
    build: null,
    snapshot: null,
    issues: [],
    live: false,
    onPi: false,
    simulating: false,
    ...s
  })
    .map((g) => g.text)
    .join('')

describe('amps', () => {
  it('shows whole µA below 1 mA, mA to one decimal, then A', () => {
    expect(amps(0)).toEqual({ value: '0', unit: 'µA' })
    expect(amps(-4.2e-4)).toEqual({ value: '420', unit: 'µA' })
    expect(amps(5.79e-3)).toEqual({ value: '5.8', unit: 'mA' })
    expect(amps(1.5)).toEqual({ value: '1.50', unit: 'A' })
  })
})

describe('readoutsOf', () => {
  it('shows dashes until there is a simulation', () => {
    expect(readoutsOf(null, []).map((r) => r.value)).toEqual(['—', '—', '—'])
  })

  it('adds every GPIO’s current, names the busiest pin and counts the checks', () => {
    const [draw, peak, checks] = readoutsOf(snapshot({ 17: 5.8e-3, 18: -2e-3 }), [])
    expect(draw).toEqual({ label: 'GPIO draw', value: '7.8', unit: 'mA', tone: 'hot' })
    expect(peak).toEqual({ label: 'Peak GPIO17', value: '5.8', unit: 'mA', tone: 'plain' })
    expect(checks).toEqual({ label: 'Checks', value: 'OK', unit: '', tone: 'green' })
  })

  it('turns a pin over 16 mA and a total over 50 mA coral', () => {
    const over = { 4: 17e-3, 5: 15e-3, 6: 15e-3, 7: 15e-3 }
    const [draw, peak] = readoutsOf(snapshot(over), [])
    expect(draw.tone).toBe('coral')
    expect(peak).toMatchObject({ label: 'Peak GPIO4', tone: 'coral' })
  })

  it('counts errors before warnings, and names no pin while none draws current', () => {
    const quiet = snapshot({ 17: 0 })
    expect(readoutsOf(quiet, [])[1].label).toBe('Peak')
    expect(readoutsOf(quiet, [issue('A', 'warning'), issue('B', 'error')])[2]).toMatchObject({
      value: '1',
      unit: 'error',
      tone: 'coral'
    })
    expect(readoutsOf(quiet, [issue('A', 'warning'), issue('B', 'warning')])[2]).toMatchObject({
      value: '2',
      unit: 'warnings',
      tone: 'amber'
    })
  })
})

describe('captionOf', () => {
  it('says what to do with an empty bench, a build part-way and an idle one', () => {
    expect(text({ parts: 0 })).toMatch(/^Drag a part/)
    expect(text({ build: { step: 3, of: 9 } })).toBe(
      'Step 3 of 9: the bench lights up once it is built.'
    )
    expect(text({})).toBe('Press Simulate to run the program on this bench.')
  })

  it('puts a fault before anything else the bench is doing', () => {
    const live = { live: true, simulating: true }
    expect(text({ ...live, snapshot: snapshot({}, 'Singular matrix') })).toBe(
      'The simulation stopped: Singular matrix'
    )
    expect(text({ ...live, issues: [issue('PIN_OVERCURRENT', 'error', ['GPIO4'])] })).toMatch(
      /^GPIO4 carries more than its 16 mA limit/
    )
    expect(text({ ...live, issues: [issue('RAIL_BUDGET', 'error')] })).toMatch(/50 mA limit/)
    expect(text({ ...live, issues: [issue('LED_NO_LIMIT', 'error')] })).toMatch(
      /^1 error to fix before Run on Pi/
    )
  })

  it('names the busiest pin while simulating, without its live number', () => {
    const caption = captionOf({
      parts: 3,
      build: null,
      snapshot: snapshot({ 17: 5.8e-3 }),
      issues: [],
      live: false,
      onPi: false,
      simulating: true
    })
    expect(caption.map((g) => g.text).join('')).toBe(
      'The program runs in simulation; GPIO17 draws the most current.'
    )
    expect(caption.find((g) => g.text === 'GPIO17')?.tone).toBe('cyan')
    expect(text({ live: true })).toMatch(/Live Pi state/)
    expect(text({ onPi: true })).toBe('The program is running on the Pi.')
  })
})
