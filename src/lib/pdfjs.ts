import * as basePdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { trackPdfPage } from './pdfjs-lifecycle'
export { isRetiredPdfResource, retirePdfDocument } from './pdfjs-lifecycle'

basePdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

const STANDARD_FONT_DATA_URL = '/pdfjs-standard-fonts/'
const patchedDocuments = new WeakSet<PDFDocumentProxy>()
const patchedPages = new WeakSet<PDFPageProxy>()

function nativeText(content: Awaited<ReturnType<PDFPageProxy['getTextContent']>>) {
  return content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function patchPage(page: PDFPageProxy, fingerprint: string, pageCount: number, owner: PDFDocumentProxy) {
  trackPdfPage(page, owner)
  if (patchedPages.has(page)) return
  patchedPages.add(page)

  const originalGetTextContent = page.getTextContent.bind(page)
  Object.defineProperty(page, 'getTextContent', {
    configurable: true,
    value: async (...args: Parameters<PDFPageProxy['getTextContent']>) => {
      const native = await originalGetTextContent(...args)
      const text = nativeText(native)
      const { nativeTextIsEnough, recognizePdfPage } = await import('./ocr')
      if (nativeTextIsEnough(text, native.items.length)) return native

      try {
        const ocr = await recognizePdfPage(page, fingerprint, page.pageNumber, pageCount)
        if (!ocr.text.trim()) return native

        // OCR is a fallback/supplement, never a replacement for real PDF text.
        // This matters after PDF Forge exports annotations: the PDF may retain its
        // original document fingerprint, so an older cached OCR result must never
        // hide newly embedded native text from search.
        const ocrFontName = 'pdf-forge-ocr'
        const ocrItem = {
          str: ocr.text,
          dir: 'ltr',
          width: 0,
          height: 0,
          transform: [1, 0, 0, 1, 0, 0],
          fontName: ocrFontName,
          hasEOL: false,
        }
        return {
          ...native,
          items: [...native.items, ocrItem],
          styles: {
            ...native.styles,
            [ocrFontName]: {
              fontFamily: 'sans-serif',
              ascent: 1,
              descent: 0,
              vertical: false,
            },
          },
        } as unknown as typeof native
      } catch {
        return native
      }
    },
  })
}

function patchDocument(doc: PDFDocumentProxy) {
  if (patchedDocuments.has(doc)) return doc
  patchedDocuments.add(doc)

  const fingerprint = doc.fingerprints?.[0] || `pdf-${doc.numPages}`
  const originalGetPage = doc.getPage.bind(doc)
  Object.defineProperty(doc, 'getPage', {
    configurable: true,
    value: async (pageNumber: number) => {
      const page = await originalGetPage(pageNumber)
      patchPage(page, fingerprint, doc.numPages, doc)
      return page
    },
  })
  return doc
}

function getDocument(source: Parameters<typeof basePdfjs.getDocument>[0]) {
  const hardenedSource = source && typeof source === 'object' && !ArrayBuffer.isView(source) && !(source instanceof ArrayBuffer) && !(source instanceof URL)
    ? { ...source, isEvalSupported: false, standardFontDataUrl: STANDARD_FONT_DATA_URL }
    : source
  const task = basePdfjs.getDocument(hardenedSource as Parameters<typeof basePdfjs.getDocument>[0])
  void task.promise.then(patchDocument).catch(() => undefined)
  return task
}

// PDF.js is an ES module namespace object whose exports are non-configurable.
// Wrapping that namespace in a Proxy and returning a different getDocument value
// violates Proxy invariants in Chromium. Copy the exports onto a normal object
// instead, then override getDocument safely.
export const pdfjsLib = {
  ...basePdfjs,
  getDocument,
} as typeof basePdfjs

export type { PDFDocumentProxy } from 'pdfjs-dist'
