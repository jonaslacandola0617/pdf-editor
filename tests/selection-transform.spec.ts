import { test, expect, type Page } from './fixtures'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

async function makePdf(path: string) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([612, 792])
  page.drawText('SELECTION TRANSFORM QA', { x: 72, y: 700, size: 24, font })
  await writeFile(path, await pdf.save())
}

async function openPdf(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 20_000 })
}

async function dragOnPdf(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
  const pdfPage = await page.locator('.pdf-page').first().boundingBox()
  if (!pdfPage) throw new Error('PDF page has no bounding box')
  await page.mouse.move(pdfPage.x + pdfPage.width * fromX, pdfPage.y + pdfPage.height * fromY)
  await page.mouse.down()
  await page.mouse.move(pdfPage.x + pdfPage.width * toX, pdfPage.y + pdfPage.height * toY, { steps: 10 })
  await page.mouse.up()
}

function expectRectsClose(actual: { x: number; y: number; width: number; height: number }, expected: { x: number; y: number; width: number; height: number }, tolerance = 10) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(tolerance)
}

test('text selection uses one blue eight-handle frame that follows resized text', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('text-transform.pdf')
  await makePdf(source)
  await openPdf(page, source)

  await page.locator('.forge-editor-switch').getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByTitle('Add text').click()
  await page.locator('.pdf-page').first().click({ position: { x: 260, y: 260 } })
  await expect(page.locator('.text-annotation')).toHaveCount(1)
  await page.locator('.right-panel textarea').fill('Resizable text sample')

  const text = page.locator('.text-annotation').first()
  const frame = page.locator('.selection-transform-frame')
  await expect(text).toHaveClass(/selected/)
  await expect(frame).toBeVisible()
  await expect(page.locator('.selection-transform-handle')).toHaveCount(8)
  await expect(page.locator('.selection-transform-rotate')).toBeVisible()
  await expect(page.locator('.annotation-transform-box')).toBeHidden()

  const beforeText = await text.boundingBox()
  const beforeFrame = await frame.boundingBox()
  if (!beforeText || !beforeFrame) throw new Error('Selection geometry unavailable')
  expectRectsClose(beforeFrame, beforeText, 12)

  const handle = page.locator('.selection-transform-handle.handle-se')
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('South-east resize handle unavailable')
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 75, handleBox.y + handleBox.height / 2 + 55, { steps: 10 })
  await page.mouse.up()

  await expect.poll(async () => (await text.boundingBox())?.width || 0).toBeGreaterThan(beforeText.width + 20)
  await expect.poll(async () => {
    const textBox = await text.boundingBox()
    const frameBox = await frame.boundingBox()
    if (!textBox || !frameBox) return 999
    return Math.max(
      Math.abs(textBox.x - frameBox.x),
      Math.abs(textBox.y - frameBox.y),
      Math.abs(textBox.width - frameBox.width),
      Math.abs(textBox.height - frameBox.height),
    )
  }).toBeLessThanOrEqual(12)
})

test('notes stay simple and do not receive transform handles', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('note-transform.pdf')
  await makePdf(source)
  await openPdf(page, source)

  await page.locator('.forge-editor-switch').getByRole('button', { name: 'Review', exact: true }).click()
  await page.getByTitle('Sticky note').click()
  await page.locator('.pdf-page').first().click({ position: { x: 250, y: 300 } })

  const note = page.locator('.note-annotation').first()
  await expect(note).toHaveClass(/selected/)
  await expect(page.locator('.selection-transform-frame')).toHaveCount(0)
  await expect(page.locator('.selection-transform-handle')).toHaveCount(0)
})

test('signature stroke does not block selecting another annotation', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('signature-hit-test.pdf')
  await makePdf(source)
  await openPdf(page, source)

  await page.locator('.forge-editor-switch').getByRole('button', { name: 'Sign', exact: true }).click()
  await page.getByTitle('Signature').click()
  await dragOnPdf(page, .18, .68, .42, .73)
  await expect(page.locator('.ink-hitbox')).toHaveCount(1)

  await page.locator('.forge-editor-switch').getByRole('button', { name: 'Review', exact: true }).click()
  await page.getByTitle('Rectangle').click()
  await dragOnPdf(page, .56, .42, .78, .54)
  const rectangle = page.locator('.box-annotation.rectangle').first()
  await expect(rectangle).toHaveCount(1)

  const rectangleBox = await rectangle.boundingBox()
  if (!rectangleBox) throw new Error('Rectangle bounds unavailable')
  await page.mouse.click(rectangleBox.x + rectangleBox.width / 2, rectangleBox.y + rectangleBox.height / 2)
  await expect(rectangle).toHaveClass(/selected/)
  await expect(page.locator('.selection-transform-frame')).toBeVisible()
})
