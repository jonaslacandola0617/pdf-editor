import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { importFormData, updateFormWidget } from '../src/lib/advanced-forms.ts'

async function fixture() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const form = pdf.getForm()
  const field = form.createTextField('notes')
  field.setText('Original')
  field.addToPage(page, { x: 60.123456, y: 640.987654, width: 201.123456, height: 31.654321 })
  field.acroField.getWidgets()[0].dict.set(PDFName.of('CustomKey'), PDFString.of('preserve'))
  form.createCheckBox('agree').addToPage(page)
  return (await pdf.save()).buffer as ArrayBuffer
}

test('appearance-only edits preserve exact widget geometry and unrelated keys', async () => {
  const input = await fixture()
  const original = await PDFDocument.load(input)
  const rect = original.getForm().getTextField('notes').acroField.getWidgets()[0].getRectangle()
  const output = await updateFormWidget(input, 'notes', 0, {
    backgroundColor: '#ffeecc', borderColor: '#112233', borderWidth: 3,
  })
  const reopened = await PDFDocument.load(output)
  const widget = reopened.getForm().getTextField('notes').acroField.getWidgets()[0]
  assert.deepEqual(widget.getRectangle(), rect)
  assert.equal(widget.dict.lookup(PDFName.of('CustomKey'), PDFString).decodeText(), 'preserve')
  assert.equal(widget.getBorderStyle()?.getWidth(), 3)
})

test('invalid JSON data is rejected instead of clearing fields or checking a false string', async () => {
  const input = await fixture()
  for (const payload of [
    { version: 2, values: {} },
    { version: 1, values: [] },
    { version: 1, values: { notes: { invalid: true } } },
    { version: 1, values: { agree: 'false' } },
  ]) await assert.rejects(importFormData(input, payload))
  const reopened = await PDFDocument.load(input)
  assert.equal(reopened.getForm().getTextField('notes').getText(), 'Original')
})
