import * as basePdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { nativeTextIsEnough, recognizePdfPage } from './ocr'

basePdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

const patchedDocuments = new WeakSet<PDFDocumentProxy>()
const patchedPages = new WeakSet<PDFPageProxy>()

function nativeText(content: Awaited<ReturnType<PDFPageProxy['getTextContent']>>) {
  return content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function patchPage(page: PDFPageProxy, fingerprint: string, pageCount: number) {
  if (patchedPages.has(page)) return
  patchedPages.add(page)

  const originalGetTextContent = page.getTextContent.bind(page)
  Object.defineProperty(page, 'getTextContent', {
    configurable: true,
    value: async (...args: Parameters<PDFPageProxy['getTextContent']>) => {
      const native = await originalGetTextContent(...args)
      const text = nativeText(native)
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
      patchPage(page, fingerprint, doc.numPages)
      return page
    },
  })
  return doc
}

function getDocument(...args: Parameters<typeof basePdfjs.getDocument>) {
  const task = basePdfjs.getDocument(...args)
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
