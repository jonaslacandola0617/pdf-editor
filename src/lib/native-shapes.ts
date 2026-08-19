import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib'

export type NativeShapeSubtype = 'Square' | 'Circle' | 'Line'

export type NativeShapeInfo = {
  pageIndex: number
  annotationIndex: number
  subtype: NativeShapeSubtype
  strokeColor: string
  fillColor: string
  opacity: number
  borderWidth: number
  line?: { x1: number; y1: number; x2: number; y2: number }
}

export type NativeShapeUpdate = {
  strokeColor: string
  fillColor: string
  opacity: number
  borderWidth: number
  line?: { x1: number; y1: number; x2: number; y2: number }
}

const SUPPORTED = new Set(['/Square', '/Circle', '/Line'])

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
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

function components(dict: PDFDict, key: string) {
  const color = dict.lookupMaybe(PDFName.of(key), PDFArray)
  if (!color) return []
  const values: number[] = []
  for (let index = 0; index < color.size(); index++) {
    const value = color.lookup(index, PDFNumber)
    if (value) values.push(clamp(value.asNumber(), 0, 1))
  }
  return values
}

function componentToHex(value: number) {
  return Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, '0')
}

function toHex(values: number[], fallback: [number, number, number]) {
  let rgb: [number, number, number]
  if (values.length === 1) rgb = [values[0], values[0], values[0]]
  else if (values.length >= 4) {
    const [c, m, y, k] = values
    rgb = [1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k)]
  } else if (values.length >= 3) rgb = [values[0], values[1], values[2]]
  else rgb = fallback
  return `#${componentToHex(rgb[0])}${componentToHex(rgb[1])}${componentToHex(rgb[2])}`
}

function parseHexColor(value: string) {
  const normalized = /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : '000000'
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

function linePoints(dict: PDFDict) {
  const line = dict.lookupMaybe(PDFName.of('L'), PDFArray)
  if (!line || line.size() < 4) return undefined
  const values = [0, 1, 2, 3].map((index) => line.lookup(index, PDFNumber)?.asNumber())
  if (values.some((value) => typeof value !== 'number')) return undefined
  return { x1: values[0]!, y1: values[1]!, x2: values[2]!, y2: values[3]! }
}

function shapeAt(pdf: PDFDocument, pageIndex: number, annotationIndex: number) {
  const page = pdf.getPage(pageIndex)
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots || annotationIndex < 0 || annotationIndex >= annots.size()) return null
  const dict = annotationDict(pdf, annots, annotationIndex)
  const subtypeName = dict?.get(PDFName.of('Subtype'))?.toString() || ''
  if (!dict || !SUPPORTED.has(subtypeName)) return null
  return { annots, dict, subtype: subtypeName.slice(1) as NativeShapeSubtype }
}

export async function listNativeShapes(bytes: ArrayBuffer): Promise<NativeShapeInfo[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const result: NativeShapeInfo[] = []
  pdf.getPages().forEach((page, pageIndex) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) return
    for (let annotationIndex = 0; annotationIndex < annots.size(); annotationIndex++) {
      const dict = annotationDict(pdf, annots, annotationIndex)
      const subtypeName = dict?.get(PDFName.of('Subtype'))?.toString() || ''
      if (!dict || !SUPPORTED.has(subtypeName)) continue
      result.push({
        pageIndex,
        annotationIndex,
        subtype: subtypeName.slice(1) as NativeShapeSubtype,
        strokeColor: toHex(components(dict, 'C'), [0, 0, 0]),
        fillColor: toHex(components(dict, 'IC'), [1, 1, 1]),
        opacity: clamp(dict.lookupMaybe(PDFName.of('CA'), PDFNumber)?.asNumber() ?? 1, 0, 1),
        borderWidth: borderWidth(dict),
        line: subtypeName === '/Line' ? linePoints(dict) : undefined,
      })
    }
  })
  return result
}

export async function updateNativeShape(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number, update: NativeShapeUpdate) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const located = shapeAt(pdf, pageIndex, annotationIndex)
  if (!located) throw new Error('This native shape annotation no longer exists.')

  located.dict.set(PDFName.of('C'), pdf.context.obj(parseHexColor(update.strokeColor)))
  if (located.subtype !== 'Line') located.dict.set(PDFName.of('IC'), pdf.context.obj(parseHexColor(update.fillColor)))
  located.dict.set(PDFName.of('CA'), PDFNumber.of(clamp(Number(update.opacity) || 0, 0, 1)))

  let bs = located.dict.lookupMaybe(PDFName.of('BS'), PDFDict)
  if (!bs) {
    bs = pdf.context.obj({ Type: 'Border', S: 'S', W: 1 }) as PDFDict
    located.dict.set(PDFName.of('BS'), bs)
  }
  bs.set(PDFName.of('W'), PDFNumber.of(Math.max(0, Number(update.borderWidth) || 0)))

  if (located.subtype === 'Line' && update.line) {
    const values = [update.line.x1, update.line.y1, update.line.x2, update.line.y2].map((value) => Number(value))
    if (values.some((value) => !Number.isFinite(value))) throw new Error('Line endpoints must be valid numbers.')
    located.dict.set(PDFName.of('L'), pdf.context.obj(values))
  }

  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function deleteNativeShape(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const located = shapeAt(pdf, pageIndex, annotationIndex)
  if (!located) throw new Error('This native shape annotation no longer exists.')
  located.annots.remove(annotationIndex)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
