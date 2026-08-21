import { expect, test } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

async function makePdf(path: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('PDF FORGE PRODUCT EXPERIENCE', { x: 80, y: 690, size: 20, font })
  page.drawText('Editable document content', { x: 80, y: 650, size: 14, font })
  await writeFile(path, await pdf.save())
}

test('home is a focused PDF workspace with documents and tool navigation', async ({ page }) => {
  await page.goto('/')
  const product = page.locator('.product-home-root')
  await expect(product).toBeVisible()
  await expect(product.getByRole('heading', { name: 'Your PDF workspace' })).toBeVisible()
  await expect(product.getByRole('button', { name: 'Open PDF or images' })).toBeVisible()
  await expect(product.getByText('Drop a PDF here to start working')).toBeVisible()

  await product.getByRole('button', { name: 'Documents', exact: true }).click()
  await expect(product.getByRole('heading', { name: 'Documents' })).toBeVisible()
  await expect(product.getByPlaceholder('Search documents')).toBeVisible()

  await product.getByRole('button', { name: 'Tools', exact: true }).click()
  await expect(product.getByRole('heading', { name: 'Tools' })).toBeVisible()
  await expect(product.getByRole('button', { name: /Edit PDF/ })).toBeVisible()
  await expect(product.getByRole('button', { name: /Organize Pages/ })).toBeVisible()
  await expect(product.getByRole('button', { name: /Protect PDF/ })).toBeVisible()
})

test('editor exposes intent-based modes and quick actions without breaking PDF workflows', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('product-experience.pdf')
  await makePdf(source)
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(source)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })

  const modes = page.locator('.product-editor-modes')
  await expect(modes).toBeVisible()
  await expect(modes.getByRole('button', { name: 'Edit', exact: true })).toHaveClass(/active/)

  await modes.getByRole('button', { name: 'Annotate', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-pdf-mode', 'annotate')
  await expect(page.getByTitle('Highlight')).toHaveClass(/active/)

  await modes.getByRole('button', { name: 'Fill & Sign', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-pdf-mode', 'sign')
  await expect(page.getByTitle('Signature')).toHaveClass(/active/)

  await modes.getByRole('button', { name: 'Organize', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-pdf-mode', 'organize')
  await expect(page.getByTitle('Pages')).toHaveClass(/active/)
  await expect(page.locator('.thumbnail-list')).toBeVisible()

  await modes.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-pdf-mode', 'edit')
  await expect(page.getByTitle('Select')).toHaveClass(/active/)

  await page.keyboard.press('Control+K')
  const palette = page.getByRole('dialog', { name: 'Quick Actions' })
  await expect(palette).toBeVisible()
  await expect(palette.getByPlaceholder('What would you like to do?')).toBeFocused()
  await palette.getByPlaceholder('What would you like to do?').fill('export')
  await expect(palette.getByRole('button', { name: /Export PDF/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
})
