// The tools that check a circuit: ERC, simulation, code, and Board Sense (SPEC 12.5). None of
// them touches hardware. `write_code` stores the program in the document; running it is
// `run_code_in_sim`, which uses the simulator's Pyodide.
import { z } from 'zod'
import { codePins } from '../../core/code/pins'
import { erc, type Issue } from '../../core/erc/erc'
import { holeKey } from '../../core/geometry/breadboard'
import type { CircuitDoc } from '../../core/model/types'
import { docPartDefs, netlist, type PartDefs } from '../../core/netlist/netlist'
import type { GpioState } from '../../core/sim/circuit'
import type { Snapshot } from '../../core/sim/session'
import type { SimRequest } from '../context'
import { commit, defineTool, failure, isOutput, reply } from './types'

const issueRows = (issues: Issue[]) =>
  issues.map((i) => ({
    code: i.code,
    severity: i.severity,
    refs: i.refs,
    message: i.message,
    fix: i.fix
  }))

const counts = (issues: Issue[]) => ({
  errors: issues.filter((i) => i.severity === 'error').length,
  warnings: issues.filter((i) => i.severity === 'warning').length,
  info: issues.filter((i) => i.severity === 'info').length
})

export const runErc = defineTool({
  name: 'run_erc',
  description:
    'Run the electrical rule checks on the circuit as it is now: shorts, GPIOs driven into supplies, 5 V into a GPIO, LEDs without a resistor, floating inputs, inductive loads without a driver, dangling leads, code that disagrees with the wiring, leads too short. Every issue has a code, the refs involved, a plain explanation and a fix. Run it after each batch of edits.',
  schema: z.object({}).strict(),
  strict: false,
  run(_, env) {
    const issues = erc(env.ctx.getSnapshot(), env.ctx.partDef)
    return reply({ ...counts(issues), issues: issueRows(issues) })
  }
})

// --- Simulation ---

const stimulusInput = z
  .object({
    gpio: z
      .array(
        z
          .object({
            pin: z.number().int().describe('BCM number, e.g. 17 for GPIO17.'),
            level: z.enum(['high', 'low', 'pwm']),
            freqHz: z.number().describe('PWM frequency; 0 unless level is pwm.'),
            duty: z.number().describe('PWM duty from 0 to 1; 0 unless level is pwm.')
          })
          .strict()
      )
      .describe('GPIOs the Pi drives as outputs. Empty leaves every GPIO as an input.'),
    inputs: z
      .array(
        z
          .object({
            part: z.string(),
            key: z.string().describe('A property of the part: pressed, distanceCm, lux, celsius…'),
            value: z.union([z.string(), z.number(), z.boolean()])
          })
          .strict()
      )
      .describe('Switch positions and sensor values (the part’s editable properties).')
  })
  .strict()

const simulateInput = z
  .object({
    mode: z.enum(['op', 'transient']),
    durationMs: z.number().int().describe('Transient length in ms (at most 60000). 0 for op.'),
    stimulus: stimulusInput
  })
  .strict()

const r3 = (n: number) => Math.round(n * 1000) / 1000
const mA = (a: number) => r3(a * 1000)

/** The simulated numbers worth quoting, from a snapshot. */
function simReport(doc: CircuitDoc, defs: PartDefs, snapshot: Snapshot, issues: Issue[]) {
  defs = docPartDefs(doc, defs)
  const nl = netlist(doc, defs)
  const volts = (part: string, pin: string) => {
    const net = nl.netOfPin.get(`${part}.${pin}`)
    return net === undefined ? undefined : snapshot.nets[net]
  }
  const resistors = doc.parts.flatMap((part) => {
    if (defs(part.defId).sim.model !== 'resistor') return []
    const ohms = Number(part.props.resistance ?? defs(part.defId).properties.resistance?.default)
    const [v1, v2] = [volts(part.id, '1'), volts(part.id, '2')]
    if (v1 === undefined || v2 === undefined || !(ohms > 0)) return []
    const amps = (v1 - v2) / ohms
    return [
      { ref: part.id, ohms, volts: r3(v1 - v2), mA: mA(amps), mW: r3(amps * (v1 - v2) * 1000) }
    ]
  })
  return {
    t: snapshot.t,
    nets: Object.fromEntries(Object.entries(snapshot.nets).map(([n, v]) => [n, r3(v)])),
    leds: Object.entries(snapshot.dies).map(([key, d]) => ({
      die: key,
      mA: mA(d.currentA),
      brightness: r3(d.brightness)
    })),
    gpio: Object.entries(snapshot.gpio).map(([pin, g]) => ({
      pin: `GPIO${pin}`,
      volts: r3(g.volts),
      mA: mA(g.currentA)
    })),
    rails: { '3V3_mA': mA(snapshot.rails['3V3']), '5V_mA': mA(snapshot.rails['5V']) },
    resistors,
    parts: snapshot.parts,
    ...(snapshot.approximate ? { approximate: true } : {}),
    ...counts(issues),
    issues: issueRows(issues)
  }
}

export const simulate = defineTool({
  name: 'simulate',
  description:
    'Simulate the circuit: per-net voltages, LED currents and brightness, resistor currents and power, GPIO currents, supply draw, behaviour of ICs and modules, and the sim-based checks (a pin over 16 mA, the GPIOs over 50 mA together, an LED over its rated current). `op` solves the steady state; `transient` runs durationMs of virtual time. Drive GPIOs and part inputs through `stimulus`. Quote the numbers when you say whether a circuit works.',
  schema: simulateInput,
  async run({ mode, durationMs, stimulus }, env) {
    const doc = env.ctx.getSnapshot()
    const defs = docPartDefs(doc, env.ctx.partDef)
    if (durationMs < 0 || durationMs > 60000)
      return failure('BAD_DURATION', 'durationMs must be between 0 and 60000')
    const requests: SimRequest[] = [{ type: 'load', doc }]
    for (const g of stimulus.gpio) {
      if (g.pin < 0 || g.pin > 27) return failure('BAD_PIN', `GPIO${g.pin} is not a header GPIO`)
      if (g.level === 'pwm' && !(g.freqHz > 0 && g.duty >= 0 && g.duty <= 1))
        return failure('BAD_PWM', 'PWM needs freqHz above 0 and duty from 0 to 1')
      const state: GpioState =
        g.level === 'pwm'
          ? { mode: 'out', level: false, pwm: { frequencyHz: g.freqHz, duty: g.duty, startS: 0 } }
          : { mode: 'out', level: g.level === 'high' }
      requests.push({ type: 'gpio', bcm: g.pin, state })
    }
    for (const input of stimulus.inputs) {
      const part = doc.parts.find((p) => p.id === input.part)
      if (!part) return failure('NO_SUCH_PART', `No part ${input.part}`)
      if (!(input.key in defs(part.defId).properties))
        return failure('NO_SUCH_INPUT', `${input.part} has no input ${input.key}`)
      requests.push({ type: 'input', part: input.part, key: input.key, value: input.value })
    }
    if (mode === 'transient') requests.push({ type: 'advance', t: durationMs / 1000 })
    let last = await env.ctx.sim(requests[0]!)
    for (const request of requests.slice(1)) {
      if (last.type === 'error') break
      last = await env.ctx.sim(request)
    }
    if (last.type === 'error') return failure('SIM_ERROR', last.message)
    if (last.snapshot.error) return failure('SIM_ERROR', last.snapshot.error)
    return reply(simReport(doc, defs, last.snapshot, last.issues))
  }
})

// --- Code ---

const CODE_RULES = new Set(['CODE_PIN_MISMATCH', 'FLOATING_INPUT'])

export const writeCode = defineTool({
  name: 'write_code',
  description:
    'Store the Python program that drives this circuit in the project, as the project’s code. It is checked, never run: the reply has the Python syntax check and a cross-check of the GPIOs the code uses against the wiring (code that uses an unwired GPIO, wired GPIOs it never configures, inputs with no pull). Use BCM numbers, `RPi.GPIO` or `gpiozero`, and a loop that Ctrl+C ends cleanly. Fix syntax errors and mismatches before you say the code is ready.',
  schema: z.object({ library: z.enum(['RPi.GPIO', 'gpiozero']), source: z.string() }).strict(),
  mutates: true,
  async run({ library, source }, env) {
    const diagnostics = await env.ctx.checkPython(source)
    const tx = commit(env, 'Write code', [
      { type: 'SetCode', code: { language: 'python', library, source } }
    ])
    if (isOutput(tx)) return tx
    const doc = env.ctx.getSnapshot()
    const pins = codePins(source)
    const issues = erc(doc, env.ctx.partDef).filter((i) => CODE_RULES.has(i.code))
    return {
      ...reply({
        syntax: diagnostics.length ? diagnostics : 'ok',
        gpioUsed: pins.uses.map((u) => ({
          gpio: u.bcm,
          mode: u.mode,
          ...(u.pull ? { pull: u.pull } : {})
        })),
        unresolved: pins.unresolved,
        crossCheck: issues.length ? issueRows(issues) : 'matches the wiring'
      }),
      committed: [tx]
    }
  }
})

const MAX_EVENTS = 200

export const runCodeInSim = defineTool({
  name: 'run_code_in_sim',
  description:
    'Run the project’s code for `seconds` of virtual time in the simulator, never on hardware, and return what it printed and every pin event it caused (time, GPIO, high/low/pwm). Use it to confirm the program does what was asked, for example that an LED blinks at the right rate.',
  schema: z.object({ seconds: z.number().describe('Virtual seconds to run, up to 60.') }).strict(),
  async run({ seconds }, env) {
    if (!(seconds > 0 && seconds <= 60))
      return failure('BAD_DURATION', 'seconds must be above 0 and at most 60')
    const run = await env.ctx.runCodeInSim(env.ctx.getSnapshot(), seconds, env.signal)
    return {
      ...reply({
        stdout: run.stdout,
        ...(run.stderr ? { stderr: run.stderr } : {}),
        error: run.error,
        events: run.events
          .slice(0, MAX_EVENTS)
          .map((e) => `${e.t.toFixed(3)} GPIO${e.bcm} ${e.event}`),
        eventCount: run.events.length,
        ...(run.truncated || run.events.length > MAX_EVENTS ? { truncated: true } : {})
      }),
      isError: run.error !== null
    }
  }
})

// --- Board Sense ---

export const readBoardSense = defineTool({
  name: 'read_board_sense',
  description:
    'Read what the user’s real board is doing, as Board Sense last measured it: per GPIO net matched, diverged (with the kind and detail), ambiguous, skipped or unobserved; the recent events; and ranked candidate causes for each divergence, each mapped to holes. Read-only: you can not start, stop or configure sensing, and sensing may be off. Call it first when the user is debugging real hardware, reason from the measured divergences, and say plainly what the Pi can not observe (LED paths, nets behind more than about 10 kΩ).',
  schema: z.object({}).strict(),
  strict: false,
  run(_, env) {
    const sense = env.ctx.boardSense()
    return reply({
      sensingOn: sense.on,
      ...(sense.on ? {} : { note: 'Board Sense is off; nothing below is a live measurement.' }),
      nets: sense.states.map(([bcm, s]) => ({ gpio: `GPIO${bcm}`, ...s })),
      events: sense.events.map((e) => e.text),
      candidates: Object.fromEntries(
        Object.entries(sense.candidates).map(([bcm, ranked]) => [
          `GPIO${bcm}`,
          ranked.slice(0, 3).map((r) => ({
            score: `${r.score}/${r.of}`,
            ...(r.candidates.length > 1 ? { tie: true } : {}),
            causes: r.candidates.map((c) => ({ text: c.text, holes: c.holes.map(holeKey) }))
          }))
        ])
      )
    })
  }
})

export const analysisTools = [runErc, simulate, writeCode, runCodeInSim, readBoardSense]
