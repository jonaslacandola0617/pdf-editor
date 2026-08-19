import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib'
import type { Annotation, FormFieldState, PdfMetadata } from '../types'

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function getPageCount(bytes: ArrayBuffer) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return pdf.getPageCount()
}

export async function mergePdfs(current: ArrayBuffer, files: File[]) {
  const out = await PDFDocument.load(current, { ignoreEncryption: true })
  for (const file of files) {
    const ext = file.name.toLowerCase().split('.').pop()
    if (ext === 'pdf') {
      const incoming = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
      const copied = await out.copyPages(incoming, incoming.getPageIndices())
      copied.forEach((page) => out.addPage(page))
    } else if (file.type.startsWith('image/')) {
      const imageBytes = await file.arrayBuffer()
      const image = file.type.includes('png')
        ? await out.embedPng(imageBytes)
        : await out.embedJpg(imageBytes)
      const { width, height } = image.scale(1)
      const maxWidth = 595
      const maxHeight = 842
      const scale = Math.min(maxWidth / width, maxHeight / height, 1)
      const page = out.addPage([Math.max(320, width * scale), Math.max(320, height * scale)])
      const pw = page.getWidth()
      const ph = page.getHeight()
      page.drawImage(image, {
        x: (pw - width * scale) / 2,
        y: (ph - height * scale) / 2,
        width: width * scale,
        height: height * scale,
      })
    }
  }
  return (await out.save()).buffer as ArrayBuffer
}

export async function reorderPdf(bytes: ArrayBuffer, order: number[], rotations: number[]) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, order)
  pages.forEach((page, index) => {
    page.setRotation(degrees(rotations[index] ?? 0))
    out.addPage(page)
  })
  return (await out.save()).buffer as ArrayBuffer
}

export async function extractPages(bytes: ArrayBuffer, indices: number[]) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, indices)
  pages.forEach((p) => out.addPage(p))
  return await out.save()
}

export async function duplicatePage(bytes: ArrayBuffer, index: number) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  for (let i = 0; i < src.getPageCount(); i++) {
    const [p] = await out.copyPages(src, [i])
    out.addPage(p)
    if (i === index) {
      const [dup] = await out.copyPages(src, [i])
      out.addPage(dup)
    }
  }
  return (await out.save()).buffer as ArrayBuffer
}

export async function insertBlankPage(bytes: ArrayBuffer, index: number, size: 'match' | 'a4' | 'letter' = 'match') {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const safeIndex = Math.max(0, Math.min(pdf.getPageCount(), index))
  let dimensions: [number, number] = [595.28, 841.89]
  if (size === 'letter') dimensions = [612, 792]
  if (size === 'match' && pdf.getPageCount()) {
    const source = pdf.getPage(Math.max(0, Math.min(pdf.getPageCount() - 1, safeIndex === pdf.getPageCount() ? safeIndex - 1 : safeIndex)))
    dimensions = [source.getWidth(), source.getHeight()]
  }
  pdf.insertPage(safeIndex, dimensions)
  return (await pdf.save()).buffer as ArrayBuffer
}

async function embedImageFor(pdf: PDFDocument, file: File) {
  const raw = await file.arrayBuffer()
  if (file.type.includes('png') || file.name.toLowerCase().endsWith('.png')) return pdf.embedPng(raw)
  return pdf.embedJpg(raw)
}

export async function replacePageWithFile(bytes: ArrayBuffer, pageIndex: number, file: File) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const index = Math.max(0, Math.min(pdf.getPageCount() - 1, pageIndex))
  const old = pdf.getPage(index)
  const oldSize: [number, number] = [old.getWidth(), old.getHeight()]

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const incoming = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
    if (!incoming.getPageCount()) throw new Error('Replacement PDF has no pages.')
    const [replacement] = await pdf.copyPages(incoming, [0])
    pdf.removePage(index)
    pdf.insertPage(index, replacement)
  } else if (file.type.startsWith('image/')) {
    const image = await embedImageFor(pdf, file)
    const dimensions = image.scale(1)
    const scale = Math.min(oldSize[0] / dimensions.width, oldSize[1] / dimensions.height)
    pdf.removePage(index)
    const page = pdf.insertPage(index, oldSize)
    page.drawImage(image, {
      x: (oldSize[0] - dimensions.width * scale) / 2,
      y: (oldSize[1] - dimensions.height * scale) / 2,
      width: dimensions.width * scale,
      height: dimensions.height * scale,
    })
  } else {
    throw new Error('Use a PDF, PNG, or JPG as the replacement page.')
  }

  return (await pdf.save()).buffer as ArrayBuffer
}

export async function cropPage(bytes: ArrayBuffer, pageIndex: number, margins: { left: number; right: number; top: number; bottom: number }) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const page = pdf.getPage(pageIndex)
  const width = page.getWidth()
  const height = page.getHeight()
  const left = Math.max(0, Math.min(0.45, margins.left)) * width
  const right = Math.max(0, Math.min(0.45, margins.right)) * width
  const top = Math.max(0, Math.min(0.45, margins.top)) * height
  const bottom = Math.max(0, Math.min(0.45, margins.bottom)) * height
  const cropWidth = Math.max(36, width - left - right)
  const cropHeight = Math.max(36, height - top - bottom)
  page.setCropBox(left, bottom, cropWidth, cropHeight)
  return (await pdf.save()).buffer as ArrayBuffer
}

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const n = Number.parseInt(full, 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export async function addWatermark(
  bytes: ArrayBuffer,
  options: { text: string; opacity?: number; size?: number; angle?: number; color?: string; pageIndex?: number },
) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await pdf.embedFont(StandardFonts.HelveticaBold)
  const pages = options.pageIndex === undefined ? pdf.getPages() : [pdf.getPage(options.pageIndex)]
  const text = options.text || 'DRAFT'
  const size = Math.max(12, Math.min(144, options.size || 52))
  const color = hexToRgb(options.color || '#777777')
  for (const page of pages) {
    const width = page.getWidth()
    const height = page.getHeight()
    const textWidth = font.widthOfTextAtSize(text, size)
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: height / 2,
      size,
      font,
      color,
      opacity: Math.max(0.05, Math.min(0.9, options.opacity ?? 0.2)),
      rotate: degrees(options.angle ?? -35),
    })
  }
  return (await pdf.save()).buffer as ArrayBuffer
}

export async function addHeaderFooter(
  bytes: ArrayBuffer,
  options: {
    header?: string
    footer?: string
    pageNumbers?: boolean
    startAt?: number
    fontSize?: number
    color?: string
  },
) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const size = Math.max(7, Math.min(24, options.fontSize || 9))
  const color = hexToRgb(options.color || '#555555')
  const total = pdf.getPageCount()
  const expand = (value: string, page: number) => value
    .replaceAll('{page}', String((options.startAt || 1) + page))
    .replaceAll('{pages}', String(total))

  pdf.getPages().forEach((page, index) => {
    const width = page.getWidth()
    const height = page.getHeight()
    if (options.header?.trim()) {
      const text = expand(options.header, index)
      page.drawText(text, { x: 28, y: height - 24, size, font, color })
    }
    let footer = options.footer?.trim() ? expand(options.footer, index) : ''
    if (options.pageNumbers) footer = footer ? `${footer}    ${index + (options.startAt || 1)} / ${total}` : `${index + (options.startAt || 1)} / ${total}`
    if (footer) {
      const textWidth = font.widthOfTextAtSize(footer, size)
      page.drawText(footer, { x: Math.max(28, (width - textWidth) / 2), y: 18, size, font, color })
    }
  })
  return (await pdf.save()).buffer as ArrayBuffer
}

export async function addImageToPage(
  bytes: ArrayBuffer,
  pageIndex: number,
  file: File,
  options: { widthPercent?: number; xPercent?: number; yPercent?: number } = {},
) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const page = pdf.getPage(pageIndex)
  const image = await embedImageFor(pdf, file)
  const natural = image.scale(1)
  const pageWidth = page.getWidth()
  const pageHeight = page.getHeight()
  const targetWidth = pageWidth * Math.max(0.05, Math.min(0.95, options.widthPercent ?? 0.35))
  const scale = targetWidth / natural.width
  const targetHeight = natural.height * scale
  const x = Math.max(0, Math.min(pageWidth - targetWidth, pageWidth * (options.xPercent ?? 0.5) - targetWidth / 2))
  const yTop = pageHeight * (options.yPercent ?? 0.5)
  const y = Math.max(0, Math.min(pageHeight - targetHeight, pageHeight - yTop - targetHeight / 2))
  page.drawImage(image, { x, y, width: targetWidth, height: targetHeight })
  return (await pdf.save()).buffer as ArrayBuffer
}

export async function flattenAnnotations(
  bytes: ArrayBuffer,
  annotations: Annotation[],
  metadata: PdfMetadata,
) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica)

  pdf.setTitle(metadata.title || '')
  pdf.setAuthor(metadata.author || '')
  pdf.setSubject(metadata.subject || '')
  pdf.setKeywords(metadata.keywords.split(',').map((v) => v.trim()).filter(Boolean))

  for (const ann of annotations) {
    const page = pdf.getPage(ann.page)
    if (!page) continue
    const width = page.getWidth()
    const height = page.getHeight()
    const color = hexToRgb(ann.color)

    if (ann.type === 'text') {
      page.drawText(ann.text || 'Text', {
        x: ann.x * width,
        y: height - ann.y * height - (ann.fontSize || 18),
        size: ann.fontSize || 18,
        font: helvetica,
        color,
      })
    }

    if (ann.type === 'highlight' || ann.type === 'rectangle' || ann.type === 'redaction') {
      const w = (ann.width || 0.2) * width
      const h = (ann.height || 0.06) * height
      const y = height - (ann.y * height) - h
      if (ann.type === 'highlight') {
        page.drawRectangle({ x: ann.x * width, y, width: w, height: h, color, opacity: 0.28 })
      } else if (ann.type === 'redaction') {
        page.drawRectangle({ x: ann.x * width, y, width: w, height: h, color: rgb(0, 0, 0), opacity: 1 })
      } else {
        page.drawRectangle({
          x: ann.x * width,
          y,
          width: w,
          height: h,
          borderColor: color,
          borderWidth: ann.strokeWidth || 2,
          opacity: 0,
        })
      }
    }

    if (ann.type === 'ink' || ann.type === 'signature') {
      const points = ann.points || []
      for (let i = 1; i < points.length; i++) {
        page.drawLine({
          start: { x: points[i - 1].x * width, y: height - points[i - 1].y * height },
          end: { x: points[i].x * width, y: height - points[i].y * height },
          color,
          thickness: ann.strokeWidth || (ann.type === 'signature' ? 2.2 : 2),
          opacity: 0.95,
        })
      }
    }
  }

  return await pdf.save({ useObjectStreams: true })
}

export async function flattenFormFields(bytes: ArrayBuffer) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  pdf.getForm().flatten()
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function readMetadata(bytes: ArrayBuffer): Promise<PdfMetadata> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return {
    title: pdf.getTitle() || '',
    author: pdf.getAuthor() || '',
    subject: pdf.getSubject() || '',
    keywords: (pdf.getKeywords() || '').replace(/[\[\]()]/g, ''),
  }
}

export async function readFormFields(bytes: ArrayBuffer): Promise<FormFieldState[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  return form.getFields().map((field) => {
    const name = field.getName()
    if (field instanceof PDFTextField) return { name, type: 'text' as const, value: field.getText() || '' }
    if (field instanceof PDFCheckBox) return { name, type: 'checkbox' as const, value: field.isChecked() }
    if (field instanceof PDFDropdown) return { name, type: 'dropdown' as const, value: field.getSelected()[0] || '', options: field.getOptions() }
    if (field instanceof PDFOptionList) return { name, type: 'option' as const, value: field.getSelected().join(', '), options: field.getOptions() }
    if (field instanceof PDFRadioGroup) return { name, type: 'radio' as const, value: field.getSelected() || '', options: field.getOptions() }
    return { name, type: 'unknown' as const, value: '' }
  })
}

export async function updateFormField(bytes: ArrayBuffer, field: FormFieldState, next: string | boolean) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdf.getForm()
  const raw = form.getFieldMaybe(field.name)
  if (!raw) return bytes

  if (raw instanceof PDFTextField) raw.setText(String(next))
  if (raw instanceof PDFCheckBox) Boolean(next) ? raw.check() : raw.uncheck()
  if (raw instanceof PDFDropdown) raw.select(String(next))
  if (raw instanceof PDFOptionList) raw.select(String(next))
  if (raw instanceof PDFRadioGroup) raw.select(String(next))

  return (await pdf.save()).buffer as ArrayBuffer
}

export async function createPdfFromFiles(files: File[]) {
  const out = await PDFDocument.create()
  for (const file of files) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const incoming = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
      const pages = await out.copyPages(incoming, incoming.getPageIndices())
      pages.forEach((p) => out.addPage(p))
    } else if (file.type.startsWith('image/')) {
      const raw = await file.arrayBuffer()
      let image
      try {
        image = file.type.includes('png') ? await out.embedPng(raw) : await out.embedJpg(raw)
      } catch {
        continue
      }
      const { width, height } = image.scale(1)
      const maxWidth = 595
      const maxHeight = 842
      const scale = Math.min(maxWidth / width, maxHeight / height, 1)
      const page = out.addPage([Math.max(320, width * scale), Math.max(320, height * scale)])
      const pw = page.getWidth()
      const ph = page.getHeight()
      page.drawImage(image, {
        x: (pw - width * scale) / 2,
        y: (ph - height * scale) / 2,
        width: width * scale,
        height: height * scale,
      })
    }
  }
  if (out.getPageCount() === 0) out.addPage()
  return (await out.save()).buffer as ArrayBuffer
}

export function parsePageRange(input: string, pageCount: number) {
  const result = new Set<number>()
  for (const token of input.split(',').map((v) => v.trim()).filter(Boolean)) {
    if (token.includes('-')) {
      const [aRaw, bRaw] = token.split('-')
      const a = Number(aRaw)
      const b = Number(bRaw)
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      const start = Math.max(1, Math.min(a, b))
      const end = Math.min(pageCount, Math.max(a, b))
      for (let p = start; p <= end; p++) result.add(p - 1)
    } else {
      const p = Number(token)
      if (Number.isFinite(p) && p >= 1 && p <= pageCount) result.add(p - 1)
    }
  }
  return [...result].sort((a, b) => a - b)
}
