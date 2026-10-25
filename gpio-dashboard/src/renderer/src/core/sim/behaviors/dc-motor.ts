// DC motor at steady state (SPEC 9: R + L with back-EMF proportional to speed). In a DC solve the
// coil's L is a short, and an unloaded motor settles where its current equals the no-load current
// (that current's torque balances friction), so it looks like |V| / I_noload. Stalled, it is its
// armature resistance.
import type { Behavior, BehaviorFactory, Load } from '../behavior'
import { param } from '../behavior'

export const createDcMotor: BehaviorFactory = (def) => {
  const ratedV = param(def, 'ratedV')
  const noLoadA = param(def, 'noLoadMa') / 1000
  // Stall current at the rated voltage gives the armature resistance.
  const armatureOhms = ratedV / (param(def, 'stallMa') / 1000)
  // Back-EMF constant from the no-load point: V = I·R + k·ω.
  const noLoadRadS = (param(def, 'noLoadRpm') * 2 * Math.PI) / 60
  const k = (ratedV - noLoadA * armatureOhms) / noLoadRadS
  const startV = param(def, 'startV')
  // Below this the back-EMF would be negative: it cannot overcome friction.
  const stopV = noLoadA * armatureOhms

  let volts = 0
  let spinning = false
  return {
    update(io) {
      volts = io.v('red') - io.v('black')
      const magnitude = Math.abs(volts)
      if (!spinning && magnitude >= startV) spinning = true
      else if (spinning && magnitude < stopV) spinning = false
    },
    drives: () => ({}),
    loads(): Load[] {
      const ohms = spinning ? Math.abs(volts) / noLoadA : armatureOhms
      return [{ a: 'red', b: 'black', ohms }]
    },
    nextEvent: () => Infinity,
    view() {
      const radS = spinning ? (Math.abs(volts) - noLoadA * armatureOhms) / k : 0
      return { spinning, rpm: (Math.sign(volts) * radS * 60) / (2 * Math.PI) }
    }
  } satisfies Behavior
}
