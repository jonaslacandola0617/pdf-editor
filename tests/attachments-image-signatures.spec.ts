import { expect, test, type Page } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

async function makePdf(path: string) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([612, 792])
  page.drawText('ATTACHMENT AND IMAGE SIGNATURE QA 8899', { x: 64, y: 680, size: 22, font })
  await writeFile(path, await pdf.save())
}

async function openFile(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
}

async function exportPdf(page: Page, path: string) {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  await (await download).saveAs(path)
}

function textValue(value: unknown) {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  return ''
}

function nameTreeLeaves(node: PDFDict, output: PDFDict[]) {
  if (node.has(PDFName.of('Names'))) output.push(node)
  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray)
  if (!kids) return
  for (let index = 0; index < kids.size(); index++) {
    const child = kids.lookup(index, PDFDict)
    if (child) nameTreeLeaves(child, output)
  }
}

async function extractAttachments(path: string) {
  const pdf = await PDFDocument.load(await readFile(path))
  const namesRoot = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  const embedded = namesRoot?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
  if (!embedded) return [] as Array<{ name: string; data: Uint8Array }>
  const leaves: PDFDict[] = []
  nameTreeLeaves(embedded, leaves)
  const result: Array<{ name: string; data: Uint8Array }> = []
  for (const leaf of leaves) {
    const names = leaf.lookupMaybe(PDFName.of('Names'), PDFArray)
    if (!names) continue
    for (let index = 0; index + 1 < names.size(); index += 2) {
      const name = textValue(names.lookup(index))
      const spec = names.lookup(index + 1, PDFDict)
      const ef = spec?.lookupMaybe(PDFName.of('EF'), PDFDict)
      const streamRef = ef?.get(PDFName.of('UF')) || ef?.get(PDFName.of('F'))
      const stream = streamRef ? pdf.context.lookup(streamRef) : undefined
      if (stream instanceof PDFRawStream) result.push({ name, data: decodePDFRawStream(stream).decode() })
    }
  }
  return result
}

async function imageXObjectCount(path: string) {
  const pdf = await PDFDocument.load(await readFile(path))
  const resources = pdf.getPage(0).node.Resources()
  const xObjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
  if (!xObjects) return 0
  let count = 0
  for (const key of xObjects.keys()) {
    const object = pdf.context.lookup(xObjects.get(key))
    if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') count++
  }
  return count
}

test('adds, extracts and removes a real embedded PDF attachment', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('attachment-source.pdf')
  await makePdf(source)
  await openFile(page, source)

  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  await expect(modal).toBeVisible()
  await modal.getByLabel('Attachment description').fill('QA text attachment')
  const payload = Buffer.from('ATTACHMENT PAYLOAD 8833\nsecond line\n', 'utf8')
  await modal.locator('.attachment-manager input[type="file"]').setInputFiles({ name: 'evidence.txt', mimeType: 'text/plain', buffer: payload })
  await expect(modal.locator('.attachment-list')).toContainText('evidence.txt', { timeout: 20_000 })
  await expect(modal.locator('.attachment-list')).toContainText('QA text attachment')

  const extractDownload = page.waitForEvent('download')
  await modal.getByTitle('Extract evidence.txt').click()
  const extractedPath = testInfo.outputPath('evidence-extracted.txt')
  await (await extractDownload).saveAs(extractedPath)
  expect(Buffer.compare(await readFile(extractedPath), payload)).toBe(0)

  await modal.getByTitle('Close embedded objects').click()
  const withAttachment = testInfo.outputPath('with-attachment.pdf')
  await exportPdf(page, withAttachment)
  const attachments = await extractAttachments(withAttachment)
  expect(attachments).toHaveLength(1)
  expect(attachments[0].name).toBe('evidence.txt')
  expect(Buffer.compare(Buffer.from(attachments[0].data), payload)).toBe(0)

  await page.getByTitle('Embedded PDF objects').click()
  await modal.getByTitle('Remove evidence.txt').click()
  await expect(modal.getByText('No embedded file attachments found.')).toBeVisible({ timeout: 20_000 })
  await modal.getByTitle('Close embedded objects').click()
  const withoutAttachment = testInfo.outputPath('without-attachment.pdf')
  await exportPdf(page, withoutAttachment)
  expect(await extractAttachments(withoutAttachment)).toHaveLength(0)
})

test('imports a reusable local PNG signature and embeds it as a page image', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('image-signature-source.pdf')
  await makePdf(source)
  await openFile(page, source)

  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  await expect(modal).toBeVisible()
  const manager = modal.locator('.image-signature-manager')
  await manager.getByLabel('Preset name').fill('QA Image Signature')

  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAaYvJ9sAAAAASUVORK5CYII=', 'base64')
  await manager.locator('input[type="file"]').setInputFiles({ name: 'signature.png', mimeType: 'image/png', buffer: tinyPng })
  await expect(manager).toContainText('QA Image Signature', { timeout: 20_000 })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pdf-forge-image-signatures') || '')).toContain('QA Image Signature')

  await manager.getByLabel('Image signature X percent').fill('50')
  await manager.getByLabel('Image signature Y percent').fill('70')
  await manager.getByLabel('Image signature width percent').fill('25')
  await manager.getByLabel('Image signature opacity').fill('90')
  await manager.getByRole('button', { name: 'Place on page 1' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('QA Image Signature placed on page 1', { timeout: 20_000 })
  await modal.getByTitle('Close embedded objects').click()

  const exported = testInfo.outputPath('image-signature-export.pdf')
  await exportPdf(page, exported)
  expect(await imageXObjectCount(exported)).toBeGreaterThan(0)

  await page.getByTitle('Embedded PDF objects').click()
  await expect(modal.locator('.image-signature-manager').getByRole('button', { name: 'QA Image Signature', exact: true })).toBeVisible()
})
