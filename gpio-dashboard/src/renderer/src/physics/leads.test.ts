// Which length a lead means (ADR-0042): the solver rests a lead at the wire between its housings,
// not at the length it is sold at. core/reach converts; these tests hold the two together.
import { describe, expect, it } from 'vitest'
import dupont from '../content/leads/dupont.json'
import { wireLengthMm } from '../core/reach/reach'
import { TABLE, at, dist, newWorld, pathLength, run, wire } from './testkit'

describe('lead length', () => {
  it('a 200 mm male-male lead rests at 165 mm of wire', () => {
    // The listing's 200 mm runs from pin tip to pin tip: less two 12 mm housings, less two 5.5 mm pins.
    expect(wireLengthMm(200, 'dupont-mm')).toBe(165)
    const world = newWorld(TABLE)
    const id = world.addLead({
      a: at(-50, 0, 0),
      b: at(50, 0, 0),
      wireMm: wireLengthMm(200, 'dupont-mm')
    })
    run(world, 300)
    const pts = wire(world, id)
    console.info(
      `200 mm male-male lead: ${pathLength(pts).toFixed(3)} mm of wire between its housings`
    )
    expect(Math.abs(pathLength(pts) - 165)).toBeLessThan(0.5)
    // Sold length would be 35 mm longer: the wire is not that.
    expect(pathLength(pts)).toBeLessThan(170)
  })

  it('takes the rest length of each end type from wireLengthMm', () => {
    for (const [kind, wireMm] of [
      ['dupont-mm', 165],
      ['dupont-mf', 170.5],
      ['dupont-ff', 176]
    ] as const) {
      expect(wireLengthMm(200, kind)).toBe(wireMm)
      const world = newWorld(TABLE)
      const id = world.addLead({
        a: at(-40, 0, 0),
        b: at(40, 0, 0),
        wireMm: wireLengthMm(200, kind)
      })
      run(world, 250)
      expect(Math.abs(pathLength(wire(world, id)) - wireMm)).toBeLessThan(0.01 * wireMm)
    }
  })

  it('lengthMm still names the same wire length', () => {
    const build = (def: { wireMm: number } | { lengthMm: number }) => {
      const world = newWorld(TABLE)
      const id = world.addLead({ a: at(-30, 0, 0), b: at(30, 0, 0), ...def })
      run(world, 40)
      return Array.from(world.positions(id))
    }
    expect(build({ lengthMm: 120 })).toEqual(build({ wireMm: 120 }))
  })

  it('goes taut on reach.ts rule for the 165 mm wire: tip distance plus two bend radii', () => {
    // LEAD_TOO_SHORT: requiredMm = distance between the housing exits + 2 x minBendRadiusMm.
    const wireMm = wireLengthMm(200, 'dupont-mm')
    const bend = 2 * dupont.minBendRadiusMm
    const exits = (gap: number) => {
      const world = newWorld()
      // Housing frames at z = 0: the exits are 12 mm above them, at the same height both ends.
      const id = world.addLead({ a: at(-gap / 2, 0, 0), b: at(gap / 2, 0, 0), wireMm })
      return world.isTaut(id)
    }
    for (const gap of [wireMm - bend - 1, wireMm - bend - 0.05, wireMm - bend + 0.05, wireMm]) {
      expect(exits(gap)).toBe(dist([0, 0, 0], [gap, 0, 0]) + bend > wireMm)
    }
    // The sold length would have said a 190 mm gap fits.
    expect(exits(190)).toBe(true)
    expect(exits(150)).toBe(false)
  })
})
