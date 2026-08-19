import type { PDFPageProxy } from 'pdfjs-dist'
import type { Worker as TesseractWorker } from 'tesseract.js'
import { getOcrPage, saveOcrPage, type OcrPageRecord, type OcrWord } from './ocr-cache'

export const OCR_EVENT = 'pdf-forge:ocr'

type OcrEventDetail = {
  phase: 'loading' | 'recognizing' | 'done' | 'error' | 'cached'
  pageNumber?: number
  pageCount?: number
  progress?: number
  status?: string
}

type ActiveJob = { pageNumber: number; pageCount: number } | null

let workerPromise: Promise<TesseractWorker> | null = null
let activeJob: ActiveJob = null
let queue: Promise<void> = Promise.resolve()
const pending = new Map<string, Promise<OcrPageRecord>>()

function emit(detail: OcrEventDetail) {
  window.dispatchEvent(new CustomEvent<OcrEventDetail>(OCR_EVENT, { detail }))
}

function meaningfulNativeText(text: string, itemCount: number) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length >= 80 || (normalized.length >= 28 && itemCount >= 6)
}

export function nativeTextIsEnough(text: string, itemCount: number) {
  return meaningfulNativeText(text, itemCount)
}

async function getWorker() {
  if (!workerPromise) {
    emit({ phase: 'loading', progress: 0, status: 'Loading on-device OCR engine…' })
    workerPromise = import('tesseract.js').then(async ({ createWorker, OEM }) => {
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        logger: (message) => {
          if (!activeJob) return
          emit({
            phase: 'recognizing',
            pageNumber: activeJob.pageNumber,
            pageCount: activeJob.pageCount,
            progress: typeof message.progress === 'number' ? message.progress : 0,
            status: message.status || 'Recognizing text…',
          })
        },
        errorHandler: (error) => {
          console.error('OCR worker error', error)
        },
      })
      return worker
    }).catch((error) => {
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

function parseTsv(tsv: string | null | undefined, canvasWidth: number, canvasHeight: number): OcrWord[] {
  if (!tsv) return []
  const lines = tsv.split(/\r?\n/).slice(1)
  const words: OcrWord[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 12 || parts[0] !== '5') continue
    const left = Number(parts[6])
    const top = Number(parts[7])
    const width = Number(parts[8])
    const height = Number(parts[9])
    const confidence = Number(parts[10])
    const text = parts.slice(11).join('\t').trim()
    if (!text || !Number.isFinite(left) || !Number.isFinite(top)) continue
    words.push({
      text,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      x: left / canvasWidth,
      y: top / canvasHeight,
      width: width / canvasWidth,
      height: height / canvasHeight,
    })
  }
  return words
}

function canvasScaleFor(page: PDFPageProxy) {
  const base = page.getViewport({ scale: 1 })
  const targetScale = 2.4
  const targetPixels = base.width * base.height * targetScale * targetScale
  const maxPixels = 5_000_000
  if (targetPixels <= maxPixels) return targetScale
  return Math.max(1.4, targetScale * Math.sqrt(maxPixels / targetPixels))
}

async function runOcr(
  page: PDFPageProxy,
  fingerprint: string,
  pageNumber: number,
  pageCount: number,
): Promise<OcrPageRecord> {
  const cached = await getOcrPage(fingerprint, pageNumber)
  if (cached) {
    emit({ phase: 'cached', pageNumber, pageCount, progress: 1, status: 'Using cached OCR text' })
    return cached
  }

  const scale = canvasScaleFor(page)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Could not create OCR canvas')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvas, canvasContext: context, viewport }).promise

  const worker = await getWorker()
  activeJob = { pageNumber, pageCount }
  emit({ phase: 'recognizing', pageNumber, pageCount, progress: 0, status: 'Recognizing scanned page…' })

  try {
    const result = await worker.recognize(canvas, {}, { tsv: true })
    const text = result.data.text.replace(/\s+\n/g, '\n').trim()
    const words = parseTsv(result.data.tsv, canvas.width, canvas.height)
    const confident = words.filter((word) => word.confidence >= 0)
    const confidence = confident.length
      ? confident.reduce((sum, word) => sum + word.confidence, 0) / confident.length
      : 0
    const saved = await saveOcrPage({
      fingerprint,
      pageNumber,
      text,
      words,
      confidence,
      updatedAt: Date.now(),
    })
    emit({ phase: 'done', pageNumber, pageCount, progress: 1, status: text ? 'OCR complete' : 'No text detected' })
    return saved
  } finally {
    activeJob = null
    canvas.width = 1
    canvas.height = 1
  }
}

export async function recognizePdfPage(
  page: PDFPageProxy,
  fingerprint: string,
  pageNumber: number,
  pageCount: number,
) {
  const key = `${fingerprint}:${pageNumber}`
  const existing = pending.get(key)
  if (existing) return existing

  let resolveJob!: (value: OcrPageRecord) => void
  let rejectJob!: (reason?: unknown) => void
  const job = new Promise<OcrPageRecord>((resolve, reject) => {
    resolveJob = resolve
    rejectJob = reject
  })
  pending.set(key, job)

  queue = queue.then(async () => {
    try {
      resolveJob(await runOcr(page, fingerprint, pageNumber, pageCount))
    } catch (error) {
      console.error('OCR failed', error)
      emit({ phase: 'error', pageNumber, pageCount, progress: 0, status: 'OCR failed for this page' })
      rejectJob(error)
    } finally {
      pending.delete(key)
    }
  })

  return job
}
