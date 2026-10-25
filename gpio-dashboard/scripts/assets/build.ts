// npm run assets:build [-- <asset>...] [--allow-version-drift]
//
// Rebuilds the shipped models headlessly (SPEC 10.3): pinned sources, then a STEP read through
// occt-import-js where the model starts from one, then the asset's Blender script, then
// gltf-transform. Writes <name>.glb, <name>.manifest.json and <name>.colliders.json (the part
// models go in parts/, and are listed in parts/index.json). "parts" names every part model.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Asset, BAKE, type Manifest, MODELS_DIR, ROOT, assetDir, select } from './assets'
import { encodeKtx2, ktx2Texture } from './controllers'
import { geometryHash, glbIO, textures, triangleCount } from './glb'
import { ktxOnPath, optimize } from './optimize'
import { addToIndex } from './parts'
import { ASSETS_DIR, extractSource, fetchSource, sha256, source } from './sources'
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

/** What a manifest records about how the asset was built: tools, script, inputs and sources. */
function provenance(asset: Asset, versions: Manifest['tools'], args: Manifest['script']['args']) {
  const libs = readdirSync(join(BLENDER_DIR, 'lib'))
    .filter((f) => f.endsWith('.py'))
    .sort()
  return {
    name: asset.name,
    tools: versions,
    script: {
      path: `scripts/assets/blender/${asset.script}`,
      args,
      sha256: Object.fromEntries(
        [asset.script, ...(asset.support ?? []), ...libs.map((f) => `lib/${f}`)].map((f) => [
          `blender/${f}`,
          fileHash(join(BLENDER_DIR, f))
        ])
      )
    },
    inputs: asset.inputs.map((path) => ({ path, sha256: fileHash(join(ROOT, path)) })),
    sources: (asset.step
      ? [
          source(asset.step.source),
          ...(asset.step.licenseSource ? [source(asset.step.licenseSource)] : [])
        ]
      : []
    ).map((s) => ({
      id: s.id,
      url: s.url,
      sha256: s.sha256,
      license: s.license,
      files: s.extract?.map((e) => e.path) ?? []
    }))
  }
}

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
      // A STEP inside a pinned archive, or the pinned source itself.
      const { file } = asset.step
      const text = file
        ? await extractSource(asset.step.source, file)
        : readFileSync(await fetchSource(asset.step.source))
      const stepGlb = join(work, 'step.glb')
      const read = await stepToGlb(text.toString('latin1'), stepGlb, asset.step.params)
      step = {
        file: file ?? source(asset.step.source).url.split('/').at(-1)!,
        sha256: sha256(text),
        params: asset.step.params,
        ...read
      }
      license = (
        asset.step.licenseSource
          ? readFileSync(await fetchSource(asset.step.licenseSource))
          : await extractSource(asset.step.source, asset.step.license!)
      ).toString('utf8')
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

    if (asset.ktx2) {
      // Textures only: the script saved PNGs beside its output; encode them to KTX2.
      const written = asset.ktx2.map((t) => {
        const file = join(work, t.file)
        encodeKtx2(t, `${blended.slice(0, -'.glb'.length)}-${t.png}.png`, file)
        return { file, ...ktx2Texture(t, readFileSync(file)) }
      })
      const bytes = written.reduce((n, w) => n + statSync(w.file).size, 0)
      const met =
        bytes <= (asset.budget.bytes ?? Infinity) &&
        written.every((w) => w.size.every((s, i) => s <= asset.budget.texturePx[i]!))
      if (!met)
        throw new Error(`${asset.name}: over budget: ${bytes} bytes, ${JSON.stringify(written)}`)
      const manifest: Manifest = {
        ...provenance(asset, versions, args),
        triangles: 0,
        bytes,
        textures: written.map(({ name, format, size, slots }) => ({ name, format, size, slots })),
        budget: { ...asset.budget, met }
      }
      for (const w of written) copyFileSync(w.file, join(outDir, w.name))
      writeFileSync(
        join(outDir, `${asset.name}.manifest.json`),
        `${JSON.stringify(manifest, null, 2)}\n`
      )
      return manifest
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

    const manifest: Manifest = {
      ...provenance(asset, versions, args),
      ...(step && { step }),
      ...(license && { license }),
      triangles,
      bytes,
      textures: tex.map(({ name, format, size, slots }) => ({ name, format, size, slots })),
      budget: { ...asset.budget, met },
      geometryHash: geometryHash(written)
    }

    const dest = assetDir(asset, outDir)
    mkdirSync(dest, { recursive: true })
    copyFileSync(glb, join(dest, `${asset.name}.glb`))
    copyFileSync(colliders, join(dest, `${asset.name}.colliders.json`))
    writeFileSync(
      join(dest, `${asset.name}.manifest.json`),
      `${JSON.stringify(manifest, null, 2)}\n`
    )
    if (asset.part) addToIndex(dest, asset)
    return manifest
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  const names = argv.filter((a) => !a.startsWith('--'))
  for (const a of select(names)) {
    const started = Date.now()
    const m = await build(a, join(ROOT, MODELS_DIR), argv.includes('--allow-version-drift'))
    const tex = m.textures.map((t) => `${t.format} ${t.size.join('x')}`).join(', ')
    console.log(
      `${m.name}: ${m.triangles} triangles, ${(m.bytes / 1e6).toFixed(2)} MB, textures ${tex || 'none'}, ` +
        `geometry ${m.geometryHash?.slice(0, 12) ?? 'none'} (${((Date.now() - started) / 1000).toFixed(0)} s)`
    )
  }
}
