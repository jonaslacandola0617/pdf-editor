import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Annotation, Point } from '../types'
import '../selection-transform.css'

type Bounds = { x: number; y: number; width: number; height: number }
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type DragState = {
  kind: 'resize' | 'rotate'
  handle?: ResizeHandle
  startX: number
  startY: number
  bounds: Bounds
  original: Annotation
  startAngle?: number
}

type Props = {
  annotation: Annotation
  pageWidth: number
  pageHeight: number
  containerRef: RefObject<HTMLDivElement | null>
  onBegin?: () => void
  onUpdate?: (id: string, patch: Partial<Annotation>) => void
}

const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

function clamp(value: number, min = 0, max = 1) { return Math.max(min, Math.min(max, value)) }
function normalizeDegrees(value: number) {
  let next = value % 360
  if (next > 180) next -= 360
  if (next < -180) next += 360
  return Math.round(next * 10) / 10
}

function baseBounds(annotation: Annotation): Bounds {
  if (annotation.points?.length) {
    const xs = annotation.points.map((point) => point.x)
    const ys = annotation.points.map((point) => point.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return {
      x,
      y,
      width: Math.max(0.02, Math.max(...xs) - x),
      height: Math.max(0.018, Math.max(...ys) - y),
    }
  }
  if (annotation.type === 'text') {
    return {
      x: annotation.x,
      y: annotation.y,
      width: annotation.width || 0.08,
      height: annotation.height || 0.035,
    }
  }
  return {
    x: annotation.x,
    y: annotation.y,
    width: annotation.width || 0.2,
    height: annotation.height || 0.06,
  }
}

function transformPoint(point: Point, annotation: Annotation, bounds = baseBounds(annotation)) {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  let dx = point.x - cx
  let dy = point.y - cy
  const skewX = Math.tan(((annotation.skewX || 0) * Math.PI) / 180)
  const skewY = Math.tan(((annotation.skewY || 0) * Math.PI) / 180)
  const sx = dx + skewX * dy
  const sy = dy + skewY * dx
  const angle = ((annotation.rotation || 0) * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  dx = sx * cos - sy * sin
  dy = sx * sin + sy * cos
  return { x: cx + dx, y: cy + dy }
}

function transformedPointBounds(annotation: Annotation) {
  const bounds = baseBounds(annotation)
  const points = (annotation.points || []).map((point) => transformPoint(point, annotation, bounds))
  if (!points.length) return bounds
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(0.02, Math.max(...xs) - x), height: Math.max(0.018, Math.max(...ys) - y) }
}

function targetBoundsFromHandle(bounds: Bounds, handle: ResizeHandle, dx: number, dy: number, minWidth: number, minHeight: number) {
  let left = bounds.x
  let right = bounds.x + bounds.width
  let top = bounds.y
  let bottom = bounds.y + bounds.height

  if (handle.includes('w')) left = clamp(bounds.x + dx, 0, right - minWidth)
  if (handle.includes('e')) right = clamp(bounds.x + bounds.width + dx, left + minWidth, 1)
  if (handle.includes('n')) top = clamp(bounds.y + dy, 0, bottom - minHeight)
  if (handle.includes('s')) bottom = clamp(bounds.y + bounds.height + dy, top + minHeight, 1)

  return { x: left, y: top, width: right - left, height: bottom - top }
}

function textBoundsForScale(bounds: Bounds, handle: ResizeHandle, scale: number) {
  const width = bounds.width * scale
  const height = bounds.height * scale
  const x = handle.includes('w') ? bounds.x + bounds.width - width : bounds.x
  const y = handle.includes('n') ? bounds.y + bounds.height - height : bounds.y
  return { x, y, width, height }
}

export function SelectionTransformOverlay({ annotation, pageWidth, pageHeight, containerRef, onBegin, onUpdate }: Props) {
  const [bounds, setBounds] = useState<Bounds>(() => baseBounds(annotation))
  const drag = useRef<DragState | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || pageWidth <= 1 || pageHeight <= 1) return

    const measure = () => {
      if (annotation.points?.length) {
        setBounds(transformedPointBounds(annotation))
        return
      }
      const selector = `[data-annotation-id="${CSS.escape(annotation.id)}"]`
      const element = container.querySelector<HTMLElement>(selector)
      if (!element) {
        setBounds(baseBounds(annotation))
        return
      }
      setBounds({
        x: clamp(element.offsetLeft / pageWidth),
        y: clamp(element.offsetTop / pageHeight),
        width: Math.max(0.008, element.offsetWidth / pageWidth),
        height: Math.max(0.008, element.offsetHeight / pageHeight),
      })
    }

    measure()
    const element = container.querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(annotation.id)}"]`)
    const resizeObserver = element ? new ResizeObserver(measure) : null
    if (element && resizeObserver) resizeObserver.observe(element)
    const frame = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
    }
  }, [annotation, containerRef, pageHeight, pageWidth])

  if (annotation.type === 'note' || !onUpdate) return null

  const startResize = (event: React.PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    onBegin?.()
    drag.current = {
      kind: 'resize',
      handle,
      startX: event.clientX,
      startY: event.clientY,
      bounds,
      original: structuredClone(annotation),
    }
  }

  const startRotate = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const centerX = rect.left + (bounds.x + bounds.width / 2) * pageWidth
    const centerY = rect.top + (bounds.y + bounds.height / 2) * pageHeight
    onBegin?.()
    drag.current = {
      kind: 'rotate',
      startX: event.clientX,
      startY: event.clientY,
      bounds,
      original: structuredClone(annotation),
      startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
    }
  }

  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active) return
    event.preventDefault()
    event.stopPropagation()

    if (active.kind === 'rotate') {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect || active.startAngle === undefined) return
      const centerX = rect.left + (active.bounds.x + active.bounds.width / 2) * pageWidth
      const centerY = rect.top + (active.bounds.y + active.bounds.height / 2) * pageHeight
      const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX)
      const delta = ((angle - active.startAngle) * 180) / Math.PI
      onUpdate(annotation.id, { rotation: normalizeDegrees((active.original.rotation || 0) + delta) })
      return
    }

    const handle = active.handle
    if (!handle) return
    const dx = (event.clientX - active.startX) / Math.max(1, pageWidth)
    const dy = (event.clientY - active.startY) / Math.max(1, pageHeight)
    const minimumWidth = 12 / Math.max(1, pageWidth)
    const minimumHeight = 12 / Math.max(1, pageHeight)
    let target = targetBoundsFromHandle(active.bounds, handle, dx, dy, minimumWidth, minimumHeight)
    const original = active.original

    if (original.type === 'text') {
      const ratioX = target.width / Math.max(0.001, active.bounds.width)
      const ratioY = target.height / Math.max(0.001, active.bounds.height)
      const scale = handle.length === 2
        ? Math.sqrt(Math.max(0.04, ratioX * ratioY))
        : (handle === 'e' || handle === 'w' ? ratioX : ratioY)
      const safeScale = Math.max(0.35, Math.min(6, scale))
      target = textBoundsForScale(active.bounds, handle, safeScale)
      onUpdate(annotation.id, {
        x: clamp(original.x + (target.x - active.bounds.x)),
        y: clamp(original.y + (target.y - active.bounds.y)),
        fontSize: Math.max(8, Math.min(180, (original.fontSize || 18) * safeScale)),
      })
      return
    }

    if (original.points?.length) {
      const source = baseBounds(original)
      const sx = target.width / Math.max(0.001, active.bounds.width)
      const sy = target.height / Math.max(0.001, active.bounds.height)
      const transformedPoints = original.points.map((point) => ({
        x: clamp(target.x + (point.x - source.x) * sx),
        y: clamp(target.y + (point.y - source.y) * sy),
      }))
      onUpdate(annotation.id, {
        x: target.x,
        y: target.y,
        points: transformedPoints,
        // Once geometry is directly transformed, stale skew would otherwise create
        // a second invisible transform. Keep existing rotation but normalize skew away.
        skewX: 0,
        skewY: 0,
      })
      return
    }

    onUpdate(annotation.id, {
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
      skewX: 0,
      skewY: 0,
    })
  }

  const finish = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    drag.current = null
  }

  const transform = annotation.points?.length
    ? undefined
    : `rotate(${annotation.rotation || 0}deg) skewX(${annotation.skewX || 0}deg) skewY(${annotation.skewY || 0}deg)`

  return (
    <div
      className={`selection-transform-frame ${annotation.type === 'redaction' ? 'resize-only' : ''}`}
      aria-label="Selected object transform"
      style={{
        left: `${bounds.x * 100}%`,
        top: `${bounds.y * 100}%`,
        width: `${bounds.width * 100}%`,
        height: `${bounds.height * 100}%`,
        transform,
      }}
    >
      {HANDLES.map((handle) => (
        <button
          key={handle}
          className={`selection-transform-handle handle-${handle}`}
          aria-label={`Resize ${handle}`}
          title={`Resize ${handle}`}
          onPointerDown={(event) => startResize(event, handle)}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
      ))}
      {annotation.type !== 'redaction' && (
        <button
          className="selection-transform-rotate"
          aria-label="Rotate selection"
          title="Rotate"
          onPointerDown={startRotate}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
      )}
    </div>
  )
}
