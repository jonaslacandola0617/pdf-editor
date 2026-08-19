import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPageCanvas } from './PdfPageCanvas'
import type { Annotation, NativeTextSelection, Point, Tool } from '../types'

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
  onFocus: () => void
  onBeginAnnotationEdit?: () => void
  onUpdateAnnotation?: (id: string, patch: Partial<Annotation>) => void
}

export function LazyPdfPage(props: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [placeholder, setPlaceholder] = useState({ width: 595, height: 842 })

  useEffect(() => {
    if (!props.pdf) return
    let cancelled = false
    void props.pdf.getPage(props.pageIndex + 1).then((page) => {
      if (cancelled) return
      const viewport = page.getViewport({ scale: props.zoom, rotation: props.rotation })
      setPlaceholder({ width: viewport.width, height: viewport.height })
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [props.pdf, props.pageIndex, props.rotation, props.zoom])

  useEffect(() => {
    const node = host.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries[0]?.isIntersecting || false)
    }, { root: node.closest('.page-scroll'), rootMargin: '1100px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return <div
    ref={host}
    className="page-view lazy-page-view"
    data-page={props.pageIndex}
    style={{ minWidth: placeholder.width, minHeight: placeholder.height }}
    onPointerDownCapture={props.onFocus}
  >
    {visible
      ? <PdfPageCanvas {...props} />
      : <div className="page-placeholder" style={{ width: placeholder.width, height: placeholder.height }}><span>Page {props.pageIndex + 1}</span></div>}
  </div>
}
