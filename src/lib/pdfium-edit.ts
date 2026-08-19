import type { NativeTextSelection } from '../types'

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
  _FPDFText_LoadPage: (page: number) => number
  _FPDFText_ClosePage: (textPage: number) => void
  _FPDFTextObj_GetText: (object: number, textPage: number, buffer: number, length: number) => number
  _FPDFTextObj_GetFontSize?: (object: number) => number
  _FPDFText_SetText: (object: number, text: number) => number
  _FPDFPage_GenerateContent: (page: number) => number
  _FPDF_SaveAsCopy: (document: number, writer: number, flags: number) => number
}

type PdfiumDocumentUnsafe = {
  documentIdx: number
  destroy: () => void
}

type PdfiumLibraryUnsafe = {
  module: PdfiumRuntime
  loadDocument: (bytes: Uint8Array, password?: string) => Promise<PdfiumDocumentUnsafe>
}

let libraryPromise: Promise<PdfiumLibraryUnsafe> | null = null

async function getLibrary(): Promise<PdfiumLibraryUnsafe> {
  if (!libraryPromise) {
    libraryPromise = import('@hyzyla/pdfium/browser/base64').then(async ({ PDFiumLibrary }) => {
      const library = await PDFiumLibrary.init({ disableBase64Warning: true })
      return library as unknown as PdfiumLibraryUnsafe
    }).catch((error) => {
      libraryPromise = null
      throw error
    })
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
  return { ptr, byteLength }
}

function readTextObject(module: PdfiumRuntime, object: number, textPage: number) {
  const byteLength = module._FPDFTextObj_GetText(object, textPage, 0, 0)
  if (!byteLength) return ''
  const ptr = module.wasmExports.malloc(byteLength)
  try {
    const written = module._FPDFTextObj_GetText(object, textPage, ptr, byteLength)
    if (!written) return ''
    return decodeUtf16(module, ptr, written)
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

async function withDocument<T>(bytes: ArrayBuffer, run: (module: PdfiumRuntime, document: PdfiumDocumentUnsafe) => T | Promise<T>) {
  const library = await getLibrary()
  const document = await library.loadDocument(new Uint8Array(bytes.slice(0)))
  try {
    return await run(library.module, document)
  } finally {
    document.destroy()
  }
}

export async function pickNativeTextObject(
  bytes: ArrayBuffer,
  pageIndex: number,
  point: { x: number; y: number },
  hint = '',
): Promise<NativeTextSelection | null> {
  return withDocument(bytes, (module, document) => {
    const page = module._FPDF_LoadPage(document.documentIdx, pageIndex)
    if (!page) return null
    const textPage = module._FPDFText_LoadPage(page)
    if (!textPage) {
      module._FPDF_ClosePage(page)
      return null
    }

    try {
      const pageWidth = module._FPDF_GetPageWidth(page)
      const pageHeight = module._FPDF_GetPageHeight(page)
      const count = module._FPDFPage_CountObjects(page)
      let best: { score: number; selection: NativeTextSelection } | null = null

      for (let objectIndex = 0; objectIndex < count; objectIndex++) {
        const object = module._FPDFPage_GetObject(page, objectIndex)
        if (!object || module._FPDFPageObj_GetType(object) !== 1) continue
        const text = readTextObject(module, object, textPage)
        if (!text.trim()) continue
        const bounds = readBounds(module, object, pageWidth, pageHeight)
        if (!bounds) continue

        const distance = distanceToRect(point.x, point.y, bounds)
        const affinity = textAffinity(text, hint)
        if (distance > 0.045 && affinity === 0) continue

        const area = Math.max(0.000001, bounds.width * bounds.height)
        const score = affinity * 10 - distance * 150 - area * 0.04
        if (!best || score > best.score) {
          best = {
            score,
            selection: {
              page: pageIndex,
              objectIndex,
              text,
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              fontSize: module._FPDFTextObj_GetFontSize?.(object) || undefined,
            },
          }
        }
      }

      return best?.selection || null
    } finally {
      module._FPDFText_ClosePage(textPage)
      module._FPDF_ClosePage(page)
    }
  })
}

function wrapJsFunctionForWasm(callback: (self: number, data: number, size: number) => number) {
  // Emscripten normally does this inside addFunction(). The PDFium package does
  // not export that runtime helper, but it does export the indirect function table.
  // Wrap our JavaScript callback as an actual wasm function so the funcref table
  // accepts it. Signature: i32 (i32, i32, i32).
  const typeSection = [
    1, // one function type
    0x60, // func
    3, 0x7f, 0x7f, 0x7f, // three i32 params
    1, 0x7f, // one i32 result
  ]
  const importSection = [
    1, // one import
    1, 0x65, // module "e"
    1, 0x66, // name "f"
    0, // import kind: function
    0, // type index 0
  ]
  const exportSection = [
    1, // one export
    1, 0x66, // name "f"
    0, // export kind: function
    0, // function index 0
  ]
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

  const ptr = table.length
  table.grow(1)
  table.set(ptr, wrapJsFunctionForWasm(callback))
  return {
    ptr,
    cleanup: () => {
      try { table.set(ptr, null) } catch { /* table slots cannot always be cleared */ }
    },
  }
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
    const ok = module._FPDF_SaveAsCopy(documentIdx, writerPtr, 2)
    if (!ok) throw new Error('PDFium could not save the edited PDF.')
  } finally {
    module.wasmExports.free(writerPtr)
    callback.cleanup()
  }

  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (!length) throw new Error('PDFium saved no bytes for the edited document.')
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output.buffer
}

export async function replaceNativeTextObject(
  bytes: ArrayBuffer,
  selection: NativeTextSelection,
  nextText: string,
): Promise<ArrayBuffer> {
  if (!nextText.length) throw new Error('Existing PDF text cannot be replaced with an empty string yet.')

  return withDocument(bytes, (module, document) => {
    const page = module._FPDF_LoadPage(document.documentIdx, selection.page)
    if (!page) throw new Error('The selected PDF page could not be loaded.')

    try {
      const count = module._FPDFPage_CountObjects(page)
      let object = selection.objectIndex >= 0 && selection.objectIndex < count
        ? module._FPDFPage_GetObject(page, selection.objectIndex)
        : 0

      const textPage = module._FPDFText_LoadPage(page)
      if (!textPage) throw new Error('The page text could not be loaded.')
      try {
        const matchesExpected = object && module._FPDFPageObj_GetType(object) === 1 &&
          normalizedText(readTextObject(module, object, textPage)) === normalizedText(selection.text)

        if (!matchesExpected) {
          object = 0
          for (let i = 0; i < count; i++) {
            const candidate = module._FPDFPage_GetObject(page, i)
            if (!candidate || module._FPDFPageObj_GetType(candidate) !== 1) continue
            if (normalizedText(readTextObject(module, candidate, textPage)) === normalizedText(selection.text)) {
              object = candidate
              break
            }
          }
        }
      } finally {
        module._FPDFText_ClosePage(textPage)
      }

      if (!object) throw new Error('The selected text object changed before it could be edited. Select it again.')

      const encoded = encodeUtf16(module, nextText)
      try {
        if (!module._FPDFText_SetText(object, encoded.ptr)) {
          throw new Error('PDFium rejected this text replacement. The embedded font may not support the new characters.')
        }
      } finally {
        module.wasmExports.free(encoded.ptr)
      }

      if (!module._FPDFPage_GenerateContent(page)) {
        throw new Error('PDFium could not regenerate this page after the text edit.')
      }

      return savePdfiumDocument(module, document.documentIdx)
    } finally {
      module._FPDF_ClosePage(page)
    }
  })
}
