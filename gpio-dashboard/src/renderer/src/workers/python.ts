// Pyodide with the simulator's shims (SPEC 13.2): RPi.GPIO, gpiozero, smbus and smbus2 from
// workers/python/, bound to a Bridge as the `_sim` module. Used by pyodide.worker and by tests.
import { loadPyodide, type PyodideInterface } from 'pyodide'
import { PI_HEADER } from '../core/defs/controllers'
import type { Bridge, Edge } from './bridge'

const SHIMS = import.meta.glob<string>('./python/**/*.py', {
  eager: true,
  query: '?raw',
  import: 'default'
})
const ROOT = '/home/pyodide/sim'
/** Modules a run imports fresh, so one run's state never leaks into the next. */
const FRESH = ['_sim', '_prelude', 'RPi', 'RPi.GPIO', 'gpiozero', 'smbus', 'smbus2']

export interface Diagnostic {
  line: number
  column: number
  message: string
}

export async function createPython(options: {
  indexURL?: string
  stdout?: (text: string) => void
  stderr?: (text: string) => void
}): Promise<PyodideInterface> {
  const py = await loadPyodide({
    indexURL: options.indexURL,
    stdout: options.stdout,
    stderr: options.stderr
  })
  for (const [file, text] of Object.entries(SHIMS)) {
    const path = `${ROOT}/${file.replace('./python/', '')}`
    py.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')))
    py.FS.writeFile(path, text)
  }
  py.runPython(`import sys\nsys.path.insert(0, ${JSON.stringify(ROOT)})`)
  // No keyboard: input() reaches end of file and raises EOFError instead of waiting forever.
  py.setStdin({ stdin: () => undefined })
  return py
}

/** Syntax errors in a program, without running it. */
export function compileCheck(py: PyodideInterface, source: string): Diagnostic[] {
  const check = py.runPython(`
def _check(source):
    try:
        compile(source, "main.py", "exec")
        return None
    except SyntaxError as e:
        return [e.lineno or 0, e.offset or 0, e.msg]
_check`)
  const result = check(source)
  check.destroy()
  if (!result) return []
  const [line, column, message] = result.toJs() as [number, number, string]
  result.destroy()
  return [{ line, column, message }]
}

/**
 * Runs a program against the bridge. `sleep` is how time.sleep waits (the worker also waits in
 * real time); the run ends when the program does, or with KeyboardInterrupt once `interrupt` is
 * set, as Ctrl+C would end it on the Pi.
 */
export function runProgram(
  py: PyodideInterface,
  bridge: Bridge,
  source: string,
  sleep: (s: number) => void,
  interrupt: Int32Array,
  /** What input() reads, line by line, before end of file. */
  stdin = ''
) {
  py.setInterruptBuffer(interrupt)
  const lines = stdin ? stdin.split(/(?<=\n)/) : []
  py.setStdin({ stdin: () => lines.shift() })
  py.registerJsModule('_sim', {
    // JS null reaches Python as JsNull; undefined becomes None.
    board_to_bcm: (pin: number) => PI_HEADER[pin - 1]?.bcm ?? undefined,
    setup: (bcm: number, mode: 'in' | 'out', pull: 'up' | 'down' | 'off', initial: boolean) =>
      bridge.setup(bcm, mode, pull, initial),
    output: (bcm: number, level: boolean) => bridge.output(bcm, level),
    input: (bcm: number) => bridge.input(bcm),
    pwm: (bcm: number, hz: number, duty: number) => bridge.pwm(bcm, hz, duty),
    pwm_stop: (bcm: number) => bridge.pwmStop(bcm),
    cleanup: (bcm: number | null | undefined) => bridge.cleanup(bcm ?? undefined),
    watch: (bcm: number, edge: Edge, callback: ((b: number) => void) | null) =>
      bridge.watch(bcm, edge, callback),
    unwatch: (bcm: number) => bridge.unwatch(bcm),
    event_detected: (bcm: number) => bridge.eventDetected(bcm),
    wait_for_edge: (bcm: number, edge: Edge, timeout: number | null | undefined) =>
      bridge.waitForEdge(bcm, edge, timeout ?? null, sleep),
    sleep,
    now: () => bridge.now(),
    i2c_write: (address: number, bytes: { toJs(): number[]; destroy(): void } | number[]) => {
      const list = Array.isArray(bytes) ? bytes : bytes.toJs()
      if (!Array.isArray(bytes)) bytes.destroy()
      return bridge.i2cWrite(address, list)
    },
    i2c_read: (address: number, count: number) => bridge.i2cRead(address, count) ?? undefined
  })
  py.runPython(`
import sys
for name in ${JSON.stringify(FRESH)}:
    sys.modules.pop(name, None)
import _prelude`)
  const globals = py.toPy({ __name__: '__main__' })
  try {
    py.runPython(source, { globals, filename: 'main.py' })
  } finally {
    globals.destroy()
    // A stop requested as the program was ending would otherwise interrupt the next call.
    interrupt[0] = 0
    py.setStdin({ stdin: () => undefined })
  }
}
