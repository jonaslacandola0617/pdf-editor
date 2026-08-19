import { expect, test, type Page } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

async function makePdf(path: string, options: { metadata?: boolean; activeAction?: boolean } = {}) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < 2; index++) {
    const page = pdf.addPage([612, 792])
    page.drawText(`STRUCTURE PAGE ${index + 1}`, { x: 72, y: 680, size: 26, font })
  }
  if (options.metadata) {
    pdf.setTitle('PRIVATE TITLE 8811')
    pdf.setAuthor('PRIVATE AUTHOR 8822')
  }
  if (options.activeAction) {
    pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }))
  }
  await writeFile(path, await pdf.save())
}

async function openFile(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
}

async function openTools(page: Page) {
  await page.getByTitle('Document tools').click()
  const tools = page.locator('.advanced-modal')
  await expect(tools).toBeVisible()
  return tools
}

async function closeTools(page: Page) {
  await page.locator('.advanced-modal > header .icon-btn').click()
  await expect(page.locator('.advanced-modal')).toHaveCount(0)
}

async function exportPdf(page: Page, path: string) {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  await (await download).saveAs(path)
}

async function pdfText(path: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(path)) })
  const doc = await task.promise
  try {
    const pages: string[] = []
    for (let index = 1; index <= doc.numPages; index++) {
      const content = await (await doc.getPage(index)).getTextContent()
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '))
    }
    return pages.join('\n')
  } finally {
    await task.destroy()
  }
}

test('authors common AcroForm field types and normal export preserves them as interactive fields', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('form-author-source.pdf')
  await makePdf(source)
  await openFile(page, source)
  const tools = await openTools(page)
  const type = tools.getByLabel('Form field type')
  const name = tools.getByLabel('Form field name')

  const fields: Array<[string, string]> = [
    ['text', 'qa_text'],
    ['checkbox', 'qa_check'],
    ['dropdown', 'qa_dropdown'],
    ['list', 'qa_list'],
    ['radio', 'qa_radio'],
  ]
  for (const [kind, fieldName] of fields) {
    await type.selectOption(kind)
    await name.fill(fieldName)
    if (['dropdown', 'list', 'radio'].includes(kind)) await tools.getByLabel('Form field options').fill('Alpha, Beta, Gamma')
    await tools.getByRole('button', { name: 'Add form field' }).click()
    await expect(page.locator('.stage-top-hint')).toContainText('Adding form field complete', { timeout: 20_000 })
  }
  await closeTools(page)

  await page.getByTitle('Form fields').click()
  await expect(page.locator('.left-panel')).toContainText('qa_text')
  await expect(page.locator('.left-panel')).toContainText('qa_radio')

  const exported = testInfo.outputPath('form-author-export.pdf')
  await exportPdf(page, exported)
  const pdf = await PDFDocument.load(await readFile(exported))
  const names = pdf.getForm().getFields().map((field) => field.getName())
  for (const [, fieldName] of fields) expect(names).toContain(fieldName)
})

test('explicit form flatten removes interactivity only when requested', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('form-flatten-source.pdf')
  await makePdf(source)
  await openFile(page, source)
  let tools = await openTools(page)
  await tools.getByLabel('Form field name').fill('flatten_me')
  await tools.getByRole('button', { name: 'Add form field' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Adding form field complete', { timeout: 20_000 })
  await tools.getByRole('button', { name: 'Flatten form fields' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Flattening form fields complete', { timeout: 20_000 })
  await closeTools(page)

  const exported = testInfo.outputPath('form-flatten-export.pdf')
  await exportPdf(page, exported)
  const pdf = await PDFDocument.load(await readFile(exported))
  expect(pdf.getForm().getFields()).toHaveLength(0)
})

test('creates a native URI link, PDF bookmark and Bates text', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('structure-source.pdf')
  await makePdf(source)
  await openFile(page, source)
  const tools = await openTools(page)

  await tools.getByLabel('Link URL').fill('https://example.com/qa-link-9911')
  await tools.getByRole('button', { name: 'Add clickable link' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Adding PDF link complete', { timeout: 20_000 })

  await tools.getByLabel('Bookmark title').fill('QA Bookmark 9922')
  await tools.getByRole('button', { name: 'Add bookmark' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Adding bookmark complete', { timeout: 20_000 })

  await tools.getByLabel('Bates prefix').fill('QA-')
  await tools.getByLabel('Bates start').fill('42')
  await tools.getByLabel('Bates digits').fill('4')
  await tools.getByRole('button', { name: 'Apply Bates numbers' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Adding Bates numbers complete', { timeout: 20_000 })
  await closeTools(page)

  const exported = testInfo.outputPath('structure-export.pdf')
  await exportPdf(page, exported)
  const pdf = await PDFDocument.load(await readFile(exported))
  const annots = pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  expect(annots).toBeTruthy()
  let uri = ''
  for (let index = 0; annots && index < annots.size(); index++) {
    const annotation = pdf.context.lookup(annots.get(index), PDFDict)
    if (annotation.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue
    const action = annotation.lookupMaybe(PDFName.of('A'), PDFDict)
    const value = action?.lookup(PDFName.of('URI'))
    if (value instanceof PDFString) uri = value.decodeText()
  }
  expect(uri).toBe('https://example.com/qa-link-9911')

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(exported)) })
  const doc = await task.promise
  try {
    const outline = await doc.getOutline()
    expect(outline?.some((item) => item.title === 'QA Bookmark 9922')).toBeTruthy()
  } finally {
    await task.destroy()
  }
  const text = await pdfText(exported)
  expect(text).toContain('QA-0042')
  expect(text).toContain('QA-0043')
})

test('privacy cleanup clears metadata state and removes an active document open action', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('privacy-source.pdf')
  await makePdf(source, { metadata: true, activeAction: true })
  await openFile(page, source)

  await page.getByTitle('Document info').click()
  await expect(page.locator('.meta-form input').nth(0)).toHaveValue('PRIVATE TITLE 8811')
  await expect(page.locator('.meta-form input').nth(1)).toHaveValue('PRIVATE AUTHOR 8822')

  const tools = await openTools(page)
  await tools.getByRole('button', { name: 'Remove privacy data & active content' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Cleaning document privacy data complete', { timeout: 20_000 })
  await closeTools(page)

  await expect(page.locator('.meta-form input').nth(0)).toHaveValue('')
  await expect(page.locator('.meta-form input').nth(1)).toHaveValue('')

  const exported = testInfo.outputPath('privacy-export.pdf')
  await exportPdf(page, exported)
  const pdf = await PDFDocument.load(await readFile(exported))
  expect(pdf.getTitle() || '').toBe('')
  expect(pdf.getAuthor() || '').toBe('')
  expect(pdf.catalog.get(PDFName.of('OpenAction'))).toBeUndefined()
})
