import { useEffect, useRef, useState } from 'react'
import { pdfjsLib, type PDFDocumentProxy } from '../lib/pdfjs'
import type { Annotation, Point, Tool } from '../types'
import '../text-layer.css'

type Props = {
  pdf: PDFDocumentProxy
  pageIndex: number
  zoom: number
  rotation: number
  annotations: Annotation[]
  tool: Tool
  color: string
  strokeWidth: number
  fontSize: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: (annotation: Annotation) => void
}

type DragPreview = {
  type: 'highlight' | 'rectangle' | 'ink' | 'signature'
  start?: Point
  end?: Point
  points?: Point[]
}

type CancelableRenderTask = {
  promise: Promise<unknown>
  cancel: () => void
}

type CancelableTextLayer = {
  render: () => Promise<unknown>
  cancel: () => void
  textDivs?: HTMLElement[]
  textContentItemsStr?: string[]
}

function currentSearchQuery() {
  return document.querySelector<HTMLInputElement>('.search-box input')?.value.trim() || ''
}

function markSearchMatches(container: HTMLElement, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return

  const spans = Array.from(container.querySelectorAll<HTMLSpanElement>('span'))
    .filter((span) => span.childElementCount === 0 && (span.textContent || '').length > 0)

  if (!spans.length) return

  const entries: Array<{ span: HTMLSpanElement; text: string; start: number; end: number }> = []
  let combined = ''
  for (const span of spans) {
    const text = span.textContent || ''
    if (combined.length) combined += ' '
    const start = combined.length
    combined += text
    entries.push({ span, text, start, end: combined.length })
  }

  const haystack = combined.toLocaleLowerCase()
  const ranges: Array<{ start: number; end: number }> = []
  let cursor = 0
  while (cursor <= haystack.length - normalized.length) {
    const index = haystack.indexOf(normalized, cursor)
    if (index === -1) break
    ranges.push({ start: index, end: index + normalized.length })
    cursor = index + Math.max(1, normalized.length)
  }

  if (!ranges.length) return

  for (const entry of entries) {
    const localRanges = ranges
      .map((range) => ({
        start: Math.max(range.start, entry.start) - entry.start,
        end: Math.min(range.end, entry.end) - entry.start,
      }))
      .filter((range) => range.start < range.end)

    if (!localRanges.length) continue

    const fragment = document.createDocumentFragment()
    let offset = 0
    for (const range of localRanges) {
      if (range.start > offset) fragment.append(document.createTextNode(entry.text.slice(offset, range.start)))
      const mark = document.createElement('mark')
      mark.className = 'pdf-search-hit'
      mark.textContent = entry.text.slice(range.start, range.end)
      fragment.append(mark)
      offset = range.end
    }
    if (offset < entry.text.length) fragment.append(document.createTextNode(entry.text.slice(offset)))
    entry.span.replaceChildren(fragment)
  }
}

export function PdfPageCanvas({
  pdf,
  pageIndex,
  zoom,
  rotation,
  annotations,
  tool,
  color,
  strokeWidth,
  fontSize,
  selectedId,
  onSelect,
  onAdd,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<DragPreview | null>(null)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const updatePreview = (next: DragPreview | null) => {
    previewRef.current = next
    setPreview(next)
  }

  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('.search-box input')
    if (!input) return
    const sync = () => setSearchQuery(currentSearchQuery())
    sync()
    input.addEventListener('input', sync)
    input.addEventListener('change', sync)
    return () => {
      input.removeEventListener('input', sync)
      input.removeEventListener('change', sync)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let renderTask: CancelableRenderTask | null = null

    const render = async () => {
      // Page-count-changing operations can update editor state before the replacement
      // PDFDocumentProxy finishes loading. Never ask the old proxy for an invalid page.
      if (pageIndex < 0 || pageIndex >= pdf.numPages) return
      const page = await pdf.getPage(pageIndex + 1)
      if (cancelled) return

      const viewport = page.getViewport({ scale: zoom, rotation })
      const canvas = canvasRef.current
      if (!canvas) return

      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.floor(viewport.width * ratio))
      canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setSize({ width: viewport.width, height: viewport.height })

      const ctx = canvas.getContext('2d')
      if (!ctx || cancelled) return
      const renderViewport = page.getViewport({ scale: zoom * ratio, rotation })
      renderTask = page.render({ canvas, canvasContext: ctx, viewport: renderViewport }) as CancelableRenderTask
      await renderTask.promise
    }

    void render().catch((error: unknown) => {
      const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : ''
      if (!cancelled && name !== 'RenderingCancelledException') console.error(error)
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pdf, pageIndex, zoom, rotation])

  useEffect(() => {
    let cancelled = false
    let textLayer: CancelableTextLayer | null = null

    const renderText = async () => {
      const container = textLayerRef.current
      if (!container) return
      container.replaceChildren()
      if (pageIndex < 0 || pageIndex >= pdf.numPages) return

      const page = await pdf.getPage(pageIndex + 1)
      if (cancelled) return
      const viewport = page.getViewport({ scale: zoom, rotation })
      const textContent = await page.getTextContent()
      if (cancelled) return

      container.style.width = `${viewport.width}px`
      container.style.height = `${viewport.height}px`
      container.style.setProperty('--total-scale-factor', String(viewport.scale))

      textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container,
        viewport,
      }) as CancelableTextLayer
      await textLayer.render()
      if (cancelled) return
      markSearchMatches(container, searchQuery)
    }

    void renderText().catch((error: unknown) => {
      const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : ''
      if (!cancelled && name !== 'AbortException') console.error(error)
    })

    return () => {
      cancelled = true
      textLayer?.cancel()
    }
  }, [pdf, pageIndex, zoom, rotation, searchQuery])

  const pointFromEvent = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }

  const pointerDown = (e: React.PointerEvent) => {
    if (tool === 'select') {
      const p = pointFromEvent(e)
      const ink = [...annotations].reverse().find((ann) =>
        (ann.type === 'ink' || ann.type === 'signature') &&
        (ann.points || []).some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < 0.018),
      )
      onSelect(ink?.id || null)
      return
    }

    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pointFromEvent(e)
    if (tool === 'text') {
      onAdd({
        id: crypto.randomUUID(), page: pageIndex, type: 'text', x: p.x, y: p.y,
        text: 'Type here', color, fontSize,
      })
      return
    }
    if (tool === 'highlight' || tool === 'rectangle') {
      updatePreview({ type: tool, start: p, end: p })
      return
    }
    if (tool === 'ink' || tool === 'signature') {
      updatePreview({ type: tool, points: [p] })
    }
  }

  const pointerMove = (e: React.PointerEvent) => {
    const active = previewRef.current
    if (!active) return
    const p = pointFromEvent(e)
    if (active.type === 'highlight' || active.type === 'rectangle') {
      updatePreview({ ...active, end: p })
    } else {
      updatePreview({ ...active, points: [...(active.points || []), p] })
    }
  }

  const pointerUp = (e: React.PointerEvent) => {
    const active = previewRef.current
    if (!active) return

    const releasedAt = pointFromEvent(e)
    let completed = active
    if (active.type === 'highlight' || active.type === 'rectangle') {
      completed = { ...active, end: releasedAt }
    } else {
      const points = active.points || []
      const last = points[points.length - 1]
      const needsFinalPoint = !last || Math.hypot(last.x - releasedAt.x, last.y - releasedAt.y) > 0.0005
      completed = { ...active, points: needsFinalPoint ? [...points, releasedAt] : points }
    }

    if ((completed.type === 'highlight' || completed.type === 'rectangle') && completed.start && completed.end) {
      const x = Math.min(completed.start.x, completed.end.x)
      const y = Math.min(completed.start.y, completed.end.y)
      const width = Math.max(0.02, Math.abs(completed.end.x - completed.start.x))
      const height = Math.max(0.018, Math.abs(completed.end.y - completed.start.y))
      onAdd({
        id: crypto.randomUUID(), page: pageIndex, type: completed.type,
        x, y, width, height, color, strokeWidth,
      })
    } else if ((completed.type === 'ink' || completed.type === 'signature') && (completed.points?.length || 0) > 1) {
      const xs = completed.points!.map((p) => p.x)
      const ys = completed.points!.map((p) => p.y)
      onAdd({
        id: crypto.randomUUID(), page: pageIndex, type: completed.type,
        x: Math.min(...xs), y: Math.min(...ys), color,
        strokeWidth: completed.type === 'signature' ? Math.max(2, strokeWidth) : strokeWidth,
        points: completed.points,
      })
    }
    updatePreview(null)
  }

  const selectAnnotation = (e: React.PointerEvent, id: string) => {
    if (tool !== 'select') return
    e.stopPropagation()
    onSelect(id)
  }

  const rectStyle = (ann: Annotation) => ({
    left: `${ann.x * 100}%`, top: `${ann.y * 100}%`,
    width: `${(ann.width || 0.2) * 100}%`, height: `${(ann.height || 0.06) * 100}%`,
  })

  const renderInk = (ann: Annotation, isPreview = false) => {
    const points = ann.points || []
    const path = points.map((p) => `${p.x * size.width},${p.y * size.height}`).join(' ')
    return (
      <svg className="ink-layer" width={size.width} height={size.height} aria-hidden="true">
        <polyline
          points={path}
          fill="none"
          stroke={ann.color}
          strokeWidth={ann.strokeWidth || 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={isPreview ? 0.7 : 0.95}
        />
      </svg>
    )
  }

  return (
    <div
      ref={wrapRef}
      className={`pdf-page tool-${tool}`}
      style={{ width: size.width, height: size.height }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={() => updatePreview(null)}
    >
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className={`pdf-text-layer textLayer ${tool === 'select' ? 'interactive' : ''}`} />
      <div className="annotation-layer">
        {annotations.map((ann) => {
          const selected = ann.id === selectedId
          if (ann.type === 'text') {
            return (
              <button
                key={ann.id}
                className={`annotation text-annotation ${selected ? 'selected' : ''}`}
                style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, color: ann.color, fontSize: ann.fontSize }}
                onPointerDown={(e) => selectAnnotation(e, ann.id)}
              >{ann.text}</button>
            )
          }
          if (ann.type === 'highlight' || ann.type === 'rectangle') {
            return (
              <button
                key={ann.id}
                className={`annotation box-annotation ${ann.type} ${selected ? 'selected' : ''}`}
                style={{
                  ...rectStyle(ann),
                  background: ann.type === 'highlight' ? `${ann.color}55` : 'transparent',
                  borderColor: ann.type === 'rectangle' ? ann.color : 'transparent',
                  borderWidth: ann.type === 'rectangle' ? ann.strokeWidth || 2 : 0,
                }}
                onPointerDown={(e) => selectAnnotation(e, ann.id)}
              />
            )
          }
          return (
            <button
              key={ann.id}
              className={`annotation ink-hitbox ${selected ? 'selected' : ''}`}
              onPointerDown={(e) => selectAnnotation(e, ann.id)}
            >{renderInk(ann)}</button>
          )
        })}
        {preview && (preview.type === 'ink' || preview.type === 'signature') && renderInk({
          id: 'preview', page: pageIndex, type: preview.type, x: 0, y: 0,
          color, strokeWidth, points: preview.points || [],
        }, true)}
        {preview && (preview.type === 'highlight' || preview.type === 'rectangle') && preview.start && preview.end && (
          <div
            className={`preview-box ${preview.type}`}
            style={{
              left: `${Math.min(preview.start.x, preview.end.x) * 100}%`,
              top: `${Math.min(preview.start.y, preview.end.y) * 100}%`,
              width: `${Math.abs(preview.end.x - preview.start.x) * 100}%`,
              height: `${Math.abs(preview.end.y - preview.start.y) * 100}%`,
              background: preview.type === 'highlight' ? `${color}55` : 'transparent',
              borderColor: color,
            }}
          />
        )}
      </div>
    </div>
  )
}
