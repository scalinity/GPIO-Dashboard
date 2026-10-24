// ERC rules that need simulated currents (SPEC 8): PIN_OVERCURRENT, RAIL_BUDGET and the current
// check behind LED_NO_LIMIT. They read a session snapshot and answer in core/erc's Issue shape.
// Only documented limits are checked: the Raspberry Pi docs give 16 mA per GPIO and 50 mA for all
// GPIOs together, and no limit for the 3V3 or 5V pins on a Pi 5 (ADR-0014).
import { RP1 } from '../constants/rp1'
import type { Issue } from '../erc/erc'
import type { CircuitDoc } from '../model/types'
import { docPartDefs, type PartDefs } from '../netlist/netlist'
import type { Snapshot } from './session'

const mA = (a: number) => `${(a * 1000).toFixed(1)} mA`

/** The datasheet's maximum continuous current for an LED die, in amps. */
function dieLimitA(doc: CircuitDoc, defs: PartDefs, part: string, die: string): number | null {
  const instance = doc.parts.find((p) => p.id === part)
  if (!instance) return null
  const def = docPartDefs(doc, defs)(instance.defId)
  const p = def.sim.params
  const prop = (key: string) => instance.props[key] ?? def.properties[key]?.default
  const key =
    def.sim.model === 'led'
      ? `${String(prop('color'))}.${String(prop('size'))}.ifMaxMa`
      : def.sim.model === 'rgb-led'
        ? `${{ R: 'red', G: 'green', B: 'blue' }[die]}.ifMaxMa`
        : 'ifMaxMa'
  const limit = p[key]
  return typeof limit === 'number' ? limit / 1000 : null
}

export function simChecks(doc: CircuitDoc, defs: PartDefs, snapshot: Snapshot): Issue[] {
  const issues: Issue[] = []
  if (snapshot.error) return issues
  let total = 0
  for (const [bcm, { currentA }] of Object.entries(snapshot.gpio)) {
    total += Math.abs(currentA)
    if (Math.abs(currentA) <= RP1.pinCurrentMaxA) continue
    issues.push({
      code: 'PIN_OVERCURRENT',
      severity: 'error',
      refs: [`GPIO${bcm}`],
      message: `GPIO${bcm} carries ${mA(Math.abs(currentA))} in simulation; a GPIO pin can supply at most 16 mA.`,
      fix: `Raise the series resistance on GPIO${bcm}, or switch the load with a transistor.`
    })
  }
  if (total > RP1.totalGpioCurrentMaxA) {
    issues.push({
      code: 'RAIL_BUDGET',
      severity: 'error',
      refs: Object.entries(snapshot.gpio)
        .filter(([, g]) => Math.abs(g.currentA) > 1e-6)
        .map(([bcm]) => `GPIO${bcm}`),
      message: `The GPIOs carry ${mA(total)} together in simulation; all GPIO pins combined can supply at most 50 mA.`,
      fix: 'Drive the heavier loads from 3V3 or 5V through transistors, or raise their resistors.'
    })
  }
  for (const [key, { currentA }] of Object.entries(snapshot.dies)) {
    const [part, die] = key.split('.') as [string, string]
    const limit = dieLimitA(doc, defs, part, die)
    if (limit === null || currentA <= limit) continue
    issues.push({
      code: 'LED_NO_LIMIT',
      severity: 'error',
      refs: [part],
      message: `${part}${die === 'D' ? '' : ` (${die})`} passes ${mA(currentA)} in simulation, above its ${mA(limit)} rating.`,
      fix: `Add or raise the series resistor for ${part}; 220 Ω from 3.3 V keeps a red LED near 5 mA.`
    })
  }
  return issues
}
