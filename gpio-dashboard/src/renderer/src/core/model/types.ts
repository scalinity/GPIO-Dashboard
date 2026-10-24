// The circuit document model (SPEC 5). Pure data: no React, DOM or Tauri.
//
// Units are millimetres. A board's local frame has x along its rows (row 1 toward the last
// row) and y across them (column a toward column j); z is up from the board's top surface.
// The table frame is the same plane for every board, the Pi and off-board modules.

export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]

export const MAIN_COLUMNS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const
export type MainColumn = (typeof MAIN_COLUMNS)[number]

/** "top" is the j side, "bottom" the a side, as the board reads with row 1 on the left. */
export const RAIL_IDS = ['top+', 'top-', 'bottom+', 'bottom-'] as const
export type RailId = (typeof RAIL_IDS)[number]

export type HoleRef =
  | { board: string; area: 'main'; row: number; col: MainColumn }
  | { board: string; area: 'rail'; rail: RailId; index: number }

/** A lead end: in a breadboard hole, or on an off-board module's connector pin. */
export type Endpoint = { hole: HoleRef } | { pin: { part: string; pin: string } }

export interface Transform2D {
  position: Vec2
  rotationDeg: number
}

export type BoardDefId = 'bb-830' | 'bb-400'

export interface BoardInstance {
  id: string
  defId: BoardDefId
  transform: Transform2D
}

/** The two breadboard columns the T-board's pin rows land in; they are 6 pitches apart. */
export const COL_PAIRS = ['b/f', 'c/g', 'd/h', 'e/i'] as const
export type ColPair = (typeof COL_PAIRS)[number]

export type TboardOrientation = 'header-toward-row-0' | 'header-toward-last-row'

export interface TboardPlacement {
  board: string
  /** The row pin 1 sits in; the pins run toward higher rows, or lower when reversed. */
  pin1Row: number
  colPair: ColPair
  orientation: TboardOrientation
}

export interface ControllerInstance {
  pi: { transform: Transform2D }
  tboard: TboardPlacement
  ribbon: { lengthMm: number }
}

export type WireKind = 'dupont-mm' | 'dupont-mf' | 'dupont-ff' | 'solid-arc' | 'solid-flat'

export interface Wire {
  id: string
  a: Endpoint
  b: Endpoint
  color: string
  kind: WireKind
  /** Dupont: the lead's real length; solid: its cut length. 'auto' picks from the inventory. */
  lengthMm: number | 'auto'
  /** Bend height of a solid-arc jumper. */
  heightMm?: number
  /** At most 3 soft targets set by dragging mid-span; visual only. */
  routeHints?: Vec3[]
}

export interface PartInstance {
  /** Reference designator, e.g. R1, D1, Q1, U1, SW1. */
  id: string
  defId: string
  props: Record<string, unknown>
  placement: {
    /** Each pin's hole, or null while unplaced. Off-board modules have no holes. */
    pins: Record<string, HoleRef | null>
    /** Where an off-board module sits on the table. */
    offboardPose?: Transform2D
    /** Rigid parts turn in 90° steps (SPEC 6.6). */
    rotationDeg?: 0 | 90 | 180 | 270
  }
}

export type CodeLibrary = 'RPi.GPIO' | 'gpiozero'

export interface CircuitDoc {
  schemaVersion: number
  meta: {
    name: string
    created: string
    updated: string
    sourceTutorialId?: string
    /** Bumped by every committed transaction. */
    revision: number
  }
  boards: BoardInstance[]
  controller: ControllerInstance
  parts: PartInstance[]
  wires: Wire[]
  code: { language: 'python'; library: CodeLibrary; source: string }
  buildStepAnnotations?: Record<string, { why?: string; mistake?: string }>
  assistant?: { transcriptFile: string }
}

// --- Part definitions (content/parts/*.part.json) ---

export type PartCategory =
  | 'passive'
  | 'led'
  | 'switch'
  | 'sensor'
  | 'semiconductor'
  | 'ic'
  | 'display'
  | 'actuator'
  | 'audio'
  | 'module'
  | 'power'

/**
 * What a pin does in the circuit. ERC and Board Sense read roles: a transistor base, an IC's
 * logic pins and a module's signal pins are never probed (SPEC 14.5).
 */
export type PinRole =
  | 'passive'
  | 'anode'
  | 'cathode'
  | 'positive'
  | 'negative'
  | 'base'
  | 'collector'
  | 'emitter'
  | 'wiper'
  | 'switch'
  | 'coil'
  | 'contact'
  | 'power'
  | 'ground'
  | 'logic-in'
  | 'logic-out'
  | 'logic-io'
  | 'analog-in'
  | 'analog-out'
  | 'driver-out'
  | 'signal'
  | 'nc'

/** In the KiCad sense: how the pin behaves electrically, for ERC. */
export type ElectricalType =
  | 'passive'
  | 'input'
  | 'output'
  | 'bidirectional'
  | 'power-in'
  | 'power-out'
  | 'open-collector'
  | 'nc'

/** An off-board module's connector at each pin (SPEC 6.5). */
export type ConnectorGender = 'male-pin' | 'female-socket'

export interface PinDef {
  id: string
  label: string
  role: PinRole
  electricalType: ElectricalType
  /** Rigid footprints: the pin's offset from pin 1 in pitches, [along rows, across columns]. */
  offsetPitch: Vec2
  /** Off-board modules only. */
  connector?: ConnectorGender
}

export type Footprint =
  /** Two leads placed by anchor and span, legs bent to reach (resistors, LEDs, diodes...). */
  | { kind: 'flex-2lead'; minSpan: number; maxSpan: number }
  /** Pins at fixed offsets; turns in 90° steps; DIPs straddle the trench. */
  | { kind: 'rigid'; straddleTrench?: boolean }
  /** Sits on the table and connects through leads to its connector pins. */
  | { kind: 'offboard' }

export type SimModelId =
  | 'resistor'
  | 'capacitor'
  | 'electrolytic'
  | 'diode'
  | 'led'
  | 'rgb-led'
  | 'npn'
  | 'pnp'
  | 'switch'
  | 'tact-switch'
  | 'tilt-switch'
  | 'potentiometer'
  | 'ldr'
  | 'ntc'
  | 'active-buzzer'
  | 'passive-buzzer'
  | 'dc-motor'
  | 'relay-module'
  | 'shift-register-595'
  | 'adc0834'
  | 'l293d'
  | 'seven-segment'
  | 'seven-segment-4digit'
  | 'led-matrix-8x8'
  | 'bar-graph-10'
  | 'dht11'
  | 'hc-sr04'
  | 'hc-sr501'
  | 'sg90'
  | 'lcd1602-i2c'
  | 'ads1115'
  | 'keypad-4x4'
  | 'joystick'
  | 'power-module'
  | 'none'

/** One editable property, rendered by the schema-driven Properties panel (SPEC 11.4). */
export type PropertySchema =
  | { type: 'number'; label: string; unit?: string; min?: number; max?: number; default: number }
  | { type: 'enum'; label: string; options: string[]; default: string }
  | { type: 'boolean'; label: string; default: boolean }

export interface PartDef {
  id: string
  name: string
  category: PartCategory
  /** e.g. "kit" (in the SunFounder kit) or "not in kit". */
  kitTags: string[]
  pins: PinDef[]
  /** Pins joined inside the part (e.g. a tact switch's always-connected pairs). */
  internalConnections: string[][]
  footprint: Footprint
  sim: { model: SimModelId; params: Record<string, number | string | boolean> }
  properties: Record<string, PropertySchema>
  /** Body bounding box in mm [x, y, z] from the datasheet drawing, for collision checks. */
  bodyMm: Vec3
  geometry:
    | { family: string; params: Record<string, number | string> }
    | { gltf: string }
    | { procedural: string; params: Record<string, number | string> }
  colliders?: string
  /** Datasheet and official document URLs; required (SPEC 7). */
  provenance: { sources: string[]; notes?: string }
}

// --- Edits (SPEC 5): every change to a document is one of these ---

// `index` on the Add ops puts an item back where it was, so undo restores an identical
// document (SPEC 12.8); without it, the item is appended.
export type Op =
  | { type: 'AddBoard'; board: BoardInstance; index?: number }
  | { type: 'RemoveBoard'; id: string }
  | { type: 'MoveBoard'; id: string; transform: Transform2D }
  | { type: 'SetControllerPlacement'; controller: ControllerInstance }
  | { type: 'AddPart'; part: PartInstance; index?: number }
  | { type: 'MovePart'; id: string; placement: PartInstance['placement'] }
  | { type: 'RemovePart'; id: string }
  /** Replaces the part's props as a whole. */
  | { type: 'SetPartProps'; id: string; props: Record<string, unknown> }
  | { type: 'AddWire'; wire: Wire; index?: number }
  | { type: 'MoveWireEnd'; id: string; end: 'a' | 'b'; to: Endpoint }
  /** Sets the given fields; a field given as undefined is removed. */
  | { type: 'SetWireProps'; id: string; props: Partial<Omit<Wire, 'id' | 'a' | 'b'>> }
  | { type: 'RemoveWire'; id: string }
  | { type: 'SetCode'; code: CircuitDoc['code'] }
  | { type: 'SetMeta'; meta: Partial<Pick<CircuitDoc['meta'], 'name' | 'sourceTutorialId'>> }

export type Author = 'user' | 'assistant' | 'system'

export interface Transaction {
  id: string
  author: Author
  label: string
  ops: Op[]
  /** Applying these to the result restores the prior document. */
  inverse: Op[]
  assistantTurnId?: string
}
