// The Claude drawer in Chromium (SPEC 11.8, 12; acceptance 5, 7, 11): recorded Messages API streams
// play through the app's own fetch, SDK, loop, tools, store and Studio. A blink build from an
// empty project shows each ghost before its tool input is whole, ends ERC-clean with a review
// strip, and Undo all restores the document deep-equal; Stop keeps what was committed, undoable;
// the bench is read-only while Claude works; the key goes to the Keychain and never comes back; a
// custom part is defined, placed, drawn without a body, saved and reopened.
import { expect, type Page, test } from '@playwright/test'
import {
  BLINK_CODE as BLINK_SCRIPT_CODE,
  BLINK_SCRIPT
} from '../src/renderer/src/assistant/testing/blinkScript'
import { text, toolUse, type Reply } from '../src/renderer/src/assistant/testing/sse'
import type { Ghost } from '../src/renderer/src/assistant/context'
import { appDoc, hanging, installFakeApi, queueReplies, record, sendToClaude } from './assistant'
import { hole, report, showStudio, waitUntilStill, type Point } from './helpers'

const tools = (...blocks: Reply['blocks']): Reply => ({ blocks, stop: 'tool_use' })

// The blink build, with each lead's colour after its ends, as a model writes them: a lead's ghost
// can show once both ends have arrived, before the colour has.
const LEADS = tools(
  toolUse(
    't5',
    'connect',
    { from: { net: 'GPIO17' }, to: { partPin: { ref: 'R1', pin: '1' } }, color: 'yellow' },
    6
  ),
  toolUse(
    't6',
    'connect',
    {
      from: { partPin: { ref: 'R1', pin: '2' } },
      to: { partPin: { ref: 'D1', pin: 'A' } },
      color: 'green'
    },
    6
  ),
  toolUse(
    't7',
    'connect',
    { from: { partPin: { ref: 'D1', pin: 'K' } }, to: { net: 'GND' }, color: 'black' },
    6
  )
)
const BLINK: Reply[] = [BLINK_SCRIPT[0]!, BLINK_SCRIPT[1]!, LEADS, ...BLINK_SCRIPT.slice(3)]

const working = (page: Page) => page.getByRole('status', { name: 'Claude is working' })
const strip = (page: Page) => page.getByRole('region', { name: "Review Claude's changes" })

async function openEmptyStudio(page: Page, options: Parameters<typeof installFakeApi>[1] = {}) {
  await installFakeApi(page, options)
  await page.goto('/')
  await showStudio(page)
  await waitUntilStill(page, 20_000)
}

async function menu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Project' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

async function libraryItem(page: Page, query: string, name: RegExp): Promise<Point> {
  await page.getByLabel('Search parts').fill(query)
  const box = (await page.getByRole('button', { name }).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
}

test.describe('the Claude drawer', () => {
  test('builds a blinking LED from an empty project, ghosts first, and Undo all restores it', async ({
    page
  }) => {
    await openEmptyStudio(page)
    const initial = await appDoc(page)
    expect(initial.parts).toEqual([])
    await queueReplies(page, BLINK.map(record))
    // Every time the ghosts change, note the ones the Studio draws while their call's input is
    // still arriving. The Studio's own listener has already redrawn by then.
    await page.evaluate(async () => {
      const [{ useStudio }, { useAssistant }] = await Promise.all([
        import('/src/state/studioStore.ts' as string),
        import('/src/state/assistantStore.ts' as string)
      ])
      const w = window as unknown as Record<string, unknown> & {
        __early: Record<string, boolean>
        __studio: { report(): { ghosts: string[] } }
      }
      w.__early = {}
      useStudio.subscribe((s: { ghosts: Record<string, Ghost> }) => {
        const items = useAssistant.getState().items as { id: string; complete?: boolean }[]
        const drawn = w.__studio.report().ghosts
        for (const [id, ghost] of Object.entries(s.ghosts)) {
          const chip = items.find((i) => i.id === id)
          const key = ghost.kind === 'part' ? ghost.ref : `ghost:${id}`
          if (chip && !chip.complete && drawn.includes(key)) w.__early[id] = true
        }
      })
    })

    await sendToClaude(page, 'blink an LED on GPIO17')
    await expect(working(page)).toBeVisible()
    await expect(strip(page)).toContainText('Claude added 2 parts, 3 wires', { timeout: 60_000 })
    await expect(working(page)).toBeHidden()

    // Acceptance 5: each part and lead showed as a ghost before its input was whole.
    const early = await page.evaluate(
      () => (window as unknown as { __early: Record<string, boolean> }).__early
    )
    expect(Object.keys(early).sort()).toEqual(['t3', 't4', 't5', 't6', 't7'])
    expect((await report(page)).ghosts).toEqual([])

    // Chips and compact cards, and the turn's usage and cost.
    await expect(page.getByTestId('tool-chip')).toHaveCount(10)
    await expect(page.getByLabel('ERC result')).toContainText('0 errors')
    await expect(page.getByLabel('Simulation result')).toContainText('mA')
    await expect(page.getByTestId('assistant-usage')).toContainText(/last turn .* \$/)

    // ERC-clean, with what Claude added tinted until it is kept.
    const ercCodes = await page.evaluate(
      `Promise.all([import('/src/state/circuit.ts'), import('/src/core/erc/erc.ts'), import('/src/core/defs/parts.ts')]).then(([c, e, p]) => e.erc(c.circuit.getSnapshot(), p.partDef).filter((i) => i.severity !== 'info').map((i) => i.code))`
    )
    expect(ercCodes).toEqual([])
    const built = await appDoc(page)
    expect(built.parts.map((p) => p.id).sort()).toEqual(['D1', 'R1'])
    expect(built.wires).toHaveLength(3)
    await expect
      .poll(async () => (await report(page)).sim.review.sort())
      .toEqual(['D1', 'R1', ...built.wires.map((w) => w.id)].sort())

    // Acceptance 7: Undo all restores the document the turn started from, deep-equal.
    await strip(page).getByRole('button', { name: 'Undo all' }).click()
    await expect(strip(page)).toBeHidden()
    expect(await appDoc(page)).toEqual(initial)
    await expect.poll(async () => (await report(page)).sim.review).toEqual([])
  })

  test('Stop mid-turn keeps what was committed, and one Undo takes it back', async ({ page }) => {
    await openEmptyStudio(page)
    const initial = await appDoc(page)
    await queueReplies(page, [
      record(BLINK_SCRIPT[0]!),
      record(BLINK_SCRIPT[1]!),
      hanging(LEADS, 14)
    ])
    await sendToClaude(page, 'blink an LED on GPIO17')
    await expect.poll(async () => (await appDoc(page)).parts.length, { timeout: 30_000 }).toBe(2)
    await working(page).getByRole('button', { name: 'Stop' }).click()
    await expect(working(page)).toBeHidden()
    await expect(page.getByText(/^Stopped\. What Claude already built stays/)).toBeVisible()
    await expect(strip(page)).toContainText('Claude added 2 parts, 0 wires')
    // The stopped call's ghost is gone; the committed parts stay.
    expect((await report(page)).ghosts).toEqual([])
    expect((await appDoc(page)).parts.map((p) => p.id).sort()).toEqual(['D1', 'R1'])

    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    expect(await appDoc(page)).toEqual(initial)
    await expect(strip(page)).toBeHidden()
  })

  test('the bench is read-only while Claude works', async ({ page }) => {
    await openEmptyStudio(page)
    await queueReplies(page, [record(BLINK_SCRIPT[1]!), hanging(LEADS, 6)])
    await sendToClaude(page, 'place a resistor and an LED')
    await expect.poll(async () => (await appDoc(page)).parts.length, { timeout: 30_000 }).toBe(2)
    await expect(working(page)).toBeVisible()
    const during = await appDoc(page)

    // Undo is disabled on the top bar, and the key does nothing.
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await page.mouse.click(5, 300)
    await page.keyboard.press('ControlOrMeta+z')
    // A part dragged from the library is not placed, and says why.
    await drag(
      page,
      await libraryItem(page, 'resistor', /^Resistor, 1\/4 W axial/),
      await hole(page, 'bb1:50b')
    )
    await expect(
      page.getByText('Claude is working on the circuit. Stop it to edit by hand.')
    ).toBeVisible()
    // Selecting still works; deleting the selection does not.
    const r1 = during.parts.find((p) => p.id === 'R1')!
    const pin = Object.values(r1.placement.pins)[0]!
    const at = await hole(page, `${pin.board}:${pin.row}${pin.col}`)
    await page.mouse.click(at.x, at.y)
    await page.keyboard.press('Delete')
    expect(await appDoc(page)).toEqual(during)

    // Once stopped, the bench edits again.
    await working(page).getByRole('button', { name: 'Stop' }).click()
    await expect(working(page)).toBeHidden()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await appDoc(page)).parts.length).toBe(0)
  })

  test('the key goes to the Keychain only, and settings persist', async ({ page }) => {
    await openEmptyStudio(page, { hasKey: false })
    const KEY = 'sk-ant-e2e-test-0123456789'
    const keychain = () =>
      page.evaluate(
        () => (window as unknown as { __keychain: { saved: boolean; calls: string[] } }).__keychain
      )
    const settings = () =>
      page.evaluate(() => (window as unknown as { __settings: Record<string, unknown> }).__settings)
    const requests = () =>
      page.evaluate(() => (window as unknown as { __requests: unknown[] }).__requests.length)

    // Without a key, a message asks for one and opens Settings; nothing is sent.
    await sendToClaude(page, 'hello')
    await expect(page.getByText(/Add your Anthropic API key in Settings first/)).toBeVisible()
    const panel = page.getByRole('region', { name: 'Claude settings' })
    await expect(panel).toBeVisible()
    await expect(page.getByTestId('key-status')).toHaveText('No key saved')
    expect(await requests()).toBe(0)

    await panel.getByLabel('API key').fill(KEY)
    await panel.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('key-status')).toHaveText('A key is saved in the macOS Keychain')
    await expect(panel.getByLabel('API key')).toHaveValue('')
    expect((await keychain()).calls).toContain(`set:${KEY}`)
    // Only booleans come back: the key is nowhere in the page or the assistant's state.
    expect(await page.content()).not.toContain(KEY)
    const state = await page.evaluate(
      "import('/src/state/assistantStore.ts').then((m) => JSON.stringify(m.useAssistant.getState()))"
    )
    expect(state).not.toContain(KEY)

    // A key pasted into the chat is refused, not sent.
    await sendToClaude(page, `my key is ${KEY}`)
    await expect(page.getByText(/That looks like an API key/)).toBeVisible()
    expect(await requests()).toBe(0)
    expect(
      await page.evaluate(
        "import('/src/state/assistantStore.ts').then((m) => JSON.stringify(m.useAssistant.getState()))"
      )
    ).not.toContain(KEY)

    // Model, effort and web tools are stored under their settings keys.
    await panel.getByLabel('Model').selectOption('claude-sonnet-5-5')
    await panel.getByLabel('Model').selectOption({ label: 'Another model ID…' })
    await panel.getByLabel('Model ID').fill('claude-experimental-1')
    await panel.getByLabel('Model ID').press('Enter')
    await panel.getByLabel('Effort').selectOption('medium')
    await panel.getByLabel(/Web search and fetch/).uncheck()
    await expect.poll(settings).toEqual({
      'assistant.model': 'claude-experimental-1',
      'assistant.effort': 'medium',
      'assistant.webTools': false
    })
    await expect(page.getByTestId('assistant-usage')).toContainText(
      'claude-experimental-1 · medium'
    )

    await panel.getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByTestId('key-status')).toHaveText('No key saved')
    expect((await keychain()).calls).toContain('clear')
  })

  test('looks at the stage, points at things, and runs the code in its own simulator', async ({
    page
  }) => {
    await openEmptyStudio(page)
    const camera = () =>
      page.evaluate(() => {
        const s = (
          window as unknown as {
            __studio: { camera: { position: { x: number; y: number; z: number } } }
          }
        ).__studio
        return [s.camera.position.x, s.camera.position.y, s.camera.position.z]
      })
    const before = await camera()
    await queueReplies(
      page,
      [
        tools(toolUse('c1', 'capture_view', { preset: 'top' })),
        tools(
          toolUse('c2', 'write_code', { library: 'gpiozero', source: BLINK_SCRIPT_CODE }),
          toolUse('c3', 'run_code_in_sim', { seconds: 2 })
        ),
        tools(
          toolUse('c4', 'focus', { refs: ['bb1:30e'] }),
          toolUse('c5', 'highlight', { refs: ['GPIO17'], note: 'This strip is GPIO17.' })
        ),
        { blocks: [text('Done.')], stop: 'end_turn' }
      ].map(record)
    )
    await sendToClaude(page, 'look at the bench and run the code')
    await expect(strip(page)).toContainText('updated the code', { timeout: 60_000 })

    // capture_view: a PNG of the top view, after which the camera is back where it was.
    const image = page.getByLabel('Captured view').locator('img')
    await expect(image).toBeVisible()
    const png = await image.evaluate((img: HTMLImageElement) => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0)
      const data = g.getImageData(0, 0, c.width, c.height).data
      const shades = new Set<number>()
      for (let i = 0; i < data.length; i += 4 * 97) shades.add(data[i]! >> 4)
      return { width: c.width, height: c.height, shades: shades.size }
    })
    expect(Math.max(png.width, png.height)).toBeLessThanOrEqual(1568)
    expect(png.width).toBeGreaterThan(200)
    // A drawn scene, not a blank canvas.
    expect(png.shades).toBeGreaterThan(3)
    // focus moved the camera after the capture put it back.
    expect(await camera()).not.toEqual(before)

    // run_code_in_sim in the assistant's own Pyodide: the LED pin's events.
    await expect(page.getByLabel('Run in the simulator')).toContainText(/\d+ pin events/)
    await expect(page.getByLabel('Run in the simulator')).toContainText('GPIO17 high')

    // highlight: a caption and marks until dismissed.
    const note = page.getByRole('note', { name: "Claude's note" })
    await expect(note).toHaveText('This strip is GPIO17.')
    expect((await report(page)).cueMarks).toBeGreaterThan(0)
    await note.getByRole('button', { name: 'Dismiss the note' }).click()
    await expect(note).toBeHidden()
    expect((await report(page)).cueMarks).toBe(0)
  })

  test('a custom part is defined, placed, drawn without a body, saved and reopened', async ({
    page
  }) => {
    const pin = (id: string) => ({
      id,
      label: `P${id}`,
      role: 'passive',
      electricalType: 'passive',
      connector: 'none'
    })
    await openEmptyStudio(page)
    await queueReplies(
      page,
      [
        tools(
          text('The part is not in the library, so I define it and note how it goes in.'),
          toolUse('t1', 'define_custom_part', {
            template: '2-lead',
            name: 'Mystery sensor',
            pins: [pin('1'), pin('2')],
            internalConnections: [],
            simModel: 'none'
          }),
          toolUse('t2', 'place_part', {
            defId: 'custom-mystery-sensor',
            at: 'auto',
            orientation: 0,
            props: []
          }),
          toolUse('t3', 'annotate_build_steps', {
            annotations: [
              { step: 'R1', why: 'Its pins are only hints.', mistake: 'Pin 1 is not marked.' }
            ]
          })
        ),
        { blocks: [text('Defined and placed.')], stop: 'end_turn' }
      ].map(record)
    )
    await sendToClaude(page, 'add the mystery sensor')
    await expect(strip(page)).toContainText(
      'Claude added 1 part, 0 wires; defined 1 custom part, updated the build-step notes',
      { timeout: 30_000 }
    )
    const built = await appDoc(page)
    expect(built.customParts?.map((d) => d.id)).toEqual(['custom-mystery-sensor'])
    expect(built.parts.map((p) => [p.id, p.defId])).toEqual([['R1', 'custom-mystery-sensor']])
    // No model exists for it: its footprint and leads are drawn, without a body.
    await expect
      .poll(async () => (await report(page)).parts.R1)
      .toMatchObject({ body: false, leads: 2 })
    await page.getByRole('tab', { name: 'Build Steps' }).click()
    await expect(page.getByLabel('Build steps')).toContainText('Pin 1 is not marked.')

    // Saved with its transcript beside it, then reopened from the gallery.
    await menu(page, 'Save')
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...(window as unknown as { __files: Map<string, unknown> }).__files.keys()].sort()
        )
      )
      .toEqual([
        expect.stringMatching(/^Untitled-/),
        expect.stringMatching(/^Untitled-.*\.transcript$/)
      ])
    const transcript = JSON.stringify(
      await page.evaluate(() =>
        [...(window as unknown as { __files: Map<string, unknown> }).__files]
          .find(([id]) => id.endsWith('.transcript'))!
          .at(1)
      )
    )
    expect(transcript).toContain('add the mystery sensor')
    const saved = await appDoc(page)
    await menu(page, 'New')
    await expect.poll(async () => (await appDoc(page)).parts.length).toBe(0)
    await menu(page, 'Projects gallery')
    await page
      .getByRole('dialog', { name: 'Projects' })
      .getByRole('button', { name: /Untitled/ })
      .click()
    await expect.poll(async () => (await appDoc(page)).parts.length).toBe(1)
    expect(await appDoc(page)).toEqual(saved)
    await expect
      .poll(async () => (await report(page)).parts.R1)
      .toMatchObject({ body: false, leads: 2 })
  })
})
