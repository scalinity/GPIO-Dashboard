// KTX2Loader runs the Basis transcoder from public/basis/; it must be the copy the installed three
// ships, or textures transcode with a mismatched loader after an upgrade.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Basis transcoder', () => {
  it.each(['basis_transcoder.js', 'basis_transcoder.wasm'])(
    'public/basis/%s matches three',
    (f) => {
      const shipped = readFileSync(resolve('src/renderer/public/basis', f))
      const installed = readFileSync(resolve('node_modules/three/examples/jsm/libs/basis', f))
      expect(shipped.equals(installed)).toBe(true)
    }
  )
})
