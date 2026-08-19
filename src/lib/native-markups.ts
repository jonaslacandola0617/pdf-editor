import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib'

export type NativeMarkupSubtype = 'Highlight' | 'Underline' | 'StrikeOut' | 'Squiggly'

export type NativeMarkupInfo = {
  pageIndex: number
  annotationIndex: number
  subtype: NativeMarkupSubtype
  text: string
  author: string
  color: string
  opacity: number
  quadCount: number
}

export type NativeMarkupUpdate = {
  text: string
  author: string
  color: string
  opacity: number
}

const SUPPORTED = new Set(['/Highlight', '/Underline', '/StrikeOut', '/Squiggly'])

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function textValue(value: unknown) {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  return ''
}

function annotationDict(pdf: PDFDocument, annots: PDFArray, index: number) {
  const raw = annots.get(index)
  if (!raw) return null
  try {
    const resolved = raw instanceof PDFRef ? pdf.context.lookup(raw) : raw
    return resolved instanceof PDFDict ? resolved : null
  } catch {
    return null
  }
}

function colorComponents(dict: PDFDict) {
  const color = dict.lookupMaybe(PDFName.of('C'), PDFArray)
  if (!color) return []
  const values: number[] = []
  for (let index = 0; index < color.size(); index++) {
    const number = color.lookup(index, PDFNumber)
    if (number) values.push(clamp(number.asNumber(), 0, 1))
  }
  return values
}

function componentToHex(value: number) {
  return Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, '0')
}

function colorHex(dict: PDFDict) {
  const values = colorComponents(dict)
  let rgb: [number, number, number]
  if (values.length === 1) rgb = [values[0], values[0], values[0]]
  else if (values.length >= 4) {
    const [c, m, y, k] = values
    rgb = [1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k)]
  } else if (values.length >= 3) rgb = [values[0], values[1], values[2]]
  else rgb = [1, 0.92, 0.2]
  return `#${componentToHex(rgb[0])}${componentToHex(rgb[1])}${componentToHex(rgb[2])}`
}

function parseHexColor(value: string) {
  const normalized = /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : 'ffe633'
  return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255)
}

function markupAt(pdf: PDFDocument, pageIndex: number, annotationIndex: number) {
  const page = pdf.getPage(pageIndex)
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots || annotationIndex < 0 || annotationIndex >= annots.size()) return null
  const dict = annotationDict(pdf, annots, annotationIndex)
  const subtypeName = dict?.get(PDFName.of('Subtype'))?.toString() || ''
  if (!dict || !SUPPORTED.has(subtypeName)) return null
  return { annots, dict, subtype: subtypeName.slice(1) as NativeMarkupSubtype }
}

export async function listNativeMarkups(bytes: ArrayBuffer): Promise<NativeMarkupInfo[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const result: NativeMarkupInfo[] = []
  pdf.getPages().forEach((page, pageIndex) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) return
    for (let annotationIndex = 0; annotationIndex < annots.size(); annotationIndex++) {
      const dict = annotationDict(pdf, annots, annotationIndex)
      const subtypeName = dict?.get(PDFName.of('Subtype'))?.toString() || ''
      if (!dict || !SUPPORTED.has(subtypeName)) continue
      const quadPoints = dict.lookupMaybe(PDFName.of('QuadPoints'), PDFArray)
      result.push({
        pageIndex,
        annotationIndex,
        subtype: subtypeName.slice(1) as NativeMarkupSubtype,
        text: textValue(dict.lookup(PDFName.of('Contents'))),
        author: textValue(dict.lookup(PDFName.of('T'))),
        color: colorHex(dict),
        opacity: clamp(dict.lookupMaybe(PDFName.of('CA'), PDFNumber)?.asNumber() ?? 1, 0, 1),
        quadCount: quadPoints ? Math.floor(quadPoints.size() / 8) : 0,
      })
    }
  })
  return result
}

export async function updateNativeMarkup(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number, update: NativeMarkupUpdate) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const located = markupAt(pdf, pageIndex, annotationIndex)
  if (!located) throw new Error('This text markup annotation no longer exists.')
  located.dict.set(PDFName.of('Contents'), PDFHexString.fromText(update.text))
  if (update.author.trim()) located.dict.set(PDFName.of('T'), PDFHexString.fromText(update.author.trim()))
  else located.dict.delete(PDFName.of('T'))
  located.dict.set(PDFName.of('C'), pdf.context.obj(parseHexColor(update.color)))
  located.dict.set(PDFName.of('CA'), PDFNumber.of(clamp(Number(update.opacity) || 0, 0, 1)))
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function deleteNativeMarkup(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const located = markupAt(pdf, pageIndex, annotationIndex)
  if (!located) throw new Error('This text markup annotation no longer exists.')
  located.annots.remove(annotationIndex)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
