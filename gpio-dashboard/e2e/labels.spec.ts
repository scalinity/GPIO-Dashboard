// Labels (SPEC 11.5; acceptance 8): the Inspect toggle shows pin tags and the T-board's names over
// the bench, keeps them while the circuit is simulated, and takes them away again.
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
