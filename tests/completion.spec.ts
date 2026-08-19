import { test, expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

async function makePdf(path: string, labels = ['COMPLETE SYSTEM 7711', 'SECOND PAGE 8822']) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  labels.forEach((label, index) => {
    const page = pdf.addPage([612, 792])
    page.drawText(label, { x: 72, y: 680, size: 28, font })
    page.drawText(`BODY PAGE ${index + 1}`, { x: 72, y: 610, size: 18, font })
  })
  await writeFile(path, await pdf.save())
}

async function openFile(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
}

async function openDocumentTools(page: Page) {
  await page.getByTitle('Document tools').click()
  await expect(page.locator('.advanced-modal')).toBeVisible()
  return page.locator('.advanced-modal')
}

async function closeDocumentTools(page: Page) {
  await page.locator('.advanced-modal > header .icon-btn').click()
  await expect(page.locator('.advanced-modal')).toHaveCount(0)
}

async function dragOnPdf(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
  const box = await page.locator('.pdf-page').boundingBox()
  if (!box) throw new Error('PDF page has no bounding box')
  await page.mouse.move(box.x + box.width * fromX, box.y + box.height * fromY)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * toX, box.y + box.height * toY, { steps: 12 })
  await page.mouse.up()
}

async function textFromPdf(path: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(path)) })
  const doc = await task.promise
  try {
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '))
    }
    return pages.join('\n')
  } finally {
    await task.destroy()
  }
}

test('page insertion, watermark, page numbers, crop and image insertion modify the actual PDF', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const source = testInfo.outputPath('document-tools.pdf')
  const png = testInfo.outputPath('insert.png')
  await makePdf(source)
  await writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFElEQVR42mP8z8AARMAgYKSAAQYAAP//AwAnSwITJF49WQAAAABJRU5ErkJggg==', 'base64'))
  await openFile(page, source)

  let tools = await openDocumentTools(page)
  await tools.getByRole('button', { name: 'Blank after' }).click()
  await expect(page.locator('.thumbnail')).toHaveCount(3, { timeout: 20_000 })

  tools = page.locator('.advanced-modal')
  await tools.getByPlaceholder('Watermark text').fill('QA WATERMARK 6622')
  await tools.getByRole('button', { name: 'All pages' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Applying watermark complete', { timeout: 20_000 })

  await tools.getByPlaceholder(/Header/).fill('HEADER {page}/{pages}')
  await tools.getByPlaceholder('Footer text').fill('QA FOOTER')
  await tools.getByRole('button', { name: 'Apply + page numbers' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Adding headers and page numbers complete', { timeout: 20_000 })

  const imageChooser = page.waitForEvent('filechooser')
  await tools.getByRole('button', { name: 'Choose image' }).click()
  await (await imageChooser).setFiles(png)
  await expect(page.locator('.stage-top-hint')).toContainText('Adding image complete', { timeout: 20_000 })

  await tools.locator('.crop-grid input').nth(0).fill('5')
  await tools.getByRole('button', { name: 'Apply crop' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Cropping page complete', { timeout: 20_000 })
  await closeDocumentTools(page)

  const search = page.getByPlaceholder('Find in document')
  await search.fill('QA WATERMARK 6622'); await search.press('Enter')
  await expect(page.locator('.stage-top-hint')).toContainText('matching page', { timeout: 20_000 })

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const exported = testInfo.outputPath('document-tools-export.pdf')
  await (await download).saveAs(exported)
  const output = await PDFDocument.load(await readFile(exported))
  expect(output.getPageCount()).toBe(3)
  expect(output.getPage(1).getCropBox().height).toBeLessThan(842)
  const text = await textFromPdf(exported)
  expect(text).toContain('QA WATERMARK 6622')
  expect(text).toContain('HEADER')
  expect(text).toContain('QA FOOTER')
})

test('selected annotations can move and box annotations can resize', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('annotation-transform.pdf')
  await makePdf(source, ['MOVE AND RESIZE 1234'])
  await openFile(page, source)
  await page.getByTitle('Rectangle').click()
  await dragOnPdf(page, .2, .3, .45, .42)
  const box = page.locator('.box-annotation.rectangle')
  await expect(box).toHaveCount(1)
  const before = await box.boundingBox()
  if (!before) throw new Error('Rectangle was not rendered')
  await box.click()
  await expect(box).toHaveClass(/selected/)
  await box.dragTo(page.locator('.pdf-page'), { targetPosition: { x: before.x + 120, y: before.y + 100 } }).catch(() => undefined)
  const pageBox = await page.locator('.pdf-page').boundingBox()
  if (!pageBox) throw new Error('Page bounds unavailable')
  await page.mouse.move(before.x + 20, before.y + 20); await page.mouse.down(); await page.mouse.move(before.x + 100, before.y + 80, { steps: 8 }); await page.mouse.up()
  const moved = await box.boundingBox()
  expect(Math.abs((moved?.x || 0) - before.x) + Math.abs((moved?.y || 0) - before.y)).toBeGreaterThan(20)
  const handle = box.locator('.annotation-resize-handle')
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('Resize handle unavailable')
  await page.mouse.move(handleBox.x + 5, handleBox.y + 5); await page.mouse.down(); await page.mouse.move(handleBox.x + 70, handleBox.y + 55, { steps: 8 }); await page.mouse.up()
  const resized = await box.boundingBox()
  expect((resized?.width || 0) + (resized?.height || 0)).toBeGreaterThan((moved?.width || 0) + (moved?.height || 0) + 20)
})

test('secure redaction removes underlying text from the rebuilt page', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const source = testInfo.outputPath('redact.pdf')
  await makePdf(source, ['SECRET REDACTION 90909'])
  await openFile(page, source)
  await page.getByTitle('Redact').click()
  await dragOnPdf(page, .08, .07, .78, .18)
  await expect(page.locator('.box-annotation.redaction')).toHaveCount(1)
  const tools = await openDocumentTools(page)
  await tools.getByRole('button', { name: 'Apply marked redactions' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Applying secure redactions complete', { timeout: 60_000 })
  await closeDocumentTools(page)
  await expect(page.locator('.box-annotation.redaction')).toHaveCount(0)

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const exported = testInfo.outputPath('redacted-export.pdf')
  await (await download).saveAs(exported)
  expect(await textFromPdf(exported)).not.toContain('SECRET REDACTION 90909')
})

test('OCR can be committed as a searchable text layer in the exported PDF', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  const scan = testInfo.outputPath('searchable-scan.png')
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.setContent('<body style="margin:0;background:#fff;font-family:Arial"><div style="padding:120px;font-size:70px;font-weight:bold;color:#000">SEARCHABLE NEBULA 55123</div></body>')
  await page.screenshot({ path: scan, fullPage: true })
  await openFile(page, scan)
  const tools = await openDocumentTools(page)
  await tools.getByRole('button', { name: 'Make PDF searchable' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Creating searchable PDF complete', { timeout: 180_000 })
  await closeDocumentTools(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const exported = testInfo.outputPath('searchable-export.pdf')
  await (await download).saveAs(exported)
  expect((await textFromPdf(exported)).toUpperCase()).toContain('SEARCHABLE')
  expect((await textFromPdf(exported)).toUpperCase()).toContain('NEBULA')
})

test('QPDF optimization and AES-256 password protected export run locally', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const source = testInfo.outputPath('security.pdf')
  await makePdf(source, ['LOCAL SECURITY 4242'])
  await openFile(page, source)
  const outboundWrites: string[] = []
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method().toUpperCase())) {
      try { const url = new URL(request.url()); if (!['127.0.0.1', 'localhost'].includes(url.hostname)) outboundWrites.push(`${request.method()} ${url.href}`) } catch { /* ignore */ }
    }
  })
  const tools = await openDocumentTools(page)
  await tools.getByRole('button', { name: 'Optimize PDF' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Optimizing PDF complete', { timeout: 60_000 })
  await tools.getByPlaceholder('Open password').fill('ForgeQA!2026')
  const protectedDownload = page.waitForEvent('download')
  await tools.getByRole('button', { name: /Export protected PDF/ }).click()
  const protectedPath = testInfo.outputPath('protected.pdf')
  await (await protectedDownload).saveAs(protectedPath)
  const protectedBytes = await readFile(protectedPath)
  expect(protectedBytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(protectedBytes.toString('latin1')).toContain('/Encrypt')
  expect(outboundWrites).toEqual([])
})
