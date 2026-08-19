import { expect, test, type Page } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

async function makePdf(path: string) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const first = pdf.addPage([612, 792])
  const second = pdf.addPage([612, 792])
  first.drawText('NATIVE NAVIGATION QA PAGE 1', { x: 64, y: 700, size: 22, font })
  second.drawText('NATIVE NAVIGATION QA PAGE 2', { x: 64, y: 700, size: 22, font })

  const annots = pdf.context.obj([]) as PDFArray
  first.node.set(PDFName.of('Annots'), annots)
  const link = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [60, 600, 200, 640],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://before.example/geometry') },
  })
  annots.push(pdf.context.register(link))

  const outlines = pdf.context.obj({ Type: 'Outlines', Count: 1 }) as PDFDict
  const outlinesRef = pdf.context.register(outlines)
  const bookmark = pdf.context.obj({
    Title: PDFHexString.fromText('Before navigation bookmark'),
    Parent: outlinesRef,
    Dest: [first.ref, 'Fit'],
  }) as PDFDict
  const bookmarkRef = pdf.context.register(bookmark)
  outlines.set(PDFName.of('First'), bookmarkRef)
  outlines.set(PDFName.of('Last'), bookmarkRef)
  pdf.catalog.set(PDFName.of('Outlines'), outlinesRef)

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

test('edits a native URI link rectangle and moves an existing bookmark destination', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('native-navigation-source.pdf')
  await makePdf(source)
  await openFile(page, source)

  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  await expect(modal).toBeVisible()

  await modal.getByRole('button', { name: /Links/ }).click()
  const url = modal.getByLabel('Native link page 1')
  await expect(url).toHaveValue('https://before.example/geometry')
  await expect(modal.getByLabel('Native link X percent page 1')).toHaveValue('9.8')
  await expect(modal.getByLabel('Native link Y percent page 1')).toHaveValue('19.19')
  await expect(modal.getByLabel('Native link width percent page 1')).toHaveValue('22.88')
  await expect(modal.getByLabel('Native link height percent page 1')).toHaveValue('5.05')

  await url.fill('https://after.example/geometry')
  await modal.getByLabel('Native link X percent page 1').fill('20')
  await modal.getByLabel('Native link Y percent page 1').fill('25')
  await modal.getByLabel('Native link width percent page 1').fill('30')
  await modal.getByLabel('Native link height percent page 1').fill('10')
  await url.locator('xpath=..').getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native link complete', { timeout: 20_000 })

  await modal.getByRole('button', { name: /Bookmarks/ }).click()
  const title = modal.getByLabel('Native bookmark 0')
  const target = modal.getByLabel('Native bookmark target page 0')
  await expect(title).toHaveValue('Before navigation bookmark')
  await expect(target).toHaveValue('1')
  await title.fill('After navigation bookmark')
  await target.fill('2')
  await title.locator('xpath=..').getByRole('button', { name: 'Rename' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Renaming bookmark complete', { timeout: 20_000 })

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('native-navigation-export.pdf')
  await exportPdf(page, exported)

  const pdf = await PDFDocument.load(await readFile(exported))
  const annots = pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  expect(annots?.size()).toBe(1)
  const link = pdf.context.lookup(annots!.get(0), PDFDict)
  const action = link.lookupMaybe(PDFName.of('A'), PDFDict)
  expect(textValue(action?.lookup(PDFName.of('URI')))).toBe('https://after.example/geometry')
  const rect = link.lookup(PDFName.of('Rect'), PDFArray).asRectangle()
  expect(rect.x).toBeCloseTo(122.4, 3)
  expect(rect.y).toBeCloseTo(514.8, 3)
  expect(rect.width).toBeCloseTo(183.6, 3)
  expect(rect.height).toBeCloseTo(79.2, 3)

  const outlines = pdf.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  const firstBookmarkRef = outlines?.get(PDFName.of('First'))
  const bookmark = firstBookmarkRef ? pdf.context.lookup(firstBookmarkRef, PDFDict) : undefined
  expect(textValue(bookmark?.lookup(PDFName.of('Title')))).toBe('After navigation bookmark')
  const destination = bookmark?.lookupMaybe(PDFName.of('Dest'), PDFArray)
  expect(destination?.get(0)?.toString()).toBe(pdf.getPage(1).ref.toString())
  expect(destination?.get(1)?.toString()).toBe('/Fit')
})
