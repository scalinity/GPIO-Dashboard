import { describe, expect, it } from 'vitest'
import { outputResistanceOhm, RP1 } from './rp1'

describe('RP1 pad constants (ADR-0009)', () => {
  it('uses the official thresholds, which match JESD8C.01', () => {
    expect([RP1.vilMaxV, RP1.vihMinV]).toEqual([0.8, 2.0])
  })

  it('carries the pull resistances as official ranges', () => {
    expect(RP1.pullUpOhm).toEqual({ min: 37e3, typ: 55e3, max: 86e3 })
    expect(RP1.pullDownOhm).toEqual({ min: 35e3, typ: 55e3, max: 98e3 })
  })

  it('models the default 4 mA drive as about 42 Ω high and 28 Ω low', () => {
    expect(RP1.defaultDriveMa).toBe(4)
    expect(outputResistanceOhm('high')).toBeCloseTo(0.4 / 0.0095, 6)
    expect(outputResistanceOhm('low')).toBeCloseTo(0.4 / 0.0143, 6)
    expect(outputResistanceOhm('high', 12)).toBeLessThan(outputResistanceOhm('high', 2))
  })
})
