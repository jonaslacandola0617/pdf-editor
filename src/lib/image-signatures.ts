import { PDFDocument } from 'pdf-lib'

export type ImageSignaturePreset = {
  id: string
  name: string
  dataUrl: string
  mimeType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  updatedAt: number
}

export type ImageSignaturePlacement = {
  xPercent: number
  yPercent: number
  widthPercent: number
  opacity: number
}

const KEY = 'pdf-forge-image-signatures'
const MAX_PRESETS = 6

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read image file.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not decode this signature image.'))
    image.src = dataUrl
  })
}

async function normalizedImage(file: File) {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') throw new Error('Image signatures must be PNG or JPG.')
  const source = await readAsDataUrl(file)
  const image = await loadImage(source)
  const maxDimension = Math.max(image.naturalWidth, image.naturalHeight)
  if (maxDimension <= 1200 && file.size <= 1_500_000) {
    return { dataUrl: source, width: image.naturalWidth, height: image.naturalHeight, mimeType: file.type as 'image/png' | 'image/jpeg' }
  }

  const scale = Math.min(1, 1200 / Math.max(1, maxDimension))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not resize this signature image.')
  context.drawImage(image, 0, 0, width, height)
  const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  return { dataUrl: canvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.88 : undefined), width, height, mimeType }
}

export async function createImageSignaturePreset(file: File, requestedName = ''): Promise<ImageSignaturePreset> {
  const normalized = await normalizedImage(file)
  return {
    id: crypto.randomUUID(),
    name: requestedName.trim() || file.name.replace(/\.[^.]+$/, '') || 'Image signature',
    ...normalized,
    updatedAt: Date.now(),
  }
}

export function loadImageSignaturePresets(): ImageSignaturePreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && typeof item.id === 'string' && typeof item.dataUrl === 'string' && (item.mimeType === 'image/png' || item.mimeType === 'image/jpeg')).slice(0, MAX_PRESETS)
  } catch {
    return []
  }
}

export function storeImageSignaturePresets(presets: ImageSignaturePreset[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets.slice(0, MAX_PRESETS)))
  } catch {
    throw new Error('This signature image is too large for local browser storage. Try a smaller PNG/JPG.')
  }
}

export async function placeImageSignature(bytes: ArrayBuffer, preset: ImageSignaturePreset, pageIndex: number, placement: ImageSignaturePlacement) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const index = clamp(Math.floor(pageIndex), 0, Math.max(0, pdf.getPageCount() - 1))
  const page = pdf.getPage(index)
  const image = preset.mimeType === 'image/png' ? await pdf.embedPng(preset.dataUrl) : await pdf.embedJpg(preset.dataUrl)
  const width = page.getWidth() * clamp(placement.widthPercent / 100, 0.03, 0.95)
  const height = width * image.height / Math.max(1, image.width)
  const x = clamp(page.getWidth() * placement.xPercent / 100, 0, Math.max(0, page.getWidth() - width))
  const top = clamp(page.getHeight() * placement.yPercent / 100, 0, Math.max(0, page.getHeight() - height))
  page.drawImage(image, {
    x,
    y: page.getHeight() - top - height,
    width,
    height,
    opacity: clamp(placement.opacity, 0.1, 1),
  })
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
