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
  /**
   * Which way a lead leaves its pin: out the bottom, along the body's axis (x), or up (the header
   * of an off-board module, where a female housing mates).
   */
  exit: 'down' | 'axial' | 'up'
  /** Nodes and materials the studio looks up by name, beyond the root and the pin-* empties. */
  nodes: string[]
  materials: string[]
  /** Pins whose axis differs from `exit`: a core-frame direction each (a socket facing sideways). */
  axes?: Record<string, Vec3>
  /** The top-level nodes that make up the body (default: every primitive but the leads'). */
  bodyNodes?: string[]
  /** Off-board modules: the pitch of a female screw terminal block, whose pins count in 2-steps. */
  terminalPitch?: number
  /** The size of the `lcd-screen` quad, which carries 0 to 1 UVs over it (mm). */
  screen?: [number, number]
}

/** The part of a definition's content file the expectations read. */
export interface PartDefinition {
  id: string
  footprint: { kind: 'flex-2lead' | 'rigid' | 'offboard' }
  pins: { id: string; offsetPitch: [number, number]; connector?: 'male-pin' | 'female-socket' }[]
  bodyMm: Vec3
  geometry: { family?: string; params: Params }
}

/**
 * What one part's file may weigh. The folder holds 18 of them in a 40 MB budget shared with the
 * boards, the Pi and the other part families, so a part gets a few tens of kilobytes (SPEC 10.8).
 */
const PART_BYTES = 40_000

interface Family {
  /** The Blender script in blender/. */
  script: string
  /** Other files in blender/ the script imports, besides partkit.py. */
  support?: string[]
  /** The most triangles one of this family's GLBs may have: about a third over its largest file. */
  triangles: number
  expect: (p: Params, def: PartDefinition) => PartExpectation
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

/** Where a display's or DIP's body sits above the board: the seating plane's standoff (mm). The
 * display scripts raise their bodies by this much; a DIP's comes from its params. */
export const DISPLAY_STANDOFF_MM = 0.5
const ANY: Range = [0, Infinity]
/**
 * The LCD-1602A's character area: 16 columns at a 3.55 mm pitch and 2 rows at 5.95 mm, characters
 * 2.95 x 5.55 mm (its datasheet's "Character Size" and "Character Pitch"), so 15 pitches and a
 * character wide, and a pitch and a character high.
 */
const HD44780_AREA_MM: [number, number] = [15 * 3.55 + 2.95, 5.95 + 5.55]
/** Datasheet figures read off a module's photo or listing, which round to half a millimetre. */
const MODULE_TOL_MM = 0.5

function deviceFamilies(): Record<string, Family> {
  const display = (script: string, triangles: number, nodes: (p: Params) => string[]): Family => ({
    script,
    support: ['devicekit.py'],
    triangles,
    expect: (p) => ({
      // The segments stand flush with the face's top, so the body is as tall as its params say,
      // less the standoff it floats on.
      body: [
        near(num(p, 'bodyLengthMm')),
        near(num(p, 'bodyWidthMm')),
        near(num(p, 'bodyHeightMm') - DISPLAY_STANDOFF_MM)
      ],
      exit: 'down',
      nodes: nodes(p),
      materials: []
    })
  })
  const segments = (prefix: string) =>
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((s) => `${prefix}${s}`)
  const count = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
  return {
    dip: {
      script: 'dip.py',
      support: ['devicekit.py'],
      triangles: 640,
      expect: (p) => ({
        // TI's height is from the seating plane to the top; the body floats on its standoff.
        body: [
          near(num(p, 'bodyLengthMm')),
          near(num(p, 'bodyWidthMm')),
          near(num(p, 'bodyHeightMm') - num(p, 'standoffMinMm'))
        ],
        exit: 'down',
        nodes: [],
        materials: []
      })
    },
    'seven-segment': display('seven_segment.py', 240, () => segments('seg-')),
    'seven-segment-4digit': display('seven_segment.py', 900, () =>
      count(4).flatMap((d) => segments(`seg-${d}-`))
    ),
    'bar-graph': display('bar_graph.py', 170, (p) =>
      count(num(p, 'segmentCount')).map((n) => `bar-${n}`)
    ),
    'dot-matrix': display('dot_matrix.py', 2200, (p) =>
      count(num(p, 'rows')).flatMap((r) => count(num(p, 'cols')).map((c) => `dot-${r}-${c}`))
    ),
    motor: {
      script: 'motor.py',
      support: ['devicekit.py', 'modparts.py'],
      triangles: 3600,
      // Adafruit's can is 2.5 mm longer than the 27.5 mm the datasheet gives, with the bearing boss.
      expect: (p, def) => ({
        body: [
          near(num(p, 'bodyLengthMm'), 2.6),
          near(num(p, 'bodyWidthMm')),
          near(num(p, 'bodyHeightMm'))
        ],
        exit: 'up',
        nodes: ['rotor'],
        materials: [],
        // The two leads end in housings lying flat, their male pins pointing along -y.
        axes: Object.fromEntries(def.pins.map((q) => [q.id, [0, -1, 0] as Vec3])),
        bodyNodes: ['body']
      })
    },
    module: {
      script: 'module.py',
      support: ['devicekit.py', 'modparts.py', 'mod_sensors.py', 'mod_ads.py', 'mod_boards.py'],
      triangles: 1200,
      expect: (p, def) => {
        const variant = typeof p.variant === 'string' ? p.variant : def.id
        const make = MODULES[variant]
        if (!make) throw new Error(`parts.ts has no module variant ${variant}`)
        return make(p, def)
      }
    }
  }
}

/** An off-board module's body: its board and what stands on it, to the datasheet's size. */
const board = (
  x: number,
  y: number,
  z: Range | number,
  rest: Partial<PartExpectation> = {}
): PartExpectation => ({
  body: [
    near(x, MODULE_TOL_MM),
    near(y, MODULE_TOL_MM),
    typeof z === 'number' ? near(z, MODULE_TOL_MM) : z
  ],
  exit: 'up',
  nodes: [],
  materials: [],
  bodyNodes: ['body'],
  ...rest
})

/** The modules by geometry.params.variant (a definition without one is named by its id). */
const MODULES: Record<string, (p: Params, def: PartDefinition) => PartExpectation> = {
  'adafruit-1085-stemma-qt': (p) =>
    board(num(p, 'boardLengthMm'), num(p, 'boardWidthMm'), num(p, 'boardHeightMm')),
  'lafvin-ads7830': (p) => board(num(p, 'boardLengthApproxMm'), num(p, 'boardWidthApproxMm'), ANY),
  'dht11-3pin-breakout': (p) =>
    board(num(p, 'boardLengthApproxMm'), num(p, 'boardWidthApproxMm'), ANY),
  // The bare sensor stands on a board; its 5.5 mm is its thickness, as its drawing says.
  'dht11-bare-4pin-sip': (p) => ({
    body: [
      near(num(p, 'bodyWidthMm')),
      near(num(p, 'bodyThicknessMm')),
      near(num(p, 'bodyHeightMm'))
    ],
    exit: 'down',
    nodes: ['grille'],
    materials: []
  }),
  'hc-sr04': (p) => board(num(p, 'boardLengthMm'), num(p, 'boardWidthMm'), num(p, 'heightMm')),
  'hc-sr501': (p) =>
    board(num(p, 'boardLengthMm'), num(p, 'boardWidthMm'), num(p, 'heightMm'), { nodes: ['lens'] }),
  'breadboard-power-module': (p, def) =>
    board(num(p, 'boardLengthMm'), num(p, 'boardWidthMm'), def.bodyMm[2]),
  'relay-module-5v': (p, def) =>
    board(num(p, 'boardLengthMm'), num(p, 'boardWidthMm'), def.bodyMm[2], {
      nodes: ['lens', 'armature'],
      // The screw terminals take a wire from the board's edge, and sit at their own pitch.
      axes: Object.fromEntries(
        def.pins
          .filter((q) => q.connector === 'female-socket')
          .map((q) => [q.id, [0, 1, 0] as Vec3])
      ),
      terminalPitch: num(p, 'screwTerminalPitchMm')
    }),
  'ky-023-joystick': (p, def) =>
    board(num(p, 'boardLengthMm'), num(p, 'boardWidthMm'), def.bodyMm[2], { nodes: ['stick'] }),
  'lcd1602a-i2c-backpack': (p) =>
    board(num(p, 'boardLengthMm'), num(p, 'boardWidthMm'), num(p, 'moduleThicknessMaxMm'), {
      nodes: ['lcd-screen'],
      screen: HD44780_AREA_MM
    }),
  // The pad is the body; its tail ends in a female housing lying flat, its sockets facing along
  // the tail, away from the pad.
  'membrane-keypad-4x4': (p, def) =>
    board(num(p, 'keypadLengthMm'), num(p, 'keypadWidthMm'), num(p, 'keypadThicknessMm'), {
      exit: 'up',
      axes: Object.fromEntries(def.pins.map((q) => [q.id, [0, -1, 0] as Vec3])),
      bodyNodes: ['body']
    }),
  'sg90-micro-servo': (p, def) => ({
    // The case and its horn: ears 32.2 across, 11.8 wide, 31 tall with the horn on.
    ...board(num(p, 'earSpanMm'), num(p, 'bodyWidthMm'), num(p, 'overallHeightMm'), {
      nodes: ['horn'],
      axes: Object.fromEntries(def.pins.map((q) => [q.id, [0, -1, 0] as Vec3])),
      bodyNodes: ['body', 'horn']
    })
  })
}

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
  },
  ...deviceFamilies()
}

/** The parts to model: each definition with a family, and one file per variant the shape changes with. */
interface PartEntry {
  family: string
  defId: string
  variant?: { prop: string; value: string }
  /** A texture budget, for the families that bake a legend or a marking (the others carry none). */
  texturePx?: [number, number]
  /** This file's triangle cap, where it needs more than its family's. */
  triangles?: number
  bytes?: number
  /** A manufacturer's STEP this model starts from (ADR-A3b). */
  step?: Asset['step']
}

const PARTS: PartEntry[] = [
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
  { family: 'buzzer', defId: 'passive-buzzer' },
  // Displays, ICs and off-board modules (ADR-A3b).
  ...['ic-74hc595', 'ic-adc0834', 'ic-l293d'].map((defId) => ({
    family: 'dip',
    defId,
    texturePx: [512, 128] as [number, number]
  })),
  { family: 'seven-segment', defId: 'seven-segment-ca' },
  { family: 'seven-segment', defId: 'seven-segment-cc' },
  { family: 'seven-segment-4digit', defId: 'seven-segment-4digit' },
  { family: 'bar-graph', defId: 'bar-graph-10' },
  { family: 'dot-matrix', defId: 'led-matrix-8x8' },
  {
    family: 'motor',
    defId: 'dc-motor',
    step: {
      source: 'adafruit-711-dc-toy-motor-step',
      licenseSource: 'adafruit-cad-parts-license',
      params: { partBytes: 12e6, linearDeflectionMm: 0.03, angularDeflectionRad: 0.4 }
    }
  },
  {
    family: 'module',
    defId: 'ads1115-module',
    texturePx: [512, 512],
    triangles: 9000,
    bytes: 300_000,
    step: {
      source: 'adafruit-1085-ads1115-step',
      licenseSource: 'adafruit-cad-parts-license',
      params: { partBytes: 12e6, linearDeflectionMm: 0.03, angularDeflectionRad: 0.4 }
    }
  },
  {
    family: 'module',
    defId: 'ads7830-module',
    texturePx: [512, 512],
    triangles: 680,
    bytes: 40_000
  },
  {
    family: 'module',
    defId: 'breadboard-power-module',
    texturePx: [1024, 512],
    triangles: 1300,
    bytes: 50_000
  },
  { family: 'module', defId: 'dht11-module', texturePx: [512, 512], triangles: 350, bytes: 34_000 },
  { family: 'module', defId: 'dht11', texturePx: [256, 256], triangles: 20, bytes: 12_000 },
  { family: 'module', defId: 'hc-sr04', texturePx: [1024, 512], triangles: 700, bytes: 30_000 },
  { family: 'module', defId: 'hc-sr501', texturePx: [512, 512], triangles: 1130, bytes: 30_000 },
  {
    family: 'module',
    defId: 'joystick-module',
    texturePx: [512, 512],
    triangles: 800,
    bytes: 32_000
  },
  { family: 'module', defId: 'keypad-4x4', texturePx: [1024, 1024], triangles: 125, bytes: 56_000 },
  { family: 'module', defId: 'lcd1602-i2c', texturePx: [1024, 512], triangles: 550, bytes: 30_000 },
  {
    family: 'module',
    defId: 'relay-module-5v',
    texturePx: [512, 512],
    triangles: 760,
    bytes: 50_000
  },
  { family: 'module', defId: 'sg90', texturePx: [256, 256], triangles: 530, bytes: 24_000 }
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
    support: ['partkit.py', ...(family.support ?? [])],
    args: {
      part: partPath(p.defId),
      name: assetName(p),
      ...(p.variant && { variant: p.variant.value })
    },
    inputs: [partPath(p.defId)],
    ...(p.step && { step: p.step }),
    // Most parts carry no textures: their detail is geometry and material colour (ADR-0029).
    budget: {
      texturePx: p.texturePx ?? [0, 0],
      triangles: p.triangles ?? family.triangles,
      bytes: p.bytes ?? PART_BYTES
    }
  }
})

/** The part definition a part asset models, read from its content file. */
export function partDefinition(root: string, asset: Asset) {
  return JSON.parse(readFileSync(join(root, asset.inputs[0]!), 'utf8')) as PartDefinition
}

/** The expectation for a part's GLB, from the params of its variant. */
export function expectation(asset: Asset, def: PartDefinition): PartExpectation {
  const family = FAMILIES[asset.part!.family]!
  const variant = asset.args.variant as string | undefined
  const prefix = variant ? `${variant}.` : ''
  const own = Object.fromEntries(
    Object.entries(def.geometry.params)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => [k.slice(prefix.length), v])
  )
  return family.expect(own, def)
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
