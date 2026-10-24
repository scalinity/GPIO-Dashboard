import { describe, expect, it } from 'vitest'
import { buildSteps } from '../../core/steps/steps'
import { RevisionMemory } from './types'
import { call } from '../testing/call'
import { FakeContext } from '../testing/fakeContext'
import { VALID_INPUT } from '../testing/samples'

const place = (ctx: FakeContext, defId: string, at = 'auto', extra: object = {}) =>
  call(ctx, 'place_part', { defId, at, orientation: 0, props: [], ...extra })

const parts = (ctx: FakeContext) => ctx.getSnapshot().parts.map((p) => p.id)

describe('get_circuit_state', () => {
  it('reads an empty project: free rows past the T-board, and the T-board', async () => {
    const ctx = new FakeContext()
    const { text } = await call(ctx, 'get_circuit_state', { detail: 'summary' })
    expect(text).toMatch(
      /^Revision 0: 1 board\(s\), 0 part\(s\), 0 wire\(s\)\. ERC: 0 error\(s\), 0 warning\(s\)\.\n/
    )
    expect(text).toContain('"freeRows":[[24,63]]')
    expect(text).toContain('"colPair":"d/h"')
  })

  it('full adds the T-board pin map and the code', async () => {
    const ctx = new FakeContext()
    const { json } = await call(ctx, 'get_circuit_state', { detail: 'full' })
    expect(json).toMatchObject({ tboard: { pins: { 1: 'bb1:1d 3V3', 11: 'bb1:6d GPIO17' } } })
  })

  it('reports only what changed since a revision it remembers', async () => {
    const ctx = new FakeContext()
    const revisions = new RevisionMemory()
    await call(ctx, 'get_circuit_state', { detail: 'summary' }, { revisions })
    await call(
      ctx,
      'place_part',
      { defId: 'resistor', at: 'bb1:30b', orientation: 0, props: [] },
      { revisions }
    )
    const { text } = await call(
      ctx,
      'get_circuit_state',
      { detail: 'summary', since: 0 },
      { revisions }
    )
    expect(text).toContain('Changes from revision 0 to 1')
    expect(text).toContain('PartPlaced R1')
    expect(text).toContain('HoleOccupied bb1:30b part:R1.1')
    expect(text).not.toContain('"freeRows"')
    const same = await call(
      ctx,
      'get_circuit_state',
      { detail: 'summary', since: 1 },
      { revisions }
    )
    expect(same.text).toBe('No changes since revision 1.')
  })

  it('falls back to the full state for a revision it does not know', async () => {
    const ctx = new FakeContext()
    const { text } = await call(ctx, 'get_circuit_state', { detail: 'summary', since: 41 })
    expect(text).toContain('Revision 41 is no longer remembered')
    expect(text).toContain('"freeRows"')
  })
})

describe('search_parts', () => {
  it('finds parts with inventory status, pins and a datasheet', async () => {
    const { json } = await call(new FakeContext(), 'search_parts', { query: 'led' })
    const found = json as { id: string; inInventory: boolean; pins: unknown[]; datasheet: string }[]
    expect(found[0]).toMatchObject({ id: 'led', inInventory: true })
    expect(found[0]!.pins).toHaveLength(2)
    expect(found[0]!.datasheet).toMatch(/^https:/)
  })

  it('lists inventory parts first, and matches several words', async () => {
    const ctx = new FakeContext()
    const { json } = await call(ctx, 'search_parts', { query: 'led segment' })
    const found = json as { id: string; name: string }[]
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((p) => /segment/i.test(`${p.id} ${p.name}`))).toBe(true)
    const any = (await call(ctx, 'search_parts', { query: 'buzzer' })).json as {
      id: string
      inInventory: boolean
    }[]
    expect(any[0]).toMatchObject({ id: 'active-buzzer', inInventory: true })
  })

  it('answers with an error when nothing matches, and lists everything for ""', async () => {
    const ctx = new FakeContext()
    expect((await call(ctx, 'search_parts', { query: 'flux capacitor' })).isError).toBe(true)
    const all = (await call(ctx, 'search_parts', { query: '' })).json as unknown[]
    expect(all.length).toBeGreaterThan(30)
  })
})

describe('define_custom_part', () => {
  const pins = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: String(i + 1),
      label: `P${i + 1}`,
      role: 'logic-io',
      electricalType: 'bidirectional',
      connector: 'none'
    }))

  it('defines a DIP that straddles the trench and can then be placed', async () => {
    const ctx = new FakeContext()
    const made = await call(ctx, 'define_custom_part', {
      template: 'DIP',
      name: 'Eight pin chip',
      pins: pins(8),
      internalConnections: [],
      simModel: 'none',
      datasheetUrl: 'https://example.com/chip.pdf'
    })
    expect(made.isError).toBe(false)
    expect(made.json).toMatchObject({
      id: 'custom-eight-pin-chip',
      footprint: { kind: 'rigid', straddleTrench: true }
    })
    expect(ctx.partDefs().some((d) => d.id === 'custom-eight-pin-chip')).toBe(true)
    const placed = await place(ctx, 'custom-eight-pin-chip')
    expect(placed.isError).toBe(false)
    expect(placed.json).toMatchObject({ ref: 'U1' })
  })

  it('tags a part without a datasheet and ERC says so', async () => {
    const ctx = new FakeContext()
    await call(ctx, 'define_custom_part', {
      template: '2-lead',
      name: 'Mystery',
      pins: pins(2),
      internalConnections: [],
      simModel: 'none'
    })
    expect(ctx.custom.get('custom-mystery')!.kitTags).toContain('no datasheet')
    await place(ctx, 'custom-mystery')
    const erc = (await call(ctx, 'run_erc', {})).json as {
      info: number
      issues: { code: string }[]
    }
    expect(erc.issues.map((i) => i.code)).toContain('PART_WITHOUT_DATASHEET')
  })

  it('gives each new part of the same name its own id', async () => {
    const ctx = new FakeContext()
    const input = {
      template: 'TO-92',
      name: 'Twin',
      pins: pins(3),
      internalConnections: [],
      simModel: 'none'
    }
    await call(ctx, 'define_custom_part', input)
    const second = await call(ctx, 'define_custom_part', input)
    expect(second.json).toMatchObject({ id: 'custom-twin-2' })
  })

  it('defines an off-board module that needs connector genders', async () => {
    const ctx = new FakeContext()
    const module = (connector: string) => ({
      template: 'module-with-header',
      name: 'Sensor board',
      pins: pins(4).map((p) => ({ ...p, connector })),
      internalConnections: [],
      simModel: 'none'
    })
    expect((await call(ctx, 'define_custom_part', module('none'))).isError).toBe(true)
    expect((await call(ctx, 'define_custom_part', module('male-pin'))).isError).toBe(false)
    expect((await place(ctx, 'custom-sensor-board')).json).toMatchObject({
      pins: { '1': { hole: 'off-board' } }
    })
  })

  it('rejects the wrong pin count, a connector on a board part and a bad internal group', async () => {
    const ctx = new FakeContext()
    const base = {
      template: 'DIP',
      name: 'Bad',
      pins: pins(7),
      internalConnections: [],
      simModel: 'none'
    }
    expect(JSON.stringify((await call(ctx, 'define_custom_part', base)).json)).toContain(
      'cannot have 7 pins'
    )
    const withConnector = { ...base, pins: pins(8).map((p) => ({ ...p, connector: 'male-pin' })) }
    expect((await call(ctx, 'define_custom_part', withConnector)).isError).toBe(true)
    const group = { ...base, pins: pins(8), internalConnections: [['1', '9']] }
    expect(JSON.stringify((await call(ctx, 'define_custom_part', group)).json)).toContain(
      'unknown pin 9'
    )
    expect(ctx.custom.size).toBe(0)
  })
})

describe('place_part', () => {
  it('places by name with defaults filled in, and says what each pin touches', async () => {
    const ctx = new FakeContext()
    const { json, output } = await place(ctx, 'resistor', 'bb1:30b', {
      props: [{ name: 'resistance', value: 470 }],
      span: 4
    })
    expect(json).toMatchObject({
      ref: 'R1',
      pins: { '1': { hole: 'bb1:30b' }, '2': { hole: 'bb1:34b' } }
    })
    expect(
      (json as { pins: Record<string, { freeInStrip: string[] }> }).pins['1']!.freeInStrip
    ).toEqual(['bb1:30a', 'bb1:30c', 'bb1:30d', 'bb1:30e'])
    expect(ctx.getSnapshot().parts[0]!.props).toEqual({ resistance: 470, tolerance: '5%' })
    expect(output.committed).toHaveLength(1)
  })

  it('warns when a pin shares a strip with something', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor', 'bb1:30b', { span: 4 })
    const led = await place(ctx, 'led', 'bb1:34c', { span: 1 })
    expect(JSON.stringify(led.json)).toContain('D1.A shares its strip with R1.2')
  })

  it('refuses with a reason the model can act on', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor', 'bb1:30b', { span: 4 })
    const cases: [object, RegExp][] = [
      [{ defId: 'flux' }, /UNKNOWN_PART/],
      [{ props: [{ name: 'nope', value: 1 }] }, /no property nope.*resistance, tolerance/],
      [{ props: [{ name: 'resistance', value: -5 }] }, /between 1 and 4700000/],
      [{ props: [{ name: 'tolerance', value: '9%' }] }, /one of 5%, 1%/],
      [{ ref: 'R1' }, /REF_TAKEN/],
      [{ ref: '9x' }, /BAD_REF/],
      [{ at: 'bb1:30b' }, /REJECTED.*HOLE_TAKEN/],
      [{ at: 'bb1:99z' }, /INVALID_INPUT/],
      [{ at: 'bb1:30b', span: 99 }, /BAD_PLACEMENT/],
      [{ at: 'bb1:top+.1' }, /BAD_PLACEMENT/],
      [{ at: 'bb9:30b' }, /BAD_PLACEMENT.*bb9/],
      [{ at: 'bb1:2d' }, /REJECTED/]
    ]
    for (const [override, expected] of cases) {
      const before = ctx.getSnapshot()
      const result = await call(ctx, 'place_part', {
        defId: 'resistor',
        at: 'bb1:40b',
        orientation: 0,
        props: [],
        ...override
      })
      expect(result.isError, JSON.stringify(override)).toBe(true)
      expect(result.text, JSON.stringify(override)).toMatch(expected)
      expect(ctx.getSnapshot(), JSON.stringify(override)).toBe(before)
    }
  })

  it('auto places beside what is there, near a net, and tells you when it is full', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor')
    await place(ctx, 'resistor', 'auto', { near: 'GND' })
    expect(parts(ctx)).toEqual(['R1', 'R2'])
    const holes = ctx.getSnapshot().parts.flatMap((p) => Object.values(p.placement.pins))
    expect(new Set(holes.map((h) => JSON.stringify(h))).size).toBe(4)
    // Fill the board: the 40th resistor can not fit.
    let last = await place(ctx, 'resistor')
    for (let i = 0; i < 40 && !last.isError; i++) last = await place(ctx, 'resistor')
    expect(last.text).toMatch(/NO_ROOM.*add_board/)
  })

  it('assigns refs by kind', async () => {
    const ctx = new FakeContext()
    for (const id of ['led', 'resistor', 'pn2222', 'ic-74hc595', 'tact-switch-6mm', 'led'])
      await place(ctx, id)
    expect(parts(ctx)).toEqual(['D1', 'R1', 'Q1', 'U1', 'SW1', 'D2'])
  })
})

describe('move_part, remove_part, set_part_props', () => {
  it('moves a part and names the leads it left behind', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor', 'bb1:30b', { span: 4 })
    await call(ctx, 'connect', { from: { net: 'GND' }, to: { partPin: { ref: 'R1', pin: '1' } } })
    const moved = await call(ctx, 'move_part', { ref: 'R1', at: 'bb1:40b', orientation: 0 })
    expect(moved.json).toMatchObject({
      pins: { '1': { hole: 'bb1:40b' }, '2': { hole: 'bb1:44b' } },
      leadsLeftBehind: ['W1']
    })
    expect(
      (await call(ctx, 'move_part', { ref: 'R9', at: 'auto', orientation: 0 })).text
    ).toContain('NO_SUCH_PART')
    const auto = await call(ctx, 'move_part', { ref: 'R1', at: 'auto', orientation: 0 })
    expect(auto.isError).toBe(false)
  })

  it('removes a part, and the leads on an off-board module with it', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'hc-sr04')
    await call(ctx, 'connect', { from: { net: '5V' }, to: { partPin: { ref: 'HC1', pin: 'VCC' } } })
    const removed = await call(ctx, 'remove_part', { ref: 'HC1' })
    expect(removed.json).toMatchObject({ removed: 'HC1', removedLeads: ['W1'] })
    expect(ctx.getSnapshot().wires).toHaveLength(0)
    expect((await call(ctx, 'remove_part', { ref: 'HC1' })).isError).toBe(true)
  })

  it('changes properties and checks them against the part', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'led')
    const ok = await call(ctx, 'set_part_props', {
      ref: 'D1',
      props: [{ name: 'color', value: 'green' }]
    })
    expect(ok.json).toEqual({ ref: 'D1', props: { color: 'green', size: '5mm' } })
    expect(
      (await call(ctx, 'set_part_props', { ref: 'D1', props: [{ name: 'color', value: 'plaid' }] }))
        .isError
    ).toBe(true)
    expect((await call(ctx, 'set_part_props', { ref: 'D2', props: [] })).isError).toBe(true)
    expect(ctx.getSnapshot().parts[0]!.props.color).toBe('green')
  })
})

describe('connect', () => {
  it('joins a net to a part pin from the T-board strip and says which net it made', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor', 'bb1:30b', { span: 4 })
    const { json } = await call(ctx, 'connect', {
      from: { net: 'GPIO17' },
      to: { partPin: { ref: 'R1', pin: '1' } }
    })
    expect(json).toMatchObject({
      wire: {
        id: 'W1',
        kind: 'dupont-mm',
        color: 'yellow',
        lengthMm: 200,
        a: 'bb1:6a',
        b: 'bb1:30a'
      },
      net: 'GPIO17'
    })
  })

  it('uses a male-female lead for a module header and male-male into a socket', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'hc-sr04')
    const trig = await call(ctx, 'connect', {
      from: { net: 'GPIO23' },
      to: { partPin: { ref: 'HC1', pin: 'TRIG' } }
    })
    expect(trig.json).toMatchObject({ wire: { kind: 'dupont-mf', b: 'HC1.TRIG' } })
    await place(ctx, 'sg90')
    const socket = ctx.partDef('sg90').pins.find((p) => p.connector === 'female-socket')
    if (socket) {
      const lead = await call(ctx, 'connect', {
        from: { net: '5V' },
        to: { partPin: { ref: 'SV1', pin: socket.id } }
      })
      expect(lead.json).toMatchObject({ wire: { kind: 'dupont-mm' } })
    }
  })

  it('takes rail holes and exact holes, and picks free holes when told to', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor', 'bb1:30b', { span: 4 })
    const rail = await call(ctx, 'connect', { from: { net: 'GND' }, to: { hole: 'bb1:top-.3' } })
    expect(rail.json).toMatchObject({ wire: { kind: 'dupont-mm', color: 'black' } })
    const exact = await call(ctx, 'connect', {
      from: { hole: 'bb1:50a' },
      to: { partPin: { ref: 'R1', pin: '2' } },
      color: 'blue'
    })
    expect(exact.json).toMatchObject({ wire: { color: 'blue', a: 'bb1:50a' } })
  })

  it('explains each way it can fail, and changes nothing', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor', 'bb1:30b', { span: 4 })
    const cases: [object, RegExp][] = [
      [{ from: { net: 'GND' }, to: { net: '3V3' } }, /short/],
      [{ from: { net: 'GND' }, to: { partPin: { ref: 'R9', pin: '1' } } }, /No part R9/],
      [{ from: { net: 'GND' }, to: { partPin: { ref: 'R1', pin: 'X' } } }, /no pin X/],
      [{ from: { hole: 'bb1:30b' }, to: { net: 'GND' } }, /taken/],
      [{ from: { hole: 'bb1:30a' }, to: { hole: 'bb1:30c' } }, /same strip/],
      [
        { from: { net: 'GND' }, to: { partPin: { ref: 'R1', pin: '1' } }, kind: 'dupont-mf' },
        /GENDER/
      ],
      [{ from: { net: 'GND' }, to: { partPin: { ref: 'R1', pin: '1' } }, lengthMm: -3 }, /LENGTH/],
      [{ from: { net: 'GPIO99' }, to: { hole: 'bb1:50a' } }, /INVALID_INPUT/]
    ]
    for (const [input, expected] of cases) {
      const before = ctx.getSnapshot()
      const result = await call(ctx, 'connect', input)
      expect(result.isError, JSON.stringify(input)).toBe(true)
      expect(result.text, JSON.stringify(input)).toMatch(expected)
      expect(ctx.getSnapshot(), JSON.stringify(input)).toBe(before)
    }
  })

  it('warns when a lead is too short to reach', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor', 'bb1:55b', { span: 4 })
    const lead = await call(ctx, 'connect', {
      from: { net: 'GPIO4' },
      to: { partPin: { ref: 'R1', pin: '1' } },
      lengthMm: 30
    })
    expect((lead.json as { warning: string }).warning).toMatch(/needs about \d+ mm/)
  })

  it('edits and removes leads', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor', 'bb1:30b', { span: 4 })
    await call(ctx, 'connect', { from: { net: 'GND' }, to: { partPin: { ref: 'R1', pin: '1' } } })
    const edited = await call(ctx, 'set_wire_props', { id: 'W1', color: 'green', heightMm: 12 })
    expect(edited.json).toEqual({ id: 'W1', color: 'green', heightMm: 12 })
    expect((await call(ctx, 'set_wire_props', { id: 'W1' })).text).toContain('NOTHING_TO_CHANGE')
    expect((await call(ctx, 'set_wire_props', { id: 'W1', kind: 'dupont-ff' })).text).toContain(
      'GENDER'
    )
    expect((await call(ctx, 'remove_wire', { id: 'W9' })).isError).toBe(true)
    expect((await call(ctx, 'remove_wire', { id: 'W1' })).isError).toBe(false)
    expect(ctx.getSnapshot().wires).toHaveLength(0)
  })
})

describe('add_board and place_tboard', () => {
  it('adds a board beside the first and then places parts on it', async () => {
    const ctx = new FakeContext()
    const added = await call(ctx, 'add_board', { defId: 'bb-400' })
    expect(added.json).toMatchObject({ board: 'bb2', defId: 'bb-400' })
    const placed = await place(ctx, 'resistor', 'bb2:5b', { span: 3 })
    expect(placed.isError).toBe(false)
    expect(
      (await call(ctx, 'add_board', { defId: 'bb-830', position: { x: 10, y: 200 } })).json
    ).toMatchObject({
      board: 'bb3',
      position: [10, 200]
    })
  })

  it('moves the T-board and returns the 40 pin map; a conflict is refused', async () => {
    const ctx = new FakeContext()
    const moved = await call(ctx, 'place_tboard', {
      board: 'bb1',
      pin1Row: 5,
      colPair: 'c/g',
      orientation: 'header-toward-row-0'
    })
    expect((moved.json as { pins: Record<string, string> }).pins['11']).toBe('bb1:10c GPIO17')
    expect(
      (
        await call(ctx, 'place_tboard', {
          board: 'bb1',
          pin1Row: 60,
          colPair: 'd/h',
          orientation: 'header-toward-row-0'
        })
      ).text
    ).toContain('TBOARD_PLACEMENT')
    await place(ctx, 'resistor', 'bb1:40b', { span: 4 })
    const into = await call(ctx, 'place_tboard', {
      board: 'bb1',
      pin1Row: 38,
      colPair: 'b/f',
      orientation: 'header-toward-row-0'
    })
    expect(into.isError).toBe(true)
  })
})

describe('run_erc and simulate', () => {
  async function led(ctx: FakeContext, resistance: number) {
    await place(ctx, 'resistor', 'bb1:30b', {
      span: 4,
      props: [{ name: 'resistance', value: resistance }]
    })
    await place(ctx, 'led', 'bb1:34c', { span: 1 })
    await call(ctx, 'connect', {
      from: { net: 'GPIO17' },
      to: { partPin: { ref: 'R1', pin: '1' } }
    })
    await call(ctx, 'connect', { from: { partPin: { ref: 'D1', pin: 'K' } }, to: { net: 'GND' } })
  }

  it('run_erc counts issues by severity and lists them with fixes', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'led', 'bb1:30b', { span: 1 })
    await call(ctx, 'connect', {
      from: { net: 'GPIO17' },
      to: { partPin: { ref: 'D1', pin: 'A' } }
    })
    await call(ctx, 'connect', { from: { net: 'GND' }, to: { partPin: { ref: 'D1', pin: 'K' } } })
    const erc = (await call(ctx, 'run_erc', {})).json as {
      errors: number
      issues: { code: string; fix: string }[]
    }
    expect(erc.errors).toBeGreaterThan(0)
    expect(erc.issues.map((i) => i.code)).toContain('LED_NO_LIMIT')
    expect(erc.issues.every((i) => i.fix.length > 0)).toBe(true)
  })

  it('simulate quotes currents, and drives GPIOs and part inputs', async () => {
    const ctx = new FakeContext()
    await led(ctx, 220)
    const off = (
      await call(ctx, 'simulate', { mode: 'op', durationMs: 0, stimulus: { gpio: [], inputs: [] } })
    ).json as {
      leds: { mA: number }[]
    }
    expect(off.leds[0]!.mA).toBeLessThan(0.01)
    const on = (
      await call(ctx, 'simulate', {
        mode: 'transient',
        durationMs: 100,
        stimulus: { gpio: [{ pin: 17, level: 'high', freqHz: 0, duty: 0 }], inputs: [] }
      })
    ).json as {
      leds: { mA: number }[]
      resistors: { mA: number; mW: number }[]
      gpio: { pin: string; mA: number }[]
      t: number
    }
    expect(on.t).toBeCloseTo(0.1)
    expect(on.leds[0]!.mA).toBeGreaterThan(3)
    expect(on.resistors[0]!.mA).toBeCloseTo(on.leds[0]!.mA, 1)
    expect(on.gpio.find((g) => g.pin === 'GPIO17')!.mA).toBeGreaterThan(3)
  })

  it('simulate refuses what it can not run', async () => {
    const ctx = new FakeContext()
    await led(ctx, 220)
    const stim = (gpio: object[], inputs: object[] = []) => ({
      mode: 'op',
      durationMs: 0,
      stimulus: { gpio, inputs }
    })
    const cases: [object, RegExp][] = [
      [stim([{ pin: 99, level: 'high', freqHz: 0, duty: 0 }]), /BAD_PIN/],
      [stim([{ pin: 17, level: 'pwm', freqHz: 0, duty: 0.5 }]), /BAD_PWM/],
      [stim([], [{ part: 'R9', key: 'x', value: 1 }]), /NO_SUCH_PART/],
      [stim([], [{ part: 'R1', key: 'pressed', value: true }]), /NO_SUCH_INPUT/],
      [{ ...stim([]), durationMs: 99999999 }, /BAD_DURATION/]
    ]
    for (const [input, expected] of cases)
      expect((await call(ctx, 'simulate', input)).text).toMatch(expected)
  })

  it('simulate reports a pin driven past its limit', async () => {
    const ctx = new FakeContext()
    await led(ctx, 10)
    const sim = (
      await call(ctx, 'simulate', {
        mode: 'op',
        durationMs: 0,
        stimulus: { gpio: [{ pin: 17, level: 'high', freqHz: 0, duty: 0 }], inputs: [] }
      })
    ).json as { issues: { code: string }[] }
    expect(sim.issues.map((i) => i.code)).toContain('PIN_OVERCURRENT')
  })
})

describe('write_code and run_code_in_sim', () => {
  it('stores the code and reports syntax and the cross-check', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor', 'bb1:30b', { span: 4 })
    await call(ctx, 'connect', {
      from: { net: 'GPIO17' },
      to: { partPin: { ref: 'R1', pin: '1' } }
    })
    ctx.diagnostics = [{ line: 2, column: 1, message: 'invalid syntax' }]
    const result = await call(ctx, 'write_code', {
      library: 'RPi.GPIO',
      source: 'import RPi.GPIO as GPIO\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(22, GPIO.OUT)\n'
    })
    expect(result.json).toMatchObject({
      syntax: [{ line: 2, message: 'invalid syntax' }],
      gpioUsed: [{ gpio: 22, mode: 'out' }]
    })
    expect(JSON.stringify(result.json)).toContain('CODE_PIN_MISMATCH')
    expect(ctx.getSnapshot().code.library).toBe('RPi.GPIO')
    expect(result.output.committed).toHaveLength(1)
  })

  it('run_code_in_sim returns stdout and a pin trace, and flags a crash', async () => {
    const ctx = new FakeContext()
    ctx.run = {
      stdout: 'on\n',
      stderr: '',
      error: null,
      events: [{ t: 0.5, bcm: 17, event: 'high' }],
      truncated: false
    }
    const ok = await call(ctx, 'run_code_in_sim', { seconds: 2 })
    expect(ok.json).toMatchObject({ stdout: 'on\n', events: ['0.500 GPIO17 high'], eventCount: 1 })
    ctx.run = { ...ctx.run, error: 'NameError: led' }
    expect((await call(ctx, 'run_code_in_sim', { seconds: 2 })).isError).toBe(true)
    expect((await call(ctx, 'run_code_in_sim', { seconds: 0 })).isError).toBe(true)
    expect((await call(ctx, 'run_code_in_sim', { seconds: 600 })).isError).toBe(true)
  })
})

describe('read_board_sense and the studio tools', () => {
  it('read_board_sense is read only and says when sensing is off', async () => {
    const ctx = new FakeContext()
    const off = (await call(ctx, 'read_board_sense', {})).json as {
      sensingOn: boolean
      note: string
    }
    expect(off).toMatchObject({ sensingOn: false })
    expect(off.note).toMatch(/off/)
    ctx.sense = {
      on: true,
      states: [
        [
          17,
          {
            state: 'diverged',
            kind: 'missing-path',
            detail: 'GPIO17 reads follows-bias, expected tied-high'
          }
        ],
        [18, { state: 'unobserved' }]
      ],
      events: [{ pin: 17, text: 'GPIO17 net lost its path to 3V3' }],
      candidates: {
        17: [
          {
            score: 4,
            of: 4,
            candidates: [
              {
                text: 'a lead end moved one row',
                holes: [{ board: 'bb1', area: 'main', row: 30, col: 'a' }]
              }
            ]
          }
        ]
      }
    }
    const on = (await call(ctx, 'read_board_sense', {})).json as Record<string, unknown>
    expect(on).toMatchObject({
      sensingOn: true,
      nets: [
        { gpio: 'GPIO17', state: 'diverged', kind: 'missing-path' },
        { gpio: 'GPIO18', state: 'unobserved' }
      ],
      events: ['GPIO17 net lost its path to 3V3'],
      candidates: {
        GPIO17: [
          { score: '4/4', causes: [{ text: 'a lead end moved one row', holes: ['bb1:30a'] }] }
        ]
      }
    })
  })

  it('capture_view returns an image block', async () => {
    const ctx = new FakeContext()
    const { output } = await call(ctx, 'capture_view', { preset: 'iso' })
    expect(Array.isArray(output.content) && output.content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png' }
    })
    expect(ctx.views).toEqual(['iso'])
  })

  it('focus and highlight reach the stage and report refs that name nothing', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor')
    expect((await call(ctx, 'focus', { refs: ['R1', 'bb1:30b', 'GND'] })).text).toBe('ok')
    const odd = await call(ctx, 'highlight', { refs: ['R1', 'Q9'], note: 'look' })
    expect(odd.json).toEqual({ ok: true, unknownRefs: ['Q9'] })
    expect(ctx.focusLog[0]!.refs).toEqual(['R1', 'bb1:30b', 'GND'])
    expect(ctx.highlightLog[0]).toEqual({ refs: ['R1', 'Q9'], note: 'look' })
  })

  it('annotate_build_steps accepts steps that exist and names the ones that do not', async () => {
    const ctx = new FakeContext()
    await place(ctx, 'resistor', 'bb1:30b', { span: 4 })
    const steps = buildSteps(ctx.getSnapshot(), ctx.partDef).steps.flatMap((s) => s.refs)
    expect(steps).toContain('R1')
    const ok = await call(ctx, 'annotate_build_steps', {
      annotations: [{ step: 'R1', why: 'limits current', mistake: '' }]
    })
    expect(ok.json).toEqual({ annotated: 1 })
    expect(ctx.annotations).toHaveLength(1)
    const bad = await call(ctx, 'annotate_build_steps', {
      annotations: [{ step: 'Z9', why: 'x', mistake: 'y' }]
    })
    expect(bad.text).toContain('NO_SUCH_STEP')
  })

  it('ask_user waits for the answer', async () => {
    const ctx = new FakeContext()
    ctx.answers = ['A divider']
    const { json } = await call(ctx, 'ask_user', {
      question: 'Divider or level shifter?',
      options: ['A divider', 'A level shifter']
    })
    expect(json).toEqual({ answer: 'A divider' })
    expect(ctx.questions[0]!.options).toHaveLength(2)
  })
})

describe('every tool', () => {
  it('survives a handler that throws, as an internal error', async () => {
    const ctx = new FakeContext()
    ctx.getSnapshot = () => {
      throw new Error('store is gone')
    }
    for (const name of ['get_circuit_state', 'place_part', 'connect', 'run_erc', 'simulate']) {
      const result = await call(ctx, name, VALID_INPUT[name])
      expect(result.isError, name).toBe(true)
      expect(result.text, name).toContain('INTERNAL_ERROR')
    }
  })
})
