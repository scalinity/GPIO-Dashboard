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

  const driven = t.meta.assertions.filter((a) => a.code)

  it('has assertions its code must drive', () => {
    expect(driven.length).toBeGreaterThan(0)
  })

  // A check runs up to 75 s of virtual time (the PIR's one-minute warm-up comes first) and stops
  // at the first moment its expectations hold.
  it.each(driven.map((a) => [a.name, a] as const))(
    'drives: %s',
    (_name, a) => {
      expect(checkCode(py, t.doc, partDef, a, 75).failures).toEqual([])
    },
    300_000
  )
})
