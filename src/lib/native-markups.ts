import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib'

export type NativeMarkupSubtype = 'Highlight' | 'Underline' | 'StrikeOut' | 'Squiggly'
export type NativeMarkupGeometry = { x: number; y: number; width: number; height: number }

export type NativeMarkupInfo = {
  pageIndex: number
  annotationIndex: number
  subtype: NativeMarkupSubtype
  text: string
  author: string
  color: string
  opacity: number
  quadCount: number
  geometry: NativeMarkupGeometry
}

export type NativeMarkupUpdate = {
  text: string
  author: string
  color: string
  opacity: number
  geometry?: NativeMarkupGeometry
}

const SUPPORTED = new Set(['/Highlight', '/Underline', '/StrikeOut', '/Squiggly'])

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function rounded(value: number) { return Math.round(value * 100) / 100 }

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

function componentToHex(value: number) { return Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, '0') }

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

function quadValues(dict: PDFDict) {
  const quadPoints = dict.lookupMaybe(PDFName.of('QuadPoints'), PDFArray)
  if (!quadPoints) return []
  const values: number[] = []
  for (let index = 0; index < quadPoints.size(); index++) {
    const number = quadPoints.lookup(index, PDFNumber)
    if (number) values.push(number.asNumber())
  }
  return values
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

function boundsFromValues(values: number[]): Bounds | null {
  if (values.length < 2) return null
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (let index = 0; index + 1 < values.length; index += 2) {
    const x = values[index]; const y = values[index + 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

function geometryFromQuads(pdf: PDFDocument, pageIndex: number, dict: PDFDict): NativeMarkupGeometry {
  const page = pdf.getPage(pageIndex)
  const { width: pageWidth, height: pageHeight } = page.getSize()
  const bounds = boundsFromValues(quadValues(dict))
  if (!bounds || pageWidth <= 0 || pageHeight <= 0) return { x: 0, y: 0, width: 10, height: 3 }
  return {
    x: rounded(clamp(bounds.minX / pageWidth * 100, 0, 100)),
    y: rounded(clamp((pageHeight - bounds.maxY) / pageHeight * 100, 0, 100)),
    width: rounded(clamp((bounds.maxX - bounds.minX) / pageWidth * 100, 0.1, 100)),
    height: rounded(clamp((bounds.maxY - bounds.minY) / pageHeight * 100, 0.1, 100)),
  }
}

function targetBounds(geometry: NativeMarkupGeometry, pageWidth: number, pageHeight: number): Bounds {
  const xPercent = clamp(Number(geometry.x) || 0, 0, 99.9)
  const yPercent = clamp(Number(geometry.y) || 0, 0, 99.9)
  const widthPercent = clamp(Number(geometry.width) || 0.1, 0.1, 100 - xPercent)
  const heightPercent = clamp(Number(geometry.height) || 0.1, 0.1, 100 - yPercent)
  const minX = pageWidth * xPercent / 100
  const width = pageWidth * widthPercent / 100
  const height = pageHeight * heightPercent / 100
  const maxY = pageHeight - pageHeight * yPercent / 100
  return { minX, minY: maxY - height, maxX: minX + width, maxY }
}

function transformQuads(values: number[], from: Bounds, to: Bounds) {
  const oldWidth = Math.max(0.000001, from.maxX - from.minX)
  const oldHeight = Math.max(0.000001, from.maxY - from.minY)
  const newWidth = to.maxX - to.minX
  const newHeight = to.maxY - to.minY
  const output: number[] = []
  for (let index = 0; index + 1 < values.length; index += 2) {
    const x = values[index]; const y = values[index + 1]
    output.push(to.minX + ((x - from.minX) / oldWidth) * newWidth)
    output.push(to.minY + ((y - from.minY) / oldHeight) * newHeight)
  }
  return output
}

function markupAt(pdf: PDFDocument, pageIndex: number, annotationIndex: number) {
  const page = pdf.getPage(pageIndex)
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots || annotationIndex < 0 || annotationIndex >= annots.size()) return null
  const dict = annotationDict(pdf, annots, annotationIndex)
  const subtypeName = dict?.get(PDFName.of('Subtype'))?.toString() || ''
  if (!dict || !SUPPORTED.has(subtypeName)) return null
  return { page, annots, dict, subtype: subtypeName.slice(1) as NativeMarkupSubtype }
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
      const quads = quadValues(dict)
      result.push({
        pageIndex,
        annotationIndex,
        subtype: subtypeName.slice(1) as NativeMarkupSubtype,
        text: textValue(dict.lookup(PDFName.of('Contents'))),
        author: textValue(dict.lookup(PDFName.of('T'))),
        color: colorHex(dict),
        opacity: clamp(dict.lookupMaybe(PDFName.of('CA'), PDFNumber)?.asNumber() ?? 1, 0, 1),
        quadCount: Math.floor(quads.length / 8),
        geometry: geometryFromQuads(pdf, pageIndex, dict),
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

  if (update.geometry) {
    const current = quadValues(located.dict)
    const from = boundsFromValues(current)
    if (from && current.length >= 8) {
      const { width: pageWidth, height: pageHeight } = located.page.getSize()
      const to = targetBounds(update.geometry, pageWidth, pageHeight)
      located.dict.set(PDFName.of('QuadPoints'), pdf.context.obj(transformQuads(current, from, to)))
      located.dict.set(PDFName.of('Rect'), pdf.context.obj([to.minX, to.minY, to.maxX, to.maxY]))
    }
  }

  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function deleteNativeMarkup(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const located = markupAt(pdf, pageIndex, annotationIndex)
  if (!located) throw new Error('This text markup annotation no longer exists.')
  located.annots.remove(annotationIndex)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
