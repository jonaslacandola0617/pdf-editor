import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib'

export type NativeCommentGeometry = { x: number; y: number; width: number; height: number }
export type NativeCommentDetail = {
  pageIndex: number
  annotationIndex: number
  subtype: 'Text' | 'FreeText'
  text: string
  author: string
  geometry: NativeCommentGeometry
  icon?: string
  open?: boolean
  fontSize?: number
  textColor?: string
  alignment?: 0 | 1 | 2
}

export type NativeCommentDetailUpdate = {
  text: string
  author: string
  geometry?: NativeCommentGeometry
  icon?: string
  open?: boolean
  fontSize?: number
  textColor?: string
  alignment?: 0 | 1 | 2
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
function rounded(value: number) { return Math.round(value * 100) / 100 }
function textValue(value: unknown) { return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : '' }

function annotationDict(pdf: PDFDocument, annots: PDFArray, index: number) {
  const raw = annots.get(index)
  if (!raw) return null
  try {
    const resolved = raw instanceof PDFRef ? pdf.context.lookup(raw) : raw
    return resolved instanceof PDFDict ? resolved : null
  } catch { return null }
}

function geometry(pdf: PDFDocument, pageIndex: number, dict: PDFDict): NativeCommentGeometry {
  const page = pdf.getPage(pageIndex)
  const { width: pageWidth, height: pageHeight } = page.getSize()
  const rect = dict.lookupMaybe(PDFName.of('Rect'), PDFArray)
  if (!rect || pageWidth <= 0 || pageHeight <= 0) return { x: 0, y: 0, width: 8, height: 5 }
  try {
    const box = rect.asRectangle()
    return {
      x: rounded(clamp(box.x / pageWidth * 100, 0, 100)),
      y: rounded(clamp((pageHeight - box.y - box.height) / pageHeight * 100, 0, 100)),
      width: rounded(clamp(box.width / pageWidth * 100, 0.1, 100)),
      height: rounded(clamp(box.height / pageHeight * 100, 0.1, 100)),
    }
  } catch { return { x: 0, y: 0, width: 8, height: 5 } }
}

function setGeometry(pdf: PDFDocument, pageIndex: number, dict: PDFDict, value: NativeCommentGeometry) {
  const page = pdf.getPage(pageIndex)
  const { width: pageWidth, height: pageHeight } = page.getSize()
  const xP = clamp(Number(value.x) || 0, 0, 99.9)
  const yP = clamp(Number(value.y) || 0, 0, 99.9)
  const wP = clamp(Number(value.width) || 0.1, 0.1, 100 - xP)
  const hP = clamp(Number(value.height) || 0.1, 0.1, 100 - yP)
  const x = pageWidth * xP / 100
  const width = pageWidth * wP / 100
  const height = pageHeight * hP / 100
  const top = pageHeight * yP / 100
  const bottom = pageHeight - top - height
  dict.set(PDFName.of('Rect'), pdf.context.obj([x, bottom, x + width, bottom + height]))
}

function colorToHex(r: number, g: number, b: number) {
  const part = (value: number) => Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function parseDa(da: string) {
  const font = da.match(/\/([^\s/]+)\s+(-?\d*\.?\d+)\s+Tf/) || da.match(/(-?\d*\.?\d+)\s+Tf/)
  const size = font ? Number(font[font.length - 1]) : 12
  const rgb = da.match(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+rg/)
  if (rgb) return { fontName: font?.[1] || 'Helv', fontSize: Number.isFinite(size) ? size : 12, color: colorToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])) }
  const gray = da.match(/(-?\d*\.?\d+)\s+g/)
  const g = gray ? Number(gray[1]) : 0
  return { fontName: font?.[1] || 'Helv', fontSize: Number.isFinite(size) ? size : 12, color: colorToHex(g, g, g) }
}

function parseHex(value: string) {
  const raw = /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : '000000'
  return [0, 2, 4].map((offset) => parseInt(raw.slice(offset, offset + 2), 16) / 255)
}

function located(pdf: PDFDocument, pageIndex: number, annotationIndex: number) {
  const page = pdf.getPage(pageIndex)
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots || annotationIndex < 0 || annotationIndex >= annots.size()) return null
  const dict = annotationDict(pdf, annots, annotationIndex)
  const subtype = dict?.get(PDFName.of('Subtype'))?.toString()
  if (!dict || (subtype !== '/Text' && subtype !== '/FreeText')) return null
  return { annots, dict, subtype: subtype === '/FreeText' ? 'FreeText' as const : 'Text' as const }
}

export async function listNativeCommentDetails(bytes: ArrayBuffer): Promise<NativeCommentDetail[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const result: NativeCommentDetail[] = []
  pdf.getPages().forEach((page, pageIndex) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) return
    for (let annotationIndex = 0; annotationIndex < annots.size(); annotationIndex++) {
      const dict = annotationDict(pdf, annots, annotationIndex)
      const subtypeRaw = dict?.get(PDFName.of('Subtype'))?.toString()
      if (!dict || (subtypeRaw !== '/Text' && subtypeRaw !== '/FreeText')) continue
      const subtype = subtypeRaw === '/FreeText' ? 'FreeText' : 'Text'
      const base = {
        pageIndex,
        annotationIndex,
        subtype,
        text: textValue(dict.lookup(PDFName.of('Contents'))),
        author: textValue(dict.lookup(PDFName.of('T'))),
        geometry: geometry(pdf, pageIndex, dict),
      } as NativeCommentDetail
      if (subtype === 'Text') {
        base.icon = (dict.get(PDFName.of('Name'))?.toString() || '/Note').replace(/^\//, '')
        base.open = dict.get(PDFName.of('Open'))?.toString() === 'true'
      } else {
        const style = parseDa(textValue(dict.lookup(PDFName.of('DA'))))
        base.fontSize = style.fontSize
        base.textColor = style.color
        const q = dict.lookupMaybe(PDFName.of('Q'), PDFNumber)?.asNumber()
        base.alignment = q === 1 || q === 2 ? q : 0
      }
      result.push(base)
    }
  })
  return result
}

export async function updateNativeCommentDetail(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number, update: NativeCommentDetailUpdate) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const item = located(pdf, pageIndex, annotationIndex)
  if (!item) throw new Error('This native comment no longer exists.')
  item.dict.set(PDFName.of('Contents'), PDFHexString.fromText(update.text))
  if (update.author.trim()) item.dict.set(PDFName.of('T'), PDFHexString.fromText(update.author.trim()))
  else item.dict.delete(PDFName.of('T'))
  if (update.geometry) setGeometry(pdf, pageIndex, item.dict, update.geometry)

  if (item.subtype === 'Text') {
    const icons = new Set(['Comment', 'Key', 'Note', 'Help', 'NewParagraph', 'Paragraph', 'Insert'])
    item.dict.set(PDFName.of('Name'), PDFName.of(update.icon && icons.has(update.icon) ? update.icon : 'Note'))
    item.dict.set(PDFName.of('Open'), pdf.context.obj(Boolean(update.open)))
  } else {
    const previous = parseDa(textValue(item.dict.lookup(PDFName.of('DA'))))
    const size = clamp(Number(update.fontSize) || previous.fontSize || 12, 4, 144)
    const [r, g, b] = parseHex(update.textColor || previous.color)
    item.dict.set(PDFName.of('DA'), PDFString.of(`/${previous.fontName || 'Helv'} ${size} Tf ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`))
    item.dict.set(PDFName.of('Q'), PDFNumber.of(update.alignment === 1 || update.alignment === 2 ? update.alignment : 0))
    item.dict.delete(PDFName.of('AP'))
  }

  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function deleteNativeCommentDetail(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const item = located(pdf, pageIndex, annotationIndex)
  if (!item) throw new Error('This native comment no longer exists.')
  item.annots.remove(annotationIndex)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
