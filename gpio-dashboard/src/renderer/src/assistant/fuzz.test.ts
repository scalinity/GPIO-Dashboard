// SPEC 20 item 5: the assistant never commits an invalid op. Random and malformed tool input goes
// in through the tools and through the streaming loop; whatever it is, nothing throws out of the
// loop and the document stays valid.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { validateDoc } from '../core/ops/validate'
import { AssistantSession } from './loop'
import { call } from './testing/call'
import { FakeContext } from './testing/fakeContext'
import { VALID_INPUT } from './testing/samples'
import { scriptedFetch, testClient, text, toolUse, type Reply } from './testing/sse'
import { TOOLS } from './tools'
import { mergeProps } from './tools/shared'

// --- Generators ---

const board = fc.constantFrom('bb1', 'bb1', 'bb1', 'bb2', 'bbX')
const holeText = fc.oneof(
  {
    weight: 5,
    arbitrary: fc
      .record({
        b: fc.constant('bb1'),
        r: fc.integer({ min: 20, max: 62 }),
        c: fc.constantFrom(...'abcdefghij')
      })
      .map((h) => `${h.b}:${h.r}${h.c}`)
  },
  {
    weight: 2,
    arbitrary: fc
      .record({
        b: board,
        r: fc.integer({ min: -2, max: 70 }),
        c: fc.constantFrom(...'abcdefghijk')
      })
      .map((h) => `${h.b}:${h.r}${h.c}`)
  },
  {
    weight: 1,
    arbitrary: fc
      .record({
        b: board,
        rail: fc.constantFrom('top+', 'top-', 'bottom+', 'bottom-', 'side+'),
        i: fc.integer({ min: -1, max: 55 })
      })
      .map((h) => `${h.b}:${h.rail}.${h.i}`)
  },
  { weight: 1, arbitrary: fc.string() }
)
const at = fc.oneof(
  { weight: 3, arbitrary: fc.constant('auto') },
  { weight: 5, arbitrary: holeText }
)
const ref = fc.constantFrom('R1', 'R2', 'D1', 'Q1', 'U1', 'HC1', 'SV1', 'Z9', '', 'R 1')
const propValue = fc.oneof(
  fc.integer({ min: -5, max: 5_000_000 }),
  fc.string(),
  fc.boolean(),
  fc.double()
)
const props = fc.array(
  fc.record({
    name: fc.constantFrom('resistance', 'tolerance', 'color', 'size', 'distanceCm', 'nope'),
    value: propValue
  }),
  { maxLength: 3 }
)
const orientation = fc.constantFrom(0, 0, 90, 180, 270, 45)
const net = fc.constantFrom('GND', '3V3', '5V', 'GPIO17', 'GPIO4', 'GPIO27', 'GPIO99')
const endpoint = fc.oneof(
  fc.record({ hole: holeText }),
  fc.record({
    partPin: fc.record({
      ref,
      pin: fc.constantFrom('1', '2', 'A', 'K', 'VCC', 'TRIG', 'ECHO', 'GND', 'X')
    })
  }),
  fc.record({ net })
)
const wireId = fc.constantFrom('W1', 'W2', 'W3', 'W9')
const kind = fc.constantFrom(
  'dupont-mm',
  'dupont-mf',
  'dupont-ff',
  'solid-arc',
  'solid-flat',
  'rope'
)
const maybe = <T>(a: fc.Arbitrary<T>) => fc.option(a, { nil: undefined })

const plausible: Record<string, fc.Arbitrary<unknown>> = {
  get_circuit_state: fc.record({
    detail: fc.constantFrom('summary', 'full', 'x'),
    since: maybe(fc.integer({ min: -1, max: 12 }))
  }),
  search_parts: fc.record({
    query: fc.constantFrom('led', 'resistor', 'ultra', '', 'zzz', 'transistor npn', '   ')
  }),
  define_custom_part: fc.record({
    template: fc.constantFrom('2-lead', 'TO-92', 'DIP', 'SIP-header', 'module-with-header', 'blob'),
    name: fc.constantFrom('Chip', 'Sensor board', '', '!!!'),
    pins: fc.array(
      fc.record({
        id: fc.constantFrom('1', '2', '3', '4', 'A', 'bad id'),
        label: fc.constant('L'),
        role: fc.constantFrom('passive', 'logic-io', 'power', 'ground', 'nope'),
        electricalType: fc.constantFrom('passive', 'bidirectional', 'input'),
        connector: fc.constantFrom('none', 'male-pin', 'female-socket')
      }),
      { maxLength: 8 }
    ),
    internalConnections: fc.constantFrom([], [['1', '2']], [['1', '9']], [['1']]),
    simModel: fc.constantFrom('none', 'led', 'resistor', 'npn'),
    datasheetUrl: maybe(fc.constantFrom('https://example.com/a.pdf', 'not a url'))
  }),
  add_board: fc.record({
    defId: fc.constantFrom('bb-830', 'bb-400', 'bb-1'),
    position: maybe(fc.record({ x: fc.double({ noNaN: true }), y: fc.integer() }))
  }),
  place_tboard: fc.record({
    board,
    pin1Row: fc.integer({ min: -3, max: 70 }),
    colPair: fc.constantFrom('b/f', 'c/g', 'd/h', 'e/i', 'a/e'),
    orientation: fc.constantFrom('header-toward-row-0', 'header-toward-last-row', 'sideways')
  }),
  place_part: fc.record({
    defId: fc.constantFrom(
      'resistor',
      'led',
      'pn2222',
      'ic-74hc595',
      'hc-sr04',
      'tact-switch-6mm',
      'seven-segment-cc',
      'sg90',
      'custom-chip',
      'nope'
    ),
    at,
    orientation,
    props,
    ref: maybe(ref),
    span: maybe(fc.integer({ min: -3, max: 20 })),
    near: maybe(fc.constantFrom('GND', 'GPIO17', 'R1', 'nope'))
  }),
  move_part: fc.record({ ref, at, orientation, span: maybe(fc.integer({ min: -3, max: 20 })) }),
  remove_part: fc.record({ ref }),
  set_part_props: fc.record({ ref, props }),
  connect: fc.record({
    from: endpoint,
    to: endpoint,
    kind: maybe(kind),
    color: maybe(fc.constantFrom('red', 'green', '')),
    lengthMm: maybe(fc.oneof(fc.integer({ min: -5, max: 400 }), fc.double({ noNaN: true })))
  }),
  set_wire_props: fc.record({
    id: wireId,
    kind: maybe(kind),
    color: maybe(fc.constant('blue')),
    lengthMm: maybe(fc.oneof(fc.integer({ min: -5, max: 400 }), fc.double({ noNaN: true }))),
    heightMm: maybe(fc.integer({ min: -2, max: 30 }))
  }),
  remove_wire: fc.record({ id: wireId }),
  run_erc: fc.constant({}),
  simulate: fc.record({
    mode: fc.constantFrom('op', 'transient'),
    durationMs: fc.integer({ min: -5, max: 300 }),
    stimulus: fc.record({
      gpio: fc.array(
        fc.record({
          pin: fc.integer({ min: -2, max: 30 }),
          level: fc.constantFrom('high', 'low', 'pwm'),
          freqHz: fc.constantFrom(0, 100, 1000),
          duty: fc.constantFrom(0, 0.5, 2)
        }),
        { maxLength: 2 }
      ),
      inputs: fc.array(
        fc.record({
          part: ref,
          key: fc.constantFrom('pressed', 'distanceCm', 'x'),
          value: propValue
        }),
        { maxLength: 2 }
      )
    })
  }),
  write_code: fc.record({
    library: fc.constantFrom('gpiozero', 'RPi.GPIO', 'pigpio'),
    source: fc.constantFrom(
      '',
      'from gpiozero import LED\nled = LED(17)\n',
      'GPIO.setup(99, GPIO.OUT)',
      'def (:'
    )
  }),
  run_code_in_sim: fc.record({ seconds: fc.constantFrom(-1, 0, 1, 5, 60, 61) }),
  capture_view: fc.record({ preset: fc.constantFrom('top', 'iso', 'side') }),
  read_board_sense: fc.constant({}),
  focus: fc.record({ refs: fc.array(ref, { maxLength: 3 }), note: maybe(fc.string()) }),
  highlight: fc.record({
    refs: fc.array(fc.oneof(ref, holeText), { maxLength: 3 }),
    note: fc.string()
  }),
  annotate_build_steps: fc.record({
    annotations: fc.array(fc.record({ step: ref, why: fc.string(), mistake: fc.string() }), {
      maxLength: 2
    })
  }),
  ask_user: fc.record({ question: fc.string(), options: fc.array(fc.string(), { maxLength: 3 }) })
}

const NAMES = TOOLS.map((t) => t.name)
/** Breaks a valid input: a leaf replaced, a key dropped, one added, or a type swapped. */
const corrupted = fc
  .tuple(
    fc.constantFrom(...NAMES),
    fc.jsonValue(),
    fc.nat(),
    fc.constantFrom('replace', 'drop', 'add')
  )
  .map(([name, junk, n, how]) => {
    const input = structuredClone(VALID_INPUT[name]) as Record<string, unknown>
    const keys = Object.keys(input)
    if (how === 'add' || !keys.length) input[`extra${n}`] = junk
    else if (how === 'drop') delete input[keys[n % keys.length]!]
    else input[keys[n % keys.length]!] = junk
    return { name, input: input as unknown }
  })
const wild = fc
  .tuple(fc.constantFrom(...NAMES), fc.jsonValue())
  .map(([name, input]) => ({ name, input }))
const sane = fc
  .constantFrom(...NAMES)
  .chain((name) => plausible[name]!.map((input) => ({ name, input })))

/** Mostly valid calls, so sequences get far enough to build something. */
const goodHole = fc
  .record({ r: fc.integer({ min: 24, max: 58 }), c: fc.constantFrom(...'abcdefghij') })
  .map((h) => `bb1:${h.r}${h.c}`)
const goodPin = fc.constantFrom(
  { ref: 'R1', pin: '1' },
  { ref: 'R1', pin: '2' },
  { ref: 'R2', pin: '1' },
  { ref: 'D1', pin: 'A' },
  { ref: 'D1', pin: 'K' },
  { ref: 'HC1', pin: 'VCC' },
  { ref: 'HC1', pin: 'TRIG' }
)
const goodEnd = fc.oneof(
  fc.record({ net: fc.constantFrom('GND', '3V3', '5V', 'GPIO17', 'GPIO4', 'GPIO27') }),
  fc.record({ partPin: goodPin }),
  fc.record({ hole: goodHole })
)
const good = fc.oneof(
  fc.record({
    name: fc.constant('place_part'),
    input: fc.record({
      defId: fc.constantFrom(
        'resistor',
        'resistor',
        'led',
        'led',
        'pn2222',
        'hc-sr04',
        'tact-switch-6mm'
      ),
      at: fc.oneof(fc.constant('auto'), goodHole),
      orientation: fc.constant(0),
      props: fc.constant([])
    })
  }),
  fc.record({
    name: fc.constant('connect'),
    input: fc.record({ from: goodEnd, to: goodEnd })
  }),
  fc.record({
    name: fc.constant('set_part_props'),
    input: fc.record({
      ref: fc.constantFrom('R1', 'R2', 'D1'),
      props: fc.constantFrom(
        [{ name: 'resistance', value: 1000 }],
        [{ name: 'color', value: 'blue' }]
      )
    })
  }),
  fc.record({
    name: fc.constant('move_part'),
    input: fc.record({
      ref: fc.constantFrom('R1', 'D1'),
      at: goodHole,
      orientation: fc.constant(0)
    })
  }),
  fc.record({
    name: fc.constantFrom('remove_part'),
    input: fc.record({ ref: fc.constantFrom('R1', 'D1', 'HC1') })
  }),
  fc.record({
    name: fc.constant('set_wire_props'),
    input: fc.record({ id: fc.constantFrom('W1', 'W2'), color: fc.constant('green') })
  }),
  fc.record({
    name: fc.constant('remove_wire'),
    input: fc.record({ id: fc.constantFrom('W1', 'W2', 'W3') })
  }),
  fc.record({
    name: fc.constant('write_code'),
    input: fc.record({
      library: fc.constant('gpiozero'),
      source: fc.constant('from gpiozero import LED\nled = LED(17)\n')
    })
  })
)

const callArb = fc.oneof(
  { weight: 7, arbitrary: good },
  { weight: 4, arbitrary: sane },
  { weight: 2, arbitrary: corrupted },
  { weight: 1, arbitrary: wild }
)

// --- Invariants ---

function assertSound(ctx: FakeContext) {
  const doc = ctx.getSnapshot()
  expect(validateDoc(doc, ctx.partDef)).toEqual([])
  for (const part of doc.parts) {
    const def = ctx.partDef(part.defId)
    for (const [name, value] of Object.entries(part.props))
      expect(
        'error' in mergeProps(def, {}, [{ name, value: value as string }]),
        `${part.id}.${name}`
      ).toBe(false)
  }
  for (const wire of doc.wires) {
    expect(
      typeof wire.lengthMm === 'number' && wire.lengthMm > 0 && Number.isFinite(wire.lengthMm)
    ).toBe(true)
  }
}

describe('fuzz: tool input', () => {
  let accepted = 0
  let refused = 0
  let committed = 0

  it('never throws, never leaves the document invalid, and a refused call changes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(callArb, { minLength: 1, maxLength: 22 }), async (calls) => {
        const ctx = new FakeContext()
        const turnId = 'turn-fuzz'
        for (const { name, input } of calls) {
          const before = ctx.getSnapshot()
          const result = await call(ctx, name, input, { turnId })
          expect(result.output.content).toBeDefined()
          const mutated = ctx.getSnapshot() !== before
          if (result.isError) {
            refused += 1
            expect(mutated, `${name} was refused but changed the document`).toBe(false)
            expect(result.output.committed ?? []).toEqual([])
          } else {
            accepted += 1
            if (mutated) committed += 1
            expect(mutated, name).toBe(!!result.output.committed?.length)
          }
          assertSound(ctx)
        }
        // Every transaction the tools committed belongs to the turn, so one undo takes them all.
        ctx.undoTurn(turnId)
        expect(ctx.getSnapshot().parts).toHaveLength(0)
        expect(ctx.getSnapshot().wires).toHaveLength(0)
        expect(ctx.getSnapshot().meta.revision).toBe(0)
      }),
      { numRuns: 150 }
    )
    // The generators must reach the accepting paths as well as the refusing ones.
    expect(accepted).toBeGreaterThan(200)
    expect(committed).toBeGreaterThan(100)
    expect(refused).toBeGreaterThan(300)
  })

  it('answers truly arbitrary JSON for every tool without throwing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...NAMES), fc.jsonValue(), async (name, input) => {
        const ctx = new FakeContext()
        const before = ctx.getSnapshot()
        await call(ctx, name, input)
        assertSound(ctx)
        // A document is only ever replaced by a validated one.
        expect(ctx.getSnapshot().meta.revision).toBeGreaterThanOrEqual(before.meta.revision)
      }),
      { numRuns: 300 }
    )
  })
})

describe('fuzz: streamed input through the loop', () => {
  /** A raw tool input: valid, cut short, or garbage. */
  const raw = fc.oneof(
    sane.map(({ input }) => JSON.stringify(input)),
    fc.tuple(sane, fc.nat()).map(([{ input }, n]) => {
      const s = JSON.stringify(input)
      return s.slice(0, n % (s.length + 1))
    }),
    fc.jsonValue().map((v) => JSON.stringify(v)),
    fc.string()
  )

  it('turns every bad input into a tool_result and keeps going', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ name: fc.constantFrom(...NAMES, 'not_a_tool'), raw }), {
          minLength: 1,
          maxLength: 6
        }),
        fc.integer({ min: 1, max: 30 }),
        async (calls, chunk) => {
          const ctx = new FakeContext()
          const blocks = calls.map((c, i) => toolUse(`toolu_${i}`, c.name, c.raw, chunk))
          const script: Reply[] = [
            { blocks: [text('Working.'), ...blocks], stop: 'tool_use' },
            { blocks: [text('Done.')], stop: 'end_turn' }
          ]
          const served = scriptedFetch(script, chunk + 3)
          const session = new AssistantSession({ client: testClient(served.fetch), ctx })
          const result = await session.runTurn('go')
          expect(result.reason).toBe('end_turn')
          assertSound(ctx)
          const sent = served.requests[1]!.body.messages as Anthropic.MessageParam[]
          const results = sent.at(-1)!.content as Anthropic.ToolResultBlockParam[]
          expect(results.map((r) => r.tool_use_id)).toEqual(calls.map((_, i) => `toolu_${i}`))
          // An error carries its reason as text; a success is text, or an image block.
          for (const r of results)
            expect(
              r.is_error === true
                ? typeof r.content === 'string'
                : typeof r.content === 'string' || Array.isArray(r.content)
            ).toBe(true)
        }
      ),
      { numRuns: 120 }
    )
  })
})
