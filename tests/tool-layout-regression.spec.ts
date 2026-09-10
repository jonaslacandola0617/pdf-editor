import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

async function makePdf(path: string) {
  const pdf = await PDFDocument.create()
  pdf.addPage([612, 792])
  await writeFile(path, await pdf.save())
}

test('Document Tools and Objects keep readable non-overlapping navigation rails', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1200, height: 760 })
  const source = testInfo.outputPath('focused-tools-layout.pdf')
  await makePdf(source)
  await page.goto('/')

  const input = page.locator('input[type="file"]').first()
  await input.setInputFiles(source)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })

  await page.getByTitle('Document tools').click()
  const modal = page.locator('.advanced-focus-modal')
  await expect(modal).toBeVisible()

  const categoryRail = modal.locator('.advanced-category-rail')
  const categoryButtons = categoryRail.locator(':scope > button')
  await expect(categoryButtons).toHaveCount(4)
  await expect(categoryRail.locator('small')).toBeHidden()

  const railBox = await categoryRail.boundingBox()
  const firstCategoryBox = await categoryButtons.first().boundingBox()
  expect(railBox).not.toBeNull()
  expect(firstCategoryBox).not.toBeNull()
  expect(firstCategoryBox!.width).toBeGreaterThan(180)
  expect(firstCategoryBox!.height).toBeGreaterThanOrEqual(48)

  for (let index = 0; index < await categoryButtons.count(); index += 1) {
    const button = categoryButtons.nth(index)
    const buttonBox = await button.boundingBox()
    const labelBox = await button.locator('strong').boundingBox()
    expect(buttonBox).not.toBeNull()
    expect(labelBox).not.toBeNull()
    expect(labelBox!.x).toBeGreaterThanOrEqual(buttonBox!.x)
    expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(buttonBox!.x + buttonBox!.width + 1)
    expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(buttonBox!.y + buttonBox!.height + 1)
  }

  const toolButtons = modal.locator('.advanced-tool-rail > button')
  const firstToolBox = await toolButtons.first().boundingBox()
  expect(firstToolBox).not.toBeNull()
  expect(firstToolBox!.width).toBeGreaterThan(180)
  expect(firstToolBox!.height).toBeGreaterThanOrEqual(42)

  await categoryRail.getByRole('button', { name: /Security & privacy/ }).click()
  await modal.locator('.advanced-tool-rail').getByRole('button', { name: 'Secure redaction' }).click()
  const destructiveAction = modal.getByRole('button', { name: 'Apply marked redactions' })
  await expect(destructiveAction).toBeVisible()
  const destructiveBox = await destructiveAction.boundingBox()
  expect(destructiveBox).not.toBeNull()
  expect(destructiveBox!.width).toBeGreaterThan(180)
  expect(destructiveBox!.height).toBeLessThanOrEqual(64)

  await page.getByTitle('Close Document tools').click()
  await page.getByTitle('Embedded PDF objects').click()
  const objects = page.locator('.object-focus-modal')
  await expect(objects).toBeVisible()
  await expect(objects.locator('.object-category-rail small')).toBeHidden()
  const objectCategoryBox = await objects.locator('.object-category-rail > button').first().boundingBox()
  const objectToolBox = await objects.locator('.object-tool-rail > button').first().boundingBox()
  expect(objectCategoryBox).not.toBeNull()
  expect(objectToolBox).not.toBeNull()
  expect(objectCategoryBox!.width).toBeGreaterThan(180)
  expect(objectToolBox!.width).toBeGreaterThan(180)
})
