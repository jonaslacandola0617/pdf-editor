import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { readFile, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array) {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, checksum])
}

function makePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y)
      const offset = row + 1 + x * 4
      raw[offset] = r; raw[offset + 1] = g; raw[offset + 2] = b; raw[offset + 3] = a
    }
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())])
}

function pngDimensions(bytes: Buffer) {
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

async function makeContentPdf(path: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([600, 800])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('NATIVE CONTENT TEXT 9941', { x: 60, y: 700, size: 20, font, color: rgb(0, 0, 0), opacity: 1 })
  page.drawText('DELETE CONTENT TEXT 9942', { x: 60, y: 650, size: 14, font, color: rgb(0.1, 0.1, 0.1) })
  const sourcePng = makePng(4, 3, (x, y) => x < 2 ? [235, 55 + y * 20, 40, 255] : [30, 90, 230, 255])
  const image = await pdf.embedPng(sourcePng)
  page.drawImage(image, { x: 60, y: 450, width: 120, height: 90 })
  await writeFile(path, await pdf.save())
}

async function openFile(page: Page, path: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
}

async function exportPdf(page: Page, path: string) {
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  await (await event).saveAs(path)
}

async function openObjects(page: Page) {
  await page.getByTitle('Embedded PDF objects').click()
  const modal = page.locator('.native-object-modal')
  await expect(modal).toBeVisible()
  return modal
}

test('edits existing native text content including replacement, color, opacity, position and effective font size', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const source = testInfo.outputPath('native-content-text-source.pdf')
  await makeContentPdf(source)
  await openFile(page, source)
  const modal = await openObjects(page)
  const manager = modal.locator('.native-page-content-manager')
  await expect(manager).toContainText('Text 2', { timeout: 30_000 })

  const initialRow = manager.locator('.text-content-row').filter({ hasText: 'NATIVE CONTENT TEXT 9941' })
  const objectNumber = Number((await initialRow.locator('.native-page-content-meta').innerText()).match(/Text object (\d+)/)?.[1])
  expect(objectNumber).toBeGreaterThan(0)
  const textInput = manager.getByLabel(`Native page text object ${objectNumber}`)
  const stableRow = textInput.locator('xpath=ancestor::div[contains(@class,"text-content-row")]')
  await stableRow.getByLabel(`Native page text color ${objectNumber}`).fill('#cc2244')
  await stableRow.getByLabel(`Native page text opacity ${objectNumber}`).fill('65')
  await stableRow.getByLabel(`Native page text x ${objectNumber}`).fill('20')
  await stableRow.getByLabel(`Native page text y ${objectNumber}`).fill('12')
  const sizeInput = stableRow.getByLabel(`Native page text font size ${objectNumber}`)
  if (await sizeInput.count()) await sizeInput.fill('30')
  await textInput.fill('UPDATED NATIVE CONTENT 9941')
  await stableRow.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Updating native page text complete', { timeout: 30_000 })

  const refreshed = manager.locator('.text-content-row').filter({ hasText: 'UPDATED NATIVE CONTENT 9941' })
  await expect(refreshed).toBeVisible({ timeout: 30_000 })
  const refreshedNumber = Number((await refreshed.locator('.native-page-content-meta').innerText()).match(/Text object (\d+)/)?.[1])
  await expect(refreshed.getByLabel(`Native page text color ${refreshedNumber}`)).toHaveValue('#cc2244')
  await expect(refreshed.getByLabel(`Native page text opacity ${refreshedNumber}`)).toHaveValue('65')
  expect(Number(await refreshed.getByLabel(`Native page text x ${refreshedNumber}`).inputValue())).toBeCloseTo(20, 1)
  expect(Number(await refreshed.getByLabel(`Native page text y ${refreshedNumber}`).inputValue())).toBeCloseTo(12, 1)
  if (await refreshed.getByLabel(`Native page text font size ${refreshedNumber}`).count()) {
    expect(Number(await refreshed.getByLabel(`Native page text font size ${refreshedNumber}`).inputValue())).toBeCloseTo(30, 0)
  }

  const deleteRow = manager.locator('.text-content-row').filter({ hasText: 'DELETE CONTENT TEXT 9942' })
  await deleteRow.getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Deleting native text object complete', { timeout: 30_000 })
  await expect(manager).not.toContainText('DELETE CONTENT TEXT 9942')

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('native-content-text-export.pdf')
  await exportPdf(page, exported)

  await page.getByTitle('Close document').click()
  await page.locator('input[type="file"]').first().setInputFiles(exported)
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
  const search = page.locator('.search-box input')
  await search.fill('UPDATED NATIVE CONTENT 9941')
  await search.press('Enter')
  await expect(page.locator('.search-count')).not.toContainText('No matches', { timeout: 20_000 })
  await search.fill('DELETE CONTENT TEXT 9942')
  await search.press('Enter')
  await expect(page.locator('.search-count')).toContainText('No matches', { timeout: 20_000 })
})

test('extracts, replaces, moves/resizes and deletes an existing native image page object', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const source = testInfo.outputPath('native-content-image-source.pdf')
  await makeContentPdf(source)
  const replacement = testInfo.outputPath('replacement-7x5.png')
  await writeFile(replacement, makePng(7, 5, (x, y) => [20 + x * 20, 220 - y * 25, 90, 255]))
  await openFile(page, source)
  const modal = await openObjects(page)
  const manager = modal.locator('.native-page-content-manager')
  await expect(manager).toContainText('Images 1', { timeout: 30_000 })
  let row = manager.locator('.image-content-row').first()
  await expect(row).toContainText('4×3px')
  const objectNumber = Number((await row.locator('.native-page-content-meta').innerText()).match(/Image object (\d+)/)?.[1])

  const extractEvent = page.waitForEvent('download')
  await row.getByRole('button', { name: 'Extract PNG' }).click()
  const originalExtract = testInfo.outputPath('original-extracted.png')
  await (await extractEvent).saveAs(originalExtract)
  expect(pngDimensions(await readFile(originalExtract))).toEqual({ width: 4, height: 3 })

  await row.getByLabel(`Native page image x ${objectNumber}`).fill('30')
  await row.getByLabel(`Native page image y ${objectNumber}`).fill('35')
  await row.getByLabel(`Native page image width ${objectNumber}`).fill('25')
  await row.getByLabel(`Native page image height ${objectNumber}`).fill('15')
  await row.getByRole('button', { name: 'Move / resize' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Moving/resizing native PDF image complete', { timeout: 30_000 })

  row = manager.locator('.image-content-row').first()
  const currentNumber = Number((await row.locator('.native-page-content-meta').innerText()).match(/Image object (\d+)/)?.[1])
  expect(Number(await row.getByLabel(`Native page image x ${currentNumber}`).inputValue())).toBeCloseTo(30, 1)
  expect(Number(await row.getByLabel(`Native page image y ${currentNumber}`).inputValue())).toBeCloseTo(35, 1)
  expect(Number(await row.getByLabel(`Native page image width ${currentNumber}`).inputValue())).toBeCloseTo(25, 1)
  expect(Number(await row.getByLabel(`Native page image height ${currentNumber}`).inputValue())).toBeCloseTo(15, 1)

  const hiddenInput = row.locator('input[type="file"]')
  await hiddenInput.setInputFiles(replacement)
  await expect(page.locator('.stage-top-hint')).toContainText('Replacing native PDF image complete', { timeout: 30_000 })
  row = manager.locator('.image-content-row').first()
  await expect(row).toContainText('7×5px', { timeout: 30_000 })

  const replacedExtractEvent = page.waitForEvent('download')
  await row.getByRole('button', { name: 'Extract PNG' }).click()
  const replacedExtract = testInfo.outputPath('replacement-extracted.png')
  await (await replacedExtractEvent).saveAs(replacedExtract)
  expect(pngDimensions(await readFile(replacedExtract))).toEqual({ width: 7, height: 5 })

  await row.getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.stage-top-hint')).toContainText('Deleting native image object complete', { timeout: 30_000 })
  await expect(manager).toContainText('Images 0')
  await expect(manager.locator('.image-content-row')).toHaveCount(0)

  await modal.getByTitle('Close embedded objects').click()
  const exported = testInfo.outputPath('native-content-image-export.pdf')
  await exportPdf(page, exported)
  await page.getByTitle('Close document').click()
  await page.locator('input[type="file"]').first().setInputFiles(exported)
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
  const reopenedModal = await openObjects(page)
  await expect(reopenedModal.locator('.native-page-content-manager')).toContainText('Images 0', { timeout: 30_000 })
})
