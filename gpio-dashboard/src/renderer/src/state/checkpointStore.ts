// Hardware checkpoints in Build Mode (SPEC 11.7, 14.4), run by the user's own click on a step that
// has one (state/checkpoints.ts says which). Three kinds:
//   - i2c-scan: ssh_i2c_scan on the header's bus, compared with the module's addresses.
//   - press: watches the telemetry for the button's pin to go from its rest level to its pressed
//     level, which the document's simulation gives. It only reads.
//   - toggle-led: a short generated script, through the same ERC-gated Run on Pi path as any
//     program, drives the LED's pin for a few seconds; the user then says whether the LED lit.
// Only the buttons of the card call these (the assistant's tools import none of this), and none
// of them runs on its own. The scan and the run need the SSH session; the watch needs telemetry.
import { create } from 'zustand'
import { partDef } from '../core/defs/parts'
import { erc } from '../core/erc/erc'
import type { CircuitDoc } from '../core/model/types'
import { holeText } from '../core/steps/steps'
import { i2cScan, scriptName } from '../native/ssh'
import { emissionOf } from '../studio/glow'
import { useBuild } from './buildStore'
import type { Checkpoint } from './checkpoints'
import { type Level, type LivePin, useLive } from './liveStore'
import { useRun } from './runStore'
import { simChannel } from './simClient'

type Of<K extends Checkpoint['kind']> = Extract<Checkpoint, { kind: K }>

export type CheckpointPhase =
  /** Not started, or started over. */
  | 'idle'
  /** Talking to the Pi or the simulation. */
  | 'working'
  /** Waiting for the user (to press, or to settle the ERC dialog) or for the Pi. */
  | 'waiting'
  /** The Pi has driven the pin; the user says what they saw. */
  | 'asking'
  | 'passed'
  | 'failed'
  | 'error'

export interface CheckpointRun {
  phase: CheckpointPhase
  /** What the card says now. */
  message: string
  /** What to look at, when it failed. */
  causes: string[]
}

const IDLE: CheckpointRun = { phase: 'idle', message: '', causes: [] }

/** A stable name for a checkpoint across renders and steps. */
export const checkpointKey = (c: Checkpoint): string =>
  c.kind === 'i2c-scan' ? `i2c-scan:${c.addresses.join(',')}` : `${c.kind}:${c.part}:${c.gpio}`

/** The I2C bus on the 40-pin header (GPIO2 and GPIO3). */
export const HEADER_I2C_BUS = 1
/** How long the press watch waits for a press (ms). */
export const PRESS_TIMEOUT_MS = 30_000
/** A button reading its pressed level this long before it was pressed is reported as wired wrong. */
export const REST_HOLD_MS = 1500

const hex = (a: number) => `0x${a.toString(16).padStart(2, '0')}`

/** Stops a running press watch, by checkpoint key. */
const watchers = new Map<string, () => void>()

/** A toggle run in flight, followed through the Run on Pi store. */
interface Toggle {
  gpio: number
  /** The project id the script runs under, and its file name on the Pi. */
  id: string
  file: string
  /** The levels the Pi reported on the pin while it ran. */
  seen: Set<Level>
  note: string
}
const toggles = new Map<string, Toggle>()

interface CheckpointState {
  runs: Record<string, CheckpointRun>
  scan(c: Of<'i2c-scan'>): Promise<void>
  watchPress(c: Of<'press'>, doc: CircuitDoc): Promise<void>
  toggle(c: Of<'toggle-led'>, doc: CircuitDoc): Promise<void>
  /** The user's answer to "did the LED light?". */
  answer(c: Of<'toggle-led'>, doc: CircuitDoc, saw: boolean): void
  cancel(key: string): void
  reset(): void
}

export const useCheckpoints = create<CheckpointState>((set, get) => {
  const put = (key: string, run: Partial<CheckpointRun> & { phase: CheckpointPhase }) =>
    set({ runs: { ...get().runs, [key]: { ...IDLE, ...run } } })

  return {
    runs: {},

    async scan(c) {
      const key = checkpointKey(c)
      put(key, { phase: 'working', message: `Scanning I2C bus ${HEADER_I2C_BUS}…` })
      let found: number[]
      try {
        found = (await i2cScan(HEADER_I2C_BUS)).map((d) => d.address)
      } catch (e) {
        return put(key, {
          phase: 'error',
          message: e instanceof Error ? e.message : String(e),
          causes: [
            'The scan runs i2cdetect on the Pi: install i2c-tools (sudo apt install i2c-tools).',
            'Is I2C on? sudo raspi-config, Interface Options, I2C.'
          ]
        })
      }
      const hit = c.addresses.find((a) => found.includes(a))
      if (hit !== undefined)
        return put(key, {
          phase: 'passed',
          message: `Found a device at ${hex(hit)} on bus ${HEADER_I2C_BUS}. The module answers.`
        })
      const others = found.filter((a) => !c.addresses.includes(a)).map(hex)
      put(key, {
        phase: 'failed',
        message: `Nothing answered at ${c.addresses.map(hex).join(', ')}${others.length ? `; ${others.join(', ')} did` : ' (the bus is empty)'}.`,
        causes: [
          'SDA to GPIO2 and SCL to GPIO3: check both leads, and that they are in the module’s SDA and SCL pins, not swapped.',
          'VCC and GND: check the module is powered (3V3 for the 3.3 V modules).',
          'I2C may be off on the Pi: sudo raspi-config, Interface Options, I2C.',
          ...(others.length
            ? [`The module may be strapped to another address; ${others.join(', ')} answered.`]
            : [])
        ]
      })
    },

    async watchPress(c, doc) {
      const key = checkpointKey(c)
      watchers.get(key)?.()
      const gpio = `GPIO${c.gpio}`
      if (!useLive.getState().online)
        return put(key, {
          phase: 'error',
          message: 'No telemetry. Connect to the Pi and start its agent first.'
        })
      put(key, { phase: 'working', message: `Working out how ${c.part} should read…` })
      const levels = await pressLevels(
        doc,
        c.part,
        c.gpio,
        useLive.getState().pins[c.gpio]?.pull ?? 'none'
      )
      // Cancelled while the simulation ran (the step moved on, or the watch was started again).
      if (get().runs[key]?.phase !== 'working') return
      put(key, { phase: 'waiting', message: `Reading ${gpio}… Do not press ${c.part} yet.` })

      // Without a prediction from the simulation, any change on the pin counts.
      let armed = levels === null
      let first: Level | null = null
      let restTimer: ReturnType<typeof setTimeout> | null = null
      const stop = () => {
        unsubscribe()
        if (restTimer) clearTimeout(restTimer)
        clearTimeout(deadline)
        watchers.delete(key)
      }
      const finish = (run: Parameters<typeof put>[1]) => {
        stop()
        put(key, run)
      }
      const react = (p: LivePin | undefined) => {
        if (!p) return
        if (p.direction !== 'in')
          return finish({
            phase: 'error',
            message: `${gpio} is ${p.direction === 'out' ? 'an output' : 'not an input'} right now, so a button cannot be read on it.`,
            causes: ['Stop the program on the Pi, then watch again.']
          })
        if (levels === null) {
          first ??= p.level
          if (p.level !== first)
            finish({
              phase: 'passed',
              message: `${gpio} changed from ${first.toUpperCase()} to ${p.level.toUpperCase()}.`
            })
          return
        }
        const [rest, active] = [levels.rest.toUpperCase(), levels.active.toUpperCase()]
        if (p.level === levels.rest) {
          if (restTimer) clearTimeout(restTimer)
          restTimer = null
          if (!armed)
            put(key, {
              phase: 'waiting',
              message: `${gpio} reads ${rest} at rest. Press and hold ${c.part} now.`
            })
          armed = true
        } else if (armed)
          finish({
            phase: 'passed',
            message: `${gpio} went ${rest} to ${active} when ${c.part} was pressed.`
          })
        else
          restTimer ??= setTimeout(
            () =>
              finish({
                phase: 'failed',
                message: `${gpio} reads ${active} with ${c.part} released; it should read ${rest}.`,
                causes: [
                  `Check ${c.part}'s orientation: a tact switch's pins 1–2 are always connected, and so are 3–4. Turned a quarter turn, it holds the pin at ${levels.active === 'low' ? 'ground' : 'the supply'}.`,
                  `Check the pull on ${gpio}: the lead to the pull-up resistor or the supply may be missing, or in the wrong row.`,
                  'Is the button being held down?'
                ]
              }),
            REST_HOLD_MS
          )
      }
      const unsubscribe = useLive.subscribe((now, before) => {
        if (now.pins === before.pins && now.online === before.online) return
        if (!now.online) finish({ phase: 'error', message: 'The Pi’s telemetry stopped.' })
        else react(now.pins[c.gpio])
      })
      const deadline = setTimeout(
        () =>
          finish({
            phase: 'failed',
            message: `No ${levels ? `${levels.rest.toUpperCase()} to ${levels.active.toUpperCase()} change` : 'change'} on ${gpio} in ${PRESS_TIMEOUT_MS / 1000} s.`,
            causes: [
              `Check the lead from ${c.part} to ${gpio}'s strip, and that ${c.part} is the button wired to ${gpio}.`,
              'Check the button’s other side reaches ground (or the supply, for a pull-down wiring).',
              'A pin with no pull and no resistor floats: run the program, which sets the pull.'
            ]
          }),
        PRESS_TIMEOUT_MS
      )
      watchers.set(key, stop)
      react(useLive.getState().pins[c.gpio])
    },

    async toggle(c, doc) {
      const key = checkpointKey(c)
      const gpio = `GPIO${c.gpio}`
      const pin = useLive.getState().pins[c.gpio]
      if (pin?.direction === 'alt')
        return put(key, {
          phase: 'error',
          message: `${gpio} has an alternate function (${pin.function ?? 'in use'}); a plain output would fight it, so nothing was run.`
        })
      const status = useRun.getState().status
      if (status === 'deploying' || status === 'running')
        return put(key, { phase: 'error', message: 'A program is already running on the Pi.' })
      put(key, { phase: 'working', message: `Working out which level lights ${c.part}…` })
      const high = await lightsOnHigh(doc, c.part, c.gpio)
      // Cancelled while the simulation ran.
      if (get().runs[key]?.phase !== 'working') return
      const source = toggleScript(c.gpio, high ?? true)
      const id = `checkpoint-${c.part}-gpio${c.gpio}`
      const note =
        high === null
          ? ' The simulation could not tell which level lights it, so the script drives high first.'
          : ''
      toggles.set(key, { gpio: c.gpio, id, file: scriptName(id), seen: new Set(), note })
      put(key, {
        phase: 'working',
        message: `Starting the run: ${gpio} will be an output for about 6 s.${note}`
      })
      // The run carries on below, from the Run on Pi store's states: it may wait on the ERC dialog.
      const withCode = { ...doc, code: { ...doc.code, source } }
      void useRun.getState().run(id, source, erc(withCode, partDef))
    },

    answer(c, doc, saw) {
      const key = checkpointKey(c)
      toggles.delete(key)
      if (saw)
        return put(key, { phase: 'passed', message: `You saw ${c.part} light on GPIO${c.gpio}.` })
      const part = doc.parts.find((p) => p.id === c.part)
      const anode = part && partDef(part.defId).pins.find((p) => p.role === 'anode')
      const hole = anode && part.placement.pins[anode.id]
      put(key, {
        phase: 'failed',
        message: `${c.part} did not light when GPIO${c.gpio} was driven.`,
        causes: [
          `Check ${c.part}'s polarity: the longer leg (anode)${hole ? ` is in ${holeText(doc, hole)}` : ' goes toward the supply side'}.`,
          `Check the series resistor, and the lead from GPIO${c.gpio}'s strip to it.`,
          'Check the LED’s other leg reaches ground, or the supply if the LED is wired between the supply and the pin.',
          'Is the LED itself good? Try it on another pair of holes.'
        ]
      })
    },

    cancel(key) {
      watchers.get(key)?.()
      toggles.delete(key)
      const run = get().runs[key]
      if (run && run.phase !== 'passed' && run.phase !== 'failed') put(key, { phase: 'idle' })
    },

    reset() {
      for (const stop of [...watchers.values()]) stop()
      toggles.clear()
      set({ runs: {} })
    }
  }
})

const setRun = (key: string, run: Partial<CheckpointRun> & { phase: CheckpointPhase }) =>
  useCheckpoints.setState({
    runs: { ...useCheckpoints.getState().runs, [key]: { ...IDLE, ...run } }
  })

// The toggle run, followed through the Run on Pi store: it may wait on the ERC dialog, run, end, or fail.
useRun.subscribe((now, before) => {
  for (const [key, t] of toggles) {
    const gpio = `GPIO${t.gpio}`
    const blockedHere = now.blocked?.projectId === t.id
    const mine = now.filename === t.file || blockedHere
    if (blockedHere) {
      if (!before.blocked)
        setRun(key, {
          phase: 'waiting',
          message:
            'The circuit has ERC errors. Review them in the dialog: nothing runs until you choose.'
        })
    } else if (before.blocked?.projectId === t.id && now.status === before.status) {
      // The dialog was cancelled.
      toggles.delete(key)
      setRun(key, { phase: 'idle' })
    } else if (now.status === before.status) continue
    else if (now.status === 'error' && (mine || now.filename === null)) {
      toggles.delete(key)
      setRun(key, { phase: 'error', message: now.output.at(-1)?.data.trim() || 'The run failed.' })
    } else if (!mine) continue
    else if (now.status === 'running')
      setRun(key, {
        phase: 'working',
        message: `Running on the Pi: ${gpio} is an output for about 6 s.${t.note}`
      })
    else if (now.status === 'done') {
      const seen = [...t.seen]
      const saw =
        seen.length === 2
          ? `The Pi drove ${gpio} high and low.`
          : seen.length === 1
            ? `The Pi reported ${gpio} only ${seen[0]}.`
            : `Telemetry did not show ${gpio} change.`
      // Only the user's answer is left to wait for.
      toggles.delete(key)
      setRun(key, {
        phase: 'asking',
        message: `The run is over. ${saw} Did the LED light and go dark three times?`
      })
    }
  }
})

// While a toggle runs, the levels the Pi reports on its pin are the run's evidence.
useLive.subscribe((now, before) => {
  if (now.pins === before.pins) return
  for (const t of toggles.values()) {
    const pin = now.pins[t.gpio]
    if (pin?.direction === 'out') t.seen.add(pin.level)
  }
})

// Moving to another step, or leaving Build Mode, ends a watch or a pending question.
useBuild.subscribe((now, before) => {
  if (now.index === before.index && now.on === before.on) return
  const { runs, cancel } = useCheckpoints.getState()
  for (const key of Object.keys(runs)) cancel(key)
})

/**
 * The checkpoints' own simulation worker, created on first use. A job loads a document and asks it
 * questions, so jobs run one at a time.
 */
const channel = simChannel()
let queue: Promise<unknown> = Promise.resolve()
function simulate<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

/** What the button reads at rest and pressed, from the document's simulation; null when it cannot say. */
function pressLevels(
  doc: CircuitDoc,
  part: string,
  gpio: number,
  pull: LivePin['pull']
): Promise<{ rest: Level; active: Level } | null> {
  const level = (r: Awaited<ReturnType<typeof channel>>): Level | null =>
    r.type === 'state' && (r.reads[gpio] === 'high' || r.reads[gpio] === 'low')
      ? (r.reads[gpio] as Level)
      : null
  return simulate(async () => {
    if ((await channel({ type: 'load', doc })).type !== 'state') return null
    await channel({
      type: 'gpio',
      bcm: gpio,
      state: { mode: 'in', pull: pull === 'none' ? 'off' : pull }
    })
    const rest = level(await channel({ type: 'input', part, key: 'pressed', value: false }))
    const active = level(await channel({ type: 'input', part, key: 'pressed', value: true }))
    return rest && active && rest !== active ? { rest, active } : null
  })
}

/** Whether driving the pin high lights the part (false: low does); null when neither does. */
function lightsOnHigh(doc: CircuitDoc, partId: string, gpio: number): Promise<boolean | null> {
  const part = doc.parts.find((p) => p.id === partId)
  if (!part) return Promise.resolve(null)
  const def = partDef(part.defId)
  return simulate(async () => {
    if ((await channel({ type: 'load', doc })).type !== 'state') return null
    for (const level of [true, false]) {
      const r = await channel({ type: 'gpio', bcm: gpio, state: { mode: 'out', level } })
      if (r.type === 'state' && emissionOf(part, def, r.snapshot).size > 0) return level
    }
    return null
  })
}

/** The generated program: three on-off cycles on one pin, then the pin handed back as an input. */
export function toggleScript(gpio: number, onHigh: boolean): string {
  const [on, off] = onHigh ? ['HIGH', 'LOW'] : ['LOW', 'HIGH']
  return `# Generated by GPIO Dashboard for a checkpoint: it drives GPIO${gpio} for about 6 s, then gives it back.
import time

import RPi.GPIO as GPIO

PIN = ${gpio}  # BCM numbering
ON = GPIO.${on}  # the level that lights the LED in this circuit
OFF = GPIO.${off}

GPIO.setmode(GPIO.BCM)
GPIO.setup(PIN, GPIO.OUT, initial=OFF)

try:
    for _ in range(3):
        GPIO.output(PIN, ON)
        print('GPIO${gpio} ${on.toLowerCase()}: the LED should be on')
        time.sleep(1)
        GPIO.output(PIN, OFF)
        print('GPIO${gpio} ${off.toLowerCase()}: the LED should be off')
        time.sleep(1)
finally:
    GPIO.output(PIN, OFF)
    GPIO.cleanup(PIN)
`
}
