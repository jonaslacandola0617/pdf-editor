import { useEffect, useMemo, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getOcrPage, type OcrPageRecord } from '../lib/ocr-cache'
import { OCR_EVENT } from '../lib/ocr'

function rotatePoint(x: number, y: number, rotation: number) {
  const r = ((rotation % 360) + 360) % 360
  if (r === 90) return { x: 1 - y, y: x }
  if (r === 180) return { x: 1 - x, y: 1 - y }
  if (r === 270) return { x: y, y: 1 - x }
  return { x, y }
}

function rotateBox(word: { x: number; y: number; width: number; height: number }, rotation: number) {
  const corners = [
    rotatePoint(word.x, word.y, rotation),
    rotatePoint(word.x + word.width, word.y, rotation),
    rotatePoint(word.x, word.y + word.height, rotation),
    rotatePoint(word.x + word.width, word.y + word.height, rotation),
  ]
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function matchingWordIndices(words: OcrPageRecord['words'], query: string) {
  const tokens = query.trim().split(/\s+/).map(normalize).filter(Boolean)
  const normalizedWords = words.map((word) => normalize(word.text))
  const matched = new Set<number>()
  if (!tokens.length) return matched

  for (let i = 0; i < normalizedWords.length; i++) {
    if (tokens.length === 1) {
      if (normalizedWords[i].includes(tokens[0]) || tokens[0].includes(normalizedWords[i])) matched.add(i)
      continue
    }
    let valid = true
    for (let t = 0; t < tokens.length; t++) {
      const word = normalizedWords[i + t]
      if (!word || !(word.includes(tokens[t]) || tokens[t].includes(word))) { valid = false; break }
    }
    if (valid) for (let t = 0; t < tokens.length; t++) matched.add(i + t)
  }
  return matched
}

type Props = {
  pdf: PDFDocumentProxy
  pageIndex: number
  rotation: number
  searchQuery: string
}

export function OcrTextOverlay({ pdf, pageIndex, rotation, searchQuery }: Props) {
  const [record, setRecord] = useState<OcrPageRecord | null>(null)
  const fingerprint = pdf.fingerprints?.[0] || `pdf-${pdf.numPages}`

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const cached = await getOcrPage(fingerprint, pageIndex + 1)
      if (!cancelled) setRecord(cached || null)
    }
    void load()
    const onOcr = (event: Event) => {
      const detail = (event as CustomEvent<{ pageNumber?: number }>).detail
      if (detail?.pageNumber === pageIndex + 1) void load()
    }
    window.addEventListener(OCR_EVENT, onOcr)
    return () => { cancelled = true; window.removeEventListener(OCR_EVENT, onOcr) }
  }, [fingerprint, pageIndex])

  const matches = useMemo(() => record ? matchingWordIndices(record.words, searchQuery) : new Set<number>(), [record, searchQuery])
  if (!record?.words.length) return null

  return <div className="ocr-text-overlay" aria-label="OCR text layer">
    {record.words.map((word, index) => {
      const box = rotateBox(word, rotation)
      return <span
        key={`${index}-${word.text}`}
        className={matches.has(index) ? 'ocr-word ocr-search-hit' : 'ocr-word'}
        style={{
          left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%`,
          fontSize: `${Math.max(5, box.height * 100)}cqh`,
        }}
        title={word.confidence < 60 ? `OCR confidence ${Math.round(word.confidence)}%` : undefined}
      >{word.text}</span>
    })}
  </div>
}
