// npm run assets:build [-- <asset>...] [--allow-version-drift]
//
// Rebuilds the shipped models headlessly (SPEC 10.3): pinned sources, then a STEP read through
// occt-import-js where the model starts from one, then the asset's Blender script, then
// gltf-transform. Writes <name>.glb, <name>.manifest.json and <name>.colliders.json.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Asset, ASSETS, BAKE, type Manifest, MODELS_DIR, ROOT, asset as named } from './assets'
import { geometryHash, glbIO, textures, triangleCount } from './glb'
import { ktxOnPath, optimize } from './optimize'
import { ASSETS_DIR, extractSource, sha256, source } from './sources'
import { stepToGlb } from './step-to-glb'

const BLENDER_DIR = join(ASSETS_DIR, 'blender')

function tools() {
  const blender = process.env.BLENDER_BIN
  if (!blender) throw new Error('Set BLENDER_BIN to the Blender 5.2 LTS executable')
  ktxOnPath()
  const version = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { encoding: 'utf8' }).split('\n')[0]!.trim()
  return {
    blender,
    versions: { blender: version(blender, ['--version']), ktx: version('ktx', ['--version']) }
  }
}

const fileHash = (path: string) => sha256(readFileSync(path))

/** Builds one asset into outDir; throws, writing nothing, if a budget is missed. */
export async function build(
  asset: Asset,
  outDir: string,
  allowVersionDrift = false
): Promise<Manifest> {
  const { blender, versions } = tools()
  const work = mkdtempSync(join(tmpdir(), `asset-${asset.name}-`))
  try {
    const args = {
      ...asset.args,
      texture: asset.budget.texturePx.join('x'),
      samples: BAKE.samples,
      seed: BAKE.seed
    }
    const cli = Object.entries(args).flatMap(([k, v]) => [`--${k}`, String(v)])
    let step: Manifest['step']
    let license: string | undefined
    if (asset.step) {
      const text = await extractSource(asset.step.source, asset.step.file)
      const stepGlb = join(work, 'step.glb')
      const read = await stepToGlb(text.toString('latin1'), stepGlb, asset.step.params)
      step = { file: asset.step.file, sha256: sha256(text), params: asset.step.params, ...read }
      license = (await extractSource(asset.step.source, asset.step.license)).toString('utf8')
      cli.push('--step-glb', stepGlb)
    }

    const script = join(BLENDER_DIR, asset.script)
    const blended = join(work, 'blender.glb')
    const colliders = join(work, 'colliders.json')
    const run = spawnSync(
      blender,
      [
        '-b',
        '--factory-startup',
        '--python-exit-code',
        '1',
        '-P',
        script,
        '--',
        '--out',
        blended,
        '--colliders',
        colliders,
        ...cli,
        ...(allowVersionDrift ? ['--allow-version-drift'] : [])
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }
    )
    if (run.status !== 0) {
      throw new Error(
        `${asset.name}: Blender failed\n${(run.stdout + run.stderr).split('\n').slice(-40).join('\n')}`
      )
    }

    const io = await glbIO()
    const doc = await io.read(blended)
    await optimize(doc, asset.budget.texturePx)
    if (license) {
      const notice = /^Copyright .*$/m.exec(license)?.[0] ?? license
      doc.getRoot().getAsset().copyright = `${notice}. MIT License; see ${asset.name}.manifest.json`
    }
    const glb = join(work, `${asset.name}.glb`)
    await io.write(glb, doc)

    // Measure what was written, as assets:check will.
    const written = await io.read(glb)
    const triangles = triangleCount(written)
    const bytes = statSync(glb).size
    const tex = textures(written)
    const met =
      triangles <= (asset.budget.triangles ?? Infinity) &&
      bytes <= (asset.budget.bytes ?? Infinity) &&
      tex.every(
        (t) =>
          t.mimeType === 'image/ktx2' && t.size.every((s, i) => s <= asset.budget.texturePx[i]!)
      )
    if (!met) {
      throw new Error(
        `${asset.name}: over budget: ${triangles} triangles, ${bytes} bytes, textures ${JSON.stringify(tex)}`
      )
    }

    const libs = readdirSync(join(BLENDER_DIR, 'lib'))
      .filter((f) => f.endsWith('.py'))
      .sort()
    const manifest: Manifest = {
      name: asset.name,
      tools: versions,
      script: {
        path: `scripts/assets/blender/${asset.script}`,
        args,
        sha256: Object.fromEntries(
          [asset.script, ...libs.map((f) => `lib/${f}`)].map((f) => [
            `blender/${f}`,
            fileHash(join(BLENDER_DIR, f))
          ])
        )
      },
      inputs: asset.inputs.map((path) => ({ path, sha256: fileHash(join(ROOT, path)) })),
      sources: (asset.step ? [source(asset.step.source)] : []).map((s) => ({
        id: s.id,
        url: s.url,
        sha256: s.sha256,
        license: s.license,
        files: s.extract?.map((e) => e.path) ?? []
      })),
      ...(step && { step }),
      ...(license && { license }),
      triangles,
      bytes,
      textures: tex.map(({ name, format, size, slots }) => ({ name, format, size, slots })),
      budget: { ...asset.budget, met },
      geometryHash: geometryHash(written)
    }

    copyFileSync(glb, join(outDir, `${asset.name}.glb`))
    copyFileSync(colliders, join(outDir, `${asset.name}.colliders.json`))
    writeFileSync(
      join(outDir, `${asset.name}.manifest.json`),
      `${JSON.stringify(manifest, null, 2)}\n`
    )
    return manifest
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  const names = argv.filter((a) => !a.startsWith('--'))
  for (const a of names.length ? names.map(named) : ASSETS) {
    const started = Date.now()
    const m = await build(a, join(ROOT, MODELS_DIR), argv.includes('--allow-version-drift'))
    const tex = m.textures.map((t) => `${t.format} ${t.size.join('x')}`).join(', ')
    console.log(
      `${m.name}: ${m.triangles} triangles, ${(m.bytes / 1e6).toFixed(2)} MB, textures ${tex || 'none'}, ` +
        `geometry ${m.geometryHash.slice(0, 12)} (${((Date.now() - started) / 1000).toFixed(0)} s)`
    )
  }
}
