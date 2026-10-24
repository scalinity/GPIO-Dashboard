// The controller-side assets (SPEC 6.3 to 6.5, 10.4): the T-board, the IDC socket, the ribbon's
// two textures and the Dupont housings. Their KTX2 encoding, and the checks assets:check and the
// Vitest guard run on them. Every position is measured from the GLB's own geometry (or the KTX2
// file's texels) and compared with what the content file says.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Document } from '@gltf-transform/core'
import { type Asset, type Ktx2, type Manifest, MODELS_DIR, ROOT } from './assets'
import {
  type Box,
  type Vec2,
  type Vec3,
  bounds,
  centre,
  coincidence,
  corePositions,
  geometryHash,
  islands,
  ktx2Format,
  primitives,
  readGlb,
  textures,
  triangleCount
} from './glb'
import { COINCIDENCE_MM, type Finding } from './verify'

const CONTROLLER_KINDS: Asset['kind'][] = ['tboard', 'idc', 'ribbon', 'dupont']

/**
 * The 3M 891-series socket, 40 contacts, from the sheet's drawings (TS-0449-L sheet 2, ADR-L-1),
 * and where it seats in the T-board's box header. `tboard` and `idc` are each checked against it.
 */
export const IDC_3M = {
  /** The lower body's width (the bottom view's 0.240 in) and length (B for 40 contacts). */
  widthMm: 6.1,
  bodyMm: 51.6,
  /** The cover with its latch ears (A for 40 contacts). */
  earsMm: 55.4,
  /** The lower body below the cover (0.200 in): the ears' underside, and so how far the socket stands in a header. */
  seatMm: 5.08,
  /** The contact openings' depth in the mating face: a Pi header's posts stand 6.0 mm over its base. */
  contactDepthMm: 6.0,
  /** The polarization bump's width and where its foot is above the mating face. */
  bump: { widthMm: 6, fromMm: 0.8 }
}
export const isController = (asset: Asset) => CONTROLLER_KINDS.includes(asset.kind)

// --- KTX2: encoding a PNG the Blender script saved, and reading a file back --------------------------

/** The ridge map is linear UASTC with mipmaps; the colour lookup is lossless RGBA8 in sRGB, because
 * a block-compressed 40 x 1 table would blend neighbouring conductors' colours. */
export function encodeKtx2(t: Ktx2, png: string, dst: string) {
  const flags = t.lookup
    ? ['--format', 'R8G8B8A8_SRGB', '--assign-tf', 'srgb', '--assign-primaries', 'bt709']
    : [
        ...['--format', 'R8G8B8A8_UNORM', '--assign-tf', 'linear', '--assign-primaries', 'none'],
        ...['--generate-mipmap', '--encode', 'uastc', '--uastc-quality', '2', '--zstd', '18']
      ]
  execFileSync('ktx', ['create', ...flags, png, dst])
}

const header = (file: Uint8Array) => new DataView(file.buffer, file.byteOffset, file.byteLength)

export function ktx2Texture(t: Ktx2, file: Uint8Array) {
  const view = header(file)
  const format = ktx2Format(file)
  return {
    name: t.file,
    format: format === 'other' ? 'RGBA8' : format,
    size: [view.getUint32(20, true), view.getUint32(24, true)] as [number, number],
    slots: [t.lookup ? 'lookup' : 'normal']
  }
}

/** The top level's RGBA8 texels, row by row. Basis textures are transcoded by KTX-Software; an
 * uncompressed, unsupercompressed file's first level is read in place. */
export function ktx2Texels(file: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = header(file)
  const width = view.getUint32(20, true)
  const height = view.getUint32(24, true)
  if (view.getUint32(12, true) !== 0 && view.getUint32(44, true) === 0) {
    const at = Number(view.getBigUint64(80, true))
    return { width, height, rgba: file.slice(at, at + width * height * 4) }
  }
  const scratch = mkdtempSync(join(tmpdir(), 'ktx2-'))
  try {
    writeFileSync(join(scratch, 't.ktx2'), file)
    execFileSync('ktx', [
      'extract',
      '--transcode',
      'rgba8',
      '--raw',
      join(scratch, 't.ktx2'),
      join(scratch, 't.raw')
    ])
    return { width, height, rgba: readFileSync(join(scratch, 't.raw')) }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// --- Measuring a GLB --------------------------------------------------------------------------------

const mm = (n: number) => `${n.toFixed(3)} mm`
const span = (b: Box, i: number) => b.max[i]! - b.min[i]!
const worst = (...deviations: number[]) => Math.max(...deviations.map(Math.abs))

/** Every vertex of a material's primitives, in the core frame. */
function points(doc: Document, material: string): Vec3[] {
  const out: Vec3[] = []
  for (const { node, prim } of primitives(doc)) {
    if (prim.getMaterial()?.getName() !== material) continue
    const p = corePositions(node, prim)
    for (let i = 0; i < p.length; i += 3) out.push([p[i]!, p[i + 1]!, p[i + 2]!])
  }
  return out
}

/** Where a named node is, in the core frame (glTF's (x, y, z) is core's (x, -z, y)). */
function nodeAt(doc: Document, name: string): Vec3 | undefined {
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name)
  if (!node) return undefined
  const m = node.getWorldMatrix()
  return [m[12]!, -m[14]!, m[13]!]
}

const find = (found: Vec3 | undefined, want: Vec3) =>
  found ? Math.hypot(...found.map((v, i) => v - want[i]!)) : Infinity

function holes(check: string, expected: Vec2[], measured: Vec2[], what: string): Finding {
  const c = coincidence(expected, measured)
  return {
    check,
    ok: c.matched === c.expected && c.measured === c.expected && c.worst <= COINCIDENCE_MM,
    detail: `${c.matched}/${c.expected} ${what} matched one to one (${c.measured} measured), worst ${mm(c.worst)} (tolerance ${mm(COINCIDENCE_MM)})`
  }
}

/** The checks every GLB passes: geometry hash, budgets, KTX2 textures (as verify.ts). */
function generic(asset: Asset, doc: Document, manifest: Manifest, dir: string): Finding[] {
  const bytes = statSync(join(dir, `${asset.name}.glb`)).size
  const triangles = triangleCount(doc)
  const { budget } = asset
  const tex = textures(doc)
  const used = doc
    .getRoot()
    .listExtensionsUsed()
    .map((e) => e.extensionName)
  return [
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
      detail: `${triangles} triangles (max ${budget.triangles}), ${bytes} bytes (max ${budget.bytes})`
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
}

/** The collider file's boxes and capsules enclose the model exactly: no side is off by more than
 * the coincidence tolerance (colliders are proxies, but these proxies are its bounding boxes). */
function colliders(doc: Document, dir: string, name: string): Finding {
  const path = join(dir, `${name}.colliders.json`)
  if (!existsSync(path))
    return { check: 'colliders', ok: false, detail: `${name}.colliders.json is missing` }
  const c = JSON.parse(readFileSync(path, 'utf8')) as {
    units: string
    frame: string
    boxes: { name: string; min: Vec3; max: Vec3 }[]
    capsules: { name: string; a: Vec3; b: Vec3; radius: number }[]
  }
  const lo: Vec3 = [Infinity, Infinity, Infinity]
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  const grow = (min: Vec3, max: Vec3) =>
    [0, 1, 2].forEach((i) => {
      lo[i] = Math.min(lo[i]!, min[i]!)
      hi[i] = Math.max(hi[i]!, max[i]!)
    })
  for (const b of c.boxes) grow(b.min, b.max)
  for (const k of c.capsules) {
    grow(
      k.a.map((v, i) => Math.min(v, k.b[i]!) - k.radius) as Vec3,
      k.a.map((v, i) => Math.max(v, k.b[i]!) + k.radius) as Vec3
    )
  }
  const b = bounds(doc)
  const off = worst(...[0, 1, 2].flatMap((i) => [lo[i]! - b.min[i]!, hi[i]! - b.max[i]!]))
  return {
    check: 'colliders',
    ok: c.units === 'mm' && c.frame === 'core, z up' && c.boxes.length > 0 && off <= COINCIDENCE_MM,
    detail: `${c.boxes.length} boxes, ${c.capsules.length} capsules (${c.boxes.map((x) => x.name).join(', ')}) enclose the model within ${mm(off)}`
  }
}

// --- T-board --------------------------------------------------------------------------------------

interface Tboard {
  pitchMm: number
  rowSpacingPitches: number
  outline: {
    stem: { xMin: number; xMax: number; yMin: number; yMax: number }
    topBar: { xMin: number; xMax: number; yMin: number; yMax: number }
    cornerRadiusMm: number
    pcbThicknessMm: number
  }
  header: {
    centerXMm: number
    centerYMm: number
    lengthAlongYMm: number
    widthAlongXMm: number
    heightMm: number
    keySlotWall: string
  }
  mountingHoles: { xMm: number; yMm: number; diameterMm: number }[]
}

function tboard(doc: Document, t: Tboard): Finding[] {
  const out: Finding[] = []
  const P = t.pitchMm
  const { stem, topBar } = t.outline

  // The PCB (the material of its cut edge) on the spacers, whose underside is z = 0.
  const edge = points(doc, 'fr4')
  const spacers = bounds(doc, 'spacer')
  const board = bounds(doc, 'fr4')
  const stemY = edge.filter(([x]) => x > stem.xMin + t.outline.cornerRadiusMm).map(([, y]) => y)
  const off = worst(
    board.min[0] - topBar.xMin,
    board.max[0] - stem.xMax,
    board.min[1] - topBar.yMin,
    board.max[1] - topBar.yMax,
    Math.min(...stemY) - stem.yMin,
    Math.max(...stemY) - stem.yMax,
    span(board, 2) - t.outline.pcbThicknessMm,
    board.min[2] - spacers.max[2],
    spacers.min[2]
  )
  out.push({
    check: 'dimensions',
    ok: off <= COINCIDENCE_MM,
    detail: `PCB ${topBar.xMin}..${stem.xMax} x ${topBar.yMin}..${topBar.yMax} mm (stem ${stem.yMin}..${stem.yMax}), ${t.outline.pcbThicknessMm} mm thick on the spacers, whose underside is z = 0, worst ${mm(off)}`
  })

  // The stem's 40 pins: odd pins on y = 0, even pins one row spacing across, a pitch apart along x.
  const pins = islands(doc, 'pin')
  const stemPins: Vec2[] = Array.from({ length: 40 }, (_, i) => [
    Math.floor(i / 2) * P,
    (i % 2) * t.rowSpacingPitches * P
  ])
  out.push(
    holes('pins', stemPins, pins.filter((b) => b.min[2] < 0).map(centre), 'stem pins (below z = 0)')
  )

  // The mounting holes: the plated walls as tall as the PCB and as wide as the drill.
  const plated = islands(doc, 'tin').filter(
    (b) =>
      Math.abs(span(b, 2) - t.outline.pcbThicknessMm) <= 0.1 &&
      t.mountingHoles.some((h) => Math.abs(span(b, 0) - h.diameterMm) <= 0.1)
  )
  out.push(
    holes(
      'holes',
      t.mountingHoles.map((h): Vec2 => [h.xMm, h.yMm]),
      plated.map(centre),
      'mounting holes'
    )
  )

  // The box header: its outline, its rim, the key slot, and its 40 pins on the 2 x 20 grid.
  const h = t.header
  const shroud = bounds(doc, 'shroud')
  const top = board.max[2] + h.heightMm
  const at: Vec3 = [h.centerXMm, h.centerYMm, top]
  const headerOff = worst(
    span(shroud, 0) - h.widthAlongXMm,
    span(shroud, 1) - h.lengthAlongYMm,
    shroud.max[2] - top,
    (shroud.min[0] + shroud.max[0]) / 2 - h.centerXMm,
    (shroud.min[1] + shroud.max[1]) / 2 - h.centerYMm
  )
  const rim = points(doc, 'shroud').filter(([, , z]) => Math.abs(z - top) < 0.01)
  const wallYs = (x: number) =>
    [...new Set(rim.filter((p) => Math.abs(p[0] - x) < 0.01).map((p) => p[1].toFixed(3)))]
      .map(Number)
      .sort((a, b) => a - b)
  const keyed = wallYs(shroud.min[0])
  const plain = wallYs(shroud.max[0])
  const keyWall = /-x/.test(h.keySlotWall)
  const slot = keyed.length === 4 ? [keyed[1]!, keyed[2]!] : [NaN, NaN]
  out.push({
    check: 'header',
    ok:
      headerOff <= COINCIDENCE_MM &&
      keyWall &&
      plain.length === 2 &&
      Math.abs((slot[0]! + slot[1]!) / 2 - h.centerYMm) <= COINCIDENCE_MM &&
      slot[1]! - slot[0]! > 2,
    detail: `shroud ${mm(span(shroud, 0))} x ${mm(span(shroud, 1))} x ${mm(shroud.max[2] - board.max[2])} centred within ${mm(headerOff)}; key slot ${mm(slot[1]! - slot[0]!)} wide, centred on the -x wall (${plain.length === 2 ? 'the +x wall is plain' : 'the +x wall is cut'})`
  })
  const rows = [h.centerXMm - P / 2, h.centerXMm + P / 2]
  const headerPins: Vec2[] = Array.from({ length: 40 }, (_, i) => [
    rows[i % 2]!,
    h.centerYMm + (9.5 - Math.floor(i / 2)) * P
  ])
  out.push(
    holes(
      'header pins',
      headerPins,
      pins.filter((b) => b.min[2] > 0).map(centre),
      'box header pins'
    )
  )

  // The socket's empty is where its mating face sits when seated: in the middle of the header,
  // the 3M body's seating depth below the rim.
  const seat: Vec3 = [at[0], at[1], top - IDC_3M.seatMm]
  const socket = find(nodeAt(doc, 'socket'), seat)
  out.push({
    check: 'socket',
    ok: socket <= COINCIDENCE_MM && nodeAt(doc, 'tboard') !== undefined,
    detail: `"socket" ${mm(socket)} from the seating plane, ${IDC_3M.seatMm} mm below the rim, in the header's middle (${seat.map((v) => v.toFixed(2)).join(', ')}); root "tboard" ${nodeAt(doc, 'tboard') ? 'present' : 'missing'}`
  })

  // The socket's lower body goes into the cavity: it fits between the walls, its ears rest on the
  // end walls, its mating face is above the floor, its bump stands in the key slot above the slot's
  // floor, and the header's pins enter its contact openings.
  const unique = (values: number[]) =>
    [...new Set(values.map((v) => v.toFixed(3)))].map(Number).sort((a, b) => a - b)
  const xs = unique(rim.map((p) => p[0])) // outer, inner, inner, outer
  const ys = unique(rim.map((p) => p[1])) // outer, inner, the slot's two sides, inner, outer
  const cavity =
    xs.length === 4 && ys.length === 6 ? [xs[2]! - xs[1]!, ys[4]! - ys[1]!] : [NaN, NaN]
  const floor = Math.min(
    ...points(doc, 'shroud')
      .map((p) => p[2])
      .filter((z) => z > board.max[2] + 0.01)
  )
  const keyFloor = Math.min(
    ...points(doc, 'shroud')
      .filter(
        ([x, y]) =>
          Math.abs(x - shroud.min[0]) < 0.01 && y >= slot[0]! - 0.01 && y <= slot[1]! + 0.01
      )
      .map((p) => p[2])
  )
  const matingZ = top - IDC_3M.seatMm
  const tips = pins.filter((b) => b.min[2] > 0).map((b) => b.max[2])
  const engaged = Math.min(...tips) - matingZ
  const slotWidth = slot[1]! - slot[0]!
  out.push({
    check: 'socket fit',
    ok:
      cavity[0]! >= IDC_3M.widthMm + 0.2 &&
      cavity[1]! >= IDC_3M.bodyMm + 0.2 &&
      IDC_3M.earsMm > cavity[1]! &&
      IDC_3M.earsMm <= span(shroud, 1) &&
      matingZ - floor >= 1 &&
      slotWidth >= IDC_3M.bump.widthMm + 0.2 &&
      keyFloor <= matingZ + IDC_3M.bump.fromMm &&
      engaged > 0 &&
      engaged <= IDC_3M.contactDepthMm,
    detail: `cavity ${mm(cavity[0]!)} x ${mm(cavity[1]!)} for the ${IDC_3M.widthMm} x ${IDC_3M.bodyMm} mm body; the ${IDC_3M.earsMm} mm ears overlap each end wall by ${mm((IDC_3M.earsMm - cavity[1]!) / 2)}; mating face ${mm(matingZ - floor)} above the floor; key slot ${mm(slotWidth)} wide for the ${IDC_3M.bump.widthMm} mm bump, its floor ${mm(matingZ + IDC_3M.bump.fromMm - keyFloor)} below the bump's foot; pins enter ${mm(engaged)} of ${IDC_3M.contactDepthMm} mm`
  })
  return out
}

// --- IDC socket -------------------------------------------------------------------------------------

interface Ribbon {
  conductors: number
  pitchMm: number
  widthMm: number
  thicknessMm: number
  colors: string[]
  conductor1Color: string
}

function idc(doc: Document, r: Ribbon): Finding[] {
  const pitch = 2 * r.pitchMm // two conductors a socket position
  const positions = r.conductors / 2
  const out: Finding[] = []

  // Mating face at z = 0. The lower body (below the cover) is the 3M sheet's 6.10 x 51.6 mm, its
  // width measured away from the bump; the cover's ears are 55.4 mm over all and start the seating
  // depth above the face; nothing is off-centre.
  const all = bounds(doc)
  const plug = points(doc, 'idc-grey').filter(([, , z]) => z < IDC_3M.seatMm - 0.1)
  const along = plug.map((p) => p[1])
  const across = plug.filter(([, y]) => Math.abs(y) > 3.5).map((p) => p[0])
  const ears = points(doc, 'idc-grey').filter(([, y]) => Math.abs(y) > IDC_3M.bodyMm / 2 + 0.05)
  const seat = Math.min(...ears.map((p) => p[2]))
  const off = worst(
    Math.max(...along) - Math.min(...along) - IDC_3M.bodyMm,
    Math.max(...across) - Math.min(...across) - IDC_3M.widthMm,
    span(all, 1) - IDC_3M.earsMm,
    seat - IDC_3M.seatMm,
    (all.min[1] + all.max[1]) / 2,
    all.min[2]
  )
  out.push({
    check: 'dimensions',
    ok: off <= COINCIDENCE_MM,
    detail: `lower body ${mm(Math.max(...across) - Math.min(...across))} x ${mm(Math.max(...along) - Math.min(...along))} (3M: ${IDC_3M.widthMm} x ${IDC_3M.bodyMm}), ears ${mm(span(all, 1))} over all, their underside ${mm(seat)} above the mating face, centred, face on z = 0, worst ${mm(off)}`
  })

  // The 2 x 20 contact openings, each ending in its own piece of metal, as deep as the 3M contacts.
  const expected: Vec2[] = Array.from({ length: r.conductors }, (_, i) => [
    ((i % 2) - 0.5) * pitch,
    (positions / 2 - 0.5 - Math.floor(i / 2)) * pitch
  ])
  const openings = islands(doc, 'idc-contact')
  const depth = worst(...openings.map((b) => span(b, 2) - IDC_3M.contactDepthMm))
  out.push(holes('contacts', expected, openings.map(centre), 'contact openings'))
  out.push({
    check: 'contact depth',
    ok: depth <= COINCIDENCE_MM && openings.length === r.conductors,
    detail: `${openings.length} openings ${IDC_3M.contactDepthMm} mm deep, worst ${mm(depth)}`
  })

  // Pin 1 is contact 1, the +y end of the row on the bump's side; the cable leaves at the -x wall
  // with conductor 1 at its +y edge.
  const pin1 = find(nodeAt(doc, 'pin1'), [-pitch / 2, (positions / 2 - 0.5) * pitch, 0])
  const a = nodeAt(doc, 'cable-a')
  const b = nodeAt(doc, 'cable-b')
  const line =
    a && b ? worst(a[0] - b[0], a[2] - b[2], a[1] - r.widthMm / 2, b[1] + r.widthMm / 2) : Infinity
  out.push({
    check: 'empties',
    ok:
      pin1 <= COINCIDENCE_MM &&
      line <= COINCIDENCE_MM &&
      !!a &&
      a[0] < 0 &&
      a[2] - r.thicknessMm / 2 > IDC_3M.seatMm &&
      a[2] < span(all, 2),
    detail: `"pin1" ${mm(pin1)} from contact 1; "cable-a" and "cable-b" ${r.widthMm} mm apart on one line at x = ${a?.[0].toFixed(2)}, z = ${a?.[2].toFixed(2)} (the cable's underside is above the ${IDC_3M.seatMm} mm a header's rim reaches), conductor 1's edge at +y (worst ${mm(line)})`
  })
  return out
}

// --- Dupont housings --------------------------------------------------------------------------------

interface Dupont {
  housing: { widthMm: number; lengthMm: number }
  malePin: { sideMm: number; exposedMm: number }
}

function dupont(doc: Document, d: Dupont, end: string): Finding[] {
  const male = end === 'male'
  const housing = bounds(doc, 'housing')
  const z0 = male ? d.malePin.exposedMm : 0
  const off = worst(
    span(housing, 0) - d.housing.widthMm,
    span(housing, 1) - d.housing.widthMm,
    span(housing, 2) - d.housing.lengthMm,
    housing.min[2] - z0,
    (housing.min[0] + housing.max[0]) / 2,
    (housing.min[1] + housing.max[1]) / 2
  )
  const out: Finding[] = [
    {
      check: 'dimensions',
      ok: off <= COINCIDENCE_MM,
      detail: `housing ${d.housing.widthMm} x ${d.housing.widthMm} x ${d.housing.lengthMm} mm on the axis, mating face at z = ${z0}, worst ${mm(off)}`
    }
  ]
  if (male) {
    const pin = bounds(doc, 'metal')
    const pinOff = worst(
      span(pin, 0) - d.malePin.sideMm,
      span(pin, 1) - d.malePin.sideMm,
      pin.min[2],
      (pin.min[0] + pin.max[0]) / 2,
      (pin.min[1] + pin.max[1]) / 2,
      housing.min[2] - pin.min[2] - d.malePin.exposedMm
    )
    out.push({
      check: 'pin',
      ok: pinOff <= COINCIDENCE_MM,
      detail: `pin ${d.malePin.sideMm} mm square, tip on the origin, ${d.malePin.exposedMm} mm exposed, worst ${mm(pinOff)}`
    })
  }
  const wire = find(nodeAt(doc, 'wire'), [0, 0, housing.max[2]])
  out.push({
    check: 'wire',
    ok: wire <= COINCIDENCE_MM,
    detail: `"wire" ${mm(wire)} from the housing's rear face centre`
  })
  return out
}

// --- Ribbon textures --------------------------------------------------------------------------------

function ribbon(asset: Asset, manifest: Manifest, r: Ribbon, dir: string): Finding[] {
  const out: Finding[] = []
  const files = Object.fromEntries(
    asset.ktx2!.map((t) => [t.png, readFileSync(join(dir, t.file))] as const)
  )
  const sizes = manifest.textures.map((t) => `${t.name} ${t.format} ${t.size.join('x')}`)
  const bytes = Object.values(files).reduce((n, f) => n + f.length, 0)
  out.push({
    check: 'budget',
    ok:
      bytes === manifest.bytes &&
      bytes <= (asset.budget.bytes ?? Infinity) &&
      manifest.textures.every((t) => t.size.every((s, i) => s <= asset.budget.texturePx[i]!)),
    detail: `${bytes} bytes (max ${asset.budget.bytes}): ${sizes.join(', ')}`
  })

  // The lookup: one texel a conductor, in the sequence ribbon.json lists, conductor 1 first.
  const lookup = ktx2Texels(files.colors!)
  const sequence = Object.fromEntries(
    String(asset.args.colors)
      .split(',')
      .map((c) => c.split('=') as [string, string])
  )
  let wrong = 0
  for (let i = 0; i < r.conductors; i++) {
    const hex = sequence[r.colors[i % r.colors.length]!]!
    for (let c = 0; c < 3; c++) {
      wrong +=
        Math.abs(lookup.rgba[i * 4 + c]! - parseInt(hex.slice(c * 2, c * 2 + 2), 16)) > 1 ? 1 : 0
    }
  }
  out.push({
    check: 'colors',
    ok:
      lookup.width === r.conductors &&
      lookup.height === 1 &&
      wrong === 0 &&
      r.colors[0] === r.conductor1Color,
    detail: `${lookup.width} x ${lookup.height} texels, ${r.colors.length} colours repeated, conductor 1 ${r.conductor1Color}; ${wrong} channels off by more than 1`
  })

  // The ridge map: a ridge's normals tilt toward -u (red below 128) on its rising side and toward
  // +u (above) on its falling side, one ridge a conductor, a pitch apart, with the crown at the
  // middle of the conductor's pitch; and the map's two edges lie on the same smooth curve, so it
  // tiles along the cable and across.
  const ridges = ktx2Texels(files.ridges!)
  const row = Array.from(
    { length: ridges.width },
    (_, i) => ridges.rgba[(ridges.height >> 1) * ridges.width * 4 + i * 4]!
  )
  const per = ridges.width / r.conductors
  const tilted = Array.from({ length: r.conductors }, (_, i) => {
    const crown = (i + 0.5) * per
    return (
      row[Math.round(crown - per / 4)]! <= 128 - 20 &&
      row[Math.round(crown + per / 4)]! >= 128 + 20 &&
      Math.abs(row[Math.round(crown)]! - 128) <= 12
    )
  }).filter(Boolean).length
  const seam = row[0]! + row[row.length - 1]! - 256
  out.push({
    check: 'ridges',
    ok: tilted === r.conductors && Math.abs(seam) <= 6,
    detail: `${ridges.width} x ${ridges.height}: ${tilted}/${r.conductors} ridges tilt the right way either side of a crown at the middle of their pitch; the edges meet smoothly (${seam} off 256) so it tiles`
  })
  return out
}

export async function verifyController(
  asset: Asset,
  dir = join(ROOT, MODELS_DIR)
): Promise<Finding[]> {
  const manifest: Manifest = JSON.parse(
    readFileSync(join(dir, `${asset.name}.manifest.json`), 'utf8')
  )
  const data = JSON.parse(readFileSync(join(ROOT, asset.inputs[0]!), 'utf8'))
  if (asset.kind === 'ribbon') return ribbon(asset, manifest, data, dir)
  const doc = await readGlb(join(dir, `${asset.name}.glb`))
  const own =
    asset.kind === 'tboard'
      ? tboard(doc, data)
      : asset.kind === 'idc'
        ? idc(doc, data)
        : dupont(doc, data, String(asset.args.end))
  return [...generic(asset, doc, manifest, dir), ...own, colliders(doc, dir, asset.name)]
}
