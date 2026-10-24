// npm run assets:check [-- --rebuild] [--allow-version-drift]
//
// Verifies the committed models (SPEC 10.3; SPEC 20 item 14): each GLB against its manifest, its
// budgets and the content file it was built from; the folder's total size; and the shipped HDRI
// against its pin. --rebuild also builds every asset into a temporary folder and compares it with
// the committed one: geometry hashes exactly, baked textures by SSIM.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ASSETS, MODELS_BUDGET_BYTES, MODELS_DIR, ROOT } from './assets'
import { build } from './build'
import { geometryHash, readGlb } from './glb'
import { ktxOnPath } from './optimize'
import { SOURCES, sha256 } from './sources'
import { verifyAsset } from './verify'

/** GPU and CPU bakes are not bit-exact, so baked textures match by similarity (SPEC 10.3). */
const SSIM_MIN = 0.99

interface Image {
  width: number
  height: number
  rgba: Uint8Array
}

/** A KTX2 texture's top level, transcoded to RGBA8 by KTX-Software. */
function decode(ktx2: Uint8Array, scratch: string): Image {
  const view = new DataView(ktx2.buffer, ktx2.byteOffset, ktx2.byteLength)
  const file = join(scratch, 'texture.ktx2')
  writeFileSync(file, ktx2)
  execFileSync('ktx', ['extract', '--transcode', 'rgba8', '--raw', file, `${file}.raw`])
  return {
    width: view.getUint32(20, true),
    height: view.getUint32(24, true),
    rgba: readFileSync(`${file}.raw`)
  }
}

/** Mean SSIM over 8 x 8 windows at a stride of 4, for the least similar of R, G and B. */
function ssim(a: Image, b: Image): number {
  if (a.width !== b.width || a.height !== b.height) return 0
  const c1 = (0.01 * 255) ** 2
  const c2 = (0.03 * 255) ** 2
  let least = 1
  for (let ch = 0; ch < 3; ch++) {
    let sum = 0
    let windows = 0
    for (let y = 0; y + 8 <= a.height; y += 4) {
      for (let x = 0; x + 8 <= a.width; x += 4) {
        let sa = 0,
          sb = 0,
          saa = 0,
          sbb = 0,
          sab = 0
        for (let j = 0; j < 8; j++) {
          for (let i = 0; i < 8; i++) {
            const k = ((y + j) * a.width + x + i) * 4 + ch
            const va = a.rgba[k]!
            const vb = b.rgba[k]!
            sa += va
            sb += vb
            saa += va * va
            sbb += vb * vb
            sab += va * vb
          }
        }
        const ma = sa / 64
        const mb = sb / 64
        const cov = sab / 64 - ma * mb
        sum +=
          ((2 * ma * mb + c1) * (2 * cov + c2)) /
          ((ma * ma + mb * mb + c1) * (saa / 64 - ma * ma + sbb / 64 - mb * mb + c2))
        windows++
      }
    }
    least = Math.min(least, sum / windows)
  }
  return least
}

let failed = false
const report = (ok: boolean, line: string) => {
  failed ||= !ok
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`)
}

for (const s of SOURCES.filter((s) => s.shipped)) {
  const ok = sha256(readFileSync(join(ROOT, s.shipped!))) === s.sha256
  report(ok, `${s.shipped}: SHA-256 matches sources.json ${s.id}`)
}

for (const asset of ASSETS) {
  for (const f of await verifyAsset(asset)) report(f.ok, `${asset.name} ${f.check}: ${f.detail}`)
}

const models = join(ROOT, MODELS_DIR)
const total = readdirSync(models).reduce((n, f) => n + statSync(join(models, f)).size, 0)
report(
  total <= MODELS_BUDGET_BYTES,
  `${MODELS_DIR}: ${total} bytes in all (max ${MODELS_BUDGET_BYTES})`
)

if (process.argv.includes('--rebuild')) {
  ktxOnPath()
  const out = mkdtempSync(join(tmpdir(), 'assets-rebuild-'))
  try {
    for (const asset of ASSETS) {
      await build(asset, out, process.argv.includes('--allow-version-drift'))
      const was = await readGlb(join(models, `${asset.name}.glb`))
      const now = await readGlb(join(out, `${asset.name}.glb`))
      const hash = geometryHash(now)
      report(
        geometryHash(was) === hash,
        `${asset.name} rebuild: geometry hash ${hash.slice(0, 16)} matches exactly`
      )
      for (const texture of was.getRoot().listTextures()) {
        const rebuilt = now
          .getRoot()
          .listTextures()
          .find((t) => t.getName() === texture.getName())
        const s = rebuilt
          ? ssim(decode(texture.getImage()!, out), decode(rebuilt.getImage()!, out))
          : 0
        report(
          s >= SSIM_MIN,
          `${asset.name} rebuild: ${texture.getName()} SSIM ${s.toFixed(4)} (min ${SSIM_MIN})`
        )
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

console.log(failed ? 'assets:check FAILED' : 'assets:check passed')
process.exit(failed ? 1 : 0)
