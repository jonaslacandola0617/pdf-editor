import pdfiumWasmUrl from '@hyzyla/pdfium/pdfium.wasm?url'
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
  _FPDFPageObj_GetType: (object: number) => number
  _FPDFPageObj_GetBounds: (object: number, left: number, bottom: number, right: number, top: number) => number
  _FPDFPageObj_GetFillColor?: (object: number, r: number, g: number, b: number, a: number) => number
  _FPDFPageObj_SetFillColor?: (object: number, r: number, g: number, b: number, a: number) => number
  _FPDFPageObj_Transform?: (object: number, a: number, b: number, c: number, d: number, e: number, f: number) => void
  _FPDFPage_RemoveObject?: (page: number, object: number) => number
  _FPDFPageObj_Destroy?: (object: number) => void
  _FPDFText_LoadPage: (page: number) => number
  _FPDFText_ClosePage: (textPage: number) => void
  _FPDFTextObj_GetText: (object: number, textPage: number, buffer: number, length: number) => number
  _FPDFTextObj_GetFontSize?: (object: number, sizePtr?: number) => number
  _FPDFText_SetText: (object: number, text: number) => number
  _FPDFImageObj_GetImagePixelSize?: (object: number, widthPtr: number, heightPtr: number) => number
  _FPDFImageObj_GetRenderedBitmap?: (document: number, page: number, object: number) => number
  _FPDFImageObj_SetBitmap?: (pages: number, count: number, object: number, bitmap: number) => number
  _FPDFBitmap_CreateEx?: (width: number, height: number, format: number, buffer: number, stride: number) => number
  _FPDFBitmap_GetBuffer?: (bitmap: number) => number
  _FPDFBitmap_GetWidth?: (bitmap: number) => number
  _FPDFBitmap_GetHeight?: (bitmap: number) => number
  _FPDFBitmap_GetStride?: (bitmap: number) => number
  _FPDFBitmap_GetFormat?: (bitmap: number) => number
  _FPDFBitmap_Destroy?: (bitmap: number) => void
  _FPDFPage_GenerateContent: (page: number) => number
  _FPDF_SaveAsCopy: (document: number, writer: number, flags: number) => number
}

type PdfiumDocumentUnsafe = { documentIdx: number; destroy: () => void }
type PdfiumLibraryUnsafe = { module: PdfiumRuntime; loadDocument: (bytes: Uint8Array, password?: string) => Promise<PdfiumDocumentUnsafe> }

export type PageContentGeometry = { x: number; y: number; width: number; height: number }
export type NativeTextContentInfo = {
  type: 'text'
  objectIndex: number
  text: string
  geometry: PageContentGeometry
  color: string
  opacity: number
  fontSize?: number
}
export type NativeImageContentInfo = {
  type: 'image'
  objectIndex: number
  geometry: PageContentGeometry
  pixelWidth?: number
  pixelHeight?: number
}
export type NativePageContentInfo = NativeTextContentInfo | NativeImageContentInfo
export type TextContentUpdate = {
  text?: string
  color?: string
  opacity?: number
  x?: number
  y?: number
  fontSize?: number
}
export type ImageContentUpdate = { geometry: PageContentGeometry }
export type ExtractedImage = { width: number; height: number; rgba: Uint8Array }

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

let libraryPromise: Promise<PdfiumLibraryUnsafe> | null = null

async function getPatchedPdfiumBinary() {
  const response = await fetch(pdfiumWasmUrl)
  if (!response.ok) throw new Error('Could not load the local PDFium content engine.')
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

async function withDocument<T>(bytes: ArrayBuffer, run: (module: PdfiumRuntime, document: PdfiumDocumentUnsafe) => T | Promise<T>) {
  const library = await getLibrary()
  const document = await library.loadDocument(new Uint8Array(bytes.slice(0)))
  try { return await run(library.module, document) }
  finally { document.destroy() }
}

function decodeUtf16(module: PdfiumRuntime, ptr: number, byteLength: number) {
  return new TextDecoder('utf-16le').decode(module.HEAPU8.slice(ptr, Math.max(ptr, ptr + byteLength - 2))).replace(/\0+$/g, '')
}

function encodeUtf16(module: PdfiumRuntime, value: string) {
  const byteLength = (value.length + 1) * 2
  const ptr = module.wasmExports.malloc(byteLength)
  const view = new DataView(module.HEAPU8.buffer)
  for (let index = 0; index < value.length; index++) view.setUint16(ptr + index * 2, value.charCodeAt(index), true)
  view.setUint16(ptr + value.length * 2, 0, true)
  return ptr
}

function readText(module: PdfiumRuntime, object: number, textPage: number) {
  const byteLength = module._FPDFTextObj_GetText(object, textPage, 0, 0)
  if (!byteLength) return ''
  const ptr = module.wasmExports.malloc(byteLength)
  try {
    const written = module._FPDFTextObj_GetText(object, textPage, ptr, byteLength)
    return written ? decodeUtf16(module, ptr, written) : ''
  } finally { module.wasmExports.free(ptr) }
}

function readRawBounds(module: PdfiumRuntime, object: number): Bounds | null {
  const ptr = module.wasmExports.malloc(16)
  try {
    if (!module._FPDFPageObj_GetBounds(object, ptr, ptr + 4, ptr + 8, ptr + 12)) return null
    const view = new DataView(module.HEAPU8.buffer)
    const minX = view.getFloat32(ptr, true)
    const minY = view.getFloat32(ptr + 4, true)
    const maxX = view.getFloat32(ptr + 8, true)
    const maxY = view.getFloat32(ptr + 12, true)
    return [minX, minY, maxX, maxY].every(Number.isFinite) ? { minX, minY, maxX, maxY } : null
  } finally { module.wasmExports.free(ptr) }
}

function geometryFromBounds(bounds: Bounds | null, pageWidth: number, pageHeight: number): PageContentGeometry {
  if (!bounds || pageWidth <= 0 || pageHeight <= 0) return { x: 0, y: 0, width: 1, height: 1 }
  return {
    x: bounds.minX / pageWidth * 100,
    y: (pageHeight - bounds.maxY) / pageHeight * 100,
    width: Math.max(0.01, (bounds.maxX - bounds.minX) / pageWidth * 100),
    height: Math.max(0.01, (bounds.maxY - bounds.minY) / pageHeight * 100),
  }
}

function boundsFromGeometry(geometry: PageContentGeometry, pageWidth: number, pageHeight: number): Bounds {
  const x = Math.max(0, Math.min(99.99, Number(geometry.x) || 0))
  const y = Math.max(0, Math.min(99.99, Number(geometry.y) || 0))
  const width = Math.max(0.01, Math.min(100 - x, Number(geometry.width) || 0.01))
  const height = Math.max(0.01, Math.min(100 - y, Number(geometry.height) || 0.01))
  const minX = pageWidth * x / 100
  const maxY = pageHeight - pageHeight * y / 100
  return { minX, maxX: minX + pageWidth * width / 100, maxY, minY: maxY - pageHeight * height / 100 }
}

function hexByte(value: number) { return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0') }
function parseHex(value: string) {
  const raw = /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : '000000'
  return [0, 2, 4].map((offset) => parseInt(raw.slice(offset, offset + 2), 16)) as [number, number, number]
}

function readFill(module: PdfiumRuntime, object: number) {
  if (!module._FPDFPageObj_GetFillColor) return { color: '#000000', opacity: 1 }
  const ptr = module.wasmExports.malloc(16)
  try {
    if (!module._FPDFPageObj_GetFillColor(object, ptr, ptr + 4, ptr + 8, ptr + 12)) return { color: '#000000', opacity: 1 }
    const view = new DataView(module.HEAPU8.buffer)
    const r = view.getUint32(ptr, true); const g = view.getUint32(ptr + 4, true); const b = view.getUint32(ptr + 8, true); const a = view.getUint32(ptr + 12, true)
    return { color: `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`, opacity: Math.max(0, Math.min(1, a / 255)) }
  } finally { module.wasmExports.free(ptr) }
}

function readFontSize(module: PdfiumRuntime, object: number) {
  const getter = module._FPDFTextObj_GetFontSize
  if (!getter) return undefined
  const ptr = module.wasmExports.malloc(4)
  try {
    const result = getter(object, ptr)
    const pointed = new DataView(module.HEAPU8.buffer).getFloat32(ptr, true)
    if (result === 1 && Number.isFinite(pointed) && pointed >= 0) return pointed
    if (Number.isFinite(result) && result > 1) return result
    return undefined
  } catch { return undefined }
  finally { module.wasmExports.free(ptr) }
}

function readImagePixelSize(module: PdfiumRuntime, object: number) {
  if (!module._FPDFImageObj_GetImagePixelSize) return {}
  const ptr = module.wasmExports.malloc(8)
  try {
    if (!module._FPDFImageObj_GetImagePixelSize(object, ptr, ptr + 4)) return {}
    const view = new DataView(module.HEAPU8.buffer)
    return { pixelWidth: view.getUint32(ptr, true), pixelHeight: view.getUint32(ptr + 4, true) }
  } finally { module.wasmExports.free(ptr) }
}

function transformToBounds(module: PdfiumRuntime, object: number, from: Bounds, to: Bounds) {
  if (!module._FPDFPageObj_Transform) throw new Error('This PDFium build cannot transform page content objects.')
  const oldWidth = Math.max(0.000001, from.maxX - from.minX)
  const oldHeight = Math.max(0.000001, from.maxY - from.minY)
  const sx = (to.maxX - to.minX) / oldWidth
  const sy = (to.maxY - to.minY) / oldHeight
  const e = to.minX - sx * from.minX
  const f = to.minY - sy * from.minY
  module._FPDFPageObj_Transform(object, sx, 0, 0, sy, e, f)
}

function wrapJsFunctionForWasm(callback: (self: number, data: number, size: number) => number) {
  const typeSection = [1, 0x60, 3, 0x7f, 0x7f, 0x7f, 1, 0x7f]
  const importSection = [1, 1, 0x65, 1, 0x66, 0, 0]
  const exportSection = [1, 1, 0x66, 0, 0]
  const bytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, typeSection.length, ...typeSection, 2, importSection.length, ...importSection, 7, exportSection.length, ...exportSection])
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), { e: { f: callback } }).exports.f as CallableFunction
}

function installWriteCallback(module: PdfiumRuntime, callback: (self: number, data: number, size: number) => number) {
  const table = module.wasmExports.__indirect_function_table
  if (!table) throw new Error('PDFium did not expose its WebAssembly callback table.')
  let ptr = -1
  for (let index = table.length - 1; index >= 1; index--) if (table.get(index) === null) { ptr = index; break }
  if (ptr === -1) {
    try { ptr = table.length; table.grow(1) }
    catch { throw new Error('PDFium has no free callback slot for saving this edit.') }
  }
  const previous = table.get(ptr)
  table.set(ptr, wrapJsFunctionForWasm(callback))
  return { ptr, cleanup: () => { try { table.set(ptr, previous) } catch { /* best effort */ } } }
}

function saveDocument(module: PdfiumRuntime, documentIdx: number) {
  const chunks: Uint8Array[] = []
  const callback = installWriteCallback(module, (_self, data, size) => { chunks.push(module.HEAPU8.slice(data, data + size)); return 1 })
  const writer = module.wasmExports.malloc(8)
  try {
    const view = new DataView(module.HEAPU8.buffer)
    view.setInt32(writer, 1, true); view.setInt32(writer + 4, callback.ptr, true)
    if (!module._FPDF_SaveAsCopy(documentIdx, writer, 2)) throw new Error('PDFium could not save the content edit.')
  } finally { module.wasmExports.free(writer); callback.cleanup() }
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result.buffer
}

function objectAt(module: PdfiumRuntime, page: number, objectIndex: number, expectedType?: number) {
  const count = module._FPDFPage_CountObjects(page)
  if (objectIndex < 0 || objectIndex >= count) throw new Error('This page content object no longer exists.')
  const object = module._FPDFPage_GetObject(page, objectIndex)
  if (!object || (expectedType && module._FPDFPageObj_GetType(object) !== expectedType)) throw new Error('The selected page content object changed. Refresh the content list.')
  return object
}

export async function listNativePageContent(bytes: ArrayBuffer, pageIndex: number): Promise<NativePageContentInfo[]> {
  return withDocument(bytes, (module, document) => {
    const page = module._FPDF_LoadPage(document.documentIdx, pageIndex)
    if (!page) throw new Error('The PDF page could not be loaded.')
    const textPage = module._FPDFText_LoadPage(page)
    try {
      const pageWidth = module._FPDF_GetPageWidth(page); const pageHeight = module._FPDF_GetPageHeight(page)
      const count = module._FPDFPage_CountObjects(page)
      const result: NativePageContentInfo[] = []
      for (let objectIndex = 0; objectIndex < count; objectIndex++) {
        const object = module._FPDFPage_GetObject(page, objectIndex)
        if (!object) continue
        const type = module._FPDFPageObj_GetType(object)
        if (type === 1 && textPage) {
          const text = readText(module, object, textPage)
          if (!text.trim()) continue
          const fill = readFill(module, object)
          result.push({ type: 'text', objectIndex, text, geometry: geometryFromBounds(readRawBounds(module, object), pageWidth, pageHeight), color: fill.color, opacity: fill.opacity, fontSize: readFontSize(module, object) })
        } else if (type === 3) {
          result.push({ type: 'image', objectIndex, geometry: geometryFromBounds(readRawBounds(module, object), pageWidth, pageHeight), ...readImagePixelSize(module, object) })
        }
      }
      return result
    } finally { if (textPage) module._FPDFText_ClosePage(textPage); module._FPDF_ClosePage(page) }
  })
}

export async function updateNativeTextContent(bytes: ArrayBuffer, pageIndex: number, objectIndex: number, update: TextContentUpdate) {
  return withDocument(bytes, (module, document) => {
    const page = module._FPDF_LoadPage(document.documentIdx, pageIndex)
    if (!page) throw new Error('The PDF page could not be loaded.')
    try {
      const object = objectAt(module, page, objectIndex, 1)
      const currentBounds = readRawBounds(module, object)
      const pageWidth = module._FPDF_GetPageWidth(page); const pageHeight = module._FPDF_GetPageHeight(page)
      const currentGeometry = geometryFromBounds(currentBounds, pageWidth, pageHeight)
      const currentFontSize = readFontSize(module, object)

      if (typeof update.text === 'string') {
        if (!update.text.length) throw new Error('Use Delete for an empty text object.')
        const ptr = encodeUtf16(module, update.text)
        try { if (!module._FPDFText_SetText(object, ptr)) throw new Error('PDFium rejected the replacement text. The embedded font may not contain the requested characters.') }
        finally { module.wasmExports.free(ptr) }
      }
      if (update.color && module._FPDFPageObj_SetFillColor) {
        const [r, g, b] = parseHex(update.color); const a = Math.round(Math.max(0, Math.min(1, update.opacity ?? 1)) * 255)
        if (!module._FPDFPageObj_SetFillColor(object, r, g, b, a)) throw new Error('PDFium could not update this text color.')
      }

      if (currentBounds && (typeof update.x === 'number' || typeof update.y === 'number' || (typeof update.fontSize === 'number' && currentFontSize && currentFontSize > 0))) {
        const scale = typeof update.fontSize === 'number' && currentFontSize && currentFontSize > 0 ? Math.max(0.05, update.fontSize / currentFontSize) : 1
        const targetGeometry: PageContentGeometry = {
          x: typeof update.x === 'number' ? update.x : currentGeometry.x,
          y: typeof update.y === 'number' ? update.y : currentGeometry.y,
          width: currentGeometry.width * scale,
          height: currentGeometry.height * scale,
        }
        transformToBounds(module, object, currentBounds, boundsFromGeometry(targetGeometry, pageWidth, pageHeight))
      }

      if (!module._FPDFPage_GenerateContent(page)) throw new Error('PDFium could not regenerate the page after editing text.')
      return saveDocument(module, document.documentIdx)
    } finally { module._FPDF_ClosePage(page) }
  })
}

export async function updateNativeImageGeometry(bytes: ArrayBuffer, pageIndex: number, objectIndex: number, geometry: PageContentGeometry) {
  return withDocument(bytes, (module, document) => {
    const page = module._FPDF_LoadPage(document.documentIdx, pageIndex)
    if (!page) throw new Error('The PDF page could not be loaded.')
    try {
      const object = objectAt(module, page, objectIndex, 3)
      const from = readRawBounds(module, object)
      if (!from) throw new Error('The image bounds could not be read.')
      transformToBounds(module, object, from, boundsFromGeometry(geometry, module._FPDF_GetPageWidth(page), module._FPDF_GetPageHeight(page)))
      if (!module._FPDFPage_GenerateContent(page)) throw new Error('PDFium could not regenerate the page after moving this image.')
      return saveDocument(module, document.documentIdx)
    } finally { module._FPDF_ClosePage(page) }
  })
}

export async function replaceNativeImageBitmap(bytes: ArrayBuffer, pageIndex: number, objectIndex: number, file: Blob) {
  const sourceBitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas'); canvas.width = sourceBitmap.width; canvas.height = sourceBitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) { sourceBitmap.close(); throw new Error('Browser canvas is unavailable for image replacement.') }
  context.drawImage(sourceBitmap, 0, 0); sourceBitmap.close()
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data

  return withDocument(bytes, (module, document) => {
    const page = module._FPDF_LoadPage(document.documentIdx, pageIndex)
    if (!page) throw new Error('The PDF page could not be loaded.')
    const createBitmap = module._FPDFBitmap_CreateEx; const setBitmap = module._FPDFImageObj_SetBitmap; const destroyBitmap = module._FPDFBitmap_Destroy
    if (!createBitmap || !setBitmap || !destroyBitmap) { module._FPDF_ClosePage(page); throw new Error('This PDFium build cannot replace native image bitmaps.') }
    try {
      const object = objectAt(module, page, objectIndex, 3)
      const stride = canvas.width * 4
      const buffer = module.wasmExports.malloc(stride * canvas.height)
      let bitmap = 0; let pagesPtr = 0
      try {
        const target = module.HEAPU8.subarray(buffer, buffer + stride * canvas.height)
        for (let index = 0; index < rgba.length; index += 4) {
          target[index] = rgba[index + 2]; target[index + 1] = rgba[index + 1]; target[index + 2] = rgba[index]; target[index + 3] = rgba[index + 3]
        }
        bitmap = createBitmap(canvas.width, canvas.height, 4, buffer, stride)
        if (!bitmap) throw new Error('PDFium could not create the replacement bitmap.')
        pagesPtr = module.wasmExports.malloc(4)
        new DataView(module.HEAPU8.buffer).setUint32(pagesPtr, page, true)
        if (!setBitmap(pagesPtr, 1, object, bitmap)) throw new Error('PDFium rejected the replacement image bitmap.')
        if (!module._FPDFPage_GenerateContent(page)) throw new Error('PDFium could not regenerate the page after replacing this image.')
        return saveDocument(module, document.documentIdx)
      } finally {
        if (pagesPtr) module.wasmExports.free(pagesPtr)
        if (bitmap) destroyBitmap(bitmap)
        module.wasmExports.free(buffer)
      }
    } finally { module._FPDF_ClosePage(page) }
  })
}

export async function extractNativeImage(bytes: ArrayBuffer, pageIndex: number, objectIndex: number): Promise<ExtractedImage> {
  return withDocument(bytes, (module, document) => {
    const page = module._FPDF_LoadPage(document.documentIdx, pageIndex)
    if (!page) throw new Error('The PDF page could not be loaded.')
    const renderBitmap = module._FPDFImageObj_GetRenderedBitmap; const destroyBitmap = module._FPDFBitmap_Destroy
    if (!renderBitmap || !destroyBitmap || !module._FPDFBitmap_GetBuffer || !module._FPDFBitmap_GetWidth || !module._FPDFBitmap_GetHeight || !module._FPDFBitmap_GetStride || !module._FPDFBitmap_GetFormat) {
      module._FPDF_ClosePage(page); throw new Error('This PDFium build cannot extract native image bitmaps.')
    }
    try {
      const object = objectAt(module, page, objectIndex, 3)
      const bitmap = renderBitmap(document.documentIdx, page, object)
      if (!bitmap) throw new Error('PDFium could not render this image object.')
      try {
        const width = module._FPDFBitmap_GetWidth(bitmap); const height = module._FPDFBitmap_GetHeight(bitmap); const stride = module._FPDFBitmap_GetStride(bitmap); const format = module._FPDFBitmap_GetFormat(bitmap); const buffer = module._FPDFBitmap_GetBuffer(bitmap)
        if (!width || !height || !stride || !buffer) throw new Error('The image bitmap is empty.')
        const source = module.HEAPU8.slice(buffer, buffer + height * stride)
        const rgba = new Uint8Array(width * height * 4); rgba.fill(255)
        const bpp = format === 1 ? 1 : format === 2 ? 3 : 4
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const src = y * stride + x * bpp; const dst = (y * width + x) * 4
          if (format === 1) { rgba[dst] = source[src]; rgba[dst + 1] = source[src]; rgba[dst + 2] = source[src] }
          else { rgba[dst] = source[src + 2]; rgba[dst + 1] = source[src + 1]; rgba[dst + 2] = source[src]; if (format === 4) rgba[dst + 3] = source[src + 3] }
        }
        return { width, height, rgba }
      } finally { destroyBitmap(bitmap) }
    } finally { module._FPDF_ClosePage(page) }
  })
}

export async function deleteNativePageContentObject(bytes: ArrayBuffer, pageIndex: number, objectIndex: number) {
  return withDocument(bytes, (module, document) => {
    const page = module._FPDF_LoadPage(document.documentIdx, pageIndex)
    if (!page) throw new Error('The PDF page could not be loaded.')
    try {
      const object = objectAt(module, page, objectIndex)
      if (!module._FPDFPage_RemoveObject || !module._FPDFPageObj_Destroy) throw new Error('This PDFium build cannot delete native page content objects.')
      if (!module._FPDFPage_RemoveObject(page, object)) throw new Error('PDFium could not remove this page content object.')
      if (!module._FPDFPage_GenerateContent(page)) throw new Error('PDFium could not regenerate the page after deleting this object.')
      const result = saveDocument(module, document.documentIdx)
      module._FPDFPageObj_Destroy(object)
      return result
    } finally { module._FPDF_ClosePage(page) }
  })
}
