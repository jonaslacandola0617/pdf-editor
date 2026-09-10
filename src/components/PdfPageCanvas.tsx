import { useEffect, useRef, useState } from 'react'
import { isRetiredPdfResource, pdfjsLib, type PDFDocumentProxy } from '../lib/pdfjs'
import type { Annotation, NativeTextSelection, Point, Tool } from '../types'
import { OcrTextOverlay } from './OcrTextOverlay'
import { FormWidgetOverlay, type PageFormWidget } from './FormWidgetOverlay'
import type { FormWidgetGeometry, FormWidgetTarget } from '../lib/advanced-forms'
import '../text-layer.css'

type Props = {
  pdf: PDFDocumentProxy | null
  pageIndex: number
  zoom: number
  rotation: number
  annotations: Annotation[]
  tool: Tool
  color: string
  strokeWidth: number
  fontSize: number
  selectedId: string | null
  nativeSelection: NativeTextSelection | null
  onSelect: (id: string | null) => void
  onAdd: (annotation: Annotation) => void
  onPickNativeText: (point: Point, hint: string) => void
  onBeginAnnotationEdit?: () => void
  onUpdateAnnotation?: (id: string, patch: Partial<Annotation>) => void
  formWidgetMode?: boolean
  formWidgets?: PageFormWidget[]
  selectedFormWidgets?: Set<string>
  onSelectFormWidget?: (target: FormWidgetTarget | null, additive: boolean) => void
  onCommitFormWidget?: (target: FormWidgetTarget, geometry: FormWidgetGeometry) => void
}

type DragPreview = {
  type: 'highlight' | 'rectangle' | 'redaction' | 'ink' | 'signature'
  start?: Point
  end?: Point
  points?: Point[]
}

type AnnotationEdit = {
  id: string
  mode: 'move' | 'resize' | 'rotate' | 'skew'
  start: Point
  original: Annotation
  center?: Point
  startAngle?: number
}

type AnnotationActionDetail = {
  action: 'copy' | 'cut' | 'paste' | 'duplicate' | 'delete' | 'properties'
  pageIndex: number
  annotationId?: string
}

type CancelableRenderTask = { promise: Promise<unknown>; cancel: () => void }
type CancelableTextLayer = { render: () => Promise<unknown>; cancel: () => void; textDivs?: HTMLElement[]; textContentItemsStr?: string[] }
const EMPTY_FORM_WIDGET_SELECTION = new Set<string>()
const EMPTY_FORM_WIDGETS: PageFormWidget[] = []
const ANNOTATION_ACTION_EVENT = 'pdf-forge:annotation-action'
let annotationClipboard: Annotation | null = null

function currentSearchQuery() {
  return document.querySelector<HTMLInputElement>('.search-box input')?.value.trim() || ''
}

function markSearchMatches(container: HTMLElement, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return
  const spans = Array.from(container.querySelectorAll<HTMLSpanElement>('span')).filter((span) => span.childElementCount === 0 && (span.textContent || '').length > 0)
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
  for (const entry of entries) {
    const localRanges = ranges.map((range) => ({ start: Math.max(range.start, entry.start) - entry.start, end: Math.min(range.end, entry.end) - entry.start })).filter((range) => range.start < range.end)
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

function forwardRotatePoint(x: number, y: number, rotation: number) {
  const r = ((rotation % 360) + 360) % 360
  if (r === 90) return { x: 1 - y, y: x }
  if (r === 180) return { x: 1 - x, y: 1 - y }
  if (r === 270) return { x: y, y: 1 - x }
  return { x, y }
}

function displaySelectionBounds(selection: NativeTextSelection, rotation: number) {
  const corners = [
    forwardRotatePoint(selection.x, selection.y, rotation),
    forwardRotatePoint(selection.x + selection.width, selection.y, rotation),
    forwardRotatePoint(selection.x, selection.y + selection.height, rotation),
    forwardRotatePoint(selection.x + selection.width, selection.y + selection.height, rotation),
  ]
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

function textHintFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return ''
  return target.closest('.pdf-text-layer span')?.textContent?.trim() || ''
}

function clamp(value: number, min = 0, max = 1) { return Math.max(min, Math.min(max, value)) }
function clampDegrees(value: number) { return Math.max(-45, Math.min(45, value)) }
function normalizeDegrees(value: number) {
  let next = value % 360
  if (next > 180) next -= 360
  if (next < -180) next += 360
  return Math.round(next * 10) / 10
}

function annotationBounds(ann: Annotation) {
  if (ann.points?.length) {
    const xs = ann.points.map((point) => point.x)
    const ys = ann.points.map((point) => point.y)
    const x = Math.min(...xs); const y = Math.min(...ys)
    return { x, y, width: Math.max(0.02, Math.max(...xs) - x), height: Math.max(0.018, Math.max(...ys) - y) }
  }
  if (ann.type === 'text') {
    const width = ann.width || Math.max(0.06, Math.min(0.48, ((ann.text?.length || 6) * (ann.fontSize || 18)) / 9500))
    const height = ann.height || Math.max(0.026, (ann.fontSize || 18) / 700)
    return { x: ann.x, y: ann.y, width, height }
  }
  if (ann.type === 'note') return { x: ann.x, y: ann.y, width: 0.045, height: 0.045 }
  return { x: ann.x, y: ann.y, width: ann.width || 0.2, height: ann.height || 0.06 }
}

function annotationTransform(ann: Annotation) {
  return `rotate(${ann.rotation || 0}deg) skewX(${ann.skewX || 0}deg) skewY(${ann.skewY || 0}deg)`
}

function transformPoint(point: Point, ann: Annotation) {
  const bounds = annotationBounds(ann)
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  let dx = point.x - cx
  let dy = point.y - cy
  const skewX = Math.tan(((ann.skewX || 0) * Math.PI) / 180)
  const skewY = Math.tan(((ann.skewY || 0) * Math.PI) / 180)
  const skewedX = dx + skewX * dy
  const skewedY = dy + skewY * dx
  const angle = ((ann.rotation || 0) * Math.PI) / 180
  const cos = Math.cos(angle); const sin = Math.sin(angle)
  dx = skewedX * cos - skewedY * sin
  dy = skewedX * sin + skewedY * cos
  return { x: cx + dx, y: cy + dy }
}

function copyAnnotation(annotation: Annotation) {
  annotationClipboard = structuredClone(annotation)
  document.documentElement.dataset.forgeAnnotationClipboard = '1'
  if (annotation.text && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(annotation.text).catch(() => undefined)
  }
}

function cloneAnnotationForPage(annotation: Annotation, pageIndex: number) {
  const copy = structuredClone(annotation)
  const bounds = annotationBounds(copy)
  const dx = Math.min(0.025, Math.max(0, 1 - bounds.x - bounds.width))
  const dy = Math.min(0.025, Math.max(0, 1 - bounds.y - bounds.height))
  return {
    ...copy,
    id: crypto.randomUUID(),
    page: pageIndex,
    x: clamp(copy.x + dx),
    y: clamp(copy.y + dy),
    points: copy.points?.map((point) => ({ x: clamp(point.x + dx), y: clamp(point.y + dy) })),
  }
}

function dispatchDeleteKey() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
}

export function PdfPageCanvas({
  pdf, pageIndex, zoom, rotation, annotations, tool, color, strokeWidth, fontSize,
  selectedId, nativeSelection, onSelect, onAdd, onPickNativeText,
  onBeginAnnotationEdit, onUpdateAnnotation,
  formWidgetMode = false, formWidgets = EMPTY_FORM_WIDGETS, selectedFormWidgets = EMPTY_FORM_WIDGET_SELECTION, onSelectFormWidget, onCommitFormWidget,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<DragPreview | null>(null)
  const editRef = useRef<AnnotationEdit | null>(null)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const updatePreview = (next: DragPreview | null) => { previewRef.current = next; setPreview(next) }

  useEffect(() => {
    const handleAnnotationAction = (event: Event) => {
      const detail = (event as CustomEvent<AnnotationActionDetail>).detail
      if (!detail) return

      if (detail.action === 'paste') {
        if (detail.pageIndex !== pageIndex || !annotationClipboard) return
        onAdd(cloneAnnotationForPage(annotationClipboard, pageIndex))
        return
      }

      const annotation = annotations.find((item) => item.id === detail.annotationId)
        || annotations.find((item) => item.id === selectedId)
      if (!annotation) return

      if (detail.action === 'copy') {
        copyAnnotation(annotation)
        onSelect(annotation.id)
        return
      }

      if (detail.action === 'duplicate') {
        onAdd(cloneAnnotationForPage(annotation, pageIndex))
        return
      }

      if (detail.action === 'cut') {
        copyAnnotation(annotation)
        onSelect(annotation.id)
        window.setTimeout(dispatchDeleteKey, 0)
        return
      }

      if (detail.action === 'delete') {
        onSelect(annotation.id)
        window.setTimeout(dispatchDeleteKey, 0)
        return
      }

      if (detail.action === 'properties') {
        onSelect(annotation.id)
        window.setTimeout(() => {
          if (!document.querySelector('.forge-editor-workbench.inspector-open')) {
            document.querySelector<HTMLButtonElement>('.forge-inspector-toggle')?.click()
          }
        }, 0)
      }
    }

    window.addEventListener(ANNOTATION_ACTION_EVENT, handleAnnotationAction as EventListener)
    return () => window.removeEventListener(ANNOTATION_ACTION_EVENT, handleAnnotationAction as EventListener)
  }, [annotations, onAdd, onSelect, pageIndex, selectedId])

  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('.search-box input')
    if (!input) return
    const sync = () => setSearchQuery(currentSearchQuery())
    sync()
    input.addEventListener('input', sync)
    input.addEventListener('change', sync)
    return () => { input.removeEventListener('input', sync); input.removeEventListener('change', sync) }
  }, [])

  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    let renderTask: CancelableRenderTask | null = null
    const render = async () => {
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
      if (!cancelled && !isRetiredPdfResource(pdf) && name !== 'RenderingCancelledException') console.error(error)
    })
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdf, pageIndex, zoom, rotation])

  useEffect(() => {
    if (!pdf) return
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
      textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container, viewport }) as CancelableTextLayer
      await textLayer.render()
      if (!cancelled) markSearchMatches(container, searchQuery)
    }
    void renderText().catch((error: unknown) => {
      const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : ''
      if (!cancelled && !isRetiredPdfResource(pdf) && name !== 'AbortException') console.error(error)
    })
    return () => { cancelled = true; textLayer?.cancel() }
  }, [pdf, pageIndex, zoom, rotation, searchQuery])

  const pointFromEvent = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) }
  }

  const angleForPoint = (point: Point, center: Point) => Math.atan2((point.y - center.y) * size.height, (point.x - center.x) * size.width)

  const beginAnnotationEdit = (e: React.PointerEvent, ann: Annotation, mode: AnnotationEdit['mode']) => {
    if (tool !== 'select') return
    e.stopPropagation(); e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    onSelect(ann.id); onBeginAnnotationEdit?.()
    const start = pointFromEvent(e)
    const bounds = annotationBounds(ann)
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    editRef.current = { id: ann.id, mode, start, original: structuredClone(ann), center, startAngle: angleForPoint(start, center) }
  }

  const pointerDown = (e: React.PointerEvent) => {
    if (formWidgetMode) { onSelectFormWidget?.(null, false); return }
    if (tool === 'editText') { onPickNativeText(pointFromEvent(e), textHintFromTarget(e.target)); return }
    if (tool === 'select') {
      const p = pointFromEvent(e)
      const ink = [...annotations].reverse().find((ann) => (ann.type === 'ink' || ann.type === 'signature') && (ann.points || []).some((pt) => {
        const transformed = transformPoint(pt, ann)
        return Math.hypot(transformed.x - p.x, transformed.y - p.y) < 0.018
      }))
      onSelect(ink?.id || null)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pointFromEvent(e)
    if (tool === 'text') { onAdd({ id: crypto.randomUUID(), page: pageIndex, type: 'text', x: p.x, y: p.y, text: 'Type here', color, fontSize }); return }
    if (tool === 'note') { onAdd({ id: crypto.randomUUID(), page: pageIndex, type: 'note', x: p.x, y: p.y, text: 'New note', color: '#facc15' }); return }
    if (tool === 'highlight' || tool === 'rectangle' || tool === 'redaction') { updatePreview({ type: tool, start: p, end: p }); return }
    if (tool === 'ink' || tool === 'signature') updatePreview({ type: tool, points: [p] })
  }

  const pointerMove = (e: React.PointerEvent) => {
    const editing = editRef.current
    if (editing && onUpdateAnnotation) {
      const point = pointFromEvent(e)
      const dx = point.x - editing.start.x
      const dy = point.y - editing.start.y
      const ann = editing.original
      const bounds = annotationBounds(ann)

      if (editing.mode === 'rotate' && editing.center && editing.startAngle !== undefined) {
        const delta = ((angleForPoint(point, editing.center) - editing.startAngle) * 180) / Math.PI
        onUpdateAnnotation(editing.id, { rotation: normalizeDegrees((ann.rotation || 0) + delta) })
        return
      }

      if (editing.mode === 'skew') {
        onUpdateAnnotation(editing.id, {
          skewX: Math.round(clampDegrees((ann.skewX || 0) + dx * 110) * 10) / 10,
          skewY: Math.round(clampDegrees((ann.skewY || 0) + dy * 110) * 10) / 10,
        })
        return
      }

      if (editing.mode === 'resize') {
        if (ann.points?.length) {
          const newWidth = Math.max(0.025, Math.min(1 - bounds.x, bounds.width + dx))
          const newHeight = Math.max(0.025, Math.min(1 - bounds.y, bounds.height + dy))
          const sx = newWidth / Math.max(0.001, bounds.width)
          const sy = newHeight / Math.max(0.001, bounds.height)
          const points = ann.points.map((p) => ({ x: bounds.x + (p.x - bounds.x) * sx, y: bounds.y + (p.y - bounds.y) * sy }))
          onUpdateAnnotation(editing.id, { x: bounds.x, y: bounds.y, points })
        } else if (ann.type === 'text') {
          const growth = (dx * size.width + dy * size.height) / 18
          onUpdateAnnotation(editing.id, { fontSize: Math.max(8, Math.min(160, (ann.fontSize || 18) + growth)) })
        } else {
          onUpdateAnnotation(editing.id, {
            width: Math.max(0.02, Math.min(1 - ann.x, (ann.width || 0.2) + dx)),
            height: Math.max(0.018, Math.min(1 - ann.y, (ann.height || 0.06) + dy)),
          })
        }
        return
      }

      if (ann.points?.length) {
        const minX = Math.min(...ann.points.map((p) => p.x)); const maxX = Math.max(...ann.points.map((p) => p.x))
        const minY = Math.min(...ann.points.map((p) => p.y)); const maxY = Math.max(...ann.points.map((p) => p.y))
        const safeDx = clamp(dx, -minX, 1 - maxX); const safeDy = clamp(dy, -minY, 1 - maxY)
        onUpdateAnnotation(editing.id, { x: clamp(ann.x + safeDx), y: clamp(ann.y + safeDy), points: ann.points.map((p) => ({ x: p.x + safeDx, y: p.y + safeDy })) })
      } else {
        const width = ann.width || 0; const height = ann.height || 0
        onUpdateAnnotation(editing.id, { x: clamp(ann.x + dx, 0, 1 - width), y: clamp(ann.y + dy, 0, 1 - height) })
      }
      return
    }

    const active = previewRef.current
    if (!active) return
    const p = pointFromEvent(e)
    if (active.type === 'highlight' || active.type === 'rectangle' || active.type === 'redaction') updatePreview({ ...active, end: p })
    else updatePreview({ ...active, points: [...(active.points || []), p] })
  }

  const pointerUp = (e: React.PointerEvent) => {
    if (editRef.current) { editRef.current = null; return }
    const active = previewRef.current
    if (!active) return
    const releasedAt = pointFromEvent(e)
    let completed = active
    if (active.type === 'highlight' || active.type === 'rectangle' || active.type === 'redaction') completed = { ...active, end: releasedAt }
    else {
      const points = active.points || []; const last = points[points.length - 1]
      const needsFinalPoint = !last || Math.hypot(last.x - releasedAt.x, last.y - releasedAt.y) > 0.0005
      completed = { ...active, points: needsFinalPoint ? [...points, releasedAt] : points }
    }
    if ((completed.type === 'highlight' || completed.type === 'rectangle' || completed.type === 'redaction') && completed.start && completed.end) {
      const x = Math.min(completed.start.x, completed.end.x); const y = Math.min(completed.start.y, completed.end.y)
      const width = Math.max(0.02, Math.abs(completed.end.x - completed.start.x)); const height = Math.max(0.018, Math.abs(completed.end.y - completed.start.y))
      onAdd({ id: crypto.randomUUID(), page: pageIndex, type: completed.type, x, y, width, height, color: completed.type === 'redaction' ? '#000000' : color, strokeWidth })
    } else if ((completed.type === 'ink' || completed.type === 'signature') && (completed.points?.length || 0) > 1) {
      const xs = completed.points!.map((p) => p.x); const ys = completed.points!.map((p) => p.y)
      onAdd({ id: crypto.randomUUID(), page: pageIndex, type: completed.type, x: Math.min(...xs), y: Math.min(...ys), color, strokeWidth: completed.type === 'signature' ? Math.max(2, strokeWidth) : strokeWidth, points: completed.points })
    }
    updatePreview(null)
  }

  const rectStyle = (ann: Annotation) => ({
    left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, width: `${(ann.width || 0.2) * 100}%`, height: `${(ann.height || 0.06) * 100}%`,
    transform: annotationTransform(ann), transformOrigin: 'center center',
  })

  const renderInk = (ann: Annotation, isPreview = false) => {
    const points = (ann.points || []).map((point) => transformPoint(point, ann))
    const path = points.map((p) => `${p.x * size.width},${p.y * size.height}`).join(' ')
    return <svg className="ink-layer" width={size.width} height={size.height} aria-hidden="true"><polyline points={path} fill="none" stroke={ann.color} strokeWidth={ann.strokeWidth || 2} strokeLinecap="round" strokeLinejoin="round" opacity={isPreview ? 0.7 : 0.95} /></svg>
  }

  const nativeBounds = nativeSelection?.page === pageIndex ? displaySelectionBounds(nativeSelection, rotation) : null
  const selectedAnnotation = tool === 'select' ? annotations.find((ann) => ann.id === selectedId) : undefined
  const selectedBounds = selectedAnnotation ? annotationBounds(selectedAnnotation) : null
  const transformable = selectedAnnotation && selectedAnnotation.type !== 'note' && selectedAnnotation.type !== 'redaction'

  return (
    <div ref={wrapRef} className={`pdf-page tool-${tool}`} style={{ width: size.width, height: size.height }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { updatePreview(null); editRef.current = null }}>
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className={`pdf-text-layer textLayer ${tool === 'select' || tool === 'editText' ? 'interactive' : ''}`} />
      {pdf && <OcrTextOverlay pdf={pdf} pageIndex={pageIndex} rotation={rotation} searchQuery={searchQuery} />}
      {nativeBounds && <div className="native-text-selection" aria-hidden="true" style={{ left: `${nativeBounds.x * 100}%`, top: `${nativeBounds.y * 100}%`, width: `${nativeBounds.width * 100}%`, height: `${nativeBounds.height * 100}%` }} />}
      {formWidgetMode && onSelectFormWidget && onCommitFormWidget && <FormWidgetOverlay widgets={formWidgets} rotation={rotation} selected={selectedFormWidgets} onSelect={onSelectFormWidget} onCommit={onCommitFormWidget} />}
      <div className="annotation-layer">
        {annotations.map((ann) => {
          const selected = ann.id === selectedId
          if (ann.type === 'note') return <button key={ann.id} data-annotation-id={ann.id} className={`annotation note-annotation ${selected ? 'selected' : ''}`} style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%` }} title={ann.text || 'Note'} onPointerDown={(e) => beginAnnotationEdit(e, ann, 'move')}><span>💬</span></button>
          if (ann.type === 'text') return <button key={ann.id} data-annotation-id={ann.id} className={`annotation text-annotation ${selected ? 'selected' : ''}`} style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, color: ann.color, fontSize: ann.fontSize, transform: annotationTransform(ann), transformOrigin: 'center center' }} onPointerDown={(e) => beginAnnotationEdit(e, ann, 'move')}>{ann.text}</button>
          if (ann.type === 'highlight' || ann.type === 'rectangle' || ann.type === 'redaction') return <button key={ann.id} data-annotation-id={ann.id} className={`annotation box-annotation ${ann.type} ${selected ? 'selected' : ''}`} style={{ ...rectStyle(ann), background: ann.type === 'highlight' ? `${ann.color}55` : ann.type === 'redaction' ? 'rgba(180,30,25,.72)' : 'transparent', borderColor: ann.type === 'rectangle' ? ann.color : ann.type === 'redaction' ? '#ff625a' : 'transparent', borderWidth: ann.type === 'rectangle' || ann.type === 'redaction' ? ann.strokeWidth || 2 : 0 }} onPointerDown={(e) => beginAnnotationEdit(e, ann, 'move')} />
          return <button key={ann.id} data-annotation-id={ann.id} className={`annotation ink-hitbox ${selected ? 'selected' : ''}`} onPointerDown={(e) => beginAnnotationEdit(e, ann, 'move')}>{renderInk(ann)}</button>
        })}

        {selectedAnnotation && selectedBounds && (
          <div className={`annotation-transform-box ${transformable ? 'full-transform' : 'resize-only'}`} style={{ left: `${selectedBounds.x * 100}%`, top: `${selectedBounds.y * 100}%`, width: `${selectedBounds.width * 100}%`, height: `${selectedBounds.height * 100}%`, transform: annotationTransform(selectedAnnotation), transformOrigin: 'center center' }}>
            <button className="annotation-transform-handle resize" aria-label="Resize selection" title="Resize" onPointerDown={(e) => beginAnnotationEdit(e, selectedAnnotation, 'resize')} />
            {transformable && <>
              <button className="annotation-transform-handle rotate" aria-label="Rotate selection" title="Rotate" onPointerDown={(e) => beginAnnotationEdit(e, selectedAnnotation, 'rotate')} />
              <button className="annotation-transform-handle skew" aria-label="Skew selection" title="Skew" onPointerDown={(e) => beginAnnotationEdit(e, selectedAnnotation, 'skew')} />
            </>}
          </div>
        )}

        {preview && (preview.type === 'ink' || preview.type === 'signature') && renderInk({ id: 'preview', page: pageIndex, type: preview.type, x: 0, y: 0, color, strokeWidth, points: preview.points || [] }, true)}
        {preview && (preview.type === 'highlight' || preview.type === 'rectangle' || preview.type === 'redaction') && preview.start && preview.end && <div className={`preview-box ${preview.type}`} style={{ left: `${Math.min(preview.start.x, preview.end.x) * 100}%`, top: `${Math.min(preview.start.y, preview.end.y) * 100}%`, width: `${Math.abs(preview.end.x - preview.start.x) * 100}%`, height: `${Math.abs(preview.end.y - preview.start.y) * 100}%`, background: preview.type === 'highlight' ? `${color}55` : preview.type === 'redaction' ? 'rgba(180,30,25,.72)' : 'transparent', borderColor: preview.type === 'redaction' ? '#ff625a' : color }} />}
      </div>
    </div>
  )
}
