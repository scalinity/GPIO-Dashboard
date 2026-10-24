// Analog joystick module: two potentiometers, each between VCC and GND with its wiper on VRX or
// VRY, and a push switch from SW to GND with no pull-up (SunFounder schematic and pin notes cited
// in the part definition). env.x and env.y run 0 to 100 with 50 at rest; env.pressed is the button.
import { param, type BehaviorFactory, type Load } from '../behavior'

// "Two potentiometers (usually 10-kilo ohms)":
// https://docs.sunfounder.com/projects/umsk/en/latest/01_components_basic/09-component_joystick.html
// The source hedges with "usually"; no datasheet for the module states it.
const TRACK_OHMS = 10_000

// Modelling assumption, not from a source: a wiper at the end of its track is a 1 ohm contact, so
// the load stays a resistor the solver can stamp and never an ideal short.
const END_OHMS = 1

// Modelling assumption: no source gives the contact resistance of the thumb-stick push switch,
// so this borrows the 100 mohm maximum of the Omron B3F tact switch (tact-switch-6mm part).
const BUTTON_OHMS = 0.1

const percent = (value: unknown) => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 50
  return Math.min(100, Math.max(0, n))
}

export const createJoystick: BehaviorFactory = (def) => {
  const vccMin = param(def, 'vccMinV')

  let supply = 0
  let x = 50
  let y = 50
  let pressed = false

  const axis = (wiper: string, position: number): Load[] => {
    const fraction = position / 100
    return [
      { a: 'VCC', b: wiper, ohms: Math.max(END_OHMS, TRACK_OHMS * (1 - fraction)) },
      { a: wiper, b: 'GND', ohms: Math.max(END_OHMS, TRACK_OHMS * fraction) }
    ]
  }

  return {
    update(io) {
      supply = io.v('VCC') - io.v('GND')
      x = percent(io.env.x)
      y = percent(io.env.y)
      pressed = io.env.pressed === true
    },
    drives: () => ({}),
    // The tracks are plain resistors and stay in the circuit whatever the supply.
    loads() {
      const loads = [...axis('VRX', x), ...axis('VRY', y)]
      if (pressed) loads.push({ a: 'SW', b: 'GND', ohms: BUTTON_OHMS })
      return loads
    },
    nextEvent: () => Infinity,
    view: () => ({ powered: supply >= vccMin, x, y, pressed })
  }
}
