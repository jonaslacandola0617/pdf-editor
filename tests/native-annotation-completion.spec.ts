import { expect, test, type Page } from '@playwright/test'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
} from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

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

function numbers(array: PDFArray | undefined) {
  if (!array) return []
  const result: number[] = []
  for (let index = 0; index < array.size(); index++) {
    const value = array.lookup(index, PDFNumber)
    if (value) result.push(value.asNumber())
  }
  return result
}

function decodeText(value: unknown) {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : ''
}

function annotations(pdf: PDFDocument) {
  return pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
}

function findAnnot(pdf: PDFDocument, subtype: string) {
  const annots = annotations(pdf)
  if (!annots) return null
  for (let index = 0; index < annots.size(); index++) {
    const dict = pdf.context.lookup(annots.get(index), PDFDict)
    if (dict?.get(PDFName.of('Subtype'))?.toString() === `/${subtype}`) return dict
  }
  return null
}

async function makeExtendedPdf(path: string) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([612, 792])
  page.drawText('EXTENDED ANNOTATION QA 9901', { x: 72, y: 730, size: 18, font })
  const annots = pdf.context.obj([]) as PDFArray
  page.node.set(PDFName.of('Annots'), annots)

  const push = (dict: PDFDict) => annots.push(pdf.context.register(dict))
  push(pdf.context.obj({ Type: 'Annot', Subtype: 'Ink', Rect: [80, 600, 180, 660], InkList: [[90, 610, 110, 640, 160, 620]], C: [0, 0, 1], CA: 0.8, BS: { Type: 'Border', S: 'S', W: 2 }, Contents: 'ink old', T: 'artist', NM: 'ink-preserve' }) as PDFDict)
  push(pdf.context.obj({ Type: 'Annot', Subtype: 'Polygon', Rect: [210, 600, 310, 660], Vertices: [220, 610, 260, 650, 300, 610], C: [1, 0, 0], IC: [1, 0.8, 0.8], CA: 0.7, BS: { Type: 'Border', S: 'S', W: 1 }, Contents: 'polygon old' }) as PDFDict)
  push(pdf.context.obj({ Type: 'Annot', Subtype: 'PolyLine', Rect: [330, 600, 430, 660], Vertices: [340, 610, 380, 650, 420, 615], C: [0, 0.5, 0], CA: 0.9, BS: { Type: 'Border', S: 'S', W: 1 } }) as PDFDict)
  push(pdf.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [80, 500, 180, 550], Name: 'Approved', Contents: 'stamp old', CA: 1 }) as PDFDict)
  push(pdf.context.obj({ Type: 'Annot', Subtype: 'Caret', Rect: [220, 500, 250, 530], Sy: 'None', Contents: 'caret old', C: [0.8, 0.2, 0.2] }) as PDFDict)

  const payload = new TextEncoder().encode('PAGE ATTACHMENT PAYLOAD 9912')
  const stream = pdf.context.flateStream(payload, { Type: 'EmbeddedFile', Params: { Size: payload.byteLength } })
  const streamRef = pdf.context.register(stream)
  const spec = pdf.context.obj({
    Type: 'Filespec',
    F: PDFString.of('page-attachment.txt'),
    UF: PDFHexString.fromText('page-attachment.txt'),
    EF: { F: streamRef, UF: streamRef },
  }) as PDFDict
  const specRef = pdf.context.register(spec)
  push(pdf.context.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [330, 500, 360, 530], FS: specRef, Name: 'PushPin', Contents: 'page attachment' }) as PDFDict)

  await writeFile(path, await pdf.save())
}

async function makeGeometryPdf(path: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([600, 800])
  const annots = pdf.context.obj([]) as PDFArray
  page.node.set(PDFName.of('Annots'), annots)
  annots.push(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [60, 560, 180, 680], C: [1, 0, 0], IC: [1, 1, 0], CA: 1, BS: { W: 2 }, NM: 'square-geometry' }) as PDFDict))
  annots.push(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [60, 430, 300, 470], QuadPoints: [60, 470, 300, 470, 60, 430, 300, 430], C: [1, 1, 0], CA: 0.5, Contents: 'highlight geometry' }) as PDFDict))
  await writeFile(path, await pdf.save())
}

async function makeCommentDetailPdf(path: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([600, 800])
  const annots = pdf.context.obj([]) as PDFArray
  page.node.set(PDFName.of('Annots'), annots)
  annots.push(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [60, 650, 90, 680], Name: 'Note', Open: false, Contents: 'sticky old', T: 'Sticky Author', NM: 'sticky-detail' }) as PDFDict))
  annots.push(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [120, 540, 360, 620], Contents: 'free text old', T: 'Free Author', DA: PDFString.of('/Helv 12 Tf 0 g'), Q: 0, AP: { N: {} }, NM: 'freetext-detail' }) as PDFDict))
  await writeFile(path, await pdf.save())
}

test('manages Ink, Polygon, PolyLine, Stamp, Caret and page FileAttachment annotations', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('extended-source.pdf')
  await makeExtendedPdf(source)
  await openFile(page, source)

  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  const manager = modal.locator('.native-extended-manager')
  await expect(manager).toContainText('Ink 1')
  await expect(manager).toContainText('Polygon 1')
  await expect(manager).toContainText('PolyLine 1')
  await expect(manager).toContainText('Stamp 1')
  await expect(manager).toContainText('Caret 1')
  await expect(manager).toContainText('FileAttachment 1')

  const ink = manager.locator('.native-extended-row').filter({ hasText: '· Ink' })
  await ink.getByLabel(/Extended annotation color/).fill('#3366cc')
  await ink.getByLabel(/Extended annotation opacity/).fill('55')
  await ink.getByLabel(/Extended annotation x /).fill('20')
  await ink.getByLabel(/Extended annotation y /).fill('10')
  await ink.getByLabel(/Extended annotation width/).fill('30')
  await ink.getByLabel(/Extended annotation height/).fill('10')
  await ink.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native annotation complete', { timeout: 20_000 })

  const caret = manager.locator('.native-extended-row').filter({ hasText: '· Caret' })
  await caret.getByLabel(/Caret symbol/).selectOption('P')
  await caret.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native annotation complete', { timeout: 20_000 })

  const attachment = manager.locator('.native-extended-row').filter({ hasText: '· FileAttachment' })
  await attachment.getByLabel(/Page attachment icon/).selectOption('Paperclip')
  await attachment.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native annotation complete', { timeout: 20_000 })
  const attachmentAfter = manager.locator('.native-extended-row').filter({ hasText: '· FileAttachment' })
  const downloadEvent = page.waitForEvent('download')
  await attachmentAfter.getByRole('button', { name: 'Extract' }).click()
  const downloaded = await downloadEvent
  const extractedPath = testInfo.outputPath('page-attachment-extracted.txt')
  await downloaded.saveAs(extractedPath)
  expect((await readFile(extractedPath)).toString()).toBe('PAGE ATTACHMENT PAYLOAD 9912')

  const stamp = manager.locator('.native-extended-row').filter({ hasText: '· Stamp' })
  await stamp.getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Deleting native annotation complete', { timeout: 20_000 })
  await expect(manager).not.toContainText('Stamp 1')

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('extended-export.pdf')
  await exportPdf(page, exported)
  const pdf = await PDFDocument.load(await readFile(exported))
  expect(findAnnot(pdf, 'Stamp')).toBeNull()

  const inkDict = findAnnot(pdf, 'Ink')!
  expect(inkDict.get(PDFName.of('NM'))?.toString()).toContain('ink-preserve')
  expect(inkDict.lookupMaybe(PDFName.of('CA'), PDFNumber)?.asNumber()).toBeCloseTo(0.55, 5)
  const inkColor = numbers(inkDict.lookupMaybe(PDFName.of('C'), PDFArray))
  expect(inkColor[0]).toBeCloseTo(0.2, 5)
  expect(inkColor[1]).toBeCloseTo(0.4, 5)
  expect(inkColor[2]).toBeCloseTo(0.8, 5)
  const inkList = inkDict.lookupMaybe(PDFName.of('InkList'), PDFArray)!
  const firstPath = inkList.lookup(0, PDFArray)!
  const pathValues = numbers(firstPath)
  expect(Math.min(...pathValues.filter((_, i) => i % 2 === 0))).toBeCloseTo(122.4, 1)
  expect(Math.max(...pathValues.filter((_, i) => i % 2 === 0))).toBeCloseTo(306, 1)

  const caretDict = findAnnot(pdf, 'Caret')!
  expect(caretDict.get(PDFName.of('Sy'))?.toString()).toBe('/P')
  const attachmentDict = findAnnot(pdf, 'FileAttachment')!
  expect(attachmentDict.get(PDFName.of('Name'))?.toString()).toBe('/Paperclip')
  expect(findAnnot(pdf, 'Polygon')).not.toBeNull()
  expect(findAnnot(pdf, 'PolyLine')).not.toBeNull()
})

test('moves and resizes native Square/Circle-style rectangles and transforms text markup QuadPoints', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('geometry-source.pdf')
  await makeGeometryPdf(source)
  await openFile(page, source)
  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')

  const square = modal.locator('.native-shape-row').filter({ hasText: 'Square' })
  await square.getByLabel(/Native shape x /).fill('20')
  await square.getByLabel(/Native shape y /).fill('15')
  await square.getByLabel(/Native shape width/).fill('30')
  await square.getByLabel(/Native shape height/).fill('20')
  await square.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native shape annotation complete', { timeout: 20_000 })

  const markup = modal.locator('.native-markup-row').filter({ hasText: 'Highlight' })
  await markup.getByLabel(/Native markup x /).fill('10')
  await markup.getByLabel(/Native markup y /).fill('40')
  await markup.getByLabel(/Native markup width/).fill('50')
  await markup.getByLabel(/Native markup height/).fill('8')
  await markup.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating text markup annotation complete', { timeout: 20_000 })

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('geometry-export.pdf')
  await exportPdf(page, exported)
  const pdf = await PDFDocument.load(await readFile(exported))

  const squareDict = findAnnot(pdf, 'Square')!
  expect(numbers(squareDict.lookupMaybe(PDFName.of('Rect'), PDFArray))).toEqual([120, 520, 300, 680])

  const highlight = findAnnot(pdf, 'Highlight')!
  const quads = numbers(highlight.lookupMaybe(PDFName.of('QuadPoints'), PDFArray))
  expect(Math.min(...quads.filter((_, i) => i % 2 === 0))).toBeCloseTo(60, 5)
  expect(Math.max(...quads.filter((_, i) => i % 2 === 0))).toBeCloseTo(360, 5)
  expect(Math.min(...quads.filter((_, i) => i % 2 === 1))).toBeCloseTo(416, 5)
  expect(Math.max(...quads.filter((_, i) => i % 2 === 1))).toBeCloseTo(480, 5)
  expect(numbers(highlight.lookupMaybe(PDFName.of('Rect'), PDFArray))).toEqual([60, 416, 360, 480])
})

test('edits sticky-note placement/icon/open state and FreeText typography without stale appearances', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('comment-detail-source.pdf')
  await makeCommentDetailPdf(source)
  await openFile(page, source)
  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  const manager = modal.locator('.native-comment-detail-manager')

  const sticky = manager.locator('.native-comment-detail-row').filter({ hasText: '· Text' })
  await sticky.getByLabel(/Detailed native comment x /).fill('25')
  await sticky.getByLabel(/Detailed native comment y /).fill('10')
  await sticky.getByLabel(/Detailed native comment width/).fill('8')
  await sticky.getByLabel(/Detailed native comment height/).fill('6')
  await sticky.getByLabel(/Native sticky icon/).selectOption('Help')
  await sticky.getByLabel(/Native sticky open/).check()
  await sticky.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native comment appearance complete', { timeout: 20_000 })

  const free = manager.locator('.native-comment-detail-row').filter({ hasText: '· FreeText' })
  await free.getByLabel(/Detailed native comment text/).fill('free text updated')
  await free.getByLabel(/Native FreeText font size/).fill('18')
  await free.getByLabel(/Native FreeText color/).fill('#ff0000')
  await free.getByLabel(/Native FreeText alignment/).selectOption('2')
  await free.getByLabel(/Detailed native comment x /).fill('30')
  await free.getByLabel(/Detailed native comment y /).fill('25')
  await free.getByLabel(/Detailed native comment width/).fill('40')
  await free.getByLabel(/Detailed native comment height/).fill('12')
  await free.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native comment appearance complete', { timeout: 20_000 })

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('comment-detail-export.pdf')
  await exportPdf(page, exported)
  const pdf = await PDFDocument.load(await readFile(exported))
  const stickyDict = findAnnot(pdf, 'Text')!
  expect(stickyDict.get(PDFName.of('Name'))?.toString()).toBe('/Help')
  expect(stickyDict.get(PDFName.of('Open'))?.toString()).toBe('true')
  expect(numbers(stickyDict.lookupMaybe(PDFName.of('Rect'), PDFArray))).toEqual([150, 672, 198, 720])

  const freeDict = findAnnot(pdf, 'FreeText')!
  expect(decodeText(freeDict.lookup(PDFName.of('Contents')))).toBe('free text updated')
  expect(decodeText(freeDict.lookup(PDFName.of('DA')))).toContain('18 Tf')
  expect(decodeText(freeDict.lookup(PDFName.of('DA')))).toContain('1.0000 0.0000 0.0000 rg')
  expect(freeDict.lookupMaybe(PDFName.of('Q'), PDFNumber)?.asNumber()).toBe(2)
  expect(freeDict.has(PDFName.of('AP'))).toBe(false)
  expect(numbers(freeDict.lookupMaybe(PDFName.of('Rect'), PDFArray))).toEqual([180, 504, 420, 600])
})
