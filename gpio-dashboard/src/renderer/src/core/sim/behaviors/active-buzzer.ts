// Active buzzer (SPEC 9: a datasheet current sink). Its oscillator draws the rated current at the
// rated voltage, modelled as that resistance while forward-biased; reverse-biased it conducts
// nothing. It sounds from the datasheet's minimum operating voltage.
import type { Behavior, BehaviorFactory, Load } from '../behavior'
import { param } from '../behavior'

export const createActiveBuzzer: BehaviorFactory = (def) => {
  const ohms = param(def, 'ratedV') / (param(def, 'currentMa') / 1000)
  const operatingMinV = param(def, 'operatingMinV')
  let volts = 0
  return {
    update(io) {
      volts = io.v('+') - io.v('-')
    },
    drives: () => ({}),
    loads: (): Load[] => (volts > 0 ? [{ a: '+', b: '-', ohms }] : []),
    nextEvent: () => Infinity,
    view: () => ({ sounding: volts >= operatingMinV, volts })
  } satisfies Behavior
}
