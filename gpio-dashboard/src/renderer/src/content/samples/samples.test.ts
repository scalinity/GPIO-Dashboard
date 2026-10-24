// The Workbench samples meet the bar any shipped circuit does: valid placement, no ERC errors,
// and the behaviour their names promise, in simulation (SPEC 9, M3 exit).
import { describe, expect, it } from 'vitest'
import { partDef } from '../../core/defs/parts'
import { SAMPLES } from '../../core/defs/samples'
import { erc } from '../../core/erc/erc'
import { validateDoc } from '../../core/ops/validate'
import { BEHAVIORS } from '../../core/sim/behaviors'
import { Circuit } from '../../core/sim/circuit'
import { SimSession } from '../../core/sim/session'

const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.doc
const session = (id: string) => new SimSession(new Circuit(sample(id), partDef, BEHAVIORS))

describe('samples', () => {
  it.each(SAMPLES.map((s) => [s.id, s.doc] as const))(
    '%s is valid and free of ERC errors',
    (_id, doc) => {
      expect(validateDoc(doc, partDef)).toEqual([])
      expect(erc(doc, partDef).filter((i) => i.severity === 'error')).toEqual([])
    }
  )

  it('blinks: GPIO17 high lights D1 at about 5.5 mA, low darkens it', () => {
    const s = session('sample-blink')
    s.setGpio(17, { mode: 'out', level: true })
    expect(s.snapshot().dies['D1.D']!.currentA).toBeCloseTo(5.49e-3, 4)
    s.setGpio(17, { mode: 'out', level: false })
    expect(s.snapshot().dies['D1.D']!.currentA).toBeLessThan(1e-9)
  })

  it('reads the button: LOW released, HIGH pressed', () => {
    const s = session('sample-button')
    s.setGpio(18, { mode: 'in', pull: 'off' })
    expect(s.read(18)).toBe('low')
    s.setInput('SW1', 'pressed', true)
    expect(s.read(18)).toBe('high')
  })
})
