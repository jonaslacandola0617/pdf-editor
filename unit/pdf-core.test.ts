import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument } from 'pdf-lib'
import {
  cropPage,
  duplicatePage,
  fileSize,
  getPageCount,
  insertBlankPage,
  parsePageRange,
  reorderPdf,
} from '../src/lib/pdf.ts'

async function makeSizedPdf() {
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 500])
  pdf.addPage([500, 600])
  pdf.addPage([600, 700])
  const bytes = await pdf.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

test('fileSize presents bytes, kilobytes and megabytes predictably', () => {
  assert.equal(fileSize(800), '800 B')
  assert.equal(fileSize(1536), '1.5 KB')
  assert.equal(fileSize(2 * 1024 * 1024), '2.0 MB')
})

test('parsePageRange normalizes, deduplicates, sorts and clamps page selections', () => {
  assert.deepEqual(parsePageRange('5, 2-4, 3, 9-12, bad, 0', 10), [1, 2, 3, 4, 8, 9])
  assert.deepEqual(parsePageRange('4-2', 5), [1, 2, 3])
  assert.deepEqual(parsePageRange('', 5), [])
})

test('duplicatePage inserts a copy immediately after the selected page', async () => {
  const input = await makeSizedPdf()
  const output = await duplicatePage(input, 1)
  const pdf = await PDFDocument.load(output)

  assert.equal(pdf.getPageCount(), 4)
  assert.deepEqual(pdf.getPages().map((page) => page.getWidth()), [400, 500, 500, 600])
})

test('reorderPdf follows the requested page order and applies output rotations', async () => {
  const input = await makeSizedPdf()
  const output = await reorderPdf(input, [2, 0], [90, 180])
  const pdf = await PDFDocument.load(output)

  assert.equal(pdf.getPageCount(), 2)
  assert.deepEqual(pdf.getPages().map((page) => page.getWidth()), [600, 400])
  assert.deepEqual(pdf.getPages().map((page) => page.getRotation().angle), [90, 180])
})

test('insertBlankPage clamps the index and matches the adjacent page dimensions', async () => {
  const input = await makeSizedPdf()
  const output = await insertBlankPage(input, 99, 'match')
  const pdf = await PDFDocument.load(output)

  assert.equal(await getPageCount(output), 4)
  const inserted = pdf.getPage(3)
  assert.equal(inserted.getWidth(), 600)
  assert.equal(inserted.getHeight(), 700)
})

test('cropPage applies proportional crop margins while preserving the underlying page', async () => {
  const input = await makeSizedPdf()
  const output = await cropPage(input, 0, { left: 0.1, right: 0.2, top: 0.1, bottom: 0.1 })
  const pdf = await PDFDocument.load(output)
  const page = pdf.getPage(0)
  const box = page.getCropBox()

  assert.equal(page.getWidth(), 400)
  assert.equal(page.getHeight(), 500)
  assert.equal(box.x, 40)
  assert.equal(box.y, 50)
  assert.equal(box.width, 280)
  assert.equal(box.height, 400)
})
