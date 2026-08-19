import { expect, test, type Page } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'

async function makeNativeObjectPdf(path: string) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([612, 792])
  page.drawText('NATIVE OBJECT QA 4411', { x: 72, y: 680, size: 24, font })

  const annots = pdf.context.obj([]) as PDFArray
  page.node.set(PDFName.of('Annots'), annots)

  const comment = pdf.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [90, 610, 112, 632],
    Contents: PDFHexString.fromText('External comment 5511'),
    T: PDFHexString.fromText('External Author'), Name: 'Comment',
  })
  annots.push(pdf.context.register(comment))

  const link = pdf.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [90, 560, 260, 585], Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/original-6611') },
  })
  annots.push(pdf.context.register(link))

  const outlines = pdf.context.obj({ Type: 'Outlines', Count: 1 }) as PDFDict
  const outlinesRef = pdf.context.register(outlines)
  const bookmark = pdf.context.obj({
    Title: PDFHexString.fromText('External bookmark 7711'),
    Parent: outlinesRef,
    Dest: [page.ref, 'Fit'],
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

async function openObjects(page: Page) {
  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  await expect(modal).toBeVisible()
  return modal
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

async function inspect(path: string) {
  const pdf = await PDFDocument.load(await readFile(path))
  const annots = pdf.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  const comments: string[] = []
  const links: string[] = []
  if (annots) {
    for (let index = 0; index < annots.size(); index++) {
      const dict = pdf.context.lookup(annots.get(index), PDFDict)
      const subtype = dict?.get(PDFName.of('Subtype'))?.toString()
      if (subtype === '/Text' || subtype === '/FreeText') comments.push(textValue(dict?.lookup(PDFName.of('Contents'))))
      if (subtype === '/Link') {
        const action = dict?.lookupMaybe(PDFName.of('A'), PDFDict)
        if (action?.get(PDFName.of('S'))?.toString() === '/URI') links.push(textValue(action.lookup(PDFName.of('URI'))))
      }
    }
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(path)) })
  const doc = await task.promise
  let bookmarkTitles: string[] = []
  try {
    bookmarkTitles = (await doc.getOutline() || []).map((item) => item.title)
  } finally {
    await task.destroy()
  }
  return { comments, links, bookmarkTitles }
}

test('edits native comments, URI links and bookmarks created by another PDF editor', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('native-edit-source.pdf')
  await makeNativeObjectPdf(source)
  await openFile(page, source)
  const modal = await openObjects(page)

  const comment = modal.getByLabel('Native comment page 1')
  await expect(comment).toHaveValue('External comment 5511')
  await comment.fill('Updated external comment 5522')
  await comment.locator('xpath=..').getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native comment complete', { timeout: 20_000 })

  await modal.getByRole('button', { name: /Links/ }).click()
  const link = modal.getByLabel('Native link page 1')
  await expect(link).toHaveValue('https://example.com/original-6611')
  await link.fill('https://example.com/updated-6622')
  await link.locator('xpath=..').getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native link complete', { timeout: 20_000 })

  await modal.getByRole('button', { name: /Bookmarks/ }).click()
  const bookmark = modal.locator('input[aria-label^="Native bookmark"]').first()
  await expect(bookmark).toHaveValue('External bookmark 7711')
  await bookmark.fill('Updated bookmark 7722')
  await bookmark.locator('xpath=..').getByRole('button', { name: 'Rename' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Renaming bookmark complete', { timeout: 20_000 })

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('native-edit-export.pdf')
  await exportPdf(page, exported)
  const result = await inspect(exported)
  expect(result.comments).toContain('Updated external comment 5522')
  expect(result.links).toContain('https://example.com/updated-6622')
  expect(result.bookmarkTitles).toContain('Updated bookmark 7722')
})

test('deletes existing native comments, links and bookmarks from the PDF', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const source = testInfo.outputPath('native-delete-source.pdf')
  await makeNativeObjectPdf(source)
  await openFile(page, source)
  const modal = await openObjects(page)

  await modal.locator('.native-object-row').first().getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Deleting native comment complete', { timeout: 20_000 })
  await expect(modal.getByText('No native sticky-note or free-text comments found.')).toBeVisible()

  await modal.getByRole('button', { name: /Links/ }).click()
  await modal.locator('.native-object-row').first().getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Deleting native link complete', { timeout: 20_000 })
  await expect(modal.getByText('No URI link annotations found.')).toBeVisible()

  await modal.getByRole('button', { name: /Bookmarks/ }).click()
  await modal.locator('.native-object-row').first().getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Deleting bookmark complete', { timeout: 20_000 })
  await expect(modal.getByText('No PDF outline bookmarks found.')).toBeVisible()

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('native-delete-export.pdf')
  await exportPdf(page, exported)
  const result = await inspect(exported)
  expect(result.comments).toHaveLength(0)
  expect(result.links).toHaveLength(0)
  expect(result.bookmarkTitles).toHaveLength(0)
})
