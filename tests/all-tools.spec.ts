import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

test('All Tools exposes and activates existing editor features', async ({ page }, testInfo) => {
  const pdf = await PDFDocument.create()
  const sheet = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  sheet.drawText('ALL TOOLS QA DOCUMENT', { x: 72, y: 700, size: 26, font })
  const pdfPath = testInfo.outputPath('all-tools.pdf')
  await writeFile(pdfPath, await pdf.save())

  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(pdfPath)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })

  const launcher = page.getByRole('button', { name: 'All Tools' })
  await expect(launcher).toBeVisible()
  await launcher.click()

  const drawer = page.locator('.all-tools-drawer')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('heading', { name: 'All Tools' })).toBeVisible()
  await expect(drawer).toContainText('Edit & annotate')
  await expect(drawer).toContainText('Organize pages')
  await expect(drawer).toContainText('Find & fill')
  await expect(drawer).toContainText('File')
  await expect(drawer).toContainText('PDFs and OCR stay on this device.')

  await drawer.getByRole('button', { name: /Add text/ }).click()
  await expect(drawer).toHaveCount(0)
  await expect(page.getByTitle('Add text')).toHaveClass(/active/)

  await launcher.click()
  await page.locator('.all-tools-drawer').getByRole('button', { name: /Search \/ OCR/ }).click()
  await expect(page.getByPlaceholder('Find in document')).toBeFocused()

  await launcher.click()
  await page.locator('.all-tools-drawer').getByRole('button', { name: /Form fields/ }).click()
  await expect(page.getByTitle('Form fields')).toHaveClass(/active/)
  await expect(page.locator('.left-panel')).toContainText('Form fields')

  await launcher.click()
  await page.locator('.all-tools-drawer').getByRole('button', { name: /Document info/ }).click()
  await expect(page.getByTitle('Document info')).toHaveClass(/active/)
  await expect(page.locator('.left-panel')).toContainText('Properties')

  await launcher.click()
  await page.locator('.all-tools-drawer').getByRole('button', { name: /^Pages/ }).click()
  await expect(page.getByTitle('Pages')).toHaveClass(/active/)

  await launcher.click()
  await page.locator('.all-tools-drawer').getByRole('button', { name: /Save locally/ }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Saved to local library')

  await launcher.click()
  await expect(page.locator('.all-tools-drawer')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.all-tools-drawer')).toHaveCount(0)
})
