// Does a tutorial's code drive its circuit the way its assertions require (SPEC 13.1, M5)? For each
// assertion, run the program with the assertion's part inputs held, sample the circuit at every
// sleep, and pass when every expectation holds at some sample. The assertion's own GPIO settings
// are what the program must produce, so they are not applied; I2C reads are left to the program.
import type { PyodideInterface } from 'pyodide'
import type { CircuitDoc } from '../core/model/types'
import type { PartDefs } from '../core/netlist/netlist'
import { BEHAVIORS } from '../core/sim/behaviors'
import { Circuit } from '../core/sim/circuit'
import { SimSession } from '../core/sim/session'
import { expectationFailures } from '../core/tutorials/assert'
import type { Assertion } from '../core/tutorials/tutorial'
import { Bridge } from './bridge'
import { runProgram } from './python'

export interface CodeCheck {
  ok: boolean
  /** The failures at the sample closest to passing, or the error that ended the program. */
  failures: string[]
}

export function checkCode(
  py: PyodideInterface,
  doc: CircuitDoc,
  defs: PartDefs,
  assertion: Assertion,
  seconds: number
): CodeCheck {
  const session = new SimSession(new Circuit(doc, defs, BEHAVIORS))
  for (const step of [assertion, ...assertion.sequence]) {
    for (const [part, values] of Object.entries(step.inputs)) {
      for (const [key, value] of Object.entries(values)) session.setInput(part, key, value)
    }
  }
  const expect = assertion.expect.filter((e) => !('i2cRead' in e))
  const bridge = new Bridge(session)
  const interrupt = new Int32Array(new SharedArrayBuffer(4))
  let best: string[] | null = null
  const sample = () => {
    if (best?.length === 0) return
    const failures = expectationFailures(session, expect)
    if (!best || failures.length < best.length) best = failures
    if (failures.length === 0) interrupt[0] = 2
  }
  const sleep = (s: number) => {
    bridge.sleep(s)
    sample()
    if (bridge.now() >= seconds) interrupt[0] = 2
  }
  try {
    runProgram(py, bridge, doc.code.source, sleep, interrupt)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Ctrl+C that the program did not catch is how a passing or timed-out run ends.
    if (!/KeyboardInterrupt/.test(message)) return { ok: false, failures: [message] }
  }
  sample()
  return {
    ok: (best as string[] | null)?.length === 0,
    failures: best ?? ['the program never slept']
  }
}
