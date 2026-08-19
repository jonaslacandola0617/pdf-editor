import { expect, test, type Page } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, StandardFonts } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

async function makePdf(path: string) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < 2; index++) {
    const page = pdf.addPage([612, 792])
    page.drawText(`DOCUMENT VIEW QA PAGE ${index + 1}`, { x: 66, y: 684, size: 24, font })
  }
  await writeFile(path, await pdf.save())
}

async function openFile(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
}

async function openObjects(page: Page) {
  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  await expect(modal).toBeVisible()
  await expect(modal.locator('.document-view-manager')).toBeVisible()
  return modal
}

async function exportPdf(page: Page, path: string) {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  await (await download).saveAs(path)
}

function findSignature(data: Buffer, signature: number[]) {
  outer: for (let offset = 0; offset <= data.length - signature.length; offset++) {
    for (let index = 0; index < signature.length; index++) if (data[offset + index] !== signature[index]) continue outer
    return offset
  }
  return -1
}

test('writes native page labels and initial-view catalog preferences into the PDF', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('document-view-source.pdf')
  await makePdf(source)
  await openFile(page, source)
  const modal = await openObjects(page)

  await modal.getByLabel('Page label start page').fill('1')
  await modal.getByLabel('Page label style').selectOption('roman-lower')
  await modal.getByLabel('Page label prefix').fill('Sec-')
  await modal.getByLabel('Page label start number').fill('4')
  await modal.getByRole('button', { name: 'Add / replace rule' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating page labels complete', { timeout: 20_000 })

  await modal.getByLabel('Page label start page').fill('2')
  await modal.getByLabel('Page label style').selectOption('decimal')
  await modal.getByLabel('Page label prefix').fill('B-')
  await modal.getByLabel('Page label start number').fill('1')
  await modal.getByRole('button', { name: 'Add / replace rule' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating page labels complete', { timeout: 20_000 })
  await expect(modal.locator('.page-label-rules')).toContainText('Page 1')
  await expect(modal.locator('.page-label-rules')).toContainText('Page 2')

  await modal.getByLabel('Initial view start page').fill('2')
  await modal.getByLabel('Initial view magnification').selectOption('fit-width')
  await modal.getByLabel('Initial view panel').selectOption('outlines')
  await modal.getByLabel('Initial view layout').selectOption('two-column-right')
  await modal.getByRole('button', { name: 'Save initial view' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Saving initial view complete', { timeout: 20_000 })
  await modal.getByTitle('Close embedded objects').click()

  const exported = testInfo.outputPath('document-view-export.pdf')
  await exportPdf(page, exported)
  const pdf = await PDFDocument.load(await readFile(exported))
  const pageLabels = pdf.catalog.lookupMaybe(PDFName.of('PageLabels'), PDFDict)
  const nums = pageLabels?.lookupMaybe(PDFName.of('Nums'), PDFArray)
  expect(nums?.size()).toBe(4)

  expect(nums?.lookup(0, PDFNumber)?.asNumber()).toBe(0)
  const first = nums?.lookup(1, PDFDict)
  expect(first?.get(PDFName.of('S'))?.toString()).toBe('/r')
  expect(first?.lookupMaybe(PDFName.of('P'), PDFHexString)?.decodeText()).toBe('Sec-')
  expect(first?.lookupMaybe(PDFName.of('St'), PDFNumber)?.asNumber()).toBe(4)

  expect(nums?.lookup(2, PDFNumber)?.asNumber()).toBe(1)
  const second = nums?.lookup(3, PDFDict)
  expect(second?.get(PDFName.of('S'))?.toString()).toBe('/D')
  expect(second?.lookupMaybe(PDFName.of('P'), PDFHexString)?.decodeText()).toBe('B-')

  expect(pdf.catalog.get(PDFName.of('PageMode'))?.toString()).toBe('/UseOutlines')
  expect(pdf.catalog.get(PDFName.of('PageLayout'))?.toString()).toBe('/TwoColumnRight')
  const action = pdf.catalog.lookupMaybe(PDFName.of('OpenAction'), PDFArray)
  expect(action?.get(0)?.toString()).toBe(pdf.getPage(1).ref.toString())
  expect(action?.get(1)?.toString()).toBe('/FitH')
})

test('exports a real PNG and a multi-page JPG ZIP entirely in the browser', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('image-export-source.pdf')
  await makePdf(source)
  await openFile(page, source)
  const modal = await openObjects(page)

  await modal.getByLabel('Image export pages').selectOption('current')
  await modal.getByLabel('Image export format').selectOption('png')
  await modal.getByLabel('Image export DPI').fill('96')
  let download = page.waitForEvent('download')
  await modal.getByRole('button', { name: 'Export page images' }).click()
  const pngPath = testInfo.outputPath('page-export.png')
  await (await download).saveAs(pngPath)
  const png = await readFile(pngPath)
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png.readUInt32BE(16)).toBe(816)
  expect(png.readUInt32BE(20)).toBe(1056)
  await expect(page.locator('.stage-top-hint')).toContainText('1 page image exported', { timeout: 20_000 })

  await modal.getByLabel('Image export pages').selectOption('all')
  await modal.getByLabel('Image export format').selectOption('jpeg')
  await modal.getByLabel('Image export DPI').fill('72')
  await modal.getByLabel('Image export JPEG quality').fill('80')
  download = page.waitForEvent('download')
  await modal.getByRole('button', { name: 'Export page images' }).click()
  const zipPath = testInfo.outputPath('page-images.zip')
  await (await download).saveAs(zipPath)
  const zip = await readFile(zipPath)
  expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  expect(findSignature(zip, [0x50, 0x4b, 0x05, 0x06])).toBeGreaterThan(0)
  const zipText = zip.toString('latin1')
  expect(zipText).toContain('page-001.jpg')
  expect(zipText).toContain('page-002.jpg')
  await expect(page.locator('.stage-top-hint')).toContainText('2 page images exported', { timeout: 20_000 })
})
