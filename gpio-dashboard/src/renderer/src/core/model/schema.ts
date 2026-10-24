// Runtime schemas for content files and documents. Each is typed against the model
// interface it validates, so the two cannot drift apart.
import { z } from 'zod'
import type { PartDef, PinDef, PropertySchema } from './types'

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
        sources: z.array(z.string().url()).min(1),
        notes: z.string().optional()
      })
      .strict()
  })
  .strict()
