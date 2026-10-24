// A tutorial (SPEC 13.1): a circuit document plus metadata, sim assertions, hardware checkpoints
// and Markdown theory. Assertions are data, so one generic test runs every tutorial's.
import { z } from 'zod'

const range = z
  .object({ min: z.number().optional(), max: z.number().optional() })
  .strict()
  .refine((r) => r.min !== undefined || r.max !== undefined, 'a range needs min or max')

const gpioState = z.union([
  z.object({ mode: z.literal('in'), pull: z.enum(['up', 'down', 'off']) }).strict(),
  z
    .object({
      mode: z.literal('out'),
      level: z.boolean(),
      pwm: z
        .object({ frequencyHz: z.number().positive(), duty: z.number().min(0).max(1) })
        .strict()
        .optional()
    })
    .strict()
])

const expectation = z.union([
  /** An LED die's current, e.g. "D1.D" or "LED1.R". */
  z.object({ die: z.string(), currentA: range }).strict(),
  /** What a GPIO input reads. */
  z
    .object({ read: z.number().int(), is: z.enum(['low', 'high', 'ambiguous', 'floating']) })
    .strict(),
  /** A part pin's voltage, e.g. "R2.2". */
  z.object({ pin: z.string(), volts: range }).strict(),
  /** The current a GPIO sources (negative: sinks). */
  z.object({ gpio: z.number().int(), currentA: range }).strict(),
  /** Fields a behavioural part's view must equal. */
  z.object({ part: z.string(), view: z.record(z.string(), z.unknown()) }).strict(),
  /** An I2C read transaction of bytes.length bytes, each within its range. */
  z.object({ i2cRead: z.number().int(), bytes: z.array(range).min(1) }).strict()
])

const inputs = z.record(
  z.string(),
  z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
)

/** One stimulus change, then time run forward (behaviour timers, PWM edges). */
const step = z
  .object({
    gpio: z.record(z.string(), gpioState).default({}),
    inputs: inputs.default({}),
    /** I2C write transactions, in order; each must be acknowledged. */
    i2c: z
      .array(z.object({ address: z.number().int(), write: z.array(z.number().int()) }).strict())
      .default([]),
    advanceS: z.number().min(0).default(0)
  })
  .strict()

export const AssertionSchema = z
  .object({
    name: z.string().min(1),
    gpio: z.record(z.string(), gpioState).default({}),
    inputs: inputs.default({}),
    /** Seconds to run before checking (behaviour timers, PWM edges). */
    advanceS: z.number().min(0).default(0),
    /** Further steps after the first, for protocols (a shift register's clock, an ADC command). */
    sequence: z.array(step).default([]),
    expect: z.array(expectation).min(1)
  })
  .strict()

const checkpoint = z.union([
  z
    .object({
      kind: z.literal('i2c-scan'),
      afterStep: z.string(),
      addresses: z.array(z.number().int())
    })
    .strict(),
  z
    .object({
      kind: z.literal('press'),
      afterStep: z.string(),
      part: z.string(),
      gpio: z.number().int()
    })
    .strict(),
  z
    .object({
      kind: z.literal('toggle-led'),
      afterStep: z.string(),
      part: z.string(),
      gpio: z.number().int()
    })
    .strict()
])

export const TutorialMetaSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    title: z.string().min(1),
    /** Position in the curriculum: the kit's projects first, then the extras (SPEC 13.1). */
    order: z.number().int().positive(),
    /** The kit's project number, e.g. "1.1.1"; null for an extra. */
    kitProject: z
      .string()
      .regex(/^\d\.\d\.\d$/)
      .nullable(),
    tags: z.array(z.enum(['needs parts not in the kit'])),
    summary: z.string().min(1),
    sources: z
      .object({
        kit: z.string().url().nullable(),
        datasheets: z.array(z.string().url()),
        pi: z.array(z.string().url())
      })
      .strict(),
    assertions: z.array(AssertionSchema).min(1),
    checkpoints: z.array(checkpoint)
  })
  .strict()

export type Assertion = z.infer<typeof AssertionSchema>
export type TutorialMeta = z.infer<typeof TutorialMetaSchema>
