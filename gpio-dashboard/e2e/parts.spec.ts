// The parts that move and glow with the simulation (SPEC 10.6), and the D5 regression (every part
// definition draws a body): the potentiometer's shaft follows its slider, the servo's horn its PWM,
// the relay's armature and indicator its coil, the motor's rotor its voltage, the segments the
// 74HC595's outputs, and the LCD1602's screen the characters a program wrote.
import { expect, test } from '@playwright/test'
import type { CircuitDoc } from '../src/renderer/src/core/model/types'
import {
  motion,
  openTutorial,
  report,
  showStudio,
  studio,
  waitUntilStill,
  workbench
} from './helpers'

const simulate = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Simulate' }).click()

test.describe('animated parts', () => {
  test('the Potentiometer slider in Properties drives the circuit and the shaft while a program runs', async ({
    page
  }) => {
    await openTutorial(page, 'potentiometer')
    await simulate(page)
    await page.evaluate(
      "import('/src/state/studioStore.ts').then((m) => m.useStudio.setState({ selection: { kind: 'part', id: 'R1' } }))"
    )
    // The drawer's Sim panel has a slider for the same input; this is Properties' own.
    const slider = page.getByRole('slider', { name: 'Wiper position', exact: true })
    await expect(slider).toBeVisible()
    await slider.fill('80')
    await expect.poll(() => workbench<number>(page, 's.env.R1?.wiper')).toBe(80)
    // 80 % of a 300 degree sweep is 90 degrees past the middle.
    await expect.poll(() => motion(page, 'R1.shaft')).toBeCloseTo(90, 0)
    await slider.fill('20')
    await expect.poll(() => motion(page, 'R1.shaft')).toBeCloseTo(-90, 0)
  })

  test('the servo horn turns with its pulse width', async ({ page }) => {
    await openTutorial(page, 'servo')
    await simulate(page)
    await expect
      .poll(async () => Math.abs((await motion(page, 'SV1.horn')) ?? 0), { timeout: 20_000 })
      .toBeGreaterThan(10)
  })

  test('the relay armature and indicator follow the coil', async ({ page }) => {
    await openTutorial(page, 'relay')
    await simulate(page)
    await expect
      .poll(async () => (await report(page)).sim.lit.K1, { timeout: 20_000 })
      .toContain('lens')
    await expect.poll(() => motion(page, 'K1.armature')).toBeCloseTo(1, 1)
  })

  test('the motor spins while the program drives it', async ({ page }) => {
    await openTutorial(page, 'motor')
    await simulate(page)
    await expect
      .poll(
        async () => {
          const a = await motion(page, 'M1.rotor')
          await page.waitForTimeout(150)
          return a !== (await motion(page, 'M1.rotor'))
        },
        { timeout: 20_000 }
      )
      .toBe(true)
  })

  test('segments light from the 74HC595 outputs', async ({ page }) => {
    await openTutorial(page, 'seven-segment')
    await simulate(page)
    await expect
      .poll(async () => (await report(page)).sim.lit.DS1?.some((n) => n.startsWith('seg-')), {
        timeout: 20_000
      })
      .toBe(true)
  })
})

test('the LCD1602 shows what the program wrote, drawn into its screen', async ({ page }) => {
  await page.goto('/')
  await showStudio(page)
  const code = [
    'import smbus2, time',
    'bus = smbus2.SMBus(1)',
    'def nib(rs, n):',
    '    for en in (4, 0):',
    '        bus.write_byte(0x27, (n << 4) | 8 | en | rs)',
    'def send(b, rs=0):',
    '    nib(rs, b >> 4)',
    '    nib(rs, b & 15)',
    'for n in (3, 3, 3, 2):',
    '    nib(0, n)',
    'for b in (0x28, 0x0C, 0x06, 0x01):',
    '    send(b)',
    'for c in "Hello, Pi":',
    '    send(ord(c), 1)',
    'send(0xC0)',
    'for c in "LCD 1602":',
    '    send(ord(c), 1)',
    'time.sleep(30)'
  ].join('\\n')
  await page.evaluate(`(async () => {
    const { circuit } = await import('/src/state/circuit.ts')
    const { newPart, newWire } = await import('/src/studio/placement.ts')
    const doc = circuit.getSnapshot()
    const lcd = newPart(doc, 'lcd1602-i2c', { pose: { position: [60, 110], rotationDeg: 0 } })
    const at = (row, col) => ({ hole: { board: 'bb1', area: 'main', row, col } })
    const wires = []
    // SDA is GPIO2 (T-board pin 3), SCL GPIO3 (pin 5), VCC 5V (pin 2), GND (pin 6).
    for (const [pin, row, col] of [['SDA', 2, 'a'], ['SCL', 3, 'a'], ['VCC', 1, 'j'], ['GND', 3, 'j']])
      wires.push(newWire({ ...doc, parts: [lcd], wires }, { pin: { part: lcd.id, pin } }, at(row, col)))
    const result = circuit.dispatch({ author: 'user', label: 'LCD', ops: [
      { type: 'AddPart', part: lcd },
      ...wires.map((wire) => ({ type: 'AddWire', wire })),
      { type: 'SetCode', code: { language: 'python', library: 'RPi.GPIO', source: '${code}' } }
    ] })
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
  })()`)
  await expect
    .poll(async () => Object.values((await report(page)).parts).every((p) => p.body))
    .toBe(true)
  await simulate(page)
  await expect
    .poll(async () => (await report(page)).sim.lcd.U1, { timeout: 30_000 })
    .toEqual(['Hello, Pi       ', 'LCD 1602        '])
  // The module draws its characters from a mesh of its own, so its handle has the screen to texture.
  expect(await studio(page, (s) => s.part('U1')?.names.includes('lcd-screen'))).toBe(true)
})

test('every part definition draws a body on the bench or the table (D5)', async ({ page }) => {
  await page.goto('/')
  await showStudio(page)
  const placed = (await page.evaluate(`(async () => {
    const { circuit } = await import('/src/state/circuit.ts')
    const { PART_DEFS } = await import('/src/core/defs/parts.ts')
    const { newPart } = await import('/src/studio/placement.ts')
    const dispatch = (label, ops) => {
      const r = circuit.dispatch({ author: 'user', label, ops })
      if (!r.ok) throw new Error(label + ': ' + JSON.stringify(r.problems))
    }
    // Five more breadboards in front of the bench give the rigid and flexible parts room.
    const boards = [2, 3, 4, 5, 6].map((n) => 'bb' + n)
    dispatch('Boards', boards.map((id, i) => ({ type: 'AddBoard', board: { id, defId: 'bb-830', transform: { position: [0, -70 * (i + 1)], rotationDeg: 0 } } })))
    const ids = []
    let modules = 0
    for (const def of PART_DEFS.values()) {
      let part = null
      if (def.footprint.kind === 'offboard') {
        const k = modules++
        const position = [-420 + (k % 6) * 150, 110 + Math.floor(k / 6) * 100]
        part = newPart(circuit.getSnapshot(), def.id, { pose: { position, rotationDeg: 0 } })
      } else {
        search: for (const board of boards)
          for (let row = 1; row <= 60; row++)
            for (const col of ['a', 'b', 'c', 'd', 'e']) {
              const candidate = newPart(circuit.getSnapshot(), def.id, { anchor: { board, area: 'main', row, col }, rotation: 0 })
              if (Object.values(candidate.placement.pins).some((h) => !h)) continue
              if (!circuit.check({ author: 'user', label: 'try', ops: [{ type: 'AddPart', part: candidate }] }).ok) continue
              part = candidate
              break search
            }
      }
      if (!part) throw new Error('no place for ' + def.id)
      dispatch('Place ' + part.id, [{ type: 'AddPart', part }])
      ids.push([part.id, def.id])
    }
    return ids
  })()`)) as [string, string][]
  expect(placed).toHaveLength(38)
  expect(new Set(placed.map(([, def]) => def)).size).toBe(38)

  await expect
    .poll(
      async () => {
        const parts = (await report(page)).parts
        return placed.filter(([id]) => !parts[id]?.body).map(([, def]) => def)
      },
      { timeout: 60_000 }
    )
    .toEqual([])
  const doc = (await page.evaluate(
    "import('/src/state/circuit.ts').then((m) => m.circuit.getSnapshot())"
  )) as CircuitDoc
  // Twelve are modules on the table, the rest stand in the boards' holes.
  expect(doc.parts.filter((p) => p.placement.offboardPose)).toHaveLength(12)
  await waitUntilStill(page, 30_000)
})
