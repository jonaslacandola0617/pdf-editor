import { expect, test } from './fixtures'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

async function makePdf(path: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('PDF Forge cross-browser smoke test', { x: 72, y: 700, size: 20, font })
  page.drawText('Loaded document workspace', { x: 72, y: 660, size: 14, font })
  await writeFile(path, await pdf.save())
}

test('core Workbench opens a PDF and switches primary workflows', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('cross-browser.pdf')
  await makePdf(source)

  await page.goto('/')
  await expect(page.locator('.forge-product-root')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Open a document/i })).toBeVisible()

  await page.locator('input[type="file"]').first().setInputFiles(source)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 30_000 })

  const modes = page.locator('.forge-editor-switch')
  await modes.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-pdf-mode', 'annotate')
  await expect(page.getByTitle('Highlight')).toBeVisible()

  await modes.getByRole('button', { name: 'Sign', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-pdf-mode', 'sign')
  await expect(page.getByTitle('Signature')).toBeVisible()

  await modes.getByRole('button', { name: 'Pages', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-pdf-mode', 'organize')
  await expect(page.locator('.thumbnail-list')).toBeVisible()

  await modes.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-pdf-mode', 'edit')
  await expect(page.getByTitle('Select')).toBeVisible()

  await page.getByTitle('Hide navigator').click()
  await expect(page.locator('.forge-navigator')).toBeHidden()
  await page.getByTitle('Toggle navigator').click()
  await expect(page.locator('.forge-navigator')).toBeVisible()
})
