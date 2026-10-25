// Where a build's hardware checkpoints hang (SPEC 11.7, 14.4): on the first step that completes what
// they check, read from the circuit alone.
import { describe, expect, it } from 'vitest'
import { partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import { buildSteps } from '../core/steps/steps'
import {
  type Checkpoint,
  checkpointsAfter,
  deriveCheckpoints,
  i2cAddresses,
  MAX_LED_TOGGLES
} from './checkpoints'

const tutorial = (id: string) => TUTORIALS.find((t) => t.meta.id === id)!
const derive = (id: string) => {
  const { doc } = tutorial(id)
  const { steps } = buildSteps(doc, partDef)
  return { doc, steps, found: deriveCheckpoints(doc, steps) }
}
const stepOf = (steps: { refs: string[] }[], ref: string) =>
  steps.findIndex((s) => s.refs.includes(ref))

describe('the checkpoint rule', () => {
  it('puts the LED toggle on the step that finishes the LED path', () => {
    const { steps, found } = derive('blinking-led')
    expect(found).toEqual([{ kind: 'toggle-led', afterStep: 'W2', part: 'D1', gpio: 17 }])
    // W2 is the last step: the LED has no complete path before it.
    expect(stepOf(steps, 'W2')).toBe(steps.length - 1)
  })

  it('waits for the ground lead when the signal lead comes first', () => {
    // The tilt switch's LEDs get their ground leads after their signal leads; a toggle offered
    // at the signal lead would run on a circuit with no return path.
    const { steps, found } = derive('tilt-switch')
    const d1 = found.find((c) => c.kind === 'toggle-led' && c.part === 'D1')!
    expect(steps[stepOf(steps, d1.afterStep)]!.kind).toBe('ground')
  })

  it('puts the I2C scan on the step that finishes the module’s four connections', () => {
    const { found } = derive('adjustable-fan')
    expect(found).toEqual([{ kind: 'i2c-scan', afterStep: 'W4', addresses: [0x48] }])
  })

  it('puts the press check on the step that finishes the button’s circuit', () => {
    const { found } = derive('button')
    expect(found).toContainEqual({ kind: 'press', afterStep: 'W5', part: 'SW1', gpio: 18 })
  })

  it('waits for the joystick module’s ground before offering its button', () => {
    const { steps, found } = derive('joystick')
    const press = found.find((c) => c.kind === 'press')!
    expect(press).toMatchObject({ part: 'J1', gpio: 17 })
    expect(steps[stepOf(steps, press.afterStep)]!.kind).toBe('ground')
  })

  it('toggles an LED that a relay switches, by the GPIO on the relay', () => {
    const { found } = derive('relay')
    expect(found).toEqual([{ kind: 'toggle-led', afterStep: 'W6', part: 'D1', gpio: 17 }])
  })

  it('offers nothing for a circuit with nothing to check', () => {
    for (const id of ['servo', 'motor', 'active-buzzer', 'dht11', 'ultrasonic', 'keypad'])
      expect(derive(id).found, id).toEqual([])
  })

  it('never offers to drive GPIO0 to GPIO3, and offers at most three LED toggles', () => {
    for (const t of TUTORIALS) {
      const { found } = derive(t.meta.id)
      const toggles = found.filter((c) => c.kind === 'toggle-led')
      expect(toggles.length, t.meta.id).toBeLessThanOrEqual(MAX_LED_TOGGLES)
      for (const c of toggles) expect((c as { gpio: number }).gpio, t.meta.id).toBeGreaterThan(3)
    }
  })

  it('hangs every checkpoint on a step of its own build, and each part and pin once', () => {
    for (const t of TUTORIALS) {
      const { steps, found } = derive(t.meta.id)
      const seen = new Set<string>()
      for (const c of found) {
        expect(stepOf(steps, c.afterStep), `${t.meta.id} ${c.afterStep}`).toBeGreaterThanOrEqual(0)
        const key = JSON.stringify([c.kind, 'part' in c ? c.part : '', 'gpio' in c ? c.gpio : ''])
        expect(seen.has(key), `${t.meta.id} ${key}`).toBe(false)
        seen.add(key)
      }
    }
  })

  it('covers every checkpoint a tutorial lists by hand (kind, part and pin), on or after its step', () => {
    for (const t of TUTORIALS) {
      const { steps, found } = derive(t.meta.id)
      for (const authored of t.meta.checkpoints) {
        const match = found.find(
          (c) =>
            c.kind === authored.kind &&
            JSON.stringify([('part' in c && c.part) || '', ('gpio' in c && c.gpio) || 0]) ===
              JSON.stringify([
                ('part' in authored && authored.part) || '',
                ('gpio' in authored && authored.gpio) || 0
              ])
        )
        expect(match, `${t.meta.id} ${JSON.stringify(authored)}`).toBeDefined()
        // A hand-placed checkpoint may sit before the circuit is complete; never after the rule's.
        expect(stepOf(steps, authored.afterStep)).toBeLessThanOrEqual(
          stepOf(steps, match!.afterStep)
        )
      }
    }
  })

  it('selects the checkpoints of the step in hand', () => {
    const { steps, found } = derive('button')
    const plan: Checkpoint[] = found
    expect(checkpointsAfter(plan, steps[stepOf(steps, 'W5')])).toEqual([
      { kind: 'press', afterStep: 'W5', part: 'SW1', gpio: 18 }
    ])
    expect(checkpointsAfter(plan, steps[0])).toEqual([])
    expect(checkpointsAfter(plan, undefined)).toEqual([])
  })

  it('reads a module’s addresses from its definition', () => {
    expect(i2cAddresses(partDef('lcd1602-i2c'))).toEqual([0x27, 0x3f])
    expect(i2cAddresses(partDef('ads7830-module'))).toEqual([0x48])
    expect(i2cAddresses(partDef('led'))).toEqual([])
  })
})
