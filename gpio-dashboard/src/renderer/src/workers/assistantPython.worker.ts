// The assistant's Python (SPEC 12.5 write_code, run_code_in_sim): its own Pyodide, apart from the
// Code panel's, so a check or a run the assistant asks for never waits on, or shows up in, the
// program the user is simulating.
import type { PyodideInterface } from 'pyodide'
import { type AssistantPyRequest, type AssistantPyResponse, Output, runFor } from './assistantRun'
import { compileCheck, createPython } from './python'

const output = new Output()
let python: Promise<PyodideInterface> | null = null
const pyodide = () =>
  (python ??= createPython({
    indexURL: '/pyodide/',
    stdout: (text) => output.write('stdout', text),
    stderr: (text) => output.write('stderr', text)
  }))

const post = (res: AssistantPyResponse) => self.postMessage(res)

self.onmessage = async (e: MessageEvent<AssistantPyRequest>) => {
  const req = e.data
  let py: PyodideInterface
  try {
    py = await pyodide()
  } catch (err) {
    const message = `Python could not start: ${err instanceof Error ? err.message : String(err)}`
    post(
      req.type === 'check'
        ? { type: 'diagnostics', id: req.id, diagnostics: [{ line: 0, column: 0, message }] }
        : {
            type: 'run',
            id: req.id,
            stdout: '',
            stderr: '',
            error: message,
            events: [],
            truncated: false
          }
    )
    return
  }
  if (req.type === 'check')
    post({ type: 'diagnostics', id: req.id, diagnostics: compileCheck(py, req.source) })
  else
    post({
      type: 'run',
      id: req.id,
      ...runFor(py, output, req.doc, req.seconds, new Int32Array(req.control))
    })
}
