import { test, expect, type Page } from './fixtures'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

async function makePdf(path: string) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([612, 792])
  page.drawText('CONTEXT MENU TEST', { x: 72, y: 680, size: 28, font })
  await writeFile(path, await pdf.save())
}

async function openPdf(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 20_000 })
}

async function rightClickBlankPage(page: Page) {
  const pdfPage = page.locator('.pdf-page').first()
  await pdfPage.click({ button: 'right', position: { x: 110, y: 115 } })
  return page.getByRole('menu', { name: 'PDF actions' })
}

test('right-click menu exposes nested tools and real annotation clipboard actions', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('context-actions.pdf')
  await makePdf(source)
  await openPdf(page, source)

  const editMode = page.locator('.forge-editor-switch').getByRole('button', { name: 'Edit', exact: true })
  await editMode.click()
  await page.getByTitle('Add text').click()
  await page.locator('.pdf-page').first().click({ position: { x: 250, y: 210 } })
  await expect(page.locator('.text-annotation')).toHaveCount(1)

  const selected = page.locator('.text-annotation').first()
  await selected.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'PDF actions' })
  await expect(menu).toBeVisible()

  const tools = menu.getByRole('menuitem', { name: 'Tools', exact: true })
  await tools.hover()
  const submenu = page.getByRole('menu', { name: 'PDF tools' })
  await expect(submenu).toBeVisible()
  await expect(submenu.getByRole('menuitem', { name: 'Edit text', exact: true })).toBeVisible()
  await expect(submenu.getByRole('menuitem', { name: 'Highlight', exact: true })).toBeVisible()
  await expect(submenu.getByRole('menuitem', { name: 'Signature', exact: true })).toBeVisible()

  await expect(menu.getByRole('menuitem', { name: 'Paste', exact: true })).toBeDisabled()
  await menu.getByRole('menuitem', { name: 'Copy', exact: true }).click()

  const pasteMenu = await rightClickBlankPage(page)
  await expect(pasteMenu.getByRole('menuitem', { name: 'Paste', exact: true })).toBeEnabled()
  await pasteMenu.getByRole('menuitem', { name: 'Paste', exact: true }).click()
  await expect(page.locator('.text-annotation')).toHaveCount(2)

  const pasted = page.locator('.text-annotation.selected')
  await expect(pasted).toHaveCount(1)
  await pasted.click({ button: 'right' })
  await page.getByRole('menu', { name: 'PDF actions' }).getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  await expect(page.locator('.text-annotation')).toHaveCount(3)

  const duplicate = page.locator('.text-annotation.selected')
  await duplicate.click({ button: 'right' })
  const deleteMenu = page.getByRole('menu', { name: 'PDF actions' })
  await expect(deleteMenu.getByRole('menuitem', { name: 'Properties', exact: true })).toBeVisible()
  await deleteMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await expect(page.locator('.text-annotation')).toHaveCount(2)

  const undoMenu = await rightClickBlankPage(page)
  await undoMenu.getByRole('menuitem', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.text-annotation')).toHaveCount(3)

  const redoMenu = await rightClickBlankPage(page)
  await redoMenu.getByRole('menuitem', { name: 'Redo', exact: true }).click()
  await expect(page.locator('.text-annotation')).toHaveCount(2)
})

test('Ctrl/Cmd clipboard shortcuts mirror the context menu', async ({ page }, testInfo) => {
  const source = testInfo.outputPath('context-shortcuts.pdf')
  await makePdf(source)
  await openPdf(page, source)

  await page.locator('.forge-editor-switch').getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByTitle('Add text').click()
  await page.locator('.pdf-page').first().click({ position: { x: 230, y: 220 } })
  await expect(page.locator('.text-annotation')).toHaveCount(1)

  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(page.locator('.text-annotation')).toHaveCount(2)

  await page.keyboard.press('Control+d')
  await expect(page.locator('.text-annotation')).toHaveCount(3)

  await page.keyboard.press('Control+x')
  await expect(page.locator('.text-annotation')).toHaveCount(2)
  await page.keyboard.press('Control+v')
  await expect(page.locator('.text-annotation')).toHaveCount(3)
})
