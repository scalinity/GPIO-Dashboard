// A stand-in for the simulator in behaviour tests: the test sets pin voltages, env and time, and
// the behaviour reads them through the same BehaviorIo it gets at run time.
import type { BehaviorIo, EnvValue } from '../behavior'

export interface Bench {
  t: number
  volts: Record<string, number>
  env: Record<string, EnvValue>
  io: BehaviorIo
}

export function bench(env: Record<string, EnvValue> = {}): Bench {
  const b: Bench = {
    t: 0,
    volts: {},
    env,
    io: {
      get t() {
        return b.t
      },
      v: (pin) => b.volts[pin] ?? 0,
      get env() {
        return b.env
      }
    }
  }
  return b
}
