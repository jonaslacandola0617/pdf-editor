import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib'
import {
  clearPageLabels,
  listPageLabelRules,
  removePageLabelRule,
  setInitialView,
  upsertPageLabelRule,
} from '../src/lib/document-view.ts'

async function makePdf(pageCount = 3) {
  const pdf = await PDFDocument.create()
  for (let index = 0; index < pageCount; index += 1) pdf.addPage([612, 792])
  const bytes = await pdf.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

test('adds a normalized page-label rule and clamps its page and start number', async () => {
  const input = await makePdf(3)
  const output = await upsertPageLabelRule(input, {
    startPage: 99,
    style: 'roman-lower',
    prefix: 'APP-',
    startNumber: 0,
  })

  assert.deepEqual(await listPageLabelRules(output), [
    { startPage: 2, style: 'roman-lower', prefix: 'APP-', startNumber: 1 },
  ])
})

test('replaces a page-label rule at the same start page instead of duplicating it', async () => {
  const input = await makePdf(4)
  const first = await upsertPageLabelRule(input, {
    startPage: 1,
    style: 'decimal',
    prefix: 'A-',
    startNumber: 1,
  })
  const second = await upsertPageLabelRule(first, {
    startPage: 1,
    style: 'letters-upper',
    prefix: 'B-',
    startNumber: 5,
  })

  assert.deepEqual(await listPageLabelRules(second), [
    { startPage: 1, style: 'letters-upper', prefix: 'B-', startNumber: 5 },
  ])
})

test('removes individual page-label rules and can clear all page labels', async () => {
  const input = await makePdf(4)
  const first = await upsertPageLabelRule(input, {
    startPage: 0,
    style: 'decimal',
    prefix: '',
    startNumber: 1,
  })
  const second = await upsertPageLabelRule(first, {
    startPage: 2,
    style: 'roman-upper',
    prefix: 'R-',
    startNumber: 3,
  })
  const removed = await removePageLabelRule(second, 0)

  assert.deepEqual(await listPageLabelRules(removed), [
    { startPage: 2, style: 'roman-upper', prefix: 'R-', startNumber: 3 },
  ])

  const cleared = await clearPageLabels(removed)
  assert.deepEqual(await listPageLabelRules(cleared), [])
})

test('writes initial page mode, layout and fit-width destination while clamping the page index', async () => {
  const input = await makePdf(2)
  const output = await setInitialView(input, {
    pageIndex: 99,
    magnification: 'fit-width',
    pageMode: 'outlines',
    pageLayout: 'two-column-left',
  })
  const pdf = await PDFDocument.load(output)

  assert.equal(pdf.catalog.get(PDFName.of('PageMode'))?.toString(), '/UseOutlines')
  assert.equal(pdf.catalog.get(PDFName.of('PageLayout'))?.toString(), '/TwoColumnLeft')

  const openAction = pdf.catalog.lookup(PDFName.of('OpenAction'), PDFArray)
  assert.equal(openAction.get(0)?.toString(), pdf.getPage(1).ref.toString())
  assert.equal(openAction.get(1)?.toString(), '/FitH')
})
