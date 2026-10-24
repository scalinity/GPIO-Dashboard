// Which GPIOs a program configures, and how (SPEC 8, 11.6), read statically from RPi.GPIO and
// gpiozero code. It resolves integer constants, lists of them and `for` loops over such lists;
// anything else is reported as unresolved rather than guessed.
import { PI_HEADER } from '../defs/controllers'

export type PinMode = 'out' | 'in' | 'pwm'
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

const GPIOZERO_OUT = [
  'LED',
  'PWMLED',
  'Buzzer',
  'TonalBuzzer',
  'OutputDevice',
  'DigitalOutputDevice',
  'PWMOutputDevice',
  'Servo',
  'AngularServo',
  'RGBLED'
]
const GPIOZERO_IN = ['Button', 'DigitalInputDevice', 'MotionSensor', 'LineSensor', 'InputDevice']

const boardToBcm = (physical: number) => PI_HEADER[physical - 1]?.bcm ?? null

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
    if ((m = /\bDistanceSensor\(([^)]*)\)/.exec(text))) {
      const echo = /echo\s*=\s*([^,)]+)/.exec(m[1]!)
      const trigger = /trigger\s*=\s*([^,)]+)/.exec(m[1]!)
      if (echo)
        for (const bcm of resolve(echo[1]!, line, true))
          uses.push({ bcm, mode: 'in', pull: 'none', line })
      if (trigger)
        for (const bcm of resolve(trigger[1]!, line, true)) uses.push({ bcm, mode: 'out', line })
    }
  })
  return { uses, unresolved }
}
