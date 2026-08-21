import pdfiumWasmUrl from '@hyzyla/pdfium/pdfium.wasm?url'
import type { NativeTextSelection } from '../types'
import { expandWasmFunctionTable } from './wasm-table'

type PdfiumRuntime = {
  HEAPU8: Uint8Array
  wasmExports: {
    malloc: (size: number) => number
    free: (ptr: number) => void
    __indirect_function_table?: WebAssembly.Table
  }
  _FPDF_LoadPage: (document: number, pageIndex: number) => number
  _FPDF_ClosePage: (page: number) => void
  _FPDF_GetPageWidth: (page: number) => number
  _FPDF_GetPageHeight: (page: number) => number
  _FPDFPage_CountObjects: (page: number) => number
  _FPDFPage_GetObject: (page: number, index: number) => number
  _FPDFPage_RemoveObject: (page: number, object: number) => number
  _FPDFPageObj_Destroy: (object: number) => void
  _FPDFPageObj_GetType: (object: number) => number
  _FPDFPageObj_GetBounds: (object: number, left: number, bottom: number, right: number, top: number) => number
  _FPDFText_LoadPage: (page: number) => number
  _FPDFText_ClosePage: (textPage: number) => void
  _FPDFTextObj_GetText: (object: number, textPage: number, buffer: number, length: number) => number
  _FPDFTextObj_GetFontSize?: (object: number) => number
  _FPDFText_SetText: (object: number, text: number) => number
  _FPDFPage_GenerateContent: (page: number) => number
  _FPDF_SaveAsCopy: (document: number, writer: number, flags: number) => number
}

type PdfiumDocumentUnsafe = { documentIdx: number; destroy: () => void }
type PdfiumLibraryUnsafe = {
  module: PdfiumRuntime
  loadDocument: (bytes: Uint8Array, password?: string) => Promise<PdfiumDocumentUnsafe>
}

type TextObjectInfo = {
  objectIndex: number
  object: number
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize?: number
}

let libraryPromise: Promise<PdfiumLibraryUnsafe> | null = null

async function getPatchedPdfiumBinary() {
  const response = await fetch(pdfiumWasmUrl)
  if (!response.ok) throw new Error('Could not load the local PDFium editing engine.')
  return expandWasmFunctionTable(await response.arrayBuffer(), 8)
}

async function getLibrary(): Promise<PdfiumLibraryUnsafe> {
  if (!libraryPromise) {
    libraryPromise = Promise.all([import('@hyzyla/pdfium'), getPatchedPdfiumBinary()])
      .then(async ([{ PDFiumLibrary }, wasmBinary]) => {
        const library = await PDFiumLibrary.init({ wasmBinary })
        return library as unknown as PdfiumLibraryUnsafe
      })
      .catch((error) => { libraryPromise = null; throw error })
  }
  return libraryPromise
}

function decodeUtf16(module: PdfiumRuntime, ptr: number, byteLength: number) {
  const end = Math.max(ptr, ptr + byteLength - 2)
  return new TextDecoder('utf-16le').decode(module.HEAPU8.slice(ptr, end)).replace(/\0+$/g, '')
}

function encodeUtf16(module: PdfiumRuntime, value: string) {
  const byteLength = (value.length + 1) * 2
  const ptr = module.wasmExports.malloc(byteLength)
  const view = new DataView(module.HEAPU8.buffer)
  for (let i = 0; i < value.length; i++) view.setUint16(ptr + i * 2, value.charCodeAt(i), true)
  view.setUint16(ptr + value.length * 2, 0, true)
  return { ptr }
}

function readTextObject(module: PdfiumRuntime, object: number, textPage: number) {
  const byteLength = module._FPDFTextObj_GetText(object, textPage, 0, 0)
  if (!byteLength) return ''
  const ptr = module.wasmExports.malloc(byteLength)
  try {
    const written = module._FPDFTextObj_GetText(object, textPage, ptr, byteLength)
    return written ? decodeUtf16(module, ptr, written) : ''
  } finally {
    module.wasmExports.free(ptr)
  }
}

function readBounds(module: PdfiumRuntime, object: number, pageWidth: number, pageHeight: number) {
  const ptr = module.wasmExports.malloc(16)
  try {
    const ok = module._FPDFPageObj_GetBounds(object, ptr, ptr + 4, ptr + 8, ptr + 12)
    if (!ok) return null
    const view = new DataView(module.HEAPU8.buffer)
    const left = view.getFloat32(ptr, true)
    const bottom = view.getFloat32(ptr + 4, true)
    const right = view.getFloat32(ptr + 8, true)
    const top = view.getFloat32(ptr + 12, true)
    if (![left, bottom, right, top].every(Number.isFinite) || pageWidth <= 0 || pageHeight <= 0) return null
    return {
      x: left / pageWidth,
      y: (pageHeight - top) / pageHeight,
      width: Math.max(0, (right - left) / pageWidth),
      height: Math.max(0, (top - bottom) / pageHeight),
    }
  } finally {
    module.wasmExports.free(ptr)
  }
}

function distanceToRect(x: number, y: number, rect: { x: number; y: number; width: number; height: number }) {
  const dx = x < rect.x ? rect.x - x : x > rect.x + rect.width ? x - (rect.x + rect.width) : 0
  const dy = y < rect.y ? rect.y - y : y > rect.y + rect.height ? y - (rect.y + rect.height) : 0
  return Math.hypot(dx, dy)
}

function normalizedText(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function textAffinity(objectText: string, hint: string) {
  const a = normalizedText(objectText)
  const b = normalizedText(hint)
  if (!a || !b) return 0
  if (a === b) return 4
  if (a.includes(b) || b.includes(a)) return 2
  const words = b.split(/\s+/).filter((word) => word.length > 2)
  return words.some((word) => a.includes(word)) ? 0.75 : 0
}

function collectTextObjects(module: PdfiumRuntime, page: number, textPage: number, pageWidth: number, pageHeight: number) {
  const output: TextObjectInfo[] = []
  const count = module._FPDFPage_CountObjects(page)
  for (let objectIndex = 0; objectIndex < count; objectIndex++) {
    const object = module._FPDFPage_GetObject(page, objectIndex)
    if (!object || module._FPDFPageObj_GetType(object) !== 1) continue
    const text = readTextObject(module, object, textPage)
    if (!text.trim()) continue
    const bounds = readBounds(module, object, pageWidth, pageHeight)
    if (!bounds) continue
    output.push({
      objectIndex,
      object,
      text,
      ...bounds,
      fontSize: module._FPDFTextObj_GetFontSize?.(object) || undefined,
    })
  }
  return output
}

function verticalOverlap(a: TextObjectInfo, b: TextObjectInfo) {
  return Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
}

function sameTextLine(a: TextObjectInfo, b: TextObjectInfo) {
  const minHeight = Math.max(0.0001, Math.min(a.height, b.height))
  const centers = Math.abs((a.y + a.height / 2) - (b.y + b.height / 2))
  return verticalOverlap(a, b) / minHeight >= 0.42 && centers <= Math.max(a.height, b.height) * 0.62
}

function horizontalGap(left: TextObjectInfo, right: TextObjectInfo) {
  return right.x - (left.x + left.width)
}

function connectionThreshold(a: TextObjectInfo, b: TextObjectInfo) {
  return Math.max(0.012, Math.min(0.034, Math.max(a.height, b.height) * 1.35))
}

function buildTextLine(objects: TextObjectInfo[], anchor: TextObjectInfo) {
  const row = objects.filter((item) => sameTextLine(item, anchor)).sort((a, b) => a.x - b.x)
  const anchorPosition = row.findIndex((item) => item.objectIndex === anchor.objectIndex)
  if (anchorPosition < 0) return [anchor]

  let start = anchorPosition
  let end = anchorPosition
  while (start > 0) {
    const previous = row[start - 1]
    const current = row[start]
    if (horizontalGap(previous, current) > connectionThreshold(previous, current)) break
    start -= 1
  }
  while (end < row.length - 1) {
    const current = row[end]
    const next = row[end + 1]
    if (horizontalGap(current, next) > connectionThreshold(current, next)) break
    end += 1
  }
  return row.slice(start, end + 1)
}

function inferredLineText(items: TextObjectInfo[]) {
  let output = ''
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (index > 0) {
      const previous = items[index - 1]
      const gap = Math.max(0, horizontalGap(previous, item))
      const previousChars = Math.max(1, previous.text.replace(/\s/g, '').length)
      const currentChars = Math.max(1, item.text.replace(/\s/g, '').length)
      const averageCharacterWidth = ((previous.width / previousChars) + (item.width / currentChars)) / 2
      const explicitWhitespace = /\s$/.test(output) || /^\s/.test(item.text)
      if (!explicitWhitespace && gap > Math.max(0.0015, averageCharacterWidth * 0.3)) output += ' '
    }
    output += item.text
  }
  return output.replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

function selectionFromLine(pageIndex: number, line: TextObjectInfo[]): NativeTextSelection {
  const left = Math.min(...line.map((item) => item.x))
  const top = Math.min(...line.map((item) => item.y))
  const right = Math.max(...line.map((item) => item.x + item.width))
  const bottom = Math.max(...line.map((item) => item.y + item.height))
  const anchor = line[0]
  return {
    page: pageIndex,
    objectIndex: anchor.objectIndex,
    objectIndexes: line.map((item) => item.objectIndex),
    objectTexts: line.map((item) => item.text),
    text: inferredLineText(line),
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    fontSize: anchor.fontSize,
  }
}

async function withDocument<T>(bytes: ArrayBuffer, run: (module: PdfiumRuntime, document: PdfiumDocumentUnsafe) => T | Promise<T>) {
  const library = await getLibrary()
  const document = await library.loadDocument(new Uint8Array(bytes.slice(0)))
  try { return await run(library.module, document) } finally { document.destroy() }
}

function findSelectedTextObjects(module: PdfiumRuntime, page: number, selection: NativeTextSelection) {
  const count = module._FPDFPage_CountObjects(page)
  const requested = selection.objectIndexes?.length ? selection.objectIndexes : [selection.objectIndex]
  const byIndex = requested
    .filter((index) => index >= 0 && index < count)
    .map((index) => module._FPDFPage_GetObject(page, index))
    .filter((object) => object && module._FPDFPageObj_GetType(object) === 1)

  if (byIndex.length === requested.length && byIndex.length) return byIndex

  const textPage = module._FPDFText_LoadPage(page)
  if (!textPage) throw new Error('The page text could not be loaded.')
  try {
    for (let i = 0; i < count; i++) {
      const candidate = module._FPDFPage_GetObject(page, i)
      if (!candidate || module._FPDFPageObj_GetType(candidate) !== 1) continue
      if (normalizedText(readTextObject(module, candidate, textPage)) === normalizedText(selection.text)) return [candidate]
    }
  } finally {
    module._FPDFText_ClosePage(textPage)
  }

  throw new Error('The selected text changed before it could be edited. Select the line again.')
}

export async function pickNativeTextObject(bytes: ArrayBuffer, pageIndex: number, point: { x: number; y: number }, hint = ''): Promise<NativeTextSelection | null> {
  return withDocument(bytes, (module, document) => {
    const page = module._FPDF_LoadPage(document.documentIdx, pageIndex)
    if (!page) return null
    const textPage = module._FPDFText_LoadPage(page)
    if (!textPage) { module._FPDF_ClosePage(page); return null }
    try {
      const pageWidth = module._FPDF_GetPageWidth(page)
      const pageHeight = module._FPDF_GetPageHeight(page)
      const objects = collectTextObjects(module, page, textPage, pageWidth, pageHeight)
      let best: { score: number; item: TextObjectInfo } | null = null

      for (const item of objects) {
        const distance = distanceToRect(point.x, point.y, item)
        const affinity = textAffinity(item.text, hint)
        if (distance > 0.045 && affinity === 0) continue
        const area = Math.max(0.000001, item.width * item.height)
        const score = affinity * 10 - distance * 150 - area * 0.04
        if (!best || score > best.score) best = { score, item }
      }

      if (!best) return null
      return selectionFromLine(pageIndex, buildTextLine(objects, best.item))
    } finally {
      module._FPDFText_ClosePage(textPage)
      module._FPDF_ClosePage(page)
    }
  })
}

function wrapJsFunctionForWasm(callback: (self: number, data: number, size: number) => number) {
  const typeSection = [1, 0x60, 3, 0x7f, 0x7f, 0x7f, 1, 0x7f]
  const importSection = [1, 1, 0x65, 1, 0x66, 0, 0]
  const exportSection = [1, 1, 0x66, 0, 0]
  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    1, typeSection.length, ...typeSection,
    2, importSection.length, ...importSection,
    7, exportSection.length, ...exportSection,
  ])
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { e: { f: callback } })
  return instance.exports.f as CallableFunction
}

function installWriteCallback(module: PdfiumRuntime, callback: (self: number, data: number, size: number) => number) {
  const table = module.wasmExports.__indirect_function_table
  if (!table) throw new Error('PDFium did not expose its WebAssembly function table.')
  let ptr = -1
  for (let i = table.length - 1; i >= 1; i--) {
    if (table.get(i) === null) { ptr = i; break }
  }
  if (ptr === -1) {
    try { const previousLength = table.length; table.grow(1); ptr = previousLength }
    catch { throw new Error('PDFium has no free callback slot for saving this edit.') }
  }
  const previous = table.get(ptr)
  table.set(ptr, wrapJsFunctionForWasm(callback))
  return { ptr, cleanup: () => { try { table.set(ptr, previous) } catch { /* best effort */ } } }
}

function savePdfiumDocument(module: PdfiumRuntime, documentIdx: number) {
  const chunks: Uint8Array[] = []
  const callback = installWriteCallback(module, (_self, data, size) => {
    if (!data || size < 0) return 0
    chunks.push(module.HEAPU8.slice(data, data + size))
    return 1
  })
  const writerPtr = module.wasmExports.malloc(8)
  try {
    const view = new DataView(module.HEAPU8.buffer)
    view.setInt32(writerPtr, 1, true)
    view.setInt32(writerPtr + 4, callback.ptr, true)
    if (!module._FPDF_SaveAsCopy(documentIdx, writerPtr, 2)) throw new Error('PDFium could not save the edited PDF.')
  } finally {
    module.wasmExports.free(writerPtr)
    callback.cleanup()
  }
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (!length) throw new Error('PDFium saved no bytes for the edited document.')
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  return output.buffer
}

export async function replaceNativeTextObject(bytes: ArrayBuffer, selection: NativeTextSelection, nextText: string): Promise<ArrayBuffer> {
  if (!nextText.length) throw new Error('Use Delete text line to remove this text completely.')
  return withDocument(bytes, (module, document) => {
    const page = module._FPDF_LoadPage(document.documentIdx, selection.page)
    if (!page) throw new Error('The selected PDF page could not be loaded.')
    const removed: number[] = []
    try {
      const objects = findSelectedTextObjects(module, page, selection)
      const anchor = objects[0]
      const encoded = encodeUtf16(module, nextText)
      try {
        if (!module._FPDFText_SetText(anchor, encoded.ptr)) throw new Error('PDFium rejected this text replacement. The embedded font may not support the new characters.')
      } finally { module.wasmExports.free(encoded.ptr) }

      for (const object of objects.slice(1)) {
        if (!module._FPDFPage_RemoveObject(page, object)) throw new Error('PDFium could not consolidate this fragmented text line.')
        removed.push(object)
      }

      if (!module._FPDFPage_GenerateContent(page)) throw new Error('PDFium could not regenerate this page after the text edit.')
      const saved = savePdfiumDocument(module, document.documentIdx)
      for (const object of removed) module._FPDFPageObj_Destroy(object)
      removed.length = 0
      return saved
    } finally {
      for (const object of removed) module._FPDFPageObj_Destroy(object)
      module._FPDF_ClosePage(page)
    }
  })
}

export async function deleteNativeTextObject(bytes: ArrayBuffer, selection: NativeTextSelection): Promise<ArrayBuffer> {
  return withDocument(bytes, (module, document) => {
    const page = module._FPDF_LoadPage(document.documentIdx, selection.page)
    if (!page) throw new Error('The selected PDF page could not be loaded.')
    const removed: number[] = []
    try {
      const objects = findSelectedTextObjects(module, page, selection)
      for (const object of objects) {
        if (!module._FPDFPage_RemoveObject(page, object)) throw new Error('PDFium could not remove this text line.')
        removed.push(object)
      }
      if (!module._FPDFPage_GenerateContent(page)) throw new Error('PDFium could not regenerate the page after deleting text.')
      const saved = savePdfiumDocument(module, document.documentIdx)
      for (const object of removed) module._FPDFPageObj_Destroy(object)
      removed.length = 0
      return saved
    } finally {
      for (const object of removed) module._FPDFPageObj_Destroy(object)
      module._FPDF_ClosePage(page)
    }
  })
}
