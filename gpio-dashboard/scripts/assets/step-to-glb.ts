// SPEC 10.3 stage 2: read a STEP file with occt-import-js and write an intermediate GLB that keeps
// the STEP colours. One node per STEP body, one primitive and material per colour.
//
// occt-import-js 0.0.23 is compiled with a 2 GB heap, and the Pi 5 STEP (78 MB) fills it while
// loading, which leaves every face untriangulated. So the file is read in parts: each part keeps
// the whole assembly structure and a share of the bodies, and is read by a fresh instance.
import { createRequire } from 'node:module'
import { Document, NodeIO } from '@gltf-transform/core'

/** The part of occt-import-js 0.0.23's result read here (its README); it ships no typings. */
interface OcctMesh {
  name: string
  color?: [number, number, number]
  brep_faces: { first: number; last: number; color: [number, number, number] | null }[]
  attributes: { position: { array: number[] }; normal?: { array: number[] } }
  index: { array: number[] }
}
type ReadStepFile = (
  content: Uint8Array,
  params: {
    linearUnit: 'millimeter'
    linearDeflectionType: 'absolute_value'
    linearDeflection: number
    angularDeflection: number
  }
) => { success: boolean; meshes: OcctMesh[] }
const occtimportjs = createRequire(import.meta.url)('occt-import-js') as () => Promise<{
  ReadStepFile: ReadStepFile
}>

export interface StepParams {
  /** Largest share of body geometry, in bytes of STEP text, read in one occt-import-js instance. */
  partBytes: number
  linearDeflectionMm: number
  angularDeflectionRad: number
}

const BODY_TYPES = new Set(['MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS', 'SHELL_BASED_SURFACE_MODEL'])
const STYLE_TYPES = new Set(['STYLED_ITEM', 'OVER_RIDING_STYLED_ITEM'])
// Entities whose item lists may name a body (or its style) that a part leaves out.
const LIST_HOLDER_TYPES = new Set([
  'ADVANCED_BREP_SHAPE_REPRESENTATION',
  'MANIFOLD_SURFACE_SHAPE_REPRESENTATION',
  'MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION'
])

/** Splits STEP text into parts that each hold all of its structure and a share of its bodies. */
export function splitStep(text: string, partBytes: number): string[] {
  const dataStart = text.indexOf('DATA;') + 'DATA;'.length
  const dataEnd = text.lastIndexOf('ENDSEC;')
  const ids: number[] = []
  const texts: string[] = []
  const types: string[] = []
  const rawRefs: number[][] = []
  let start = dataStart
  let inString = false
  for (let i = dataStart; i < dataEnd; i++) {
    const c = text.charCodeAt(i)
    if (c === 39)
      inString = !inString // ' (a doubled '' toggles twice)
    else if (c === 59 && !inString) {
      const statement = text.slice(start, i).trim()
      start = i + 1
      const m = /^#(\d+)\s*=\s*/.exec(statement)
      if (!m) throw new Error(`Unexpected STEP statement: ${statement.slice(0, 80)}`)
      const entity = statement.slice(m[0].length)
      ids.push(Number(m[1]))
      texts.push(entity)
      types.push(/^([A-Z0-9_]+)\s*\(/.exec(entity)?.[1] ?? 'COMPLEX')
      const bare = entity.includes("'") ? entity.replace(/'(?:[^']|'')*'/g, '') : entity
      rawRefs.push(Array.from(bare.matchAll(/#(\d+)/g), (r) => Number(r[1])))
    }
  }

  const n = ids.length
  const index = new Int32Array(ids.reduce((a, b) => Math.max(a, b), 0) + 1).fill(-1)
  ids.forEach((id, i) => (index[id] = i))
  const refs = rawRefs.map((list) => list.map((id) => index[id]!))
  const referenced = new Uint8Array(n)
  for (const list of refs) for (const j of list) referenced[j] = 1

  const reach = (from: number[], skip?: Uint8Array) => {
    const seen = new Uint8Array(n)
    const stack = from.filter((i) => !skip?.[i])
    for (const i of stack) seen[i] = 1
    while (stack.length) {
      for (const j of refs[stack.pop()!]!) {
        if (!seen[j] && !skip?.[j]) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    return seen
  }

  // Bodies in file order, grouped so each part's geometry stays under partBytes.
  const bodyIndices = types.flatMap((t, i) => (BODY_TYPES.has(t) ? [i] : []))
  const parts: number[][] = [[]]
  const stamp = new Int32Array(n)
  let partSize = 0
  for (const [k, b] of bodyIndices.entries()) {
    const stack = [b]
    stamp[b] = k + 1
    let size = texts[b]!.length
    while (stack.length) {
      for (const j of refs[stack.pop()!]!) {
        if (stamp[j] !== k + 1) {
          stamp[j] = k + 1
          size += texts[j]!.length
          stack.push(j)
        }
      }
    }
    if (partSize > 0 && partSize + size > partBytes) {
      parts.push([])
      partSize = 0
    }
    parts.at(-1)!.push(b)
    partSize += size
  }
  if (parts.length === 1) return [text]

  const head = text.slice(0, dataStart)
  const tail = text.slice(dataEnd)
  return parts.map((part) => {
    const inPart = new Set(part)
    const kept = reach(part)
    const dropped = reach(bodyIndices.filter((b) => !inPart.has(b)))
    const removed = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (dropped[i] && !kept[i]) removed[i] = 1
    // Styles of removed geometry, and the styles that override them.
    for (let changed = true; changed;) {
      changed = false
      for (let i = 0; i < n; i++) {
        if (!removed[i] && STYLE_TYPES.has(types[i]!) && refs[i]!.some((j) => removed[j])) {
          removed[i] = 1
          changed = true
        }
      }
    }
    const rewritten = new Map<number, string>()
    for (let i = 0; i < n; i++) {
      if (removed[i] || !LIST_HOLDER_TYPES.has(types[i]!) || !refs[i]!.some((j) => removed[j]))
        continue
      const kept = texts[i]!.replace(/\(([^()]*)\)/g, (list, inner: string) => {
        const items = inner.split(',').map((s) => s.trim())
        if (!items.every((s) => /^#\d+$/.test(s))) return list
        return `(${items.filter((s) => !removed[index[Number(s.slice(1))]!]).join(',')})`
      })
      if (kept.includes('()')) removed[i] = 1
      else rewritten.set(i, kept)
    }

    const roots: number[] = []
    for (let i = 0; i < n; i++) if (!referenced[i] && !removed[i]) roots.push(i)
    const out = reach(roots, removed)
    const lines: string[] = []
    for (let i = 0; i < n; i++) {
      if (!out[i]) continue
      if (!rewritten.has(i) && refs[i]!.some((j) => removed[j])) {
        throw new Error(`STEP split: ${types[i]} #${ids[i]} refers to a body left out of its part`)
      }
      lines.push(`#${ids[i]} = ${rewritten.get(i) ?? texts[i]};`)
    }
    return `${head}\n${lines.join('\n')}\n${tail}`
  })
}

/** sRGB (as STEP colours are written) to the linear values glTF factors hold. */
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

export async function stepToGlb(stepText: string, glbPath: string, params: StepParams) {
  const parts = splitStep(stepText, params.partBytes)
  const expectedBodies = (
    stepText.match(/=\s*(MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS|SHELL_BASED_SURFACE_MODEL)\(/g) ?? []
  ).length
  const meshes: OcctMesh[] = []
  for (const part of parts) {
    const occt = await occtimportjs()
    const result = occt.ReadStepFile(new TextEncoder().encode(part), {
      linearUnit: 'millimeter',
      linearDeflectionType: 'absolute_value',
      linearDeflection: params.linearDeflectionMm,
      angularDeflection: params.angularDeflectionRad
    })
    if (!result.success) throw new Error('occt-import-js could not read the STEP')
    const empty = result.meshes.filter((m) => m.index.array.length === 0).length
    if (empty > 0) {
      throw new Error(`${empty} STEP bodies came back untriangulated; lower partBytes`)
    }
    meshes.push(...result.meshes)
  }
  if (meshes.length !== expectedBodies) {
    throw new Error(`Read ${meshes.length} STEP bodies, expected ${expectedBodies}`)
  }

  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene('step')
  const materials = new Map<string, ReturnType<Document['createMaterial']>>()
  const material = (rgb: readonly number[]) => {
    const hex = rgb
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
    let m = materials.get(hex)
    if (!m) {
      m = doc
        .createMaterial(`step-${hex}`)
        .setBaseColorFactor([...rgb.map(toLinear), 1] as [number, number, number, number])
      materials.set(hex, m)
    }
    return m
  }

  for (const occtMesh of meshes) {
    const pos = occtMesh.attributes.position.array
    const nor = occtMesh.attributes.normal?.array
    // Triangles grouped by colour: the face's own, else the body's, else neutral grey.
    const groups = new Map<string, { rgb: readonly number[]; tris: number[] }>()
    for (const face of occtMesh.brep_faces) {
      const rgb = face.color ?? occtMesh.color ?? [0.5, 0.5, 0.5]
      const key = rgb.join()
      const group = groups.get(key) ?? groups.set(key, { rgb, tris: [] }).get(key)!
      for (let t = face.first; t <= face.last; t++) group.tris.push(t)
    }
    const mesh = doc.createMesh(occtMesh.name)
    for (const { rgb, tris } of groups.values()) {
      const remap = new Map<number, number>()
      const indices = new Uint32Array(tris.length * 3)
      tris.forEach((t, k) => {
        for (let c = 0; c < 3; c++) {
          const v = occtMesh.index.array[t * 3 + c]!
          indices[k * 3 + c] = remap.get(v) ?? remap.set(v, remap.size).get(v)!
        }
      })
      // STEP is z-up; glTF is y-up: (x, y, z) -> (x, z, -y).
      const position = new Float32Array(remap.size * 3)
      const normal = new Float32Array(remap.size * 3)
      for (const [v, w] of remap) {
        position.set([pos[v * 3]!, pos[v * 3 + 2]!, -pos[v * 3 + 1]!], w * 3)
        if (nor) normal.set([nor[v * 3]!, nor[v * 3 + 2]!, -nor[v * 3 + 1]!], w * 3)
      }
      const prim = doc
        .createPrimitive()
        .setMaterial(material(rgb))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
        .setAttribute(
          'POSITION',
          doc.createAccessor().setType('VEC3').setArray(position).setBuffer(buffer)
        )
      if (nor) {
        prim.setAttribute(
          'NORMAL',
          doc.createAccessor().setType('VEC3').setArray(normal).setBuffer(buffer)
        )
      }
      mesh.addPrimitive(prim)
    }
    scene.addChild(doc.createNode(occtMesh.name).setMesh(mesh))
  }
  await new NodeIO().write(glbPath, doc)
  return { parts: parts.length, bodies: meshes.length }
}
