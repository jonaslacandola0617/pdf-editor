import { pdfjsLib } from './pdfjs'

export type PageImageFormat = 'png' | 'jpeg'

export type PageImageExportOptions = {
  pageIndices: number[]
  format: PageImageFormat
  dpi: number
  jpegQuality?: number
}

type ImageFile = { name: string; data: Uint8Array }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function canvasBlob(canvas: HTMLCanvasElement, format: PageImageFormat, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the rendered page image.')), format === 'png' ? 'image/png' : 'image/jpeg', format === 'jpeg' ? quality : undefined)
  })
}

export async function renderPdfPagesToImages(bytes: ArrayBuffer, options: PageImageExportOptions): Promise<ImageFile[]> {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) })
  const doc = await task.promise
  const uniquePages = [...new Set(options.pageIndices)]
    .map((value) => Math.floor(value))
    .filter((value) => value >= 0 && value < doc.numPages)
  if (!uniquePages.length) throw new Error('Choose at least one valid page to export.')
  const dpi = clamp(options.dpi || 150, 72, 300)
  const quality = clamp(options.jpegQuality ?? 0.9, 0.35, 1)
  const files: ImageFile[] = []
  try {
    for (const pageIndex of uniquePages) {
      const page = await doc.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale: dpi / 72 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d', { alpha: options.format === 'png' })
      if (!context) throw new Error('Could not create a canvas for page image export.')
      if (options.format === 'jpeg') {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
      }
      const renderTask = page.render({ canvas, canvasContext: context, viewport })
      await renderTask.promise
      const blob = await canvasBlob(canvas, options.format, quality)
      files.push({
        name: `page-${String(pageIndex + 1).padStart(3, '0')}.${options.format === 'jpeg' ? 'jpg' : 'png'}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      })
      canvas.width = 1
      canvas.height = 1
    }
  } finally {
    await task.destroy().catch(() => undefined)
  }
  return files
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31),
    date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31),
  }
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.byteLength }
  return output
}

function header(size: number) {
  return new Uint8Array(size)
}

function set16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true) }
function set32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true) }

export function zipStore(files: ImageFile[]) {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let localOffset = 0
  const stamp = dosDateTime()

  for (const file of files) {
    const name = encoder.encode(file.name)
    const crc = crc32(file.data)
    const local = header(30 + name.length)
    const localView = new DataView(local.buffer)
    set32(localView, 0, 0x04034b50)
    set16(localView, 4, 20)
    set16(localView, 6, 0x0800)
    set16(localView, 8, 0)
    set16(localView, 10, stamp.time)
    set16(localView, 12, stamp.date)
    set32(localView, 14, crc)
    set32(localView, 18, file.data.length)
    set32(localView, 22, file.data.length)
    set16(localView, 26, name.length)
    set16(localView, 28, 0)
    local.set(name, 30)
    localParts.push(local, file.data)

    const central = header(46 + name.length)
    const centralView = new DataView(central.buffer)
    set32(centralView, 0, 0x02014b50)
    set16(centralView, 4, 20)
    set16(centralView, 6, 20)
    set16(centralView, 8, 0x0800)
    set16(centralView, 10, 0)
    set16(centralView, 12, stamp.time)
    set16(centralView, 14, stamp.date)
    set32(centralView, 16, crc)
    set32(centralView, 20, file.data.length)
    set32(centralView, 24, file.data.length)
    set16(centralView, 28, name.length)
    set16(centralView, 30, 0)
    set16(centralView, 32, 0)
    set16(centralView, 34, 0)
    set16(centralView, 36, 0)
    set32(centralView, 38, 0)
    set32(centralView, 42, localOffset)
    central.set(name, 46)
    centralParts.push(central)
    localOffset += local.length + file.data.length
  }

  const central = concat(centralParts)
  const end = header(22)
  const endView = new DataView(end.buffer)
  set32(endView, 0, 0x06054b50)
  set16(endView, 4, 0)
  set16(endView, 6, 0)
  set16(endView, 8, files.length)
  set16(endView, 10, files.length)
  set32(endView, 12, central.length)
  set32(endView, 16, localOffset)
  set16(endView, 20, 0)
  return concat([...localParts, central, end])
}

export function downloadBinary(data: Uint8Array, filename: string, type = 'application/octet-stream') {
  const blob = new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1200)
}
