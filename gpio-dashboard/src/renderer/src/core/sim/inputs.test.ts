// Every input the simulator reads from a library part is a property that part declares. The
// assistant's `simulate` tool, the Properties panel and `validateDoc` (ADR-0093) all take their
// list of inputs from the definition's properties, so an input the simulator reads but the
// definition leaves out can not be set by any of them.
import { describe, expect, it } from 'vitest'
import { PART_DEFS, partDef } from '../defs/parts'
import { emptyDoc, hole, part } from '../testing/fixtures'
import { BEHAVIORS } from './behaviors'
import { Circuit } from './circuit'
import { SimSession } from './session'

/** The keys of a part's environment that the simulator reads while it runs for a moment. */
function readInputs(defId: string): Set<string> {
  const def = partDef(defId)
  const doc = emptyDoc()
  // Every pin in a strip of its own: the simulator only needs each pin to be on a net.
  doc.parts.push(
    part('X1', defId, Object.fromEntries(def.pins.map((pin, i) => [pin.id, hole(1 + i, 'a')])))
  )
  const circuit = new Circuit(doc, partDef, BEHAVIORS)
  const read = new Set<string>()
  const seeded = circuit.defaultEnv.bind(circuit)
  circuit.defaultEnv = () =>
    new Map(
      [...seeded()].map(([id, env]) => [
        id,
        new Proxy(env, {
          get(target, key, receiver) {
            if (typeof key === 'string') read.add(key)
            return Reflect.get(target, key, receiver)
          }
        })
      ])
    )
  new SimSession(circuit).advanceTo(0.1)
  return read
}

/**
 * Inputs the simulator reads that no property can declare yet: the keypad's `pressedKeys` is text,
 * and a part property is a number, an option or a boolean.
 */
const TEXT_INPUTS: Record<string, string[]> = { 'keypad-4x4': ['pressedKeys'] }

describe('the inputs the simulator reads', () => {
  it.each([...PART_DEFS.keys()])('are all declared by %s', (id) => {
    const declared = new Set(Object.keys(partDef(id).properties))
    const undeclared = [...readInputs(id)].filter(
      (key) => !declared.has(key) && !TEXT_INPUTS[id]?.includes(key)
    )
    expect(undeclared).toEqual([])
  })

  it('include the pressed state of a tact switch, which `simulate` sets by name', () => {
    expect(readInputs('tact-switch-6mm')).toContain('pressed')
    expect(partDef('tact-switch-6mm').properties.pressed).toMatchObject({
      type: 'boolean',
      default: false
    })
  })
})
