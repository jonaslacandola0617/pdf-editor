import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib'

export type NativeExtendedSubtype = 'Ink' | 'Polygon' | 'PolyLine' | 'Stamp' | 'Caret' | 'FileAttachment'

export type AnnotationGeometry = { x: number; y: number; width: number; height: number }

export type NativeExtendedAnnotationInfo = {
  pageIndex: number
  annotationIndex: number
  subtype: NativeExtendedSubtype
  text: string
  author: string
  color: string
  opacity: number
  borderWidth: number
  geometry: AnnotationGeometry
  inkStrokeCount?: number
  vertexCount?: number
  stampName?: string
  caretSymbol?: 'None' | 'P'
  attachment?: { name: string; size: number; icon: string }
}

export type NativeExtendedAnnotationUpdate = {
  text: string
  author: string
  color: string
  opacity: number
  borderWidth: number
  geometry?: AnnotationGeometry
  caretSymbol?: 'None' | 'P'
  attachmentIcon?: string
}

const SUPPORTED = new Set(['/Ink', '/Polygon', '/PolyLine', '/Stamp', '/Caret', '/FileAttachment'])

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
  else rgb = [0.12, 0.5, 0.95]
  return `#${componentToHex(rgb[0])}${componentToHex(rgb[1])}${componentToHex(rgb[2])}`
}

function parseHexColor(value: string) {
  const normalized = /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : '1f80f2'
  return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255)
}

function borderWidth(dict: PDFDict) {
  const bs = dict.lookupMaybe(PDFName.of('BS'), PDFDict)
  const bsWidth = bs?.lookupMaybe(PDFName.of('W'), PDFNumber)?.asNumber()
  if (typeof bsWidth === 'number') return Math.max(0, bsWidth)
  const border = dict.lookupMaybe(PDFName.of('Border'), PDFArray)
  const fallback = border?.lookup(2, PDFNumber)?.asNumber()
  return typeof fallback === 'number' ? Math.max(0, fallback) : 1
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

function boundsFromValues(values: number[]) {
  if (values.length < 2) return null
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (let index = 0; index + 1 < values.length; index += 2) {
    const x = values[index]; const y = values[index + 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

function rawRectBounds(dict: PDFDict) {
  const rect = dict.lookupMaybe(PDFName.of('Rect'), PDFArray)
  if (!rect) return null
  try {
    const box = rect.asRectangle()
    return { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height }
  } catch {
    return null
  }
}

function inkValues(dict: PDFDict) {
  const inkList = dict.lookupMaybe(PDFName.of('InkList'), PDFArray)
  if (!inkList) return [] as number[][]
  const paths: number[][] = []
  for (let pathIndex = 0; pathIndex < inkList.size(); pathIndex++) {
    const path = inkList.lookup(pathIndex, PDFArray)
    if (!path) continue
    const values: number[] = []
    for (let index = 0; index < path.size(); index++) {
      const number = path.lookup(index, PDFNumber)
      if (number) values.push(number.asNumber())
    }
    if (values.length >= 4) paths.push(values)
  }
  return paths
}

function vertexValues(dict: PDFDict) {
  const vertices = dict.lookupMaybe(PDFName.of('Vertices'), PDFArray)
  if (!vertices) return []
  const values: number[] = []
  for (let index = 0; index < vertices.size(); index++) {
    const number = vertices.lookup(index, PDFNumber)
    if (number) values.push(number.asNumber())
  }
  return values
}

function annotationBounds(dict: PDFDict, subtype: NativeExtendedSubtype) {
  if (subtype === 'Ink') {
    const paths = inkValues(dict)
    const bounds = boundsFromValues(paths.flat())
    if (bounds) return bounds
  }
  if (subtype === 'Polygon' || subtype === 'PolyLine') {
    const bounds = boundsFromValues(vertexValues(dict))
    if (bounds) return bounds
  }
  return rawRectBounds(dict)
}

function geometryFromBounds(bounds: Bounds | null, pageWidth: number, pageHeight: number): AnnotationGeometry {
  if (!bounds || pageWidth <= 0 || pageHeight <= 0) return { x: 0, y: 0, width: 10, height: 5 }
  return {
    x: rounded(clamp(bounds.minX / pageWidth * 100, 0, 100)),
    y: rounded(clamp((pageHeight - bounds.maxY) / pageHeight * 100, 0, 100)),
    width: rounded(clamp((bounds.maxX - bounds.minX) / pageWidth * 100, 0.1, 100)),
    height: rounded(clamp((bounds.maxY - bounds.minY) / pageHeight * 100, 0.1, 100)),
  }
}

function rawBoundsFromGeometry(geometry: AnnotationGeometry, pageWidth: number, pageHeight: number): Bounds {
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

function transformValues(values: number[], from: Bounds, to: Bounds) {
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

function setRect(pdf: PDFDocument, dict: PDFDict, bounds: Bounds) {
  dict.set(PDFName.of('Rect'), pdf.context.obj([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]))
}

function fileSpec(dict: PDFDict) { return dict.lookupMaybe(PDFName.of('FS'), PDFDict) || null }

function attachmentData(pdf: PDFDocument, spec: PDFDict) {
  const ef = spec.lookupMaybe(PDFName.of('EF'), PDFDict)
  if (!ef) return new Uint8Array()
  const raw = ef.get(PDFName.of('UF')) || ef.get(PDFName.of('F'))
  if (!raw) return new Uint8Array()
  try {
    const stream = pdf.context.lookup(raw)
    return stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : new Uint8Array()
  } catch {
    return new Uint8Array()
  }
}

function attachmentInfo(pdf: PDFDocument, dict: PDFDict) {
  const spec = fileSpec(dict)
  if (!spec) return undefined
  const name = textValue(spec.lookup(PDFName.of('UF'))) || textValue(spec.lookup(PDFName.of('F'))) || 'attachment.bin'
  const iconRaw = dict.get(PDFName.of('Name'))?.toString() || '/PushPin'
  return { name, size: attachmentData(pdf, spec).byteLength, icon: iconRaw.replace(/^\//, '') }
}

function locatedAnnotation(pdf: PDFDocument, pageIndex: number, annotationIndex: number) {
  const page = pdf.getPage(pageIndex)
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots || annotationIndex < 0 || annotationIndex >= annots.size()) return null
  const dict = annotationDict(pdf, annots, annotationIndex)
  const subtypeName = dict?.get(PDFName.of('Subtype'))?.toString() || ''
  if (!dict || !SUPPORTED.has(subtypeName)) return null
  return { page, annots, dict, subtype: subtypeName.slice(1) as NativeExtendedSubtype }
}

export async function listNativeExtendedAnnotations(bytes: ArrayBuffer): Promise<NativeExtendedAnnotationInfo[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const result: NativeExtendedAnnotationInfo[] = []
  pdf.getPages().forEach((page, pageIndex) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) return
    const { width, height } = page.getSize()
    for (let annotationIndex = 0; annotationIndex < annots.size(); annotationIndex++) {
      const dict = annotationDict(pdf, annots, annotationIndex)
      const subtypeName = dict?.get(PDFName.of('Subtype'))?.toString() || ''
      if (!dict || !SUPPORTED.has(subtypeName)) continue
      const subtype = subtypeName.slice(1) as NativeExtendedSubtype
      result.push({
        pageIndex,
        annotationIndex,
        subtype,
        text: textValue(dict.lookup(PDFName.of('Contents'))),
        author: textValue(dict.lookup(PDFName.of('T'))),
        color: colorHex(dict),
        opacity: clamp(dict.lookupMaybe(PDFName.of('CA'), PDFNumber)?.asNumber() ?? 1, 0, 1),
        borderWidth: borderWidth(dict),
        geometry: geometryFromBounds(annotationBounds(dict, subtype), width, height),
        inkStrokeCount: subtype === 'Ink' ? inkValues(dict).length : undefined,
        vertexCount: subtype === 'Polygon' || subtype === 'PolyLine' ? Math.floor(vertexValues(dict).length / 2) : undefined,
        stampName: subtype === 'Stamp' ? (dict.get(PDFName.of('Name'))?.toString() || '/Stamp').replace(/^\//, '') : undefined,
        caretSymbol: subtype === 'Caret' && dict.get(PDFName.of('Sy'))?.toString() === '/P' ? 'P' : subtype === 'Caret' ? 'None' : undefined,
        attachment: subtype === 'FileAttachment' ? attachmentInfo(pdf, dict) : undefined,
      })
    }
  })
  return result
}

export async function updateNativeExtendedAnnotation(
  bytes: ArrayBuffer,
  pageIndex: number,
  annotationIndex: number,
  update: NativeExtendedAnnotationUpdate,
) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const located = locatedAnnotation(pdf, pageIndex, annotationIndex)
  if (!located) throw new Error('This native annotation no longer exists.')

  located.dict.set(PDFName.of('Contents'), PDFHexString.fromText(update.text))
  if (update.author.trim()) located.dict.set(PDFName.of('T'), PDFHexString.fromText(update.author.trim()))
  else located.dict.delete(PDFName.of('T'))
  located.dict.set(PDFName.of('C'), pdf.context.obj(parseHexColor(update.color)))
  located.dict.set(PDFName.of('CA'), PDFNumber.of(clamp(Number(update.opacity) || 0, 0, 1)))

  let bs = located.dict.lookupMaybe(PDFName.of('BS'), PDFDict)
  if (!bs) {
    bs = pdf.context.obj({ Type: 'Border', S: 'S', W: 1 }) as PDFDict
    located.dict.set(PDFName.of('BS'), bs)
  }
  bs.set(PDFName.of('W'), PDFNumber.of(Math.max(0, Number(update.borderWidth) || 0)))

  if (update.geometry) {
    const { width: pageWidth, height: pageHeight } = located.page.getSize()
    const oldBounds = annotationBounds(located.dict, located.subtype)
    const newBounds = rawBoundsFromGeometry(update.geometry, pageWidth, pageHeight)

    if (located.subtype === 'Ink' && oldBounds) {
      const paths = inkValues(located.dict)
      located.dict.set(PDFName.of('InkList'), pdf.context.obj(paths.map((path) => transformValues(path, oldBounds, newBounds))))
      setRect(pdf, located.dict, newBounds)
    } else if ((located.subtype === 'Polygon' || located.subtype === 'PolyLine') && oldBounds) {
      located.dict.set(PDFName.of('Vertices'), pdf.context.obj(transformValues(vertexValues(located.dict), oldBounds, newBounds)))
      setRect(pdf, located.dict, newBounds)
    } else {
      setRect(pdf, located.dict, newBounds)
    }
  }

  if (located.subtype === 'Caret') {
    located.dict.set(PDFName.of('Sy'), PDFName.of(update.caretSymbol === 'P' ? 'P' : 'None'))
  }
  if (located.subtype === 'FileAttachment' && update.attachmentIcon) {
    const allowed = new Set(['Graph', 'Paperclip', 'PushPin', 'Tag'])
    located.dict.set(PDFName.of('Name'), PDFName.of(allowed.has(update.attachmentIcon) ? update.attachmentIcon : 'PushPin'))
  }

  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function extractNativeFileAttachment(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const located = locatedAnnotation(pdf, pageIndex, annotationIndex)
  if (!located || located.subtype !== 'FileAttachment') throw new Error('This page attachment no longer exists.')
  const spec = fileSpec(located.dict)
  if (!spec) throw new Error('This page attachment has no embedded file specification.')
  const name = textValue(spec.lookup(PDFName.of('UF'))) || textValue(spec.lookup(PDFName.of('F'))) || 'attachment.bin'
  const data = attachmentData(pdf, spec)
  if (!data.byteLength) throw new Error('This page attachment stream could not be decoded.')
  return { name, data }
}

export async function deleteNativeExtendedAnnotation(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const located = locatedAnnotation(pdf, pageIndex, annotationIndex)
  if (!located) throw new Error('This native annotation no longer exists.')
  located.annots.remove(annotationIndex)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
