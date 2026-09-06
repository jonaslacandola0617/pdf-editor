import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { duplicateFormWidgets, importFormData, listAdvancedFormFields, updateFormWidget, updateFormWidgetGeometries } from '../src/lib/advanced-forms.ts'

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

test('batch layout and field duplication create real independent widgets', async () => {
  const inputPdf = await PDFDocument.create()
  const first = inputPdf.addPage([600, 800])
  inputPdf.addPage([400, 500])
  const form = inputPdf.getForm()
  const notes = form.createTextField('notes')
  notes.setText('Copied value')
  notes.enableRequired()
  notes.addToPage(first, { x: 60, y: 640, width: 180, height: 40 })
  const agree = form.createCheckBox('agree')
  agree.check()
  agree.addToPage(first, { x: 300, y: 640, width: 24, height: 24 })
  const choice = form.createDropdown('choice')
  choice.addOptions(['One', 'Two'])
  choice.select('Two')
  choice.addToPage(first, { x: 60, y: 560, width: 150, height: 30 })
  const level = form.createRadioGroup('level')
  level.addOptionToPage('Low', first, { x: 300, y: 560, width: 20, height: 20 })
  level.addOptionToPage('High', first, { x: 340, y: 560, width: 20, height: 20 })
  level.select('High')
  const input = (await inputPdf.save()).buffer as ArrayBuffer

  const arranged = await updateFormWidgetGeometries(input, [
    { fieldName: 'notes', widgetIndex: 0, geometry: { x: 15, y: 12, width: 40, height: 8 } },
    { fieldName: 'agree', widgetIndex: 0, geometry: { x: 60, y: 12, width: 5, height: 5 } },
  ])
  const duplicated = await duplicateFormWidgets(arranged, [
    { fieldName: 'notes', widgetIndex: 0 },
    { fieldName: 'choice', widgetIndex: 0 },
    { fieldName: 'level', widgetIndex: 1 },
  ])
  const copied = await duplicateFormWidgets(duplicated, [{ fieldName: 'agree', widgetIndex: 0 }], 1)
  const reopened = await PDFDocument.load(copied)
  const output = reopened.getForm()
  assert.equal(output.getTextField('notes_copy').getText(), 'Copied value')
  assert.equal(output.getTextField('notes_copy').isRequired(), true)
  assert.equal(output.getCheckBox('agree_page_2').isChecked(), true)
  assert.deepEqual(output.getDropdown('choice_copy').getOptions(), ['One', 'Two'])
  assert.deepEqual(output.getDropdown('choice_copy').getSelected(), ['Two'])
  assert.equal(output.getRadioGroup('level_copy').getSelected(), 'High')
  const fields = await listAdvancedFormFields(copied)
  assert.deepEqual(fields.find(field => field.name === 'notes')?.widgets[0].geometry, { x: 15, y: 12, width: 40, height: 8 })
  assert.equal(fields.find(field => field.name === 'notes_copy')?.widgets[0].pageIndex, 0)
  assert.equal(fields.find(field => field.name === 'agree_page_2')?.widgets[0].pageIndex, 1)
})
