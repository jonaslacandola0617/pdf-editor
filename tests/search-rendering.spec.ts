import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

test('search visibly highlights native PDF text without overlapping canvas renders', async ({ page }, testInfo) => {
  const pdf = await PDFDocument.create()
  const sheet = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  sheet.drawText('Detail-oriented PDF Forge search verification', { x: 72, y: 690, size: 20, font })
  sheet.drawText('Second searchable line for native PDF text.', { x: 72, y: 650, size: 14, font })
  const pdfPath = testInfo.outputPath('search-highlight.pdf')
  await writeFile(pdfPath, await pdf.save())

  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon.ico')) browserErrors.push(message.text())
  })

  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(pdfPath)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-text-layer span').first()).toBeVisible({ timeout: 20_000 })

  const search = page.getByPlaceholder('Find in document')
  await search.fill('detail')
  await search.press('Enter')
  await expect(page.locator('.stage-top-hint')).toContainText('1 matching page', { timeout: 20_000 })
  const hit = page.locator('.pdf-search-hit').first()
  await expect(hit).toBeVisible()
  await expect(hit).toContainText(/detail/i)

  const textLayer = page.locator('.pdf-text-layer')
  await expect(textLayer).toHaveClass(/interactive/)
  await expect(textLayer).toHaveCSS('pointer-events', 'auto')

  // Exercise the same canvas repeatedly to catch PDF.js render-task overlap regressions.
  const zoomIn = page.locator('.floating-nav > button').last()
  await Promise.all(Array.from({ length: 5 }, () => zoomIn.click()))
  await page.getByTitle('Rotate right').click()
  await page.getByTitle('Rotate left').click()
  await expect(page.locator('.pdf-search-hit').first()).toBeVisible({ timeout: 20_000 })

  // Annotation tools must still receive pointer input while the text layer exists.
  await page.getByTitle('Add text').click()
  await expect(textLayer).not.toHaveClass(/interactive/)
  const pageBox = await page.locator('.pdf-page').boundingBox()
  if (!pageBox) throw new Error('PDF page did not render')
  await page.mouse.click(pageBox.x + pageBox.width * 0.55, pageBox.y + pageBox.height * 0.45)
  await expect(page.locator('.text-annotation')).toHaveCount(1)

  expect(browserErrors, `Unexpected browser errors:\n${browserErrors.join('\n')}`).toEqual([])
})
