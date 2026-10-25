// Which GPIOs a program configures, and how (SPEC 8, 11.6), read statically from RPi.GPIO,
// gpiozero and smbus code. It resolves integer constants, lists of them and `for` loops over such
// lists; anything else is reported as unresolved rather than guessed.
import { PI_HEADER } from '../defs/controllers'

/** 'i2c' is a bus pin: open drain, driven low by the Pi or a device. */
export type PinMode = 'out' | 'in' | 'pwm' | 'i2c'
export type Pull = 'up' | 'down' | 'none'

export interface PinUse {
  bcm: number
  mode: PinMode
  /** Internal pull set by the code; undefined when the code doesn't say. */
  pull?: Pull
  line: number
}

export interface CodePins {
  uses: PinUse[]
  /** Pin expressions the reader could not resolve, with their line numbers. */
  unresolved: { expression: string; line: number }[]
}

/** Output devices whose first argument is their pin. */
const GPIOZERO_OUT = [
  'LED',
  'PWMLED',
  'Buzzer',
  'TonalBuzzer',
  'OutputDevice',
  'DigitalOutputDevice',
  'PWMOutputDevice',
  'Servo',
  'AngularServo'
]
const GPIOZERO_IN = ['Button', 'DigitalInputDevice', 'MotionSensor', 'LineSensor', 'InputDevice']

/** Every gpiozero class this reader knows, for the simulator's shim to match (workers/python). */
export const GPIOZERO_CLASSES = [...GPIOZERO_OUT, ...GPIOZERO_IN, 'RGBLED', 'DistanceSensor']

const boardToBcm = (physical: number) => PI_HEADER[physical - 1]?.bcm ?? null

/** I2C bus 1, the header's bus: SDA on GPIO2 and SCL on GPIO3 (Raspberry Pi GPIO docs). */
const I2C1 = [2, 3]

/** The text between the parentheses of the first call of `name` on a line, or null. */
function callArguments(text: string, name: string): string | null {
  const open = new RegExp(`\\b${name}\\(`).exec(text)
  if (!open) return null
  let depth = 1
  for (let i = open.index + open[0].length; i < text.length; i++) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')' && --depth === 0) return text.slice(open.index + open[0].length, i)
  }
  return null
}

/**
 * The pin arguments of a gpiozero constructor call, by name: `echo=24` and a bare `24` in the
 * place `names` gives it both count. Other keywords (`max_distance=2`) are skipped.
 */
function pinArguments(args: string, names: string[]): Record<string, string | undefined> {
  const found: Record<string, string | undefined> = {}
  let position = 0
  let keywords = false
  for (const arg of args.split(',')) {
    const keyword = /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(arg)
    if (keyword) {
      keywords = true
      if (names.includes(keyword[1]!)) found[keyword[1]!] = keyword[2]
    } else if (!keywords && arg.trim()) {
      // Python takes no positional argument after a keyword one, so what follows is a tuple's tail.
      if (position < names.length) found[names[position]!] = arg.trim()
      position += 1
    }
  }
  return found
}

export function codePins(source: string): CodePins {
  const lines = source.split('\n')
  const ints = new Map<string, number>()
  const lists = new Map<string, number[]>()
  const loopVars = new Map<string, number[]>()
  let boardMode = false
  const uses: PinUse[] = []
  const unresolved: CodePins['unresolved'] = []

  const resolve = (expr: string, line: number, bcmNumbers = !boardMode): number[] => {
    const e = expr.trim()
    let values: number[] | undefined
    let explicitBcm = bcmNumbers
    const str = /^["'](GPIO|BCM|BOARD)?(\d+)["']$/.exec(e)
    if (str) {
      values = [Number(str[2])]
      if (str[1] === 'BOARD') explicitBcm = false
      else explicitBcm = true
    } else if (/^\d+$/.test(e)) values = [Number(e)]
    else if (/^\[[\d,\s]*\]$/.test(e))
      values = e
        .slice(1, -1)
        .split(',')
        .filter((s) => s.trim())
        .map(Number)
    else if (ints.has(e)) values = [ints.get(e)!]
    else if (lists.has(e)) values = lists.get(e)
    else if (loopVars.has(e)) values = loopVars.get(e)
    if (!values) {
      unresolved.push({ expression: e, line })
      return []
    }
    return values
      .map((v) => (explicitBcm ? v : boardToBcm(v)))
      .filter((v): v is number => v !== null)
  }

  lines.forEach((raw, i) => {
    const line = i + 1
    const text = raw.replace(/#.*$/, '')
    let m: RegExpExecArray | null
    if (/GPIO\.setmode\(\s*GPIO\.BOARD\s*\)/.test(text)) boardMode = true
    if (/GPIO\.setmode\(\s*GPIO\.BCM\s*\)/.test(text)) boardMode = false
    if ((m = /^\s*([A-Za-z_]\w*)\s*=\s*(\d+)\s*$/.exec(text))) ints.set(m[1]!, Number(m[2]))
    if ((m = /^\s*([A-Za-z_]\w*)\s*=\s*\[([\d,\s]+)\]\s*$/.exec(text))) {
      lists.set(
        m[1]!,
        m[2]!
          .split(',')
          .filter((s) => s.trim())
          .map(Number)
      )
    }
    if ((m = /^\s*for\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*|\[[\d,\s]+\])\s*:/.exec(text))) {
      const src = m[2]!
      const values = src.startsWith('[')
        ? src
            .slice(1, -1)
            .split(',')
            .filter((s) => s.trim())
            .map(Number)
        : lists.get(src)
      if (values) loopVars.set(m[1]!, values)
    }
    // RPi.GPIO
    if ((m = /GPIO\.setup\(\s*(\[[^\]]*\]|[^,]+?)\s*,\s*GPIO\.(OUT|IN)\b([^)]*)\)/.exec(text))) {
      const pull = /PUD_UP/.test(m[3]!)
        ? 'up'
        : /PUD_DOWN/.test(m[3]!)
          ? 'down'
          : /PUD_OFF/.test(m[3]!)
            ? 'none'
            : undefined
      for (const bcm of resolve(m[1]!, line)) {
        uses.push({
          bcm,
          mode: m[2] === 'OUT' ? 'out' : 'in',
          ...(m[2] === 'IN' && pull ? { pull } : {}),
          line
        })
      }
    }
    if ((m = /GPIO\.PWM\(\s*([^,]+?)\s*,/.exec(text))) {
      for (const bcm of resolve(m[1]!, line)) uses.push({ bcm, mode: 'pwm', line })
    }
    // gpiozero: Device(pin, ...) or Device(pin=..)
    for (const cls of [...GPIOZERO_OUT, ...GPIOZERO_IN]) {
      const re = new RegExp(`\\b${cls}\\(\\s*(?:pin\\s*=\\s*)?([^,)]+)([^)]*)\\)`, 'g')
      while ((m = re.exec(text))) {
        const out = GPIOZERO_OUT.includes(cls)
        const args = m[2]!
        const pull = out
          ? undefined
          : /pull_up\s*=\s*False/.test(args)
            ? 'down'
            : /pull_up\s*=\s*None/.test(args)
              ? 'none'
              : 'up'
        const mode: PinMode =
          cls === 'PWMLED' ||
          cls === 'TonalBuzzer' ||
          cls.includes('Servo') ||
          cls === 'PWMOutputDevice'
            ? 'pwm'
            : out
              ? 'out'
              : 'in'
        for (const bcm of resolve(m[1]!, line, true))
          uses.push({ bcm, mode, ...(pull ? { pull } : {}), line })
      }
    }
    // smbus / smbus2: SMBus(1) opens bus 1; any other bus is not on the header.
    if ((m = /\bSMBus\(\s*([^)]*?)\s*\)/.exec(text))) {
      const bus = resolve(m[1]!, line, true)
      if (bus.length === 1 && bus[0] === 1) {
        for (const bcm of I2C1) uses.push({ bcm, mode: 'i2c', line })
      } else if (bus.length) unresolved.push({ expression: `SMBus(${m[1]})`, line })
    }
    // Devices with several pins: by keyword or by position (gpiozero's order).
    const distance = callArguments(text, 'DistanceSensor')
    if (distance !== null) {
      const { echo, trigger } = pinArguments(distance, ['echo', 'trigger'])
      if (echo)
        for (const bcm of resolve(echo, line, true))
          uses.push({ bcm, mode: 'in', pull: 'none', line })
      if (trigger)
        for (const bcm of resolve(trigger, line, true)) uses.push({ bcm, mode: 'out', line })
    }
    const rgb = callArguments(text, 'RGBLED')
    if (rgb !== null) {
      const colours = pinArguments(rgb, ['red', 'green', 'blue'])
      // pwm=False makes each colour a plain on/off output.
      const mode = /\bpwm\s*=\s*False\b/.test(rgb) ? 'out' : 'pwm'
      for (const pin of [colours.red, colours.green, colours.blue])
        if (pin) for (const bcm of resolve(pin, line, true)) uses.push({ bcm, mode, line })
    }
  })
  return { uses, unresolved }
}
