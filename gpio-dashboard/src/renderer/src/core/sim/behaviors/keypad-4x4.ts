// 4x4 membrane keypad: a plain switch from each key's row line to its column line, no diodes and
// no pull resistors (SunFounder keypad schematic and protosupplies, cited in the part definition).
// env.pressedKeys lists the characters currently held down, such as "5" or "5A".
import { param, type BehaviorFactory, type Load } from '../behavior'

export const createKeypad4x4: BehaviorFactory = (def) => {
  const text = (key: string) => {
    const value = def.sim.params[key]
    if (typeof value !== 'string') throw new Error(`${def.id}: sim param ${key} is missing`)
    return value
  }
  const layout = text('keyLayout')
  const rows = text('rowPins').split(',')
  const columns = text('columnPins').split(',')
  if (layout.length !== rows.length * columns.length) {
    throw new Error(
      `${def.id}: ${layout.length} keys do not fill ${rows.length} x ${columns.length}`
    )
  }
  // protosupplies measured 60 to 90 ohm across a pressed key; the middle of that range is used.
  const pressedOhms =
    (param(def, 'pressedResistanceMinOhm') + param(def, 'pressedResistanceMaxOhm')) / 2

  let pressed: string[] = []

  return {
    update(io) {
      const held = String(io.env.pressedKeys ?? '')
      pressed = [...layout].filter((key) => held.includes(key))
    },
    drives: () => ({}),
    loads() {
      return pressed.map((key): Load => {
        const index = layout.indexOf(key)
        return {
          a: rows[Math.floor(index / columns.length)]!,
          b: columns[index % columns.length]!,
          ohms: pressedOhms
        }
      })
    },
    nextEvent: () => Infinity,
    // A passive matrix has no supply to lose.
    view: () => ({ powered: true, pressed: [...pressed] })
  }
}
