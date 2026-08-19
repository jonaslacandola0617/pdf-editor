import { test, expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

async function makeTextPdf(path: string, labels: string[]) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.setTitle('QA Source Document')
  pdf.setAuthor('PDF Forge QA')
  for (let i = 0; i < labels.length; i++) {
    const page = pdf.addPage([612, 792])
    page.drawText(labels[i], { x: 72, y: 680, size: 28, font, color: rgb(0, 0, 0) })
    page.drawText(`Page ${i + 1}`, { x: 72, y: 640, size: 18, font, color: rgb(0, 0, 0) })
  }
  await writeFile(path, await pdf.save())
}

async function makeFormPdf(path: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const form = pdf.getForm()
  const name = form.createTextField('qa_name')
  name.setText('Before'); name.addToPage(page, { x: 70, y: 690, width: 220, height: 28 })
  const agree = form.createCheckBox('qa_agree')
  agree.addToPage(page, { x: 70, y: 640, width: 20, height: 20 })
  const choice = form.createDropdown('qa_choice')
  choice.addOptions(['Alpha', 'Beta', 'Gamma']); choice.select('Alpha')
  choice.addToPage(page, { x: 70, y: 580, width: 180, height: 28 })
  const color = form.createRadioGroup('qa_color')
  color.addOptionToPage('Red', page, { x: 70, y: 520, width: 20, height: 20 })
  color.addOptionToPage('Blue', page, { x: 130, y: 520, width: 20, height: 20 })
  color.select('Red')
  await writeFile(path, await pdf.save())
}

async function openFile(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
}

const pageNumber = (page: Page) => page.locator('.floating-nav input')
const stageStatus = (page: Page) => page.locator('.stage-top-hint')

async function dragOnPdf(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
  const box = await page.locator('.pdf-page').boundingBox()
  if (!box) throw new Error('PDF page has no bounding box')
  await page.mouse.move(box.x + box.width * fromX, box.y + box.height * fromY)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * toX, box.y + box.height * toY, { steps: 12 })
  await page.mouse.up()
}

test('viewer, search, page organization, merge, extract, annotations, undo/redo and export', async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  const basePdf = testInfo.outputPath('base.pdf')
  const mergePdf = testInfo.outputPath('merge.pdf')
  await makeTextPdf(basePdf, ['FIRST MAGIC 1101', 'SECOND MAGIC 2202', 'THIRD MAGIC 3303'])
  await makeTextPdf(mergePdf, ['MERGED FOUR 4404', 'MERGED FIVE 5505'])
  await openFile(page, basePdf)

  await expect(page.locator('.thumbnail')).toHaveCount(3)
  await page.locator('.floating-nav > button').nth(1).click(); await expect(pageNumber(page)).toHaveValue('2')
  await page.keyboard.press('ArrowRight'); await expect(pageNumber(page)).toHaveValue('3')
  await page.keyboard.press('PageUp'); await expect(pageNumber(page)).toHaveValue('2')
  await page.locator('.floating-nav > button').last().click()
  await expect(page.locator('.floating-nav > span').filter({ hasText: '%' })).toContainText('115%')

  const search = page.getByPlaceholder('Find in document')
  await search.fill('SECOND MAGIC 2202'); await search.press('Enter')
  await expect(stageStatus(page)).toContainText('1 matching page', { timeout: 20_000 })
  await expect(pageNumber(page)).toHaveValue('2')

  const thumbs = page.locator('.thumb-drag-wrap')
  await thumbs.nth(0).dragTo(thumbs.nth(2))
  await search.fill('FIRST MAGIC 1101'); await search.press('Enter')
  await expect(stageStatus(page)).toContainText('1 matching page')
  await expect(pageNumber(page)).toHaveValue('3')

  const beforeRotate = await page.locator('.pdf-page').boundingBox()
  await page.getByTitle('Rotate left').click()
  await expect.poll(async () => (await page.locator('.pdf-page').boundingBox())?.width || 0).not.toBe(beforeRotate?.width || 0)
  await page.getByTitle('Rotate right').click()
  await page.getByRole('button', { name: 'Duplicate' }).click(); await expect(page.locator('.thumbnail')).toHaveCount(4)
  await page.getByRole('button', { name: 'Delete' }).click(); await expect(page.locator('.thumbnail')).toHaveCount(3)

  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Merge' }).click()])
  await chooser.setFiles(mergePdf)
  await expect(page.locator('.thumbnail')).toHaveCount(5, { timeout: 20_000 })

  const extractPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Extract' }).click()
  await page.locator('.modal input').fill('1-2')
  await page.locator('.modal').getByRole('button', { name: 'Extract PDF' }).click()
  const extractedPath = await (await extractPromise).path()
  if (!extractedPath) throw new Error('Extract download missing')
  expect((await PDFDocument.load(await readFile(extractedPath))).getPageCount()).toBe(2)

  await page.getByTitle('Add text').click(); await page.locator('.pdf-page').click({ position: { x: 250, y: 220 } })
  await page.locator('.right-panel textarea').fill('QA NOTE 8844')
  await expect(page.locator('.text-annotation')).toContainText('QA NOTE 8844')
  await page.getByTitle('Highlight').click(); await dragOnPdf(page, .18, .40, .48, .46)
  await expect(page.locator('.box-annotation.highlight')).toHaveCount(1)
  await page.getByTitle('Rectangle').click(); await dragOnPdf(page, .20, .52, .52, .64)
  await expect(page.locator('.box-annotation.rectangle')).toHaveCount(1)
  await page.getByTitle('Draw').click(); await dragOnPdf(page, .20, .72, .50, .78)
  await expect(page.locator('.ink-hitbox')).toHaveCount(1)
  const signatureTool = page.getByTitle('Signature')
  await signatureTool.click(); await expect(signatureTool).toHaveClass(/active/)
  await dragOnPdf(page, .62, .54, .82, .61)
  await expect(page.locator('.ink-hitbox')).toHaveCount(2)

  const range = page.locator('.right-panel input.range')
  await range.focus(); await range.press('Home')
  for (let i = 0; i < 6; i++) await range.press('ArrowRight')
  await expect(page.locator('.right-panel')).toContainText('7px')
  const beforeUndo = await page.locator('.ink-hitbox').count()
  await page.keyboard.press('Control+z'); await expect(page.locator('.ink-hitbox')).toHaveCount(beforeUndo)
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('.ink-hitbox')).toHaveCount(beforeUndo)

  await page.getByTitle('Document info').click()
  await page.locator('.meta-form label').filter({ hasText: 'Title' }).locator('input').fill('QA Export Verified')
  await page.locator('.meta-form label').filter({ hasText: 'Author' }).locator('input').fill('Browser QA')
  const exportPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const exportedDownload = await exportPromise
  const exportedPath = testInfo.outputPath('qa-exported.pdf')
  await exportedDownload.saveAs(exportedPath)
  const exported = await PDFDocument.load(await readFile(exportedPath))
  expect(exported.getPageCount()).toBe(5)
  expect(exported.getTitle()).toBe('QA Export Verified')
  expect(exported.getAuthor()).toBe('Browser QA')

  await page.getByTitle('Close document').click(); await expect(page.locator('.welcome')).toBeVisible()
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  await expect(page.locator('.app-shell')).toBeVisible()
  const exportedSearch = page.getByPlaceholder('Find in document')
  await exportedSearch.fill('QA NOTE 8844'); await exportedSearch.press('Enter')
  await expect(stageStatus(page)).toContainText('1 matching page', { timeout: 20_000 })
  expect(consoleErrors, `Unexpected browser errors: ${consoleErrors.join('\n')}`).toEqual([])
})

test('local library and full workspace survive refresh, while explicit close disables auto-resume', async ({ page }, testInfo) => {
  const pdfPath = testInfo.outputPath('persistence.pdf')
  await makeTextPdf(pdfPath, ['PERSIST PAGE ONE', 'PERSIST PAGE TWO', 'PERSIST PAGE THREE'])
  await openFile(page, pdfPath)
  await page.locator('.floating-nav > button').nth(1).click(); await expect(pageNumber(page)).toHaveValue('2')
  await page.locator('.floating-nav > button').last().click(); await page.locator('.floating-nav > button').last().click()
  await expect(page.locator('.floating-nav > span').filter({ hasText: '%' })).toContainText('125%')
  await page.getByTitle('Document info').click(); await page.getByRole('button', { name: 'Save' }).click()
  await expect(stageStatus(page)).toContainText('Saved to local library'); await page.waitForTimeout(500)
  await page.reload(); await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.doc-title input')).toHaveValue('persistence.pdf')
  await expect(pageNumber(page)).toHaveValue('2')
  await expect(page.locator('.floating-nav > span').filter({ hasText: '%' })).toContainText('125%')
  await expect(page.getByTitle('Document info')).toHaveClass(/active/)
  await page.getByTitle('Close document').click(); await expect(page.locator('.welcome')).toBeVisible()
  await expect(page.locator('.recent-row')).toContainText('persistence.pdf')
  await page.reload(); await expect(page.locator('.welcome')).toBeVisible(); await expect(page.locator('.app-shell')).toHaveCount(0)
})

test('AcroForm fields can be discovered, edited, saved locally and restored', async ({ page }, testInfo) => {
  const formPdf = testInfo.outputPath('form.pdf')
  await makeFormPdf(formPdf); await openFile(page, formPdf); await page.getByTitle('Form fields').click()
  await expect(page.locator('.form-field')).toHaveCount(4)
  const nameField = page.locator('.form-field').filter({ hasText: 'qa_name' })
  await nameField.locator('input').fill('Jonas QA'); await nameField.locator('input').press('Tab')
  await page.locator('.form-field').filter({ hasText: 'qa_agree' }).locator('input[type="checkbox"]').check()
  await page.locator('.form-field').filter({ hasText: 'qa_choice' }).locator('select').selectOption({ label: 'Beta' })
  await page.locator('.form-field').filter({ hasText: 'qa_color' }).locator('select').selectOption({ label: 'Blue' })
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(600); await page.reload()
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 }); await page.getByTitle('Form fields').click()
  await expect(page.locator('.form-field').filter({ hasText: 'qa_name' }).locator('input')).toHaveValue('Jonas QA')
  await expect(page.locator('.form-field').filter({ hasText: 'qa_agree' }).locator('input[type="checkbox"]')).toBeChecked()
  await expect(page.locator('.form-field').filter({ hasText: 'qa_choice' }).locator('select')).toHaveValue('Beta')
  await expect(page.locator('.form-field').filter({ hasText: 'qa_color' }).locator('select')).toHaveValue('Blue')
})

test('image-only document is recognized by OCR locally, searchable, and cached', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  const scanPng = testInfo.outputPath('scan.png')
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.setContent(`<!doctype html><html><body style="margin:0;background:white;font-family:Arial,sans-serif"><div style="padding:140px 100px;color:#000"><div style="font-size:72px;font-weight:700">SCANNED ORBIT 73921</div><div style="font-size:44px;margin-top:60px">Private local OCR verification page</div><div style="font-size:34px;margin-top:45px">Invoice reference ZX-8844</div></div></body></html>`)
  await page.screenshot({ path: scanPng, fullPage: true })
  const outboundWrites: string[] = []
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method().toUpperCase())) {
      try {
        const url = new URL(request.url())
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') outboundWrites.push(`${request.method()} ${request.url()}`)
      } catch { /* ignore */ }
    }
  })
  await openFile(page, scanPng)
  const search = page.getByPlaceholder('Find in document')
  await search.fill('ORBIT 73921'); await search.press('Enter')
  await expect(page.locator('.ocr-activity')).toBeVisible({ timeout: 30_000 })
  await expect(stageStatus(page)).toContainText('1 matching page', { timeout: 180_000 })
  const cached = await page.evaluate(async () => await new Promise<{ text: string; words: number }[]>((resolve, reject) => {
    const request = indexedDB.open('pdf-forge-ocr')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const get = request.result.transaction('pages', 'readonly').objectStore('pages').getAll()
      get.onerror = () => reject(get.error)
      get.onsuccess = () => resolve(get.result.map((r: any) => ({ text: String(r.text || ''), words: Array.isArray(r.words) ? r.words.length : 0 })))
    }
  }))
  expect(cached.some((r) => r.text.toUpperCase().includes('ORBIT 73921') && r.words > 0)).toBeTruthy()
  expect(outboundWrites).toEqual([])
  await page.waitForTimeout(400); await page.reload(); await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
  const cachedSearch = page.getByPlaceholder('Find in document'); await cachedSearch.fill('ORBIT 73921'); await cachedSearch.press('Enter')
  await expect(stageStatus(page)).toContainText('1 matching page', { timeout: 20_000 })
})
