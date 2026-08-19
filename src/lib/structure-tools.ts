import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  rgb,
} from 'pdf-lib'

export type FormFieldKind = 'text' | 'checkbox' | 'dropdown' | 'list' | 'radio'

export type FormFieldCreateOptions = {
  kind: FormFieldKind
  name: string
  pageIndex: number
  xPercent: number
  yPercent: number
  widthPercent: number
  heightPercent: number
  options?: string[]
  required?: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function fieldRect(pageWidth: number, pageHeight: number, options: Pick<FormFieldCreateOptions, 'xPercent' | 'yPercent' | 'widthPercent' | 'heightPercent'>) {
  const width = pageWidth * clamp(options.widthPercent / 100, 0.03, 0.95)
  const height = pageHeight * clamp(options.heightPercent / 100, 0.02, 0.8)
  const x = clamp(pageWidth * options.xPercent / 100, 0, Math.max(0, pageWidth - width))
  const top = clamp(pageHeight * options.yPercent / 100, 0, Math.max(0, pageHeight - height))
  const y = pageHeight - top - height
  return { x, y, width, height }
}

function uniqueFieldName(form: ReturnType<PDFDocument['getForm']>, requested: string) {
  const base = requested.trim().replace(/\.+/g, '.') || 'field'
  if (!form.getFieldMaybe(base)) return base
  for (let index = 2; index < 1000; index++) {
    const candidate = `${base}_${index}`
    if (!form.getFieldMaybe(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

export async function addFormField(bytes: ArrayBuffer, options: FormFieldCreateOptions) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const pageIndex = clamp(Math.floor(options.pageIndex), 0, Math.max(0, pdf.getPageCount() - 1))
  const page = pdf.getPage(pageIndex)
  const form = pdf.getForm()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const name = uniqueFieldName(form, options.name)
  const rect = fieldRect(page.getWidth(), page.getHeight(), options)
  const appearance = {
    ...rect,
    textColor: rgb(0.08, 0.08, 0.1),
    backgroundColor: rgb(1, 1, 1),
    borderColor: rgb(0.45, 0.45, 0.5),
    borderWidth: 1,
    font,
  }

  if (options.kind === 'text') {
    const field = form.createTextField(name)
    if (options.required) field.enableRequired()
    field.addToPage(page, appearance)
  } else if (options.kind === 'checkbox') {
    const field = form.createCheckBox(name)
    if (options.required) field.enableRequired()
    const size = Math.min(rect.width, rect.height)
    field.addToPage(page, { ...appearance, width: size, height: size })
  } else if (options.kind === 'dropdown') {
    const field = form.createDropdown(name)
    const values = (options.options || []).map((value) => value.trim()).filter(Boolean)
    field.setOptions(values.length ? values : ['Option 1', 'Option 2'])
    if (values.length) field.select(values[0])
    if (options.required) field.enableRequired()
    field.addToPage(page, appearance)
  } else if (options.kind === 'list') {
    const field = form.createOptionList(name)
    const values = (options.options || []).map((value) => value.trim()).filter(Boolean)
    const choices = values.length ? values : ['Option 1', 'Option 2']
    field.setOptions(choices)
    field.select(choices[0])
    if (options.required) field.enableRequired()
    field.addToPage(page, appearance)
  } else {
    const field = form.createRadioGroup(name)
    const values = (options.options || []).map((value) => value.trim()).filter(Boolean)
    const choices = values.length ? values : ['Yes', 'No']
    if (options.required) field.enableRequired()
    const size = Math.min(rect.height / Math.max(1, choices.length), rect.width, 24)
    choices.forEach((choice, index) => {
      field.addOptionToPage(choice, page, {
        x: rect.x,
        y: rect.y + rect.height - size * (index + 1),
        width: size,
        height: size,
        borderColor: rgb(0.45, 0.45, 0.5),
        backgroundColor: rgb(1, 1, 1),
        borderWidth: 1,
      })
    })
    field.select(choices[0])
  }

  form.updateFieldAppearances(font)
  return { bytes: (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer, fieldName: name }
}

function ensureAnnots(pdf: PDFDocument, pageIndex: number) {
  const page = pdf.getPage(pageIndex)
  let annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) {
    annots = pdf.context.obj([]) as PDFArray
    page.node.set(PDFName.of('Annots'), annots)
  }
  return { page, annots }
}

export async function addUriLink(bytes: ArrayBuffer, options: {
  pageIndex: number
  url: string
  xPercent: number
  yPercent: number
  widthPercent: number
  heightPercent: number
}) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const pageIndex = clamp(Math.floor(options.pageIndex), 0, Math.max(0, pdf.getPageCount() - 1))
  const { page, annots } = ensureAnnots(pdf, pageIndex)
  const rect = fieldRect(page.getWidth(), page.getHeight(), options)
  const rawUrl = options.url.trim()
  if (!rawUrl) throw new Error('Enter a URL for the link.')
  const url = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
  const link = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
  })
  annots.push(pdf.context.register(link))
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

function outlineRoot(pdf: PDFDocument) {
  const key = PDFName.of('Outlines')
  const raw = pdf.catalog.get(key)
  if (raw instanceof PDFRef) {
    const dict = pdf.context.lookup(raw, PDFDict)
    return { ref: raw, dict }
  }
  if (raw instanceof PDFDict) {
    const ref = pdf.context.register(raw)
    pdf.catalog.set(key, ref)
    return { ref, dict: raw }
  }
  const dict = pdf.context.obj({ Type: 'Outlines', Count: 0 }) as PDFDict
  const ref = pdf.context.register(dict)
  pdf.catalog.set(key, ref)
  return { ref, dict }
}

export async function addTopLevelBookmark(bytes: ArrayBuffer, title: string, pageIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const safePage = clamp(Math.floor(pageIndex), 0, Math.max(0, pdf.getPageCount() - 1))
  const page = pdf.getPage(safePage)
  const root = outlineRoot(pdf)
  const item = pdf.context.obj({
    Title: PDFHexString.fromText(title.trim() || `Page ${safePage + 1}`),
    Parent: root.ref,
    Dest: [page.ref, 'Fit'],
  }) as PDFDict
  const itemRef = pdf.context.register(item)
  const lastRaw = root.dict.get(PDFName.of('Last'))
  if (lastRaw instanceof PDFRef) {
    const last = pdf.context.lookup(lastRaw, PDFDict)
    last.set(PDFName.of('Next'), itemRef)
    item.set(PDFName.of('Prev'), lastRaw)
  } else {
    root.dict.set(PDFName.of('First'), itemRef)
  }
  root.dict.set(PDFName.of('Last'), itemRef)
  const count = root.dict.lookupMaybe(PDFName.of('Count'), PDFNumber)?.asNumber() || 0
  root.dict.set(PDFName.of('Count'), PDFNumber.of(Math.max(0, count) + 1))
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function addBatesNumbers(bytes: ArrayBuffer, options: {
  prefix?: string
  suffix?: string
  start?: number
  digits?: number
}) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const prefix = options.prefix || ''
  const suffix = options.suffix || ''
  const start = Math.max(0, Math.floor(options.start ?? 1))
  const digits = clamp(Math.floor(options.digits ?? 6), 1, 12)
  pdf.getPages().forEach((page, index) => {
    const value = `${prefix}${String(start + index).padStart(digits, '0')}${suffix}`
    const size = 8
    const width = font.widthOfTextAtSize(value, size)
    page.drawText(value, {
      x: Math.max(24, page.getWidth() - width - 28),
      y: 18,
      size,
      font,
      color: rgb(0.25, 0.25, 0.28),
    })
  })
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

function removeUnsafeActions(dict: PDFDict) {
  dict.delete(PDFName.of('AA'))
  const action = dict.lookupMaybe(PDFName.of('A'), PDFDict)
  if (!action) return
  const kind = action.get(PDFName.of('S'))?.toString()
  if (kind === '/JavaScript' || kind === '/Launch') dict.delete(PDFName.of('A'))
}

export async function privacyCleanupPdf(bytes: ArrayBuffer) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  pdf.setTitle('')
  pdf.setAuthor('')
  pdf.setSubject('')
  pdf.setKeywords([])
  pdf.setCreator('')
  pdf.setProducer('')

  pdf.catalog.delete(PDFName.of('Metadata'))
  pdf.catalog.delete(PDFName.of('OpenAction'))
  pdf.catalog.delete(PDFName.of('AA'))

  const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  if (names) {
    names.delete(PDFName.of('JavaScript'))
    names.delete(PDFName.of('EmbeddedFiles'))
  }

  pdf.getPages().forEach((page) => {
    page.node.delete(PDFName.of('Metadata'))
    page.node.delete(PDFName.of('AA'))
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) return
    for (let index = annots.size() - 1; index >= 0; index--) {
      const annot = pdf.context.lookup(annots.get(index), PDFDict)
      if (!annot) continue
      if (annot.get(PDFName.of('Subtype'))?.toString() === '/FileAttachment') {
        annots.remove(index)
        continue
      }
      removeUnsafeActions(annot)
    }
  })

  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
