import { expect, test, type Page } from '@playwright/test'
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

async function makePdf(path: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('FORM PROPERTY QA', { x: 72, y: 700, size: 24, font })

  const form = pdf.getForm()
  const keep = form.createTextField('customer.name')
  keep.setText('Jonas')
  keep.addToPage(page, { x: 72, y: 620, width: 220, height: 28, font })

  const remove = form.createTextField('delete_me')
  remove.setText('remove this')
  remove.addToPage(page, { x: 72, y: 560, width: 220, height: 28, font })

  form.updateFieldAppearances(font)
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

test('renames, updates flags and deletes existing AcroForm fields without orphan widgets', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('form-properties-source.pdf')
  await makePdf(source)
  await openFile(page, source)

  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  const manager = modal.locator('.form-property-manager')
  await expect(manager).toBeVisible()
  await expect(manager.getByRole('list', { name: 'Existing form fields' })).toContainText('customer.name')
  await expect(manager.getByRole('list', { name: 'Existing form fields' })).toContainText('delete_me')

  await manager.getByRole('button', { name: /customer\.name/ }).click()
  await manager.getByLabel('Existing field name').fill('full_name')
  await manager.getByLabel('Existing field tooltip').fill('Customer full legal name')
  await manager.getByLabel('Existing field read only').check()
  await manager.getByLabel('Existing field required').check()
  await manager.getByLabel('Existing field exported').uncheck()
  await manager.getByRole('button', { name: 'Save properties' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating form field properties complete', { timeout: 20_000 })
  await expect(manager.getByRole('list', { name: 'Existing form fields' })).toContainText('customer.full_name')

  await manager.getByRole('button', { name: /delete_me/ }).click()
  await manager.getByRole('button', { name: 'Delete field' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Deleting form field complete', { timeout: 20_000 })
  await expect(manager.getByRole('list', { name: 'Existing form fields' })).not.toContainText('delete_me')

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('form-properties-export.pdf')
  await exportPdf(page, exported)

  const pdf = await PDFDocument.load(await readFile(exported))
  const form = pdf.getForm()
  expect(form.getFieldMaybe('customer.name')).toBeUndefined()
  expect(form.getFieldMaybe('delete_me')).toBeUndefined()

  const renamed = form.getField('customer.full_name')
  expect(renamed.isReadOnly()).toBe(true)
  expect(renamed.isRequired()).toBe(true)
  expect(renamed.isExported()).toBe(false)
  expect(textValue(renamed.acroField.dict.lookup(PDFName.of('TU')))).toBe('Customer full legal name')

  const annots = pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  expect(annots?.size()).toBe(1)
})
