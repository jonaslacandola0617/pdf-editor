import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib'

export type FormFieldPropertyInfo = {
  name: string
  partialName: string
  type: string
  tooltip: string
  readOnly: boolean
  required: boolean
  exported: boolean
}

export type FormFieldPropertyUpdate = {
  name: string
  tooltip: string
  readOnly: boolean
  required: boolean
  exported: boolean
}

function textValue(value: unknown) {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  return ''
}

function fieldType(field: ReturnType<ReturnType<PDFDocument['getForm']>['getFields']>[number]) {
  switch (field.constructor.name) {
    case 'PDFTextField': return 'Text field'
    case 'PDFCheckBox': return 'Checkbox'
    case 'PDFDropdown': return 'Dropdown'
    case 'PDFOptionList': return 'Option list'
    case 'PDFRadioGroup': return 'Radio group'
    case 'PDFSignature': return 'Signature field'
    case 'PDFButton': return 'Button'
    default: return field.constructor.name.replace(/^PDF/, '') || 'Unknown field'
  }
}

function describeField(field: ReturnType<ReturnType<PDFDocument['getForm']>['getFields']>[number]): FormFieldPropertyInfo {
  const name = field.getName()
  const dict = field.acroField.dict
  return {
    name,
    partialName: textValue(dict.lookup(PDFName.of('T'))) || name.split('.').at(-1) || name,
    type: fieldType(field),
    tooltip: textValue(dict.lookup(PDFName.of('TU'))),
    readOnly: field.isReadOnly(),
    required: field.isRequired(),
    exported: field.isExported(),
  }
}

export async function listFormFieldProperties(bytes: ArrayBuffer): Promise<FormFieldPropertyInfo[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return pdf.getForm().getFields().map(describeField).sort((a, b) => a.name.localeCompare(b.name))
}

function resolveRename(originalName: string, requestedName: string) {
  const requested = requestedName.trim()
  if (!requested) throw new Error('Field name cannot be empty.')
  const originalParts = originalName.split('.')
  const parent = originalParts.slice(0, -1).join('.')

  if (!parent) {
    if (requested.includes('.')) throw new Error('Renaming a top-level field cannot move it into a field hierarchy.')
    return { fullName: requested, partialName: requested }
  }

  if (!requested.includes('.')) return { fullName: `${parent}.${requested}`, partialName: requested }
  const requestedParts = requested.split('.')
  const requestedParent = requestedParts.slice(0, -1).join('.')
  const partialName = requestedParts.at(-1) || ''
  if (requestedParent !== parent) throw new Error('Renaming preserves the field’s current parent hierarchy.')
  if (!partialName) throw new Error('Field name cannot be empty.')
  return { fullName: requested, partialName }
}

export async function updateFormFieldProperties(bytes: ArrayBuffer, originalName: string, update: FormFieldPropertyUpdate) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  const field = form.getFieldMaybe(originalName)
  if (!field) throw new Error('This form field no longer exists.')

  const renamed = resolveRename(originalName, update.name)
  if (renamed.fullName !== originalName && form.getFieldMaybe(renamed.fullName)) throw new Error(`A field named “${renamed.fullName}” already exists.`)
  if (renamed.fullName !== originalName) field.acroField.setPartialName(renamed.partialName)

  const tooltip = update.tooltip.trim()
  if (tooltip) field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(tooltip))
  else field.acroField.dict.delete(PDFName.of('TU'))

  if (update.readOnly) field.enableReadOnly()
  else field.disableReadOnly()
  if (update.required) field.enableRequired()
  else field.disableRequired()
  if (update.exported) field.enableExporting()
  else field.disableExporting()

  return {
    bytes: (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer,
    name: renamed.fullName,
  }
}

function removeDanglingPageAnnotations(pdf: PDFDocument) {
  pdf.getPages().forEach((page) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) return
    for (let index = annots.size() - 1; index >= 0; index--) {
      const raw = annots.get(index)
      if (!raw) {
        annots.remove(index)
        continue
      }
      try {
        const resolved = raw instanceof PDFRef ? pdf.context.lookup(raw) : raw
        if (!(resolved instanceof PDFDict)) annots.remove(index)
      } catch {
        annots.remove(index)
      }
    }
    if (!annots.size()) page.node.delete(PDFName.of('Annots'))
  })
}

export async function deleteFormField(bytes: ArrayBuffer, name: string) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  const field = form.getFieldMaybe(name)
  if (!field) throw new Error('This form field no longer exists.')
  form.removeField(field)
  removeDanglingPageAnnotations(pdf)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
