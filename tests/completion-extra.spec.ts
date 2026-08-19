import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

async function makePdf(path: string, labels: string[]) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const label of labels) {
    const page = pdf.addPage([612, 792])
    page.drawText(label, { x: 72, y: 680, size: 28, font })
    page.drawText('PDF FORGE EXTRA COMPLETION QA', { x: 72, y: 620, size: 16, font })
  }
  await writeFile(path, await pdf.save())
}

async function openFile(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
}

async function textPages(path: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(path)) })
  const document = await task.promise
  try {
    const pages: string[] = []
    for (let index = 1; index <= document.numPages; index++) {
      const content = await (await document.getPage(index)).getTextContent()
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '))
    }
    return pages
  } finally {
    await task.destroy()
  }
}

test('insert file before/after puts external PDF pages at the requested position', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('insert-source.pdf')
  const incoming = testInfo.outputPath('insert-incoming.pdf')
  await makePdf(source, ['SOURCE PAGE ONE', 'SOURCE PAGE TWO'])
  await makePdf(incoming, ['INSERTED PAGE MIDDLE'])
  await openFile(page, source)

  await page.getByTitle('Document tools').click()
  const tools = page.locator('.advanced-modal')
  await expect(tools).toBeVisible()

  const chooser = page.waitForEvent('filechooser')
  await tools.getByRole('button', { name: 'Insert file after' }).click()
  await (await chooser).setFiles(incoming)
  await expect(page.locator('.thumbnail')).toHaveCount(3, { timeout: 20_000 })
  await expect(page.locator('.stage-top-hint')).toContainText('Inserted 1 page', { timeout: 20_000 })

  await tools.locator('header .icon-btn').click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const exported = testInfo.outputPath('insert-export.pdf')
  await (await download).saveAs(exported)

  const pages = await textPages(exported)
  expect(pages).toHaveLength(3)
  expect(pages[0]).toContain('SOURCE PAGE ONE')
  expect(pages[1]).toContain('INSERTED PAGE MIDDLE')
  expect(pages[2]).toContain('SOURCE PAGE TWO')
})

test('strong compression rebuilds the PDF as raster pages and exports a valid document', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const source = testInfo.outputPath('compress-source.pdf')
  await makePdf(source, ['RASTER COMPRESSION PAGE ONE', 'RASTER COMPRESSION PAGE TWO'])
  await openFile(page, source)

  await page.getByTitle('Document tools').click()
  const tools = page.locator('.advanced-modal')
  await tools.getByRole('button', { name: 'Compress aggressively' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Strong compression complete', { timeout: 60_000 })
  await tools.locator('header .icon-btn').click()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const exported = testInfo.outputPath('compressed-export.pdf')
  await (await download).saveAs(exported)

  const output = await PDFDocument.load(await readFile(exported))
  expect(output.getPageCount()).toBe(2)
  const pages = await textPages(exported)
  expect(pages.join(' ').trim()).toBe('')
  const header = (await readFile(exported)).subarray(0, 5).toString()
  expect(header).toBe('%PDF-')
})
