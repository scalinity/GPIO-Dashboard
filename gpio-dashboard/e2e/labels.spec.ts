// Labels (SPEC 11.5; acceptance 8): the Inspect toggle shows pin tags and the T-board's names over
// the bench, keeps them while the circuit is simulated, and takes them away again. A voltage tag is
// a HUD world label whose reading is set in DM Mono (SPEC 2.3).
import { expect, test } from '@playwright/test'
import { openTutorial } from './helpers'

test('Labels tag the pins and the T-board, during Simulate too, and turn off', async ({ page }) => {
  await openTutorial(page, 'blinking-led')
  const labels = page.getByRole('checkbox', { name: 'Labels' })
  const anode = page.getByText('Anode (+)', { exact: true })
  const gpio17 = page.getByText('GPIO17', { exact: true }).first()

  await expect(anode).toHaveCount(0)
  await labels.check()
  await expect(anode).toBeVisible()
  await expect(page.getByText('Cathode (−)', { exact: true })).toBeVisible()
  await expect(gpio17).toBeVisible()

  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(anode).toBeVisible()
  await expect(gpio17).toBeVisible()

  await labels.uncheck()
  await expect(anode).toHaveCount(0)
})

test('a voltage tag names its net and shows the reading in DM Mono', async ({ page }) => {
  await openTutorial(page, 'blinking-led')
  await page.getByLabel('Voltages').check()
  await page.getByRole('button', { name: 'Simulate' }).click()

  // The 3V3 net's pill holds its name, then the reading.
  const net = page.getByText('3V3', { exact: true })
  await expect(net).toBeVisible()
  const pill = net.locator('xpath=..')
  await expect(pill).toHaveText('3V33.30 V')
  const reading = pill.getByText('3.30 V', { exact: true })
  expect(await net.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"Outfit Variable"/)
  expect(await reading.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"DM Mono"/)
  // The face itself is served by the app.
  const faces = await page.evaluate(
    async () => (await document.fonts.load('500 10px "DM Mono"', '3.30 V')).length
  )
  expect(faces).toBeGreaterThan(0)
})
