// The eval prompts (SPEC 18) and what each is scored on beyond the checks every run gets. A score
// reads the final document and the transcript. Where a prompt names a behaviour (a button that
// toggles an LED, a distance sensor), the check runs the project's own program in the simulator
// with the inputs a user would give it.
import type { Effort } from '@renderer/assistant/client'
import type { BoardSenseSnapshot } from '@renderer/assistant/context'
import { codePins } from '@renderer/core/code/pins'
import { pullUpButton } from '@renderer/core/sense/fixtures'
import { mockSweep } from '@renderer/core/sense/mockAgent'
import { rankCandidates } from '@renderer/core/sense/candidates'
import { Reconciler, interpret } from '@renderer/core/sense/sense'
import { probeSignature } from '@renderer/core/sim/probe'
import { BEHAVIORS } from '@renderer/core/sim/behaviors'
import { Circuit } from '@renderer/core/sim/circuit'
import { parse } from '@renderer/core/serialize/gpiob'
import type { CircuitDoc } from '@renderer/core/model/types'
import type { PartDefs } from '@renderer/core/netlist/netlist'
import { docPartDefs, netlist, type Net, type Netlist } from '@renderer/core/netlist/netlist'
import sampleBlink from '@renderer/content/samples/sample-blink.gpiob?raw'
import {
  calls,
  check,
  codeDirections,
  dieMilliamps,
  ercIssues,
  finalText,
  firstClientCall,
  isGpio,
  mutationCalls,
  out,
  simulateDoc,
  type Check,
  type Run
} from './checks'
import { FIXED_TIME, type NodeContext } from './nodeContext'

export interface Seed {
  doc: CircuitDoc
  sense?: BoardSenseSnapshot
}

export interface EvalPrompt {
  id: string
  title: string
  /** The user's messages, one per turn. */
  turns: string[]
  effort: Effort
  webTools: boolean
  /** Dollars after which a live run is aborted. */
  maxCostUsd: number
  /** Start from the final document of another prompt's run. */
  after?: string
  /** Start from this document (and Board Sense reading). */
  seed?: (defs: PartDefs) => Seed
  /** Parts the user names, which the inventory does not hold. */
  allowParts?: string[]
  /** The prompt asks for a part the library lacks. */
  allowCustom?: boolean
  /** False when the right answer changes nothing. */
  mutates?: boolean
  /** False when the prompt needs no program. */
  code?: boolean
  answer?: (question: string, options: string[]) => string
  /** What this prompt is scored on besides the generic checks. */
  extra(run: Run): Check[]
}

/** Takes the option that reads like a go-ahead; otherwise the first. */
export const goAhead = (_: string, options: string[]): string =>
  options.find((o) => /divider|resistor|yes|go ahead|proceed|continue|use it|ok/i.test(o)) ??
  options[0] ??
  ''

// --- Running the project's program ---

interface PinTimeline {
  /** The level of each output GPIO at each event, from the program's own pin events. */
  events: { t: number; bcm: number; event: string }[]
  error: string | null
  stdout: string
}

function runProgram(
  run: Run,
  seconds: number,
  options: Parameters<NodeContext['python']['run']>[3] = {}
): PinTimeline {
  const sim = run.ctx.python.run(run.final, run.ctx.partDef, seconds, {
    virtualPause: true,
    ...options
  })
  return { events: sim.events, error: sim.error, stdout: sim.stdout }
}

/** How many times a GPIO changed level in a program's events. */
function transitions(events: PinTimeline['events'], bcm: number): number {
  let last: string | null = null
  let n = 0
  for (const e of events) {
    if (e.bcm !== bcm || (e.event !== 'high' && e.event !== 'low')) continue
    if (last !== null && e.event !== last) n += 1
    last = e.event
  }
  return n
}

const ledPart = (run: Run) => run.final.parts.find((p) => p.defId === 'led')
const partsOf = (run: Run, ...ids: string[]) => run.final.parts.filter((p) => ids.includes(p.defId))

/** The pull the program sets on an input pin. */
function pullOf(run: Run, bcm: number): 'up' | 'down' | 'off' {
  const pull = run.final.code.source ? codePinsPull(run.final.code.source, bcm) : undefined
  return pull === 'up' || pull === 'down' ? pull : 'off'
}

function codePinsPull(source: string, bcm: number) {
  return codePins(source).uses.find((u) => u.bcm === bcm && u.mode === 'in')?.pull
}

// --- Prompt-specific scores ---

function blinkChecks(run: Run, bcm: number): Check[] {
  const defs = run.ctx.partDef
  const on = simulateDoc(run.final, defs, { gpio: { [bcm]: out(true) } })
  const off = simulateDoc(run.final, defs, { gpio: { [bcm]: out(false) } })
  const lit = Object.entries(dieMilliamps(on.snapshot)).filter(([, mA]) => mA >= 1)
  const dark = Object.values(dieMilliamps(off.snapshot)).every((mA) => mA < 0.01)
  const over = on.issues.filter((i) => i.severity === 'error')
  const program = runProgram(run, 3)
  const flips = transitions(program.events, bcm)
  return [
    check(
      'sim.on',
      `GPIO${bcm} high lights an LED within 1-16 mA`,
      lit.length > 0 && lit.every(([, mA]) => mA <= 16) && over.length === 0,
      `${lit.map(([d, mA]) => `${d} ${mA.toFixed(2)} mA`).join(', ') || 'no LED lit'}${over.length ? `; ${over.map((i) => i.code).join(', ')}` : ''}`
    ),
    check('sim.off', `GPIO${bcm} low leaves every LED dark`, dark),
    check(
      'sim.program',
      `The program toggles GPIO${bcm} in the simulator`,
      program.error === null && flips >= 4,
      program.error ?? `${flips} level changes in 3 s`
    )
  ]
}

function expectPins(run: Run, pins: { out?: number[]; in?: number[] }): Check[] {
  const dir = codeDirections(run.final)
  const missingOut = (pins.out ?? []).filter((p) => !dir.outputs.includes(p))
  const missingIn = (pins.in ?? []).filter((p) => !dir.inputs.includes(p))
  return [
    check(
      'code.requested-pins',
      'The code uses the GPIOs the prompt names',
      missingOut.length + missingIn.length === 0,
      [
        ...missingOut.map((p) => `GPIO${p} is not an output`),
        ...missingIn.map((p) => `GPIO${p} is not an input`)
      ].join('; ')
    )
  ]
}

const noQuestions = (run: Run): Check =>
  check(
    'one-turn',
    'Built in one turn, with no question to the user',
    run.turns.length === 1 && run.ctx.questions.length === 0,
    `${run.turns.length} turn(s), ${run.ctx.questions.length} question(s)`
  )

/** A netlist view of what a part's pins are on. */
function netsOf(run: Run, ref: string, pins: string[]): string[][] {
  const nl = netlist(run.final, run.ctx.partDef)
  return pins.map((p) => nl.byName.get(nl.netOfPin.get(`${ref}.${p}`) ?? '')?.names ?? [])
}

// --- The parking sensor ---

/**
 * The named nets reachable from `start` through resistors, crossing unnamed nets (a divider's
 * middle) but stopping at a net with a name: that is a pin, a supply or ground.
 */
function throughResistors(doc: CircuitDoc, defs: PartDefs, nl: Netlist, start: Net): Net[] {
  const resolve = docPartDefs(doc, defs)
  const resistors = doc.parts.filter((p) => resolve(p.defId).sim.model === 'resistor')
  const edges = resistors.flatMap((r) => {
    const a = nl.byName.get(nl.netOfPin.get(`${r.id}.1`) ?? '')
    const b = nl.byName.get(nl.netOfPin.get(`${r.id}.2`) ?? '')
    return a && b ? [[a, b] as const] : []
  })
  const seen = new Set<Net>([start])
  const reached: Net[] = []
  const queue = [start]
  while (queue.length) {
    const net = queue.shift()!
    for (const [a, b] of edges) {
      const other = a === net ? b : b === net ? a : null
      if (!other || seen.has(other)) continue
      seen.add(other)
      if (other.names.length) reached.push(other)
      else queue.push(other)
    }
  }
  return reached
}

/**
 * The ECHO pin reaches no GPIO directly, and the GPIO it does reach through resistors has a
 * resistive path to GND: a divider (or a level shifter part in between).
 */
export function echoProtection(
  doc: CircuitDoc,
  defs: PartDefs
): { protected: boolean; detail: string } {
  const nl = netlist(doc, defs)
  const sensors = doc.parts.filter((p) => p.defId === 'hc-sr04')
  if (!sensors.length) return { protected: false, detail: 'no HC-SR04 in the project' }
  const reasons: string[] = []
  let all = true
  for (const sensor of sensors) {
    const echo = nl.byName.get(nl.netOfPin.get(`${sensor.id}.ECHO`) ?? '')
    if (!echo) {
      all = false
      reasons.push(`${sensor.id}.ECHO is not on a net`)
      continue
    }
    const direct = echo.names.filter(isGpio)
    if (direct.length) {
      all = false
      reasons.push(`${sensor.id}.ECHO is wired straight to ${direct.join(', ')}`)
      continue
    }
    const divided = throughResistors(doc, defs, nl, echo)
      .filter((net) => net.names.some(isGpio))
      .filter((net) => throughResistors(doc, defs, nl, net).some((n) => n.names.includes('GND')))
    const shifters = doc.parts.filter((p) =>
      /level.?shift/i.test(docPartDefs(doc, defs)(p.defId).name)
    )
    if (divided.length)
      reasons.push(
        `${sensor.id}.ECHO divides down to ${divided[0]!.names.filter(isGpio).join(', ')}`
      )
    else if (shifters.length) reasons.push(`${sensor.id}.ECHO goes through ${shifters[0]!.id}`)
    else {
      all = false
      reasons.push(`${sensor.id}.ECHO has no divider or level shifter`)
    }
  }
  return { protected: all, detail: reasons.join('; ') }
}

/** The highest voltage any GPIO net reaches while the sensor measures. */
export function maxGpioVolts(doc: CircuitDoc, defs: PartDefs): number | null {
  const nl = netlist(doc, defs)
  const sensor = doc.parts.find((p) => p.defId === 'hc-sr04')
  if (!sensor) return null
  const trig = nl.byName.get(nl.netOfPin.get(`${sensor.id}.TRIG`) ?? '')
  const trigGpio = trig?.names.find(isGpio)
  const gpioNets = nl.nets.filter((n) => n.names.some(isGpio))
  const probe = simulateDoc(doc, defs, {
    gpio: trigGpio ? { [Number(trigGpio.slice(4))]: out(false) } : {},
    inputs: [[sensor.id, 'distanceCm', 100]]
  })
  let max = 0
  const session = probe.session
  const sample = () => {
    const nets = session.snapshot().nets
    for (const net of gpioNets) max = Math.max(max, nets[net.name] ?? 0)
  }
  sample()
  if (trigGpio) {
    const bcm = Number(trigGpio.slice(4))
    session.setGpio(bcm, out(true))
    session.advanceTo(session.time + 20e-6)
    session.setGpio(bcm, out(false))
  }
  for (let i = 0; i < 160; i++) {
    session.advanceTo(session.time + 50e-6)
    sample()
  }
  return max
}

function parkingChecks(run: Run): Check[] {
  const protection = echoProtection(run.final, run.ctx.partDef)
  const volts = maxGpioVolts(run.final, run.ctx.partDef)
  const dir = codeDirections(run.final)
  const sawOvervoltage = run.calls.some((c) => /OVERVOLTAGE_GPIO/.test(c.result))
  const stillOvervoltage = ercIssues(run.final, run.ctx.partDef).some(
    (i) => i.code === 'OVERVOLTAGE_GPIO'
  )
  const directFirst = run.calls.some(
    (c) =>
      c.name === 'connect' &&
      JSON.stringify(c.input ?? {}).includes('ECHO') &&
      /"net":"GPIO\d+"/.test(JSON.stringify(c.input ?? {}))
  )
  return [
    check(
      'parts',
      'An HC-SR04, a passive buzzer and 3 LEDs',
      partsOf(run, 'hc-sr04').length === 1 &&
        partsOf(run, 'passive-buzzer').length === 1 &&
        partsOf(run, 'led').length >= 3,
      run.final.parts.map((p) => p.defId).join(', ')
    ),
    check(
      'echo.protected',
      'ECHO is protected by a divider or level shifter',
      protection.protected,
      protection.detail
    ),
    check(
      'echo.volts',
      'No GPIO net rises above 3.6 V while the sensor measures',
      volts !== null && volts <= 3.6,
      volts === null ? 'no sensor' : `${volts.toFixed(2)} V at most`
    ),
    check(
      'overvoltage.handled',
      'An OVERVOLTAGE_GPIO report, if any, was fixed in the same turn',
      !sawOvervoltage || (protection.protected && !stillOvervoltage),
      `ECHO wired directly first: ${directFirst}; OVERVOLTAGE_GPIO seen: ${sawOvervoltage}; turns: ${run.turns.length}`
    ),
    check(
      'code.directions',
      'The code reads ECHO and drives TRIG, the buzzer and the LEDs',
      dir.inputs.length >= 1 && dir.outputs.length >= 5,
      `${dir.inputs.length} input(s), ${dir.outputs.length} output(s)`
    )
  ]
}

// --- Board Sense seed for the debugging prompt ---

/** The twin is fixture 3 (GPIO18 with a pull-up and a button); the real board lacks W2. */
function debugSeed(defs: PartDefs): Seed {
  const twin = pullUpButton(defs)
  const board = structuredClone(twin)
  board.wires = board.wires.filter((w) => w.id !== 'W2')
  const pins = [17, 18, 27]
  const sweeps = [0.25, 0.5].map((t) => mockSweep(board, defs, pins, t))
  const reconciler = new Reconciler(probeSignature(new Circuit(twin, defs, BEHAVIORS), pins))
  for (const sweep of sweeps) reconciler.onSweep(sweep)
  const ranked = rankCandidates(twin, defs, interpret(sweeps[1]!), pins)
  return {
    doc: twin,
    sense: {
      on: true,
      states: [...reconciler.netStates],
      events: reconciler.events,
      candidates: { 18: ranked }
    }
  }
}

/** The ids (W2, R1...) and holes the top ranked candidates name. */
function candidateTerms(sense: BoardSenseSnapshot): string[] {
  const top = Object.values(sense.candidates).flatMap((ranked) => ranked.slice(0, 1))
  return [
    ...new Set(
      top.flatMap((r) => r.candidates.flatMap((c) => c.text.match(/\b[A-Z]{1,2}\d+\b/g) ?? []))
    )
  ]
}

// --- The prompts ---

export const PROMPTS: EvalPrompt[] = [
  {
    id: 'blink-led',
    title: 'Blink an LED on GPIO17',
    turns: ['blink an LED on GPIO17'],
    effort: 'high',
    webTools: false,
    maxCostUsd: 5,
    extra: (run) => [...blinkChecks(run, 17), ...expectPins(run, { out: [17] }), noQuestions(run)]
  },
  {
    id: 'button-toggles-led',
    title: 'A button with a pull-up toggles an LED',
    turns: [
      'Wire a button on GPIO27 with a pull-up, so that pressing it toggles an LED on GPIO17.'
    ],
    effort: 'high',
    webTools: false,
    maxCostUsd: 6,
    extra: (run) => {
      const defs = run.ctx.partDef
      const button = partsOf(run, 'tact-switch-6mm')[0]
      const pull = pullOf(run, 27)
      const released = simulateDoc(run.final, defs, {
        gpio: { 27: { mode: 'in', pull } },
        inputs: button ? [[button.id, 'pressed', false]] : []
      })
      const pressed = simulateDoc(run.final, defs, {
        gpio: { 27: { mode: 'in', pull } },
        inputs: button ? [[button.id, 'pressed', true]] : []
      })
      const led = ledPart(run)
      const program = runProgram(run, 4, {
        schedule: button
          ? [
              { t: 1, part: button.id, key: 'pressed', value: true },
              { t: 1.3, part: button.id, key: 'pressed', value: false }
            ]
          : []
      })
      const toggled = program.events.filter((e) => e.bcm === 17 && e.t >= 1)
      return [
        ...expectPins(run, { out: [17], in: [27] }),
        check(
          'sim.released',
          'Released, GPIO27 reads high',
          released.session.read(27) === 'high',
          `reads ${released.session.read(27)} (pull ${pull})`
        ),
        check(
          'sim.pressed',
          'Pressed, GPIO27 reads low',
          pressed.session.read(27) === 'low',
          `reads ${pressed.session.read(27)}`
        ),
        check('parts', 'A button and an LED', !!button && !!led),
        check(
          'sim.program',
          'Pressing the button changes GPIO17 in the program',
          program.error === null && toggled.length > 0,
          program.error ?? `${toggled.length} change(s) of GPIO17 after the press`
        ),
        noQuestions(run)
      ]
    }
  },
  {
    id: 'parking-sensor',
    title: 'Parking sensor with HC-SR04, passive buzzer and 3 LEDs',
    turns: ['parking sensor with HC-SR04 + passive buzzer + 3 LEDs'],
    effort: 'high',
    webTools: false,
    maxCostUsd: 12,
    allowParts: ['hc-sr04'],
    answer: goAhead,
    extra: parkingChecks
  },
  {
    id: 'parking-sensor-direct',
    title: 'Parking sensor, ECHO wired straight to a GPIO first',
    turns: [
      'Build a parking sensor with an HC-SR04, a passive buzzer and 3 LEDs. Start by wiring the HC-SR04 ECHO pin straight to a GPIO and run ERC, so I can see what it says about that. Then fix the circuit properly.'
    ],
    effort: 'high',
    webTools: false,
    maxCostUsd: 12,
    allowParts: ['hc-sr04'],
    answer: goAhead,
    extra: (run) => {
      const directFirst = run.calls.some(
        (c) =>
          c.name === 'connect' &&
          JSON.stringify(c.input ?? {}).includes('ECHO') &&
          /"net":"GPIO\d+"/.test(JSON.stringify(c.input ?? {}))
      )
      const caught = run.calls.some((c) => /OVERVOLTAGE_GPIO/.test(c.result))
      return [
        ...parkingChecks(run),
        check(
          'overvoltage.caught',
          'ERC reported OVERVOLTAGE_GPIO for the direct ECHO lead',
          directFirst && caught,
          `ECHO wired directly: ${directFirst}; reported: ${caught}`
        )
      ]
    }
  },
  {
    id: 'undo-all',
    title: 'Undo restores each earlier document',
    turns: [
      'blink an LED on GPIO17',
      'add a second LED on GPIO27 that blinks opposite to the first'
    ],
    effort: 'high',
    webTools: false,
    maxCostUsd: 8,
    extra: (run) => {
      const program = runProgram(run, 4)
      const level: Record<number, boolean> = {}
      let opposite = 0
      let same = 0
      for (const e of program.events) {
        if (e.event !== 'high' && e.event !== 'low') continue
        level[e.bcm] = e.event === 'high'
        if (level[17] !== undefined && level[27] !== undefined) {
          if (level[17] !== level[27]) opposite += 1
          else same += 1
        }
      }
      return [
        ...expectPins(run, { out: [17, 27] }),
        check(
          'sim.program',
          'GPIO17 and GPIO27 blink in opposition',
          program.error === null && opposite > 0 && transitions(program.events, 27) >= 2,
          program.error ?? `${opposite} opposite, ${same} equal pin states`
        ),
        check(
          'led.count',
          'Two LEDs',
          partsOf(run, 'led').length === 2,
          `${partsOf(run, 'led').length} LED(s)`
        )
      ]
    }
  },
  {
    id: 'second-button-speed',
    title: 'Add a second button that changes the blink speed',
    turns: [
      'add a second button, on GPIO22, that changes how fast the LED blinks each time it is pressed'
    ],
    after: 'button-toggles-led',
    effort: 'high',
    webTools: false,
    maxCostUsd: 6,
    extra: (run) => {
      const before = run.start.parts
      const kept = before.filter((p) =>
        run.final.parts.some((q) => q.id === p.id && q.defId === p.defId)
      )
      const buttons = partsOf(run, 'tact-switch-6mm')
      const first = firstClientCall(run)
      return [
        check(
          'reads-first',
          'Reads the project before editing it',
          first?.name === 'get_circuit_state',
          `first call: ${first?.name ?? 'none'}`
        ),
        check(
          'kept',
          'Keeps the parts that were there',
          kept.length === before.length,
          `${kept.length} of ${before.length}`
        ),
        check('buttons', 'Two buttons', buttons.length === 2, `${buttons.length} button(s)`),
        ...expectPins(run, { out: [17], in: [22, 27] })
      ]
    }
  },
  {
    id: 'rgb-led',
    title: 'An RGB LED cycles red, green, blue',
    turns: ['Make the RGB LED cycle through red, green and blue, on GPIO17, GPIO27 and GPIO22.'],
    effort: 'high',
    webTools: false,
    maxCostUsd: 5,
    extra: (run) => {
      const defs = run.ctx.partDef
      const lit = [17, 27, 22].map((bcm) =>
        Object.entries(
          dieMilliamps(simulateDoc(run.final, defs, { gpio: { [bcm]: out(true) } }).snapshot)
        )
          .filter(([, mA]) => mA >= 1)
          .map(([die, mA]) => ({ bcm, die, mA }))
      )
      const dies = new Set(lit.flat().map((l) => l.die))
      const program = runProgram(run, 6)
      return [
        ...expectPins(run, { out: [17, 27, 22] }),
        check(
          'sim.dies',
          'Each GPIO lights its own colour, 1-16 mA',
          lit.every((l) => l.length === 1 && l[0]!.mA <= 16) && dies.size === 3,
          lit
            .map((l) => l.map((d) => `GPIO${d.bcm} ${d.die} ${d.mA.toFixed(1)} mA`).join(' '))
            .join('; ')
        ),
        check(
          'sim.program',
          'The program drives all three GPIOs',
          program.error === null &&
            [17, 27, 22].every((b) => program.events.some((e) => e.bcm === b)),
          program.error ?? ''
        ),
        noQuestions(run)
      ]
    }
  },
  {
    id: 'buzzer-driver',
    title: 'An active buzzer sounded from GPIO18',
    turns: ['Sound the active buzzer for half a second every few seconds, from GPIO18.'],
    effort: 'high',
    webTools: false,
    maxCostUsd: 5,
    extra: (run) => {
      const defs = run.ctx.partDef
      const buzzer = partsOf(run, 'active-buzzer')[0]
      const driver = partsOf(run, 'pn2222', 's8050')
      const on = simulateDoc(run.final, defs, { gpio: { 18: out(true) } })
      const off = simulateDoc(run.final, defs, { gpio: { 18: out(false) } })
      const view = (s: typeof on) => (buzzer ? s.snapshot.parts[buzzer.id]?.sounding : undefined)
      const direct = buzzer ? netsOf(run, buzzer.id, ['+', '-']).flat().filter(isGpio) : []
      const pinMa = Math.abs((on.snapshot.gpio[18]?.currentA ?? 0) * 1000)
      return [
        ...expectPins(run, { out: [18] }),
        check(
          'driver',
          'A transistor drives the buzzer',
          !!buzzer && driver.length === 1,
          `${driver.length} transistor(s)`
        ),
        check('not-direct', 'The buzzer is on no GPIO net', direct.length === 0, direct.join(', ')),
        check(
          'sim.sounds',
          'GPIO18 high sounds the buzzer; low silences it',
          view(on) === true && view(off) === false,
          `high: ${String(view(on))}, low: ${String(view(off))}`
        ),
        check(
          'sim.pin-current',
          'GPIO18 supplies under 16 mA',
          pinMa <= 16 && on.issues.filter((i) => i.severity === 'error').length === 0,
          `${pinMa.toFixed(2)} mA`
        ),
        noQuestions(run)
      ]
    }
  },
  {
    id: 'pot-adc',
    title: 'A potentiometer read through the ADS7830',
    turns: [
      'Read the potentiometer through the ADS7830 module over I2C, and print its value every half second.'
    ],
    effort: 'high',
    webTools: false,
    maxCostUsd: 6,
    extra: (run) => {
      const pot = partsOf(run, 'potentiometer-10k')[0]
      const module = partsOf(run, 'ads7830-module')[0]
      // The first number the program prints is the reading. A pot wired the other way round reads
      // 255 minus the wiper, so either direction counts if both runs agree on it.
      const reads = [25, 75].map((wiper) => {
        const program = pot
          ? runProgram(run, 3, { inputs: [[pot.id, 'wiper', wiper]] })
          : { stdout: '', error: 'no potentiometer', events: [] }
        const printed = Number(/\b\d{1,3}\b/.exec(program.stdout)?.[0])
        const want = Math.round((wiper / 100) * 255)
        return { wiper, want, printed, error: program.error }
      })
      const near = (a: number, b: number) => Math.abs(a - b) <= 8
      const forward = reads.every((r) => near(r.printed, r.want))
      const reversed = reads.every((r) => near(r.printed, 255 - r.want))
      return [
        check('parts', 'A potentiometer and the ADS7830', !!pot && !!module),
        check(
          'sim.reads',
          'The first value printed follows the wiper (at 25% and at 75%)',
          (forward || reversed) && reads.every((r) => r.error === null),
          reads
            .map(
              (r) =>
                `wiper ${r.wiper}%: want ~${r.want} (or ${255 - r.want} wired the other way), printed ${Number.isNaN(r.printed) ? 'nothing' : r.printed}${r.error ? ` (${r.error})` : ''}`
            )
            .join('; ')
        ),
        check('i2c', 'The code uses I2C on GPIO2 and GPIO3', codeDirections(run.final).i2c, ''),
        noQuestions(run)
      ]
    }
  },
  {
    id: 'debug-board-sense',
    title: 'Debugging a real board: read Board Sense first',
    turns: [
      'Board Sense is on. My button on GPIO18 never registers on the real breadboard, but the twin looks right to me. What is wrong?'
    ],
    effort: 'medium',
    webTools: false,
    maxCostUsd: 3,
    mutates: false,
    code: false,
    seed: debugSeed,
    extra: (run) => {
      const first = firstClientCall(run)
      const terms = candidateTerms(run.ctx.sense)
      const text = finalText(run)
      return [
        check(
          'reads-sense-first',
          'Calls read_board_sense before anything else',
          first?.name === 'read_board_sense',
          `first call: ${first?.name ?? 'none'}`
        ),
        check(
          'no-edits',
          'Changes nothing in the project',
          mutationCalls(run).length === 0,
          mutationCalls(run)
            .map((c) => c.name)
            .join(', ')
        ),
        check(
          'names-cause',
          'Names what Board Sense ranked first',
          terms.length > 0 && terms.some((t) => text.includes(t)),
          `top candidate names ${terms.join(', ') || 'nothing'}`
        ),
        // The fault injected in debugSeed: the pull-up's lead to the + rail is missing.
        check(
          'names-fault',
          'Names the lead that is actually missing (W2)',
          /\bW2\b/.test(text),
          ''
        ),
        check(
          'says-unobserved',
          'Says what the Pi cannot observe',
          /can(?:no|')t (?:be )?(?:observe|see|measure|detect)|unobserv|not observable|cannot tell/i.test(
            text
          ),
          ''
        )
      ]
    }
  },
  {
    id: 'explain-no-change',
    title: 'A question that must not change the project',
    turns: [
      'Why does the LED in this circuit need the resistor, and how much current flows through it?'
    ],
    effort: 'medium',
    webTools: false,
    maxCostUsd: 3,
    mutates: false,
    code: false,
    seed: () => ({ doc: parse(sampleBlink) }),
    extra: (run) => [
      check(
        'no-edits',
        'Makes no tool call that changes the project',
        mutationCalls(run).length === 0,
        mutationCalls(run)
          .map((c) => c.name)
          .join(', ')
      ),
      check(
        'quotes-current',
        'Quotes the current in mA',
        /\d+(\.\d+)?\s*mA/i.test(finalText(run)),
        ''
      ),
      check(
        'grounded',
        'Looked at the circuit or simulated it',
        calls(run, 'get_circuit_state').length + calls(run, 'simulate').length > 0,
        ''
      )
    ]
  },
  {
    id: 'bmp280-datasheet',
    title: 'A BMP280 breakout, from its datasheet',
    turns: ['I have a BMP280 breakout; read temperature over I2C'],
    effort: 'high',
    // The only prompt that needs the web tools: it must find a datasheet.
    webTools: true,
    maxCostUsd: 8,
    allowCustom: true,
    answer: goAhead,
    extra: (run) => {
      const custom = run.final.customParts ?? []
      const def = custom[0]
      const web = run.calls.filter((c) => c.server)
      const cited = def?.provenance.sources.filter((s) => /^https:\/\//.test(s)) ?? []
      const used = def ? run.final.parts.some((p) => p.defId === def.id) : false
      const mixed =
        run.turns.length > 0 && web.length > 0 && calls(run, 'define_custom_part').length > 0
      return [
        check(
          'custom-part',
          'Defines a custom part and places it',
          custom.length === 1 && used,
          `${custom.length} defined`
        ),
        check(
          'datasheet',
          'The part cites a datasheet URL',
          cited.length > 0 && !def?.kitTags.includes('no datasheet'),
          cited.join(', ')
        ),
        check(
          'web-tools',
          'Looked the datasheet up with the web tools',
          web.length > 0,
          [...new Set(web.map((c) => `${c.name}${c.ok ? '' : ' (failed)'}`))].join(', ')
        ),
        check('i2c', 'The code uses I2C', codeDirections(run.final).i2c, ''),
        check('mixed-turn', 'Mixed web and client tools in one run', mixed, '')
      ]
    }
  }
]

export const promptById = (id: string): EvalPrompt | undefined => PROMPTS.find((p) => p.id === id)

export { FIXED_TIME }
