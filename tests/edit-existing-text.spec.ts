import { test, expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

async function makeEditablePdf(path: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('ORIGINAL SENTENCE 9921', { x: 90, y: 680, size: 24, font, color: rgb(0, 0, 0) })
  page.drawText('UNCHANGED NEIGHBOR 7712', { x: 90, y: 620, size: 18, font, color: rgb(0, 0, 0) })
  await writeFile(path, await pdf.save())
}

async function makeFragmentedEditablePdf(path: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const sentence = 'QXFRAGMENTED LINE 8842'
  const size = 22
  let x = 90
  for (const character of sentence) {
    if (character !== ' ') page.drawText(character, { x, y: 680, size, font, color: rgb(0, 0, 0) })
    x += font.widthOfTextAtSize(character, size)
  }
  page.drawText('SEPARATE COLUMN 4455', { x: 410, y: 680, size: 12, font, color: rgb(0, 0, 0) })
  page.drawText('UNCHANGED NEIGHBOR 7712', { x: 90, y: 620, size: 18, font, color: rgb(0, 0, 0) })
  await writeFile(path, await pdf.save())
}

async function openFile(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
}

test('edits a real existing PDF text object directly on the page and persists it into export', async ({ page }, testInfo) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))

  const sourcePath = testInfo.outputPath('native-text-source.pdf')
  await makeEditablePdf(sourcePath)
  await openFile(page, sourcePath)

  const editTool = page.getByTitle('Edit existing text')
  await editTool.click()
  await expect(editTool).toHaveClass(/active/)

  const originalSpan = page.locator('.pdf-text-layer span').filter({ hasText: 'ORIGINAL SENTENCE 9921' }).first()
  await expect(originalSpan).toBeAttached({ timeout: 20_000 })
  await originalSpan.click()

  const editor = page.locator('.native-text-editor')
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.native-text-selection')).toBeVisible()

  const inlineEditor = page.getByRole('textbox', { name: 'Edit selected PDF text directly on page' })
  await expect(inlineEditor).toBeVisible({ timeout: 20_000 })
  await expect(inlineEditor).toHaveValue('ORIGINAL SENTENCE 9921')

  await inlineEditor.fill('UPDATED SENTENCE 9921')
  await editor.getByRole('button', { name: 'Apply to PDF' }).click()
  await expect(editor).toHaveCount(0, { timeout: 30_000 })

  await page.getByTitle('Select').click()
  const search = page.getByPlaceholder('Find in document')
  await search.fill('UPDATED SENTENCE 9921')
  await search.press('Enter')
  await expect(page.locator('.stage-top-hint')).toContainText('1 matching page', { timeout: 20_000 })
  await expect(page.locator('.pdf-search-hit').filter({ hasText: 'UPDATED SENTENCE 9921' }).first()).toBeVisible({ timeout: 20_000 })

  await search.fill('ORIGINAL SENTENCE 9921')
  await search.press('Enter')
  await expect(page.locator('.stage-top-hint')).toContainText('No matches', { timeout: 20_000 })

  const exportPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const exported = await exportPromise
  const exportedPath = testInfo.outputPath('native-text-edited.pdf')
  await exported.saveAs(exportedPath)

  await page.getByTitle('Close document').click()
  await expect(page.locator('.welcome')).toBeVisible()
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })

  const reopenedSearch = page.getByPlaceholder('Find in document')
  await reopenedSearch.fill('UPDATED SENTENCE 9921')
  await reopenedSearch.press('Enter')
  await expect(page.locator('.stage-top-hint')).toContainText('1 matching page', { timeout: 20_000 })

  await reopenedSearch.fill('ORIGINAL SENTENCE 9921')
  await reopenedSearch.press('Enter')
  await expect(page.locator('.stage-top-hint')).toContainText('No matches', { timeout: 20_000 })

  expect(browserErrors, `Unexpected browser errors: ${browserErrors.join('\n')}`).toEqual([])
})

test('selects and edits a sentence even when the PDF stores it as individual glyph objects', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const sourcePath = testInfo.outputPath('fragmented-native-text.pdf')
  await makeFragmentedEditablePdf(sourcePath)
  await openFile(page, sourcePath)

  await page.getByTitle('Edit existing text').click()

  const pdfPage = page.locator('.pdf-page').first()
  const box = await pdfPage.boundingBox()
  expect(box).not.toBeNull()
  await pdfPage.click({ position: { x: 135, y: 115 } })

  const selection = page.locator('.native-text-selection')
  await expect(selection).toBeVisible({ timeout: 20_000 })
  const selectionBox = await selection.boundingBox()
  expect(selectionBox?.width ?? 0).toBeGreaterThan(170)

  const inlineEditor = page.getByRole('textbox', { name: 'Edit selected PDF text directly on page' })
  await expect(inlineEditor).toBeVisible({ timeout: 20_000 })
  await expect(inlineEditor).toHaveValue('QXFRAGMENTED LINE 8842')

  await inlineEditor.fill('QXUPDATED TEXT LINE 8842')
  await inlineEditor.press('Control+Enter')
  await expect(inlineEditor).toHaveCount(0, { timeout: 30_000 })

  await page.getByTitle('Select').click()
  const search = page.getByPlaceholder('Find in document')
  await search.fill('QXUPDATED TEXT LINE 8842')
  await search.press('Enter')
  await expect(page.locator('.stage-top-hint')).toContainText('1 matching page', { timeout: 20_000 })

  await search.fill('QXFRAGMENTED LINE 8842')
  await search.press('Enter')
  await expect(page.locator('.stage-top-hint')).toContainText('No matches', { timeout: 20_000 })

  await search.fill('SEPARATE COLUMN 4455')
  await search.press('Enter')
  await expect(page.locator('.stage-top-hint')).toContainText('1 matching page', { timeout: 20_000 })
})
