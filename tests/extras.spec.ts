import { expect, test, type Page } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

async function makePdf(path: string, label = 'EXTRAS QA 5511') {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([612, 792])
  page.drawText(label, { x: 72, y: 680, size: 28, font })
  await writeFile(path, await pdf.save())
}

async function openFile(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
}

async function pointOnPdf(page: Page, x: number, y: number) {
  const box = await page.locator('.pdf-page').boundingBox()
  if (!box) throw new Error('PDF page has no bounding box')
  return { x: box.x + box.width * x, y: box.y + box.height * y }
}

async function drawOnPdf(page: Page, points: Array<[number, number]>) {
  const first = await pointOnPdf(page, points[0][0], points[0][1])
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const [x, y] of points.slice(1)) {
    const point = await pointOnPdf(page, x, y)
    await page.mouse.move(point.x, point.y, { steps: 5 })
  }
  await page.mouse.up()
}

function exportedTextNotes(path: string) {
  return readFile(path).then(async (bytes) => {
    const pdf = await PDFDocument.load(bytes)
    const annots = pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) return []
    const notes: string[] = []
    for (let index = 0; index < annots.size(); index++) {
      const dict = pdf.context.lookup(annots.get(index), PDFDict)
      if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Text') continue
      const contents = dict.lookup(PDFName.of('Contents'))
      if (contents instanceof PDFHexString || contents instanceof PDFString) notes.push(contents.decodeText())
    }
    return notes
  })
}

test('sticky notes persist in editor state and export as native PDF comments', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('note-source.pdf')
  await makePdf(source)
  await openFile(page, source)

  await page.getByTitle('Sticky note').click()
  const target = await pointOnPdf(page, 0.42, 0.35)
  await page.mouse.click(target.x, target.y)
  await expect(page.locator('.note-annotation')).toHaveCount(1)

  const commentEditor = page.locator('.right-panel textarea[placeholder="Write a comment…"]')
  await expect(commentEditor).toBeVisible()
  await commentEditor.fill('Native comment QA 9922')

  await page.getByTitle('Comments').click()
  await expect(page.locator('.comment-list')).toContainText('Native comment QA 9922')
  await expect(page.locator('.left-panel')).toContainText('1')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const exported = testInfo.outputPath('note-export.pdf')
  await (await download).saveAs(exported)
  await expect.poll(async () => exportedTextNotes(exported)).toContain('Native comment QA 9922')
})

test('drawn signatures can be saved locally and reinserted', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('signature-source.pdf')
  await makePdf(source, 'SIGNATURE QA 6644')
  await openFile(page, source)

  await page.getByTitle('Signature').click()
  await drawOnPdf(page, [[0.30, 0.65], [0.34, 0.62], [0.38, 0.67], [0.43, 0.61], [0.49, 0.65]])
  await expect(page.locator('.ink-hitbox')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Save this signature' })).toBeVisible()

  page.once('dialog', async (dialog) => dialog.accept('QA Signature'))
  await page.getByRole('button', { name: 'Save this signature' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pdf-forge-signatures') || '')).toContain('QA Signature')

  await page.keyboard.press('Escape')
  await page.getByTitle('Signature').click()
  await expect(page.getByRole('button', { name: 'QA Signature' })).toBeVisible()
  await page.getByRole('button', { name: 'QA Signature' }).click()
  await expect(page.locator('.ink-hitbox')).toHaveCount(2)
})

test('bookmarks and favorites drawer favorites the active local PDF', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('favorite-source.pdf')
  await makePdf(source, 'FAVORITE QA 7733')
  await openFile(page, source)

  await page.getByTitle('Bookmarks & favorites').click()
  const drawer = page.locator('.nav-extras-drawer')
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText('This PDF has no embedded bookmarks.')

  await drawer.getByTitle('Favorite this document').click()
  await expect(drawer).toContainText('favorite-source.pdf')
  await page.getByTitle('Close bookmarks').click()

  await page.getByTitle('Bookmarks & favorites').click()
  await expect(page.locator('.favorite-doc-list')).toContainText('favorite-source.pdf')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pdf-forge-favorites') || '[]').length)).toBe(1)
})
