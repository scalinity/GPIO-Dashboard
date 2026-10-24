// Build Mode in the Studio (SPEC 11.7, 11.9, 14.5; M10): every shipped tutorial opens from the
// Tutorials page as a read-only template and plays through, each step framing its holes and
// ghosting them; the Button and the Blinking LED confirm against the simulated board, the
// observable steps by themselves and the others labelled; a tutorial forks into an editable
// project; progress survives reopening.
import { readdirSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import type { CircuitDoc } from '../src/renderer/src/core/model/types'
import type { BuildReport } from '../src/renderer/src/studio/view'
import { hole, report, studio, type StudioWindow, waitUntilStill } from './helpers'

const IDS = readdirSync('src/renderer/src/content/tutorials', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

interface StepInfo {
  key: string
  kind: string
  text: string
  holes: string[]
}

/** The titles of the tutorials, as the page lists them. */
const titleOf = (page: Page, id: string) =>
  page.evaluate(
    `import('/src/core/defs/tutorials.ts').then((m) => m.TUTORIALS.find((t) => t.meta.id === '${id}').meta.title)`
  ) as Promise<string>

/** Opens a tutorial from the Tutorials page; `button` is the one to press on its page. */
async function openFromTutorials(page: Page, id: string, button: string) {
  await page.goto('/')
  const title = await titleOf(page, id)
  await page.getByRole('tab', { name: 'Tutorials' }).click()
  await page
    .getByRole('button')
    .filter({ has: page.getByText(title, { exact: true }) })
    .click()
  await page.getByRole('button', { name: button, exact: true }).click()
  await page.waitForFunction(
    () => ((window as unknown as StudioWindow).__studio?.loop.frames ?? 0) > 0
  )
}

const openBuild = async (page: Page, id: string) => {
  await openFromTutorials(page, id, 'Build in the Studio')
  await expect(page.getByRole('complementary', { name: 'Build Mode' })).toBeVisible()
}

const steps = (page: Page) =>
  page.evaluate(
    `Promise.all([import('/src/state/buildStore.ts'), import('/src/core/geometry/breadboard.ts')]).then(([b, g]) => b.useBuild.getState().steps.map((s) => ({ key: s.key, kind: s.kind, text: s.text, holes: s.holes.map(g.holeKey) })))`
  ) as Promise<StepInfo[]>

const build = async (page: Page): Promise<BuildReport> => (await report(page)).build!

const tutorialDoc = (page: Page, id: string) =>
  page.evaluate(
    `import('/src/core/defs/tutorials.ts').then((m) => m.TUTORIALS.find((t) => t.meta.id === '${id}').doc)`
  ) as Promise<CircuitDoc>

const appDoc = (page: Page) =>
  page.evaluate(
    "import('/src/state/circuit.ts').then((m) => m.circuit.getSnapshot())"
  ) as Promise<CircuitDoc>

const studioCables = (page: Page) => studio(page, (s) => s.cablesReport())

const done = (page: Page) => page.getByRole('button', { name: 'Done', exact: true })

/** The step in hand is framed within 600 ms, ghosted, and its holes are on screen and ringed. */
async function expectStepShown(page: Page, i: number, step: StepInfo) {
  await expect.poll(async () => (await build(page)).framingMs, { timeout: 5000 }).not.toBeNull()
  const shown = await build(page)
  expect(shown.index).toBe(i)
  expect(shown.framingMs!, `${step.key} framing`).toBeLessThanOrEqual(600)
  // A ghost marks the part or lead; the T-board step has none, but rings on the T-board's ends.
  expect(shown.ghosts, `${step.key} ghost`).toHaveLength(step.kind === 'tboard' ? 0 : 1)
  expect(shown.marks.length).toBeGreaterThanOrEqual(Math.max(2, step.holes.length))
  expect(
    shown.marks.every((m) => m.inView && m.tone === 'step'),
    `${step.key} marks`
  ).toBe(true)
  const canvas = (await page.getByTestId('studio').boundingBox())!
  for (const key of step.holes) {
    const at = await hole(page, key)
    expect(at.x, `${step.key} ${key}`).toBeGreaterThan(canvas.x)
    expect(at.x).toBeLessThan(canvas.x + canvas.width)
    expect(at.y).toBeGreaterThan(canvas.y)
    expect(at.y).toBeLessThan(canvas.y + canvas.height)
  }
}

test.describe('every tutorial plays through Build Mode', () => {
  test('the Tutorials page lists every shipped tutorial with its kit tag and theory', async ({
    page
  }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: 'Tutorials' }).click()
    const all = await page.evaluate(
      "import('/src/core/defs/tutorials.ts').then((m) => m.TUTORIALS.map((t) => [t.meta.id, t.meta.title, t.meta.kitProject, t.theory.length]))"
    )
    expect((all as string[][]).map((t) => t[0]).sort()).toEqual(IDS)
    for (const [, title, kit, theory] of all as [string, string, string | null, number][]) {
      const card = page.getByRole('button').filter({ has: page.getByText(title, { exact: true }) })
      await expect(card).toContainText(kit ? `kit ${kit}` : 'extra')
      expect(theory).toBeGreaterThan(0)
    }
    // Its page shows the theory, and opens the template in the Studio.
    await page
      .getByRole('button')
      .filter({ has: page.getByText('Blinking LED', { exact: true }) })
      .click()
    await expect(page.getByRole('tab', { name: 'Theory' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: 'Open in Studio', exact: true }).click()
    await expect(page.getByLabel('Project name')).toHaveValue('Blinking LED')
    await expect(page.getByText('Template · read-only')).toBeVisible()
  })

  for (const id of IDS) {
    test(`${id}`, async ({ page }) => {
      test.setTimeout(240_000)
      await openBuild(page, id)
      const list = await steps(page)
      expect(list.length).toBeGreaterThan(1)
      for (const [i, step] of list.entries()) {
        await expect(page.getByLabel('Build Mode')).toContainText(`Step ${i + 1} of ${list.length}`)
        await expect(page.getByRole('region', { name: `Step ${i + 1}` })).toContainText(
          step.text.slice(0, 40)
        )
        await expectStepShown(page, i, step)
        await done(page).click()
      }
      // The build is complete: the whole tutorial is drawn, nothing is ghosted, and the circuit
      // itself was never touched.
      await expect(page.getByRole('region', { name: 'Build complete' })).toBeVisible()
      await expect.poll(async () => (await build(page)).ghosts).toEqual([])
      const tutorial = await tutorialDoc(page, id)
      const shown = await page.evaluate(
        "import('/src/state/buildStore.ts').then((m) => m.useBuild.getState().scene.shown)"
      )
      expect(shown).toEqual(tutorial)
      expect(await appDoc(page)).toEqual(tutorial)
      // The models arrive one by one.
      await expect
        .poll(async () => Object.values((await report(page)).parts).every((p) => p.body), {
          timeout: 30_000
        })
        .toBe(true)
      expect(Object.keys((await report(page)).parts).sort()).toEqual(
        tutorial.parts.map((p) => p.id).sort()
      )
      await expect(page.getByLabel('Build progress')).toHaveAttribute(
        'aria-valuenow',
        String(list.length)
      )
    })
  }
})

test.describe('the Blinking LED in Build Mode', () => {
  test.beforeEach(async ({ page }) => openBuild(page, 'blinking-led'))

  test('shows each step’s text, why note and mistake, and Back, Next and Done work', async ({
    page
  }) => {
    const list = await steps(page)
    const card = page.getByRole('region', { name: 'Step 1' })
    await expect(card).toContainText('Plug the ribbon')
    await done(page).click()
    await expect(page.getByRole('region', { name: 'Step 2' })).toContainText(list[1]!.text)
    // The shipped notes: a "why" and a common mistake on the steps that have them.
    const annotated = await page.evaluate(
      "import('/src/state/buildStore.ts').then((m) => m.useBuild.getState().steps.filter((s) => s.why && s.mistake).length)"
    )
    expect(annotated).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Step 1' })).toBeVisible()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Step 2' })).toBeVisible()
    // Back and Next walk the steps; only Done ticks one off.
    await expect(page.getByLabel('Build progress')).toHaveAttribute('aria-valuenow', '1')
    // Anything clickable is outside the orbit controls' element.
    await expect(page.getByTestId('studio').getByRole('button')).toHaveCount(0)
  })

  test('grows the bench by one part or lead at a time and ghosts the step in hand', async ({
    page
  }) => {
    const list = await steps(page)
    expect(list.map((s) => s.key)).toEqual(['tboard', 'part:R1', 'part:D1', 'wire:W1', 'wire:W2'])
    // What the bench draws: the parts done, and the step in hand as a ghost over its holes.
    const drawn = async () => Object.keys((await report(page)).parts).sort()
    // The leads the solver runs: a ghost is never one of them.
    const leads = async () =>
      (await studioCables(page))!.cables
        .map((c) => c.key)
        .filter((k) => k !== 'ribbon')
        .sort()
    expect(await drawn()).toEqual([])
    expect((await build(page)).ghosts).toEqual([])
    await done(page).click() // the T-board
    await expect.poll(async () => (await build(page)).ghosts).toEqual(['R1'])
    await done(page).click() // R1
    await expect.poll(async () => (await build(page)).ghosts).toEqual(['D1'])
    expect(await drawn()).toEqual(['D1', 'R1'])
    await done(page).click() // D1
    await expect.poll(async () => (await build(page)).ghosts).toEqual(['ghost:build-step'])
    expect(await leads()).toEqual([])
    await done(page).click() // W1
    await expect.poll(leads).toEqual(['W1'])
    await done(page).click() // W2
    await expect.poll(leads).toEqual(['W1', 'W2'])
    await expect.poll(async () => (await build(page)).ghosts).toEqual([])
  })

  test('draws no frames while a step is held, though its rings keep pulsing', async ({ page }) => {
    await done(page).click()
    await waitUntilStill(page, 10_000)
    const ring = page.locator('.step-mark').first()
    await expect(ring).toBeVisible()
    expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe('step-pulse')
    const before = await page.evaluate(
      () => (window as unknown as StudioWindow).__studio.loop.frames
    )
    await page.waitForTimeout(1500)
    const after = await page.evaluate(
      () => (window as unknown as StudioWindow).__studio.loop.frames
    )
    expect(after).toBe(before)
  })

  test('depth of field follows the target when asked, and goes with Build Mode', async ({
    page
  }) => {
    const focus = () =>
      page.evaluate(() => {
        const post = (window as unknown as StudioWindow).__studio.post as unknown as {
          pipeline: { outputNode: unknown }
          sharp: unknown
        }
        return post.pipeline.outputNode !== post.sharp
      })
    expect(await focus()).toBe(false)
    await page.getByLabel('Blur what is not the step').check()
    await expect.poll(focus).toBe(true)
    expect((await build(page)).blur).toBe(true)
    await done(page).click()
    await expect.poll(async () => (await build(page)).framingMs).not.toBeNull()
    expect(await focus()).toBe(true)
    // Sensing is never switched on by Build Mode, and leaving it turns the blur off.
    await page.getByRole('button', { name: 'Exit', exact: true }).click()
    await expect.poll(focus).toBe(false)
    await expect(page.getByRole('complementary', { name: 'Build Mode' })).toBeHidden()
    await waitUntilStill(page, 10_000)
  })

  test('is a read-only template: an edit is refused with its reason', async ({ page }) => {
    await page.getByLabel('Project name').fill('Renamed')
    await page.getByLabel('Project name').press('Enter')
    await expect(page.getByRole('status')).toContainText('read-only')
    await expect(page.getByLabel('Project name')).toHaveValue('Renamed')
    // The name field only shows what was typed; the document keeps its name.
    expect((await appDoc(page)).meta.name).toBe('Blinking LED')
  })
})

test.describe('progress persists per project', () => {
  test('survives reopening the tutorial and reloading the app', async ({ page }) => {
    await openBuild(page, 'button')
    for (let i = 0; i < 3; i++) await done(page).click()
    await expect(page.getByRole('region', { name: 'Step 4' })).toBeVisible()
    // Leave the Studio and come back to the same tutorial.
    await page.getByRole('tab', { name: 'Tutorials' }).click()
    await page.getByRole('button', { name: 'Build in the Studio', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Step 4' })).toBeVisible()
    await expect(page.getByLabel('Build progress')).toHaveAttribute('aria-valuenow', '3')
    // Reload the whole app.
    await page.reload()
    await page.getByRole('tab', { name: 'Tutorials' }).click()
    await page
      .getByRole('button')
      .filter({ has: page.getByText('Button', { exact: true }) })
      .click()
    await page.getByRole('button', { name: 'Build in the Studio', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Step 4' })).toBeVisible()
    await expect(page.getByLabel('Build progress')).toHaveAttribute('aria-valuenow', '3')
    // Another tutorial has progress of its own.
    await page.getByRole('tab', { name: 'Tutorials' }).click()
    await page.getByRole('button', { name: 'Back to tutorials' }).click()
    await page
      .getByRole('button')
      .filter({ has: page.getByText('Blinking LED', { exact: true }) })
      .click()
    await page.getByRole('button', { name: 'Build in the Studio', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Step 1' })).toBeVisible()
  })
})

test.describe('Fork to my projects', () => {
  test.beforeEach(async ({ page }) => {
    // The native project commands, kept in memory.
    await page.addInitScript(() => {
      const files = new Map<string, unknown>()
      ;(window as unknown as { api: unknown; files: unknown }).files = files
      ;(window as unknown as { api: unknown }).api = {
        projects: {
          list: async () => ({ success: true, projects: [] }),
          read: async (id: string) => ({ success: true, doc: structuredClone(files.get(id)) }),
          write: async (id: string, d: unknown) => (
            files.set(id, structuredClone(d)),
            { success: true }
          )
        }
      }
    })
  })

  test('copies the tutorial into an editable project equal to it', async ({ page }) => {
    await openFromTutorials(page, 'button', 'Fork to my projects')
    const tutorial = await tutorialDoc(page, 'button')
    const saved = (await page.evaluate(() => [
      ...(window as unknown as { files: Map<string, CircuitDoc> }).files
    ])) as [string, CircuitDoc][]
    expect(saved).toHaveLength(1)
    const [, forked] = saved[0]!
    // The same circuit, code and notes; only its dates are its own.
    expect({ ...forked, meta: { ...forked.meta, created: '', updated: '' } }).toEqual({
      ...tutorial,
      meta: { ...tutorial.meta, created: '', updated: '' }
    })
    expect(forked.meta.created).not.toBe(tutorial.meta.created)
    const current = await appDoc(page)
    expect(current).toEqual(forked)
    await expect(page.getByText('Template · read-only')).toBeHidden()

    // It is editable: rename it.
    await page.getByLabel('Project name').fill('My button')
    await page.getByLabel('Project name').press('Enter')
    await expect.poll(async () => (await appDoc(page)).meta.name).toBe('My button')
    // The tutorial itself is unchanged.
    expect(await tutorialDoc(page, 'button')).toEqual(tutorial)
  })

  test('forks from the Studio too, from a template that is open there', async ({ page }) => {
    await openFromTutorials(page, 'blinking-led', 'Open in Studio')
    await expect(page.getByText('Template · read-only')).toBeVisible()
    await page.getByRole('button', { name: 'Fork to my projects' }).click()
    await expect(page.getByText('Template · read-only')).toBeHidden()
    await page.getByLabel('Project name').fill('Mine')
    await page.getByLabel('Project name').press('Enter')
    await expect.poll(async () => (await appDoc(page)).meta.name).toBe('Mine')
  })

  test('Build Mode keeps a project read-only for the circuit but not for its name', async ({
    page
  }) => {
    await openFromTutorials(page, 'blinking-led', 'Fork to my projects')
    await page.getByRole('button', { name: 'Build', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Build Mode' })).toBeVisible()
    await page.getByLabel('Project name').fill('Still mine')
    await page.getByLabel('Project name').press('Enter')
    await expect.poll(async () => (await appDoc(page)).meta.name).toBe('Still mine')
    // The steps are regenerated from the document the project holds; progress is the project's.
    await done(page).click()
    await page.getByRole('button', { name: 'Exit', exact: true }).click()
    await page.getByRole('button', { name: 'Build', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Step 2' })).toBeVisible()
  })
})

/** Opens the Board tab and switches on Board Sense's simulated board: its own button. */
async function senseWithSimulatedBoard(page: Page, id: string) {
  await setBoard(page, id, -1)
  await page.getByRole('tab', { name: 'Board' }).click()
  await page.getByRole('button', { name: 'Use the simulated board' }).click()
  await expect
    .poll(() =>
      page.evaluate("import('/src/state/senseStore.ts').then((m) => m.useSense.getState().mode)")
    )
    .toBe('mock')
}

/** The simulated board stands as the tutorial's steps 0 to `upTo` built it. */
const setBoard = (page: Page, id: string, upTo: number, edit = '') =>
  page.evaluate(`Promise.all([import('/src/state/senseStore.ts'), import('/src/core/defs/tutorials.ts'), import('/src/core/steps/steps.ts'), import('/src/core/sense/buildSteps.ts'), import('/src/core/defs/parts.ts')]).then(([s, t, st, b, p]) => {
    const doc = t.TUTORIALS.find((x) => x.meta.id === '${id}').doc
    const steps = st.buildSteps(doc, p.partDef).steps
    const board = structuredClone(b.docUpTo(doc, steps, ${upTo}))
    ${edit}
    s.useSense.setState({ mockBoard: board })
  })`)

/**
 * The steps Board Sense can see on a finished board: the Button's pull-up lead brings GPIO18 to
 * 3V3; the Blinking LED has only an LED path to GPIO17, which it cannot see (SPEC 14.5).
 */
const OBSERVABLE: Record<string, string[]> = { button: ['wire:W3'], 'blinking-led': [] }

for (const id of ['button', 'blinking-led']) {
  test(`Board Sense confirms ${id}'s observable steps and labels the rest`, async ({ page }) => {
    test.setTimeout(240_000)
    await openBuild(page, id)
    const mode = () =>
      page.evaluate("import('/src/state/senseStore.ts').then((m) => m.useSense.getState().mode)")
    // Build Mode never starts sensing.
    expect(await mode()).toBe('off')
    await expect(page.getByRole('region', { name: 'Step 1' })).toContainText('Board Sense is off')
    const list = await steps(page)
    await senseWithSimulatedBoard(page, id)
    const want = list.map((s) =>
      OBSERVABLE[id]!.includes(s.key) ? 'confirmed' : 'not electrically verifiable'
    )
    let confirmed = 0
    for (const [i, step] of list.entries()) {
      await setBoard(page, id, i - 1)
      const card = page.getByRole('region', { name: `Step ${i + 1}` })
      const sensed = { timeout: 15_000 }
      if (want[i] === 'confirmed')
        await expect(card).toContainText('Waiting for the change', sensed)
      else await expect(card).toContainText('not electrically verifiable', sensed)
      await setBoard(page, id, i)
      if (want[i] === 'confirmed') {
        // The change is sensed: the step ticks itself and the build moves on.
        if (i === list.length - 1)
          await expect(page.getByRole('region', { name: 'Build complete' })).toBeVisible(sensed)
        else await expect(page.getByLabel('Build Mode')).toContainText(`Step ${i + 2} of`, sensed)
        await expect(page.getByLabel('done, sensed')).toHaveCount(++confirmed)
      } else {
        await expect(card).toContainText('not electrically verifiable', sensed)
        await expectStepShown(page, i, step)
        await done(page).click()
      }
    }
    await expect(page.getByRole('region', { name: 'Build complete' })).toBeVisible()
    expect(confirmed).toBe(want.filter((w) => w === 'confirmed').length)
    if (id === 'button') expect(confirmed).toBeGreaterThan(0)
    else expect(confirmed).toBe(0)
    // Build Mode left sensing as the Board tab had it.
    expect(await mode()).toBe('mock')
  })
}

test('a step done differently shows its divergence and ranked causes, on rings at the holes', async ({
  page
}) => {
  test.setTimeout(120_000)
  await openBuild(page, 'button')
  const list = await steps(page)
  const at = list.findIndex((s) => s.key === 'wire:W3')
  await senseWithSimulatedBoard(page, 'button')
  await page.evaluate(
    `import('/src/state/buildStore.ts').then((m) => m.useBuild.getState().goTo(${at}))`
  )
  // W3 brings 3V3 to the pull-up; its 3V3 end went to the ground row instead.
  await setBoard(
    page,
    'button',
    at,
    "board.wires.find((w) => w.id === 'W3').a = { hole: { board: 'bb1', area: 'main', row: 5, col: 'b' } }"
  )
  const card = page.getByRole('region', { name: `Step ${at + 1}` })
  await expect(card.getByRole('status', { name: 'Board Sense divergence' })).toContainText(
    'Not as expected: GPIO18',
    { timeout: 20_000 }
  )
  await expect(
    card.getByRole('list', { name: 'Likely causes' }).getByRole('listitem').first()
  ).toBeVisible({ timeout: 30_000 })
  // The likeliest cause's holes are ringed in red beside the step’s own rings.
  await expect
    .poll(async () => (await build(page)).marks.some((m) => m.tone === 'cause'))
    .toBe(true)
  // Fixing the lead confirms the step.
  await setBoard(page, 'button', at)
  await expect(page.getByLabel('Build Mode')).toContainText(`Step ${at + 2} of`, {
    timeout: 20_000
  })
})
