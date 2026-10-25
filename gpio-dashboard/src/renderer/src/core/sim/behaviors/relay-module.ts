// One-channel relay module: a Songle SRD-05VDC-SL-C relay behind a transistor driver, with pins
// S, + and - on a header and NC, COM and NO on screw terminals. The coil values are from the
// Songle datasheet cited in the part definition.
//
// Trigger polarity: S high energises the coil. SunFounder's module page describes this exact
// board (8050 transistor, S + - header) as "input high and the relay closes", and its Davinci
// kit relay lesson (1.3.4, same GPIO17 wiring picture) explains that driving the pin high turns
// the transistor on, powers the coil and lights the LED, while low leaves the relay open:
//   https://docs.sunfounder.com/projects/vincent-kit-de/de/latest/components/component_relay_module.html
//   https://github.com/sunfounder/davinci-kit-for-raspberry-pi/blob/docs/docs/source/1.3.4_relay.rst
// The Basic Starter Kit page (1.3.2 Relay) has code comments saying low closes the relay, but
// its own status prints say the LED is on when the pin is high, which agrees with active high.
import { logicLevel, param, type BehaviorFactory, type Load } from '../behavior'

// The board's driver schematic is not published. The S input is taken as a base resistor into
// an NPN: nothing flows below one Vbe, and above about 1.5 V the base current (about 1 mA
// through a 1 kohm resistor) saturates a transistor that carries the 71 mA coil current. Both the
// 1 kohm and the two thresholds are modelling assumptions. The load ignores Vbe, so at 3.3 V it
// overstates the S current (3.3 mA against about 2.6 mA).
const S_OFF_V = 0.7
const S_ON_V = 1.5
const S_INPUT_OHMS = 1000

export const createRelayModule: BehaviorFactory = (def) => {
  const pickUp = param(def, 'pickUpMaxV')
  const dropOut = param(def, 'dropOutMinV')
  // The datasheet gives only maxima, so these are the longest times the relay can take.
  const operateS = param(def, 'operateMaxMs') * 1e-3
  const releaseS = param(def, 'releaseMaxMs') * 1e-3
  const coilOhm = param(def, 'coilOhm')
  const contactOhm = param(def, 'contactMaxOhm')

  let supply = 0
  let signalHigh = false
  let coilWanted = false
  let energised = false
  let pending: { to: boolean; at: number } | null = null

  return {
    update(io) {
      supply = io.v('+') - io.v('-')
      signalHigh = logicLevel(io.v('S') - io.v('-'), S_OFF_V, S_ON_V, signalHigh)
      // The transistor puts the whole supply across the coil, or nothing.
      coilWanted = logicLevel(signalHigh ? supply : 0, dropOut, pickUp, coilWanted)
      if (pending && pending.to !== coilWanted) pending = null
      if (!pending && coilWanted !== energised) {
        pending = { to: coilWanted, at: io.t + (coilWanted ? operateS : releaseS) }
      }
      if (pending && io.t >= pending.at) {
        energised = pending.to
        pending = null
      }
    },
    drives: () => ({}),
    loads() {
      const loads: Load[] = [{ a: 'COM', b: energised ? 'NO' : 'NC', ohms: contactOhm }]
      if (signalHigh) {
        loads.push({ a: 'S', b: '-', ohms: S_INPUT_OHMS })
        // The coil draws current whenever the transistor conducts, before and after the armature moves.
        loads.push({ a: '+', b: '-', ohms: coilOhm })
      }
      return loads
    },
    nextEvent: () => pending?.at ?? Infinity,
    view: () => ({
      powered: supply >= pickUp,
      coilDriven: signalHigh,
      energised,
      contact: energised ? 'NO' : 'NC'
    })
  }
}
