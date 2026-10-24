// The checks assets:check and the Vitest guard run on a committed model (SPEC 4.5, 10.3, 10.8;
// SPEC 20 item 14). Every position is measured from the GLB's own geometry and compared with what
// the app computes from the same content file.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardDef } from '../../src/renderer/src/core/defs/boards'
import { boardHoles, holePosition } from '../../src/renderer/src/core/geometry/breadboard'
import { type Asset, type Manifest, MODELS_DIR, ROOT } from './assets'
import {
  bounds,
  centre,
  coincidence,
  geometryHash,
  islands,
  readGlb,
  textures,
  triangleCount,
  type Box,
  type Vec2
} from './glb'

/** Modelled holes must sit within this distance of their logical positions. */
export const COINCIDENCE_MM = 0.05
/** Materials pi5.py names: the PCB's solder mask, and the black plastic of the header base. */
export const PI_PCB_MATERIAL = 'solder-mask'
export const PI_HEADER_MATERIAL = 'step-040404'

export interface Finding {
  check: string
  ok: boolean
  detail: string
}

interface PiBoard {
  outline: { widthMm: number; depthMm: number }
  mountingHoles: { diameterMm: number; centers: Vec2[] }
  header: { centerMm: Vec2; pitchMm: number }
}

const mm = (n: number) => `${n.toFixed(3)} mm`
const size = (b: Box) => [b.max[0] - b.min[0], b.max[1] - b.min[1]]

function holes(expected: Vec2[], measured: Vec2[], what: string): Finding {
  const c = coincidence(expected, measured)
  return {
    check: 'holes',
    ok: c.matched === c.expected && c.measured === c.expected && c.worst <= COINCIDENCE_MM,
    detail: `${c.matched}/${c.expected} ${what} matched one to one (${c.measured} measured), worst ${mm(c.worst)} (tolerance ${mm(COINCIDENCE_MM)})`
  }
}

export async function verifyAsset(asset: Asset, dir = join(ROOT, MODELS_DIR)): Promise<Finding[]> {
  const path = join(dir, `${asset.name}.glb`)
  const manifest: Manifest = JSON.parse(
    readFileSync(join(dir, `${asset.name}.manifest.json`), 'utf8')
  )
  const data = JSON.parse(readFileSync(join(ROOT, asset.inputs[0]!), 'utf8'))
  const doc = await readGlb(path)
  const bytes = statSync(path).size
  const triangles = triangleCount(doc)
  const { budget } = asset
  const tex = textures(doc)
  const used = doc
    .getRoot()
    .listExtensionsUsed()
    .map((e) => e.extensionName)

  const findings: Finding[] = [
    {
      check: 'geometry hash',
      ok: geometryHash(doc) === manifest.geometryHash,
      detail: `matches ${asset.name}.manifest.json`
    },
    {
      check: 'budget',
      ok:
        triangles === manifest.triangles &&
        triangles <= (budget.triangles ?? Infinity) &&
        bytes <= (budget.bytes ?? Infinity),
      detail: `${triangles} triangles${budget.triangles ? ` (max ${budget.triangles})` : ''}, ${bytes} bytes${budget.bytes ? ` (max ${budget.bytes})` : ''}`
    },
    {
      check: 'textures',
      ok:
        used.includes('EXT_meshopt_compression') &&
        (tex.length === 0 || used.includes('KHR_texture_basisu')) &&
        tex.every(
          (t) =>
            t.mimeType === 'image/ktx2' &&
            t.size[0] <= budget.texturePx[0] &&
            t.size[1] <= budget.texturePx[1]
        ),
      detail: tex.map((t) => `${t.name} ${t.format} ${t.size.join('x')}`).join(', ')
    }
  ]

  if (asset.kind === 'breadboard') {
    const def = data as BoardDef
    const { lengthMm: L, widthMm: W, heightMm: H } = def.body
    const b = bounds(doc)
    const off = Math.max(
      ...[b.min[0], b.min[1], b.min[2] + H, b.max[0] - L, b.max[1] - W, b.max[2]].map(Math.abs)
    )
    findings.push({
      check: 'dimensions',
      ok: off <= COINCIDENCE_MM,
      detail: `body ${L} x ${W} x ${H} mm from the core origin, worst ${mm(off)}`
    })
    // Each hole ends in a nickel contact; the centre of each contact's piece is the hole's centre.
    const expected = boardHoles(def, asset.name).map((h) => holePosition(def, h) as Vec2)
    findings.push(holes(expected, islands(doc, 'nickel').map(centre), 'holes (nickel contacts)'))
  } else {
    const pi = data as PiBoard
    const pcb = bounds(doc, PI_PCB_MATERIAL)
    const off = Math.max(
      ...[
        pcb.min[0],
        pcb.min[1],
        pcb.max[0] - pi.outline.widthMm,
        pcb.max[1] - pi.outline.depthMm,
        bounds(doc).min[2]
      ].map(Math.abs)
    )
    findings.push({
      check: 'dimensions',
      ok: off <= COINCIDENCE_MM,
      detail: `PCB ${pi.outline.widthMm} x ${pi.outline.depthMm} mm at the origin, lowest point on z = 0, worst ${mm(off)}`
    })
    // Mounting holes: the pieces of the PCB's vertical walls that are as wide as the drilled hole.
    const d = pi.mountingHoles.diameterMm
    const drilled = islands(doc, PI_PCB_MATERIAL, true).filter((b) =>
      size(b).every((s) => Math.abs(s - d) <= 0.1)
    )
    findings.push(holes(pi.mountingHoles.centers, drilled.map(centre), 'mounting holes'))
    // The header's base: the black piece 20 x 2 pitches across, centred on the header.
    const want = [20 * pi.header.pitchMm, 2 * pi.header.pitchMm]
    const base = islands(doc, PI_HEADER_MATERIAL).find((b) =>
      size(b).every((s, i) => Math.abs(s - want[i]!) <= COINCIDENCE_MM)
    )
    const dist = base
      ? Math.hypot(...centre(base).map((v, i) => v - pi.header.centerMm[i]!))
      : Infinity
    // The studio places the pins relative to the "header" node.
    const node = doc
      .getRoot()
      .listNodes()
      .some((n) => n.getName() === 'header')
    findings.push({
      check: 'header',
      ok: dist <= COINCIDENCE_MM && node,
      detail:
        (base
          ? `base ${size(base).map(mm).join(' x ')} centred ${mm(dist)} from header.centerMm`
          : `no ${want.join(' x ')} mm header base in ${PI_HEADER_MATERIAL}`) +
        `; "header" node ${node ? 'present' : 'missing'}`
    })
  }
  return findings
}
