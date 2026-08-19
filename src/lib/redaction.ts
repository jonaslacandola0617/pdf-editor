import * as rawPdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument, degrees } from 'pdf-lib'
import type { Annotation } from '../types'

rawPdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

function canvasPng(canvas: HTMLCanvasElement) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('Could not rasterize the redacted page.'))
      resolve(await blob.arrayBuffer())
    }, 'image/png')
  })
}

export async function secureRedactPdf(
  bytes: ArrayBuffer,
  redactions: Annotation[],
  rotations: number[],
  onProgress?: (page: number, total: number) => void,
) {
  const task = rawPdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) })
  const sourceJs = await task.promise
  const sourcePdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const output = await PDFDocument.create()

  try {
    for (let i = 0; i < sourceJs.numPages; i++) {
      onProgress?.(i + 1, sourceJs.numPages)
      const pageRedactions = redactions.filter((ann) => ann.page === i && ann.type === 'redaction')
      const rotation = rotations[i] || 0

      if (!pageRedactions.length) {
        const [copied] = await output.copyPages(sourcePdf, [i])
        if (rotation) copied.setRotation(degrees(rotation))
        output.addPage(copied)
        continue
      }

      const page = await sourceJs.getPage(i + 1)
      const baseViewport = page.getViewport({ scale: 1, rotation })
      const renderViewport = page.getViewport({ scale: 2, rotation })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(renderViewport.width))
      canvas.height = Math.max(1, Math.ceil(renderViewport.height))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Could not create the secure redaction canvas.')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise

      context.fillStyle = '#000000'
      for (const ann of pageRedactions) {
        context.fillRect(
          ann.x * canvas.width,
          ann.y * canvas.height,
          Math.max(1, (ann.width || 0.1) * canvas.width),
          Math.max(1, (ann.height || 0.04) * canvas.height),
        )
      }

      const png = await output.embedPng(await canvasPng(canvas))
      const outPage = output.addPage([baseViewport.width, baseViewport.height])
      outPage.drawImage(png, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height })
      canvas.width = 1
      canvas.height = 1
    }

    const result = await output.save({ useObjectStreams: true })
    return result.buffer as ArrayBuffer
  } finally {
    await task.destroy()
  }
}
