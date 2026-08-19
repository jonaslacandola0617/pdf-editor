import * as rawPdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { nativeTextIsEnough, recognizePdfPage } from './ocr'

rawPdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

function nativeText(content: Awaited<ReturnType<import('pdfjs-dist').PDFPageProxy['getTextContent']>>) {
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim()
}

function winAnsiSafe(value: string) {
  return value.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function makeSearchablePdf(bytes: ArrayBuffer, onProgress?: (page: number, total: number) => void) {
  const task = rawPdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) })
  const source = await task.promise
  const output = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await output.embedFont(StandardFonts.Helvetica)
  const fingerprint = source.fingerprints?.[0] || `pdf-${source.numPages}`

  try {
    for (let i = 0; i < source.numPages; i++) {
      onProgress?.(i + 1, source.numPages)
      const page = await source.getPage(i + 1)
      const content = await page.getTextContent()
      const text = nativeText(content)
      if (nativeTextIsEnough(text, content.items.length)) continue

      const ocr = await recognizePdfPage(page, fingerprint, i + 1, source.numPages)
      if (!ocr.words.length) continue
      const pdfPage = output.getPage(i)
      const width = pdfPage.getWidth()
      const height = pdfPage.getHeight()

      for (const word of ocr.words) {
        const safe = winAnsiSafe(word.text)
        if (!safe) continue
        const boxWidth = Math.max(1, word.width * width)
        const boxHeight = Math.max(2, word.height * height)
        let size = Math.max(2, boxHeight * 0.78)
        const measured = font.widthOfTextAtSize(safe, size)
        if (measured > boxWidth && measured > 0) size *= boxWidth / measured
        pdfPage.drawText(safe, {
          x: word.x * width,
          y: height - (word.y + word.height) * height,
          size: Math.max(1.5, size),
          font,
          opacity: 0,
        })
      }
    }
    return (await output.save({ useObjectStreams: true })).buffer as ArrayBuffer
  } finally {
    await task.destroy()
  }
}
