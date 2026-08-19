import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../lib/pdfjs'
import type { Annotation, Point, Tool } from '../types'

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
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<DragPreview | null>(null)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [preview, setPreview] = useState<DragPreview | null>(null)

  const updatePreview = (next: DragPreview | null) => {
    previewRef.current = next
    setPreview(next)
  }

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      const page = await pdf.getPage(pageIndex + 1)
      if (cancelled) return
      const viewport = page.getViewport({ scale: zoom, rotation })
      const canvas = canvasRef.current
      if (!canvas) return
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setSize({ width: viewport.width, height: viewport.height })
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const renderViewport = page.getViewport({ scale: zoom * ratio, rotation })
      await page.render({ canvas, canvasContext: ctx, viewport: renderViewport }).promise
    }
    render()
    return () => { cancelled = true }
  }, [pdf, pageIndex, zoom, rotation])

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

  const pointerUp = () => {
    const active = previewRef.current
    if (!active) return
    if ((active.type === 'highlight' || active.type === 'rectangle') && active.start && active.end) {
      const x = Math.min(active.start.x, active.end.x)
      const y = Math.min(active.start.y, active.end.y)
      const width = Math.max(0.02, Math.abs(active.end.x - active.start.x))
      const height = Math.max(0.018, Math.abs(active.end.y - active.start.y))
      onAdd({
        id: crypto.randomUUID(), page: pageIndex, type: active.type,
        x, y, width, height, color, strokeWidth,
      })
    } else if ((active.type === 'ink' || active.type === 'signature') && (active.points?.length || 0) > 1) {
      const xs = active.points!.map((p) => p.x)
      const ys = active.points!.map((p) => p.y)
      onAdd({
        id: crypto.randomUUID(), page: pageIndex, type: active.type,
        x: Math.min(...xs), y: Math.min(...ys), color,
        strokeWidth: active.type === 'signature' ? Math.max(2, strokeWidth) : strokeWidth,
        points: active.points,
      })
    }
    updatePreview(null)
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
      <div className="annotation-layer">
        {annotations.map((ann) => {
          const selected = ann.id === selectedId
          if (ann.type === 'text') {
            return (
              <button
                key={ann.id}
                className={`annotation text-annotation ${selected ? 'selected' : ''}`}
                style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, color: ann.color, fontSize: ann.fontSize }}
                onPointerDown={(e) => { e.stopPropagation(); onSelect(ann.id) }}
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
                onPointerDown={(e) => { e.stopPropagation(); onSelect(ann.id) }}
              />
            )
          }
          return (
            <button
              key={ann.id}
              className={`annotation ink-hitbox ${selected ? 'selected' : ''}`}
              onPointerDown={(e) => { e.stopPropagation(); onSelect(ann.id) }}
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
