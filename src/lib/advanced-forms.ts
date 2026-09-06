import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFField,
  PDFWidgetAnnotation,
  PDFTextField,
  TextAlignment,
  rgb,
} from 'pdf-lib'

export type FormWidgetGeometry = { x: number; y: number; width: number; height: number }
export type FormWidgetInfo = {
  widgetIndex: number
  pageIndex: number
  geometry: FormWidgetGeometry
  backgroundColor: string
  borderColor: string
  borderWidth: number
}

export type AdvancedFormFieldInfo = {
  name: string
  type: 'text' | 'checkbox' | 'dropdown' | 'list' | 'radio' | 'other'
  value: string | string[] | boolean | null
  options: string[]
  widgets: FormWidgetInfo[]
  text?: {
    multiline: boolean
    password: boolean
    combing: boolean
    maxLength?: number
    fontSize?: number
    textColor: string
    alignment: 0 | 1 | 2
  }
}

export type WidgetUpdate = {
  geometry?: FormWidgetGeometry
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
}

export type FormWidgetTarget = { fieldName: string; widgetIndex: number }
export type FormWidgetGeometryUpdate = FormWidgetTarget & { geometry: FormWidgetGeometry }

export type TextBehaviorUpdate = {
  multiline: boolean
  password: boolean
  combing: boolean
  maxLength?: number
  fontSize?: number
  textColor: string
  alignment: 0 | 1 | 2
}

export type FormDataValue = string | string[] | boolean | null
export type FormDataPayload = {
  version: 1
  values: Record<string, FormDataValue>
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function rounded(value: number) { return Math.round(value * 100) / 100 }

function toHex(values: number[] | undefined, fallback: string) {
  if (!values?.length) return fallback
  let rgb: [number, number, number]
  if (values.length === 1) rgb = [values[0], values[0], values[0]]
  else if (values.length >= 4) {
    const [c, m, y, k] = values
    rgb = [1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k)]
  } else rgb = [values[0] || 0, values[1] || 0, values[2] || 0]
  const part = (value: number) => Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, '0')
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`
}

function parseHex(value: string) {
  const raw = /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : 'ffffff'
  return [0, 2, 4].map((offset) => parseInt(raw.slice(offset, offset + 2), 16) / 255)
}

function pdfColor(value: string) {
  const [r, g, b] = parseHex(value)
  return rgb(r, g, b)
}

function parseDefaultAppearance(da: string) {
  const rgb = da.match(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+rg/g)?.at(-1)
  const gray = da.match(/(-?\d*\.?\d+)\s+g/g)?.at(-1)
  let color = '#000000'
  if (rgb) {
    const match = rgb.match(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+rg/)
    if (match) color = toHex([Number(match[1]), Number(match[2]), Number(match[3])], '#000000')
  } else if (gray) {
    const match = gray.match(/(-?\d*\.?\d+)\s+g/)
    if (match) color = toHex([Number(match[1])], '#000000')
  }
  const tf = da.match(/\/[^\s/]+\s+(-?\d*\.?\d+)\s+Tf/g)?.at(-1)
  const size = tf?.match(/(-?\d*\.?\d+)\s+Tf/)?.[1]
  return { color, fontSize: size ? Number(size) : undefined }
}

function setDefaultTextColor(field: PDFTextField, color: string) {
  const acro = field.acroField
  const current = acro.getDefaultAppearance() || '/Helv 12 Tf 0 g'
  const cleaned = current
    .replace(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+rg/g, '')
    .replace(/(-?\d*\.?\d+)\s+g/g, '')
    .trim()
  const [r, g, b] = parseHex(color)
  acro.setDefaultAppearance(`${cleaned}\n${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`)
}

function fieldType(field: unknown): AdvancedFormFieldInfo['type'] {
  if (field instanceof PDFTextField) return 'text'
  if (field instanceof PDFCheckBox) return 'checkbox'
  if (field instanceof PDFDropdown) return 'dropdown'
  if (field instanceof PDFOptionList) return 'list'
  if (field instanceof PDFRadioGroup) return 'radio'
  return 'other'
}

function fieldValue(field: unknown): AdvancedFormFieldInfo['value'] {
  if (field instanceof PDFTextField) return field.getText() ?? ''
  if (field instanceof PDFCheckBox) return field.isChecked()
  if (field instanceof PDFDropdown) return field.getSelected()
  if (field instanceof PDFOptionList) return field.getSelected()
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? null
  return null
}

function fieldOptions(field: unknown) {
  if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) return field.getOptions()
  return []
}

function pageRefMap(pdf: PDFDocument) {
  const map = new Map<string, number>()
  pdf.getPages().forEach((page, index) => map.set(page.ref.toString(), index))
  return map
}

function findWidgetPage(pdf: PDFDocument, widget: { dict: PDFDict }, refMap: Map<string, number>) {
  const p = widget.dict.get(PDFName.of('P'))
  if (p instanceof PDFRef) {
    const found = refMap.get(p.toString())
    if (found !== undefined) return found
  }
  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex++) {
    const annots = pdf.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    for (let index = 0; index < annots.size(); index++) {
      const raw = annots.get(index)
      try {
        const resolved = raw instanceof PDFRef ? pdf.context.lookup(raw) : raw
        if (resolved === widget.dict) return pageIndex
      } catch { /* skip malformed references */ }
    }
  }
  return 0
}

function widgetInfo(pdf: PDFDocument, widget: PDFWidgetAnnotation, widgetIndex: number, refMap: Map<string, number>): FormWidgetInfo {
  const pageIndex = findWidgetPage(pdf, widget, refMap)
  const page = pdf.getPage(pageIndex)
  const pageSize = page.getSize()
  const rect = widget.getRectangle()
  const ac = widget.getAppearanceCharacteristics?.()
  const bs = widget.getBorderStyle?.()
  const bg = ac?.getBackgroundColor?.() as number[] | undefined
  const bc = ac?.getBorderColor?.() as number[] | undefined
  return {
    widgetIndex,
    pageIndex,
    geometry: {
      x: rounded(clamp(rect.x / pageSize.width * 100, 0, 100)),
      y: rounded(clamp((pageSize.height - rect.y - rect.height) / pageSize.height * 100, 0, 100)),
      width: rounded(clamp(rect.width / pageSize.width * 100, 0.1, 100)),
      height: rounded(clamp(rect.height / pageSize.height * 100, 0.1, 100)),
    },
    backgroundColor: toHex(bg, '#ffffff'),
    borderColor: toHex(bc, '#000000'),
    borderWidth: Math.max(0, bs?.getWidth?.() ?? 1),
  }
}

export async function listAdvancedFormFields(bytes: ArrayBuffer): Promise<AdvancedFormFieldInfo[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  const refs = pageRefMap(pdf)
  return form.getFields().map((field) => {
    const type = fieldType(field)
    const widgets = field.acroField.getWidgets().map((widget, widgetIndex) => widgetInfo(pdf, widget, widgetIndex, refs))
    const info: AdvancedFormFieldInfo = {
      name: field.getName(),
      type,
      value: fieldValue(field),
      options: fieldOptions(field),
      widgets,
    }
    if (field instanceof PDFTextField) {
      const da = parseDefaultAppearance(field.acroField.getDefaultAppearance() || '')
      const alignment = field.getAlignment()
      info.text = {
        multiline: field.isMultiline(),
        password: field.isPassword(),
        combing: field.isCombed(),
        maxLength: field.getMaxLength(),
        fontSize: da.fontSize,
        textColor: da.color,
        alignment: alignment === TextAlignment.Center ? 1 : alignment === TextAlignment.Right ? 2 : 0,
      }
    }
    return info
  })
}

export async function updateFormWidget(bytes: ArrayBuffer, fieldName: string, widgetIndex: number, update: WidgetUpdate) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  const field = form.getField(fieldName)
  const widgets = field.acroField.getWidgets()
  const widget = widgets[widgetIndex]
  if (!widget) throw new Error('This form widget no longer exists.')
  const refs = pageRefMap(pdf)
  const pageIndex = findWidgetPage(pdf, widget, refs)
  const { width: pageWidth, height: pageHeight } = pdf.getPage(pageIndex).getSize()
  if (update.geometry) {
    const xP = clamp(Number(update.geometry.x) || 0, 0, 99.9)
    const yP = clamp(Number(update.geometry.y) || 0, 0, 99.9)
    const wP = clamp(Number(update.geometry.width) || 0.1, 0.1, 100 - xP)
    const hP = clamp(Number(update.geometry.height) || 0.1, 0.1, 100 - yP)
    const x = pageWidth * xP / 100
    const width = pageWidth * wP / 100
    const height = pageHeight * hP / 100
    const y = pageHeight - pageHeight * yP / 100 - height
    widget.setRectangle({ x, y, width, height })
  }

  if (update.backgroundColor !== undefined) widget.getOrCreateAppearanceCharacteristics().setBackgroundColor(parseHex(update.backgroundColor))
  if (update.borderColor !== undefined) widget.getOrCreateAppearanceCharacteristics().setBorderColor(parseHex(update.borderColor))
  if (update.borderWidth !== undefined) widget.getOrCreateBorderStyle().setWidth(Math.max(0, Number(update.borderWidth) || 0))
  form.markFieldAsDirty(field.ref)
  return (await pdf.save({ useObjectStreams: true, updateFieldAppearances: true })).buffer as ArrayBuffer
}

export async function updateFormWidgetGeometries(bytes: ArrayBuffer, updates: FormWidgetGeometryUpdate[]) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  const refs = pageRefMap(pdf)
  for (const update of updates) {
    const field = form.getField(update.fieldName)
    const widget = field.acroField.getWidgets()[update.widgetIndex]
    if (!widget) throw new Error(`Widget ${update.widgetIndex + 1} for ${update.fieldName} no longer exists.`)
    const pageIndex = findWidgetPage(pdf, widget, refs)
    const { width: pageWidth, height: pageHeight } = pdf.getPage(pageIndex).getSize()
    const xP = clamp(Number(update.geometry.x) || 0, 0, 99.9)
    const yP = clamp(Number(update.geometry.y) || 0, 0, 99.9)
    const wP = clamp(Number(update.geometry.width) || 0.1, 0.1, 100 - xP)
    const hP = clamp(Number(update.geometry.height) || 0.1, 0.1, 100 - yP)
    widget.setRectangle({
      x: pageWidth * xP / 100,
      y: pageHeight - pageHeight * yP / 100 - pageHeight * hP / 100,
      width: pageWidth * wP / 100,
      height: pageHeight * hP / 100,
    })
    form.markFieldAsDirty(field.ref)
  }
  return (await pdf.save({ useObjectStreams: true, updateFieldAppearances: true })).buffer as ArrayBuffer
}

function copyFieldFlags(source: PDFField, target: PDFField) {
  source.isReadOnly() ? target.enableReadOnly() : target.disableReadOnly()
  source.isRequired() ? target.enableRequired() : target.disableRequired()
  source.isExported() ? target.enableExporting() : target.disableExporting()
}

function uniqueFieldName(existing: Set<string>, sourceName: string, pageIndex?: number) {
  const suffix = pageIndex === undefined ? 'copy' : `page_${pageIndex + 1}`
  let candidate = `${sourceName}_${suffix}`
  let index = 2
  while (existing.has(candidate)) candidate = `${sourceName}_${suffix}_${index++}`
  existing.add(candidate)
  return candidate
}

export async function duplicateFormWidgets(bytes: ArrayBuffer, targets: FormWidgetTarget[], targetPageIndex?: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  const refs = pageRefMap(pdf)
  const existing = new Set(form.getFields().map(field => field.getName()))

  for (const target of targets) {
    const source = form.getField(target.fieldName)
    const widget = source.acroField.getWidgets()[target.widgetIndex]
    if (!widget) throw new Error(`Widget ${target.widgetIndex + 1} for ${target.fieldName} no longer exists.`)
    const sourcePageIndex = findWidgetPage(pdf, widget, refs)
    const destinationIndex = targetPageIndex === undefined ? sourcePageIndex : clamp(Math.floor(targetPageIndex), 0, pdf.getPageCount() - 1)
    const destination = pdf.getPage(destinationIndex)
    const sourceGeometry = widgetInfo(pdf, widget, target.widgetIndex, refs).geometry
    const offset = targetPageIndex === undefined ? 2 : 0
    const geometry = {
      x: clamp(sourceGeometry.x + offset, 0, 99.9),
      y: clamp(sourceGeometry.y + offset, 0, 99.9),
      width: sourceGeometry.width,
      height: sourceGeometry.height,
    }
    geometry.width = clamp(geometry.width, 0.1, 100 - geometry.x)
    geometry.height = clamp(geometry.height, 0.1, 100 - geometry.y)
    const pageSize = destination.getSize()
    const appearance = widgetInfo(pdf, widget, target.widgetIndex, refs)
    const options = {
      x: pageSize.width * geometry.x / 100,
      y: pageSize.height - pageSize.height * geometry.y / 100 - pageSize.height * geometry.height / 100,
      width: pageSize.width * geometry.width / 100,
      height: pageSize.height * geometry.height / 100,
      backgroundColor: pdfColor(appearance.backgroundColor),
      borderColor: pdfColor(appearance.borderColor),
      borderWidth: appearance.borderWidth,
    }
    const name = uniqueFieldName(existing, source.getName(), targetPageIndex)
    let copy: PDFField
    if (source instanceof PDFTextField) {
      const field = form.createTextField(name)
      field.setText(source.getText() || '')
      source.isMultiline() && field.enableMultiline()
      source.isPassword() && field.enablePassword()
      source.isFileSelector() && field.enableFileSelection()
      source.isSpellChecked() ? field.enableSpellChecking() : field.disableSpellChecking()
      source.isScrollable() ? field.enableScrolling() : field.disableScrolling()
      source.isRichFormatted() && field.enableRichFormatting()
      const maxLength = source.getMaxLength()
      if (maxLength) field.setMaxLength(maxLength)
      if (source.isCombed() && maxLength && !source.isMultiline() && !source.isPassword()) field.enableCombing()
      field.setAlignment(source.getAlignment())
      const defaultAppearance = parseDefaultAppearance(source.acroField.getDefaultAppearance() || '')
      field.addToPage(destination, options)
      if (defaultAppearance.fontSize) field.setFontSize(defaultAppearance.fontSize)
      setDefaultTextColor(field, defaultAppearance.color)
      copy = field
    } else if (source instanceof PDFCheckBox) {
      const field = form.createCheckBox(name)
      field.addToPage(destination, options)
      if (source.isChecked()) field.check()
      copy = field
    } else if (source instanceof PDFDropdown) {
      const field = form.createDropdown(name)
      field.addOptions(source.getOptions())
      source.isMultiselect() && field.enableMultiselect()
      source.isEditable() && field.enableEditing()
      source.isSorted() && field.enableSorting()
      source.isSpellChecked() ? field.enableSpellChecking() : field.disableSpellChecking()
      source.isSelectOnClick() && field.enableSelectOnClick()
      field.addToPage(destination, options)
      const selected = source.getSelected()
      if (selected.length) field.select(source.isMultiselect() ? selected : selected[0])
      copy = field
    } else if (source instanceof PDFOptionList) {
      const field = form.createOptionList(name)
      field.addOptions(source.getOptions())
      source.isMultiselect() && field.enableMultiselect()
      source.isSorted() && field.enableSorting()
      source.isSelectOnClick() && field.enableSelectOnClick()
      field.addToPage(destination, options)
      const selected = source.getSelected()
      if (selected.length) field.select(selected)
      copy = field
    } else if (source instanceof PDFRadioGroup) {
      const field = form.createRadioGroup(name)
      source.isOffToggleable() ? field.enableOffToggling() : field.disableOffToggling()
      source.isMutuallyExclusive() ? field.enableMutualExclusion() : field.disableMutualExclusion()
      const option = source.getOptions()[target.widgetIndex] || widget.getOnValue()?.decodeText() || 'Option'
      field.addOptionToPage(option, destination, options)
      if (source.getSelected() === option) field.select(option)
      copy = field
    } else {
      throw new Error(`Duplicating ${target.fieldName} is not supported for this field type.`)
    }
    copyFieldFlags(source, copy)
  }
  return (await pdf.save({ useObjectStreams: true, updateFieldAppearances: true })).buffer as ArrayBuffer
}

export async function updateTextFieldBehavior(bytes: ArrayBuffer, fieldName: string, update: TextBehaviorUpdate) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  const field = form.getTextField(fieldName)
  update.multiline ? field.enableMultiline() : field.disableMultiline()
  update.password ? field.enablePassword() : field.disablePassword()

  const maxLength = update.maxLength && update.maxLength > 0 ? Math.floor(update.maxLength) : undefined
  if (maxLength) field.setMaxLength(maxLength)
  else if (field.getMaxLength() !== undefined) field.removeMaxLength()

  if (update.combing) {
    if (!maxLength) throw new Error('Combing requires a positive max length.')
    if (update.multiline || update.password) throw new Error('Combing cannot be combined with multiline or password mode.')
    field.enableCombing()
  } else field.disableCombing()

  if (update.fontSize && update.fontSize > 0) field.setFontSize(clamp(update.fontSize, 1, 300))
  field.setAlignment(update.alignment === 1 ? TextAlignment.Center : update.alignment === 2 ? TextAlignment.Right : TextAlignment.Left)
  setDefaultTextColor(field, update.textColor)
  form.markFieldAsDirty(field.ref)
  return (await pdf.save({ useObjectStreams: true, updateFieldAppearances: true })).buffer as ArrayBuffer
}

export async function updateChoiceOptions(bytes: ArrayBuffer, fieldName: string, options: string[], selected: string[]) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  const field = form.getField(fieldName)
  const cleaned = [...new Set(options.map((value) => value.trim()).filter(Boolean))]
  if (!cleaned.length) throw new Error('Choice fields need at least one option.')
  if (field instanceof PDFDropdown) {
    field.setOptions(cleaned)
    if (selected[0] && cleaned.includes(selected[0])) field.select(selected[0])
    else field.clear()
  } else if (field instanceof PDFOptionList) {
    field.setOptions(cleaned)
    const valid = selected.filter((value) => cleaned.includes(value))
    if (valid.length) field.select(valid)
    else field.clear()
  } else throw new Error('This field is not a dropdown or option list.')
  return (await pdf.save({ useObjectStreams: true, updateFieldAppearances: true })).buffer as ArrayBuffer
}

export async function updateSimpleFormValue(bytes: ArrayBuffer, fieldName: string, value: string | string[] | boolean | null) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  const field = form.getField(fieldName)
  if (field instanceof PDFTextField) field.setText(typeof value === 'string' ? value : '')
  else if (field instanceof PDFCheckBox) value ? field.check() : field.uncheck()
  else if (field instanceof PDFDropdown) {
    const selected = Array.isArray(value) ? value[0] : typeof value === 'string' ? value : ''
    selected ? field.select(selected) : field.clear()
  } else if (field instanceof PDFOptionList) {
    const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
    selected.length ? field.select(selected) : field.clear()
  } else if (field instanceof PDFRadioGroup) {
    const selected = typeof value === 'string' ? value : ''
    selected ? field.select(selected) : field.clear()
  } else throw new Error('This field type does not expose a simple importable value.')
  return (await pdf.save({ useObjectStreams: true, updateFieldAppearances: true })).buffer as ArrayBuffer
}

export async function exportFormData(bytes: ArrayBuffer): Promise<FormDataPayload> {
  const fields = await listAdvancedFormFields(bytes)
  return { version: 1, values: Object.fromEntries(fields.filter((field) => field.type !== 'other').map((field) => [field.name, field.value])) }
}

export async function importFormData(bytes: ArrayBuffer, payload: unknown) {
  if (!payload || typeof payload !== 'object') throw new Error('Form JSON must be an object.')
  const source = payload as { version?: unknown; values?: unknown }
  const values = source.values
  if (source.version !== 1) throw new Error('Unsupported form JSON version. Expected version 1.')
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Form JSON must contain a values object.')
  for (const value of Object.values(values)) {
    if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' && !(Array.isArray(value) && value.every((item) => typeof item === 'string'))) throw new Error('Form JSON contains an invalid field value.')
  }
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  for (const [name, value] of Object.entries(values)) {
    let field
    try { field = form.getField(name) } catch { continue }
    if (field instanceof PDFTextField) field.setText(typeof value === 'string' ? value : '')
    else if (field instanceof PDFCheckBox) {
      if (typeof value !== 'boolean') throw new Error(`Checkbox ${name} requires a boolean value.`)
      value ? field.check() : field.uncheck()
    }
    else if (field instanceof PDFDropdown) {
      const selected = Array.isArray(value) ? value[0] : typeof value === 'string' ? value : ''
      if (selected && field.getOptions().includes(selected)) field.select(selected); else field.clear()
    } else if (field instanceof PDFOptionList) {
      const selected = (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []).filter((item): item is string => typeof item === 'string' && field.getOptions().includes(item))
      if (selected.length) field.select(selected); else field.clear()
    } else if (field instanceof PDFRadioGroup) {
      const selected = typeof value === 'string' ? value : ''
      if (selected && field.getOptions().includes(selected)) field.select(selected); else field.clear()
    }
  }
  return (await pdf.save({ useObjectStreams: true, updateFieldAppearances: true })).buffer as ArrayBuffer
}

export async function getPageTabOrder(bytes: ArrayBuffer, pageIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const raw = pdf.getPage(pageIndex).node.get(PDFName.of('Tabs'))?.toString()
  return raw === '/R' ? 'row' : raw === '/C' ? 'column' : raw === '/S' ? 'structure' : 'unspecified'
}

export async function setPageTabOrder(bytes: ArrayBuffer, pageIndex: number, mode: 'unspecified' | 'row' | 'column' | 'structure') {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const page = pdf.getPage(pageIndex)
  if (mode === 'unspecified') page.node.delete(PDFName.of('Tabs'))
  else page.node.set(PDFName.of('Tabs'), PDFName.of(mode === 'row' ? 'R' : mode === 'column' ? 'C' : 'S'))
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
