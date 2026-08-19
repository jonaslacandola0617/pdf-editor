import * as rawPdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'

rawPdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

async function embedImage(pdf: PDFDocument, file: File) {
  const raw = await file.arrayBuffer()
  const png = file.type.includes('png') || file.name.toLowerCase().endsWith('.png')
  return png ? pdf.embedPng(raw) : pdf.embedJpg(raw)
}

export async function insertFilesAt(bytes: ArrayBuffer, index: number, files: File[]) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  let cursor = Math.max(0, Math.min(pdf.getPageCount(), index))
  let inserted = 0

  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (isPdf) {
      const incoming = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
      const pages = await pdf.copyPages(incoming, incoming.getPageIndices())
      for (const page of pages) {
        pdf.insertPage(cursor++, page)
        inserted++
      }
      continue
    }

    if (file.type.startsWith('image/')) {
      const image = await embedImage(pdf, file)
      const natural = image.scale(1)
      const reference = pdf.getPageCount()
        ? pdf.getPage(Math.max(0, Math.min(pdf.getPageCount() - 1, cursor === pdf.getPageCount() ? cursor - 1 : cursor)))
        : null
      const width = reference?.getWidth() || 595.28
      const height = reference?.getHeight() || 841.89
      const page = pdf.insertPage(cursor++, [width, height])
      const scale = Math.min(width / natural.width, height / natural.height, 1)
      const drawWidth = natural.width * scale
      const drawHeight = natural.height * scale
      page.drawImage(image, {
        x: (width - drawWidth) / 2,
        y: (height - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      })
      inserted++
    }
  }

  if (!inserted) throw new Error('No supported PDF or image pages were inserted.')
  return { bytes: (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer, inserted }
}

function canvasJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('Could not encode a compressed PDF page.'))
      resolve(await blob.arrayBuffer())
    }, 'image/jpeg', quality)
  })
}

/**
 * Strong size reduction for scan/image-heavy documents.
 * This deliberately rasterizes every page, so native text, forms, links and
 * interactive content become page imagery. Use makeSearchablePdf afterwards
 * if a searchable OCR layer is desired.
 */
export async function rasterCompressPdf(
  bytes: ArrayBuffer,
  options: { scale?: number; quality?: number; onProgress?: (page: number, total: number) => void } = {},
) {
  const scale = Math.max(0.75, Math.min(2, options.scale ?? 1.15))
  const quality = Math.max(0.35, Math.min(0.92, options.quality ?? 0.68))
  const task = rawPdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) })
  const source = await task.promise
  const output = await PDFDocument.create()

  try {
    for (let i = 0; i < source.numPages; i++) {
      options.onProgress?.(i + 1, source.numPages)
      const page = await source.getPage(i + 1)
      const base = page.getViewport({ scale: 1 })
      const render = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(render.width))
      canvas.height = Math.max(1, Math.ceil(render.height))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Could not create the compression canvas.')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: context, viewport: render }).promise
      const image = await output.embedJpg(await canvasJpeg(canvas, quality))
      const outPage = output.addPage([base.width, base.height])
      outPage.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height })
      canvas.width = 1
      canvas.height = 1
    }
    return (await output.save({ useObjectStreams: true })).buffer as ArrayBuffer
  } finally {
    await task.destroy()
  }
}
