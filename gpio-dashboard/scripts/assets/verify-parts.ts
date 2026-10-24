// The checks assets:check and the Vitest guard run on a committed part model (SPEC 7, 10.3, 10.4,
// 10.8). Pins, body size and colliders are measured from the GLB's own geometry and compared with
// what the part definition's datasheet drawing says (parts.ts).
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { type Asset, type Manifest, MODELS_DIR, ROOT, assetDir } from './assets'
import {
  type Box,
  type Vec3,
  corePositions,
  geometryHash,
  primitives,
  readGlb,
  textures,
  triangleCount
} from './glb'
import {
  LEAD_MATERIAL,
  expectation,
  indexPath,
  partDefinition,
  readIndex,
  formatIndex
} from './parts'
import { COINCIDENCE_MM, type Finding } from './verify'

const PITCH_MM = 2.54
/** A lead's axis may be off its expected direction by this much. */
const AXIS_DEGREES = 1
/** The colliders may fall this far short of the body's extent on any side. */
const COLLIDER_SLACK_MM = 0.05
/** A flex-2lead part's pins sit this high above the board at most (seatMm). */
const SEAT_MAX_MM = 5

const mm = (n: number) => `${n.toFixed(3)} mm`
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

export async function verifyPart(asset: Asset, dir = join(ROOT, MODELS_DIR)): Promise<Finding[]> {
  const folder = assetDir(asset, dir)
  const path = join(folder, `${asset.name}.glb`)
  const manifest: Manifest = JSON.parse(
    readFileSync(join(folder, `${asset.name}.manifest.json`), 'utf8')
  )
  const def = partDefinition(ROOT, asset)
  const want = expectation(asset, def)
  const doc = await readGlb(path)
  const bytes = statSync(path).size
  const triangles = triangleCount(doc)
  const { budget } = asset
  const used = doc
    .getRoot()
    .listExtensionsUsed()
    .map((e) => e.extensionName)
  const nodes = doc.getRoot().listNodes()
  const named = (name: string) => nodes.filter((n) => n.getName() === name)
  const findings: Finding[] = []
  const add = (check: string, ok: boolean, detail: string) => findings.push({ check, ok, detail })

  add('family', def.geometry.family === asset.part!.family, `${def.id} is "${def.geometry.family}"`)
  add(
    'geometry hash',
    geometryHash(doc) === manifest.geometryHash,
    `matches ${asset.name}.manifest.json`
  )
  add(
    'budget',
    triangles === manifest.triangles &&
      triangles <= (budget.triangles ?? Infinity) &&
      bytes <= (budget.bytes ?? Infinity),
    `${triangles} triangles (max ${budget.triangles}), ${bytes} bytes (max ${budget.bytes})`
  )
  // Parts carry no texture unless their budget names one (a marking or a legend: KTX2 within it).
  const tex = textures(doc)
  const budgeted = budget.texturePx[0] > 0
  add(
    'textures',
    used.includes('EXT_meshopt_compression') &&
      (budgeted
        ? (tex.length === 0 || used.includes('KHR_texture_basisu')) &&
          tex.every(
            (t) =>
              t.mimeType === 'image/ktx2' &&
              t.size[0] <= budget.texturePx[0] &&
              t.size[1] <= budget.texturePx[1]
          )
        : tex.length === 0),
    budgeted
      ? `meshopt-compressed; ${tex.map((t) => `${t.name} ${t.format} ${t.size.join('x')}`).join(', ') || 'no textures'}`
      : 'meshopt-compressed, no textures'
  )

  // The root, named for the file, with the part's seat height when two leads carry it.
  const root = named(asset.name)[0]
  const seat = root?.getExtras().seatMm
  const flex = def.footprint.kind === 'flex-2lead'
  const offboard = def.footprint.kind === 'offboard'
  add(
    'root',
    named(asset.name).length === 1 &&
      (flex ? typeof seat === 'number' && seat > 0 && seat <= SEAT_MAX_MM : seat === undefined),
    flex ? `"${asset.name}" with extras.seatMm ${seat}` : `"${asset.name}" with no seatMm`
  )

  // Every pin has its empty, and the studio's animated nodes and value-driven materials exist.
  const missing = [...def.pins.map((p) => `pin-${p.id}`), ...want.nodes].filter(
    (n) => named(n).length !== 1
  )
  const materialUsed = (name: string) =>
    primitives(doc).some(({ prim }) => prim.getMaterial()?.getName() === name)
  const missingMaterials = want.materials.filter((m) => !materialUsed(m))
  add(
    'names',
    !missing.length && !missingMaterials.length,
    missing.length || missingMaterials.length
      ? `missing ${[...missing, ...missingMaterials].join(', ')}`
      : `${def.pins.length} pin empties${want.nodes.length ? `, nodes ${want.nodes.join(', ')}` : ''}${want.materials.length ? `, materials ${want.materials.join(', ')}` : ''}`
  )

  // The LCD's screen: a quad over the character area, with UVs 0 to 1 across it.
  if (want.screen) {
    const node = named('lcd-screen')[0]
    const prim = node?.getMesh()?.listPrimitives()[0]
    const uv = prim?.getAttribute('TEXCOORD_0')
    const lo = [Infinity, Infinity]
    const hi = [-Infinity, -Infinity]
    const e = [0, 0]
    for (let i = 0; i < (uv?.getCount() ?? 0); i++) {
      uv!.getElement(i, e)
      for (const k of [0, 1]) {
        lo[k] = Math.min(lo[k]!, e[k]!)
        hi[k] = Math.max(hi[k]!, e[k]!)
      }
    }
    const p = prim ? corePositions(node!, prim) : new Float64Array(0)
    const span = [0, 1].map((k) => {
      const v = Array.from({ length: p.length / 3 }, (_, i) => p[i * 3 + k]!)
      return Math.max(...v) - Math.min(...v)
    })
    // Seen from above with +y up the page, the image reads upright: its top-left (glTF uv 0, 0)
    // is the corner at the lowest x and highest y.
    const at = (i: number) => [p[i * 3]!, p[i * 3 + 1]!]
    const corner = (xmin: boolean, ymin: boolean) => {
      const xs = Array.from({ length: p.length / 3 }, (_, i) => at(i))
      const x = xmin ? Math.min(...xs.map((q) => q[0]!)) : Math.max(...xs.map((q) => q[0]!))
      const y = ymin ? Math.min(...xs.map((q) => q[1]!)) : Math.max(...xs.map((q) => q[1]!))
      const i = xs.findIndex((q) => Math.abs(q[0]! - x) < 1e-3 && Math.abs(q[1]! - y) < 1e-3)
      uv!.getElement(i, e)
      return [...e]
    }
    const topLeft = uv?.getCount() === 4 ? corner(true, false) : [NaN, NaN]
    const bottomRight = uv?.getCount() === 4 ? corner(false, true) : [NaN, NaN]
    add(
      'lcd-screen',
      uv?.getCount() === 4 &&
        lo.every((v) => Math.abs(v) < 1e-3) &&
        hi.every((v) => Math.abs(v - 1) < 1e-3) &&
        topLeft.every((v) => Math.abs(v) < 1e-3) &&
        bottomRight.every((v) => Math.abs(v - 1) < 1e-3) &&
        span.every((v, k) => Math.abs(v - want.screen![k]!) <= COINCIDENCE_MM),
      `a quad ${span.map((v) => v.toFixed(2)).join(' x ')} mm (the character area is ${want.screen.join(' x ')}), UVs ${lo.join(',')} to ${hi.join(',')}, top-left at uv ${topLeft.map((v) => v.toFixed(2)).join(',')}`
    )
  }

  // Pin positions in the core frame: glTF (x, y, z) is core (x, -z, y).
  const pinNode = (id: string) => named(`pin-${id}`)[0]!
  const core = (id: string): Vec3 => {
    const [x, y, z] = pinNode(id).getWorldTranslation()
    return [x, -z, y]
  }
  if (!missing.length) {
    if (flex) {
      const [a, b] = def.pins.map((p) => core(p.id))
      const spacing = want.spacing!
      const expected: [Vec3, Vec3] = [
        [-spacing / 2, 0, 0],
        [spacing / 2, 0, 0]
      ]
      const off = Math.max(dist(a!, expected[0]), dist(b!, expected[1]))
      add(
        'pins',
        off <= COINCIDENCE_MM,
        `${def.pins[0]!.id} at -x and ${def.pins[1]!.id} at +x, ${mm(dist(a!, b!))} apart (lead spacing ${mm(spacing)}), centred on the origin, worst ${mm(off)} (tolerance ${mm(COINCIDENCE_MM)})`
      )
    } else if (offboard) {
      // An off-board module keeps its connector's layout: each pin is where offsetPitch puts it
      // relative to the first pin (a screw terminal block at its own pitch), seen from above.
      const first = core(def.pins[0]!.id)
      let worst = 0
      let pitch = 0
      for (const p of def.pins) {
        const at = core(p.id)
        const step =
          want.terminalPitch && p.connector === 'female-socket' ? want.terminalPitch / 2 : PITCH_MM
        const ox = p.offsetPitch[0] * step
        const oy = p.offsetPitch[1] * PITCH_MM
        worst = Math.max(worst, Math.hypot(at[0] - first[0] - ox, at[1] - first[1] - oy))
        const next = def.pins.find(
          (q) =>
            q.offsetPitch[1] === p.offsetPitch[1] &&
            q.offsetPitch[0] === p.offsetPitch[0] + 1 &&
            q.connector === p.connector
        )
        if (next && !(want.terminalPitch && p.connector === 'female-socket')) {
          const g = core(next.id)
          pitch = Math.max(pitch, Math.abs(Math.hypot(g[0] - at[0], g[1] - at[1]) - PITCH_MM))
        }
      }
      add(
        'pins',
        worst <= COINCIDENCE_MM,
        `${def.pins.length} pins at offsetPitch from the first, worst ${mm(worst)} (tolerance ${mm(COINCIDENCE_MM)})`
      )
      add(
        'pin pitch',
        pitch <= COINCIDENCE_MM,
        `neighbouring header pins ${mm(PITCH_MM)} apart, worst error ${mm(pitch)} (tolerance ${mm(COINCIDENCE_MM)})`
      )
    } else {
      let worst = 0
      for (const p of def.pins) {
        const at = core(p.id)
        const grid: Vec3 = [p.offsetPitch[0] * PITCH_MM, p.offsetPitch[1] * PITCH_MM, at[2]]
        worst = Math.max(worst, dist(at, grid))
      }
      const lowest = Math.min(...def.pins.map((p) => core(p.id)[2]))
      add(
        'pins',
        worst <= COINCIDENCE_MM && lowest >= -COINCIDENCE_MM,
        `${def.pins.length} pins within ${mm(worst)} of their offsetPitch (tolerance ${mm(COINCIDENCE_MM)}), none below the board`
      )
    }

    // The empty's +z axis (glTF local +y) runs out of the body along the lead.
    let axisOff = 0
    def.pins.forEach((p, i) => {
      const m = pinNode(p.id).getWorldMatrix()
      const axis: Vec3 = [m[4], -m[6], m[5]]
      const out: Vec3 =
        want.axes?.[p.id] ??
        (want.exit === 'down'
          ? [0, 0, -1]
          : want.exit === 'up'
            ? [0, 0, 1]
            : i === 0
              ? [-1, 0, 0]
              : [1, 0, 0])
      const cos = (axis[0] * out[0] + axis[1] * out[1] + axis[2] * out[2]) / Math.hypot(...axis)
      axisOff = Math.max(axisOff, (Math.acos(Math.min(1, cos)) * 180) / Math.PI)
    })
    add(
      'lead axes',
      axisOff <= AXIS_DEGREES,
      `every pin's +z runs ${{ down: 'down', up: 'up', axial: 'out of the body along x' }[want.exit]}${want.axes ? ' (or as listed)' : ''}, worst ${axisOff.toFixed(2)} degrees`
    )
  }

  // The body, without the formed lead stubs (and, for a module, only the nodes that are its body).
  const empty = (): Box => ({
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  })
  const box = empty()
  const all = empty()
  const under = (node: (typeof nodes)[number], names: string[]) => {
    for (let n: typeof node | null = node; n; n = n.getParentNode()) {
      if (names.includes(n.getName())) return true
    }
    return false
  }
  for (const { node, prim } of primitives(doc)) {
    const p = corePositions(node, prim)
    const isBody =
      prim.getMaterial()?.getName() !== LEAD_MATERIAL &&
      (!want.bodyNodes || under(node, want.bodyNodes))
    for (let i = 0; i < p.length; i++) {
      all.min[i % 3] = Math.min(all.min[i % 3]!, p[i]!)
      all.max[i % 3] = Math.max(all.max[i % 3]!, p[i]!)
      if (!isBody) continue
      box.min[i % 3] = Math.min(box.min[i % 3]!, p[i]!)
      box.max[i % 3] = Math.max(box.max[i % 3]!, p[i]!)
    }
  }
  if (offboard) {
    // The module rests on the table with its footprint's lowest corner at the origin.
    const off = Math.max(...all.min.map(Math.abs))
    add(
      'origin',
      off <= COINCIDENCE_MM,
      `the model starts at (${all.min.map((v) => v.toFixed(3)).join(', ')}): the footprint's corner on the table, worst ${mm(off)}`
    )
  }
  const size = box.max.map((v, i) => v - box.min[i]!)
  add(
    'dimensions',
    size.every((s, i) => s >= want.body[i]![0] - 1e-3 && s <= want.body[i]![1] + 1e-3),
    `body ${size.map((s) => s.toFixed(2)).join(' x ')} mm; the drawing allows ${want.body
      .map(([lo, hi]) => `${lo.toFixed(2)}-${hi.toFixed(2)}`)
      .join(' x ')}`
  )

  // The colliders cover the body in the model's own frame.
  const colliderFile = join(folder, `${asset.name}.colliders.json`)
  const colliders: {
    boxes: { min: Vec3; max: Vec3 }[]
    capsules: { a: Vec3; b: Vec3; radius: number }[]
  } | null = existsSync(colliderFile) ? JSON.parse(readFileSync(colliderFile, 'utf8')) : null
  const extents = [
    ...(colliders?.boxes ?? []),
    ...(colliders?.capsules ?? []).map((c) => ({
      min: c.a.map((v, i) => Math.min(v, c.b[i]!) - c.radius) as Vec3,
      max: c.a.map((v, i) => Math.max(v, c.b[i]!) + c.radius) as Vec3
    }))
  ]
  const covered =
    extents.length > 0 &&
    box.min.every(
      (lo, i) => Math.min(...extents.map((e) => e.min[i]!)) <= lo + COLLIDER_SLACK_MM
    ) &&
    box.max.every((hi, i) => Math.max(...extents.map((e) => e.max[i]!)) >= hi - COLLIDER_SLACK_MM)
  add(
    'colliders',
    covered,
    `${colliders?.boxes.length ?? 0} boxes and ${colliders?.capsules.length ?? 0} capsules cover the body`
  )
  return findings
}

/** parts/index.json lists every part file, sorted, with the property value that selects it. */
export function verifyIndex(assets: Asset[], dir = join(ROOT, MODELS_DIR)): Finding[] {
  const folder = join(dir, 'parts')
  const index = readIndex(folder)
  const parts = assets.filter((a) => a.part)
  const wrong = parts.filter((a) => {
    const entry = index[a.part!.defId]?.find((e) => e.file === `${a.name}.glb`)
    return !entry || JSON.stringify(entry.when ?? null) !== JSON.stringify(a.part!.when ?? null)
  })
  const sorted =
    existsSync(indexPath(folder)) && readFileSync(indexPath(folder), 'utf8') === formatIndex(index)
  return [
    {
      check: 'index',
      ok: !wrong.length && sorted,
      detail: wrong.length
        ? `index.json lacks ${wrong.map((a) => a.name).join(', ')}`
        : `index.json lists ${parts.length} files, sorted`
    }
  ]
}
