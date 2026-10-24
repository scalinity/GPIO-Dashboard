// The electronic parts' models (SPEC 7, 10.4): which Blender family script builds each part
// definition, the budgets each GLB must meet, and what assets:check expects of it. The
// expectations come from the definition's geometry.params, the datasheet's mechanical drawing, so
// a model that drifts from the drawing fails the check.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Asset } from './assets'

export const PARTS_DIR = 'src/renderer/src/content/parts'
/** Tolerance on a datasheet dimension that states none (Kingbright's "unlabelled dimensions"). */
export const DEFAULT_TOL_MM = 0.25
/** Material of the formed lead stubs that bring a rigid part's leads to the 2.54 mm grid. */
export const LEAD_MATERIAL = 'lead'

type Params = Record<string, number | string>
export type Vec3 = [number, number, number]
type Range = [min: number, max: number]

/** What assets:check expects of one part's GLB. */
export interface PartExpectation {
  /** The body's extent along core x, y and z, over every material but LEAD_MATERIAL. */
  body: [Range, Range, Range]
  /** Flex-2lead parts: the distance between the two pins, which the params call the lead spacing. */
  spacing?: number
  /** Which way a lead leaves its pin: out the bottom, or along the body's axis (x). */
  exit: 'down' | 'axial'
  /** Nodes and materials the studio looks up by name, beyond the root and the pin-* empties. */
  nodes: string[]
  materials: string[]
}

/**
 * What one part's file may weigh. The folder holds 18 of them in a 40 MB budget shared with the
 * boards, the Pi and the other part families, so a part gets a few tens of kilobytes (SPEC 10.8).
 */
const PART_BYTES = 40_000

interface Family {
  /** The Blender script in blender/. */
  script: string
  /** The most triangles one of this family's GLBs may have: about a third over its largest file. */
  triangles: number
  expect: (p: Params) => Pick<PartExpectation, 'body' | 'spacing' | 'exit' | 'nodes' | 'materials'>
}

function num(p: Params, key: string): number {
  const v = p[key]
  if (typeof v !== 'number') throw new Error(`geometry.params has no number ${key}`)
  return v
}
const near = (v: number, tol = DEFAULT_TOL_MM): Range => [v - tol, v + tol]
const rod = (diameter: Range, length: Range): [Range, Range, Range] => [length, diameter, diameter]
/** A round body's footprint along x and y, with a flat cut a little off its diameter at one side. */
const flatted = (diameter: number): Range => [diameter - 0.4, diameter + 0.05]

const FAMILIES: Record<string, Family> = {
  'axial-resistor': {
    script: 'axial_resistor.py',
    triangles: 1000,
    expect: (p) => ({
      body: rod(
        near(num(p, 'bodyDiameterMm'), num(p, 'bodyDiameterTolMm')),
        near(num(p, 'bodyLengthMm'), num(p, 'bodyLengthTolMm'))
      ),
      // The leads leave the end caps, so the pins are a body length apart.
      spacing: num(p, 'bodyLengthMm'),
      exit: 'axial',
      nodes: [],
      materials: ['band-1', 'band-2', 'band-3', 'band-4']
    })
  },
  diode: {
    script: 'diode.py',
    triangles: 900,
    // The DO-41 drawing gives a range for the body, and the model is at its maxima.
    expect: (p) => ({
      body: rod(
        [num(p, 'bodyDiameterMinMm'), num(p, 'bodyDiameterMm')],
        [num(p, 'bodyLengthMinMm'), num(p, 'bodyLengthMm')]
      ),
      spacing: num(p, 'bodyLengthMm'),
      exit: 'axial',
      nodes: [],
      materials: ['body', 'band']
    })
  },
  led: {
    script: 'led.py',
    triangles: 1200,
    expect: (p) => ({
      body: [
        flatted(num(p, 'flangeDiameterMm')),
        near(num(p, 'flangeDiameterMm')),
        near(num(p, 'bodyLengthMm'), 0.5)
      ],
      spacing: num(p, 'leadPitchMm'),
      exit: 'down',
      nodes: [],
      materials: ['lens']
    })
  },
  'rgb-led': {
    script: 'rgb_led.py',
    triangles: 1600,
    expect: (p) => ({
      body: [
        flatted(num(p, 'flangeDiameterMm')),
        near(num(p, 'flangeDiameterMm')),
        near(num(p, 'bodyHeightMm'))
      ],
      exit: 'down',
      nodes: [],
      materials: ['lens', 'die-r', 'die-g', 'die-b']
    })
  },
  'ceramic-cap': {
    script: 'ceramic_cap.py',
    triangles: 400,
    expect: (p) => ({
      body: [
        near(num(p, 'bodyLengthMm'), num(p, 'bodyTolMm')),
        near(num(p, 'bodyThicknessMm'), num(p, 'bodyTolMm')),
        near(num(p, 'bodyHeightMm'), num(p, 'bodyTolMm'))
      ],
      spacing: num(p, 'leadSpacingMm'),
      exit: 'down',
      nodes: [],
      materials: ['body']
    })
  },
  'electrolytic-cap': {
    script: 'electrolytic_cap.py',
    triangles: 1000,
    expect: (p) => ({
      body: [
        [num(p, 'diameterMm'), num(p, 'sleeveMaxDiameterMm')],
        [num(p, 'diameterMm'), num(p, 'sleeveMaxDiameterMm')],
        near(num(p, 'lengthMm'), num(p, 'lengthTolMm'))
      ],
      spacing: num(p, 'leadSpacingMm'),
      exit: 'down',
      nodes: [],
      materials: ['sleeve', 'stripe']
    })
  },
  ldr: {
    script: 'ldr.py',
    triangles: 500,
    expect: (p) => ({
      body: [
        near(num(p, 'discDiameterMm'), num(p, 'discDiameterTolMm')),
        near(num(p, 'thicknessMm'), num(p, 'thicknessTolMm')),
        near(num(p, 'flatHeightMm'), num(p, 'flatHeightTolMm'))
      ],
      spacing: num(p, 'leadPitchMm'),
      exit: 'down',
      nodes: [],
      materials: ['track', 'electrode']
    })
  },
  to92: {
    script: 'to92.py',
    triangles: 850,
    expect: (p) => ({
      body: [
        near(num(p, 'bodyWidthMm')),
        near(num(p, 'bodyDepthMm')),
        near(num(p, 'bodyHeightMm'))
      ],
      exit: 'down',
      nodes: [],
      materials: ['epoxy', 'marking']
    })
  },
  'tact-switch': {
    script: 'tact_switch.py',
    triangles: 550,
    // The housing is the footprint; the plunger tops it out at the drawing's overall height.
    expect: (p) => ({
      body: [
        near(num(p, 'bodyWidthMm')),
        near(num(p, 'bodyDepthMm')),
        near(num(p, 'heightMm'), 0.2)
      ],
      exit: 'down',
      nodes: ['plunger'],
      materials: ['housing', 'plunger']
    })
  },
  'tilt-switch': {
    script: 'tilt_switch.py',
    triangles: 900,
    expect: (p) => ({
      body: [near(num(p, 'bodyDiaMm')), near(num(p, 'bodyDiaMm')), near(num(p, 'bodyLengthMm'))],
      exit: 'down',
      nodes: [],
      materials: ['can', 'resin']
    })
  },
  potentiometer: {
    script: 'potentiometer.py',
    triangles: 1400,
    // The round front bezel sets the width and the height; the depth runs from the rear to the shaft's tip.
    expect: (p) => ({
      body: [
        near(num(p, 'frontWidthMm')),
        near(num(p, 'bodyDepthMm') + num(p, 'shaftLengthMm')),
        near(num(p, 'frontWidthMm'))
      ],
      exit: 'down',
      nodes: ['shaft'],
      materials: ['case', 'shaft', 'slot']
    })
  },
  buzzer: {
    script: 'buzzer.py',
    triangles: 950,
    expect: (p) => ({
      body: [
        near(num(p, 'bodyDiaMm'), 0.2),
        near(num(p, 'bodyDiaMm'), 0.2),
        near(num(p, 'heightMm'), 0.2)
      ],
      exit: 'down',
      nodes: [],
      materials: ['body', 'marking']
    })
  },
  ntc: {
    script: 'ntc.py',
    triangles: 750,
    expect: (p) => ({
      body: [
        [num(p, 'bodyDiameterMinMm'), num(p, 'bodyDiameterMm')],
        [num(p, 'bodyDiameterMinMm'), num(p, 'bodyDiameterMm')],
        near(num(p, 'bodyLengthMm'))
      ],
      spacing: num(p, 'leadSpacingMm'),
      exit: 'down',
      nodes: [],
      materials: ['epoxy']
    })
  }
}

/** The parts to model: each definition with a family, and one file per variant the shape changes with. */
const PARTS: { family: string; defId: string; variant?: { prop: string; value: string } }[] = [
  { family: 'axial-resistor', defId: 'resistor' },
  { family: 'diode', defId: 'diode-1n4007' },
  { family: 'led', defId: 'led', variant: { prop: 'size', value: '3mm' } },
  { family: 'led', defId: 'led', variant: { prop: 'size', value: '5mm' } },
  { family: 'rgb-led', defId: 'rgb-led-ca' },
  { family: 'rgb-led', defId: 'rgb-led-cc' },
  { family: 'ceramic-cap', defId: 'ceramic-capacitor' },
  { family: 'electrolytic-cap', defId: 'electrolytic-capacitor' },
  { family: 'ldr', defId: 'ldr' },
  { family: 'ntc', defId: 'ntc-10k' },
  { family: 'to92', defId: 'pn2222' },
  { family: 'to92', defId: 's8050' },
  { family: 'to92', defId: 's8550' },
  { family: 'tact-switch', defId: 'tact-switch-6mm' },
  { family: 'tilt-switch', defId: 'tilt-switch' },
  { family: 'potentiometer', defId: 'potentiometer-10k' },
  { family: 'buzzer', defId: 'active-buzzer' },
  { family: 'buzzer', defId: 'passive-buzzer' }
]

const partPath = (defId: string) => `${PARTS_DIR}/${defId}.part.json`
const assetName = (p: (typeof PARTS)[number]) =>
  p.variant ? `${p.defId}-${p.variant.value}` : p.defId

export const PART_ASSETS: Asset[] = PARTS.map((p) => {
  const family = FAMILIES[p.family]!
  return {
    name: assetName(p),
    kind: 'part',
    part: {
      defId: p.defId,
      family: p.family,
      ...(p.variant && { when: { [p.variant.prop]: p.variant.value } })
    },
    script: family.script,
    support: ['partkit.py'],
    args: {
      part: partPath(p.defId),
      name: assetName(p),
      ...(p.variant && { variant: p.variant.value })
    },
    inputs: [partPath(p.defId)],
    // The parts carry no textures: their detail is geometry and material colour (ADR-A3a-1).
    budget: { texturePx: [0, 0], triangles: family.triangles, bytes: PART_BYTES }
  }
})

/** The part definition a part asset models, read from its content file. */
export function partDefinition(root: string, asset: Asset) {
  return JSON.parse(readFileSync(join(root, asset.inputs[0]!), 'utf8')) as {
    id: string
    footprint: { kind: 'flex-2lead' | 'rigid' | 'offboard' }
    pins: { id: string; offsetPitch: [number, number] }[]
    geometry: { family?: string; params: Params }
  }
}

/** The expectation for a part's GLB, from the params of its variant. */
export function expectation(asset: Asset, params: Params): PartExpectation {
  const family = FAMILIES[asset.part!.family]!
  const variant = asset.args.variant as string | undefined
  const prefix = variant ? `${variant}.` : ''
  const own = Object.fromEntries(
    Object.entries(params)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => [k.slice(prefix.length), v])
  )
  return family.expect(own)
}

// --- parts/index.json: defId -> its files, and the property value that selects each ------------

type Index = Record<string, { file: string; when?: Record<string, string> }[]>

export const indexPath = (dir: string) => join(dir, 'index.json')

export function readIndex(dir: string): Index {
  return existsSync(indexPath(dir)) ? JSON.parse(readFileSync(indexPath(dir), 'utf8')) : {}
}

/** The index as it is written: sorted by definition, then by file. */
export function formatIndex(index: Index): string {
  const sorted = Object.fromEntries(
    Object.keys(index)
      .sort()
      .map((id) => [id, [...index[id]!].sort((a, b) => a.file.localeCompare(b.file))])
  )
  return `${JSON.stringify(sorted, null, 2)}\n`
}

/** Records asset's file under its definition, replacing an earlier entry for the same file. */
export function addToIndex(dir: string, asset: Asset) {
  mkdirSync(dir, { recursive: true })
  const index = readIndex(dir)
  const file = `${asset.name}.glb`
  const rest = (index[asset.part!.defId] ?? []).filter((e) => e.file !== file)
  index[asset.part!.defId] = [
    ...rest,
    { file, ...(asset.part!.when && { when: asset.part!.when }) }
  ]
  writeFileSync(indexPath(dir), formatIndex(index))
}
