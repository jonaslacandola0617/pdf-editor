import { useRef, useState } from 'react'
import type { FormWidgetGeometry, FormWidgetTarget } from '../lib/advanced-forms'

export type PageFormWidget = FormWidgetTarget & {
  type: string
  geometry: FormWidgetGeometry
}

type DragState = {
  target: FormWidgetTarget
  mode: 'move' | 'resize'
  start: { x: number; y: number }
  original: FormWidgetGeometry
  current: FormWidgetGeometry
}

type Props = {
  widgets: PageFormWidget[]
  rotation: number
  selected: Set<string>
  onSelect: (target: FormWidgetTarget | null, additive: boolean) => void
  onCommit: (target: FormWidgetTarget, geometry: FormWidgetGeometry) => void
}

export function formWidgetKey(target: FormWidgetTarget) {
  return `${target.fieldName}:${target.widgetIndex}`
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value))
}

function rotatePoint(x: number, y: number, rotation: number) {
  const normalized = ((rotation % 360) + 360) % 360
  if (normalized === 90) return { x: 100 - y, y: x }
  if (normalized === 180) return { x: 100 - x, y: 100 - y }
  if (normalized === 270) return { x: y, y: 100 - x }
  return { x, y }
}

function transformGeometry(geometry: FormWidgetGeometry, rotation: number) {
  const corners = [
    rotatePoint(geometry.x, geometry.y, rotation),
    rotatePoint(geometry.x + geometry.width, geometry.y, rotation),
    rotatePoint(geometry.x, geometry.y + geometry.height, rotation),
    rotatePoint(geometry.x + geometry.width, geometry.y + geometry.height, rotation),
  ]
  const xs = corners.map(point => point.x)
  const ys = corners.map(point => point.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

function documentGeometry(display: FormWidgetGeometry, rotation: number) {
  return transformGeometry(display, -rotation)
}

export function FormWidgetOverlay({ widgets, rotation, selected, onSelect, onCommit }: Props) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const point = (event: React.PointerEvent) => {
    const rect = layerRef.current!.getBoundingClientRect()
    return {
      x: clamp((event.clientX - rect.left) / rect.width * 100),
      y: clamp((event.clientY - rect.top) / rect.height * 100),
    }
  }

  const begin = (event: React.PointerEvent, widget: PageFormWidget, mode: 'move' | 'resize') => {
    event.preventDefault()
    event.stopPropagation()
    const target = { fieldName: widget.fieldName, widgetIndex: widget.widgetIndex }
    onSelect(target, event.ctrlKey || event.metaKey || event.shiftKey)
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    const original = transformGeometry(widget.geometry, rotation)
    const next = { target, mode, start: point(event), original, current: original }
    dragRef.current = next
    setDrag(next)
  }

  const move = (event: React.PointerEvent) => {
    const active = dragRef.current
    if (!active) return
    const current = point(event)
    const dx = current.x - active.start.x
    const dy = current.y - active.start.y
    const nextGeometry = active.mode === 'move'
      ? {
          ...active.original,
          x: clamp(active.original.x + dx, 0, 100 - active.original.width),
          y: clamp(active.original.y + dy, 0, 100 - active.original.height),
        }
      : {
          ...active.original,
          width: clamp(active.original.width + dx, 0.5, 100 - active.original.x),
          height: clamp(active.original.height + dy, 0.5, 100 - active.original.y),
        }
    const next = { ...active, current: nextGeometry }
    dragRef.current = next
    setDrag(next)
  }

  const finish = () => {
    const active = dragRef.current
    if (!active) return
    dragRef.current = null
    setDrag(null)
    const changed = (['x', 'y', 'width', 'height'] as const).some(key => Math.abs(active.current[key] - active.original[key]) > 0.01)
    if (changed) onCommit(active.target, documentGeometry(active.current, rotation))
  }

  return <div ref={layerRef} className="form-widget-layer" onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { dragRef.current = null; setDrag(null) }}>
    {widgets.map(widget => {
      const key = formWidgetKey(widget)
      const geometry = drag && formWidgetKey(drag.target) === key ? drag.current : transformGeometry(widget.geometry, rotation)
      const active = selected.has(key)
      return <div
        key={key}
        className={`form-widget-outline ${active ? 'selected' : ''}`}
        title={`${widget.fieldName} · ${widget.type}`}
        style={{ left: `${geometry.x}%`, top: `${geometry.y}%`, width: `${geometry.width}%`, height: `${geometry.height}%` }}
      >
        <button type="button" className="form-widget-hit" aria-label={`Form widget ${widget.fieldName} ${widget.widgetIndex + 1}`} onPointerDown={event => begin(event, widget, 'move')}><span>{widget.fieldName}</span></button>
        {active && <button type="button" className="form-widget-resize" aria-label={`Resize form widget ${widget.fieldName} ${widget.widgetIndex + 1}`} onPointerDown={event => begin(event, widget, 'resize')} />}
      </div>
    })}
  </div>
}
