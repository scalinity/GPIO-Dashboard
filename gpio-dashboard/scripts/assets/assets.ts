// The shipped models (SPEC 10.4), how each is built, and the budgets each must meet (SPEC 10.8).
// Paths are relative to gpio-dashboard/ (ROOT).
import { join } from 'node:path'
import { PART_ASSETS } from './parts'
import type { StepParams } from './step-to-glb'

export const ROOT = join(import.meta.dirname, '..', '..')

/** Which part definition a part's GLB models, and when the studio picks it (index.json). */
export interface PartModel {
  defId: string
  /** The definition's geometry.family, which names the Blender script. */
  family: string
  /** The property value that selects this file, when a property changes the shape. */
  when?: Record<string, string>
}

/** A texture the script saves as <stem>-<png>.png, which build.ts encodes to KTX2 in place of a GLB. */
export interface Ktx2 {
  file: string
  png: string
  /** A lookup table: lossless RGBA8, sRGB, no mipmaps. Otherwise linear UASTC with mipmaps. */
  lookup?: boolean
}

export interface Asset {
  name: string
  /** What assets:check measures it against. */
  kind: 'breadboard' | 'pi' | 'part' | 'tboard' | 'idc' | 'ribbon' | 'dupont'
  /** Parts: the definition modelled; the GLB goes in the parts/ folder. */
  part?: PartModel
  /** Other files in blender/ that the script imports; the manifest records their hashes. */
  support?: string[]
  /** The Blender script in blender/ and its own arguments. */
  script: string
  args: Record<string, string | number>
  /** content/ files the script reads; the manifest records their hashes. */
  inputs: string[]
  /** A STEP file inside a pinned source, read by step-to-glb.ts and passed as --step-glb. */
  step?: { source: string; file: string; license: string; params: StepParams }
  /** Textures-only assets write these KTX2 files, not <name>.glb and <name>.colliders.json. */
  ktx2?: Ktx2[]
  budget: { texturePx: [number, number]; triangles?: number; bytes?: number }
}

/** <name>.manifest.json, written by build.ts beside <name>.glb. */
export interface Manifest {
  name: string
  tools: { blender: string; ktx: string }
  script: { path: string; args: Record<string, string | number>; sha256: Record<string, string> }
  inputs: { path: string; sha256: string }[]
  sources: { id: string; url: string; sha256: string; license: string; files: string[] }[]
  step?: { file: string; sha256: string; params: StepParams; parts: number; bodies: number }
  license?: string
  triangles: number
  bytes: number
  textures: { name: string; format: string; size: [number, number]; slots: string[] }[]
  budget: Asset['budget'] & { met: boolean }
  /** Absent for textures-only assets. */
  geometryHash?: string
}

export const MODELS_DIR = 'src/renderer/public/models'
/** Where an asset's files go under a models folder: parts are in parts/. */
export const assetDir = (asset: Asset, models: string) =>
  asset.part ? join(models, 'parts') : models
export const MODELS_BUDGET_BYTES = 40e6
/** Cycles bake settings, fixed so rebuilds match (SPEC 10.3). */
export const BAKE = { samples: 128, seed: 0 }

const TBOARD = 'src/renderer/src/content/controllers/tboard.json'
const RIBBON = 'src/renderer/src/content/controllers/ribbon.json'
const DUPONT = 'src/renderer/src/content/leads/dupont.json'

const board = (name: 'bb-830' | 'bb-400', texturePx: [number, number]): Asset => ({
  name,
  kind: 'breadboard',
  script: 'breadboard.py',
  args: { board: `src/renderer/src/content/boards/${name}.board.json` },
  inputs: [`src/renderer/src/content/boards/${name}.board.json`],
  budget: { texturePx }
})

export const ASSETS: Asset[] = [
  // Texture size follows the body: about 12 texels/mm along the rows, 19 across.
  board('bb-830', [2048, 1024]),
  board('bb-400', [1024, 1024]),
  {
    name: 'pi5',
    kind: 'pi',
    script: 'pi5.py',
    args: {
      board: 'src/renderer/src/content/controllers/pi5-board.json',
      // Below the 200k budget, after the PCB and header base, which are kept as modelled.
      triangles: 195_000
    },
    inputs: ['src/renderer/src/content/controllers/pi5-board.json'],
    step: {
      source: 'rpi5-step-no-graphics',
      file: 'rpi-5b_no_graphics.step',
      license: 'LICENSE.txt',
      params: { partBytes: 12e6, linearDeflectionMm: 0.05, angularDeflectionRad: 0.5 }
    },
    budget: { texturePx: [2048, 2048], triangles: 200_000, bytes: 8e6 }
  },
  // The electronic parts (SPEC 7, 10.4): one GLB per part definition, or per shape variant.
  ...PART_ASSETS,
  // Controller-side hero assets (M7 task 7.2): the T-board, the IDC socket, the ribbon's textures
  // and the Dupont housings.
  {
    name: 'tboard',
    kind: 'tboard',
    script: 'tboard.py',
    args: { tboard: TBOARD },
    inputs: [TBOARD],
    budget: { texturePx: [2048, 2048], triangles: 20_000, bytes: 3e6 }
  },
  {
    name: 'idc-socket',
    kind: 'idc',
    script: 'idc.py',
    args: { ribbon: RIBBON },
    inputs: [RIBBON],
    budget: { texturePx: [1024, 1024], triangles: 2_000, bytes: 1e6 }
  },
  {
    name: 'ribbon',
    kind: 'ribbon',
    script: 'ribbon.py',
    args: {
      ribbon: RIBBON,
      // The standard sequence's sRGB colours, read off photos 1 and 3's rainbow ribbon (ADR-A2-3).
      colors:
        'brown=6b3a1d,red=d81e1e,orange=f07a12,yellow=f2d21a,green=1fa84a,blue=1f59d6,violet=7a2fc4,grey=9a9a9e,white=eeeeea,black=1c1c1f'
    },
    inputs: [RIBBON],
    ktx2: [
      { file: 'ribbon-ridges.ktx2', png: 'ridges' },
      { file: 'ribbon-colors.ktx2', png: 'colors', lookup: true }
    ],
    // The ridge map's size: 32 texels per ridge across the cable, a 2.54 mm tile along it.
    budget: { texturePx: [1280, 64], bytes: 100_000 }
  },
  ...(['male', 'female'] as const).map((end): Asset => ({
    name: `dupont-${end}`,
    kind: 'dupont',
    script: 'dupont.py',
    args: { dupont: DUPONT, end },
    inputs: [DUPONT],
    budget: { texturePx: [256, 256], triangles: 500, bytes: 150_000 }
  }))
]

/** The assets named on a command line: every one when none is, and "parts" for all the parts. */
export function select(names: string[]): Asset[] {
  if (!names.length) return ASSETS
  return names.flatMap((name) => (name === 'parts' ? ASSETS.filter((a) => a.part) : [asset(name)]))
}

export function asset(name: string): Asset {
  const a = ASSETS.find((a) => a.name === name)
  if (!a)
    throw new Error(`No asset ${name}; the assets are ${ASSETS.map((a) => a.name).join(', ')}`)
  return a
}
