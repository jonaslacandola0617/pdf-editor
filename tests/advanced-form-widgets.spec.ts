import { expect, test, type Page } from './fixtures'
import { PDFDocument, PDFName, TextAlignment, rgb } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  ;(page as Page & { runtimeErrors: string[] }).runtimeErrors = errors
})

test.afterEach(async ({ page }) => {
  expect((page as Page & { runtimeErrors: string[] }).runtimeErrors).toEqual([])
})

async function makeFormPdf(path: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([600, 800])
  const form = pdf.getForm()

  const notes = form.createTextField('notes')
  notes.setText('Initial notes')
  notes.addToPage(page, { x: 60, y: 650, width: 220, height: 55, backgroundColor: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1 })

  const code = form.createTextField('code')
  code.setText('ABC123')
  code.setMaxLength(6)
  code.addToPage(page, { x: 60, y: 590, width: 160, height: 32 })

  const choice = form.createDropdown('choice')
  choice.addOptions(['Alpha', 'Beta'])
  choice.select('Alpha')
  choice.addToPage(page, { x: 60, y: 530, width: 180, height: 32 })

  const multi = form.createOptionList('multi')
  multi.addOptions(['One', 'Two', 'Three'])
  multi.select(['One', 'Two'])
  multi.addToPage(page, { x: 60, y: 410, width: 180, height: 95 })

  const agree = form.createCheckBox('agree')
  agree.check()
  agree.addToPage(page, { x: 300, y: 650, width: 24, height: 24 })

  const level = form.createRadioGroup('level')
  level.addOptionToPage('Low', page, { x: 300, y: 590, width: 22, height: 22 })
  level.addOptionToPage('High', page, { x: 350, y: 590, width: 22, height: 22 })
  level.select('Low')

  await writeFile(path, await pdf.save())
}

async function makeLayoutPdf(path: string) {
  const pdf = await PDFDocument.create()
  const first = pdf.addPage([600, 800])
  pdf.addPage([600, 800])
  const form = pdf.getForm()
  for (const [name, x, y] of [['alpha', 60, 680], ['beta', 250, 540], ['gamma', 370, 380]] as const) {
    const field = form.createTextField(name)
    field.setText(name.toUpperCase())
    field.addToPage(first, { x, y, width: 120, height: 32 })
  }
  await writeFile(path, await pdf.save())
}

async function openFile(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
}

async function openAdvancedForms(page: Page) {
  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  const manager = modal.locator('.advanced-form-widget-manager')
  await expect(manager).toBeVisible()
  await expect(manager).toContainText('notes', { timeout: 30_000 })
  return { modal, manager }
}

async function exportPdf(page: Page, path: string) {
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  await (await event).saveAs(path)
}

test('edits real AcroForm widget geometry, appearance, text behavior, choices and page tab order', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const source = testInfo.outputPath('advanced-form-source.pdf')
  await makeFormPdf(source)
  await openFile(page, source)
  const { modal, manager } = await openAdvancedForms(page)

  await manager.getByLabel('Current page tab order').selectOption('column')
  await manager.getByRole('button', { name: 'Save tab order' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating page tab order complete', { timeout: 30_000 })

  let notesRow = manager.locator('.advanced-form-row').filter({ hasText: 'notes' }).first()
  await notesRow.getByLabel('Multiline notes').check()
  await notesRow.getByLabel('Max length notes').fill('120')
  await notesRow.getByLabel('Form font size notes').fill('16')
  await notesRow.getByLabel('Form text color notes').fill('#2255cc')
  await notesRow.getByLabel('Form alignment notes').selectOption('2')
  await notesRow.getByRole('button', { name: 'Save text behavior' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating text field behavior complete', { timeout: 30_000 })

  notesRow = manager.locator('.advanced-form-row').filter({ hasText: 'notes' }).first()
  await notesRow.getByLabel('Form widget x notes 1').fill('20')
  await notesRow.getByLabel('Form widget y notes 1').fill('10')
  await notesRow.getByLabel('Form widget width notes 1').fill('40')
  await notesRow.getByLabel('Form widget height notes 1').fill('12')
  await notesRow.getByLabel('Form widget background notes 1').fill('#fff2cc')
  await notesRow.getByLabel('Form widget border color notes 1').fill('#cc3300')
  await notesRow.getByLabel('Form widget border width notes 1').fill('3')
  await notesRow.getByRole('button', { name: 'Save widget' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating form widget complete', { timeout: 30_000 })

  let codeRow = manager.locator('.advanced-form-row').filter({ hasText: 'code' }).first()
  await codeRow.getByLabel('Combing code').check()
  await codeRow.getByRole('button', { name: 'Save text behavior' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating text field behavior complete', { timeout: 30_000 })

  let choiceRow = manager.locator('.advanced-form-row').filter({ hasText: 'choice' }).first()
  await choiceRow.getByLabel('Choice options choice').fill('Gamma\nDelta\nEpsilon')
  await choiceRow.getByLabel('Choice selected choice').fill('Delta')
  await choiceRow.getByRole('button', { name: 'Save options' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating choice field options complete', { timeout: 30_000 })

  let multiRow = manager.locator('.advanced-form-row').filter({ has: page.locator('.advanced-form-meta strong', { hasText: /^multi$/ }) })
  await multiRow.getByLabel('Choice options multi').fill('Red\nGreen\nBlue')
  await multiRow.getByLabel('Choice selected multi').fill('Red, Blue')
  await multiRow.getByRole('button', { name: 'Save options' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating choice field options complete', { timeout: 30_000 })

  const radioRow = manager.locator('.advanced-form-row').filter({ hasText: 'level' }).first()
  await radioRow.getByLabel('Radio value level').selectOption('High')
  await radioRow.getByRole('button', { name: 'Save value' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating form field value complete', { timeout: 30_000 })

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('advanced-form-export.pdf')
  await exportPdf(page, exported)
  const pdf = await PDFDocument.load(await readFile(exported))
  const form = pdf.getForm()

  const notes = form.getTextField('notes')
  expect(notes.isMultiline()).toBe(true)
  expect(notes.getMaxLength()).toBe(120)
  expect(notes.getAlignment()).toBe(TextAlignment.Right)
  const notesDa = notes.acroField.getDefaultAppearance() || ''
  expect(notesDa).toContain('16 Tf')
  const color = notesDa.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/)
  expect(color).not.toBeNull()
  expect(color!.slice(1).map(Number)).toEqual([expect.closeTo(34 / 255, 3), expect.closeTo(85 / 255, 3), expect.closeTo(204 / 255, 3)])
  const widget = notes.acroField.getWidgets()[0]
  const rect = widget.getRectangle()
  expect(rect.x).toBeCloseTo(120, 2)
  expect(rect.y).toBeCloseTo(624, 2)
  expect(rect.width).toBeCloseTo(240, 2)
  expect(rect.height).toBeCloseTo(96, 2)
  expect(widget.getBorderStyle().getWidth()).toBeCloseTo(3, 4)
  expect(widget.getAppearanceCharacteristics()?.getBackgroundColor()).toEqual(expect.arrayContaining([expect.closeTo(1, 4), expect.closeTo(0.949, 3), expect.closeTo(0.8, 3)]))

  expect(form.getTextField('code').isCombed()).toBe(true)
  expect(form.getDropdown('choice').getOptions()).toEqual(['Gamma', 'Delta', 'Epsilon'])
  expect(form.getDropdown('choice').getSelected()).toEqual(['Delta'])
  expect(form.getOptionList('multi').getOptions()).toEqual(['Red', 'Green', 'Blue'])
  expect(form.getOptionList('multi').getSelected().sort()).toEqual(['Blue', 'Red'])
  expect(form.getRadioGroup('level').getSelected()).toBe('High')
  expect(pdf.getPage(0).node.get(PDFName.of('Tabs'))?.toString()).toBe('/C')
})

test('exports and reimports local form values as JSON', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const source = testInfo.outputPath('form-json-source.pdf')
  await makeFormPdf(source)
  await openFile(page, source)
  let { modal, manager } = await openAdvancedForms(page)

  const jsonEvent = page.waitForEvent('download')
  await manager.getByRole('button', { name: 'Export JSON' }).click()
  const jsonPath = testInfo.outputPath('form-values.json')
  await (await jsonEvent).saveAs(jsonPath)
  const payload = JSON.parse((await readFile(jsonPath)).toString())
  expect(payload.version).toBe(1)
  expect(payload.values.notes).toBe('Initial notes')
  expect(payload.values.agree).toBe(true)
  expect(payload.values.choice).toEqual(['Alpha'])
  expect(payload.values.level).toBe('Low')

  let agreeRow = manager.locator('.advanced-form-row').filter({ hasText: 'agree' }).first()
  await agreeRow.getByLabel('Checkbox value agree').uncheck()
  await agreeRow.getByRole('button', { name: 'Save value' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating form field value complete', { timeout: 30_000 })
  agreeRow = manager.locator('.advanced-form-row').filter({ hasText: 'agree' }).first()
  await expect(agreeRow.getByLabel('Checkbox value agree')).not.toBeChecked()

  const importInput = manager.locator('input[type="file"]').first()
  await importInput.setInputFiles(jsonPath)
  await expect(page.locator('.stage-top-hint')).toContainText('Form data JSON imported', { timeout: 30_000 })
  await modal.getByTitle('Close embedded objects').click()

  const exported = testInfo.outputPath('form-json-imported.pdf')
  await exportPdf(page, exported)
  const pdf = await PDFDocument.load(await readFile(exported))
  const form = pdf.getForm()
  expect(form.getCheckBox('agree').isChecked()).toBe(true)
  expect(form.getTextField('notes').getText()).toBe('Initial notes')
  expect(form.getDropdown('choice').getSelected()).toEqual(['Alpha'])
  expect(form.getRadioGroup('level').getSelected()).toBe('Low')
})

test('selects, drags, resizes, aligns, distributes, duplicates and copies fields on the page', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const source = testInfo.outputPath('form-layout-source.pdf')
  await makeLayoutPdf(source)
  await openFile(page, source)
  await page.getByTitle('Form fields').click()
  await page.getByRole('button', { name: 'Prepare form on page' }).click()
  await expect(page.locator('.form-widget-outline')).toHaveCount(3)

  let alpha = page.getByRole('button', { name: 'Form widget alpha 1', exact: true })
  const before = await alpha.boundingBox()
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2)
  await page.mouse.down()
  await page.mouse.move(before!.x + before!.width / 2 + 45, before!.y + before!.height / 2 + 20, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('.stage-top-hint')).toContainText('Form widget position updated', { timeout: 30_000 })

  alpha = page.getByRole('button', { name: 'Form widget alpha 1', exact: true })
  const moved = await alpha.boundingBox()
  expect(moved!.x).toBeGreaterThan(before!.x + 30)
  const resize = page.getByRole('button', { name: 'Resize form widget alpha 1', exact: true })
  const handle = await resize.boundingBox()
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle!.x + 35, handle!.y + 18, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('.stage-top-hint')).toContainText('Form widget position updated', { timeout: 30_000 })

  await page.getByRole('button', { name: 'Form widget alpha 1', exact: true }).click()
  await page.getByRole('button', { name: 'Form widget beta 1', exact: true }).click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Form widget gamma 1', exact: true }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.form-selection-summary')).toContainText('3 selected')
  await page.getByRole('button', { name: 'Align left' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Align left complete', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Distribute V' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Distribute vertical complete', { timeout: 30_000 })

  await page.locator('.pdf-page').click({ position: { x: 5, y: 5 } })
  await page.getByRole('button', { name: 'Form widget alpha 1', exact: true }).click()
  await page.getByRole('button', { name: 'Duplicate selected fields' }).click()
  await expect(page.getByRole('button', { name: 'Form widget alpha_copy 1', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Form widget alpha_copy 1', exact: true }).click()
  await page.getByLabel('Copy form fields to page').fill('2')
  await page.locator('.form-copy-row').getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Form fields copied to page 2', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Form widget alpha_copy_page_2 1', exact: true })).toBeVisible({ timeout: 30_000 })

  const exported = testInfo.outputPath('form-layout-export.pdf')
  await exportPdf(page, exported)
  const result = await PDFDocument.load(await readFile(exported))
  const fields = result.getForm()
  expect(fields.getTextField('alpha_copy').getText()).toBe('ALPHA')
  expect(fields.getTextField('alpha_copy_page_2').getText()).toBe('ALPHA')
  const pageOneWidgets = ['alpha', 'beta', 'gamma'].map(name => fields.getTextField(name).acroField.getWidgets()[0].getRectangle())
  expect(pageOneWidgets[0].x).toBeCloseTo(pageOneWidgets[1].x, 1)
  expect(pageOneWidgets[1].x).toBeCloseTo(pageOneWidgets[2].x, 1)
  const centers = pageOneWidgets.map(rect => rect.y + rect.height / 2).sort((a, b) => a - b)
  expect(centers[1] - centers[0]).toBeCloseTo(centers[2] - centers[1], 1)
})
