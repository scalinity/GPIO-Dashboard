// Every tutorial's own code drives its circuit the way its assertions require (SPEC 13.1, M5 exit).
import type { PyodideInterface } from 'pyodide'
import { beforeAll, describe, expect, it } from 'vitest'
import { partDef } from '../core/defs/parts'
import { TUTORIALS } from '../core/defs/tutorials'
import { checkCode } from './codeCheck'
import { compileCheck, createPython } from './python'

let py: PyodideInterface
beforeAll(async () => {
  py = await createPython({ stdout: () => {}, stderr: () => {} })
}, 30_000)

describe.each(TUTORIALS.map((t) => [t.meta.id, t] as const))('%s code', (_id, t) => {
  it('compiles', () => {
    expect(compileCheck(py, t.doc.code.source)).toEqual([])
  })

  it.each(t.meta.assertions.map((a) => [a.name, a] as const))('drives: %s', (_name, a) => {
    expect(checkCode(py, t.doc, partDef, a, 10).failures).toEqual([])
  })
})
