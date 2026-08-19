import { expect, test, type Page } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, StandardFonts } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

const HIGHLIGHT_QUADS = [72, 652, 248, 652, 72, 630, 248, 630]
const UNDERLINE_QUADS = [72, 602, 228, 602, 72, 580, 228, 580]

async function makeMarkupPdf(path: string) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([612, 792])
  page.drawText('NATIVE MARKUP QA 9933', { x: 72, y: 680, size: 22, font })
  page.drawText('Highlighted source text', { x: 72, y: 634, size: 16, font })
  page.drawText('Underlined source text', { x: 72, y: 584, size: 16, font })

  const annots = pdf.context.obj([]) as PDFArray
  page.node.set(PDFName.of('Annots'), annots)

  const highlight = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: [70, 628, 252, 654],
    QuadPoints: HIGHLIGHT_QUADS,
    Contents: PDFHexString.fromText('External highlight comment 9944'),
    T: PDFHexString.fromText('External Highlighter'),
    C: [1, 1, 0],
    CA: 0.4,
  }) as PDFDict
  annots.push(pdf.context.register(highlight))

  const underline = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Underline',
    Rect: [70, 578, 232, 604],
    QuadPoints: UNDERLINE_QUADS,
    Contents: PDFHexString.fromText('External underline comment 9955'),
    T: PDFHexString.fromText('External Underliner'),
    C: [0.1, 0.7, 0.2],
    CA: 0.85,
  }) as PDFDict
  annots.push(pdf.context.register(underline))

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

function decodeText(value: unknown) {
  return value instanceof PDFHexString ? value.decodeText() : ''
}

function arrayNumbers(array: PDFArray | undefined) {
  if (!array) return []
  const values: number[] = []
  for (let index = 0; index < array.size(); index++) {
    const value = array.lookup(index, PDFNumber)
    if (value) values.push(value.asNumber())
  }
  return values
}

test('edits native text markup appearance and metadata while preserving QuadPoints, and deletes another markup', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('native-markups-source.pdf')
  await makeMarkupPdf(source)
  await openFile(page, source)

  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  await expect(modal).toBeVisible()
  const manager = modal.locator('.native-markup-manager')
  await expect(manager).toContainText('Highlight')
  await expect(manager).toContainText('Underline')

  const highlightRow = manager.locator('.native-markup-row').filter({ hasText: 'Highlight' })
  await highlightRow.locator('textarea').fill('Updated highlight comment 9966')
  await highlightRow.getByLabel(/Native markup author/).fill('QA Reviewer')
  await highlightRow.getByLabel(/Native markup color/).fill('#3366cc')
  await highlightRow.getByLabel(/Native markup opacity/).fill('65')
  await highlightRow.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating text markup annotation complete', { timeout: 20_000 })

  const underlineRow = manager.locator('.native-markup-row').filter({ hasText: 'Underline' })
  await underlineRow.getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Deleting text markup annotation complete', { timeout: 20_000 })
  await expect(manager).not.toContainText('Underline')

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('native-markups-export.pdf')
  await exportPdf(page, exported)

  const pdf = await PDFDocument.load(await readFile(exported))
  const annots = pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  expect(annots?.size()).toBe(1)
  const markup = pdf.context.lookup(annots!.get(0), PDFDict)
  expect(markup.get(PDFName.of('Subtype'))?.toString()).toBe('/Highlight')
  expect(decodeText(markup.lookup(PDFName.of('Contents')))).toBe('Updated highlight comment 9966')
  expect(decodeText(markup.lookup(PDFName.of('T')))).toBe('QA Reviewer')
  expect(arrayNumbers(markup.lookupMaybe(PDFName.of('QuadPoints'), PDFArray))).toEqual(HIGHLIGHT_QUADS)

  const color = arrayNumbers(markup.lookupMaybe(PDFName.of('C'), PDFArray))
  expect(color).toHaveLength(3)
  expect(color[0]).toBeCloseTo(0.2, 5)
  expect(color[1]).toBeCloseTo(0.4, 5)
  expect(color[2]).toBeCloseTo(0.8, 5)
  expect(markup.lookupMaybe(PDFName.of('CA'), PDFNumber)?.asNumber()).toBeCloseTo(0.65, 5)
})
