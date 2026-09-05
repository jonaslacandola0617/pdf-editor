import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

const retiredDocuments = new WeakSet<PDFDocumentProxy>()
const pageOwners = new WeakMap<PDFPageProxy, PDFDocumentProxy>()

export function trackPdfPage(page: PDFPageProxy, owner: PDFDocumentProxy) {
  pageOwners.set(page, owner)
}

export function retirePdfDocument(doc: PDFDocumentProxy) {
  retiredDocuments.add(doc)
}

export function isRetiredPdfResource(resource: PDFDocumentProxy | PDFPageProxy) {
  const owner = pageOwners.get(resource as PDFPageProxy)
  return retiredDocuments.has(resource as PDFDocumentProxy) || Boolean(owner && retiredDocuments.has(owner))
}
