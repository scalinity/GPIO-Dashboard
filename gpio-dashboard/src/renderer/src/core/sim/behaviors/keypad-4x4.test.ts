// Keypad against the SunFounder keypad schematic (keypad314.png in the part definition): rows
// 1-2-3-A on R1, 4-5-6-B on R2, 7-8-9-C on R3 and *-0-#-D on R4; columns 1-4-7-* on C1,
// 2-5-8-0 on C2, 3-6-9-# on C3 and A-B-C-D on C4. A pressed key measures 60 to 90 ohm
// (protosupplies), so 75 ohm.
import { describe, expect, it } from 'vitest'
import { PART_DEFS } from '../../defs/parts'
import { bench } from './fake-io'
import { createKeypad4x4 } from './keypad-4x4'

const def = PART_DEFS.get('keypad-4x4')!

function setup(pressedKeys?: string) {
  const b = bench(pressedKeys === undefined ? {} : { pressedKeys })
  const model = createKeypad4x4(def, {})
  const press = (keys: string) => {
    b.env = { pressedKeys: keys }
    model.update(b.io)
  }
  model.update(b.io)
  return { b, model, press }
}

describe('keypad matrix', () => {
  it('joins nothing while no key is pressed', () => {
    const t = setup('')
    expect(t.model.loads()).toEqual([])
    expect(t.model.view()).toEqual({ powered: true, pressed: [] })
  })

  it('joins nothing when the environment has no pressedKeys', () => {
    expect(setup().model.loads()).toEqual([])
  })

  it('bridges the row and column of a pressed key through 75 ohm', () => {
    const t = setup('5')
    expect(t.model.loads()).toEqual([{ a: 'R2', b: 'C2', ohms: 75 }])
    expect(t.model.view()).toEqual({ powered: true, pressed: ['5'] })
  })

  it.each([
    ['1', 'R1', 'C1'],
    ['2', 'R1', 'C2'],
    ['3', 'R1', 'C3'],
    ['A', 'R1', 'C4'],
    ['4', 'R2', 'C1'],
    ['6', 'R2', 'C3'],
    ['B', 'R2', 'C4'],
    ['7', 'R3', 'C1'],
    ['8', 'R3', 'C2'],
    ['9', 'R3', 'C3'],
    ['C', 'R3', 'C4'],
    ['*', 'R4', 'C1'],
    ['0', 'R4', 'C2'],
    ['#', 'R4', 'C3'],
    ['D', 'R4', 'C4']
  ])('puts %s between %s and %s', (key, row, column) => {
    expect(setup(key).model.loads()).toEqual([{ a: row, b: column, ohms: 75 }])
  })

  it('bridges every held key, in layout order whatever order they are listed', () => {
    const expected = [
      { a: 'R1', b: 'C4', ohms: 75 },
      { a: 'R2', b: 'C2', ohms: 75 }
    ]
    expect(setup('5A').model.loads()).toEqual(expected)
    expect(setup('A5').model.loads()).toEqual(expected)
  })

  it('ignores repeats and characters that are not keys', () => {
    expect(setup('55x ?').model.loads()).toEqual([{ a: 'R2', b: 'C2', ohms: 75 }])
  })

  it('follows the keys as they are pressed and released', () => {
    const t = setup('')
    t.press('7')
    expect(t.model.loads()).toEqual([{ a: 'R3', b: 'C1', ohms: 75 }])
    t.press('')
    expect(t.model.loads()).toEqual([])
  })
})

describe('keypad is passive', () => {
  it('drives nothing, has no timers and needs no supply', () => {
    // There is no supply pin: the matrix works with every voltage at its default of zero.
    const t = setup('5')
    expect(t.model.drives()).toEqual({})
    expect(t.model.nextEvent()).toBe(Infinity)
    expect(t.model.view().powered).toBe(true)
  })
})

describe('keypad repeated updates', () => {
  it('change nothing at the same time with the same input', () => {
    const t = setup('5A')
    const snapshot = () =>
      JSON.stringify([t.model.drives(), t.model.loads(), t.model.view(), t.model.nextEvent()])
    const before = snapshot()
    t.press('5A')
    t.press('5A')
    expect(snapshot()).toBe(before)
  })
})
