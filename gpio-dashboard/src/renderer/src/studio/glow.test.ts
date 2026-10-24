// Light and motion from simulation state (SPEC 10.6): the dies the simulator names each map to model
// nodes the part files really have, an LED glows by its current, and the animated nodes exist.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PART_DEFS, partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import { BEHAVIORS } from '../core/sim/behaviors'
import { Circuit } from '../core/sim/circuit'
import { SimSession } from '../core/sim/session'
import { dieEnds } from './dies'
import { emissionOf, glowOf } from './glow'
import { motionOf } from './motion'

const models = resolve(__dirname, '../../../../src/renderer/public/models/parts')

/** Every node and material name a part's files hold. */
function names(defId: string): Set<string>[] {
  const index = JSON.parse(readFileSync(`${models}/index.json`, 'utf8')) as Record<
    string,
    { file: string }[]
  >
  return (index[defId] ?? []).map(({ file }) => {
    const b = readFileSync(`${models}/${file}`)
    const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()) as {
      nodes?: { name?: string }[]
      materials?: { name?: string }[]
    }
    return new Set([...(json.nodes ?? []), ...(json.materials ?? [])].map((n) => n.name ?? ''))
  })
}

describe('the nodes the visuals drive', () => {
  it('every die of every part has its nodes in each of the part files', () => {
    for (const def of PART_DEFS.values()) {
      const dies = Object.values(dieEnds(def))
      for (const file of names(def.id))
        for (const die of dies)
          for (const node of die.nodes) expect(file.has(node), `${def.id}: ${node}`).toBe(true)
    }
  })

  it('every die key is one the simulator names, in each tutorial that has the part', () => {
    for (const t of TUTORIALS) {
      const snapshot = new SimSession(new Circuit(t.doc, partDef, BEHAVIORS)).snapshot()
      for (const part of t.doc.parts) {
        const keys = Object.keys(dieEnds(partDef(part.defId)))
        for (const key of keys)
          expect(snapshot.dies[`${part.id}.${key}`], `${t.meta.id} ${part.id}.${key}`).toBeDefined()
      }
    }
  })

  it('the animated nodes exist in their models', () => {
    const wanted: Record<string, string[]> = {
      'tact-switch-6mm': ['plunger'],
      'potentiometer-10k': ['shaft'],
      sg90: ['horn'],
      'dc-motor': ['rotor'],
      'relay-module-5v': ['armature', 'lens'],
      'lcd1602-i2c': ['lcd-screen']
    }
    for (const [id, nodes] of Object.entries(wanted))
      for (const file of names(id)) for (const node of nodes) expect(file.has(node), id).toBe(true)
  })
})

describe('emissionOf', () => {
  const blink = TUTORIALS.find((t) => t.meta.id === 'blinking-led')!.doc
  const session = new SimSession(new Circuit(blink, partDef, BEHAVIORS))
  const part = blink.parts.find((p) => p.id === 'D1')!

  it('lights the lens and die of an LED while its current flows, and nothing otherwise', () => {
    session.setGpio(17, { mode: 'out', level: true })
    expect(emissionOf(part, partDef('led'), session.snapshot()).size).toBe(0)
    session.setGpio(17, { mode: 'out', level: false })
    const lit = emissionOf(part, partDef('led'), session.snapshot())
    expect([...lit.keys()].sort()).toEqual(['die', 'lens'])
    // A red LED: the red channel carries the glow, and it passes the bloom threshold of 1.
    expect(lit.get('lens')!.r).toBeGreaterThan(1)
    expect(lit.get('lens')!.g).toBeLessThan(lit.get('lens')!.r)
  })

  it('grows with the current and is capped', () => {
    expect(glowOf(0)).toBe(0)
    expect(glowOf(0.25)).toBeLessThan(glowOf(1))
    expect(glowOf(1)).toBeLessThan(glowOf(2))
    expect(glowOf(50)).toBe(glowOf(2))
  })

  it('has no light without a snapshot', () => {
    expect(emissionOf(part, partDef('led'), null).size).toBe(0)
  })
})

describe('motionOf', () => {
  const doc = TUTORIALS.find((t) => t.meta.id === 'button')!.doc
  const sw = doc.parts.find((p) => p.id === 'SW1')!

  it('presses a tact switch by its input and rests it otherwise', () => {
    const [down] = motionOf(sw, partDef(sw.defId), null, { pressed: true })
    const [up] = motionOf(sw, partDef(sw.defId), null, { pressed: false })
    expect([down!.node, down!.target, up!.target]).toEqual(['plunger', 1, 0])
    // One unit of travel is PLUNGER_TRAVEL_MM down the node's own -y, in mm.
    expect(down!.matrix(1).elements[13]).toBeCloseTo(-0.4)
  })

  it('turns a potentiometer shaft by its wiper over the part’s sweep', () => {
    const pot = { ...sw, id: 'R1', defId: 'potentiometer-10k', props: {} }
    const target = (wiper: number) => motionOf(pot, partDef(pot.defId), null, { wiper })[0]!.target
    expect([target(0), target(50), target(100)]).toEqual([-150, 0, 150])
  })
})
