// Runtime schemas for content files and documents. Each is typed against the model
// interface it validates, so the two cannot drift apart.
import { z } from 'zod'
import type { CircuitDoc, Endpoint, HoleRef, PartDef, PinDef, PropertySchema, Wire } from './types'
import { COL_PAIRS, MAIN_COLUMNS, RAIL_IDS } from './types'

const vec2 = z.tuple([z.number(), z.number()])
const vec3 = z.tuple([z.number(), z.number(), z.number()])

const pinRole = z.enum([
  'passive',
  'anode',
  'cathode',
  'positive',
  'negative',
  'base',
  'collector',
  'emitter',
  'wiper',
  'switch',
  'coil',
  'contact',
  'power',
  'ground',
  'logic-in',
  'logic-out',
  'logic-io',
  'analog-in',
  'analog-out',
  'driver-out',
  'signal',
  'nc'
])

const electricalType = z.enum([
  'passive',
  'input',
  'output',
  'bidirectional',
  'power-in',
  'power-out',
  'open-collector',
  'nc'
])

export const PinDefSchema: z.ZodType<PinDef> = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_+-]+$/),
    label: z.string().min(1),
    role: pinRole,
    electricalType,
    offsetPitch: vec2,
    connector: z.enum(['male-pin', 'female-socket']).optional()
  })
  .strict()

const propertySchema: z.ZodType<PropertySchema> = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('number'),
      label: z.string(),
      unit: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      default: z.number()
    })
    .strict(),
  z
    .object({
      type: z.literal('enum'),
      label: z.string(),
      options: z.array(z.string()).min(1),
      default: z.string()
    })
    .strict(),
  z.object({ type: z.literal('boolean'), label: z.string(), default: z.boolean() }).strict()
])

const simModel = z.enum([
  'resistor',
  'capacitor',
  'electrolytic',
  'diode',
  'led',
  'rgb-led',
  'npn',
  'pnp',
  'switch',
  'tact-switch',
  'tilt-switch',
  'potentiometer',
  'ldr',
  'ntc',
  'active-buzzer',
  'passive-buzzer',
  'dc-motor',
  'relay-module',
  'shift-register-595',
  'adc0834',
  'l293d',
  'seven-segment',
  'seven-segment-4digit',
  'led-matrix-8x8',
  'bar-graph-10',
  'dht11',
  'hc-sr04',
  'hc-sr501',
  'sg90',
  'lcd1602-i2c',
  'ads1115',
  'ads7830',
  'keypad-4x4',
  'joystick',
  'power-module',
  'none'
])

const params = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]))

export const PartDefSchema: z.ZodType<PartDef> = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    name: z.string().min(1),
    category: z.enum([
      'passive',
      'led',
      'switch',
      'sensor',
      'semiconductor',
      'ic',
      'display',
      'actuator',
      'audio',
      'module',
      'power'
    ]),
    kitTags: z.array(z.string()),
    pins: z.array(PinDefSchema).min(1),
    internalConnections: z.array(z.array(z.string()).min(2)),
    footprint: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('flex-2lead'),
          minSpan: z.number().int().min(1),
          maxSpan: z.number().int().min(1)
        })
        .strict(),
      z.object({ kind: z.literal('rigid'), straddleTrench: z.boolean().optional() }).strict(),
      z.object({ kind: z.literal('offboard') }).strict()
    ]),
    sim: z.object({ model: simModel, params }).strict(),
    properties: z.record(z.string(), propertySchema),
    bodyMm: vec3,
    geometry: z.union([
      z
        .object({
          family: z.string(),
          params: z.record(z.string(), z.union([z.number(), z.string()]))
        })
        .strict(),
      z.object({ gltf: z.string() }).strict(),
      z
        .object({
          procedural: z.string(),
          params: z.record(z.string(), z.union([z.number(), z.string()]))
        })
        .strict()
    ]),
    colliders: z.string().optional(),
    provenance: z
      .object({
        sources: z.array(z.string().url()),
        notes: z.string().optional()
      })
      .strict()
  })
  .strict()

// --- Circuit documents (.gpiob) ---

const transform = z.object({ position: vec2, rotationDeg: z.number() }).strict()

export const HoleRefSchema: z.ZodType<HoleRef> = z.discriminatedUnion('area', [
  z
    .object({
      board: z.string(),
      area: z.literal('main'),
      row: z.number().int(),
      col: z.enum(MAIN_COLUMNS)
    })
    .strict(),
  z
    .object({
      board: z.string(),
      area: z.literal('rail'),
      rail: z.enum(RAIL_IDS),
      index: z.number().int()
    })
    .strict()
])

const endpoint: z.ZodType<Endpoint> = z.union([
  z.object({ hole: HoleRefSchema }).strict(),
  z.object({ pin: z.object({ part: z.string(), pin: z.string() }).strict() }).strict()
])

const wireSchema: z.ZodType<Wire> = z
  .object({
    id: z.string().min(1),
    a: endpoint,
    b: endpoint,
    color: z.string(),
    kind: z.enum(['dupont-mm', 'dupont-mf', 'dupont-ff', 'solid-arc', 'solid-flat']),
    lengthMm: z.union([z.number().positive(), z.literal('auto')]),
    heightMm: z.number().optional(),
    routeHints: z.array(vec3).max(3).optional()
  })
  .strict()

export const CircuitDocSchema: z.ZodType<CircuitDoc> = z
  .object({
    schemaVersion: z.number().int(),
    meta: z
      .object({
        name: z.string(),
        created: z.string(),
        updated: z.string(),
        sourceTutorialId: z.string().optional(),
        revision: z.number().int().nonnegative()
      })
      .strict(),
    boards: z.array(
      z.object({ id: z.string().min(1), defId: z.enum(['bb-830', 'bb-400']), transform }).strict()
    ),
    controller: z
      .object({
        pi: z.object({ transform }).strict(),
        tboard: z
          .object({
            board: z.string(),
            pin1Row: z.number().int(),
            colPair: z.enum(COL_PAIRS),
            orientation: z.enum(['header-toward-row-0', 'header-toward-last-row'])
          })
          .strict(),
        ribbon: z.object({ lengthMm: z.number().positive() }).strict()
      })
      .strict(),
    parts: z.array(
      z
        .object({
          id: z.string().min(1),
          defId: z.string(),
          props: z.record(z.string(), z.unknown()),
          placement: z
            .object({
              pins: z.record(z.string(), HoleRefSchema.nullable()),
              offboardPose: transform.optional(),
              rotationDeg: z
                .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
                .optional()
            })
            .strict()
        })
        .strict()
    ),
    wires: z.array(wireSchema),
    code: z
      .object({
        language: z.literal('python'),
        library: z.enum(['RPi.GPIO', 'gpiozero']),
        source: z.string()
      })
      .strict(),
    customParts: z.array(PartDefSchema).optional(),
    buildStepAnnotations: z
      .record(
        z.string(),
        z.object({ why: z.string().optional(), mistake: z.string().optional() }).strict()
      )
      .optional(),
    assistant: z.object({ transcriptFile: z.string() }).strict().optional()
  })
  .strict()
