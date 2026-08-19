import { expect, test, type Page } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

async function makeShapePdf(path: string) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([612, 792])
  page.drawText('NATIVE SHAPE QA 8811', { x: 72, y: 700, size: 22, font })
  const annots = pdf.context.obj([]) as PDFArray
  page.node.set(PDFName.of('Annots'), annots)

  const square = pdf.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [80, 560, 220, 650], C: [1, 0, 0], IC: [1, 1, 0], CA: 0.5,
    BS: { Type: 'Border', S: 'S', W: 2 }, NM: 'square-preserve-8822',
  }) as PDFDict
  annots.push(pdf.context.register(square))

  const circle = pdf.context.obj({
    Type: 'Annot', Subtype: 'Circle', Rect: [250, 560, 360, 650], C: [0, 0, 1], IC: [0.8, 0.8, 1], CA: 0.7,
    BS: { Type: 'Border', S: 'S', W: 1 }, NM: 'circle-delete-8833',
  }) as PDFDict
  annots.push(pdf.context.register(circle))

  const line = pdf.context.obj({
    Type: 'Annot', Subtype: 'Line', Rect: [80, 470, 360, 530], L: [100, 500, 330, 500], C: [0, 0.5, 0], CA: 0.9,
    BS: { Type: 'Border', S: 'S', W: 3 }, NM: 'line-preserve-8844',
  }) as PDFDict
  annots.push(pdf.context.register(line))

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

function arrayNumbers(array: PDFArray | undefined) {
  if (!array) return []
  const values: number[] = []
  for (let index = 0; index < array.size(); index++) {
    const value = array.lookup(index, PDFNumber)
    if (value) values.push(value.asNumber())
  }
  return values
}

function findAnnot(pdf: PDFDocument, subtype: string) {
  const annots = pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) return null
  for (let index = 0; index < annots.size(); index++) {
    const dict = pdf.context.lookup(annots.get(index), PDFDict)
    if (dict?.get(PDFName.of('Subtype'))?.toString() === `/${subtype}`) return dict
  }
  return null
}

test('edits native square and line properties and deletes a native circle annotation', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('native-shapes-source.pdf')
  await makeShapePdf(source)
  await openFile(page, source)

  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  await expect(modal).toBeVisible()
  const manager = modal.locator('.native-shape-manager')
  await expect(manager).toContainText('Square')
  await expect(manager).toContainText('Circle')
  await expect(manager).toContainText('Line')

  const squareRow = manager.locator('.native-shape-row').filter({ hasText: 'Square' })
  await squareRow.getByLabel(/Native shape stroke/).fill('#3366cc')
  await squareRow.getByLabel(/Native shape fill/).fill('#cc9933')
  await squareRow.getByLabel(/Native shape opacity/).fill('60')
  await squareRow.getByLabel(/Native shape border/).fill('4.5')
  await squareRow.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native shape annotation complete', { timeout: 20_000 })

  const lineRow = manager.locator('.native-shape-row').filter({ hasText: 'Line' })
  await lineRow.getByLabel(/Native line x1/).fill('120')
  await lineRow.getByLabel(/Native line y1/).fill('510')
  await lineRow.getByLabel(/Native line x2/).fill('345')
  await lineRow.getByLabel(/Native line y2/).fill('475')
  await lineRow.getByLabel(/Native shape border/).fill('2.25')
  await lineRow.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native shape annotation complete', { timeout: 20_000 })

  const circleRow = manager.locator('.native-shape-row').filter({ hasText: 'Circle' })
  await circleRow.getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Deleting native shape annotation complete', { timeout: 20_000 })
  await expect(manager).not.toContainText('Circle')

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('native-shapes-export.pdf')
  await exportPdf(page, exported)

  const pdf = await PDFDocument.load(await readFile(exported))
  expect(findAnnot(pdf, 'Circle')).toBeNull()

  const square = findAnnot(pdf, 'Square')
  expect(square).not.toBeNull()
  const squareStroke = arrayNumbers(square!.lookupMaybe(PDFName.of('C'), PDFArray))
  const squareFill = arrayNumbers(square!.lookupMaybe(PDFName.of('IC'), PDFArray))
  expect(squareStroke[0]).toBeCloseTo(0.2, 5)
  expect(squareStroke[1]).toBeCloseTo(0.4, 5)
  expect(squareStroke[2]).toBeCloseTo(0.8, 5)
  expect(squareFill[0]).toBeCloseTo(0.8, 5)
  expect(squareFill[1]).toBeCloseTo(0.6, 5)
  expect(squareFill[2]).toBeCloseTo(0.2, 5)
  expect(square!.lookupMaybe(PDFName.of('CA'), PDFNumber)?.asNumber()).toBeCloseTo(0.6, 5)
  expect(square!.lookupMaybe(PDFName.of('BS'), PDFDict)?.lookupMaybe(PDFName.of('W'), PDFNumber)?.asNumber()).toBeCloseTo(4.5, 5)
  expect(square!.get(PDFName.of('NM'))?.toString()).toContain('square-preserve-8822')

  const line = findAnnot(pdf, 'Line')
  expect(line).not.toBeNull()
  expect(arrayNumbers(line!.lookupMaybe(PDFName.of('L'), PDFArray))).toEqual([120, 510, 345, 475])
  expect(line!.lookupMaybe(PDFName.of('BS'), PDFDict)?.lookupMaybe(PDFName.of('W'), PDFNumber)?.asNumber()).toBeCloseTo(2.25, 5)
  expect(line!.get(PDFName.of('NM'))?.toString()).toContain('line-preserve-8844')
})
